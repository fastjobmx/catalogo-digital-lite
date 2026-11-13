/** Asistente TiendIA — capa conversacional (paso 1: catálogo e inventario).
 *
 * Sits on top of the existing engine and never replaces it:
 *   · understanding: the deterministic parser first (exact for prices, sizes and quantities); the model only when
 *     the message is free-form or carries several tasks, and only to choose tools;
 *   · execution: reads come from the catalogue of the active store; every modification is a validated commerce
 *     intent handed to the existing engine (preview → confirm → atomic apply → audit);
 *   · safety net: any failure, timeout or out-of-scope request returns the message to the previous engine.
 *
 * Off unless the store is listed in ASSISTANT_AGENT_STORE_IDS. */
import { estimateCostMicros } from '../../../ai/usage'
import { withAiBudget } from '../ai'
import { cancelOperation, confirmOperation, CORRECTABLE_ACTIONS, getPendingOperation, type PendingOperation } from '../operations'
import { conversationContext, readSession, rememberTurn, say, showTyping, updateSessionState, type AgentState, type AssistantContext } from '../context'
import { operationKeyboard } from '../menus'
import { detectIntent } from '../intents'
import { formatMoney } from '../tools'
import { showStockMovements } from '../inventory'
import { handleCommerceText, runCommerceIntent } from '../commerce/engine'
import type { CommerceIntent } from '../commerce/intent'
import { fold } from '../commerce/language'
import { parseCommerce } from '../commerce/parse'
import { loadCatalog, matchProducts, resolveProduct, variantLabel, type CatalogProduct } from '../commerce/resolve'
import { parseVariants } from '../operations'
import { makeStep, planTurn, type Step, type ToolName } from './planner'
import { askConfirmation, DENIED, filterCatalog, intentFromStep, LIST_LIMIT, renderChoice, renderList, renderProduct, renderSnapshot, shortPreview, storeSnapshot, toolOfIntent, TOOLS } from './tools'

export type AgentResult = 'handled' | 'fallback' | 'other'
type WriteResult = AgentResult | 'retry'

export function agentEnabled(ctx: Pick<AssistantContext, 'env' | 'store'>): boolean {
  const raw = String(ctx.env.ASSISTANT_AGENT_STORE_IDS || '').trim()
  if (!raw) return false
  return raw === '*' || raw.split(',').map((value) => Number(value.trim())).includes(ctx.store.id)
}

const YES = /^(?:(?:ahora s[ií]|bueno|listo|ok|s[ií]|claro)[, ]+)*(?:s[ií]+|sip|sisas|claro(?: que s[ií])?|dale|listo|h[aá]gale|h[aá]galo|hazlo|de una|ok(?:ay)?|confirm[oa]r?|conf[ií]rm[ae]l[oa]s?|correcto|as[ií] es|perfecto|apruebo|aprobado|de acuerdo|todo bien|vale|va)(?:\s+(?:pues|dale|por favor|porfa|confirmo|claro|se[ñn]or[a]?|todos?|todo))*[.! ]*$/i
const NO = /^(?:no+|nop|nel)(?:[,.]?\s+(?:gracias|cancela(?:lo|la)?|mejor no|d[eé]jalo(?: as[ií])?|as[ií] no|ya no))?[.! ]*$|^(?:cancel[ao]r?|canc[eé]l[ae]l[oa]s?|mejor no|olv[ií]dalo|d[eé]jalo(?: as[ií])?|ya no)[.! ]*$/i
const WAIT = /^(?:espera|esp[eé]rame?|esp[eé]rate|un momento|momento|aguanta|todav[ií]a no)\b/i
const KEEP = /^(?:s[ií]guela|sigue(?:la)?|contin[uú]a(?:la)?|term[ií]nala|la sigo|seguir|conf[ií]rmala)\b/i
const RESET = /^(?:olvida (?:eso|todo|lo anterior)|olv[ií]dalo todo|empecemos de nuevo|empezar de nuevo|empecemos de cero|borr[oó]n y cuenta nueva|reinicia(?:r)?(?: la conversaci[oó]n)?)[.! ]*$/i
const UNDO = /^(?:deshaz(?:lo|la)?|deshacer|revierte(?:lo)?|reversa|devuelve (?:eso|el cambio|ese cambio)|me equivoqu[eé],? (?:deshaz|devuelve))\b/i
const BATCH_TTL_MS = 15 * 60 * 1000
const UNDO_WINDOW = '-10 minutes'

/** Two or more requests in one message: the deterministic parser reads only one, so the model takes it. */
export function looksMulti(text: string): boolean {
  const lower = fold(text)
  return /[,;.]\s*(?:y\s+)?(?:tambien|ademas|de paso|luego)\b/.test(lower)
    || /\by\s+(?:tambien|ademas|de paso|cuant[oa]s?|que\s+(?:tallas|precio)|sub[ei]|baj[ae]|pon(?:le|me)?|agreg[ae]|cambi[ae]|muestr[ae]|dime|quit[ae]|dej[ae]|ocult[ae]|marc[ae]|sum[ae]|rest[ae]|anad[ae]|met[ae]|sac[ae]|descuent[ae]|actualiz[ae])/.test(lower)
    || (lower.match(/\?/g) || []).length > 1
}

