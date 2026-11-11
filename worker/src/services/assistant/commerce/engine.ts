/** TiendIA commerce conversation: interprets natural messages about products, stock and prices, asks
 * only for what is missing, lets the owner correct a pending proposal and prepares every change through
 * the existing confirmation flow (preview → confirm → atomic apply → audit). The AI never executes. */
import { escapeHtml, formatMoney } from '../tools'
import { readSession, say, updateSessionState, type AssistantContext, type CommerceState } from '../context'
import { cancelOperation, getPendingOperation, proposeChange } from '../operations'
import { backToMenu, productKeyboard } from '../menus'
import { beginProductDraft } from '../productDraft'
import { publicStoreUrl } from '../../../tenancy/stores'
import { can, roleAllows } from '../../../tenancy/access'
import type { CommerceIntent, StockLine } from './intent'
import { colorOf, fold, parseMoney, quantityOf, sameColor, sameSize, sizeOf } from './language'
import { parseCommerce, parseStockLines } from './parse'
import { planSoldOut, planStock, sizesOf, type StockPlan } from './plan'
import { loadCatalog, matchProducts, resolveProduct, variantLabel, type CatalogProduct } from './resolve'
import { extractCommerceWithAi } from './ai'

type Keyboard = { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> }
const cb = (ctx: AssistantContext, rest: string) => `cm:${ctx.store.id}:${rest}`
/** Intermediate notice: a delivery failure must not interrupt the operation that follows. */
const notice = (ctx: AssistantContext, text: string) => say(ctx, text).catch(() => undefined)
const cancelRow = (ctx: AssistantContext) => [{ text: '✖ Cancelar', callback_data: cb(ctx, 'cancel') }]

/** True when the message looks like a store operation worth an AI reading (numbers, sizes, prices…). */
function looksCommercial(text: string): boolean {
  return /\d|\btallas?\b|\bprecio|\bstock\b|\bllegar|\bqued|\bagot|\bunidad|\bfoto|\bcolor|\bmil\b|\bk\b/i.test(fold(text))
}

async function remember(ctx: AssistantContext, state: CommerceState | undefined, extra: Record<string, unknown> = {}): Promise<void> {
  await updateSessionState(ctx, { commerce: state, ...extra })
}

/** Entry point from the text handler. Returns false when the message is not a commerce request. */
export async function handleCommerceText(ctx: AssistantContext, text: string): Promise<boolean> {
  // Feature flag: 'false' returns to the previous behaviour (the rest of the assistant keeps working).
  if (ctx.env.TELEGRAM_SMART_INTERPRETER_ENABLED === 'false') return false
  const session = await readSession(ctx.db, ctx.telegramUserId)
  const state = session.state.commerce
  // The product in focus, or the only product of the last list shown (an unequivocal antecedent).
  const focus = session.state.focusSku || (session.state.lastSkus?.length === 1 ? session.state.lastSkus[0] : undefined)
  let intent = parseCommerce(text)
  if (state?.ask && !(intent && intent.kind !== 'stock' && intent.kind !== 'correction')) {
    if (await continueClarification(ctx, state, text, focus)) return true
  }
  if (!intent && ctx.env.GEMINI_API_KEY && looksCommercial(text)) intent = await extractCommerceWithAi(ctx, text)
  if (!intent) return false
  await dispatch(ctx, intent, focus, state)
  return true
}

