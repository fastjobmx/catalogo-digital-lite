/** Email templates: a closed list of variables, server-only links and HTML sanitizing.
 * Templates decide the look and the words; they can never create, change or reveal tokens. */

export const PLATFORM_NAME = 'MOSTRALO PUES!'

export const EMAIL_VARIABLES = {
  nombre_usuario: 'Nombre de la persona',
  correo_usuario: 'Correo de la persona',
  nombre_comercio: 'Nombre del comercio',
  nombre_plataforma: 'Nombre de la plataforma',
  vence_en: 'Tiempo de vigencia del enlace',
  mensaje: 'Mensaje de la notificación (escrito por el administrador)',
  enlace_panel: 'Enlace al inicio de sesión del panel',
  enlace_recuperacion: 'Enlace seguro para crear una contraseña nueva (lo genera el sistema)',
  enlace_invitacion: 'Enlace de activación de la invitación (lo genera el sistema)',
  enlace_verificacion: 'Enlace para verificar el correo (lo genera el sistema)',
} as const
export type EmailVariable = keyof typeof EMAIL_VARIABLES

/** Secure links: generated only by the backend, and each one only allowed in its own system template. */
export const LINK_VARIABLES: Partial<Record<EmailVariable, SystemTemplateKey>> = {
  enlace_recuperacion: 'password_reset',
  enlace_invitacion: 'invitation',
  enlace_verificacion: 'email_verification',
}

export const SYSTEM_TEMPLATE_KEYS = ['password_reset', 'invitation', 'welcome', 'admin_notice', 'email_verification'] as const
export type SystemTemplateKey = typeof SYSTEM_TEMPLATE_KEYS[number]

export class TemplateError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))

export function templateVariables(source: string): string[] {
  return [...new Set([...source.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((match) => match[1]!))]
}

/** Removes active content. Templates are written by the platform superadmin, but email HTML must
 * never carry scripts, forms, embedded frames, event handlers or javascript: links. */
export function sanitizeEmailHtml(html: string): string {
  let out = html
  out = out.replace(/<!--[\s\S]*?-->/g, '')
  out = out.replace(/<\s*(script|style|iframe|object|embed|form|frame|frameset|applet|base|link|svg|math|template|noscript)\b[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi, (match, tag: string) => tag.toLowerCase() === 'style' ? match.replace(/expression\s*\(|javascript:|@import/gi, '') : '')
  out = out.replace(/<\s*\/?\s*(script|iframe|object|embed|form|frame|frameset|applet|base|link|svg|math|template|noscript|input|button|textarea|select)\b[^>]*>/gi, '')
  out = out.replace(/<\s*meta\b[^>]*http-equiv[^>]*>/gi, '')
  out = out.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  out = out.replace(/\s(href|src|action|formaction|background|poster)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_match, attr: string, _q, dq, sq, bare) => {
    const value = String(dq ?? sq ?? bare ?? '').trim()
    const placeholder = /^\{\{\s*[a-z_]+\s*\}\}$/.test(value)
    const safe = placeholder || /^(https:|mailto:|tel:|#)/i.test(value) || (attr.toLowerCase() === 'src' && /^cid:/i.test(value))
    return safe ? ` ${attr}="${value.replace(/"/g, '&quot;')}"` : ''
  })
  out = out.replace(/style\s*=\s*("[^"]*"|'[^']*')/gi, (match) => /expression\s*\(|javascript:|url\s*\(\s*['"]?\s*(?!https:)/i.test(match) ? '' : match)
  return out
}

export type TemplateInput = { name?: unknown; subject?: unknown; html?: unknown; text?: unknown }

/** Validates a template for saving. System link variables are only accepted in their own template. */
export function validateTemplate(input: TemplateInput, systemKey: string | null) {
  const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, max) : '')
  const name = clean(input.name, 120)
  const subject = clean(input.subject, 200).replace(/[\r\n]+/g, ' ')
  const html = sanitizeEmailHtml(clean(input.html, 60_000))
  const text = clean(input.text, 20_000)
  if (!name) throw new TemplateError('NAME_REQUIRED', 'Escribe el nombre interno de la plantilla')
  if (!subject) throw new TemplateError('SUBJECT_REQUIRED', 'Escribe el asunto del correo')
  if (!html) throw new TemplateError('HTML_REQUIRED', 'Escribe el contenido HTML')
  if (!text) throw new TemplateError('TEXT_REQUIRED', 'Escribe la versión de texto plano')
  for (const variable of templateVariables(`${subject} ${html} ${text}`)) {
    if (!(variable in EMAIL_VARIABLES)) throw new TemplateError('UNKNOWN_VARIABLE', `La variable {{${variable}}} no existe`)
    const owner = LINK_VARIABLES[variable as EmailVariable]
    if (owner && owner !== systemKey) throw new TemplateError('LINK_NOT_ALLOWED', `{{${variable}}} solo se puede usar en la plantilla del sistema que la genera`)
  }
  const required = systemKey ? Object.entries(LINK_VARIABLES).find(([, key]) => key === systemKey)?.[0] : undefined
  if (required && !templateVariables(html).includes(required)) throw new TemplateError('LINK_REQUIRED', `Esta plantilla debe incluir {{${required}}} en el HTML`)
  if (required && !templateVariables(text).includes(required)) throw new TemplateError('LINK_REQUIRED', `La versión de texto también debe incluir {{${required}}}`)
  return { name, subject, html, text }
}

