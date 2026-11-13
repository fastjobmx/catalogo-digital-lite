/** Conversational layer: the tool registry. Every tool wraps something the assistant already does (catalogue
 * reader, product resolver, commerce engine, confirmation flow); nothing is reimplemented and no tool writes to
 * the database by itself. Reads answer at once; modifications become a validated commerce intent that goes
 * through the existing preview → confirm → atomic apply → audit path. */
import { can, roleAllows } from '../../../tenancy/access'
import { escapeHtml, formatMoney } from '../tools'
import type { AssistantContext } from '../context'
import { commerceIntentSchema, type CommerceIntent } from '../commerce/intent'
import { colorOf, parseMoney, sizeOf } from '../commerce/language'
import { matchProducts, variantLabel, type CatalogProduct } from '../commerce/resolve'
import { formatOperationPreview, parseVariants, type PendingOperation } from '../operations'
import type { Step, ToolName } from './planner'

export type ToolSpec = {
  name: ToolName
  description: string
  kind: 'read' | 'write' | 'control'
  /** Modifications never apply without the merchant's confirmation. */
  confirm: boolean
  /** Checked here and again by the engine when the change is proposed and when it is confirmed. */
  allowed: (ctx: AssistantContext) => boolean
  /** What the audit trail records when the tool ends in a change (written by the existing apply functions). */
  audit: string | null
}

const anyMember = () => true
const inventory = (ctx: AssistantContext) => can(ctx.role, 'inventory.manage')
const admin = (ctx: AssistantContext) => roleAllows(ctx.role, 'admin')

export const TOOLS: Record<ToolName, ToolSpec> = {
  ver_producto: { name: 'ver_producto', description: 'Existencias por talla y color, precio y visibilidad de un producto de esta tienda.', kind: 'read', confirm: false, allowed: anyMember, audit: null },
  buscar_productos: { name: 'buscar_productos', description: 'Lista de productos de esta tienda por palabras, color, talla o estado (agotados, pocas unidades, ocultos).', kind: 'read', confirm: false, allowed: anyMember, audit: null },
  resumen_tienda: { name: 'resumen_tienda', description: 'Pedidos recibidos ayer, pedidos pendientes y productos con pocas unidades o agotados.', kind: 'read', confirm: false, allowed: anyMember, audit: null },
  cambios_recientes: { name: 'cambios_recientes', description: 'Últimos movimientos de inventario de la tienda o de un producto.', kind: 'read', confirm: false, allowed: anyMember, audit: null },
  ajustar_inventario: { name: 'ajustar_inventario', description: 'Sumar, restar o fijar existencias por talla y color.', kind: 'write', confirm: true, allowed: inventory, audit: 'update_variant_stocks + inventory_movements' },
  marcar_agotado: { name: 'marcar_agotado', description: 'Dejar en cero un producto, una talla o un color.', kind: 'write', confirm: true, allowed: inventory, audit: 'update_variant_stocks + inventory_movements' },
  cambiar_precio: { name: 'cambiar_precio', description: 'Fijar, subir o bajar el precio de un producto (valor o porcentaje).', kind: 'write', confirm: true, allowed: admin, audit: 'update_price' },
  preparar_producto: { name: 'preparar_producto', description: 'Preparar el borrador de un producto nuevo; se publica solo al guardarlo.', kind: 'write', confirm: true, allowed: admin, audit: 'create_product' },
  mostrar_ocultar: { name: 'mostrar_ocultar', description: 'Mostrar u ocultar un producto en la tienda.', kind: 'write', confirm: true, allowed: admin, audit: 'update_product' },
  corregir: { name: 'corregir', description: 'Corregir el cambio que espera confirmación.', kind: 'control', confirm: true, allowed: anyMember, audit: null },
  confirmar: { name: 'confirmar', description: 'Aplicar el cambio que espera confirmación.', kind: 'control', confirm: false, allowed: anyMember, audit: null },
  cancelar: { name: 'cancelar', description: 'Descartar el cambio que espera confirmación.', kind: 'control', confirm: false, allowed: anyMember, audit: null },
  reiniciar: { name: 'reiniciar', description: 'Olvidar el contexto de la conversación y descartar lo pendiente.', kind: 'control', confirm: false, allowed: anyMember, audit: null },
  deshacer: { name: 'deshacer', description: 'Preparar la reversión del último cambio aplicado en los últimos minutos.', kind: 'control', confirm: true, allowed: anyMember, audit: null },
  aclarar: { name: 'aclarar', description: 'Una pregunta corta por un dato indispensable.', kind: 'control', confirm: false, allowed: anyMember, audit: null },
  conversar: { name: 'conversar', description: 'Saludo o charla breve sin datos de la tienda.', kind: 'control', confirm: false, allowed: anyMember, audit: null },
  otro_tema: { name: 'otro_tema', description: 'Fuera de catálogo e inventario: lo atiende el asistente de siempre.', kind: 'control', confirm: false, allowed: anyMember, audit: null },
}