/** Runs one intent. `forced` is the product already chosen (button or clarification). */
async function dispatch(ctx: AssistantContext, intent: CommerceIntent, focusSku?: string, previous?: CommerceState, forced?: CatalogProduct): Promise<void> {
  if (intent.kind === 'correction') { await applyCorrection(ctx, intent, previous, focusSku); return }
  if (intent.kind === 'create_product') { await startProduct(ctx, intent); return }
  const catalog = forced ? [forced] : await loadCatalog(ctx)
  const filters = intent.kind === 'sold_out' ? { color: intent.color, size: intent.size }
    : intent.kind === 'stock' ? { color: intent.color || commonColor(intent.lines), size: commonSize(intent.lines) }
      : {}
  const resolution = forced ? { kind: 'one' as const, product: forced } : resolveProduct(catalog, 'product' in intent ? intent.product : null, filters, focusSku)
  if (resolution.kind === 'many') {
    await remember(ctx, { intent, ask: 'product', options: resolution.options.map((product) => product.id) })
    const label = 'product' in intent && intent.product ? `«${escapeHtml(intent.product)}»` : 'eso'
    await say(ctx, `Encontré varios productos que coinciden con ${label}. ¿Cuál es?\n${resolution.options.map((product, index) => `${index + 1}. ${escapeHtml(product.name)} · ${escapeHtml(product.sku)} · ${formatMoney(product.price, ctx.store.currency)}`).join('\n')}`, {
      inline_keyboard: [...resolution.options.map((product, index) => [{ text: `${index + 1}. ${product.name}`.slice(0, 60), callback_data: cb(ctx, `pick:${product.id}`) }]), cancelRow(ctx)],
    })
    return
  }
  if (resolution.kind === 'none') {
    if (resolution.reason === 'not_found' && 'product' in intent && intent.product) {
      await remember(ctx, undefined)
      await say(ctx, `No encontré el producto ${escapeHtml(intent.product)} en <b>${escapeHtml(ctx.store.name)}</b>. Revisa el nombre o el código, o escribe “mis productos” para verlos.`)
      return
    }
    await remember(ctx, { intent, ask: 'product_name' })
    await say(ctx, '¿De qué producto se trata? Escríbeme su nombre o código.', { inline_keyboard: [cancelRow(ctx)] })
    return
  }
  const product = resolution.product
  await updateSessionState(ctx, { focusSku: product.sku, lastSkus: [product.sku] })
  await act(ctx, intent, product)
}

function commonSize(lines: StockLine[]): string | null {
  const sizes = [...new Set(lines.map((line) => line.size).filter(Boolean))]
  return sizes.length === 1 && lines.every((line) => line.size) ? sizes[0]! : null
}

function commonColor(lines: StockLine[]): string | null {
  const colors = [...new Set(lines.map((line) => line.color).filter(Boolean))]
  return colors.length === 1 && lines.every((line) => line.color) ? colors[0]! : null
}

async function act(ctx: AssistantContext, intent: CommerceIntent, product: CatalogProduct): Promise<void> {
  switch (intent.kind) {
    case 'stock': await proposeStock(ctx, intent, product, planStock(product, intent)); return
    case 'sold_out': await proposeStock(ctx, intent, product, planSoldOut(product, intent)); return
    case 'price': await proposePrice(ctx, intent, product); return
    case 'stock_query': await showStock(ctx, product); return
    case 'product_link': {
      const base = publicStoreUrl(ctx.env.PUBLIC_STORE_BASE_URL, ctx.store).replace(/\/$/, '')
      await remember(ctx, undefined)
      await say(ctx, `🔗 <b>${escapeHtml(product.name)}</b>\n${escapeHtml(`${base}/producto/${encodeURIComponent(product.sku)}`)}${product.isActive ? '' : '\n⚠️ Está oculto: tus clientes no lo ven hasta que lo vuelvas a activar.'}`, productKeyboard(ctx, product.sku))
      return
    }
    case 'set_active':
      if (product.isActive === intent.active) { await say(ctx, `${escapeHtml(product.name)} ya está ${intent.active ? 'visible' : 'oculto'}.`); return }
      await propose(ctx, intent, product, 'update_product', { sku: product.sku, isActive: intent.active })
      return
    case 'rename': await propose(ctx, intent, product, 'update_product', { sku: product.sku, name: intent.name }); return
    case 'set_description': await propose(ctx, intent, product, 'update_product', { sku: product.sku, description: intent.description }); return
    case 'set_category': await propose(ctx, intent, product, 'move_products_to_category', { skus: [product.sku], categoryName: intent.category }); return
    case 'remove_photo': await choosePhoto(ctx, product); return
    case 'price_clarify': {
      // "precio 180" could be $180 or $180.000: ask, never assume.
      await remember(ctx, { intent, sku: product.sku, ask: 'amount' })
      await say(ctx, `<b>${escapeHtml(product.name)}</b> hoy cuesta ${formatMoney(product.price, ctx.store.currency)}. Escribiste ${intent.amount}: ¿cuánto es?`, {
        inline_keyboard: [
          [{ text: formatMoney(intent.amount, ctx.store.currency), callback_data: cb(ctx, 'amt:1') }, { text: formatMoney(intent.amount * 1000, ctx.store.currency), callback_data: cb(ctx, 'amt:1000') }],
          cancelRow(ctx),
        ],
      })
      return
    }
    default: await say(ctx, 'Eso todavía no lo puedo hacer desde Telegram.', backToMenu())
  }
}

