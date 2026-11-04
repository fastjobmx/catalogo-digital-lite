/**
 * Master bot (Sistema A): platform administration through Telegram. Only the
 * numeric Telegram ids listed in MASTER_ADMIN_TELEGRAM_IDS are served. Every
 * change is previewed and confirmed, and every action is audited.
 */
import { z } from 'zod'
import type { Env } from '../../index'
import { answerCallback, sendTelegramMessage, type TelegramUpdate } from '../assistant/telegramApi'
import { escapeHtml } from '../assistant/tools'
import { callGeminiJson, geminiFailureCode, geminiModel, UNTRUSTED_CONTENT_RULE } from '../../ai/geminiClient'
import { formatUsd, geminiPrices } from '../../ai/usage'
import { getStoreBySlug, isValidSlug, PRIMARY_STORE_ID, publicStoreUrl, slugify } from '../../tenancy/stores'
import { parseAdminIds } from './maintenance'
import { provisionStore, suggestSlug, type ProvisionResult } from '../provisioning'
import { TEMPLATE_KEYS, TEMPLATE_LABELS, type TemplateKey } from '../templates'
import { downloadTelegramImage } from '../telegramProductImages'
import { aiUsageAlerts, currentBillingPeriod, generateInvoices, listInvoices, setDomainStatus, setInvoiceStatus } from '../billing'
import {
  assignOwner, getStoreDetail, listStores, platformSummary, PlatformError, recentEvents, regenerateOwnerAccess,
  requestCustomDomain, setStoreAiBudget, setStoreLogo, setStorePlan, setStoreStatus, storesHealth,
} from '../platform'

type Keyboard = { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> }

type MasterContext = { db: D1Database; env: Env['Bindings']; botToken: string; chatId: number; actor: string; updateId: number }

type WizardData = {
  name?: string; slug?: string; businessType?: string; template?: TemplateKey; primaryColor?: string; accentColor?: string
  whatsapp?: string | null; ownerName?: string; ownerEmail?: string; ownerTelegramId?: string; logoFileId?: string; planCode?: string; editing?: boolean
}
type WizardStep = 'name' | 'business' | 'owner' | 'whatsapp' | 'style' | 'color' | 'logo' | 'plan' | 'summary' | 'slug'

const NAMED_COLORS: Record<string, string> = {
  'azul oscuro': '#153D70', 'azul marino': '#1E3A5F', azul: '#2563EB', negro: '#111111', blanco: '#FFFFFF', rojo: '#C62828',
  'verde oscuro': '#185C43', verde: '#237A57', morado: '#6D28D9', naranja: '#C2410C', rosado: '#DB2777', rosa: '#DB2777',
  dorado: '#B08D57', gris: '#6B7280', beige: '#D9D0C1', turquesa: '#0F9D9A', vinotinto: '#7F1D1D',
}

export function masterAdminIds(env: Partial<Env['Bindings']>): Set<string> {
  return new Set(parseAdminIds(env.MASTER_ADMIN_TELEGRAM_IDS).valid)
}

async function say(ctx: MasterContext, text: string, keyboard?: Keyboard): Promise<void> {
  const label = ctx.env.MASTER_ENV_LABEL?.trim()
  await sendTelegramMessage(ctx.botToken, ctx.chatId, `${label ? `🧪 <b>${escapeHtml(label)}</b>\n\n` : ''}${text}`, 'HTML', keyboard)
}

function menuKeyboard(): Keyboard {
  return { inline_keyboard: [
    [{ text: '➕ Crear nueva tienda', callback_data: 'mt:create' }],
    [{ text: '🏪 Ver mis tiendas', callback_data: 'mt:stores' }, { text: '👤 Administrar propietarios', callback_data: 'mt:owners' }],
    [{ text: '⚙️ Configuración de plataforma', callback_data: 'mt:config' }, { text: '📊 Estadísticas', callback_data: 'mt:summary' }],
    [{ text: '✨ Ayuda con IA', callback_data: 'mt:ask' }],
  ] }
}

const WELCOME = [
  '👋 ¡Hola! Soy el <b>bot maestro</b> de Catálogo Digital IA.',
  'Desde aquí creas tiendas, administras a sus propietarios y revisas cómo va la plataforma. Antes de cualquier cambio te mostraré un resumen para que lo confirmes.',
  '',
  '¿Qué hacemos?',
].join('\n')

const HELP = [
  '🛠️ <b>Bot maestro de la plataforma</b>',
  '',
  '/menu — menú principal',
  '/crear_tienda — asistente para crear una tienda',
  '/tiendas — listado (también: /tiendas activas, /tiendas borrador)',
  '/tienda &lt;dirección&gt; — ficha, salud y acciones',
  '/activar &lt;dirección&gt; · /suspender &lt;dirección&gt; [motivo]',
  '/plan &lt;dirección&gt; &lt;basico|profesional|premium&gt;',
  '/limite_ia &lt;dirección&gt; &lt;USD por mes&gt;',
  '/asignar_admin &lt;dirección&gt; &lt;correo o ID de Telegram&gt;',
  '/acceso &lt;dirección&gt; — nuevos códigos de acceso del propietario',
  '/dominio &lt;dirección&gt; &lt;dominio&gt; — registrar dominio propio',
  '/propietarios — propietarios de cada tienda · /configuracion — planes y ajustes',
  '/facturas [pendiente|pagada|anulada|dirección] · /facturar [AAAA-MM] · /pagada &lt;n&gt; · /anular &lt;n&gt;',
  '/dominio_estado &lt;dominio&gt; &lt;verificado|activo|retirado&gt; · /consumo — tiendas cerca de su límite de IA',
  '/resumen · /salud · /errores · /cancelar',
  '/pregunta &lt;texto&gt; — consulta a la IA sobre la plataforma',
  '',
  'También puedes escribir: “crea una tienda llamada Moda Urbana”, “suspende moda-urbana por falta de pago”, “sube el límite de IA de moda-urbana a 5 dólares”.',
  'Todo cambio muestra un resumen y pide confirmación.',
].join('\n')