/** «mejor…», «ahora…», «oye…»: discourse markers the deterministic parser would take for a product name. */
function withoutLead(text: string): string {
  return text.replace(/^(?:(?:mejor|m[aá]s bien|ahora(?: s[ií])?|entonces|oye|ey|ve|bueno|pues|listo|ah|y|porfa|por favor)[, ]+)+/i, '').trim() || text
}

type Captured = NonNullable<AssistantContext['capture']>
/** A step written by the rules (same validated shape the model returns). */
const step = makeStep
type Turn = { started: number; path: 'rule' | 'parser' | 'model' | 'fallback'; tools: ToolName[]; usage?: { promptTokens: number; outputTokens: number }; outcome: string }

function quiet(ctx: AssistantContext, updateOffset = 0): AssistantContext & { capture: Captured } {
  // A distinct synthetic update id per sub-step: the engine stores at most one operation per update.
  return { ...ctx, capture: [], ...(updateOffset ? { updateId: -(Date.now() * 100 + updateOffset) } : {}) }
}

const plain = (html: string) => html.replace(/<[^>]+>/g, '')

async function reply(ctx: AssistantContext, text: string, markup?: Record<string, unknown>): Promise<void> {
  await say(ctx, text, markup)
  await rememberTurn(ctx, 'assistant', text).catch(() => undefined)
}

/** Sends what the engine said while it ran quietly (questions, validation messages, drafts). */
async function relay(ctx: AssistantContext, captured: Captured, prefix = ''): Promise<void> {
  const messages = captured.filter((item) => item.text.trim())
  if (!messages.length) { if (prefix) await reply(ctx, prefix.trim()); return }
  if (messages.filter((item) => item.markup).length <= 1 && !messages.some((item) => item.photo)) {
    await reply(ctx, `${prefix}${messages.map((item) => item.text).join('\n\n')}`, messages.find((item) => item.markup)?.markup)
    return
  }
  let first = true
  for (const item of messages) {
    await say(ctx, `${first ? prefix : ''}${item.text}`, item.markup)
    first = false
  }
}

async function saveAgent(ctx: AssistantContext, patch: Partial<AgentState> | null): Promise<void> {
  const session = await readSession(ctx.db, ctx.telegramUserId)
  const next = patch === null ? undefined : { ...(session.state.agent || {}), ...patch }
  if (next) for (const key of Object.keys(next) as Array<keyof AgentState>) if (next[key] === undefined) delete next[key]
  await updateSessionState(ctx, { agent: next && Object.keys(next).length ? next : undefined })
}