/** Replaces any other pending proposal (never applied) and prepares the new one. */
async function propose(ctx: AssistantContext, intent: CommerceIntent, product: CatalogProduct, action: Parameters<typeof proposeChange>[1], params: Record<string, unknown>, summary?: string): Promise<void> {
  const pending = await getPendingOperation(ctx)
  if (pending && pending.action !== 'create_product') {
    await cancelOperation(ctx, pending.operation_id)
    await notice(ctx, 'Descarté la propuesta anterior sin aplicarla.')
  }
  try {
    await proposeChange(ctx, action, params, summary)
  } finally {
    // Kept even if Telegram fails to deliver the preview, so a later correction still finds it.
    const created = await getPendingOperation(ctx)
    await remember(ctx, created && created.action === action ? { intent, sku: product.sku, operationId: created.operation_id } : undefined)
  }
}

async function proposeStock(ctx: AssistantContext, intent: CommerceIntent, product: CatalogProduct, plan: StockPlan): Promise<void> {
  if (!can(ctx.role, 'inventory.manage')) { await remember(ctx, undefined); await say(ctx, 'Tu rol en esta tienda no permite cambiar el inventario.'); return }
  if (plan.kind === 'error') { await remember(ctx, undefined); await say(ctx, escapeHtml(plan.text)); return }
  if (plan.kind === 'ask') {
    await remember(ctx, { intent, sku: product.sku, ask: plan.ask, ...(plan.missing ? { missing: plan.missing } : {}) })
    const amount = intent.kind === 'stock' ? intent.lines.reduce((sum, line) => sum + line.quantity, 0) : 0
    const keyboard: Keyboard = plan.ask === 'mode'
      ? { inline_keyboard: [[{ text: `➕ Sumar ${amount}`, callback_data: cb(ctx, 'mode:add') }, { text: `🟰 Dejar en ${amount}`, callback_data: cb(ctx, 'mode:set') }], cancelRow(ctx)] }
      : { inline_keyboard: [cancelRow(ctx)] }
    await say(ctx, `<b>${escapeHtml(product.name)}</b>\n${plan.text}`, keyboard)
    return
  }
  if (plan.create.length && !roleAllows(ctx.role, 'admin')) { await remember(ctx, undefined); await say(ctx, 'Crear tallas o colores nuevos necesita un rol de administrador. Pídeselo al propietario.'); return }
  const reason = intent.kind === 'sold_out' ? 'Agotado (indicado por el propietario)'
    : intent.kind === 'stock' && intent.mode === 'add' ? 'Entrada de mercancía'
      : intent.kind === 'stock' && intent.mode === 'remove' ? 'Salida registrada por el propietario' : 'Ajuste de existencias'
  await propose(ctx, intent, product, 'update_variant_stocks', {
    sku: product.sku,
    changes: plan.changes.map((change) => ({ variantId: change.variantId, stock: change.to })),
    create: plan.create, movementKind: plan.movement, movementReason: reason,
  }, plan.create.length ? `Incluye ${plan.create.length} variante(s) nueva(s): revísalas.` : undefined)
}

