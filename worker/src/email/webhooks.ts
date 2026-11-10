/** Delivery events from the email provider (Resend webhooks, signed with Svix).
 * Only the event type and identifiers are stored; never the message content or recipient data beyond
 * the address that must be suppressed after a permanent bounce or a spam complaint. */
import type { Env } from '../index'
import { isEmail } from './send'

const TOLERANCE_SECONDS = 5 * 60
const encoder = new TextEncoder()

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch { return null }
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Constant-time comparison of two strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Svix signature check: HMAC-SHA256 over "id.timestamp.body" with the base64 secret after "whsec_". */
export async function verifySvixSignature(secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false
  const timestamp = Number(headers.timestamp)
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) return false
  const keyBytes = base64ToBytes(secret.startsWith('whsec_') ? secret.slice(6) : secret)
  if (!keyBytes || !keyBytes.length) return false
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = bytesToBase64(await crypto.subtle.sign('HMAC', key, encoder.encode(`${headers.id}.${headers.timestamp}.${body}`)))
  return headers.signature.split(' ').some((part) => {
    const [version, value] = part.split(',')
    return version === 'v1' && typeof value === 'string' && safeEqual(value, expected)
  })
}

/** Provider event → stored delivery state. Events not listed (sent, opened, clicked) are acknowledged and ignored. */
const DELIVERY_STATE: Record<string, string> = {
  'email.delivered': 'entregado',
  'email.delivery_delayed': 'retrasado',
  'email.bounced': 'rebotado',
  'email.complained': 'queja',
  'email.failed': 'fallido',
}

type ResendEvent = { type?: unknown; data?: { email_id?: unknown; to?: unknown; bounce?: { type?: unknown } } }

