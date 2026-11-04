import { can } from '../../tenancy/access'
import {
  campaignText, consentedContacts, couponResults, normalizeCouponCode, normalizePhone, OPT_OUT_LINE,
  unsubscribeContact, whatsappLink, type Coupon,
} from '../marketing'
import { readSession, say, updateSessionState, type AssistantContext } from './context'
import { parseAmount } from './intents'
import { escapeHtml, formatMoney } from './tools'

export type CouponDraft = { code: string; kind: 'porcentaje' | 'valor'; value: number; minSubtotal: number; endsAt: string | null; maxUses: number | null }

const cb = (ctx: AssistantContext, ...parts: Array<string | number>) => ['mk', ctx.store.id, ...parts].join(':')
const MONTHS: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 }

function endDate(text: string): string | null {
  const numeric = text.match(/hasta\s+el\s+(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/i)
  const named = text.match(/hasta\s+el\s+(\d{1,2})\s+de\s+([a-záéíóú]+)(?:\s+de\s+(\d{4}))?/i)
  const day = Number(numeric?.[1] || named?.[1])
  const month = numeric ? Number(numeric[2]) : named ? MONTHS[named[2]!.toLowerCase()] : undefined
  if (!day || !month || day > 31 || month > 12) return null
  const now = new Date()
  let year = Number(numeric?.[3] || named?.[3]) || now.getUTCFullYear()
  if (year < 100) year += 2000
  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (!numeric?.[3] && !named?.[3] && candidate.getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) candidate.setUTCFullYear(year + 1)
  return candidate.toISOString().slice(0, 10)
}

/** "Crea un cupón VERANO10 de 10% hasta el 30/11", "cupón ENVIO de 5.000 pesos para compras desde 100.000, máximo 50 usos". */
export function detectCouponDraft(text: string): CouponDraft | { error: string } | null {
  // "Crea una campaña con el cupón X" is a campaign, not a new coupon.
  if (!/\b(crea|crear|nuevo|genera|haz)\w*\b.*\bcup[oó]n\b/i.test(text) || /campa[ñn]a/i.test(text)) return null
  const code = normalizeCouponCode(text.match(/\bcup[oó]n\s+(?:llamado\s+|con\s+c[oó]digo\s+)?([A-Za-z0-9_-]{3,20})\b/i)?.[1])
  if (!code || /^(DE|DEL|PARA|CON)$/.test(code)) return { error: 'Dime el código del cupón, por ejemplo: “crea un cupón VERANO10 de 10% hasta el 30/11”.' }
  const percent = text.match(/\b(\d{1,2})\s*%/)
  const amountText = text.match(/\bde\s+(\$?\s*\d[\d.,]*\s*(?:mil)?)\s*(?:pesos|cop)?\s*(?:de\s+descuento)?/i)?.[1]
  const fixed = !percent && amountText ? parseAmount(amountText) : null
  if (!percent && !fixed) return { error: 'Indica el descuento: un porcentaje (10%) o un valor fijo (5.000 pesos).' }
  const value = percent ? Number(percent[1]) : fixed!
  if (percent && (value < 1 || value > 90)) return { error: 'El porcentaje debe estar entre 1 % y 90 %.' }
  const minText = text.match(/(?:desde|m[ií]nimo(?:\s+de)?|mayores?\s+a|superiores?\s+a)\s+(\$?\s*\d[\d.,]*\s*(?:mil)?)/i)?.[1]
  const uses = text.match(/(?:m[aá]ximo|l[ií]mite\s+de|para)\s+(\d{1,5})\s+usos/i)?.[1]
  return { code, kind: percent ? 'porcentaje' : 'valor', value, minSubtotal: minText ? parseAmount(minText) ?? 0 : 0, endsAt: endDate(text), maxUses: uses ? Number(uses) : null }
}

function describeCoupon(coupon: Pick<Coupon, 'kind' | 'value' | 'min_subtotal' | 'ends_at' | 'max_uses'>, currency: string): string {
  return [
    coupon.kind === 'porcentaje' ? `${coupon.value} % de descuento` : `${formatMoney(coupon.value, currency)} de descuento`,
    coupon.min_subtotal ? `desde ${formatMoney(coupon.min_subtotal, currency)}` : null,
    coupon.ends_at ? `hasta el ${coupon.ends_at}` : 'sin fecha de fin',
    coupon.max_uses ? `máximo ${coupon.max_uses} usos` : 'usos ilimitados',
  ].filter(Boolean).join(' · ')
}

async function denied(ctx: AssistantContext): Promise<boolean> {
  if (can(ctx.role, 'marketing.manage')) return false
  await say(ctx, 'Solo el propietario o un administrador pueden gestionar cupones y campañas.')
  return true
}

export async function showCoupons(ctx: AssistantContext): Promise<void> {
  if (await denied(ctx)) return
  const coupons = (await ctx.db.prepare(`SELECT id, code, kind, value, min_subtotal, starts_at, ends_at, max_uses, uses, is_active FROM coupons WHERE store_id = ? ORDER BY is_active DESC, id DESC LIMIT 10`).bind(ctx.store.id).all<Coupon>()).results || []
  const lines = coupons.map((coupon) => `${coupon.is_active ? '🟢' : '⚪'} <b>${escapeHtml(coupon.code)}</b> · ${describeCoupon(coupon, ctx.store.currency)} · ${coupon.uses} uso(s)`)
  await say(ctx, `🎟️ <b>Cupones de ${escapeHtml(ctx.store.name)}</b>\n\n${lines.join('\n') || 'Todavía no tienes cupones.'}\n\nPara crear uno escribe, por ejemplo:\n<code>Crea un cupón VERANO10 de 10% hasta el 30/11</code>`, { inline_keyboard: [
    ...coupons.filter((coupon) => coupon.is_active).slice(0, 5).map((coupon) => [
      { text: `📊 ${coupon.code}`, callback_data: cb(ctx, 'res', coupon.code) },
      { text: `⏸ Desactivar ${coupon.code}`, callback_data: cb(ctx, 'off', coupon.code) },
    ]),
    [{ text: '📣 Campañas', callback_data: cb(ctx, 'camps') }, { text: '↩ Menú', callback_data: 'm:menu' }],
  ] })
}

export async function proposeCoupon(ctx: AssistantContext, draft: CouponDraft | { error: string }): Promise<void> {
  if (await denied(ctx)) return
  if ('error' in draft) { await say(ctx, draft.error); return }
  const exists = await ctx.db.prepare('SELECT 1 FROM coupons WHERE store_id = ? AND code = ?').bind(ctx.store.id, draft.code).first()
  if (exists) { await say(ctx, `Ya existe un cupón ${escapeHtml(draft.code)} en esta tienda. Usa otro código.`); return }
  await updateSessionState(ctx, { pendingCoupon: draft })
  await say(ctx, `<b>Revisa el cupón</b>\n\n🎟️ <b>${escapeHtml(draft.code)}</b>\n${describeCoupon({ kind: draft.kind, value: draft.value, min_subtotal: draft.minSubtotal, ends_at: draft.endsAt, max_uses: draft.maxUses }, ctx.store.currency)}\n\nEl descuento se aplica sobre el subtotal de productos y se valida en cada compra.`, { inline_keyboard: [
    [{ text: '✅ Crear cupón', callback_data: cb(ctx, 'cok') }, { text: '❌ Cancelar', callback_data: cb(ctx, 'cno') }],
  ] })
}

async function createCoupon(ctx: AssistantContext): Promise<void> {
  const session = await readSession(ctx.db, ctx.telegramUserId)
  const draft = session.state.pendingCoupon
  if (!draft) { await say(ctx, 'Esa propuesta de cupón ya venció. Pídemela de nuevo.'); return }
  await updateSessionState(ctx, { pendingCoupon: undefined })
  try {
    await ctx.db.batch([
      ctx.db.prepare(`INSERT INTO coupons (store_id, code, kind, value, min_subtotal, ends_at, max_uses, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(ctx.store.id, draft.code, draft.kind, draft.value, draft.minSubtotal, draft.endsAt, draft.maxUses, `telegram:${ctx.telegramUserId}`),
      ctx.db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('coupon_created', 'coupon', ?, ?, ?, 'telegram', ?)`)
        .bind(draft.code, JSON.stringify(draft), `telegram:${ctx.telegramUserId}`, ctx.store.id),
    ])
  } catch (error) {
    if (/unique|constraint/i.test(String(error))) { await say(ctx, `Ya existe un cupón ${escapeHtml(draft.code)}. No creé nada.`); return }
    throw error
  }
  await say(ctx, `✅ Cupón <b>${escapeHtml(draft.code)}</b> creado. Tus clientes pueden usarlo en el carrito.`, { inline_keyboard: [[{ text: '🎟️ Ver cupones', callback_data: cb(ctx, 'list') }, { text: '📣 Crear campaña con este cupón', callback_data: cb(ctx, 'newcamp', draft.code) }]] })
}

async function showCouponResults(ctx: AssistantContext, code: string): Promise<void> {
  const results = await couponResults(ctx.db, ctx.store.id, code)
  if (!results) { await say(ctx, `No encontré el cupón ${escapeHtml(code)} en esta tienda.`); return }
  await say(ctx, `📊 <b>Resultados de ${escapeHtml(code)}</b>\n\nUsos en el carrito: ${results.uses}\nPedidos confirmados: <b>${results.confirmedOrders}</b>\nVentas confirmadas: <b>${formatMoney(results.confirmedSales, ctx.store.currency)}</b>\nDescuentos otorgados: ${formatMoney(results.discounts, ctx.store.currency)}\n\n<i>Solo cuentan pedidos confirmados.</i>`)
}

async function deactivateCoupon(ctx: AssistantContext, code: string, confirmed: boolean): Promise<void> {
  if (!confirmed) {
    await say(ctx, `¿Desactivo el cupón <b>${escapeHtml(code)}</b>? Los pedidos que ya lo usaron no cambian.`, { inline_keyboard: [[{ text: '✅ Sí, desactivar', callback_data: cb(ctx, 'offok', code) }, { text: '✖ No', callback_data: cb(ctx, 'list') }]] })
    return
  }
  const result = await ctx.db.prepare(`UPDATE coupons SET is_active = 0, updated_at = datetime('now') WHERE store_id = ? AND code = ? AND is_active = 1`).bind(ctx.store.id, code).run()
  if (Number(result.meta.changes || 0)) {
    await ctx.db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('coupon_deactivated', 'coupon', ?, '{}', ?, 'telegram', ?)`).bind(code, `telegram:${ctx.telegramUserId}`, ctx.store.id).run()
  }
  await say(ctx, Number(result.meta.changes || 0) ? `⏸ El cupón ${escapeHtml(code)} quedó desactivado.` : 'Ese cupón ya estaba desactivado o no existe.')
}

// Campaigns ---------------------------------------------------------------------

function defaultCampaignMessage(storeName: string, coupon: Coupon | null, currency: string): string {
  const offer = coupon ? ` Usa el cupón ${coupon.code} (${coupon.kind === 'porcentaje' ? `${coupon.value} %` : formatMoney(coupon.value, currency)} de descuento${coupon.ends_at ? ` hasta el ${coupon.ends_at}` : ''}).` : ''
  return `¡Hola {nombre}! Tenemos novedades en ${storeName}.${offer}`
}

export async function createCampaign(ctx: AssistantContext, couponCode: string | null, message: string | null): Promise<void> {
  if (await denied(ctx)) return
  const coupon = couponCode
    ? await ctx.db.prepare(`SELECT id, code, kind, value, min_subtotal, starts_at, ends_at, max_uses, uses, is_active FROM coupons WHERE store_id = ? AND code = ? AND is_active = 1`).bind(ctx.store.id, couponCode).first<Coupon>()
    : null
  if (couponCode && !coupon) { await say(ctx, `No encontré un cupón activo ${escapeHtml(couponCode)} en esta tienda.`); return }
  const text = (message || defaultCampaignMessage(ctx.store.name, coupon, ctx.store.currency)).slice(0, 400)
  const created = await ctx.db.prepare(`INSERT INTO campaigns (store_id, name, message, coupon_code, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id`)
    .bind(ctx.store.id, coupon ? `Campaña ${coupon.code}` : 'Campaña', text, coupon?.code ?? null, `telegram:${ctx.telegramUserId}`).first<{ id: number }>()
  await showCampaign(ctx, created!.id)
}

async function showCampaign(ctx: AssistantContext, campaignId: number): Promise<void> {
  const campaign = await ctx.db.prepare('SELECT id, name, message, status, coupon_code FROM campaigns WHERE id = ? AND store_id = ?').bind(campaignId, ctx.store.id).first<{ id: number; name: string; message: string; status: string; coupon_code: string | null }>()
  if (!campaign) { await say(ctx, 'Esa campaña no existe en esta tienda.'); return }
  const audience = (await consentedContacts(ctx.db, ctx.store.id)).length
  const preview = escapeHtml(campaignText(campaign.message, 'María'))
  const rows = campaign.status === 'borrador'
    ? [[{ text: '✅ Aprobar campaña', callback_data: cb(ctx, 'approve', campaign.id) }], [{ text: '✏️ Cambiar texto', callback_data: cb(ctx, 'edit', campaign.id) }, { text: '❌ Descartar', callback_data: cb(ctx, 'drop', campaign.id) }]]
    : campaign.status === 'aprobada' ? [[{ text: '📲 Ver enlaces para enviar', callback_data: cb(ctx, 'links', campaign.id, 0) }]] : []
  await say(ctx, `📣 <b>${escapeHtml(campaign.name)}</b> · ${campaign.status}\n\n<b>Vista previa</b> (para un cliente llamado María):\n<i>${preview}</i>\n\nDestinatarios: <b>${audience}</b> cliente(s) que aceptaron recibir promociones y no se dieron de baja.\n\nNo envío nada por mi cuenta: al aprobarla te doy un enlace de WhatsApp por cliente para que tú decidas cuándo enviarlo.`, { inline_keyboard: [...rows, [{ text: '↩ Menú', callback_data: 'm:menu' }]] })
}

async function campaignLinks(ctx: AssistantContext, campaignId: number, page: number): Promise<void> {
  const campaign = await ctx.db.prepare(`SELECT message FROM campaigns WHERE id = ? AND store_id = ? AND status = 'aprobada'`).bind(campaignId, ctx.store.id).first<{ message: string }>()
  if (!campaign) { await say(ctx, 'La campaña debe estar aprobada antes de preparar los envíos.'); return }
  const contacts = await consentedContacts(ctx.db, ctx.store.id)
  if (!contacts.length) { await say(ctx, 'Todavía no tienes clientes que hayan aceptado recibir promociones. El permiso se pide en el carrito al hacer un pedido.'); return }
  const slice = contacts.slice(page * 8, page * 8 + 8)
  await say(ctx, `📲 Toca cada cliente para abrir WhatsApp con el mensaje listo (${page * 8 + 1}–${page * 8 + slice.length} de ${contacts.length}). El mensaje incluye cómo darse de baja.`, { inline_keyboard: [
    ...slice.map((contact) => [{ text: `${(contact.name || 'Cliente').split(/\s+/)[0]} •••${contact.phone.slice(-4)}`, url: whatsappLink(contact.phone, campaignText(campaign.message, contact.name)) }]),
    ...(contacts.length > (page + 1) * 8 ? [[{ text: 'Siguientes ▶', callback_data: cb(ctx, 'links', campaignId, page + 1) }]] : []),
  ] })
}

async function approveCampaign(ctx: AssistantContext, campaignId: number): Promise<void> {
  const audience = (await consentedContacts(ctx.db, ctx.store.id)).length
  const result = await ctx.db.prepare(`UPDATE campaigns SET status = 'aprobada', approved_by = ?, approved_at = datetime('now'), recipients = ? WHERE id = ? AND store_id = ? AND status = 'borrador'`)
    .bind(`telegram:${ctx.telegramUserId}`, audience, campaignId, ctx.store.id).run()
  if (!Number(result.meta.changes || 0)) { await say(ctx, 'Esa campaña ya no está en borrador.'); return }
  await ctx.db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('campaign_approved', 'campaign', ?, ?, ?, 'telegram', ?)`)
    .bind(String(campaignId), JSON.stringify({ recipients: audience }), `telegram:${ctx.telegramUserId}`, ctx.store.id).run()
  await say(ctx, `✅ Campaña aprobada para ${audience} cliente(s).`)
  await campaignLinks(ctx, campaignId, 0)
}

export async function showCampaigns(ctx: AssistantContext): Promise<void> {
  if (await denied(ctx)) return
  const rows = (await ctx.db.prepare('SELECT id, name, status, recipients FROM campaigns WHERE store_id = ? ORDER BY id DESC LIMIT 8').bind(ctx.store.id).all<{ id: number; name: string; status: string; recipients: number }>()).results || []
  await say(ctx, `📣 <b>Campañas</b>\n\n${rows.map((row) => `• ${escapeHtml(row.name)} · ${row.status}${row.status === 'aprobada' ? ` · ${row.recipients} destinatario(s)` : ''}`).join('\n') || 'Todavía no hay campañas.'}\n\nCrea una con: <code>crea una campaña con el cupón VERANO10</code>`, { inline_keyboard: [
    ...rows.filter((row) => row.status !== 'cancelada').slice(0, 5).map((row) => [{ text: `📣 ${row.name}`.slice(0, 40), callback_data: cb(ctx, 'camp', row.id) }]),
    [{ text: '🎟️ Cupones', callback_data: cb(ctx, 'list') }, { text: '↩ Menú', callback_data: 'm:menu' }],
  ] })
}

export async function acceptCampaignText(ctx: AssistantContext, campaignId: number, text: string): Promise<void> {
  await updateSessionState(ctx, { awaiting: undefined, targetCampaign: undefined })
  const message = text.trim().slice(0, 400)
  if (message.length < 10) { await say(ctx, 'El mensaje es muy corto. Escríbelo de nuevo desde la campaña.'); return }
  await ctx.db.prepare(`UPDATE campaigns SET message = ? WHERE id = ? AND store_id = ? AND status = 'borrador'`).bind(message, campaignId, ctx.store.id).run()
  await showCampaign(ctx, campaignId)
}

/** Unsubscribe requested by the customer (e.g. replied BAJA): applied immediately. */
export async function unsubscribe(ctx: AssistantContext, rawPhone: string): Promise<void> {
  if (await denied(ctx)) return
  const phone = normalizePhone(rawPhone, ctx.env.STORE_COUNTRY || 'CO')
  if (!phone) { await say(ctx, 'Escribe el número completo, por ejemplo: dar de baja 3001234567.'); return }
  const done = await unsubscribeContact(ctx.db, ctx.store.id, phone)
  if (done) await ctx.db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('contact_unsubscribed', 'contact', ?, '{}', ?, 'telegram', ?)`).bind(`•••${phone.slice(-4)}`, `telegram:${ctx.telegramUserId}`, ctx.store.id).run()
  await say(ctx, done ? `✅ El número •••${phone.slice(-4)} quedó dado de baja: no aparecerá en ninguna campaña.` : 'Ese número no estaba suscrito a promociones.')
}

/** Follow-up of requests the customer started by WhatsApp and the store has not confirmed (not a campaign). */
export async function showFollowUps(ctx: AssistantContext): Promise<void> {
  if (!can(ctx.role, 'orders.manage')) { await say(ctx, 'Tu rol no permite gestionar pedidos.'); return }
  const rows = (await ctx.db.prepare(
    `SELECT display_id, customer_name, customer_phone, subtotal, currency FROM orders
     WHERE store_id = ? AND status = 'pendiente' AND created_at <= datetime('now', '-1 day') AND created_at >= datetime('now', '-15 days') ORDER BY id DESC LIMIT 8`,
  ).bind(ctx.store.id).all<{ display_id: string; customer_name: string | null; customer_phone: string | null; subtotal: number; currency: string }>()).results || []
  if (!rows.length) { await say(ctx, '✅ No hay pedidos recibidos sin confirmar de más de un día.'); return }
  await say(ctx, `🔔 <b>Pedidos recibidos sin confirmar</b> (más de 1 día)\n\nSon solicitudes que el cliente inició; puedes escribirle para cerrar la venta. No es una campaña.`, { inline_keyboard: rows.map((row) => {
    const phone = normalizePhone(row.customer_phone, ctx.env.STORE_COUNTRY || 'CO')
    const label = `${row.display_id.split('-').pop()} · ${formatMoney(row.subtotal, row.currency)}`
    const text = `Hola ${(row.customer_name || '').split(/\s+/)[0]}, te escribimos de ${ctx.store.name} por tu pedido ${row.display_id}. ¿Lo confirmamos?`.replace(/\s{2,}/g, ' ')
    return [phone ? { text: `📲 ${label}`, url: whatsappLink(phone, text) } : { text: `${label} (sin teléfono)`, callback_data: `ord:${ctx.store.id}:list:pendiente` }]
  }) })
}

export function detectMarketingIntent(text: string): { kind: 'coupons' } | { kind: 'campaigns' } | { kind: 'new_campaign'; coupon: string | null; message: string | null } | { kind: 'coupon_results'; code: string } | { kind: 'coupon_off'; code: string } | { kind: 'unsubscribe'; phone: string } | { kind: 'follow_ups' } | null {
  const lower = text.toLowerCase()
  const unsub = text.match(/\b(?:dar\s+de\s+baja|da\s+de\s+baja|baja\s+(?:al|a|del)?\s*(?:n[uú]mero)?)\s*:?\s*(\+?[\d\s()-]{7,20})/i)
  if (unsub) return { kind: 'unsubscribe', phone: unsub[1]! }
  const results = text.match(/\bresultados?\s+(?:del|de)\s+cup[oó]n\s+([A-Za-z0-9_-]{3,20})/i)
  if (results) return { kind: 'coupon_results', code: results[1]!.toUpperCase() }
  const off = text.match(/\b(?:desactiva|desactivar|pausa|pausar|elimina|eliminar)\w*\s+(?:el\s+)?cup[oó]n\s+([A-Za-z0-9_-]{3,20})/i)
  if (off) return { kind: 'coupon_off', code: off[1]!.toUpperCase() }
  if (/\b(crea|crear|nueva|haz|prepara)\w*\b.*\bcampa[ñn]a\b/.test(lower)) {
    const coupon = text.match(/\bcup[oó]n\s+([A-Za-z0-9_-]{3,20})/i)?.[1]?.toUpperCase() || null
    const message = text.match(/campa[ñn]a[^:]*:\s*(.{10,400})$/i)?.[1]?.trim() || null
    return { kind: 'new_campaign', coupon, message }
  }
  if (/^\/?(cupones|mis cupones|ver cupones)\b/.test(lower)) return { kind: 'coupons' }
  if (/^\/?(campa[ñn]as|mis campa[ñn]as|ver campa[ñn]as)\b/.test(lower)) return { kind: 'campaigns' }
  if (/(pedidos?\s+(?:recibidos?\s+)?sin\s+confirmar|seguimiento\s+de\s+pedidos|recuperar\s+(?:pedidos|ventas|carritos))/.test(lower)) return { kind: 'follow_ups' }
  return null
}

export async function handleMarketingCallback(ctx: AssistantContext, data: string): Promise<boolean> {
  const match = data.match(/^mk:(\d+):(list|camps|cok|cno|res|off|offok|newcamp|camp|approve|edit|drop|links)(?::([A-Za-z0-9_-]+))?(?::(\d+))?$/)
  if (!match) return false
  if (Number(match[1]) !== ctx.store.id) { await say(ctx, 'Ese botón pertenece a otra tienda y no lo apliqué.'); return true }
  if (await denied(ctx)) return true
  const [, , verb, arg = '', page] = match
  switch (verb) {
    case 'list': await showCoupons(ctx); break
    case 'camps': await showCampaigns(ctx); break
    case 'cok': await createCoupon(ctx); break
    case 'cno': await updateSessionState(ctx, { pendingCoupon: undefined }); await say(ctx, 'Listo, no creé el cupón.'); break
    case 'res': await showCouponResults(ctx, arg.toUpperCase()); break
    case 'off': await deactivateCoupon(ctx, arg.toUpperCase(), false); break
    case 'offok': await deactivateCoupon(ctx, arg.toUpperCase(), true); break
    case 'newcamp': await createCampaign(ctx, arg.toUpperCase(), null); break
    case 'camp': await showCampaign(ctx, Number(arg)); break
    case 'approve': await approveCampaign(ctx, Number(arg)); break
    case 'edit':
      await updateSessionState(ctx, { awaiting: 'campaign_text', targetCampaign: Number(arg) })
      await say(ctx, `Escríbeme el nuevo texto (hasta 400 caracteres). Usa {nombre} para el nombre del cliente. Agregaré al final: “${OPT_OUT_LINE}”`)
      break
    case 'drop':
      await ctx.db.prepare(`UPDATE campaigns SET status = 'cancelada' WHERE id = ? AND store_id = ? AND status = 'borrador'`).bind(Number(arg), ctx.store.id).run()
      await say(ctx, 'Campaña descartada.')
      break
    case 'links': await campaignLinks(ctx, Number(arg), Number(page || 0)); break
  }
  return true
}