async function proposePrice(ctx: AssistantContext, intent: Extract<CommerceIntent, { kind: 'price' }>, product: CatalogProduct): Promise<void> {
  const delta = intent.percent ? Math.round(product.price * intent.amount / 100) : intent.amount
  const price = intent.mode === 'set' ? intent.amount : intent.mode === 'increase' ? product.price + delta : product.price - delta
  if (!Number.isSafeInteger(price) || price <= 0) { await remember(ctx, undefined); await say(ctx, `Con ese cambio el precio de ${escapeHtml(product.name)} quedaría en ${formatMoney(price, ctx.store.currency)}. Revisa el valor.`); return }
  if (price === product.price) { await remember(ctx, undefined); await say(ctx, `${escapeHtml(product.name)} ya cuesta ${formatMoney(price, ctx.store.currency)}.`); return }
  const how = intent.mode === 'set' ? undefined : `${intent.mode === 'increase' ? 'Subir' : 'Bajar'} ${intent.percent ? `${intent.amount}%` : formatMoney(intent.amount, ctx.store.currency)} (moneda de la tienda: ${ctx.store.currency}).`
  await propose(ctx, intent, product, 'update_price', { sku: product.sku, price }, how)
}

async function showStock(ctx: AssistantContext, product: CatalogProduct): Promise<void> {
  await remember(ctx, undefined)
  const active = product.variants.filter((variant) => variant.isActive)
  const total = active.reduce((sum, variant) => sum + variant.stock, 0)
  const lines = active.map((variant) => `• ${escapeHtml(variantLabel(variant))}: ${variant.stock} u.${variant.stock === 0 ? ' (agotado)' : ''}`)
  await say(ctx, `📦 <b>${escapeHtml(product.name)}</b> (${escapeHtml(product.sku)})\n${lines.join('\n') || 'Sin variantes activas.'}\nTotal: <b>${total}</b> unidades · Precio: ${formatMoney(product.price, ctx.store.currency)}${product.isActive ? '' : '\n⚠️ Está oculto en la tienda.'}`, productKeyboard(ctx, product.sku))
}

async function choosePhoto(ctx: AssistantContext, product: CatalogProduct): Promise<void> {
  await remember(ctx, undefined)
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol en esta tienda no permite cambiar las fotos.'); return }
  if (!product.imageUrls.length) { await say(ctx, `${escapeHtml(product.name)} no tiene fotos.`); return }
  if (product.imageUrls.length === 1) { await say(ctx, `${escapeHtml(product.name)} tiene una sola foto; si la quito quedaría sin imagen. Envíame la nueva foto con el texto “agrega fotos al ${escapeHtml(product.sku)}” y luego quitamos la anterior.`); return }
  await say(ctx, `${escapeHtml(product.name)} tiene ${product.imageUrls.length} fotos. ¿Cuál quito? (la 1 es la principal; puedes verlas en la tienda)`, {
    inline_keyboard: [
      ...product.imageUrls.slice(0, 10).map((_, index) => [{ text: `🗑 Quitar la foto ${index + 1}${index === 0 ? ' (principal)' : ''}`, callback_data: cb(ctx, `photo:${product.id}:${index}`) }]),
      ...productKeyboard(ctx, product.sku).inline_keyboard.slice(0, 1),
      cancelRow(ctx),
    ],
  })
}