export async function processMasterUpdate(update: TelegramUpdate, env: Env['Bindings'], db: D1Database): Promise<void> {
  const botToken = env.MASTER_BOT_TOKEN
  const message = update.message || update.callback_query?.message
  const from = update.message?.from || update.callback_query?.from
  if (!botToken || !message || !from || message.chat.type !== 'private' || message.chat.id !== from.id) return
  if (!masterAdminIds(env).has(String(from.id))) return
  const ctx: MasterContext = { db, env, botToken, chatId: message.chat.id, actor: `master:${from.id}`, updateId: update.update_id }
  try {
    if (update.callback_query) {
      await answerCallback(botToken, update.callback_query.id).catch(() => undefined)
      await handleCallback(ctx, update.callback_query.data || '')
      return
    }
    const text = (update.message?.text || '').trim()
    const imageFileId = update.message?.photo?.at(-1)?.file_id || (/^image\//.test(update.message?.document?.mime_type || '') ? update.message?.document?.file_id : undefined)
    if (imageFileId) {
      const wizard = await readWizard(ctx)
      if (wizard?.step === 'logo') await receiveLogo(ctx, wizard.data, imageFileId)
      else await say(ctx, 'Recibí una imagen. Para usarla como logotipo de una tienda nueva, envíala cuando el asistente de /crear_tienda la pida.', menuKeyboard())
      return
    }
    if (!text) { await say(ctx, 'Escríbeme un comando o usa el menú.', menuKeyboard()); return }
    if (text.startsWith('/')) { await handleCommand(ctx, text); return }
    const wizard = await readWizard(ctx)
    if (wizard) { await wizardAnswer(ctx, wizard.step, wizard.data, text); return }
    if (await consumeAskMode(ctx)) { await answerQuestion(ctx, text); return }
    await handleNaturalLanguage(ctx, text)
  } catch (error) {
    console.error('Master bot update failed:', error instanceof Error ? error.message : 'unknown')
    await db.prepare(`INSERT INTO platform_events (level, source, code, detail) VALUES ('error', 'master_bot', 'UPDATE_FAILED', ?)`).bind((error instanceof Error ? error.message : 'unknown').slice(0, 200)).run().catch(() => undefined)
    await say(ctx, 'No pude completar la operación. No se aplicó ningún cambio; el detalle quedó en los registros.', menuKeyboard()).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function handleCommand(ctx: MasterContext, text: string): Promise<void> {
  const [rawCommand = '', ...args] = text.split(/\s+/)
  const command = rawCommand.split('@')[0]!.toLowerCase()
  const rest = text.slice(rawCommand.length).trim()
  switch (command) {
    case '/start': await say(ctx, WELCOME, menuKeyboard()); return
    case '/menu': await say(ctx, '¿Qué hacemos?', menuKeyboard()); return
    case '/ayuda':
    case '/help': await say(ctx, HELP, menuKeyboard()); return
    case '/crear_tienda':
    case '/nueva_tienda': await startWizard(ctx, rest ? { name: rest.slice(0, 80) } : {}); return
    case '/tiendas': await showStores(ctx, args[0]); return
    case '/tienda': if (!args[0]) { await say(ctx, 'Indica la dirección de la tienda. Ejemplo: /tienda moda-urbana'); return } await showStore(ctx, args[0]); return
    case '/activar': await proposeStatus(ctx, args[0], 'active'); return
    case '/suspender': await proposeStatus(ctx, args[0], 'suspended', args.slice(1).join(' ')); return
    case '/plan': await proposePlan(ctx, args[0], args[1]); return
    case '/limite_ia': await proposeAiBudget(ctx, args[0], args[1]); return
    case '/asignar_admin': await proposeOwner(ctx, args[0], args[1]); return
    case '/acceso': await proposeAccess(ctx, args[0]); return
    case '/dominio': await proposeDomain(ctx, args[0], args[1]); return
    case '/propietarios': await showOwners(ctx); return
    case '/configuracion': await showConfig(ctx); return
    case '/pregunta': if (rest) await answerQuestion(ctx, rest); else await startAsk(ctx); return
    case '/resumen':
    case '/estadisticas': await showSummary(ctx); return
    case '/salud': await showHealth(ctx); return
    case '/facturas': await showInvoices(ctx, args[0]); return
    case '/facturar': {
      const period = args[0] || currentBillingPeriod()
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) { await say(ctx, 'Indica el periodo así: /facturar 2026-11'); return }
      await propose(ctx, 'generate_invoices', { period }, `🧾 Generar las facturas del periodo <b>${escapeHtml(period)}</b> para servicios activos y planes con precio. No se cobra nada automáticamente.`)
      return
    }
    case '/pagada':
    case '/anular': {
      const id = Number(args[0])
      if (!Number.isSafeInteger(id) || id < 1) { await say(ctx, `Indica el número de factura. Ejemplo: ${command} 12`); return }
      const status = command === '/pagada' ? 'pagada' : 'anulada'
      await propose(ctx, 'invoice_status', { id, status }, `🧾 Marcar la factura #${id} como <b>${status}</b>. Es definitivo.`)
      return
    }
    case '/dominio_estado': {
      const status = args[1]
      if (!args[0] || !status || !['verificado', 'activo', 'retirado'].includes(status)) { await say(ctx, 'Uso: /dominio_estado &lt;dominio&gt; &lt;verificado|activo|retirado&gt;'); return }
      await propose(ctx, 'domain_status', { domain: args[0], status }, `🌐 Cambiar <b>${escapeHtml(args[0])}</b> a <b>${status}</b>. “Activo” hace que el dominio sirva la tienda: confirma antes que el DNS y el dominio en Cloudflare estén listos.`)
      return
    }
    case '/consumo': await showAiAlerts(ctx); return
    case '/errores': await showErrors(ctx); return
    case '/cancelar': {
      await ctx.db.batch([
        ctx.db.prepare('DELETE FROM platform_conversations WHERE chat_id = ?').bind(String(ctx.chatId)),
        ctx.db.prepare(`UPDATE platform_operations SET status = 'cancelled', completed_at = datetime('now') WHERE chat_id = ? AND status = 'pending'`).bind(String(ctx.chatId)),
      ])
      await say(ctx, 'Listo, cancelé lo que estaba pendiente. No se aplicó ningún cambio.', menuKeyboard())
      return
    }
    default: await say(ctx, 'No conozco ese comando. Escribe /ayuda.', menuKeyboard())
  }
}

async function resolveStoreRef(db: D1Database, ref: string | undefined): Promise<{ id: number; slug: string; name: string; status: string } | null> {
  if (!ref) return null
  const clean = ref.trim().replace(/^["“']|["”']$/g, '')
  const bySlug = await getStoreBySlug(db, clean.toLowerCase())
  if (bySlug) return bySlug
  const bySlugified = await getStoreBySlug(db, slugify(clean))
  if (bySlugified) return bySlugified
  return db.prepare('SELECT id, slug, name, status FROM stores WHERE lower(name) = lower(?)').bind(clean).first()
}

async function requireStoreRef(ctx: MasterContext, ref: string | undefined): Promise<{ id: number; slug: string; name: string; status: string } | null> {
  const store = await resolveStoreRef(ctx.db, ref)
  if (!store) await say(ctx, ref ? `No encontré la tienda “${escapeHtml(ref)}”. Usa /tiendas para ver las direcciones.` : 'Indica la dirección de la tienda. Usa /tiendas para verlas.')
  return store
}

const STATUS_LABELS: Record<string, string> = { draft: '📝 Borrador', active: '🟢 Activa', suspended: '⏸ Suspendida', cancelled: '⛔ Cancelada' }

async function showStores(ctx: MasterContext, filter?: string): Promise<void> {
  const status = filter ? ({ activas: 'active', activa: 'active', borrador: 'draft', borradores: 'draft', suspendidas: 'suspended', suspendida: 'suspended' } as Record<string, string>)[filter.toLowerCase()] : undefined
  const stores = await listStores(ctx.db, { status })
  if (!stores.length) { await say(ctx, 'No hay tiendas con ese filtro.', menuKeyboard()); return }
  const lines = stores.slice(0, 25).map((store) => `${STATUS_LABELS[store.status] || store.status} <b>${escapeHtml(store.name)}</b> · <code>${escapeHtml(store.slug)}</code>\n   ${store.products} productos · ${store.ordersLast30} pedidos/30d · IA ${store.aiPercent}% · plan ${escapeHtml(store.planCode)}`)
  const buttons = stores.slice(0, 12).map((store) => [{ text: `${store.name}`, callback_data: `mt:store:${store.slug}` }])
  await say(ctx, `🏪 <b>Tiendas (${stores.length})</b>\n\n${lines.join('\n')}`, { inline_keyboard: [...buttons, [{ text: '↩ Menú', callback_data: 'mt:menu' }]] })
}

async function showStore(ctx: MasterContext, ref: string): Promise<void> {
  const store = await requireStoreRef(ctx, ref)
  if (!store) return
  const detail = await getStoreDetail(ctx.db, ctx.env, store.slug)
  const owner = (detail.members as Array<{ role: string; email: string | null; telegramLinked: number }>).find((member) => member.role === 'owner')
  const health = detail.health.map((check) => `${check.ok ? '✅' : check.key === 'whatsapp' ? '⚠️' : '❌'} ${escapeHtml(check.label)}${check.detail ? ` (${escapeHtml(check.detail)})` : ''}`).join('\n')
  const keyboard: Keyboard = { inline_keyboard: [
    detail.store.status === 'active'
      ? [{ text: '⏸ Suspender', callback_data: `mt:suspend:${store.slug}` }]
      : [{ text: '🚀 Activar', callback_data: `mt:activate:${store.slug}` }],
    [{ text: '🔑 Nuevos accesos', callback_data: `mt:access:${store.slug}` }, { text: '💳 Plan', callback_data: `mt:plans:${store.slug}` }],
    ...(detail.store.publicUrl.startsWith('https://') ? [[{ text: '🌐 Abrir tienda', url: detail.store.publicUrl }]] : []),
    [{ text: '↩ Tiendas', callback_data: 'mt:stores' }],
  ] }
  await say(ctx,
    `🏪 <b>${escapeHtml(detail.store.name)}</b> · <code>${escapeHtml(detail.store.slug)}</code>\n` +
    `Estado: ${STATUS_LABELS[detail.store.status] || detail.store.status} · Plan: ${escapeHtml(detail.store.plan_code)} · Plantilla: ${escapeHtml(detail.store.template)}\n` +
    `Propietario: ${owner ? `${escapeHtml(owner.email || 'sin correo')}${owner.telegramLinked ? ' · Telegram ✅' : ' · Telegram pendiente'}` : '<i>sin asignar</i>'}\n` +
    `Catálogo: ${detail.counts?.products ?? 0} productos · ${detail.counts?.categories ?? 0} categorías · ${detail.counts?.pendingOrders ?? 0} pedidos pendientes\n` +
    `IA este mes: ${detail.ai.requests} solicitudes · ${formatUsd(detail.ai.costMicros)} de ${formatUsd(detail.ai.budgetMicros)} (estimado)${detail.ai.enabled ? '' : ' · desactivada'}\n` +
    `Tienda: ${escapeHtml(detail.store.publicUrl)}\nPanel: ${escapeHtml(detail.store.adminUrl)}\n\n<b>Salud</b>\n${health}`,
    keyboard)
}

async function showSummary(ctx: MasterContext): Promise<void> {
  const summary = await platformSummary(ctx.db) as Record<string, number | string>
  await say(ctx,
    `📊 <b>Resumen de la plataforma</b> · ${summary.period}\n\n` +
    `Tiendas: <b>${summary.stores}</b> (🟢 ${summary.active} · 📝 ${summary.draft} · ⏸ ${summary.suspended})\n` +
    `Productos publicados: ${summary.products}\nPedidos últimos 30 días: ${summary.ordersLast30} · pendientes: ${summary.pendingOrders}\n` +
    `IA este mes: ${summary.aiRequests} solicitudes · ${formatUsd(Number(summary.aiCostMicros))} (estimado)\n` +
    `Errores últimas 24 h: ${summary.errorsLast24h} · Aprovisionamientos fallidos: ${summary.failedJobs}`,
    { inline_keyboard: [
      [{ text: '🩺 Salud técnica', callback_data: 'mt:health' }, { text: '⚠️ Errores recientes', callback_data: 'mt:errors' }],
      [{ text: '↩ Menú', callback_data: 'mt:menu' }],
    ] })
}

async function showOwners(ctx: MasterContext): Promise<void> {
  const stores = await listStores(ctx.db)
  if (!stores.length) { await say(ctx, 'Todavía no hay tiendas. Crea la primera con “➕ Crear nueva tienda”.', menuKeyboard()); return }
  const owners = await ctx.db.prepare(
    `SELECT m.store_id AS storeId, u.email, u.status, CASE WHEN u.telegram_user_id IS NULL THEN 0 ELSE 1 END AS telegramLinked
     FROM store_memberships m JOIN platform_users u ON u.id = m.user_id WHERE m.role = 'owner' AND m.status = 'active'`,
  ).all<{ storeId: number; email: string | null; status: string; telegramLinked: number }>()
  const byStore = new Map((owners.results || []).map((owner) => [owner.storeId, owner]))
  const lines = stores.slice(0, 25).map((store) => {
    const owner = byStore.get(store.id)
    const detail = owner
      ? `${escapeHtml(owner.email || 'sin correo')} · Telegram ${owner.telegramLinked ? '✅' : 'pendiente'}${owner.status === 'active' ? '' : ' · panel sin activar'}`
      : store.id === PRIMARY_STORE_ID && ctx.env.TELEGRAM_OWNER_ID ? 'dueño original por Telegram (configuración heredada)' : '<i>sin propietario asignado</i>'
    return `${owner ? '👤' : '⚠️'} <b>${escapeHtml(store.name)}</b> · <code>${escapeHtml(store.slug)}</code>\n   ${detail}`
  })
  const buttons = stores.slice(0, 10).filter((store) => byStore.has(store.id)).map((store) => [{ text: `🔑 Nuevos accesos · ${store.name}`, callback_data: `mt:access:${store.slug}` }])
  await say(ctx,
    `👤 <b>Propietarios</b>\n\n${lines.join('\n')}\n\n` +
    'Para asignar o cambiar el propietario: <code>/asignar_admin dirección correo</code> (o su ID de Telegram). Recibirá accesos de un solo uso; nunca se envían contraseñas.',
    { inline_keyboard: [...buttons, [{ text: '↩ Menú', callback_data: 'mt:menu' }]] })
}

async function showConfig(ctx: MasterContext): Promise<void> {
  const plans = await ctx.db.prepare(
    `SELECT code, name, setup_price AS setup, monthly_price AS monthly, currency, ai_monthly_budget_micros AS budget, max_products AS maxProducts
     FROM plans WHERE is_active = 1 AND code <> 'legacy' ORDER BY sort_order`,
  ).all<{ code: string; name: string; setup: number; monthly: number; currency: string; budget: number; maxProducts: number }>()
  const money = (amount: number, currency: string) => `${currency} ${amount.toLocaleString('es-CO')}`
  const planLines = (plans.results || []).map((plan) => `• <b>${escapeHtml(plan.name)}</b> (<code>${escapeHtml(plan.code)}</code>) · IA ${formatUsd(plan.budget)}/mes · hasta ${plan.maxProducts} productos · ` +
    (plan.setup || plan.monthly ? `${money(plan.setup, plan.currency)} inicial + ${money(plan.monthly, plan.currency)}/mes` : 'precio por definir'))
  const prices = geminiPrices(ctx.env)
  const cap = Number(ctx.env.PLATFORM_AI_MONTHLY_CAP_MICROS || 0)
  const assistant = ctx.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '')
  await say(ctx, [
    '⚙️ <b>Configuración de la plataforma</b>',
    '',
    `Entorno: ${escapeHtml(ctx.env.ENVIRONMENT || 'sin definir')}`,
    `Sitio público: ${ctx.env.PUBLIC_STORE_BASE_URL ? escapeHtml(ctx.env.PUBLIC_STORE_BASE_URL) : 'no configurado'}`,
    `Asistente de tiendas: ${assistant ? `@${escapeHtml(assistant)}` : 'usuario no configurado (los propietarios se vinculan con /link CÓDIGO)'}`,
    `IA: modelo ${escapeHtml(geminiModel(ctx.env))} · ${ctx.env.GEMINI_API_KEY ? 'clave configurada' : 'sin clave'} · costo estimado ${formatUsd(prices.input)} / ${formatUsd(prices.output)} por millón de tokens (entrada / salida)`,
    `Tope mensual de IA de la plataforma: ${cap > 0 ? formatUsd(cap) : 'sin tope global (aplican los límites de cada tienda)'}`,
    `Administradores de este bot: ${masterAdminIds(ctx.env).size}`,
    '',
    '<b>Planes</b>',
    ...(planLines.length ? planLines : ['Sin planes activos.']),
    '',
    '<i>Los planes de cada tienda se cambian con /plan; precios, claves y tokens se gestionan en Cloudflare y nunca se muestran aquí.</i>',
  ].join('\n'), menuKeyboard())
}

async function showInvoices(ctx: MasterContext, filter?: string): Promise<void> {
  const invoices = await listInvoices(ctx.db, filter && ['pendiente', 'pagada', 'anulada'].includes(filter) ? { status: filter } : filter ? { slug: filter } : { status: 'pendiente' })
  if (!invoices.length) { await say(ctx, '🧾 No hay facturas con ese filtro. Genera las del mes con /facturar.'); return }
  const lines = invoices.slice(0, 20).map((invoice) => `#${invoice.id} · ${escapeHtml(invoice.store_name)} · ${escapeHtml(invoice.concept)} · ${escapeHtml(invoice.period)} · ${invoice.amount.toLocaleString('es-CO')} ${escapeHtml(invoice.currency)} · ${invoice.status}${invoice.due_date ? ` · vence ${escapeHtml(invoice.due_date)}` : ''}`)
  await say(ctx, `🧾 <b>Facturas</b>\n\n${lines.join('\n')}\n\nMarca pagos con /pagada &lt;número&gt; o anula con /anular &lt;número&gt;.`)
}

async function showAiAlerts(ctx: MasterContext): Promise<void> {
  const alerts = await aiUsageAlerts(ctx.db)
  const lines = alerts.map((alert) => `• ${escapeHtml(alert.name)} (${escapeHtml(alert.slug)}): ${alert.percent} % de ${formatUsd(alert.budgetMicros)}`)
  await say(ctx, alerts.length
    ? `🤖 <b>Consumo de IA sobre el umbral de aviso</b>\n\n${lines.join('\n')}\n\nAjusta con /limite_ia &lt;dirección&gt; &lt;USD&gt;.`
    : '🤖 Ninguna tienda supera su umbral de aviso de IA este mes.')
}

async function showHealth(ctx: MasterContext): Promise<void> {
  const items = await storesHealth(ctx.db)
  const lines = items.map((item) => {
    const failing = item.checks.filter((check) => !check.ok)
    const icon = failing.some((check) => check.key !== 'whatsapp') || item.errorsLast24h ? '❌' : failing.length ? '⚠️' : '✅'
    return `${icon} <b>${escapeHtml(item.name)}</b> (${escapeHtml(item.slug)})${failing.length ? ` — ${failing.map((check) => escapeHtml(check.label)).join(', ')}` : ''}${item.errorsLast24h ? ` · ${item.errorsLast24h} error(es) 24 h` : ''}`
  })
  await say(ctx, `🩺 <b>Salud técnica</b>\n\n${lines.join('\n') || 'Sin tiendas.'}`, menuKeyboard())
}

async function showErrors(ctx: MasterContext): Promise<void> {
  const events = await recentEvents(ctx.db, { level: 'error', limit: 10 }) as Array<{ code: string; source: string; detail: string; createdAt: string; slug: string | null }>
  const lines = events.map((event) => `• ${escapeHtml(event.createdAt.slice(5, 16))} · ${escapeHtml(event.slug || 'plataforma')} · ${escapeHtml(event.source)}/${escapeHtml(event.code)}${event.detail ? ` — ${escapeHtml(event.detail.slice(0, 80))}` : ''}`)
  await say(ctx, lines.length ? `⚠️ <b>Errores recientes</b>\n${lines.join('\n')}` : '✅ No hay errores registrados recientemente.', menuKeyboard())
}

// ---------------------------------------------------------------------------
// Confirmed operations
// ---------------------------------------------------------------------------

type PlatformAction = 'activate_store' | 'suspend_store' | 'set_plan' | 'set_ai_budget' | 'assign_owner' | 'regenerate_access' | 'set_domain' | 'generate_invoices' | 'invoice_status' | 'domain_status'

async function propose(ctx: MasterContext, action: PlatformAction, params: Record<string, unknown>, summary: string): Promise<void> {
  await ctx.db.prepare(`UPDATE platform_operations SET status = 'expired', completed_at = datetime('now') WHERE chat_id = ? AND status = 'pending' AND expires_at <= unixepoch()`).bind(String(ctx.chatId)).run()
  const operationId = crypto.randomUUID()
  try {
    await ctx.db.prepare(`INSERT INTO platform_operations (operation_id, chat_id, actor, action, params_json, summary, expires_at) VALUES (?, ?, ?, ?, ?, ?, unixepoch() + 600)`)
      .bind(operationId, String(ctx.chatId), ctx.actor, action, JSON.stringify(params), summary).run()
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) {
      await say(ctx, 'Hay otra operación esperando confirmación. Confírmala o usa /cancelar.')
      return
    }
    throw error
  }
  await say(ctx, `<b>Confirma esta operación</b>\n${summary}\n\n<i>Vence en 10 minutos.</i>`, { inline_keyboard: [[
    { text: '✅ Confirmar', callback_data: `mt:op:confirm:${operationId}` }, { text: '✖ Cancelar', callback_data: `mt:op:cancel:${operationId}` },
  ]] })
}

async function proposeStatus(ctx: MasterContext, ref: string | undefined, status: 'active' | 'suspended', reason?: string): Promise<void> {
  const store = await requireStoreRef(ctx, ref)
  if (!store) return
  if (store.status === status) { await say(ctx, `La tienda ya está ${status === 'active' ? 'activa' : 'suspendida'}.`); return }
  await propose(ctx, status === 'active' ? 'activate_store' : 'suspend_store', { slug: store.slug, reason: reason || null },
    status === 'active'
      ? `🚀 Activar y publicar <b>${escapeHtml(store.name)}</b> (${escapeHtml(store.slug)}). Será visible para los compradores.`
      : `⏸ Suspender <b>${escapeHtml(store.name)}</b> (${escapeHtml(store.slug)}).${reason ? `\nMotivo: ${escapeHtml(reason)}` : ''}\nLa tienda dejará de estar visible y su asistente quedará en pausa. Los datos se conservan.`)
}

async function proposePlan(ctx: MasterContext, ref: string | undefined, planCode: string | undefined): Promise<void> {
  const store = await requireStoreRef(ctx, ref)
  if (!store) return
  const plans = await ctx.db.prepare('SELECT code, name, ai_monthly_budget_micros AS budget FROM plans WHERE is_active = 1 AND code <> ? ORDER BY sort_order').bind('legacy').all<{ code: string; name: string; budget: number }>()
  const code = planCode ? planCode.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() : ''
  const plan = (plans.results || []).find((item) => item.code === code)
  if (!plan) {
    await say(ctx, `¿Qué plan asigno a <b>${escapeHtml(store.name)}</b>?`, { inline_keyboard: (plans.results || []).map((item) => [{ text: `${item.name} · IA ${formatUsd(item.budget)}/mes`, callback_data: `mt:setplan:${store.slug}:${item.code}` }]) })
    return
  }
  await propose(ctx, 'set_plan', { slug: store.slug, planCode: plan.code }, `💳 Cambiar el plan de <b>${escapeHtml(store.name)}</b> a <b>${escapeHtml(plan.name)}</b>.\nEl límite de IA pasará a ${formatUsd(plan.budget)} por mes.`)
}

async function proposeAiBudget(ctx: MasterContext, ref: string | undefined, amount: string | undefined): Promise<void> {
  const store = await requireStoreRef(ctx, ref)
  if (!store) return
  const budgetUsd = Number(String(amount || '').replace(',', '.').replace(/[^\d.]/g, ''))
  if (!amount || !Number.isFinite(budgetUsd) || budgetUsd < 0 || budgetUsd > 10_000) { await say(ctx, 'Indica el límite mensual en dólares. Ejemplo: /limite_ia moda-urbana 5'); return }
  await propose(ctx, 'set_ai_budget', { slug: store.slug, budgetUsd }, `🤖 Fijar el límite mensual de IA de <b>${escapeHtml(store.name)}</b> en <b>${formatUsd(Math.round(budgetUsd * 1_000_000))}</b> (costo estimado).${budgetUsd === 0 ? '\nCon 0 la IA queda bloqueada para esta tienda.' : ''}`)
}

async function proposeOwner(ctx: MasterContext, ref: string | undefined, contact: string | undefined): Promise<void> {
  const store = await requireStoreRef(ctx, ref)
  if (!store) return
  if (!contact) { await say(ctx, 'Indica el correo o el ID numérico de Telegram. Ejemplo: /asignar_admin moda-urbana duena@correo.com'); return }
  const isTelegram = /^\d{4,15}$/.test(contact)
  await propose(ctx, 'assign_owner', { slug: store.slug, ...(isTelegram ? { telegramUserId: contact } : { email: contact }) },
    `👤 Asignar como propietario de <b>${escapeHtml(store.name)}</b> a ${isTelegram ? `Telegram ${escapeHtml(contact)}` : escapeHtml(contact)}.\nSi ya había un propietario, quedará como administrador.`)
}

async function proposeAccess(ctx: MasterContext, ref: string | undefined): Promise<void> {
  const store = await requireStoreRef(ctx, ref)
  if (!store) return
  await propose(ctx, 'regenerate_access', { slug: store.slug }, `🔑 Generar nuevos códigos de acceso para el propietario de <b>${escapeHtml(store.name)}</b>. Los códigos anteriores sin usar dejarán de funcionar.`)
}

async function proposeDomain(ctx: MasterContext, ref: string | undefined, domain: string | undefined): Promise<void> {
  const store = await requireStoreRef(ctx, ref)
  if (!store) return
  if (!domain) { await say(ctx, 'Indica el dominio. Ejemplo: /dominio moda-urbana www.modaurbana.com'); return }
  await propose(ctx, 'set_domain', { slug: store.slug, domain }, `🌐 Registrar el dominio <b>${escapeHtml(domain)}</b> para <b>${escapeHtml(store.name)}</b>.\nQuedará “pendiente” hasta configurar el DNS y el dominio en Cloudflare (paso manual documentado).`)
}

async function confirmOperation(ctx: MasterContext, operationId: string): Promise<void> {
  const operation = await ctx.db.prepare(
    `UPDATE platform_operations SET status = 'applying' WHERE operation_id = ? AND chat_id = ? AND status = 'pending' AND expires_at > unixepoch()
     RETURNING action, params_json`,
  ).bind(operationId, String(ctx.chatId)).first<{ action: PlatformAction; params_json: string }>()
  if (!operation) { await say(ctx, 'Esa operación ya venció o se procesó.'); return }
  const params = JSON.parse(operation.params_json) as Record<string, any>
  let message: string
  try {
    switch (operation.action) {
      case 'activate_store': {
        const result = await setStoreStatus(ctx.db, params.slug, 'active', ctx.actor)
        message = `🚀 <b>${escapeHtml(result.store.name)}</b> ya está activa y visible.`
        break
      }
      case 'suspend_store': {
        const result = await setStoreStatus(ctx.db, params.slug, 'suspended', ctx.actor, params.reason || undefined)
        message = `⏸ <b>${escapeHtml(result.store.name)}</b> quedó suspendida. Sus datos se conservan.`
        break
      }
      case 'set_plan': {
        const result = await setStorePlan(ctx.db, params.slug, params.planCode, ctx.actor)
        message = `💳 Plan de <b>${escapeHtml(result.store.name)}</b>: ${escapeHtml(result.plan.name)}.`
        break
      }
      case 'set_ai_budget': {
        const result = await setStoreAiBudget(ctx.db, params.slug, { budgetUsd: Number(params.budgetUsd), enabled: Number(params.budgetUsd) > 0 }, ctx.actor)
        message = `🤖 Límite de IA de <b>${escapeHtml(result.store.name)}</b>: ${formatUsd(result.budgetMicros)} por mes.`
        break
      }
      case 'assign_owner': {
        const result = await assignOwner(ctx.db, ctx.env, params.slug, { email: params.email, telegramUserId: params.telegramUserId }, ctx.actor)
        message = `👤 Propietario asignado a <b>${escapeHtml(result.store.name)}</b>.${await ownerAccessText(ctx, result)}`
        break
      }
      case 'regenerate_access': {
        const result = await regenerateOwnerAccess(ctx.db, ctx.env, params.slug, ctx.actor)
        message = `🔑 Nuevos accesos para <b>${escapeHtml(result.store.name)}</b>.${await ownerAccessText(ctx, result)}`
        break
      }
      case 'set_domain': {
        const result = await requestCustomDomain(ctx.db, params.slug, params.domain, ctx.actor)
        message = `🌐 Dominio <b>${escapeHtml(result.domain)}</b> registrado como pendiente para ${escapeHtml(result.store.name)}. Sigue la guía de dominio propio para activarlo.`
        break
      }
      case 'generate_invoices': {
        const result = await generateInvoices(ctx.db, String(params.period), ctx.actor)
        message = `🧾 Facturas del periodo ${escapeHtml(result.period)}: ${result.created} nueva(s). Las que ya existían no se duplicaron.`
        break
      }
      case 'invoice_status': {
        const invoice = await setInvoiceStatus(ctx.db, Number(params.id), params.status, ctx.actor)
        message = `🧾 Factura #${invoice.id} de <b>${escapeHtml(invoice.store_name)}</b>: ${invoice.status}.`
        break
      }
      case 'domain_status': {
        const result = await setDomainStatus(ctx.db, String(params.domain), params.status, ctx.actor)
        message = `🌐 Dominio <b>${escapeHtml(result.domain)}</b>: ${result.status}.`
        break
      }
    }
    await ctx.db.prepare(`UPDATE platform_operations SET status = 'applied', completed_at = datetime('now') WHERE operation_id = ?`).bind(operationId).run()
    await say(ctx, `✅ ${message}`, menuKeyboard())
  } catch (error) {
    await ctx.db.prepare(`UPDATE platform_operations SET status = 'failed', completed_at = datetime('now'), result_json = ? WHERE operation_id = ?`)
      .bind(JSON.stringify({ code: error instanceof PlatformError ? error.code : 'UNEXPECTED' }), operationId).run()
    if (error instanceof PlatformError) { await say(ctx, `No se aplicó: ${escapeHtml(error.message)}`, menuKeyboard()); return }
    throw error
  }
}

/** Access text naming the shared assistant, with a one-tap link when its username is known. */
async function ownerAccessText(ctx: MasterContext, access: { activationUrl: string | null; telegramLinkCode: string | null; telegramDeepLink: string | null }): Promise<string> {
  const username = await assistantUsername(ctx.env)
  const deepLink = access.telegramDeepLink || (access.telegramLinkCode && username ? `https://t.me/${username}?start=link_${access.telegramLinkCode.replaceAll('-', '')}` : null)
  return accessText({ ...access, telegramDeepLink: deepLink }, username)
}

function accessText(access: { activationUrl: string | null; telegramLinkCode: string | null; telegramDeepLink: string | null }, assistant?: string | null): string {
  const lines: string[] = []
  if (access.activationUrl) lines.push(`🔐 Activación del panel (un solo uso, 72 h):\n${escapeHtml(access.activationUrl)}`)
  if (access.telegramDeepLink) lines.push(`🤖 Asistente IA en Telegram — vincular con un toque (72 h):\n${escapeHtml(access.telegramDeepLink)}`)
  else if (access.telegramLinkCode) lines.push(`🤖 Código para el asistente IA (72 h): <code>/link ${escapeHtml(access.telegramLinkCode)}</code>\nEl propietario debe enviarlo al asistente de tiendas${assistant ? ` @${escapeHtml(assistant)}` : ''}.`)
  return lines.length ? `\n\n${lines.join('\n\n')}\n\n<i>Comparte estos accesos solo con el propietario. No se guardan en texto plano.</i>` : ''
}

// ---------------------------------------------------------------------------
// /crear_tienda wizard
// ---------------------------------------------------------------------------

async function readWizard(ctx: MasterContext): Promise<{ step: WizardStep; data: WizardData } | null> {
  const row = await ctx.db.prepare(`SELECT step, data_json FROM platform_conversations WHERE chat_id = ? AND flow = 'create_store' AND expires_at > unixepoch()`).bind(String(ctx.chatId)).first<{ step: WizardStep; data_json: string }>()
  if (!row) return null
  try { return { step: row.step, data: JSON.parse(row.data_json) as WizardData } } catch { return null }
}

async function saveWizard(ctx: MasterContext, step: WizardStep, data: WizardData): Promise<void> {
  await ctx.db.prepare(
    `INSERT INTO platform_conversations (chat_id, flow, step, data_json, expires_at) VALUES (?, 'create_store', ?, ?, unixepoch() + 3600)
     ON CONFLICT(chat_id) DO UPDATE SET flow = 'create_store', step = excluded.step, data_json = excluded.data_json, expires_at = excluded.expires_at, updated_at = datetime('now')`,
  ).bind(String(ctx.chatId), step, JSON.stringify(data)).run()
}

async function startWizard(ctx: MasterContext, data: WizardData): Promise<void> {
  if (data.name) {
    await saveWizard(ctx, 'business', { ...data, slug: await suggestSlug(ctx.db, data.name) })
    await say(ctx, `¡Vamos a crear <b>${escapeHtml(data.name)}</b>! 🎉\n\n¿Qué tipo de comercio es? Por ejemplo: ropa, calzado, tecnología, mascotas, belleza…`, cancelKeyboard())
    return
  }
  await saveWizard(ctx, 'name', {})
  await say(ctx, '¡Vamos a crear una tienda nueva! 🎉 Te haré unas preguntas cortas y al final verás un resumen antes de crear nada.\n\n¿Cómo se llama el negocio?', cancelKeyboard())
}

function cancelKeyboard(): Keyboard {
  return { inline_keyboard: [[{ text: '✖ Cancelar', callback_data: 'mt:wz:cancel' }]] }
}

async function promptStep(ctx: MasterContext, step: WizardStep, data: WizardData): Promise<void> {
  await saveWizard(ctx, step, data)
  switch (step) {
    case 'name': await say(ctx, '¿Cómo se llama el negocio?', cancelKeyboard()); return
    case 'slug': await say(ctx, `Escribe la dirección web (solo minúsculas, números y guiones). Actual: <code>${escapeHtml(data.slug || '')}</code>`, cancelKeyboard()); return
    case 'business': await say(ctx, '¿Qué tipo de comercio es? Por ejemplo: ropa, calzado, tecnología, mascotas, belleza…', cancelKeyboard()); return
    case 'owner':
      await say(ctx, '¿Quién es el propietario? Escribe su <b>nombre</b> y su <b>correo</b> (o su ID numérico de Telegram).\nEjemplo: <code>María Gómez maria@correo.com</code>\nRecibirá accesos de un solo uso; nunca enviamos contraseñas.', cancelKeyboard())
      return
    case 'whatsapp':
      await say(ctx, '¿Cuál es el WhatsApp comercial para recibir pedidos? Escríbelo con el código de país, por ejemplo <code>+573001234567</code>.', { inline_keyboard: [[{ text: 'Lo configura el propietario', callback_data: 'mt:wz:skipwa' }], [{ text: '✖ Cancelar', callback_data: 'mt:wz:cancel' }]] })
      return
    case 'style':
      await say(ctx, 'Elige la plantilla visual que mejor encaja con el negocio. Puedes cambiarla después desde el panel.', { inline_keyboard: [
        ...TEMPLATE_KEYS.reduce<Array<Array<{ text: string; callback_data: string }>>>((rows, key, index) => {
          if (index % 2 === 0) rows.push([])
          rows.at(-1)!.push({ text: TEMPLATE_LABELS[key], callback_data: `mt:wz:style:${key}` })
          return rows
        }, []),
        [{ text: '✖ Cancelar', callback_data: 'mt:wz:cancel' }],
      ] })
      return
    case 'color':
      await say(ctx, 'Escribe los colores principales de la marca: uno o dos (principal y de acento).\nEjemplos: <code>azul oscuro y dorado</code> · <code>#153D70 #B08D57</code>', { inline_keyboard: [
        [{ text: 'Usar los colores de la plantilla', callback_data: 'mt:wz:skipcolor' }], [{ text: '✖ Cancelar', callback_data: 'mt:wz:cancel' }],
      ] })
      return
    case 'logo':
      await say(ctx, 'Si tienes el logotipo, envíalo como foto o archivo de imagen (PNG, JPG o WebP de al menos 128 px). Es opcional: también se puede subir después desde el panel.', { inline_keyboard: [
        [{ text: 'Sin logotipo por ahora', callback_data: 'mt:wz:skiplogo' }], [{ text: '✖ Cancelar', callback_data: 'mt:wz:cancel' }],
      ] })
      return
    case 'plan': {
      const plans = await ctx.db.prepare(`SELECT code, name, ai_monthly_budget_micros AS budget FROM plans WHERE is_active = 1 AND code <> 'legacy' ORDER BY sort_order`).all<{ code: string; name: string; budget: number }>()
      await say(ctx, '¿Con qué plan empieza?', { inline_keyboard: [...(plans.results || []).map((plan) => [{ text: `${plan.name} · IA ${formatUsd(plan.budget)}/mes`, callback_data: `mt:wz:plan:${plan.code}` }]), [{ text: '✖ Cancelar', callback_data: 'mt:wz:cancel' }]] })
      return
    }
    case 'summary': await showWizardSummary(ctx, data); return
  }
}

function ownerLabel(data: WizardData): string {
  const contact = [data.ownerEmail, data.ownerTelegramId ? `Telegram ${data.ownerTelegramId}` : null].filter(Boolean).join(' · ')
  return [data.ownerName, contact].filter(Boolean).join(' · ') || '—'
}

async function showWizardSummary(ctx: MasterContext, data: WizardData): Promise<void> {
  const existingName = await ctx.db.prepare('SELECT slug FROM stores WHERE lower(name) = lower(?)').bind(data.name || '').first<{ slug: string }>()
  const plan = await ctx.db.prepare('SELECT name FROM plans WHERE code = ?').bind(data.planCode || 'basico').first<{ name: string }>()
  const colors = data.primaryColor ? `${data.primaryColor}${data.accentColor ? ` y ${data.accentColor}` : ''}` : 'los de la plantilla'
  await say(ctx,
    `<b>Resumen de la nueva tienda</b>\n\n` +
    `Negocio: <b>${escapeHtml(data.name)}</b>\nDirección pública: ${escapeHtml(publicStoreUrl(ctx.env.PUBLIC_STORE_BASE_URL, { id: 0, slug: data.slug || '' }))}\n` +
    `Tipo de comercio: ${escapeHtml(data.businessType)}\nPropietario: ${escapeHtml(ownerLabel(data))}\n` +
    `WhatsApp: ${escapeHtml(data.whatsapp || 'lo configura el propietario')}\n` +
    `Plantilla: ${escapeHtml(TEMPLATE_LABELS[data.template || 'moderno'])} · colores: ${escapeHtml(colors)}\n` +
    `Logotipo: ${data.logoFileId ? '✅ recibido' : 'sin logotipo (se puede subir después)'}\n` +
    `Plan: ${escapeHtml(plan?.name || data.planCode || 'Básico')}\n\n` +
    (existingName ? `⚠️ Ya existe una tienda con ese nombre (${escapeHtml(existingName.slug)}). Revisa que no sea un duplicado.\n\n` : '') +
    `La tienda se creará en <b>borrador</b>: privada hasta que la actives.`,
    { inline_keyboard: [
      [{ text: '✅ Crear tienda', callback_data: 'mt:wz:create' }],
      [{ text: '✏️ Modificar información', callback_data: 'mt:wz:edit' }, { text: '✖ Cancelar', callback_data: 'mt:wz:cancel' }],
    ] })
}

/** Up to two brand colors (primary, accent) from names or hex codes, in the order written. */
export function parseColors(text: string): string[] {
  const found: Array<{ index: number; value: string }> = []
  let rest = text.toLowerCase()
  for (const match of rest.matchAll(/#([0-9a-f]{6})\b|\b(?=[0-9a-f]*\d)([0-9a-f]{6})\b/g)) found.push({ index: match.index!, value: `#${(match[1] || match[2])!.toUpperCase()}` })
  for (const name of Object.keys(NAMED_COLORS).sort((a, b) => b.length - a.length)) {
    for (let at = rest.indexOf(name); at >= 0; at = rest.indexOf(name)) {
      found.push({ index: at, value: NAMED_COLORS[name]! })
      rest = `${rest.slice(0, at)}${' '.repeat(name.length)}${rest.slice(at + name.length)}`
    }
  }
  return [...new Set(found.sort((a, b) => a.index - b.index).map((item) => item.value))].slice(0, 2)
}

/** Owner answer: name plus email and/or numeric Telegram id, in any order. */
export function parseOwner(text: string): { name?: string; email?: string; telegramId?: string } | null {
  const email = text.match(/[^\s@,;<>()]{1,64}@[^\s@,;<>()]{1,190}\.[a-z]{2,24}/i)?.[0]
  const telegramId = text.match(/(?:^|[\s,;])(\d{4,15})(?=$|[\s,;])/)?.[1]
  if (!email && !telegramId) return null
  const name = text.replace(email || '\u0000', ' ').replace(telegramId || '\u0000', ' ').replace(/[,;:<>()]|\b(?:correo|email|telegram|id)\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  return { ...(name.length >= 2 ? { name } : {}), ...(email ? { email: email.toLowerCase() } : {}), ...(telegramId ? { telegramId } : {}) }
}

async function receiveLogo(ctx: MasterContext, data: WizardData, fileId: string): Promise<void> {
  try {
    await downloadTelegramImage(ctx.botToken, fileId)
  } catch {
    await say(ctx, 'No pude usar esa imagen. Envía un logotipo PNG, JPG o WebP de al menos 128 px, o toca “Sin logotipo por ahora”.')
    return
  }
  // Only the Telegram file id is kept; the image is stored under the new store once it exists.
  await promptStep(ctx, data.editing ? 'summary' : 'plan', { ...data, logoFileId: fileId })
}

async function wizardAnswer(ctx: MasterContext, step: WizardStep, data: WizardData, text: string): Promise<void> {
  const next = { ...data }
  const advance = async (fallback: WizardStep) => promptStep(ctx, next.editing ? 'summary' : fallback, next)
  switch (step) {
    case 'name': {
      if (text.length < 2 || text.length > 80) { await say(ctx, 'El nombre debe tener entre 2 y 80 caracteres.'); return }
      next.name = text.trim()
      if (!next.slug || !next.editing) next.slug = await suggestSlug(ctx.db, next.name)
      await advance('business')
      return
    }
    case 'slug': {
      const slug = text.trim().toLowerCase()
      if (!isValidSlug(slug)) { await say(ctx, 'Usa entre 3 y 40 caracteres: minúsculas, números y guiones (sin espacios).'); return }
      if (await getStoreBySlug(ctx.db, slug)) { await say(ctx, 'Esa dirección ya está en uso. Prueba otra.'); return }
      next.slug = slug
      await promptStep(ctx, 'summary', next)
      return
    }
    case 'business': {
      if (text.length < 2 || text.length > 120) { await say(ctx, 'Descríbelo en pocas palabras, por ejemplo “ropa y accesorios”.'); return }
      next.businessType = text.trim()
      await advance('owner')
      return
    }
    case 'owner': {
      const owner = parseOwner(text.trim())
      if (!owner) { await say(ctx, 'Escribe el nombre y un correo válido (o el ID numérico de Telegram) del propietario. Ejemplo: María Gómez maria@correo.com'); return }
      next.ownerName = owner.name
      next.ownerEmail = owner.email
      next.ownerTelegramId = owner.telegramId
      await advance('whatsapp')
      return
    }
    case 'whatsapp': {
      const phone = text.replace(/[\s().-]/g, '')
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) { await say(ctx, 'Escríbelo con + y código de país, por ejemplo +573001234567, o toca “Lo configura el propietario”.'); return }
      next.whatsapp = phone
      await advance('style')
      return
    }
    case 'color': {
      const [primary, accent] = parseColors(text)
      if (!primary) { await say(ctx, 'No reconocí esos colores. Escribe nombres como “azul oscuro y dorado” o códigos como #153D70.'); return }
      next.primaryColor = primary
      next.accentColor = accent
      await advance('logo')
      return
    }
    case 'logo':
      await say(ctx, 'Envíame el logotipo como imagen, o toca “Sin logotipo por ahora”.')
      return
    default:
      await say(ctx, 'Usa los botones del último mensaje, o /cancelar para salir.')
  }
}

async function handleWizardCallback(ctx: MasterContext, action: string, value?: string): Promise<void> {
  const wizard = await readWizard(ctx)
  if (action === 'cancel') {
    await ctx.db.prepare('DELETE FROM platform_conversations WHERE chat_id = ?').bind(String(ctx.chatId)).run()
    await say(ctx, 'Cancelé la creación. No se creó ninguna tienda.', menuKeyboard())
    return
  }
  if (!wizard) { await say(ctx, 'Este asistente ya venció. Escribe /crear_tienda para empezar de nuevo.'); return }
  const data = { ...wizard.data }
  switch (action) {
    case 'style':
      if (!value || !(TEMPLATE_KEYS as readonly string[]).includes(value)) return
      data.template = value as TemplateKey
      await promptStep(ctx, data.editing && (value !== 'personalizado' || data.primaryColor) ? 'summary' : 'color', data)
      return
    case 'skipwa':
      data.whatsapp = null
      await promptStep(ctx, data.editing ? 'summary' : 'style', data)
      return
    case 'skipcolor':
      delete data.primaryColor
      delete data.accentColor
      await promptStep(ctx, data.editing ? 'summary' : 'logo', data)
      return
    case 'skiplogo':
      delete data.logoFileId
      await promptStep(ctx, data.editing ? 'summary' : 'plan', data)
      return
    case 'plan':
      data.planCode = value || 'basico'
      data.editing = true
      await promptStep(ctx, 'summary', data)
      return
    case 'edit':
      await say(ctx, '¿Qué dato quieres modificar?', { inline_keyboard: [
        [{ text: 'Nombre', callback_data: 'mt:wz:field:name' }, { text: 'Dirección', callback_data: 'mt:wz:field:slug' }],
        [{ text: 'Tipo de comercio', callback_data: 'mt:wz:field:business' }, { text: 'Propietario', callback_data: 'mt:wz:field:owner' }],
        [{ text: 'WhatsApp', callback_data: 'mt:wz:field:whatsapp' }, { text: 'Plantilla', callback_data: 'mt:wz:field:style' }],
        [{ text: 'Colores', callback_data: 'mt:wz:field:color' }, { text: 'Logotipo', callback_data: 'mt:wz:field:logo' }],
        [{ text: 'Plan', callback_data: 'mt:wz:field:plan' }, { text: '↩ Volver al resumen', callback_data: 'mt:wz:field:summary' }],
      ] })
      return
    case 'field':
      if (!value || !['name', 'slug', 'business', 'owner', 'whatsapp', 'style', 'color', 'logo', 'plan', 'summary'].includes(value)) return
      data.editing = true
      await promptStep(ctx, value as WizardStep, data)
      return
    case 'create':
      await runProvisioning(ctx, data)
      return
  }
}

async function runProvisioning(ctx: MasterContext, data: WizardData): Promise<void> {
  if (!data.name || !data.slug || !data.businessType || (!data.ownerEmail && !data.ownerTelegramId)) {
    await say(ctx, 'Faltan datos para crear la tienda. Revisa el resumen.')
    await promptStep(ctx, !data.name ? 'name' : !data.businessType ? 'business' : 'owner', data)
    return
  }
  // The same confirmed summary always maps to the same request key, so a
  // double tap or a retry resumes the same job instead of creating two stores.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ chat: ctx.chatId, ...data, editing: undefined })))
  const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)
  await say(ctx, '⏳ Creando la tienda… esto toma unos segundos.')
  const result = await provisionStore(ctx.db, ctx.env, {
    name: data.name, slug: data.slug, businessType: data.businessType, template: data.template || 'moderno', primaryColor: data.primaryColor, accentColor: data.accentColor,
    whatsapp: data.whatsapp || undefined, ownerName: data.ownerName, ownerEmail: data.ownerEmail, ownerTelegramId: data.ownerTelegramId, planCode: data.planCode || 'basico',
  }, { requestKey: `master:${fingerprint}`, actor: ctx.actor })
  const logo = result.status === 'completed' && data.logoFileId ? await applyLogo(ctx, result.storeId!, data.logoFileId) : 'none'
  await reportProvisioning(ctx, result, data, logo)
}

/** Stores the wizard's logo under the new store. A failure never undoes the store. */
async function applyLogo(ctx: MasterContext, storeId: number, fileId: string): Promise<'ok' | 'failed'> {
  if (!ctx.env.ASSETS) return 'failed'
  try {
    const image = await downloadTelegramImage(ctx.botToken, fileId)
    await setStoreLogo(ctx.db, ctx.env.ASSETS, storeId, image, ctx.actor)
    return 'ok'
  } catch (error) {
    console.error('Master logo upload failed:', error instanceof Error ? error.message : 'unknown')
    await ctx.db.prepare(`INSERT INTO platform_events (store_id, level, source, code, detail) VALUES (?, 'warning', 'master_bot', 'LOGO_FAILED', ?)`)
      .bind(storeId, (error instanceof Error ? error.message : 'unknown').slice(0, 120)).run().catch(() => undefined)
    return 'failed'
  }
}

/** Public username of the shared store assistant, for one-tap linking. */
async function assistantUsername(env: Env['Bindings']): Promise<string | null> {
  const configured = env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '').trim()
  if (configured) return configured
  if (!env.TELEGRAM_BOT_TOKEN) return null
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`, { signal: AbortSignal.timeout(8000) })
    const body = await response.json() as { ok?: boolean; result?: { username?: string } }
    return body.ok && body.result?.username ? body.result.username : null
  } catch {
    return null
  }
}

async function reportProvisioning(ctx: MasterContext, result: ProvisionResult, data: WizardData, logo: 'ok' | 'failed' | 'none'): Promise<void> {
  if (result.status === 'running') { await say(ctx, '⏳ La creación de esta tienda ya está en curso. Espera unos segundos y toca “Crear tienda” otra vez para ver el resultado.'); return }
  if (result.status === 'failed') {
    const failed = result.steps.find((step) => step.status === 'error')
    await say(ctx, `❌ <b>No se pudo crear la tienda.</b>\n${escapeHtml(failed?.detail || 'Ocurrió un error; quedó registrado.')}\n\nNo se publicó nada. Corrige el dato y toca “Reintentar”: el proceso continúa donde quedó, sin duplicar la tienda.`,
      { inline_keyboard: [[{ text: '✏️ Modificar información', callback_data: 'mt:wz:edit' }, { text: '🔁 Reintentar', callback_data: 'mt:wz:create' }], [{ text: '✖ Cancelar', callback_data: 'mt:wz:cancel' }]] })
    return
  }
  await ctx.db.prepare('DELETE FROM platform_conversations WHERE chat_id = ?').bind(String(ctx.chatId)).run()
  const username = await assistantUsername(ctx.env)
  // The owner keeps their active store; the assistant only tells them a new one is available.
  if (data.ownerTelegramId && !result.replayed && ctx.env.TELEGRAM_BOT_TOKEN) {
    await sendTelegramMessage(ctx.env.TELEGRAM_BOT_TOKEN, Number(data.ownerTelegramId),
      `🏪 Tienes una nueva tienda disponible: <b>${escapeHtml(result.name)}</b>.\nTu tienda actual no cambió. Escribe /tiendas para elegir con cuál trabajar.`, 'HTML',
      { inline_keyboard: [[{ text: '🔄 Ver mis tiendas', callback_data: 'm:switch_store' }]] }).catch(() => undefined)
  }
  const access = result.replayed
    ? '\n\n<b>Acceso del propietario</b>\nLos accesos se entregaron cuando se creó. Si se perdieron, toca “🔑 Nuevos accesos”.'
    : `\n\n<b>Acceso del propietario</b>${await ownerAccessText(ctx, { activationUrl: result.activationUrl ?? null, telegramLinkCode: result.telegramLinkCode ?? null, telegramDeepLink: result.telegramDeepLink ?? null })}` +
      (data.ownerTelegramId ? `\n🤖 Su Telegram ya quedó vinculado: puede escribir directamente al asistente${username ? ` @${escapeHtml(username)}` : ''}.` : '')
  await say(ctx,
    `🎉 <b>¡Tienda creada!</b>${result.replayed ? ' (ya existía: no se duplicó)' : ''}\n\n` +
    `🏪 <b>${escapeHtml(result.name)}</b>\n🌐 Dirección pública: ${escapeHtml(result.publicUrl)}\n` +
    `📌 Estado: 📝 Borrador — privada hasta que la actives; los compradores todavía no la ven.\n🧭 Panel de administración: ${escapeHtml(result.adminUrl)}` +
    (logo === 'ok' ? '\n🖼️ Logotipo aplicado.' : logo === 'failed' ? '\n⚠️ El logotipo no se pudo guardar; súbelo desde el panel (Apariencia).' : '') +
    access +
    '\n\n<b>Cómo administrarla</b>\n' +
    '1. Envía estos accesos solo al propietario (vencen en 72 h).\n' +
    '2. El propietario crea su contraseña con el enlace y entra al panel, o carga productos por Telegram enviando fotos al asistente.\n' +
    '3. Logotipo, colores y portada se ajustan en el panel → Apariencia.\n' +
    '4. Cuando tenga productos, toca “🚀 Activar ahora” para publicarla.',
    { inline_keyboard: [
      [{ text: '🚀 Activar ahora', callback_data: `mt:activate:${result.slug}` }, { text: '🏪 Ver ficha', callback_data: `mt:store:${result.slug}` }],
      [{ text: '🔑 Nuevos accesos', callback_data: `mt:access:${result.slug}` }, { text: '➕ Crear otra', callback_data: 'mt:create' }],
    ] })
}

// ---------------------------------------------------------------------------
// Callbacks and natural language
// ---------------------------------------------------------------------------

async function handleCallback(ctx: MasterContext, data: string): Promise<void> {
  const wizard = data.match(/^mt:wz:([a-z]+)(?::([a-z0-9_-]+))?$/)
  if (wizard) { await handleWizardCallback(ctx, wizard[1]!, wizard[2]); return }
  const op = data.match(/^mt:op:(confirm|cancel):([0-9a-f-]{36})$/)
  if (op) {
    if (op[1] === 'confirm') { await confirmOperation(ctx, op[2]!); return }
    const cancelled = await ctx.db.prepare(`UPDATE platform_operations SET status = 'cancelled', completed_at = datetime('now') WHERE operation_id = ? AND chat_id = ? AND status = 'pending' RETURNING operation_id`).bind(op[2], String(ctx.chatId)).first()
    await say(ctx, cancelled ? 'Cancelado. No se aplicó ningún cambio.' : 'Esa operación ya no estaba pendiente.', menuKeyboard())
    return
  }
  const store = data.match(/^mt:(store|activate|suspend|access|plans):([a-z0-9-]{3,40})$/)
  if (store) {
    const [, action, slug] = store
    if (action === 'store') await showStore(ctx, slug!)
    if (action === 'activate') await proposeStatus(ctx, slug, 'active')
    if (action === 'suspend') await proposeStatus(ctx, slug, 'suspended')
    if (action === 'access') await proposeAccess(ctx, slug)
    if (action === 'plans') await proposePlan(ctx, slug, undefined)
    return
  }
  const plan = data.match(/^mt:setplan:([a-z0-9-]{3,40}):([a-z0-9_-]+)$/)
  if (plan) { await proposePlan(ctx, plan[1], plan[2]); return }
  switch (data) {
    case 'mt:menu': await say(ctx, '¿Qué hacemos?', menuKeyboard()); return
    case 'mt:create': await startWizard(ctx, {}); return
    case 'mt:stores': await showStores(ctx); return
    case 'mt:owners': await showOwners(ctx); return
    case 'mt:config': await showConfig(ctx); return
    case 'mt:ask': await startAsk(ctx); return
    case 'mt:summary': await showSummary(ctx); return
    case 'mt:health': await showHealth(ctx); return
    case 'mt:errors': await showErrors(ctx); return
    case 'mt:help': await say(ctx, HELP, menuKeyboard()); return
    default: await say(ctx, 'Ese botón ya no está disponible.', menuKeyboard())
  }
}

type MasterIntent = { action: string; store?: string; name?: string; status?: string; reason?: string; plan?: string; budgetUsd?: number; contact?: string; domain?: string }

export function detectMasterIntent(text: string): MasterIntent | null {
  const lower = text.toLowerCase().trim()
  const create = text.match(/(?:crea|crear|crea(?:me)?|abre|abrir|monta|montar|registra|registrar|nueva)\s+(?:una\s+)?(?:nueva\s+)?tienda(?:\s+(?:llamada|que se llame|con el nombre|de nombre)\s+["“]?(.+?)["”]?)?\s*$/i)
  if (create) return { action: 'create_store', name: create[1]?.trim() }
  const suspend = text.match(/(?:suspende|suspender|pausa|pausar|desactiva|desactivar)\s+(?:la\s+)?(?:tienda\s+)?([a-z0-9-]{3,40})(?:\s+(?:por|porque|motivo:?)\s+(.+))?$/i)
  if (suspend) return { action: 'suspend_store', store: suspend[1], reason: suspend[2] }
  const activate = text.match(/(?:activa|activar|publica|publicar|reactiva|reactivar)\s+(?:la\s+)?(?:tienda\s+)?([a-z0-9-]{3,40})\s*$/i)
  if (activate) return { action: 'activate_store', store: activate[1] }
  const plan = text.match(/plan\s+(?:de\s+)?(?:la\s+tienda\s+)?([a-z0-9-]{3,40})\s+(?:a|al)\s+(?:plan\s+)?(b[aá]sico|profesional|premium)/i)
  if (plan) return { action: 'set_plan', store: plan[1], plan: plan[2]!.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() }
  const ai = text.match(/(?:l[ií]mite|presupuesto|tope)\s+(?:de\s+)?(?:la\s+)?(?:ia|inteligencia artificial|gemini)\s+(?:de\s+|para\s+)?(?:la\s+tienda\s+)?([a-z0-9-]{3,40})\s+(?:a|en)\s+(?:us\$?\s*)?(\d+(?:[.,]\d+)?)/i)
  if (ai) return { action: 'set_ai_budget', store: ai[1], budgetUsd: Number(ai[2]!.replace(',', '.')) }
  const detail = text.match(/(?:info(?:rmaci[oó]n)?|detalle|ficha|estado|c[oó]mo (?:est[aá]|va))\s+(?:de\s+)?(?:la\s+)?tienda\s+([a-z0-9-]{3,40})/i)
  if (detail) return { action: 'store_detail', store: detail[1] }
  if (/(?:lista|listar|muestra|mu[eé]strame|ver|cu[aá]les son)\s+(?:las\s+|mis\s+)?tiendas/.test(lower)) {
    const status = /activas/.test(lower) ? 'activas' : /borrador/.test(lower) ? 'borrador' : /suspendidas/.test(lower) ? 'suspendidas' : undefined
    return { action: 'list_stores', status }
  }
  if (/resumen|estad[ií]sticas|c[oó]mo va (?:la )?plataforma|cu[aá]ntas tiendas/.test(lower)) return { action: 'summary' }
  if (/errores|fallas|incidentes|problemas/.test(lower)) return { action: 'errors' }
  if (/salud|estado t[eé]cnico|monitoreo/.test(lower)) return { action: 'health' }
  return null
}

const masterShape = z.object({
  action: z.enum(['create_store', 'list_stores', 'store_detail', 'activate_store', 'suspend_store', 'set_plan', 'set_ai_budget', 'assign_owner', 'regenerate_access', 'summary', 'health', 'errors', 'help', 'ask']),
  store: z.string().max(80).optional(),
  name: z.string().max(80).optional(),
  status: z.string().max(20).optional(),
  reason: z.string().max(200).optional(),
  plan: z.string().max(40).optional(),
  budgetUsd: z.number().min(0).max(10000).optional(),
  contact: z.string().max(254).optional(),
  question: z.string().max(400).optional(),
})

async function handleNaturalLanguage(ctx: MasterContext, text: string): Promise<void> {
  let intent: MasterIntent | null = detectMasterIntent(text)
  if (!intent && ctx.env.GEMINI_API_KEY) {
    try {
      const result = await callGeminiJson(ctx.env, fetch, {
        system: [
          'Interpretas órdenes del administrador de una plataforma de tiendas en línea. Devuelve una sola acción permitida.',
          'No inventes direcciones de tienda, correos ni montos: si faltan, usa action=ask y explica qué falta en question.',
          'Las acciones que cambian datos siempre serán confirmadas después por el sistema.',
          UNTRUSTED_CONTENT_RULE,
        ],
        parts: [{ text: text.slice(0, 1000) }],
        maxOutputTokens: 1024,
        schema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: masterShape.shape.action.options }, store: { type: 'string' }, name: { type: 'string' }, status: { type: 'string' },
            reason: { type: 'string' }, plan: { type: 'string' }, budgetUsd: { type: 'number' }, contact: { type: 'string' }, question: { type: 'string' },
          },
          required: ['action'],
        },
      })
      await ctx.db.prepare(`INSERT INTO platform_events (level, source, code, detail) VALUES ('info', 'master_bot', 'GEMINI_USAGE', ?)`)
        .bind(`tokens ${result.usage.promptTokens}+${result.usage.outputTokens}`).run()
      const parsed = masterShape.safeParse(result.data)
      if (parsed.success) {
        if (parsed.data.action === 'ask' || parsed.data.action === 'help') { await say(ctx, escapeHtml(parsed.data.question || 'No estoy seguro de qué necesitas.'), menuKeyboard()); return }
        intent = { ...parsed.data, contact: parsed.data.contact }
      }
    } catch (error) {
      console.error('Master Gemini interpretation failed:', error instanceof Error ? error.message : 'unknown')
    }
  }
  if (!intent) { await say(ctx, 'No estoy seguro de haber entendido. Usa el menú o escribe /ayuda.', menuKeyboard()); return }
  switch (intent.action) {
    case 'create_store': await startWizard(ctx, intent.name ? { name: intent.name } : {}); return
    case 'list_stores': await showStores(ctx, intent.status); return
    case 'store_detail': if (intent.store) await showStore(ctx, intent.store); else await say(ctx, '¿De qué tienda? Indica su dirección.'); return
    case 'activate_store': await proposeStatus(ctx, intent.store, 'active'); return
    case 'suspend_store': await proposeStatus(ctx, intent.store, 'suspended', intent.reason); return
    case 'set_plan': await proposePlan(ctx, intent.store, intent.plan); return
    case 'set_ai_budget': await proposeAiBudget(ctx, intent.store, intent.budgetUsd === undefined ? undefined : String(intent.budgetUsd)); return
    case 'assign_owner': await proposeOwner(ctx, intent.store, intent.contact); return
    case 'regenerate_access': await proposeAccess(ctx, intent.store); return
    case 'summary': await showSummary(ctx); return
    case 'health': await showHealth(ctx); return
    case 'errors': await showErrors(ctx); return
    default: await say(ctx, HELP, menuKeyboard())
  }
}

// ---------------------------------------------------------------------------
// "Ayuda con IA": one question answered from platform facts only
// ---------------------------------------------------------------------------

async function startAsk(ctx: MasterContext): Promise<void> {
  const wizard = await readWizard(ctx)
  await ctx.db.prepare(
    `INSERT INTO platform_conversations (chat_id, flow, step, data_json, expires_at) VALUES (?, 'ask_ai', 'question', '{}', unixepoch() + 900)
     ON CONFLICT(chat_id) DO UPDATE SET flow = 'ask_ai', step = 'question', data_json = '{}', expires_at = excluded.expires_at, updated_at = datetime('now')`,
  ).bind(String(ctx.chatId)).run()
  await say(ctx,
    `✨ <b>Ayuda con IA</b>${wizard ? '\n<i>(Cancelé la creación de tienda que estaba en curso; no se creó nada.)</i>' : ''}\n\n` +
    'Escríbeme tu pregunta sobre la plataforma: cómo crear una tienda, qué plan conviene, cómo va una tienda, qué significa un error…\n' +
    'Si me pides un cambio (“suspende moda-urbana”), te mostraré el resumen para que lo confirmes.',
    { inline_keyboard: [[{ text: '↩ Menú', callback_data: 'mt:menu' }]] })
}

async function consumeAskMode(ctx: MasterContext): Promise<boolean> {
  const row = await ctx.db.prepare(`DELETE FROM platform_conversations WHERE chat_id = ? AND flow = 'ask_ai' AND expires_at > unixepoch() RETURNING chat_id`).bind(String(ctx.chatId)).first()
  return Boolean(row)
}

const answerShape = z.object({ answer: z.string().min(1) })

async function answerQuestion(ctx: MasterContext, question: string): Promise<void> {
  const keyboard: Keyboard = { inline_keyboard: [[{ text: '✨ Otra pregunta', callback_data: 'mt:ask' }, { text: '↩ Menú', callback_data: 'mt:menu' }]] }
  // Orders keep going through the confirmed-operation path.
  if (detectMasterIntent(question)) { await handleNaturalLanguage(ctx, question); return }
  if (!ctx.env.GEMINI_API_KEY) { await say(ctx, `La IA no está configurada en este entorno. Esto es lo que puedo hacer:\n\n${HELP}`, keyboard); return }
  const [summary, stores, plans] = await Promise.all([
    platformSummary(ctx.db),
    listStores(ctx.db),
    ctx.db.prepare(`SELECT code, name, ai_monthly_budget_micros AS aiBudgetMicros, max_products AS maxProducts, monthly_price AS monthlyPrice, currency FROM plans WHERE is_active = 1 AND code <> 'legacy' ORDER BY sort_order`).all(),
  ])
  // Facts only: no owner contact data and no configuration values leave the Worker.
  const facts = {
    resumen: summary,
    tiendas: stores.slice(0, 40).map((store) => ({
      nombre: store.name, direccion: store.slug, estado: store.status, plan: store.planCode, productos: store.products,
      pedidos30dias: store.ordersLast30, usoIaPorcentaje: store.aiPercent, propietario: store.ownerEmail ? 'asignado' : 'sin asignar',
    })),
    planes: plans.results || [],
  }
  const commands = HELP.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  try {
    const result = await callGeminiJson(ctx.env, fetch, {
      system: [
        'Eres el asistente del administrador de una plataforma de tiendas en línea (Catálogo Digital IA). Respondes en español, con tono amable y en pocas líneas.',
        'Usa solo los DATOS DE LA PLATAFORMA y la lista de COMANDOS. Si la respuesta no está ahí, dilo y sugiere el comando o botón que sirve. No inventes tiendas, cifras, precios ni funciones.',
        'No ejecutas cambios: para modificar algo indica el comando exacto; el sistema pedirá confirmación. Los costos de IA son estimados.',
        UNTRUSTED_CONTENT_RULE,
      ],
      parts: [{ text: `DATOS DE LA PLATAFORMA (JSON):\n${JSON.stringify(facts)}\n\nCOMANDOS:\n${commands}\n\nPREGUNTA DEL ADMINISTRADOR:\n${question.slice(0, 1000)}` }],
      maxOutputTokens: 1024,
      schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
    })
    await ctx.db.prepare(`INSERT INTO platform_events (level, source, code, detail) VALUES ('info', 'master_bot', 'GEMINI_USAGE', ?)`)
      .bind(`ask tokens ${result.usage.promptTokens}+${result.usage.outputTokens}`).run()
    const parsed = answerShape.safeParse(result.data)
    if (parsed.success) { await say(ctx, `✨ ${escapeHtml(parsed.data.answer.slice(0, 3000))}`, keyboard); return }
  } catch (error) {
    console.error('Master Gemini answer failed:', error instanceof Error ? error.message : 'unknown')
    await ctx.db.prepare(`INSERT INTO platform_events (level, source, code, detail) VALUES ('warning', 'master_bot', ?, 'ask')`).bind(geminiFailureCode(error)).run().catch(() => undefined)
  }
  await say(ctx, 'No pude consultar la IA en este momento. Puedes usar el menú o escribir /ayuda.', keyboard)
}

