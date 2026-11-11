/**
 * Convierte lo que el asistente dice (HTML de Telegram + teclado en línea) a mensajes de WhatsApp:
 * texto con su formato, hasta 3 botones de respuesta, lista de hasta 10 opciones o, si hay más,
 * un menú numerado. Los identificadores de los botones son los mismos que usa el motor.
 */

export const TEXT_LIMIT = 4000
const BUTTON_BODY_LIMIT = 1024
const BUTTON_TITLE = 20
const ROW_TITLE = 24
const ROW_DESCRIPTION = 72

type Button = { text?: string; callback_data?: string; url?: string }
export type Option = { id: string; label: string }
export type Outbound = {
  /** Cuerpos de la API de mensajes, en orden de envío. */
  messages: Array<Record<string, unknown>>
  /** Opciones del menú numerado (solo cuando no caben en botones ni en lista). */
  numbered: Option[] | null
}

function decodeEntities(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}

/** HTML de Telegram → formato de WhatsApp (*negrita*, _cursiva_, `código`). */
export function htmlToWhatsApp(html: string): string {
  const wrap = (mark: string) => (_: string, inner: string) => {
    const content = inner.trim()
    if (!content) return ''
    const lead = inner.match(/^\s*/)![0]
    const tail = inner.match(/\s*$/)![0]
    return `${lead}${mark}${content}${mark}${tail}`
  }
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => (label.trim() && label.trim() !== href ? `${label.trim()}: ${href}` : href))
    .replace(/<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/gi, wrap('*'))
    .replace(/<(?:i|em)>([\s\S]*?)<\/(?:i|em)>/gi, wrap('_'))
    .replace(/<(?:s|strike|del)>([\s\S]*?)<\/(?:s|strike|del)>/gi, wrap('~'))
    .replace(/<(?:code|pre)>([\s\S]*?)<\/(?:code|pre)>/gi, (_, inner: string) => (inner.includes('\n') ? `\`\`\`${inner}\`\`\`` : `\`${inner.trim()}\``))
    .replace(/<\/?[a-z][^>]*>/gi, '')
  return decodeEntities(text).replace(/\n{3,}/g, '\n\n').trim()
}

function clip(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`
}

function chunks(text: string, size = TEXT_LIMIT): string[] {
  const parts: string[] = []
  let rest = text
  while (rest.length > size) {
    const cut = Math.max(rest.lastIndexOf('\n', size), Math.floor(size / 2))
    parts.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  if (rest) parts.push(rest)
  return parts
}

const textMessage = (body: string) => ({ type: 'text', text: { body, preview_url: false } })

/** Botones que el motor ofrece, sin repetidos; los enlaces pasan al texto. */
function readKeyboard(replyMarkup?: Record<string, unknown>): { options: Option[]; links: string[] } {
  const rows = Array.isArray(replyMarkup?.inline_keyboard) ? replyMarkup!.inline_keyboard as Button[][] : []
  const options: Option[] = []
  const links: string[] = []
  for (const button of rows.flat()) {
    const label = String(button?.text || '').trim()
    if (button?.url) { links.push(`${label}: ${button.url}`); continue }
    const id = String(button?.callback_data || '')
    if (!id || id.length > 200 || options.some((option) => option.id === id)) continue
    options.push({ id, label: label || 'Opción' })
  }
  // WhatsApp admite tres botones: el resumen ya está en el mensaje y el menú se abre escribiendo "menú".
  let kept = options
  if (kept.length > 3) kept = kept.filter((option) => !option.id.startsWith('op:preview:'))
  if (kept.length === 4 && kept.at(-1)!.id === 'm:menu') kept = kept.slice(0, 3)
  return { options: kept, links }
}

function uniqueTitles(options: Option[], max: number): string[] {
  const seen = new Set<string>()
  return options.map((option, index) => {
    let title = clip(option.label, max)
    if (seen.has(title)) title = `${clip(option.label, max - 2)} ${index + 1}`
    seen.add(title)
    return title
  })
}

export function buildOutbound(html: string, replyMarkup?: Record<string, unknown>): Outbound {
  const { options, links } = readKeyboard(replyMarkup)
  const body = [htmlToWhatsApp(html), links.join('\n')].filter(Boolean).join('\n\n') || '…'
  if (!options.length) return { messages: chunks(body).map(textMessage), numbered: null }

  if (options.length > 10) {
    const menu = options.map((option, index) => `${index + 1}. ${option.label}`).join('\n')
    return { messages: chunks(`${body}\n\n${menu}\n\nResponde con el número de la opción.`).map(textMessage), numbered: options }
  }

  // Un cuerpo largo va primero como texto; la pregunta con botones lo sigue.
  const limit = options.length <= 3 ? BUTTON_BODY_LIMIT : TEXT_LIMIT
  const messages: Array<Record<string, unknown>> = []
  let prompt = body
  if (body.length > limit) {
    messages.push(...chunks(body).map(textMessage))
    prompt = 'Elige una opción 👇'
  }
  if (options.length <= 3) {
    const titles = uniqueTitles(options, BUTTON_TITLE)
    messages.push({ type: 'interactive', interactive: {
      type: 'button', body: { text: prompt },
      action: { buttons: options.map((option, index) => ({ type: 'reply', reply: { id: option.id, title: titles[index] } })) },
    } })
  } else {
    const titles = uniqueTitles(options, ROW_TITLE)
    messages.push({ type: 'interactive', interactive: {
      type: 'list', body: { text: prompt },
      action: { button: 'Ver opciones', sections: [{ title: 'Opciones', rows: options.map((option, index) => ({
        id: option.id, title: titles[index],
        ...(Array.from(option.label).length > ROW_TITLE ? { description: clip(option.label, ROW_DESCRIPTION) } : {}),
      })) }] },
    } })
  }
  return { messages, numbered: null }
}