async function startProduct(ctx: AssistantContext, intent: Extract<CommerceIntent, { kind: 'create_product' }>): Promise<void> {
  await remember(ctx, undefined)
  const catalog = await loadCatalog(ctx)
  // Same name, or the same product words with only a colour added ("Sandalias Guess" vs "Sandalias Guess negras").
  const same = catalog.find((product) => fold(product.name) === fold(intent.name)) || matchProducts(catalog, intent.name)[0]
  // A reference that already exists is a restock or a mistake, never a second product with the same code.
  const sameSku = intent.sku ? catalog.find((product) => product.sku.toUpperCase() === intent.sku!.toUpperCase()) : undefined
  const total = intent.stocks.reduce((sum, stock) => sum + stock.quantity, 0)
  const lines = [
    'Voy a preparar este producto:',
    `Nombre: <b>${escapeHtml(intent.name)}</b>`,
    intent.sku ? `Referencia: <b>${escapeHtml(intent.sku)}</b>` : null,
    intent.price ? `Precio: ${formatMoney(intent.price, ctx.store.currency)} (${escapeHtml(ctx.store.currency)}, la moneda configurada de tu tienda)`
      : intent.priceAsk ? `Precio: ⚠️ escribiste ${intent.priceAsk}: te pregunto enseguida si son ${formatMoney(intent.priceAsk, ctx.store.currency)} o ${formatMoney(intent.priceAsk * 1000, ctx.store.currency)}` : 'Precio: pendiente',
    intent.stocks.length
      ? `Inventario${intent.color ? ` (${escapeHtml(intent.color)})` : ''}:\n${intent.stocks.map((stock) => `• Talla ${escapeHtml(stock.size)}: ${stock.quantity} u.`).join('\n')}\nTotal: ${total} u.`
      : intent.sizes.length ? `Variantes: ${escapeHtml(intent.sizes.join(', '))}${intent.color ? ` · ${escapeHtml(intent.color)}` : ''}\nInventario: pendiente de definir` : 'Inventario: pendiente de definir',
    same && !sameSku ? `⚠️ Ya tienes «${escapeHtml(same.name)}» (código ${escapeHtml(same.sku)}). Si es el mismo, cancela y dime cuántas unidades llegaron.` : null,
  ].filter(Boolean)
  if (sameSku) {
    await remember(ctx, { intent, sku: sameSku.sku, ask: 'duplicate_sku' })
    await say(ctx, `${lines.join('\n')}\n\n⚠️ La referencia <b>${escapeHtml(sameSku.sku)}</b> ya existe: <b>${escapeHtml(sameSku.name)}</b>. No creo un producto repetido.${intent.stocks.length ? ' ¿Son unidades que llegaron de ese mismo producto?' : ' Si llegaron unidades, dime cuántas por talla.'}`, {
      inline_keyboard: [...(intent.stocks.length ? [[{ text: `➕ Sumar a ${sameSku.name}`.slice(0, 60), callback_data: cb(ctx, 'restock') }]] : []), cancelRow(ctx)],
    })
    return
  }
  await notice(ctx, lines.join('\n'))
  await beginProductDraft(ctx, {
    name: intent.name, ...(intent.brand ? { brand: intent.brand } : {}), ...(intent.price ? { price: intent.price } : {}),
    ...(intent.sku ? { sku: intent.sku } : {}), ...(intent.color ? { color: intent.color } : {}),
    ...(intent.stocks.length ? { variants: intent.stocks.map((stock) => ({ size: stock.size, stock: stock.quantity, ...(intent.color ? { color: intent.color } : {}) })) }
      : intent.sizes.length ? { sizes: intent.sizes } : {}),
    ...(intent.priceAsk ? { askFirst: 'price' } : !intent.stocks.length && intent.sizes.length ? { askFirst: 'variants' } : {}),
  })
}