export const DENIED: Record<'write', string> = { write: 'Tu rol en esta tienda no permite hacer ese cambio. Pídeselo al propietario.' }

// ───────────────────────── Paso del modelo → intención validada ─────────────────────────

const size = (value: string | null) => (value ? sizeOf(value) || value.toUpperCase().slice(0, 12) : null)
const color = (value: string | null) => (value ? colorOf(value) || value.slice(0, 30) : null)

/**
 * Converts a model step into the same validated intent the deterministic parser produces. The model's amounts
 * are checked against the deterministic money parser, which wins when the model dropped a «mil».
 */
export function intentFromStep(step: Step, message: string): CommerceIntent | null {
  let raw: unknown = null
  if (step.tool === 'ajustar_inventario') {
    const lines = step.lineas.length ? step.lineas.map((line) => ({ quantity: line.cantidad, size: size(line.talla), color: color(line.color) }))
      : step.cantidad !== null ? [{ quantity: step.cantidad, size: size(step.talla), color: color(step.color) }] : []
    if (!lines.length) return null
    const mode = step.modo === 'sumar' ? 'add' : step.modo === 'dejar' ? 'set' : step.modo === 'restar' ? 'remove' : 'ask'
    raw = { kind: 'stock', mode, product: step.producto, total: null, lines, color: null, size: null, ...(step.cada_talla ? { each: true } : {}) }
  } else if (step.tool === 'marcar_agotado') {
    raw = { kind: 'sold_out', product: step.producto, color: color(step.color), size: size(step.talla) }
  } else if (step.tool === 'cambiar_precio') {
    if (step.monto === null) return null
    const mode = step.modo === 'subir' ? 'increase' : step.modo === 'bajar' ? 'decrease' : 'set'
    let amount = step.monto
    const exact = step.porcentaje ? null : parseMoney(message)
    if (exact && (exact === amount * 1000 || exact * 1000 === amount)) amount = exact
    // A bare small amount («precio 180») is asked, never assumed.
    raw = !step.porcentaje && amount < 1000
      ? { kind: 'price_clarify', mode, amount, product: step.producto }
      : { kind: 'price', mode, amount, percent: step.porcentaje, product: step.producto }
  } else if (step.tool === 'preparar_producto') {
    const name = step.nombre || step.producto
    if (!name) return null
    const stocks = step.lineas.filter((line) => line.talla).map((line) => ({ size: size(line.talla)!, quantity: line.cantidad }))
    const sizes = [...new Set([...step.tallas.map((value) => size(value)!), ...stocks.map((line) => line.size)])]
    const price = step.monto !== null && step.monto >= 1000 ? step.monto : null
    raw = { kind: 'create_product', name, brand: null, color: color(step.color), sizes, price, sku: step.referencia ? step.referencia.toUpperCase() : null, stocks, priceAsk: step.monto !== null && step.monto < 1000 ? step.monto : null, skuAsk: null }
  } else if (step.tool === 'mostrar_ocultar') {
    if (step.visible === null) return null
    raw = { kind: 'set_active', active: step.visible, product: step.producto }
  }
  const parsed = commerceIntentSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** The tool a deterministic intent corresponds to (for permissions, metrics and the test bank). */
export function toolOfIntent(intent: CommerceIntent): ToolName {
  switch (intent.kind) {
    case 'stock': return 'ajustar_inventario'
    case 'sold_out': return 'marcar_agotado'
    case 'price': case 'price_clarify': return 'cambiar_precio'
    case 'create_product': return 'preparar_producto'
    case 'set_active': return 'mostrar_ocultar'
    case 'stock_query': return 'ver_producto'
    case 'correction': return 'corregir'
    default: return 'otro_tema'
  }
}

// ───────────────────────── Lecturas: textos cortos para el celular ─────────────────────────

const totalOf = (product: CatalogProduct) => product.variants.filter((variant) => variant.isActive).reduce((sum, variant) => sum + variant.stock, 0)
const units = (count: number) => (count === 1 ? '1 unidad' : `${count} unidades`)

/** One product: price, units per size (grouped by colour when there are several) and what is sold out. */
export function renderProduct(product: CatalogProduct, currency: string): string {
  const active = product.variants.filter((variant) => variant.isActive)
  const colors = [...new Set(active.map((variant) => (variant.color && variant.color !== 'Único' ? variant.color : '')))]
  const cell = (variant: CatalogProduct['variants'][number]) => `${escapeHtml(variant.size && variant.size !== 'Única' ? variant.size : 'única')}: ${variant.stock === 0 ? 'agotada' : variant.stock}`
  const rows = colors.length > 1
    ? colors.map((name) => `${escapeHtml(name || 'Sin color')} — ${active.filter((variant) => (variant.color && variant.color !== 'Único' ? variant.color : '') === name).map(cell).join(' · ')}`)
    : [active.map(cell).join(' · ')]
  const total = totalOf(product)
  return [
    `<b>${escapeHtml(product.name)}</b> · ${formatMoney(product.price, currency)}`,
    active.length ? rows.join('\n') : 'Sin tallas activas.',
    active.length > 1 ? `Total: ${units(total)}` : '',
    product.isActive ? '' : 'Está oculto en la tienda.',
  ].filter(Boolean).join('\n')
}

export type ListFilter = 'todos' | 'agotados' | 'pocas_unidades' | 'ocultos'
export const LOW_STOCK = 3
export const LIST_LIMIT = 5

/** Products that match words, colour, size and state. Read from the catalogue of this store only. */
export function filterCatalog(catalog: CatalogProduct[], input: { query: string | null; filter: ListFilter | null; color: string | null; size: string | null }): CatalogProduct[] {
  const filters = { color: color(input.color), size: size(input.size) }
  let found = input.query || filters.color || filters.size ? matchProducts(catalog, input.query, filters) : [...catalog]
  if (input.filter === 'ocultos') found = found.filter((product) => !product.isActive)
  else found = found.filter((product) => product.isActive)
  if (input.filter === 'agotados') found = found.filter((product) => totalOf(product) === 0)
  if (input.filter === 'pocas_unidades') found = found.filter((product) => totalOf(product) > 0 && totalOf(product) <= LOW_STOCK)
  if (input.filter === 'agotados' || input.filter === 'pocas_unidades') found.sort((a, b) => totalOf(a) - totalOf(b))
  return found
}

export function renderList(found: CatalogProduct[], input: { query: string | null; filter: ListFilter | null }, currency: string): string {
  const what = input.filter === 'agotados' ? 'agotados' : input.filter === 'pocas_unidades' ? `con ${LOW_STOCK} unidades o menos` : input.filter === 'ocultos' ? 'ocultos' : ''
  const about = input.query ? ` de «${escapeHtml(input.query)}»` : ''
  if (!found.length) {
    if (input.filter === 'agotados') return `No tienes productos agotados${about}.`
    if (input.filter === 'pocas_unidades') return `Ningún producto${about} tiene ${LOW_STOCK} unidades o menos.`
    if (input.filter === 'ocultos') return `No tienes productos ocultos${about}.`
    return input.query ? `No encontré productos${about}. Revisa el nombre o dime el código.` : 'Todavía no tienes productos visibles.'
  }
  const lines = found.slice(0, LIST_LIMIT).map((product, index) => `${index + 1}) ${escapeHtml(product.name)} · ${formatMoney(product.price, currency)} · ${totalOf(product) === 0 ? 'agotado' : units(totalOf(product))}`)
  const more = found.length > LIST_LIMIT ? `\n…y ${found.length - LIST_LIMIT} más. Dime un nombre para afinar.` : ''
  return `${found.length === 1 ? 'Hay 1 producto' : `Hay ${found.length} productos`}${what ? ` ${what}` : ''}${about}:\n${lines.join('\n')}${more}`
}

/** Up to three candidates, numbered, so the merchant can answer «la 2». */
export function renderChoice(options: CatalogProduct[], currency: string): string {
  const shown = options.slice(0, 3)
  const head = options.length > 3 ? `Hay ${options.length} que coinciden; estos son los más cercanos` : shown.length === 2 ? 'Tengo dos' : 'Tengo tres'
  return `${head}:\n${shown.map((product, index) => `${index + 1}) ${escapeHtml(product.name)} · ${formatMoney(product.price, currency)}`).join('\n')}\n¿Cuál?`
}