async function record(ctx: AssistantContext, turn: Turn): Promise<void> {
  const cost = turn.usage ? estimateCostMicros(ctx.env, turn.usage) : 0
  await ctx.db.prepare(
    `INSERT INTO assistant_agent_turns (store_id, channel, path, tools, outcome, latency_ms, prompt_tokens, output_tokens, cost_micros) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(ctx.store.id, ctx.channel ? (ctx.channel.provider === 'waha' ? 'waha' : 'whatsapp') : 'telegram', turn.path, turn.tools.join(',').slice(0, 200), turn.outcome.slice(0, 40),
    Date.now() - turn.started, turn.usage?.promptTokens || 0, turn.usage?.outputTokens || 0, cost).run().catch(() => undefined)
}

function openPending(pending: PendingOperation | null): PendingOperation | null {
  // Product drafts and shipping guides have their own conversation in the engine.
  return pending && pending.action !== 'create_product' && pending.action !== 'register_shipment' ? pending : null
}

// ───────────────────────── Control: confirmar, cancelar, esperar, reiniciar ─────────────────────────

/** Runs before the engine's own confirmation words. True when the message was a control answer. */
export async function handleAgentControl(ctx: AssistantContext, text: string): Promise<boolean> {
  if (!agentEnabled(ctx)) return false
  const turn: Turn = { started: Date.now(), path: 'rule', tools: [], outcome: 'control' }
  const session = await readSession(ctx.db, ctx.telegramUserId)
  const agent = session.state.agent || {}
  const pending = openPending(await getPendingOperation(ctx))
  const batch = agent.batch && Date.now() - agent.batch.at < BATCH_TTL_MS ? agent.batch : undefined
  const done = async (tool: ToolName, outcome: string) => { turn.tools.push(tool); turn.outcome = outcome; await record(ctx, turn); return true }

  if (RESET.test(text.trim())) {
    if (pending) await cancelOperation(ctx, pending.operation_id)
    await updateSessionState(ctx, null)
    await updateSessionState(ctx, { lastSkus: undefined })
    await reply(ctx, pending || batch ? 'Listo, empezamos de nuevo. Descarté lo pendiente y no cambié nada.' : 'Listo, empezamos de nuevo. ¿Qué necesitas?')
    return done('reiniciar', 'reset')
  }

  if (batch) {
    if (YES.test(text.trim())) { await applyBatch(ctx, batch); return done('confirmar', 'batch_applied') }
    if (NO.test(text.trim())) { await saveAgent(ctx, { batch: undefined }); await reply(ctx, 'Listo, no apliqué ninguno. Tu tienda quedó igual.'); return done('cancelar', 'batch_cancelled') }
    if (WAIT.test(text.trim())) { await reply(ctx, 'Tranquilo, los dejo en espera. Dime «sí» para aplicarlos o «cancela».'); return done('aclarar', 'batch_wait') }
  }

  if (agent.deferred && agent.deferredOp !== pending?.operation_id) await saveAgent(ctx, { deferred: undefined, deferredOp: undefined })
  else if (pending && agent.deferred) {
    const keep = YES.test(text.trim()) || KEEP.test(text.trim())
    const drop = NO.test(text.trim()) || /^cancel/i.test(text.trim())
    if (keep || drop) {
      const deferred = agent.deferred
      await saveAgent(ctx, { deferred: undefined, deferredOp: undefined })
      if (keep) await confirmOperation(ctx, pending)
      else { await cancelOperation(ctx, pending.operation_id); await say(ctx, 'Cancelado, eso no se cambió.') }
      await say(ctx, 'Ahora sí, lo otro que me pediste:').catch(() => undefined)
      const next = await handleAgentText(ctx, deferred)
      if (next !== 'handled') await reply(ctx, 'Eso otro dímelo de nuevo, por favor.')
      return done(keep ? 'confirmar' : 'cancelar', 'deferred_resolved')
    }
  }

  if (pending) {
    if (YES.test(text.trim())) { await confirmOperation(ctx, pending); await updateSessionState(ctx, { commerce: undefined }); return done('confirmar', 'confirmed') }
    if (NO.test(text.trim())) {
      await cancelOperation(ctx, pending.operation_id)
      await updateSessionState(ctx, { commerce: undefined })
      await reply(ctx, 'Listo, lo cancelé. No cambié nada.')
      return done('cancelar', 'cancelled')
    }
    if (WAIT.test(text.trim())) { await reply(ctx, 'Tranquilo, lo dejo en espera. Dime «sí» para aplicarlo o «cancela».'); return done('aclarar', 'wait') }
  }
  return false
}

export async function handleAgentCallback(ctx: AssistantContext, data: string): Promise<boolean> {
  const match = data.match(/^ag:(\d+):batch:(yes|no)$/)
  if (!match || Number(match[1]) !== ctx.store.id || !agentEnabled(ctx)) return false
  const session = await readSession(ctx.db, ctx.telegramUserId)
  const batch = session.state.agent?.batch
  if (!batch || Date.now() - batch.at >= BATCH_TTL_MS) { await say(ctx, 'Esos cambios ya no están pendientes. No se aplicó nada nuevo.'); return true }
  if (match[2] === 'yes') await applyBatch(ctx, batch)
  else { await saveAgent(ctx, { batch: undefined }); await reply(ctx, 'Listo, no apliqué ninguno. Tu tienda quedó igual.') }
  return true
}

// ───────────────────────── Entender y actuar ─────────────────────────

export async function handleAgentText(ctx: AssistantContext, text: string): Promise<AgentResult> {
  if (!agentEnabled(ctx)) return 'fallback'
  const turn: Turn = { started: Date.now(), path: 'rule', tools: [], outcome: 'ok' }
  try {
    const result = await understand(ctx, text, turn)
    if (result !== 'handled') turn.outcome = result
    await record(ctx, turn)
    return result
  } catch (error) {
    // Never leave the merchant without an answer because of this layer: the previous engine takes over.
    console.error('Agent layer failed:', error instanceof Error ? error.message : 'unknown')
    turn.path = 'fallback'; turn.outcome = 'error'
    await record(ctx, turn)
    return 'fallback'
  }
}

async function understand(ctx: AssistantContext, text: string, turn: Turn): Promise<AgentResult> {
  const session = await readSession(ctx.db, ctx.telegramUserId)
  const agent = session.state.agent || {}
  const pending = openPending(await getPendingOperation(ctx))
  const trimmed = text.trim()

  if (YES.test(trimmed)) { await reply(ctx, 'No hay nada pendiente por confirmar. ¿Qué necesitas?'); turn.tools.push('confirmar'); return 'handled' }

  // «la 2» after a numbered list of products.
  const ordinal = fold(trimmed).match(/^(?:el|la|opcion|numero|#)?\s*(\d|primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa])[.!]*$/)
  if (ordinal && !session.state.commerce?.ask && agent.options?.length) {
    const words: Record<string, number> = { primero: 1, primera: 1, primer: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3, tercer: 3, cuarto: 4, cuarta: 4, quinto: 5, quinta: 5 }
    const sku = agent.options[(Number(ordinal[1]) || words[ordinal[1]!] || 0) - 1]
    if (sku) return runSteps(ctx, text, [step('ver_producto', { producto: sku })], turn, pending)
  }

  // A question of the engine is open (which product, add or set, which colour…): its answer goes there first.
  if (session.state.commerce?.ask) {
    const outcome = await legacyCommerce(ctx, text)
    if (outcome) { turn.path = 'parser'; turn.tools.push('aclarar'); return 'handled' }
  }

  if (UNDO.test(trimmed)) return runSteps(ctx, text, [step('deshacer')], turn, pending)

  const multi = looksMulti(text)
  const quick = multi ? null : detectIntent(text, session.state.lastSkus)
  if (quick?.kind === 'greeting') return runSteps(ctx, text, [step('resumen_tienda', { texto: trimmed })], turn, pending)
  if (quick?.kind === 'action' && quick.action === 'get_out_of_stock') return runSteps(ctx, text, [step('buscar_productos', { filtro: 'agotados' })], turn, pending)
  if (quick?.kind === 'action' && quick.action === 'get_low_stock') return runSteps(ctx, text, [step('buscar_productos', { filtro: 'pocas_unidades' })], turn, pending)

  // One clear instruction: the deterministic parser is exact with prices, sizes and quantities. When it ends in
  // a doubt (unknown product, a question, a «new product» that looks like an existing one) and the model is
  // available, the model reads the message too; if the model fails, the parser's answer stands.
  const canModel = Boolean(ctx.env.GEMINI_API_KEY)
  const focusNow = session.state.focusSku || (session.state.lastSkus?.length === 1 ? session.state.lastSkus[0] : undefined)
  const parsed = multi ? null : parseCommerce(withoutLead(trimmed))
  let parserAnswer: (() => Promise<AgentResult>) | null = null
  if (parsed) {
    turn.path = 'parser'
    if (parsed.kind === 'correction') {
      turn.tools.push('corregir')
      if (await legacyCommerce(ctx, text)) return 'handled'
      return 'fallback'
    }
    // «productos agotados» names no product: it is a question about the catalogue, not an order to empty one.
    if (parsed.kind === 'sold_out' && !parsed.product && !parsed.color && !parsed.size && !/(?:ya no|se acab|se agot|marc|pon|dej)/i.test(fold(trimmed))) {
      return runSteps(ctx, text, [step('buscar_productos', { filtro: 'agotados' })], turn, pending)
    }
    if (parsed.kind === 'stock_query') {
      const known = resolveProduct(await loadCatalog(ctx), parsed.product, {}, focusNow).kind !== 'none'
      parserAnswer = () => runSteps(ctx, text, [step('ver_producto', { producto: parsed.product })], turn, pending)
      if (known || !canModel) return parserAnswer()
    } else {
      const twins = parsed.kind === 'create_product' && !parsed.sku ? matchProducts(await loadCatalog(ctx), parsed.name) : []
      const looksExisting = twins.length > 0
      // «súbele el precio a las sandalias» reads as a new product for the parser. If the model cannot settle it,
      // nothing is drafted: the merchant is asked what to change on the product that already exists.
      parserAnswer = looksExisting
        ? async () => {
          if (twins.length === 1) await updateSessionState(ctx, { focusSku: twins[0]!.sku, lastSkus: [twins[0]!.sku] })
          await reply(ctx, `Ya tienes <b>${plainText(twins[0]!.name)}</b>${twins.length > 1 ? ` y ${twins.length - 1} parecido${twins.length > 2 ? 's' : ''}` : ''} en la tienda. Dime qué le cambio (por ejemplo «súbele 5 mil» o «llegaron 3 de la 38»), o escribe «producto nuevo» si es otro.`)
          return 'handled' as const
        }
        : () => runWrites(ctx, text, [parsed], turn, pending, focusNow)
      if (!looksExisting || !canModel) {
        const first = await runWrites(ctx, text, [parsed], turn, pending, focusNow, '', canModel && parsed.kind !== 'create_product')
        if (first !== 'retry') return first
        await updateSessionState(ctx, { commerce: session.state.commerce })
      }
    }
    turn.tools.length = 0
  }
  // Everything else the engine already recognises without AI (thanks, menu, reports, store design…) stays there.
  if (quick && !parserAnswer) return 'other'

  if (!canModel) return 'fallback'
  turn.path = 'model'
  await showTyping(ctx).catch(() => undefined)
  const catalog = await loadCatalog(ctx)
  const named = (sku: string) => { const product = catalog.find((item) => item.sku === sku); return product ? { sku, name: product.name } : null }
  const timeout = Math.min(20000, Math.max(2000, Number(ctx.env.ASSISTANT_AGENT_TIMEOUT_MS) || 9000))
  // Perceived latency: a short acknowledgement if the model takes long.
  const slow = setTimeout(() => { say(ctx, 'Dame un momento…').catch(() => undefined) }, 4500)
  const context = {
    focus: session.state.focusSku ? named(session.state.focusSku) : null,
    options: (agent.options || []).map(named).filter((item): item is { sku: string; name: string } => Boolean(item)),
    pending: pending ? plain(shortPreview(pending, ctx.store.currency)) : null,
    recent: await conversationContext(ctx),
  }
  const outcome = await withAiBudget(ctx, 'interpretacion', () => planTurn(ctx, text, context, timeout)).finally(() => clearTimeout(slow))
  if (!outcome.ok) {
    if (parserAnswer) { turn.path = 'parser'; turn.outcome = 'model_failed'; return parserAnswer() }
    turn.path = 'fallback'; turn.outcome = 'model_failed'
    return 'fallback'
  }
  turn.usage = outcome.value.usage
  return runSteps(ctx, text, outcome.value.steps, turn, pending, catalog)
}

/** The engine's own conversation (clarifications and corrections), run quietly and answered in short form. */
async function legacyCommerce(ctx: AssistantContext, text: string): Promise<boolean> {
  const before = await getPendingOperation(ctx)
  const sub = quiet(ctx)
  const handled = await handleCommerceText(sub, text)
  if (!handled) return false
  await announce(ctx, sub.capture, before)
  return true
}

/** After the engine ran quietly: the new pending change in one line, or whatever the engine had to say. */
async function announce(ctx: AssistantContext, captured: Captured, before: PendingOperation | null, prefix = ''): Promise<boolean> {
  const pending = await getPendingOperation(ctx)
  if (pending && pending.operation_id !== before?.operation_id && openPending(pending)) {
    await reply(ctx, `${prefix}${askConfirmation(shortPreview(pending, ctx.store.currency))}`, operationKeyboard(pending.operation_id, CORRECTABLE_ACTIONS.has(pending.action)))
    return true
  }
  const said = captured.filter((item) => !/Descart[eé] la propuesta anterior/.test(item.text)).map((item) => ({
    ...item,
    // The two readings of a bare amount go in the text too (not every channel shows buttons).
    text: item.text.replace(/Escribiste (\d{1,3}): ¿cuánto es\?/, (_match, amount: string) => `¿Lo dejo en ${formatMoney(Number(amount), ctx.store.currency)} o en ${formatMoney(Number(amount) * 1000, ctx.store.currency)}?`),
  }))
  await relay(ctx, said, prefix)
  return false
}

async function runSteps(ctx: AssistantContext, text: string, steps: Step[], turn: Turn, pending: PendingOperation | null, loaded?: CatalogProduct[]): Promise<AgentResult> {
  const session = await readSession(ctx.db, ctx.telegramUserId)
  let focus = session.state.focusSku || (session.state.lastSkus?.length === 1 ? session.state.lastSkus[0] : undefined)
  let catalog = loaded
  const out: string[] = []
  const writes: CommerceIntent[] = []
  let outOfScope = false
  // Confirming or cancelling is the merchant's explicit answer: the model may propose it only as the whole reply,
  // never bundled with other steps («mejor súbele…» does not cancel what is waiting; the merchant is asked).
  if (steps.length > 1) steps = steps.filter((step) => step.tool !== 'confirmar' && step.tool !== 'cancelar')
  turn.tools.push(...steps.map((step) => step.tool))

  for (const step of steps) {
    const spec = TOOLS[step.tool]
    if (spec.kind === 'read') {
      catalog ||= await loadCatalog(ctx)
      if (step.tool === 'resumen_tienda') {
        const hello = /^buen[oa]s?\s+(d[ií]as|tardes|noches)/i.exec(step.texto || '')
        const greeting = `${hello ? `Buen${/d[ií]as/i.test(hello[1]!) ? 'os días' : /tardes/i.test(hello[1]!) ? 'as tardes' : 'as noches'}` : 'Hola'}${ctx.firstName ? `, ${ctx.firstName.split(' ')[0]}` : ''}.`
        out.push(renderSnapshot(greeting, await storeSnapshot(ctx, catalog)))
      } else if (step.tool === 'cambios_recientes') {
        const product = step.producto ? resolveProduct(catalog, step.producto, {}, null) : null
        const sub = quiet(ctx)
        await showStockMovements(sub, product?.kind === 'one' ? product.product.sku : undefined)
        out.push(sub.capture.map((item) => item.text).join('\n'))
      } else if (step.tool === 'ver_producto') {
        const resolution = resolveProduct(catalog, step.producto || step.consulta, {}, focus)
        if (resolution.kind === 'one') {
          focus = resolution.product.sku
          await updateSessionState(ctx, { focusSku: focus, lastSkus: [focus] })
          out.push(renderProduct(resolution.product, ctx.store.currency))
        } else if (resolution.kind === 'many') {
          await saveAgent(ctx, { options: resolution.options.slice(0, 3).map((product) => product.sku) })
          out.push(renderChoice(resolution.options, ctx.store.currency))
        } else {
          out.push(step.producto || step.consulta ? `No encontré «${plainText(step.producto || step.consulta!)}» en ${plainText(ctx.store.name)}. Revisa el nombre o dime el código.` : '¿De cuál producto? Dime el nombre o el código.')
        }
      } else {
        const input = { query: step.consulta || step.producto, filter: step.filtro, color: step.color, size: step.talla }
        const found = filterCatalog(catalog, input)
        if (found.length === 1 && input.query) {
          focus = found[0]!.sku
          await updateSessionState(ctx, { focusSku: focus, lastSkus: [focus] })
          out.push(renderProduct(found[0]!, ctx.store.currency))
        } else {
          if (found.length) { await saveAgent(ctx, { options: found.slice(0, LIST_LIMIT).map((product) => product.sku) }); await updateSessionState(ctx, { lastSkus: found.slice(0, LIST_LIMIT).map((product) => product.sku) }) }
          out.push(renderList(found, input, ctx.store.currency))
        }
      }
      continue
    }
    if (spec.kind === 'write') {
      if (step.tool === 'marcar_agotado' && !step.producto && !step.talla && !step.color && !focus) {
        catalog ||= await loadCatalog(ctx)
        out.push(renderList(filterCatalog(catalog, { query: null, filter: 'agotados', color: null, size: null }), { query: null, filter: 'agotados' }, ctx.store.currency))
        continue
      }
      if (!spec.allowed(ctx)) { out.push(DENIED.write); continue }
      const intent = intentFromStep(step, text)
      if (!intent) { out.push(step.tool === 'cambiar_precio' ? '¿A qué precio lo dejo?' : step.tool === 'ajustar_inventario' ? '¿Cuántas unidades son?' : 'Me falta un dato para preparar ese cambio. ¿Me lo repites?'); continue }
      writes.push(intent)
      continue
    }
    switch (step.tool) {
      case 'confirmar':
        if (pending) { if (out.length) await reply(ctx, out.splice(0).join('\n\n')); await confirmOperation(ctx, pending); pending = null }
        else out.push('No hay nada pendiente por confirmar.')
        break
      case 'cancelar':
        if (pending) { await cancelOperation(ctx, pending.operation_id); pending = null; out.push('Listo, lo cancelé. No cambié nada.') }
        else out.push('No hay nada pendiente por cancelar.')
        break
      case 'reiniciar':
        if (pending) { await cancelOperation(ctx, pending.operation_id); pending = null }
        await updateSessionState(ctx, null)
        out.push('Listo, empezamos de nuevo. No cambié nada.')
        break
      case 'corregir': {
        if (out.length) await reply(ctx, out.splice(0).join('\n\n'))
        if (!await legacyCommerce(ctx, text)) out.push(pending ? 'No entendí la corrección. Dime el dato correcto, por ejemplo «son 6, no 5».' : 'No hay un cambio pendiente para corregir.')
        else return 'handled'
        break
      }
      case 'deshacer': {
        const undo = await undoIntent(ctx)
        if (typeof undo === 'string') out.push(undo)
        else if (!TOOLS[toolOfIntent(undo.intent)].allowed(ctx)) out.push(DENIED.write)
        else return runWrites(ctx, text, [undo.intent], turn, pending, focus, `${out.length ? `${out.join('\n\n')}\n\n` : ''}Deshago el último cambio. ${undo.note}`)
        break
      }
      case 'aclarar': case 'conversar':
        if (step.texto) out.push(plainText(step.texto))
        break
      case 'otro_tema': outOfScope = true; break
    }
  }

  if (outOfScope && !out.length && !writes.length) return 'other'
  if (outOfScope) out.push('Lo demás (pedidos, envíos, campañas…) pídemelo en un mensaje aparte y lo vemos.')
  if (writes.length) return runWrites(ctx, text, writes, turn, pending, focus, out.length ? `${out.join('\n\n')}\n\n` : '')
  if (!out.length) return 'fallback'
  const reminder = pending ? `\n\nSigue pendiente: ${askConfirmation(shortPreview(pending, ctx.store.currency))}` : ''
  await reply(ctx, `${out.join('\n\n')}${reminder}`, pending ? operationKeyboard(pending.operation_id, CORRECTABLE_ACTIONS.has(pending.action)) : undefined)
  return 'handled'
}

const plainText = (value: string) => value.replace(/[<>&]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[character]!)

function filtersOf(intent: CommerceIntent): { color?: string | null; size?: string | null } {
  if (intent.kind === 'sold_out') return { color: intent.color, size: intent.size }
  if (intent.kind !== 'stock') return {}
  const one = <T>(values: Array<T | null>) => { const set = [...new Set(values.filter(Boolean))]; return set.length === 1 && values.every(Boolean) ? set[0]! : null }
  return { color: intent.color || one(intent.lines.map((line) => line.color)), size: one(intent.lines.map((line) => line.size)) }
}

/** One change: its one-line preview. Several: one summary and one confirmation for all of them. */
async function runWrites(ctx: AssistantContext, text: string, intents: CommerceIntent[], turn: Turn, pending: PendingOperation | null, focus?: string, prefix?: string, secondOpinion?: false): Promise<AgentResult>
async function runWrites(ctx: AssistantContext, text: string, intents: CommerceIntent[], turn: Turn, pending: PendingOperation | null, focus: string | undefined, prefix: string, secondOpinion: boolean): Promise<WriteResult>
async function runWrites(ctx: AssistantContext, text: string, intents: CommerceIntent[], turn: Turn, pending: PendingOperation | null, focus?: string, prefix = '', secondOpinion = false): Promise<WriteResult> {
  for (const intent of intents) { const tool = toolOfIntent(intent); if (!turn.tools.includes(tool)) turn.tools.push(tool) }
  if (intents.some((intent) => !TOOLS[toolOfIntent(intent)].allowed(ctx))) { await reply(ctx, `${prefix}${DENIED.write}`); return 'handled' }
  // Nothing is dropped in silence: a change is waiting, so the merchant decides before a new one is prepared.
  if (pending) {
    await saveAgent(ctx, { deferred: text.slice(0, 400), deferredOp: pending.operation_id })
    await reply(ctx, `${prefix}Tienes pendiente esto: ${shortPreview(pending, ctx.store.currency)}${shortPreview(pending, ctx.store.currency).includes('\n') ? '\n' : '. '}¿La sigo o la cancelo?`, {
      inline_keyboard: [[{ text: '✅ Seguir y confirmar', callback_data: `op:confirm:${pending.operation_id}` }, { text: '✖ Cancelarla', callback_data: `op:cancel:${pending.operation_id}` }]],
    })
    turn.outcome = 'pending_asked'
    return 'handled'
  }
  const catalog = await loadCatalog(ctx)
  const session = await readSession(ctx.db, ctx.telegramUserId)

  // Ambiguous product: up to three numbered candidates; the engine's clarification takes the answer («la 2»).
  const ambiguous = (intent: CommerceIntent) => {
    if (!('product' in intent)) return null
    const resolution = resolveProduct(catalog, intent.product, filtersOf(intent), focus)
    return resolution.kind === 'many' ? resolution.options : null
  }
  const first = intents[0]!
  const options = ambiguous(first)
  if (options) {
    const shown = options.slice(0, 3)
    await updateSessionState(ctx, { commerce: { intent: first, ask: 'product', options: shown.map((product) => product.id) } })
    const rest = intents.length > 1 ? '\n(Los otros cambios los preparo cuando aclaremos este.)' : ''
    await reply(ctx, `${prefix}${renderChoice(options, ctx.store.currency)}${rest}`, {
      inline_keyboard: [...shown.map((product, index) => [{ text: `${index + 1}. ${product.name}`.slice(0, 60), callback_data: `cm:${ctx.store.id}:pick:${product.id}` }]), [{ text: '✖ Cancelar', callback_data: `cm:${ctx.store.id}:cancel` }]],
    })
    turn.outcome = 'choice_asked'
    return 'handled'
  }

  const single = async (note = '') => {
    const sub = quiet(ctx)
    await runCommerceIntent(sub, first, focus, session.state.commerce, undefined, text)
    // The parser ended in a question or a «no encontré»: let the model read the message before answering.
    if (secondOpinion && !await getPendingOperation(ctx)) return 'retry' as const
    const proposed = await announce(ctx, sub.capture, null, prefix)
    if (note) await say(ctx, note).catch(() => undefined)
    turn.outcome = proposed ? 'proposed' : 'asked'
    return 'handled' as const
  }
  if (intents.length === 1) return single()
  // A new product has its own guided draft: it never travels inside a group of changes.
  if (intents.some((intent) => intent.kind === 'create_product')) return single('Lo demás lo preparo cuando terminemos este: pídemelo de nuevo.')

  // Several changes: each one is validated by the engine (a real preview), then set aside until the single confirmation.
  const items: NonNullable<AgentState['batch']>['items'] = []
  for (const [index, intent] of intents.entries()) {
    const sub = quiet(ctx, index + 1)
    await runCommerceIntent(sub, intent, focus)
    const probe = openPending(await getPendingOperation(ctx))
    if (!probe) {
      // This one needs an answer first (or is not possible): it is asked alone and the rest is said out loud.
      await updateSessionState(ctx, { agent: { ...(session.state.agent || {}), batch: undefined } })
      await relay(ctx, sub.capture, prefix)
      await say(ctx, items.length || index < intents.length - 1 ? 'Los otros cambios no los preparé todavía: pídemelos cuando resolvamos este.' : '').catch(() => undefined)
      turn.outcome = 'batch_blocked'
      return 'handled'
    }
    const sku = String(JSON.parse(probe.params_json).sku || '')
    items.push({ intent: 'product' in intent ? { ...intent, product: sku || intent.product } as CommerceIntent : intent, sku, line: shortPreview(probe, ctx.store.currency) })
    await cancelOperation(ctx, probe.operation_id)
    focus = sku || focus
  }
  await updateSessionState(ctx, { commerce: undefined, agent: { ...(session.state.agent || {}), batch: { items, at: Date.now() } } })
  await reply(ctx, `${prefix}Son ${items.length} cambios:\n${items.map((item, index) => `${index + 1}) ${item.line.replace(/\n/g, '\n   ')}`).join('\n')}\n¿Confirmo todos?`, {
    inline_keyboard: [[{ text: '✅ Confirmar todos', callback_data: `ag:${ctx.store.id}:batch:yes` }, { text: '✖ Cancelar', callback_data: `ag:${ctx.store.id}:batch:no` }]],
  })
  turn.outcome = 'batch_proposed'
  return 'handled'
}

/** Applies the confirmed group one by one through the engine. Reports exactly what the backend applied. */
async function applyBatch(ctx: AssistantContext, batch: NonNullable<AgentState['batch']>): Promise<void> {
  await saveAgent(ctx, { batch: undefined })
  const results: Array<{ ok: boolean; text: string }> = []
  for (const [index, item] of batch.items.entries()) {
    const sub = quiet(ctx, index + 1)
    try {
      await runCommerceIntent(sub, item.intent, item.sku || undefined)
      const pending = openPending(await getPendingOperation(ctx))
      if (!pending) { results.push({ ok: false, text: plain(sub.capture.at(-1)?.text || 'no se pudo preparar') }); continue }
      const said = sub.capture.length
      await confirmOperation(sub, pending)
      const row = await ctx.db.prepare('SELECT status FROM telegram_operations WHERE operation_id = ?').bind(pending.operation_id).first<{ status: string }>()
      const message = plain(sub.capture.slice(said).map((entry) => entry.text).join(' ')).replace(/^✅\s*¡Listo!\s*/, '')
      if (row?.status !== 'applied') await cancelOperation(ctx, pending.operation_id)
      results.push({ ok: row?.status === 'applied', text: message || (row?.status === 'applied' ? 'aplicado' : 'no se aplicó') })
    } catch (error) {
      console.error('Agent batch item failed:', error instanceof Error ? error.message : 'unknown')
      results.push({ ok: false, text: 'el sistema no respondió; no se cambió' })
    }
  }
  await updateSessionState(ctx, { commerce: undefined })
  const applied = results.filter((result) => result.ok).length
  const lines = results.map((result, index) => `${index + 1}) ${result.ok ? '✔' : '✖ No se aplicó:'} ${plainText(result.text)}`)
  const head = applied === results.length ? `Listo, apliqué los ${applied} cambios:` : applied === 0 ? 'No pude aplicar los cambios. Tu tienda quedó igual:' : `Apliqué ${applied} de ${results.length}:`
  await reply(ctx, `${head}\n${lines.join('\n')}`)
}

/**
 * The inverse of the last change applied from this conversation in the last minutes, as a normal proposal.
 * It never overwrites what happened afterwards: stock is reverted by the difference the change made (a sale
 * registered in between is kept), and it is refused when that would go below zero or when the price was
 * changed again by someone else.
 */
async function undoIntent(ctx: AssistantContext): Promise<{ intent: CommerceIntent; note: string } | string> {
  const last = await ctx.db.prepare(
    `SELECT action, params_json, before_json, after_json FROM telegram_operations
     WHERE chat_id = ? AND store_id = ? AND status = 'applied' AND completed_at >= datetime('now', '${UNDO_WINDOW}')
     ORDER BY completed_at DESC, rowid DESC LIMIT 1`,
  ).bind(String(ctx.chatId), ctx.store.id).first<{ action: string; params_json: string; before_json: string; after_json: string }>()
  if (!last) return 'No encuentro un cambio reciente para deshacer (solo puedo con los de los últimos 10 minutos).'
  const params = JSON.parse(last.params_json) as Record<string, any>
  const before = JSON.parse(last.before_json) as Record<string, any>
  const after = JSON.parse(last.after_json) as Record<string, any>
  const product = (await loadCatalog(ctx)).find((item) => item.sku === String(params.sku))
  if (!product) return 'Ese producto ya no está en el catálogo; no hay nada que deshacer.'
  if (last.action === 'update_price') {
    if (product.price !== Number(after.price)) {
      return `El precio de <b>${plainText(product.name)}</b> volvió a cambiar después (hoy está en ${formatMoney(product.price, ctx.store.currency)}), así que no lo toco. Si quieres otro valor, dímelo.`
    }
    return { intent: { kind: 'price', mode: 'set', amount: Number(before.price), percent: false, product: product.sku }, note: '' }
  }
  if (last.action === 'update_variant_stocks' && !(params.create as unknown[]).length) {
    const old = parseVariants(before.variants)
    const lines: Array<{ quantity: number; size: string | null; color: string | null }> = []
    let moved = false
    for (const change of params.changes as Array<{ variantId: number; stock: number }>) {
      const was = old.find((variant) => variant.id === change.variantId)
      const now = product.variants.find((variant) => variant.id === change.variantId)
      if (!was || !now) return 'Esa talla ya no existe en el producto; no puedo deshacer el cambio.'
      const target = now.stock - (change.stock - Number(was.stock))
      if (now.stock !== change.stock) moved = true
      if (target < 0) {
        return `No puedo deshacerlo: desde ese cambio salieron unidades de <b>${plainText(product.name)}</b> (${plainText(variantLabel(now))} hoy tiene ${now.stock}) y quedaría en negativo. Dime cuántas hay realmente y lo ajusto.`
      }
      lines.push({ quantity: target, size: now.size && now.size !== 'Única' ? now.size : null, color: now.color && now.color !== 'Único' ? now.color : null })
    }
    if (lines.length) {
      return {
        intent: { kind: 'stock', mode: 'set', product: product.sku, total: null, lines, color: null, size: null },
        note: moved ? 'El inventario se movió después de ese cambio: revierto solo lo que ese cambio sumó o restó. ' : '',
      }
    }
  }
  return 'Ese último cambio no lo puedo deshacer desde aquí. Puedes corregirlo pidiéndome el valor correcto o desde el panel.'
}