/** Answers to the last question: product choice, add/set, missing size or colour. */
async function continueClarification(ctx: AssistantContext, state: CommerceState, text: string, focusSku?: string): Promise<boolean> {
  const lower = fold(text).trim()
  if (/^(?:no|cancela|cancelar|olvidalo|mejor no|nada)\b/.test(lower)) { await remember(ctx, undefined); await say(ctx, 'Listo, no hice nada.', backToMenu()); return true }
  if (state.ask === 'product' && state.options?.length) {
    const ordinal = lower.match(/^(?:el|la|opcion|numero)?\s*(\d{1,2}|primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa])\b/)
    const words: Record<string, number> = { primero: 1, primera: 1, primer: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3, tercer: 3, cuarto: 4, cuarta: 4 }
    const index = ordinal ? (Number(ordinal[1]) || words[ordinal[1]!] || 0) - 1 : -1
    const catalog = await loadCatalog(ctx)
    const options = catalog.filter((product) => state.options!.includes(product.id))
    const chosen = index >= 0 ? options.find((product) => product.id === state.options![index]) : resolveProduct(options, text, {}).kind === 'one' ? (resolveProduct(options, text, {}) as { product: CatalogProduct }).product : undefined
    if (!chosen) return false
    await updateSessionState(ctx, { focusSku: chosen.sku, lastSkus: [chosen.sku] })
    await act(ctx, state.intent, chosen)
    return true
  }
  if (state.ask === 'amount' && state.intent.kind === 'price_clarify') {
    const catalog = await loadCatalog(ctx)
    const product = state.sku ? catalog.find((item) => item.sku === state.sku) : undefined
    const amount = parseMoney(text) ?? (/^\$?\s*\d{1,3}$/.test(text.trim()) || /^\d{1,3}\s*pesos$/.test(lower) ? Number(text.replace(/\D/g, '')) : null)
    if (!product || !amount) return false
    await act(ctx, { kind: 'price', mode: state.intent.mode, amount, percent: false, product: null }, product)
    return true
  }
  if (state.ask === 'product_name') {
    if (parseCommerce(text)) return false
    await dispatch(ctx, { ...state.intent, product: text.slice(0, 80) } as CommerceIntent, focusSku)
    return true
  }
  const product = state.sku ? (await loadCatalog(ctx)).find((item) => item.sku === state.sku) : undefined
  if (!product || state.intent.kind !== 'stock' && state.intent.kind !== 'sold_out') return false
  if (state.ask === 'mode' && state.intent.kind === 'stock') {
    const mode = /\b(?:sum|agreg|anad|mas|adicion)\w*/.test(lower) ? 'add' : /\b(?:dej|total|final|qued|exist|reemplaz|fij)\w*/.test(lower) ? 'set' : null
    if (!mode) return false
    await act(ctx, { ...state.intent, mode }, product)
    return true
  }
  if (state.ask === 'color') {
    const color = colorOf(lower.split(/\s+/).find((word) => colorOf(word)) || '')
    if (!color) return false
    const intent = state.intent.kind === 'stock'
      ? { ...state.intent, lines: state.intent.lines.map((line) => ({ ...line, color: line.color || color })), color: state.intent.color || color }
      : { ...state.intent, color }
    await act(ctx, intent, product)
    return true
  }
  if (state.ask === 'distribution' && state.intent.kind === 'stock') {
    const parsed = parseStockLines(text)
    let added: StockLine[] = parsed.lines
    if (!added.length) {
      const size = parsed.sizes[0] || lower.split(/\s+/).map((word) => sizeOf(word)).find(Boolean) || null
      if (!size) return false
      added = [{ quantity: state.missing ?? parsed.bare[0]?.quantity ?? 0, size, color: null }]
      if (!added[0]!.quantity) return false
    }
    const known = state.intent.lines.filter((line) => line.size || line.color)
    const intent = { ...state.intent, lines: [...known, ...added] }
    await act(ctx, intent, product)
    return true
  }
  return false
}

/** "Las M son 5, no 3" / "la talla es 39, no 38": fixes the pending proposal or the open question. */
async function applyCorrection(ctx: AssistantContext, correction: Extract<CommerceIntent, { kind: 'correction' }>, state: CommerceState | undefined, focusSku?: string): Promise<void> {
  const pending = state?.operationId ? await getPendingOperation(ctx, state.operationId) : null
  if (!state || (!pending && !state.ask)) {
    await say(ctx, 'No tengo un cambio pendiente para corregir. Si ya se aplicó, dime cómo debe quedar; por ejemplo: “quedan 5 de la talla M”.')
    return
  }
  const fixed = correctIntent(state.intent, correction)
  if (!fixed) {
    await say(ctx, 'No encontré ese dato en la propuesta. Dímelo de nuevo, por ejemplo: “las M son 5, no 3”.')
    return
  }
  if (pending) await cancelOperation(ctx, pending.operation_id)
  await notice(ctx, 'Entendido, corrijo la propuesta. Nada se aplicó todavía.')
  const product = state.sku ? (await loadCatalog(ctx)).find((item) => item.sku === state.sku) : undefined
  if (product) await act(ctx, fixed, product)
  else await dispatch(ctx, fixed, focusSku)
}