/** Real figures for the greeting. Orders are «received», never sales or payments. */
export async function storeSnapshot(ctx: AssistantContext, catalog: CatalogProduct[]): Promise<{ yesterday: number; pending: number; low: number; out: number }> {
  // Yesterday in Bogotá (UTC-5 all year), compared against timestamps stored in UTC.
  const row = await ctx.db.prepare(
    `SELECT (SELECT COUNT(*) FROM orders WHERE store_id = ?1 AND created_at >= datetime('now', '-5 hours', 'start of day', '-1 day', '+5 hours')
               AND created_at < datetime('now', '-5 hours', 'start of day', '+5 hours')) AS yesterday,
            (SELECT COUNT(*) FROM orders WHERE store_id = ?1 AND status = 'pendiente') AS pending`,
  ).bind(ctx.store.id).first<{ yesterday: number; pending: number }>()
  const visible = catalog.filter((product) => product.isActive)
  return {
    yesterday: Number(row?.yesterday || 0), pending: Number(row?.pending || 0),
    low: visible.filter((product) => totalOf(product) > 0 && totalOf(product) <= LOW_STOCK).length,
    out: visible.filter((product) => totalOf(product) === 0).length,
  }
}

export function renderSnapshot(greeting: string, snapshot: { yesterday: number; pending: number; low: number; out: number }): string {
  const plural = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`)
  const parts = [
    snapshot.yesterday ? `ayer ${snapshot.yesterday === 1 ? 'entró 1 pedido' : `entraron ${snapshot.yesterday} pedidos`}` : 'ayer no entraron pedidos',
    snapshot.pending ? `${snapshot.pending === 1 ? 'sigue 1 pendiente' : `siguen ${snapshot.pending} pendientes`} por atender` : 'no hay pedidos pendientes',
    snapshot.low || snapshot.out
      ? [snapshot.low ? `${plural(snapshot.low, 'producto tiene', 'productos tienen')} pocas unidades` : '', snapshot.out ? `${plural(snapshot.out, 'está agotado', 'están agotados')}` : ''].filter(Boolean).join(' y ')
      : 'el inventario está al día',
  ]
  const stock = [snapshot.low ? `${plural(snapshot.low, 'producto tiene', 'productos tienen')} pocas unidades` : '', snapshot.out ? plural(snapshot.out, 'está agotado', 'están agotados') : ''].filter(Boolean)
  const all = [parts[0]!, parts[1]!, ...(stock.length ? stock : [parts[2]!])]
  const sentence = `${all.slice(0, -1).join(', ')} y ${all.at(-1)}.`
  const next = snapshot.pending || snapshot.low || snapshot.out ? ' ¿Qué miramos primero?' : ' ¿En qué te ayudo?'
  return `${greeting} ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}${next}`
}

// ───────────────────────── Modificaciones: una línea con el efecto concreto ─────────────────────────

/** The pending change in one line (before → after), from the snapshot the engine stored and validated. */
export function shortPreview(operation: Pick<PendingOperation, 'action' | 'before_json' | 'after_json' | 'params_json'>, currency: string): string {
  let before: Record<string, any>, after: Record<string, any>, params: Record<string, any>
  try { before = JSON.parse(operation.before_json); after = JSON.parse(operation.after_json); params = JSON.parse(operation.params_json) }
  catch { return formatOperationPreview(operation, currency) }
  const name = `<b>${escapeHtml(before.name)}</b>`
  if (operation.action === 'update_price') {
    const delta = Number(after.price) - Number(before.price)
    return `${delta < 0 ? 'Bajo' : 'Subo'} el precio de ${name}: ${formatMoney(before.price, currency)} → <b>${formatMoney(after.price, currency)}</b>`
  }
  if (operation.action === 'update_variant_stocks') {
    const old = parseVariants(before.variants)
    // The colour is said only when the product has more than one.
    const oneColor = new Set(old.map((variant) => variant.color || '')).size <= 1
    const changes = (params.changes as Array<{ variantId: number; stock: number }>).map((change) => {
      const variant = old.find((item) => item.id === change.variantId)
      return { label: variant ? variantLabel({ size: variant.size, color: oneColor ? null : variant.color ?? null, sku: variant.sku }) : 'única', from: variant?.stock ?? 0, to: change.stock }
    })
    const created = params.create as Array<{ size: string; color: string; stock: number }>
    if (changes.length === 1 && !created.length) {
      const [change] = changes as [typeof changes[number]]
      const where = change.label === 'única' ? name : `${change.label.startsWith('talla') ? 'la ' : ''}${escapeHtml(change.label)} de ${name}`
      const delta = change.to - change.from
      if (change.to === 0) return `Dejo en 0 ${where} (hoy hay ${change.from})`
      if (delta > 0) return `Sumo ${delta} a ${where} (de ${change.from} pasarían a ${change.to})`
      return `Resto ${-delta} a ${where} (de ${change.from} quedarían ${change.to})`
    }
    const lines = [
      ...changes.map((change) => `• ${escapeHtml(change.label)}: ${change.from} → <b>${change.to}</b>`),
      ...created.map((item) => `• ${escapeHtml(variantLabel({ size: item.size, color: item.color, sku: '' }))}: nueva, con ${item.stock}`),
    ]
    return `Inventario de ${name}:\n${lines.join('\n')}`
  }
  if (operation.action === 'update_product' && 'isActive' in params && Object.keys(params).length === 2) {
    return `${after.is_active ? 'Muestro' : 'Oculto'} ${name} en la tienda`
  }
  return formatOperationPreview(operation, currency)
}

/** A confirmation question that reads naturally after a one-line or a multi-line preview. */
export function askConfirmation(preview: string): string {
  return preview.includes('\n') ? `${preview}\n¿Confirmas?` : `${preview}. ¿Confirmas?`
}
