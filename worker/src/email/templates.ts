/** Email templates: a closed list of variables, server-only links and HTML sanitizing.
 * Templates decide the look and the words; they can never create, change or reveal tokens. */

export const PLATFORM_NAME = 'TiendIA Exprés'
/** Logo served by the platform itself (absolute URL, as email clients need). */
export const EMAIL_LOGO_URL = 'https://app.tiendiaexpres.com/brand/tiendaiaexpress/logo-720.png'

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
  enlace_tienda: 'Dirección pública de la tienda',
  nombre_plan: 'Plan activo del comercio',
  fecha_evento: 'Fecha y hora del evento (hora de Colombia)',
  enlace_activacion: 'Enlace para confirmar el correo y entrar a la tienda de prueba (lo genera el sistema)',
  enlace_planes: 'Enlace a los planes dentro del panel (pide iniciar sesión)',
  dias_restantes: 'Días que le quedan a la prueba',
  fecha_vencimiento: 'Fecha en que termina la prueba (hora de Colombia)',
  limite_productos: 'Productos permitidos durante la prueba',
  codigo_solicitud: 'Código de la contratación (ACT-XXXXXX)',
  valor_plan: 'Valor a pagar por el plan elegido',
  ciclo_pago: 'Forma de pago del plan (mensual o anual)',
} as const
export type EmailVariable = keyof typeof EMAIL_VARIABLES

/** Secure links: generated only by the backend, and each one only allowed in its own system template. */
export const LINK_VARIABLES: Partial<Record<EmailVariable, SystemTemplateKey>> = {
  enlace_recuperacion: 'password_reset',
  enlace_invitacion: 'invitation',
  enlace_verificacion: 'email_verification',
  enlace_activacion: 'trial_signup',
}

export const SYSTEM_TEMPLATE_KEYS = ['password_reset', 'invitation', 'welcome', 'admin_notice', 'email_verification', 'password_changed',
  'trial_signup', 'trial_welcome', 'signup_existing', 'trial_expiring', 'trial_ended', 'plan_requested', 'plan_activated'] as const
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
// Identity of the commercial site (tiendiaexpres.com): night background, violet buttons and lime accents.
// Email-safe HTML: tables, inline styles, a single 560 px column that fills the screen on phones.

const BRAND = { night: '#0B0B13', violet: '#A414CF', violetText: '#8A12AD', lime: '#D9FF14', soft: '#F6F1FA', ink: '#16131F', muted: '#5E5A6B', line: '#ECE7F1' }
/** Public support channels of the platform (the same ones shown on the commercial site). */
const SUPPORT = { whatsappUrl: 'https://wa.me/573506912734', whatsappDisplay: '+57 350 691 2734', email: 'soporte@tiendiaexpres.com', sales: 'ventas@tiendiaexpres.com', site: 'https://tiendiaexpres.com' }
const SUPPORT_TEXT = `¿Necesitas ayuda? Escribe a ${SUPPORT.email} o por WhatsApp al ${SUPPORT.whatsappDisplay}.`
const FOOTER_TEXT = `TiendIA Exprés · Tu tienda online, más fácil.
Nunca te pediremos tu contraseña por correo.
${SUPPORT_TEXT}`

function layout(body: string, preheader: string) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>{{nombre_plataforma}}</title></head>
<body style="margin:0;padding:0;background:${BRAND.soft};font-family:Arial,Helvetica,sans-serif;color:${BRAND.ink};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.soft};padding:24px 10px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:20px;overflow:hidden;border:1px solid ${BRAND.line};">
<tr><td style="background:${BRAND.night};padding:22px 26px 18px 26px;">
<img src="${EMAIL_LOGO_URL}" width="210" height="80" alt="TiendIA Exprés" style="display:block;width:210px;max-width:68%;height:auto;">
</td></tr>
<tr><td style="background:${BRAND.lime};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:30px 26px 8px 26px;font-size:16px;line-height:1.6;">
${body}
</td></tr>
<tr><td style="padding:22px 26px 26px 26px;border-top:1px solid ${BRAND.line};font-size:12px;line-height:1.6;color:${BRAND.muted};">
<strong style="color:${BRAND.ink};">TiendIA Exprés</strong> · Tu tienda online, más fácil.<br>
Este es un mensaje automático de {{nombre_plataforma}}. Nunca te pediremos tu contraseña por correo.<br>
¿Necesitas ayuda? Escribe a <a href="mailto:${SUPPORT.email}" style="color:${BRAND.violetText};">${SUPPORT.email}</a> o por WhatsApp al <a href="${SUPPORT.whatsappUrl}" style="color:${BRAND.violetText};">${SUPPORT.whatsappDisplay}</a>.
</td></tr>
</table>
</td></tr></table>
</body></html>`
}

const h1 = (text: string) => `<h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.3;color:${BRAND.ink};">${text}</h1>`