function correctIntent(intent: CommerceIntent, correction: Extract<CommerceIntent, { kind: 'correction' }>): CommerceIntent | null {
  if (correction.field === 'price') {
    const amount = Number(correction.to)
    return intent.kind === 'price' && amount > 0 ? { ...intent, mode: 'set', amount, percent: false } : null
  }
  if (intent.kind === 'sold_out') {
    if (correction.field === 'color') return { ...intent, color: correction.to }
    if (correction.field === 'size') return { ...intent, size: correction.to }
    return null
  }
  if (intent.kind !== 'stock') return null
  let touched = false
  const lines = intent.lines.map((line) => {
    if (correction.field === 'quantity') {
      const matches = (!correction.size || sameSize(line.size, correction.size)) && (!correction.color || sameColor(line.color, correction.color))
        && (correction.from === null || line.quantity === quantityOf(correction.from))
      // Without a size or colour the correction is only unambiguous when the proposal has a single line.
      if (matches && (correction.size || correction.color || intent.lines.length === 1)) { touched = true; return { ...line, quantity: Number(correction.to) } }
    }
    if (correction.field === 'size' && (correction.from ? sameSize(line.size, correction.from) : !line.size)) { touched = true; return { ...line, size: correction.to } }
    if (correction.field === 'color' && (correction.from ? sameColor(line.color, correction.from) : !line.color)) { touched = true; return { ...line, color: correction.to } }
    return line
  })
  if (!touched && correction.field === 'color' && sameColor(intent.color, correction.from)) return { ...intent, color: correction.to, lines: lines.map((line) => ({ ...line, color: sameColor(line.color, correction.from) ? correction.to : line.color })) }
  if (!touched) return null
  // A corrected distribution no longer has to add up to the first total the owner mentioned.
  return { ...intent, lines, total: correction.field === 'quantity' ? null : intent.total }
}

/** Buttons of the commerce conversation: cm:<store>:<verb>[:…]. */
export async function handleCommerceCallback(ctx: AssistantContext, data: string): Promise<boolean> {
  const match = data.match(/^cm:(\d+):(pick|mode|photo|cancel|switch|amt|restock)(?::([a-z0-9]+))?(?::(\d+))?$/)
  if (!match) return false
  if (Number(match[1]) !== ctx.store.id) {
    await say(ctx, `Ese botón pertenece a otra tienda y no lo apliqué. Ahora estás administrando <b>${escapeHtml(ctx.store.name)}</b>.`)
    return true
  }
  const session = await readSession(ctx.db, ctx.telegramUserId)
  const state = session.state.commerce
  const verb = match[2]!
  if (verb === 'cancel') { await remember(ctx, undefined); await say(ctx, 'Listo, no hice nada.', backToMenu()); return true }
  if (verb === 'switch') return false // handled by the text router (deferred request)
  const catalog = await loadCatalog(ctx)
  if (verb === 'pick') {
    const product = catalog.find((item) => item.id === Number(match[3]))
    if (!product || !state || !state.options?.includes(product.id)) { await say(ctx, 'Esa opción ya no está disponible. Pídemelo de nuevo.'); return true }
    await updateSessionState(ctx, { focusSku: product.sku, lastSkus: [product.sku] })
    await act(ctx, state.intent, product)
    return true
  }
  if (verb === 'mode') {
    const product = state?.sku ? catalog.find((item) => item.sku === state.sku) : undefined
    if (!product || state?.intent.kind !== 'stock') { await say(ctx, 'Esa pregunta ya venció. Pídemelo de nuevo.'); return true }
    await act(ctx, { ...state.intent, mode: match[3] === 'set' ? 'set' : 'add' }, product)
    return true
  }
  if (verb === 'amt') {
    const product = state?.sku ? catalog.find((item) => item.sku === state.sku) : undefined
    if (!product || state?.intent.kind !== 'price_clarify' || !['1', '1000'].includes(match[3] || '')) { await say(ctx, 'Esa pregunta ya venció. Pídemelo de nuevo.'); return true }
    await act(ctx, { kind: 'price', mode: state.intent.mode, amount: state.intent.amount * Number(match[3]), percent: false, product: null }, product)
    return true
  }
  if (verb === 'restock') {
    const product = state?.sku ? catalog.find((item) => item.sku === state.sku) : undefined
    if (!product || state?.intent.kind !== 'create_product' || state.ask !== 'duplicate_sku' || !state.intent.stocks.length) { await say(ctx, 'Esa pregunta ya venció. Pídemelo de nuevo.'); return true }
    const color = state.intent.color
    await act(ctx, { kind: 'stock', mode: 'add', product: product.name, total: null, color, size: null, lines: state.intent.stocks.map((stock) => ({ quantity: stock.quantity, size: stock.size, color })) }, product)
    return true
  }
  if (verb === 'photo') {
    const product = catalog.find((item) => item.id === Number(match[3]))
    const index = Number(match[4])
    if (!product || !Number.isInteger(index) || index >= product.imageUrls.length) { await say(ctx, 'Esa foto ya no está. Pídemelo de nuevo.'); return true }
    await propose(ctx, { kind: 'remove_photo', product: product.sku }, product, 'update_product_images', { sku: product.sku, imageUrls: product.imageUrls.filter((_, position) => position !== index) })
    return true
  }
  return false
}