export type RenderValues = Partial<Record<EmailVariable, string>>

/** Fills variables. Values are escaped in HTML; unknown variables render empty. */
export function renderTemplate(template: { subject: string; html: string; text: string }, values: RenderValues) {
  const fill = (source: string, html: boolean) => source.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, key: string) => {
    const value = values[key as EmailVariable] ?? ''
    return html ? escapeHtml(value) : value
  })
  return { subject: fill(template.subject, false).replace(/[\r\n]+/g, ' '), html: fill(template.html, true), text: fill(template.text, false) }
}

// ---- default designs -------------------------------------------------------------

const BRAND = { forest: '#102F25', lime: '#C6F25B', coral: '#FE7041', ivory: '#F7F8F3', ink: '#1C2A24', muted: '#5C6B63' }

function layout(body: string, preheader: string) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>{{nombre_plataforma}}</title></head>
<body style="margin:0;padding:0;background:${BRAND.ivory};font-family:Arial,Helvetica,sans-serif;color:${BRAND.ink};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.ivory};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:18px;overflow:hidden;">
<tr><td style="background:${BRAND.forest};padding:22px 28px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:12px;"><img src="https://mostralopues.pages.dev/icon-512.png" width="40" height="40" alt="MOSTRALO PUES!" style="display:block;border-radius:10px;"></td>
<td style="font-size:20px;font-weight:bold;color:${BRAND.ivory};letter-spacing:0.5px;">MOSTRALO <span style="color:${BRAND.lime};">PUES!</span></td>
</tr></table>
</td></tr>
<tr><td style="padding:32px 28px 8px 28px;font-size:16px;line-height:1.6;">
${body}
</td></tr>
<tr><td style="padding:24px 28px 28px 28px;border-top:1px solid #E6EAE7;font-size:12px;line-height:1.6;color:${BRAND.muted};">
<strong style="color:${BRAND.forest};">MOSTRALO PUES!</strong> · Tu tienda online, más fácil con IA.<br>
Este es un mensaje automático de {{nombre_plataforma}}. Nunca te pediremos tu contraseña por correo.
</td></tr>
</table>
</td></tr></table>
</body></html>`
}

const button = (variable: string, label: string) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0;"><tr><td style="background:${BRAND.forest};border-radius:999px;">
<a href="{{${variable}}}" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:bold;color:${BRAND.lime};text-decoration:none;">${label}</a>
</td></tr></table>
<p style="margin:0 0 16px 0;font-size:13px;color:${BRAND.muted};">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><a href="{{${variable}}}" style="color:${BRAND.forest};word-break:break-all;">{{${variable}}}</a></p>`