const button = (variable: string, label: string, note = true) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0;"><tr><td style="background:${BRAND.violet};border-radius:999px;">
<a href="{{${variable}}}" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none;">${label}</a>
</td></tr></table>
${note ? `<p style="margin:0 0 16px 0;font-size:13px;color:${BRAND.muted};">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><a href="{{${variable}}}" style="color:${BRAND.violetText};word-break:break-all;">{{${variable}}}</a></p>` : ''}`

const securityNote = (text: string) => `<p style="margin:16px 0 0 0;padding:14px 16px;background:${BRAND.soft};border-left:4px solid ${BRAND.violet};border-radius:8px;font-size:14px;">${text}</p>`

const facts = (rows: Array<[string, string]>) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px 0;font-size:14px;line-height:1.7;">
${rows.map(([label, value]) => `<tr><td style="padding-right:14px;color:${BRAND.muted};vertical-align:top;">${label}</td><td>${value}</td></tr>`).join('\n')}
</table>`

export const DEFAULT_TEMPLATES: Record<SystemTemplateKey, { name: string; subject: string; html: string; text: string }> = {
  password_reset: {
    name: 'Recuperación de contraseña',
    subject: 'Restablece tu contraseña | TiendIA Exprés',
    html: layout(`${h1('Hola, {{nombre_usuario}}')}
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

${FOOTER_TEXT}`,
  },
  invitation: {
    name: 'Invitación de usuario',
    subject: 'Te invitaron a administrar {{nombre_comercio}} | TiendIA Exprés',
    html: layout(`${h1('Hola, {{nombre_usuario}}')}
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

${FOOTER_TEXT}`,
  },
  welcome: {
    name: 'Bienvenida',
    subject: 'Te damos la bienvenida a TiendIA Exprés: tu tienda está lista',
    html: layout(`${h1('¡Te damos la bienvenida, {{nombre_usuario}}!')}
<p style="margin:0 0 12px 0;">Tu cuenta para administrar <strong>{{nombre_comercio}}</strong> en {{nombre_plataforma}} quedó activa.</p>
${facts([['Negocio', '<strong>{{nombre_comercio}}</strong>'], ['Usuario', '{{correo_usuario}}'], ['Plan', '{{nombre_plan}}'], ['Tu tienda', `<a href="{{enlace_tienda}}" style="color:${BRAND.violetText};word-break:break-all;">{{enlace_tienda}}</a>`]])}
<p style="margin:12px 0;">Ingresa con tu correo y la contraseña que creaste. Desde el panel puedes cargar productos, recibir pedidos por WhatsApp y personalizar tu tienda.</p>
${button('enlace_panel', 'Ir a mi panel', false)}
<p style="margin:0 0 12px 0;font-size:14px;">Inicio de sesión: <a href="{{enlace_panel}}" style="color:${BRAND.violetText};word-break:break-all;">{{enlace_panel}}</a></p>
${securityNote('Nunca te enviaremos tu contraseña. Si no creaste esta cuenta, escríbenos para revisarlo.')}`, 'Tu cuenta quedó activa. Estos son tus datos de acceso.'),
    text: `¡Te damos la bienvenida, {{nombre_usuario}}!

Tu cuenta para administrar {{nombre_comercio}} en {{nombre_plataforma}} quedó activa.

Negocio: {{nombre_comercio}}
Usuario: {{correo_usuario}}
Plan: {{nombre_plan}}
Tu tienda: {{enlace_tienda}}

Ingresa con tu correo y la contraseña que creaste: {{enlace_panel}}

Nunca te enviaremos tu contraseña. Si no creaste esta cuenta, escríbenos para revisarlo.

${FOOTER_TEXT}`,
  },
  admin_notice: {
    name: 'Notificación administrativa',
    subject: 'Aviso sobre {{nombre_comercio}} | TiendIA Exprés',
    html: layout(`${h1('Hola, {{nombre_usuario}}')}
<p style="margin:0 0 12px 0;white-space:pre-line;">{{mensaje}}</p>
<p style="margin:16px 0 0 0;font-size:14px;color:${BRAND.muted};">Este aviso es sobre tu cuenta de <strong>{{nombre_comercio}}</strong> en {{nombre_plataforma}}.</p>`, 'Aviso sobre tu cuenta.'),
    text: `Hola, {{nombre_usuario}}

{{mensaje}}

Este aviso es sobre tu cuenta de {{nombre_comercio}} en {{nombre_plataforma}}.

${FOOTER_TEXT}`,
  },
  email_verification: {
    name: 'Verificación de correo',
    subject: 'Confirma tu correo electrónico | TiendIA Exprés',
    html: layout(`${h1('Hola, {{nombre_usuario}}')}
<p style="margin:0 0 12px 0;">Confirma que <strong>{{correo_usuario}}</strong> es tu correo para el panel de {{nombre_comercio}}. Así podrás recuperar tu acceso por correo si olvidas tu contraseña.</p>
${button('enlace_verificacion', 'Confirmar mi correo')}
<p style="margin:0;font-size:14px;">El enlace vence en <strong>{{vence_en}}</strong>. Confirmar el correo no cambia tu contraseña ni da acceso a nadie más.</p>
${securityNote('Si no reconoces esta solicitud, ignora este mensaje.')}`, 'Confirma tu correo para poder recuperar tu acceso.'),
    text: `Hola, {{nombre_usuario}}

Confirma que {{correo_usuario}} es tu correo para el panel de {{nombre_comercio}}:
{{enlace_verificacion}}

El enlace vence en {{vence_en}}. Si no reconoces esta solicitud, ignora este mensaje.

${FOOTER_TEXT}`,
  },
  password_changed: {
    name: 'Aviso de cambio de contraseña',
    subject: 'Tu contraseña fue cambiada | TiendIA Exprés',
    html: layout(`${h1('Hola, {{nombre_usuario}}')}
<p style="margin:0 0 12px 0;">La contraseña de tu cuenta <strong>{{correo_usuario}}</strong> en {{nombre_plataforma}} se cambió el <strong>{{fecha_evento}}</strong>.</p>
<p style="margin:0 0 12px 0;">Por seguridad, cerramos las demás sesiones abiertas de tu cuenta.</p>
${securityNote('<strong>¿No fuiste tú?</strong> Usa «¿Olvidaste tu contraseña?» en el inicio de sesión para recuperar el acceso y escríbenos de inmediato.')}
<p style="margin:16px 0 0 0;font-size:14px;">Inicio de sesión: <a href="{{enlace_panel}}" style="color:${BRAND.violetText};word-break:break-all;">{{enlace_panel}}</a></p>`, 'Aviso de seguridad: tu contraseña cambió.'),
    text: `Hola, {{nombre_usuario}}

La contraseña de tu cuenta {{correo_usuario}} en {{nombre_plataforma}} se cambió el {{fecha_evento}}.
Por seguridad, cerramos las demás sesiones abiertas de tu cuenta.

¿No fuiste tú? Usa «¿Olvidaste tu contraseña?» en {{enlace_panel}} para recuperar el acceso y escríbenos de inmediato.

${FOOTER_TEXT}`,
  },
  trial_signup: {
    name: 'Prueba gratis: confirmar correo',
    subject: 'Confirma tu correo y entra a {{nombre_comercio}} | TiendIA Exprés',
    html: layout(`${h1('Hola, {{nombre_usuario}}')}
<p style="margin:0 0 12px 0;">Tu tienda <strong>{{nombre_comercio}}</strong> ya está creada en {{nombre_plataforma}}. Solo falta confirmar que <strong>{{correo_usuario}}</strong> es tu correo.</p>
<p style="margin:0;">Con este botón confirmas tu correo, creas tu contraseña y entras a tu panel:</p>
${button('enlace_activacion', 'Confirmar y entrar a mi tienda')}
<p style="margin:0 0 12px 0;font-size:14px;">El enlace vence en <strong>{{vence_en}}</strong> y sirve una sola vez. Si vence, pide uno nuevo desde la página de registro.</p>
${facts([['Prueba', '{{dias_restantes}} días gratis desde que confirmes'], ['Productos', 'Hasta {{limite_productos}}'], ['Tarjeta', 'No se pide tarjeta de crédito']])}
${securityNote('Si no creaste esta tienda, ignora este mensaje: sin confirmar el correo nadie puede entrar ni publicarla.')}`, 'Confirma tu correo para entrar a tu tienda de prueba.'),
    text: `Hola, {{nombre_usuario}}

Tu tienda {{nombre_comercio}} ya está creada en {{nombre_plataforma}}. Solo falta confirmar que {{correo_usuario}} es tu correo.

Confirma tu correo, crea tu contraseña y entra a tu panel:
{{enlace_activacion}}

El enlace vence en {{vence_en}} y sirve una sola vez. Si vence, pide uno nuevo desde la página de registro.

Prueba: {{dias_restantes}} días gratis desde que confirmes · Hasta {{limite_productos}} productos · Sin tarjeta de crédito.

Si no creaste esta tienda, ignora este mensaje.

${FOOTER_TEXT}`,
  },
  trial_welcome: {
    name: 'Prueba gratis: bienvenida',
    subject: 'Tu prueba gratis de {{dias_restantes}} días empezó | TiendIA Exprés',
    html: layout(`${h1('¡Te damos la bienvenida, {{nombre_usuario}}!')}
<p style="margin:0 0 12px 0;">Tu tienda <strong>{{nombre_comercio}}</strong> ya está publicada y lista para recibir pedidos por WhatsApp.</p>
${facts([['Tu tienda', `<a href="{{enlace_tienda}}" style="color:${BRAND.violetText};word-break:break-all;">{{enlace_tienda}}</a>`], ['Prueba', '{{dias_restantes}} días, hasta el {{fecha_vencimiento}}'], ['Productos', 'Hasta {{limite_productos}}'], ['Usuario', '{{correo_usuario}}']])}
<p style="margin:14px 0 6px 0;"><strong>Primeros pasos:</strong></p>
<p style="margin:0 0 4px 0;">1. Sube tu logo y elige los colores de tu marca.</p>
<p style="margin:0 0 4px 0;">2. Crea tus productos con fotos, precios y tallas o colores.</p>
<p style="margin:0 0 12px 0;">3. Comparte el enlace de tu tienda con tus clientes.</p>
${button('enlace_panel', 'Ir a mi panel', false)}
<p style="margin:0 0 12px 0;font-size:14px;">Si contratas un plan, conservas tu tienda tal como la dejaste: productos, fotos, pedidos y configuración.</p>`, 'Tu tienda está publicada. Estos son tus primeros pasos.'),
    text: `¡Te damos la bienvenida, {{nombre_usuario}}!

Tu tienda {{nombre_comercio}} ya está publicada y lista para recibir pedidos por WhatsApp.

Tu tienda: {{enlace_tienda}}
Prueba: {{dias_restantes}} días, hasta el {{fecha_vencimiento}}
Productos: hasta {{limite_productos}}
Usuario: {{correo_usuario}}

Primeros pasos:
1. Sube tu logo y elige los colores de tu marca.
2. Crea tus productos con fotos, precios y tallas o colores.
3. Comparte el enlace de tu tienda con tus clientes.

Tu panel: {{enlace_panel}}

Si contratas un plan, conservas tu tienda tal como la dejaste: productos, fotos, pedidos y configuración.

${FOOTER_TEXT}`,
  },
  signup_existing: {
    name: 'Registro con un correo que ya tiene cuenta',
    subject: 'Ya tienes una cuenta en TiendIA Exprés',
    html: layout(`${h1('Hola')}
<p style="margin:0 0 12px 0;">Alguien intentó crear una tienda de prueba con <strong>{{correo_usuario}}</strong>, pero ese correo ya tiene una cuenta en {{nombre_plataforma}}.</p>
<p style="margin:0 0 12px 0;">Entra a tu panel con tu correo y tu contraseña. Si no la recuerdas, usa «¿Olvidaste tu contraseña?» en el inicio de sesión.</p>
${button('enlace_panel', 'Iniciar sesión', false)}
${securityNote('Si no fuiste tú, ignora este mensaje: tu cuenta no cambió y no se creó nada nuevo.')}`, 'Tu correo ya tiene una cuenta. Entra con tu contraseña.'),
    text: `Hola

Alguien intentó crear una tienda de prueba con {{correo_usuario}}, pero ese correo ya tiene una cuenta en {{nombre_plataforma}}.

Inicia sesión con tu correo y tu contraseña en {{enlace_panel}}
Si no la recuerdas, usa «¿Olvidaste tu contraseña?» en el inicio de sesión.

Si no fuiste tú, ignora este mensaje: tu cuenta no cambió.

${FOOTER_TEXT}`,
  },
  trial_expiring: {
    name: 'Prueba gratis por vencer',
    subject: 'Tu prueba termina en {{dias_restantes}} día(s): conserva {{nombre_comercio}}',
    html: layout(`${h1('Hola, {{nombre_usuario}}')}
<p style="margin:0 0 12px 0;">La prueba gratis de <strong>{{nombre_comercio}}</strong> termina el <strong>{{fecha_vencimiento}}</strong> (en {{dias_restantes}} día(s)).</p>
<p style="margin:0 0 12px 0;">Si eliges un plan, tu tienda sigue igual: el mismo enlace, tus productos, fotos, pedidos y configuración. No tienes que empezar de nuevo.</p>
${button('enlace_planes', 'Activar mi tienda', false)}
<p style="margin:0 0 12px 0;font-size:14px;">Si la prueba termina sin plan, guardamos tus datos, pero la tienda deja de recibir pedidos hasta que la actives.</p>`, 'Tu prueba está por terminar. Elige un plan y conserva todo lo que creaste.'),
    text: `Hola, {{nombre_usuario}}

La prueba gratis de {{nombre_comercio}} termina el {{fecha_vencimiento}} (en {{dias_restantes}} día(s)).

Si eliges un plan, tu tienda sigue igual: el mismo enlace, tus productos, fotos, pedidos y configuración.

Activar mi tienda: {{enlace_planes}}

Si la prueba termina sin plan, guardamos tus datos, pero la tienda deja de recibir pedidos hasta que la actives.

${FOOTER_TEXT}`,
  },
  trial_ended: {
    name: 'Prueba gratis finalizada',
    subject: 'Tu prueba terminó: tus datos de {{nombre_comercio}} siguen guardados',
    html: layout(`${h1('Hola, {{nombre_usuario}}')}
<p style="margin:0 0 12px 0;">La prueba gratis de <strong>{{nombre_comercio}}</strong> terminó el {{fecha_vencimiento}}.</p>
<p style="margin:0 0 12px 0;">Tus productos, fotos, pedidos y configuración siguen guardados. Mientras no elijas un plan, la tienda no recibe pedidos nuevos ni permite crear productos.</p>
<p style="margin:0;">Para seguir vendiendo con la misma tienda y el mismo enlace:</p>
${button('enlace_planes', 'Activar mi tienda', false)}
<p style="margin:0 0 12px 0;font-size:14px;">Puedes entrar a tu panel para consultar tu información en cualquier momento.</p>`, 'Tus datos siguen guardados. Activa tu tienda para volver a recibir pedidos.'),
    text: `Hola, {{nombre_usuario}}

La prueba gratis de {{nombre_comercio}} terminó el {{fecha_vencimiento}}.

Tus productos, fotos, pedidos y configuración siguen guardados. Mientras no elijas un plan, la tienda no recibe pedidos nuevos ni permite crear productos.

Activar mi tienda: {{enlace_planes}}

${FOOTER_TEXT}`,
  },
  plan_requested: {
    name: 'Contratación recibida',
    subject: 'Recibimos tu solicitud del plan {{nombre_plan}} ({{codigo_solicitud}})',
    html: layout(`${h1('Hola, {{nombre_usuario}}')}
<p style="margin:0 0 12px 0;">Recibimos tu solicitud para activar <strong>{{nombre_comercio}}</strong> con el plan <strong>{{nombre_plan}}</strong>.</p>
${facts([['Código', '<strong>{{codigo_solicitud}}</strong>'], ['Plan', '{{nombre_plan}}'], ['Forma de pago', '{{ciclo_pago}}'], ['Valor', '{{valor_plan}}']])}
<p style="margin:14px 0 12px 0;">Nuestro equipo de ventas te escribirá con los datos de pago. Tu plan se activa cuando confirmemos el pago; mientras tanto tu tienda sigue como está.</p>
${securityNote(`Solo pagamos y cobramos por los canales oficiales. Si tienes dudas, responde a este correo o escribe a ${SUPPORT.sales}.`)}`, 'Recibimos tu solicitud. Te escribiremos con los datos de pago.'),
    text: `Hola, {{nombre_usuario}}

Recibimos tu solicitud para activar {{nombre_comercio}} con el plan {{nombre_plan}}.

Código: {{codigo_solicitud}}
Plan: {{nombre_plan}}
Forma de pago: {{ciclo_pago}}
Valor: {{valor_plan}}

Nuestro equipo de ventas te escribirá con los datos de pago. Tu plan se activa cuando confirmemos el pago; mientras tanto tu tienda sigue como está.

Dudas: responde a este correo o escribe a ${SUPPORT.sales}.

${FOOTER_TEXT}`,
  },
  plan_activated: {
    name: 'Pago verificado y plan activado',
    subject: 'Pago confirmado: {{nombre_comercio}} ya tiene el plan {{nombre_plan}}',
    html: layout(`${h1('¡Listo, {{nombre_usuario}}!')}
<p style="margin:0 0 12px 0;">Confirmamos tu pago y activamos el plan <strong>{{nombre_plan}}</strong> en <strong>{{nombre_comercio}}</strong>.</p>
<p style="margin:0 0 12px 0;">Tu tienda sigue siendo la misma: el mismo enlace, tus productos, fotos, pedidos y configuración. Ya no tiene los límites de la prueba.</p>
${facts([['Código', '{{codigo_solicitud}}'], ['Plan', '{{nombre_plan}}'], ['Forma de pago', '{{ciclo_pago}}'], ['Tu tienda', `<a href="{{enlace_tienda}}" style="color:${BRAND.violetText};word-break:break-all;">{{enlace_tienda}}</a>`]])}
${button('enlace_panel', 'Ir a mi panel', false)}`, 'Tu plan quedó activo. Tu tienda conserva todo lo que creaste.'),
    text: `¡Listo, {{nombre_usuario}}!

Confirmamos tu pago y activamos el plan {{nombre_plan}} en {{nombre_comercio}}.

Tu tienda sigue siendo la misma: el mismo enlace, tus productos, fotos, pedidos y configuración. Ya no tiene los límites de la prueba.

Código: {{codigo_solicitud}}
Plan: {{nombre_plan}}
Forma de pago: {{ciclo_pago}}
Tu tienda: {{enlace_tienda}}
Tu panel: {{enlace_panel}}

${FOOTER_TEXT}`,
  },
}

/** Example values for previews and test sends. Links are clearly fake and do nothing. */
export const SAMPLE_VALUES: RenderValues = {
  nombre_usuario: 'Laura Gómez',
  correo_usuario: 'laura@ejemplo.com',
  nombre_comercio: 'Luz Mágica',
  nombre_plataforma: PLATFORM_NAME,
  vence_en: '60 minutos',
  enlace_tienda: 'https://ejemplo.invalid/t/luz-magica',
  nombre_plan: 'Emprendedor',
  fecha_evento: '10/11/2026, 4:30 p. m.',
  mensaje: 'Este es un mensaje de ejemplo de la notificación administrativa.',
  enlace_panel: 'https://ejemplo.invalid/panel',
  enlace_recuperacion: 'https://ejemplo.invalid/enlace-de-muestra-sin-validez',
  enlace_invitacion: 'https://ejemplo.invalid/enlace-de-muestra-sin-validez',
  enlace_verificacion: 'https://ejemplo.invalid/enlace-de-muestra-sin-validez',
  enlace_activacion: 'https://ejemplo.invalid/enlace-de-muestra-sin-validez',
  enlace_planes: 'https://ejemplo.invalid/panel/activar-tienda',
  dias_restantes: '3',
  fecha_vencimiento: '21 de noviembre de 2026',
  limite_productos: '7',
  codigo_solicitud: 'ACT-7K2M9Q',
  valor_plan: '$208.900 COP',
  ciclo_pago: 'Mensual (incluye el pago inicial)',
}