/** Whether a message is a new, different request (used to offer leaving an open product draft). */
export function isNewCommerceRequest(text: string): boolean {
  const intent = parseCommerce(text)
  return Boolean(intent && intent.kind !== 'correction')
}

/** /resumen: a short, real snapshot of the store (no estimates). */
export async function storeSummary(ctx: AssistantContext): Promise<void> {
  const row = await ctx.db.prepare(
    `SELECT (SELECT COUNT(*) FROM products WHERE store_id = ?1 AND is_archived = 0 AND is_active = 1) AS products,
            (SELECT COUNT(*) FROM products p WHERE p.store_id = ?1 AND p.is_archived = 0 AND p.is_active = 1
               AND COALESCE((SELECT SUM(v.stock) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1), 0) = 0) AS outOfStock,
            (SELECT COUNT(*) FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.store_id = ?1 AND p.is_archived = 0 AND v.is_active = 1 AND v.stock BETWEEN 1 AND 3) AS lowStock,
            (SELECT COUNT(*) FROM orders WHERE store_id = ?1 AND status = 'pendiente') AS pending,
            (SELECT COUNT(*) FROM orders WHERE store_id = ?1 AND created_at >= datetime('now', '-7 days')) AS orders7,
            (SELECT COALESCE(SUM(total), 0) FROM orders WHERE store_id = ?1 AND status IN ('confirmado', 'preparando', 'enviado', 'entregado') AND created_at >= datetime('now', '-7 days')) AS confirmed7`,
  ).bind(ctx.store.id).first<{ products: number; outOfStock: number; lowStock: number; pending: number; orders7: number; confirmed7: number }>()
  const r = row || { products: 0, outOfStock: 0, lowStock: 0, pending: 0, orders7: 0, confirmed7: 0 }
  await say(ctx, [
    `📊 <b>Resumen de ${escapeHtml(ctx.store.name)}</b>`,
    `• Productos visibles: ${r.products}${r.outOfStock ? ` (${r.outOfStock} agotados)` : ''}`,
    `• Variantes con 3 unidades o menos: ${r.lowStock}`,
    `• Pedidos pendientes por atender: ${r.pending}`,
    `• Pedidos de los últimos 7 días: ${r.orders7} · confirmados por ${formatMoney(Number(r.confirmed7), ctx.store.currency)}`,
    '',
    'Pídeme el detalle con tus palabras, por ejemplo “pedidos pendientes” o “productos con poco stock”.',
  ].join('\n'), {
    inline_keyboard: [
      [{ text: '⏳ Pedidos pendientes', callback_data: 'm:orders_pending' }, { text: '⚠️ Poco stock', callback_data: 'm:low_stock' }],
      [{ text: '🚫 Agotados', callback_data: 'm:out_of_stock' }, { text: '↩ Menú principal', callback_data: 'm:menu' }],
    ],
  })
}

export { sizesOf }