const securityNote = (text: string) => `<p style="margin:16px 0 0 0;padding:14px 16px;background:#FFF4EF;border-left:4px solid ${BRAND.coral};border-radius:8px;font-size:14px;">${text}</p>`

export const DEFAULT_TEMPLATES: Record<SystemTemplateKey, { name: string; subject: string; html: string; text: string }> = {
  password_reset: {
    name: 'Recuperación de contraseña',
    subject: 'Crea tu nueva contraseña de {{nombre_plataforma}}',
    html: layout(`<h1 style="margin:0 0 16px 0;font-size:24px;color:${BRAND.forest};">Hola, {{nombre_usuario}}</h1>
<p style="margin:0 0 12px 0;">Recibimos una solicitud para recuperar el acceso al panel de <strong>{{nombre_comercio}}</strong> con el correo {{correo_usuario}}.</p>
<p style="margin:0;">Para crear una contraseña nueva, usa este botón:</p>
${button('enlace_recuperacion', 'Crear nueva contraseña')}
<p style="margin:0;font-size:14px;">El enlace vence en <strong>{{vence_en}}</strong> y sirve una sola vez.</p>
${securityNote('<strong>¿No fuiste tú?</strong> Puedes ignorar este mensaje: tu contraseña actual sigue funcionando y nadie puede cambiarla sin este enlace.')}`, 'Usa el enlace para crear una contraseña nueva. Vence pronto y sirve una sola vez.'),
    text: `Hola, {{nombre_usuario}}

Recibimos una solicitud para recuperar el acceso al panel de {{nombre_comercio}} con el correo {{correo_usuario}}.

Crea tu nueva contraseña en este enlace:
{{enlace_recuperacion}}

El enlace vence en {{vence_en}} y sirve una sola vez.

¿No fuiste tú? Ignora este mensaje: tu contraseña actual sigue funcionando.

MOSTRALO PUES! · Nunca te pediremos tu contraseña por correo.`,
  },
  invitation: {
    name: 'Invitación de usuario',
    subject: 'Te invitaron a administrar {{nombre_comercio}}',
    html: layout(`<h1 style="margin:0 0 16px 0;font-size:24px;color:${BRAND.forest};">Hola, {{nombre_usuario}}</h1>
<p style="margin:0 0 12px 0;">Te invitaron a ingresar al panel de <strong>{{nombre_comercio}}</strong> en {{nombre_plataforma}} con el correo {{correo_usuario}}.</p>
<p style="margin:0;">Para activar tu acceso y crear tu contraseña, usa este botón:</p>
${button('enlace_invitacion', 'Activar mi acceso')}
<p style="margin:0;font-size:14px;">La invitación vence en <strong>{{vence_en}}</strong> y sirve una sola vez.</p>
${securityNote('Si no esperabas esta invitación, ignora este mensaje: no se activará ninguna cuenta.')}`, 'Activa tu acceso al panel y crea tu contraseña.'),
    text: `Hola, {{nombre_usuario}}

Te invitaron a ingresar al panel de {{nombre_comercio}} en {{nombre_plataforma}} con el correo {{correo_usuario}}.

Activa tu acceso y crea tu contraseña aquí:
{{enlace_invitacion}}

La invitación vence en {{vence_en}} y sirve una sola vez. Si no la esperabas, ignora este mensaje.

MOSTRALO PUES!`,
  },
  welcome: {
    name: 'Bienvenida',
    subject: 'Tu cuenta de {{nombre_comercio}} ya está activa',
    html: layout(`<h1 style="margin:0 0 16px 0;font-size:24px;color:${BRAND.forest};">¡Bienvenido, {{nombre_usuario}}!</h1>
<p style="margin:0 0 12px 0;">Tu cuenta para administrar <strong>{{nombre_comercio}}</strong> en {{nombre_plataforma}} quedó activa.</p>
<p style="margin:0 0 12px 0;">Desde el panel puedes cargar productos, recibir pedidos por WhatsApp y personalizar tu tienda.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:${BRAND.lime};border-radius:999px;">
<a href="{{enlace_panel}}" style="display:inline-block;padding:14px 28px;font-weight:bold;color:${BRAND.forest};text-decoration:none;">Ir a mi panel</a></td></tr></table>
${securityNote('Si no creaste esta cuenta, responde a este correo o escríbenos para revisarlo.')}`, 'Tu cuenta quedó activa.'),
    text: `¡Bienvenido, {{nombre_usuario}}!

Tu cuenta para administrar {{nombre_comercio}} en {{nombre_plataforma}} quedó activa.

Ingresa a tu panel: {{enlace_panel}}

Si no creaste esta cuenta, escríbenos para revisarlo.

MOSTRALO PUES!`,
  },
  admin_notice: {
    name: 'Notificación administrativa',
    subject: 'Aviso sobre {{nombre_comercio}}',
    html: layout(`<h1 style="margin:0 0 16px 0;font-size:24px;color:${BRAND.forest};">Hola, {{nombre_usuario}}</h1>
<p style="margin:0 0 12px 0;white-space:pre-line;">{{mensaje}}</p>
<p style="margin:16px 0 0 0;font-size:14px;color:${BRAND.muted};">Este aviso es sobre tu cuenta de <strong>{{nombre_comercio}}</strong> en {{nombre_plataforma}}.</p>`, 'Aviso sobre tu cuenta.'),
    text: `Hola, {{nombre_usuario}}

{{mensaje}}

Este aviso es sobre tu cuenta de {{nombre_comercio}} en {{nombre_plataforma}}.

MOSTRALO PUES!`,
  },
  email_verification: {
    name: 'Verificación de correo',
    subject: 'Confirma tu correo en {{nombre_plataforma}}',
    html: layout(`<h1 style="margin:0 0 16px 0;font-size:24px;color:${BRAND.forest};">Hola, {{nombre_usuario}}</h1>
<p style="margin:0 0 12px 0;">Confirma que <strong>{{correo_usuario}}</strong> es tu correo para el panel de {{nombre_comercio}}. Así podrás recuperar tu acceso por correo si olvidas tu contraseña.</p>
${button('enlace_verificacion', 'Confirmar mi correo')}
<p style="margin:0;font-size:14px;">El enlace vence en <strong>{{vence_en}}</strong>. Confirmar el correo no cambia tu contraseña ni da acceso a nadie más.</p>
${securityNote('Si no reconoces esta solicitud, ignora este mensaje.')}`, 'Confirma tu correo para poder recuperar tu acceso.'),
    text: `Hola, {{nombre_usuario}}

Confirma que {{correo_usuario}} es tu correo para el panel de {{nombre_comercio}}:
{{enlace_verificacion}}

El enlace vence en {{vence_en}}. Si no reconoces esta solicitud, ignora este mensaje.

MOSTRALO PUES!`,
  },
}

/** Example values for previews and test sends. Links are clearly fake and do nothing. */
export const SAMPLE_VALUES: RenderValues = {
  nombre_usuario: 'Laura Gómez',
  correo_usuario: 'laura@ejemplo.com',
  nombre_comercio: 'Luz Mágica',
  nombre_plataforma: PLATFORM_NAME,
  vence_en: '60 minutos',
  mensaje: 'Este es un mensaje de ejemplo de la notificación administrativa.',
  enlace_panel: 'https://ejemplo.invalid/panel',
  enlace_recuperacion: 'https://ejemplo.invalid/enlace-de-muestra-sin-validez',
  enlace_invitacion: 'https://ejemplo.invalid/enlace-de-muestra-sin-validez',
  enlace_verificacion: 'https://ejemplo.invalid/enlace-de-muestra-sin-validez',
}