export async function applyProviderEvent(db: D1Database, eventId: string, event: ResendEvent): Promise<{ stored: boolean; state: string | null }> {
  const type = typeof event.type === 'string' ? event.type.slice(0, 60) : ''
  const providerMessageId = typeof event.data?.email_id === 'string' ? event.data.email_id.slice(0, 120) : null
  const message = providerMessageId
    ? await db.prepare('SELECT id, to_email FROM email_messages WHERE provider_message_id = ?').bind(providerMessageId).first<{ id: number; to_email: string }>()
    : null
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO email_events (provider, provider_event_id, provider_message_id, message_id, event_type) VALUES ('resend', ?, ?, ?, ?) RETURNING id`,
  ).bind(eventId.slice(0, 120), providerMessageId, message?.id ?? null, type || 'desconocido').first<{ id: number }>()
  // The same event delivered twice changes nothing.
  if (!inserted) return { stored: false, state: null }
  const state = DELIVERY_STATE[type] ?? null
  if (!state || !message) return { stored: true, state }
  // A late "delayed" or "delivered" never hides an earlier bounce or complaint.
  await db.prepare(
    `UPDATE email_messages SET delivery_status = ?, delivery_updated_at = datetime('now')
     WHERE id = ? AND (delivery_status IS NULL OR delivery_status NOT IN ('rebotado', 'queja') OR ? IN ('rebotado', 'queja'))`,
  ).bind(state, message.id, state).run()
  const bounceType = typeof event.data?.bounce?.type === 'string' ? event.data.bounce.type.toLowerCase() : ''
  const permanent = state === 'queja' || (state === 'rebotado' && bounceType !== 'transient')
  if (permanent && isEmail(message.to_email)) {
    await db.prepare(`INSERT OR IGNORE INTO email_suppressions (email, reason, source, created_by) VALUES (?, ?, 'resend', 'webhook')`)
      .bind(message.to_email.toLowerCase(), state === 'queja' ? 'queja' : 'rebote').run()
  }
  return { stored: true, state }
}

// ---- DNS check of the sender domain -----------------------------------------------------------

export type DnsCheck = { name: string; status: 'ok' | 'falta' | 'revisar' | 'error'; detail: string }

/** Domain of the visible sender (EMAIL_FROM), e.g. "Tienda IA Express <no-responder@envios.ejemplo.com>". */
export function senderDomain(from: string | null | undefined): string | null {
  const match = String(from || '').match(/@([a-z0-9.-]+\.[a-z]{2,})>?\s*$/i)
  return match ? match[1]!.toLowerCase() : null
}

async function txt(fetcher: typeof fetch, name: string, type: 'TXT' | 'MX' = 'TXT'): Promise<string[] | null> {
  try {
    const response = await fetcher(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { Accept: 'application/dns-json' } })
    if (!response.ok) return null
    const body = await response.json() as { Answer?: Array<{ type: number; data: string }> }
    return (body.Answer || []).filter((answer) => answer.type === (type === 'TXT' ? 16 : 15)).map((answer) => answer.data.replace(/^"|"$/g, '').replace(/"\s+"/g, ''))
  } catch { return null }
}

/** Public DNS lookups (DNS over HTTPS). It reads only what anyone can read; it never changes DNS.
 * Resend publishes DKIM at resend._domainkey and SPF/MX on the "send" subdomain of the sender domain. */
export async function checkSenderDns(env: Partial<Env['Bindings']>, fetcher: typeof fetch = fetch): Promise<{ domain: string | null; checks: DnsCheck[] }> {
  const domain = senderDomain(env.EMAIL_FROM)
  if (!domain) return { domain: null, checks: [{ name: 'Remitente', status: 'falta', detail: 'EMAIL_FROM no está configurado.' }] }
  const [dkim, spfSend, mxSend, dmarc, spfRoot] = await Promise.all([
    txt(fetcher, `resend._domainkey.${domain}`), txt(fetcher, `send.${domain}`), txt(fetcher, `send.${domain}`, 'MX'),
    txt(fetcher, `_dmarc.${domain}`), txt(fetcher, domain),
  ])
  const checks: DnsCheck[] = []
  const lookupFailed = (value: string[] | null) => value === null
  checks.push(lookupFailed(dkim) ? { name: 'DKIM', status: 'error', detail: 'No se pudo consultar el DNS.' }
    : dkim!.some((value) => value.includes('p=')) ? { name: 'DKIM', status: 'ok', detail: `resend._domainkey.${domain} publicado.` }
      : { name: 'DKIM', status: 'falta', detail: `Falta el registro TXT resend._domainkey.${domain} que entrega Resend.` })
  const spf = (spfSend || []).filter((value) => value.toLowerCase().startsWith('v=spf1'))
  checks.push(lookupFailed(spfSend) ? { name: 'SPF', status: 'error', detail: 'No se pudo consultar el DNS.' }
    : spf.length > 1 ? { name: 'SPF', status: 'revisar', detail: `Hay ${spf.length} registros SPF en send.${domain}: debe haber uno solo.` }
      : spf.length === 1 ? { name: 'SPF', status: 'ok', detail: `send.${domain}: ${spf[0]}` }
        : { name: 'SPF', status: 'falta', detail: `Falta el registro SPF (TXT) en send.${domain} que entrega Resend.` })
  checks.push(lookupFailed(mxSend) ? { name: 'MX de rebotes', status: 'error', detail: 'No se pudo consultar el DNS.' }
    : mxSend!.length ? { name: 'MX de rebotes', status: 'ok', detail: `send.${domain} recibe los rebotes.` }
      : { name: 'MX de rebotes', status: 'falta', detail: `Falta el registro MX en send.${domain} que entrega Resend.` })
  const dmarcRecord = (dmarc || []).find((value) => value.toLowerCase().startsWith('v=dmarc1'))
  checks.push(lookupFailed(dmarc) ? { name: 'DMARC', status: 'error', detail: 'No se pudo consultar el DNS.' }
    : dmarcRecord ? { name: 'DMARC', status: /p=(quarantine|reject)/i.test(dmarcRecord) ? 'ok' : 'revisar', detail: `${dmarcRecord}${/p=none/i.test(dmarcRecord) ? ' (modo monitoreo: endurecer después de revisar informes)' : ''}` }
      : { name: 'DMARC', status: 'falta', detail: `Falta _dmarc.${domain}. Empieza con v=DMARC1; p=none; rua=mailto:…` })
  const rootSpf = (spfRoot || []).filter((value) => value.toLowerCase().startsWith('v=spf1'))
  if (rootSpf.length > 1) checks.push({ name: `SPF de ${domain}`, status: 'revisar', detail: `Hay ${rootSpf.length} registros SPF en ${domain}: deben unirse en uno solo.` })
  return { domain, checks }
}
