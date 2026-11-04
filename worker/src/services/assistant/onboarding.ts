import type { AssistantContext } from './context'
import { say } from './context'
import { adminStoreUrl, publicStoreUrl } from '../../tenancy/stores'
import { roleAllows } from '../../tenancy/access'
import { TEMPLATE_KEYS, TEMPLATE_LABELS, TEMPLATE_DESIGNS, templatePalette, type TemplateKey } from '../templates'
import { contrastRatio, isLegiblePalette, namedColor, palettesFromColors, previewPaletteParam, type LogoPalette } from './logoPalette'
import { escapeHtml } from './tools'

export type OnboardingStep = 'welcome' | 'business' | 'logo' | 'colors' | 'template' | 'banner' | 'product' | 'more_products' | 'review'
export type OnboardingStatus = 'in_progress' | 'deferred' | 'completed'
export type OnboardingRecord = { status: OnboardingStatus; step: OnboardingStep; state: Record<string, unknown>; version: number; expires_at: number }
export type OnboardingCallbackResult = 'handled' | 'add_product' | 'view_products' | false

const TTL_SECONDS = 90 * 24 * 60 * 60

export async function getOnboarding(ctx: AssistantContext): Promise<OnboardingRecord | null> {
  const row = await ctx.db.prepare(
    `SELECT status, step, state_json, version, expires_at FROM store_onboardings WHERE store_id = ? AND telegram_user_id = ?`,
  ).bind(ctx.store.id, ctx.telegramUserId).first<{ status: OnboardingStatus; step: OnboardingStep; state_json: string; version: number; expires_at: number }>()
  if (!row) return null
  let state: Record<string, unknown> = {}
  try { const parsed = JSON.parse(row.state_json); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) state = parsed } catch { /* recover to an empty, safe state */ }
  return { status: row.status, step: row.step, state, version: row.version, expires_at: row.expires_at }
}

/** Auto-start only for owner accounts and stores created after this migration. */
export async function showOnboardingForStart(ctx: AssistantContext): Promise<boolean> {
  if (ctx.role !== 'owner') return false
  let progress = await getOnboarding(ctx)
  if (!progress) {
    const eligible = await ctx.db.prepare(
      `SELECT 1 AS eligible FROM stores s LEFT JOIN store_onboarding_legacy_stores legacy ON legacy.store_id = s.id
       WHERE s.id = ? AND legacy.store_id IS NULL`,
    ).bind(ctx.store.id).first<{ eligible: number }>()
    if (!eligible) return false
    await insertOnboarding(ctx)
    progress = await getOnboarding(ctx)
  }
  if (!progress || progress.status !== 'in_progress') return false
  if (progress.expires_at <= Math.floor(Date.now() / 1000)) {
    await transition(ctx, progress, progress.step, {}, 'deferred')
    return false
  }
  await renderOnboarding(ctx, progress)
  return true
}

/** Explicit /continuar opts into the flow for any owner, including legacy stores. */
export async function continueOnboarding(ctx: AssistantContext): Promise<void> {
  if (ctx.role !== 'owner') { await say(ctx, 'Solo el propietario puede iniciar esta configuración guiada. Pídele que te agregue desde el panel.'); return }
  let progress = await getOnboarding(ctx)
  if (progress?.status === 'completed') {
    await say(ctx, 'La configuración inicial ya está terminada. Para hacer cambios, usa ⚙️ “Configurar mi tienda”.', settingsKeyboard())
    return
  }
  if (!progress) {
    await insertOnboarding(ctx)
    progress = await getOnboarding(ctx)
  }
  if (!progress) { await say(ctx, 'No pude guardar tu avance. Inténtalo nuevamente con /continuar.'); return }
  if (progress.status === 'deferred' || progress.expires_at <= Math.floor(Date.now() / 1000)) {
    const expired = progress.expires_at <= Math.floor(Date.now() / 1000)
    await ctx.db.prepare(
      `UPDATE store_onboardings SET status = 'in_progress', step = ?, state_json = ?, version = version + 1,
         mutation_token = NULL, expires_at = unixepoch() + ?, completed_at = NULL, updated_at = unixepoch()
       WHERE store_id = ? AND telegram_user_id = ? AND version = ? AND (status = 'deferred' OR expires_at <= unixepoch())`,
    ).bind(expired ? 'welcome' : progress.step, expired ? '{}' : JSON.stringify(progress.state), TTL_SECONDS, ctx.store.id, ctx.telegramUserId, progress.version).run()
    progress = await getOnboarding(ctx)
  }
  await renderOnboarding(ctx, progress)
}

export async function showSettingsCenter(ctx: AssistantContext): Promise<void> {
  const progress = await getOnboarding(ctx)
  const adminUrl = adminStoreUrl(ctx.env.PUBLIC_STORE_BASE_URL, ctx.store)
  const rows: Array<Array<{ text: string; callback_data?: string; url?: string }>> = [
    [{ text: '🧾 Datos y contacto', url: `${adminUrl}/settings` }],
    [{ text: '🖼️ Logotipo', callback_data: 'm:logo' }, { text: '🎨 Colores', callback_data: 'm:colors' }],
    [{ text: '🧩 Plantilla', callback_data: 'm:templates' }, { text: '🛠️ Apariencia en el panel', url: `${adminUrl}/appearance` }],
    [{ text: '📸 Portada', callback_data: 'm:banner' }, { text: '📱 WhatsApp', callback_data: 'm:whatsapp' }],
    [{ text: '⭐ Productos destacados', url: `${adminUrl}/products` }],
    [{ text: '➕ Agregar producto', callback_data: 'm:new_product' }, { text: '👁 Vista privada', callback_data: `ob:${ctx.store.id}:private_preview` }],
  ]
  if (progress && progress.status !== 'completed') rows.push([{ text: '▶️ Continuar configuración guiada', callback_data: `ob:${ctx.store.id}:resume` }])
  rows.push([{ text: '↩ Menú principal', callback_data: 'm:menu' }])
  await say(ctx, `⚙️ <b>Configurar ${escapeHtml(ctx.store.name)}</b>\n\nPuedes cambiar la información, el logotipo, los colores, la plantilla, la portada o tus productos cuando quieras.`, { inline_keyboard: rows })
}

export async function handleOnboardingCallback(ctx: AssistantContext, action: string): Promise<OnboardingCallbackResult> {
  if (ctx.role !== 'owner') { await say(ctx, 'Esta configuración está disponible para el propietario de la tienda.'); return 'handled' }
  const progress = await getOnboarding(ctx)
  if (action === 'resume') { await continueOnboarding(ctx); return 'handled' }
  if (action === 'private_preview') {
    await say(ctx, 'Esta es una vista previa privada de tu tienda. Tendrás que iniciar sesión; esto no publica ni activa la tienda.', {
      inline_keyboard: [[{ text: '👁 Abrir vista previa privada', url: `${adminStoreUrl(ctx.env.PUBLIC_STORE_BASE_URL, ctx.store)}/store-preview` }]],
    })
    return 'handled'
  }
  if (!progress || progress.status !== 'in_progress' || progress.expires_at <= Math.floor(Date.now() / 1000)) {
    await say(ctx, 'Ese paso ya venció. Usa /continuar para recuperar tu avance.')
    return 'handled'
  }
  if (action === 'start' && progress.step === 'welcome') {
    await go(ctx, progress, 'business')
    return 'handled'
  }
  if (action === 'later') {
    await transition(ctx, progress, progress.step, progress.state, 'deferred')
    await say(ctx, 'Listo, guardé tu avance. Cuando quieras volver, escribe /continuar. 👋')
    return 'handled'
  }
  if (action === 'help') {
    await say(ctx, 'Te acompaño con preguntas cortas. Puedes salir cuando quieras; guardaré el paso actual. Para seguir otro día, escribe /continuar. Para abrir el menú de configuración, usa /configurar.', {
      inline_keyboard: [[{ text: '▶️ Seguir', callback_data: `ob:${ctx.store.id}:resume_step` }]],
    })
    return 'handled'
  }
  if (action === 'resume_step') { await renderOnboarding(ctx, progress); return 'handled' }
  if (action === 'back') {
    const previous: Partial<Record<OnboardingStep, OnboardingStep>> = {
      business: 'welcome', logo: 'business', colors: 'logo', template: 'colors', banner: 'template',
      product: 'banner', more_products: 'product', review: 'more_products',
    }
    const step = previous[progress.step]
    if (step) {
      const state = { ...progress.state, awaitingBusinessField: undefined, awaitingImage: undefined }
      const next = await transition(ctx, progress, step, state)
      if (next) await renderOnboarding(ctx, next)
    }
    return 'handled'
  }

  if (progress.step === 'business') {
    if (action === 'business:ok' || action === 'business:continue') await go(ctx, progress, 'logo')
    else if (action === 'business:edit') await say(ctx, '¿Qué dato quieres cambiar?', { inline_keyboard: [
      [{ text: 'Nombre', callback_data: `ob:${ctx.store.id}:field:name` }, { text: 'Tipo de comercio', callback_data: `ob:${ctx.store.id}:field:business_type` }],
      [{ text: 'WhatsApp', callback_data: `ob:${ctx.store.id}:field:whatsapp_phone` }, { text: '↩ Seguir', callback_data: `ob:${ctx.store.id}:business:continue` }],
    ] })
    else if (action.startsWith('field:')) {
      const field = action.slice('field:'.length)
      if (!['name', 'business_type', 'whatsapp_phone'].includes(field)) return 'handled'
      const labels: Record<string, string> = { name: 'Escribe el nombre comercial nuevo (2 a 80 caracteres).', business_type: '¿A qué se dedica la tienda? Escríbelo en pocas palabras.', whatsapp_phone: 'Escribe el WhatsApp con código de país, por ejemplo +573001234567.' }
      const next = await transition(ctx, progress, 'business', { ...progress.state, awaitingBusinessField: field })
      if (next) await say(ctx, labels[field]!)
    }
    return 'handled'
  }

  if (progress.step === 'logo') {
    if (action === 'logo:upload') {
      const next = await transition(ctx, progress, 'logo', { ...progress.state, awaitingImage: 'logo' })
      if (next) await say(ctx, 'Envíame tu logotipo como foto o archivo PNG, JPG o WebP. Lo revisaré antes de guardarlo.')
    } else if (action === 'logo:name' || action === 'logo:later') {
      await go(ctx, progress, 'colors')
    }
    return 'handled'
  }

  if (progress.step === 'colors') {
    const selected = String(action.match(/^colors:(faithful|balanced|vibrant|neutral|recommended|bright)$/)?.[1] || '')
    const options = Array.isArray(progress.state.colorOptions) ? progress.state.colorOptions as LogoPalette[] : fallbackColorOptions()
    const option = options.find((item) => item.id === selected)
    if (!option) return 'handled'
    if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite cambiar la apariencia. Pídele al propietario que elija estos colores.'); return 'handled' }
    const next = await applyOnboardingMutation(ctx, progress, 'colors', 'template', progress.state, {
      theme_config: await paletteThemeJson(ctx, option.palette), primary_color: option.palette.primary,
      secondary_color: option.palette.secondary, accent_color: option.palette.accent, button_color: option.palette.button,
    })
    if (next) await renderOnboarding(ctx, next)
    return 'handled'
  }

  if (progress.step === 'template') {
    const template = action.match(/^template:([a-z_]+)$/)?.[1] as TemplateKey | undefined
    if (!template || !(TEMPLATE_KEYS as readonly string[]).includes(template)) return 'handled'
    if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite cambiar la plantilla. Pídele al propietario que la elija.'); return 'handled' }
    const themeConfig = await templateThemeJson(ctx, template)
    const next = await applyOnboardingMutation(ctx, progress, 'template', 'banner', progress.state, { theme_config: themeConfig }, template)
    if (next) await renderOnboarding(ctx, next)
    return 'handled'
  }

  if (progress.step === 'banner') {
    if (action === 'banner:upload') {
      const next = await transition(ctx, progress, 'banner', { ...progress.state, awaitingImage: 'banner' })
      if (next) await say(ctx, 'Envíame una foto horizontal para la portada. Puedes usar una foto del negocio o un producto; no la recortaré ni deformaré.')
    } else if (action === 'banner:use' || action === 'banner:later') await go(ctx, progress, 'product')
    return 'handled'
  }

  if (progress.step === 'product' || progress.step === 'more_products') {
    if (action === 'product:add' || action === 'more:add') return 'add_product'
    if (action === 'more:view') return 'view_products'
    if (action === 'product:later' || action === 'more:later' || action === 'more:review') { await go(ctx, progress, 'review'); return 'handled' }
    return 'handled'
  }

  if (progress.step === 'review') {
    if (action === 'review:request') {
      if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite solicitar la activación. Pídele al propietario que lo haga.'); return 'handled' }
      const request = await ctx.db.prepare(`INSERT OR IGNORE INTO store_activation_requests (store_id, requested_by) VALUES (?, ?) RETURNING id`)
        .bind(ctx.store.id, `telegram:${ctx.telegramUserId}`).first<{ id: number }>()
      if (request) await ctx.db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('store_activation_requested', 'store', ?, '{}', ?, 'telegram', ?)`)
        .bind(String(ctx.store.id), `telegram:${ctx.telegramUserId}`, ctx.store.id).run()
      await finish(ctx, progress)
      await say(ctx, '✅ Envié la solicitud al equipo de administración. La tienda seguirá privada hasta que la revisen y la activen.', settingsKeyboard())
    } else if (action === 'review:finish') {
      await finish(ctx, progress)
      await say(ctx, '¡Listo! Guardé tu configuración. La tienda continúa en borrador hasta que el equipo con permisos la active.', settingsKeyboard())
    } else if (action === 'review:preview') {
      await handleOnboardingCallback(ctx, 'private_preview')
    }
    return 'handled'
  }
  return false
}

export async function handleOnboardingText(ctx: AssistantContext, text: string): Promise<boolean> {
  const progress = await getOnboarding(ctx)
  if (!progress || progress.status !== 'in_progress' || progress.step !== 'business' || typeof progress.state.awaitingBusinessField !== 'string') return false
  const field = String(progress.state.awaitingBusinessField)
  const value = text.trim()
  const fields: Record<string, unknown> = {}
  if (field === 'name') {
    if (value.length < 2 || value.length > 80) { await say(ctx, 'El nombre debe tener entre 2 y 80 caracteres.'); return true }
    fields.name = value
  } else if (field === 'business_type') {
    if (value.length < 2 || value.length > 120) { await say(ctx, 'Escríbelo en pocas palabras (2 a 120 caracteres).'); return true }
    fields.business_type = value
  } else if (field === 'whatsapp_phone') {
    const phone = value.replace(/[\s().-]/g, '')
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) { await say(ctx, 'El número debe incluir el código de país. Ejemplo: +573001234567.'); return true }
    fields.whatsapp_phone = phone
    fields.whatsapp_orders = phone
  } else return false

  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite cambiar los datos comerciales.'); return true }
  const next = await applyOnboardingMutation(ctx, progress, 'business', 'business', { ...progress.state, awaitingBusinessField: undefined }, fields)
  if (next) await renderOnboarding(ctx, next)
  return true
}

export async function storeOnboardingLogoOptions(ctx: AssistantContext, options: LogoPalette[] | null): Promise<void> {
  const progress = await getOnboarding(ctx)
  if (!progress || progress.status !== 'in_progress' || progress.step !== 'logo') return
  const next = await transition(ctx, progress, 'logo', { ...progress.state, awaitingImage: undefined, ...(options ? { colorOptions: options } : { colorOptions: fallbackColorOptions(), colorFallback: true }) })
  if (next && !options) await say(ctx, 'Pude guardar el logotipo, pero el bot no puede leer sus colores directamente en este formato. Te mostraré combinaciones accesibles para elegir; también puedes generar paletas desde el panel web.')
}

export async function advanceAfterConfirmedLogo(ctx: AssistantContext): Promise<boolean> {
  const progress = await getOnboarding(ctx)
  if (!progress || progress.status !== 'in_progress' || progress.step !== 'logo') return false
  const next = await transition(ctx, progress, 'colors', progress.state)
  if (next) await renderOnboarding(ctx, next)
  return true
}

export async function advanceAfterConfirmedBanner(ctx: AssistantContext): Promise<boolean> {
  const progress = await getOnboarding(ctx)
  if (!progress || progress.status !== 'in_progress' || progress.step !== 'banner') return false
  const next = await transition(ctx, progress, 'product', progress.state)
  if (next) await renderOnboarding(ctx, next)
  return true
}

export async function advanceAfterPublishedProduct(ctx: AssistantContext): Promise<void> {
  const progress = await getOnboarding(ctx)
  if (!progress || progress.status !== 'in_progress' || !['product', 'more_products'].includes(progress.step)) return
  const next = await transition(ctx, progress, 'more_products', progress.state)
  if (next) await renderOnboarding(ctx, next)
}

export async function renderOnboarding(ctx: AssistantContext, progress?: OnboardingRecord | null): Promise<void> {
  const current = progress || await getOnboarding(ctx)
  if (!current) return
  const cb = (action: string) => `ob:${ctx.store.id}:${action}`
  const steps: Record<OnboardingStep, number> = { welcome: 0, business: 1, logo: 2, colors: 3, template: 4, banner: 5, product: 6, more_products: 7, review: 7 }
  const step = current.step
  const progressLabel = step === 'welcome' ? '' : `\n\n<b>Paso ${steps[step]} de 7</b>`
  if (step === 'welcome') {
    const url = `${adminStoreUrl(ctx.env.PUBLIC_STORE_BASE_URL, ctx.store)}/store-preview`
    await say(ctx, `¡Hola${ctx.firstName ? `, ${escapeHtml(ctx.firstName)}` : ''}! 👋\n\n¡Tu tienda <b>${escapeHtml(ctx.store.name)}</b> está casi lista!\n\nSoy tu asistente y te ayudaré a personalizarla, subir tus primeros productos y prepararla para recibir clientes. Puedes avanzar a tu ritmo; guardaré tu progreso. ¿Comenzamos?`, { inline_keyboard: [
      [{ text: '🚀 Configurar mi tienda', callback_data: cb('start') }],
      [{ text: '👀 Ver mi tienda', url }],
      [{ text: '❓ Necesito ayuda', callback_data: cb('help') }, { text: '⏰ Continuar después', callback_data: cb('later') }],
    ] })
    return
  }
  if (step === 'business') {
    const row = await ctx.db.prepare(
      `SELECT s.name, s.business_type, c.whatsapp_phone, c.logo_url, u.display_name AS owner_name
       FROM stores s LEFT JOIN store_config c ON c.id = s.id
       LEFT JOIN platform_users u ON u.telegram_user_id = ? WHERE s.id = ?`,
    ).bind(ctx.telegramUserId, ctx.store.id).first<{ name: string; business_type: string; whatsapp_phone: string; logo_url: string | null; owner_name: string | null }>()
    await say(ctx, `Revisemos los datos que ya tenemos:${progressLabel}\n\n<b>Nombre:</b> ${escapeHtml(row?.name || ctx.store.name)}\n<b>Tipo de comercio:</b> ${escapeHtml(row?.business_type || 'Por definir')}\n<b>WhatsApp:</b> ${escapeHtml(row?.whatsapp_phone || 'Por definir')}\n<b>Propietario:</b> ${escapeHtml(row?.owner_name || ctx.firstName || 'Tú')}\n<b>Dirección:</b> ${escapeHtml(publicStoreUrl(ctx.env.PUBLIC_STORE_BASE_URL, ctx.store))}`, { inline_keyboard: [
      [{ text: 'Todo correcto', callback_data: cb('business:ok') }, { text: 'Modificar información', callback_data: cb('business:edit') }],
      [{ text: 'Continuar', callback_data: cb('business:continue') }],
      [{ text: '↩ Atrás', callback_data: cb('back') }],
      [{ text: '⏰ Continuar después', callback_data: cb('later') }],
    ] })
    return
  }
  if (step === 'logo') {
    const row = await ctx.db.prepare('SELECT logo_url FROM store_config WHERE id = ?').bind(ctx.store.id).first<{ logo_url: string | null }>()
    await say(ctx, `Ahora vamos a darle personalidad a tu tienda 🎨${progressLabel}\n\n${row?.logo_url ? 'Ya tienes un logotipo guardado. Puedes conservarlo o cambiarlo.' : 'Envíame tu logotipo y prepararé una combinación de colores que combine con tu marca. Si todavía no tienes uno, seguiremos con el nombre de tu negocio.'}`, { inline_keyboard: [
      [{ text: row?.logo_url ? 'Conservar mi logotipo' : 'Usar nombre de mi negocio', callback_data: cb('logo:name') }],
      [{ text: '🔖 Subir o cambiar logotipo', callback_data: cb('logo:upload') }],
      [{ text: '↩ Atrás', callback_data: cb('back') }],
      [{ text: 'Subir logo después', callback_data: cb('logo:later') }, { text: '⏰ Continuar después', callback_data: cb('later') }],
    ] })
    return
  }
  if (step === 'colors') {
    const options = Array.isArray(current.state.colorOptions) ? current.state.colorOptions as LogoPalette[] : fallbackColorOptions()
    const previewButtons = options.map((option) => [
      { text: `✓ ${option.label}`, callback_data: cb(`colors:${option.id}`) },
      { text: '👁 Ver', url: storePreviewUrl(ctx, { palette: option.palette }) },
    ])
    await say(ctx, `Preparé estas combinaciones; todas mantienen el texto y los botones legibles.${progressLabel}\n\nToca 👁 para ver tu tienda con esos colores (no se guarda nada) y ✓ para elegirla. También puedes escribirme otro color, por ejemplo “tonos azules”.`, { inline_keyboard: [
      ...previewButtons,
      [{ text: '↩ Atrás', callback_data: cb('back') }],
      [{ text: '⏰ Continuar después', callback_data: cb('later') }],
    ] })
    return
  }
  if (step === 'template') {
    const rows: Array<Array<{ text: string; callback_data?: string; url?: string }>> = []
    for (const key of TEMPLATE_KEYS) rows.push([{ text: `✓ ${TEMPLATE_LABELS[key]}`, callback_data: cb(`template:${key}`) }, { text: '👁 Ver', url: storePreviewUrl(ctx, { template: key }) }])
    rows.push([{ text: '↩ Atrás', callback_data: cb('back') }])
    rows.push([{ text: '⏰ Continuar después', callback_data: cb('later') }])
    await say(ctx, `Elige el diseño de tu tienda.${progressLabel}\n\nCada plantilla cambia la portada, la tipografía, las tarjetas de producto y la navegación, y conserva tus colores y productos. Toca 👁 para verla con tus datos antes de elegir.`, { inline_keyboard: rows })
    return
  }
  if (step === 'banner') {
    await say(ctx, `Vamos a elegir la portada.${progressLabel}\n\nPuedes enviar una fotografía horizontal o seguir con el diseño de la plantilla.`, { inline_keyboard: [
      [{ text: '🖼️ Subir portada', callback_data: cb('banner:upload') }],
      [{ text: 'Usar diseño de plantilla', callback_data: cb('banner:use') }, { text: 'Configurar después', callback_data: cb('banner:later') }],
      [{ text: '↩ Atrás', callback_data: cb('back') }],
    ] })
    return
  }
  if (step === 'product') {
    await say(ctx, `¡Tu tienda ya tiene su estilo! ✨${progressLabel}\n\nAhora vamos a agregar tu primer producto. Envíame una o varias fotos y te ayudaré con la información. No inventaré el precio ni las existencias.`, { inline_keyboard: [
      [{ text: '➕ Agregar mi primer producto', callback_data: cb('product:add') }],
      [{ text: '⏰ Continuar después', callback_data: cb('product:later') }],
      [{ text: '↩ Atrás', callback_data: cb('back') }],
    ] })
    return
  }
  if (step === 'more_products') {
    const count = await ctx.db.prepare('SELECT COUNT(*) AS total FROM products WHERE store_id = ? AND is_archived = 0').bind(ctx.store.id).first<{ total: number }>()
    await say(ctx, `¡Excelente! Tu primer producto está listo.${progressLabel}\n\nTu catálogo tiene ${Number(count?.total || 0)} producto(s). ¿Quieres agregar otro?`, { inline_keyboard: [
      [{ text: '➕ Agregar otro', callback_data: cb('more:add') }],
      [{ text: '📦 Ver mis productos', callback_data: cb('more:view') }, { text: '🚀 Preparar publicación', callback_data: cb('more:review') }],
      [{ text: '⏰ Continuar después', callback_data: cb('more:later') }],
      [{ text: '↩ Atrás', callback_data: cb('back') }],
    ] })
    return
  }
  const checklist = await readChecklist(ctx)
  await say(ctx, `Revisemos tu tienda:${progressLabel}\n\n${checklist.map((item) => `${item.ok ? '✅' : '⬜'} ${escapeHtml(item.label)}`).join('\n')}\n\nPuedes abrir una vista privada desde el panel. La tienda no se activará automáticamente.`, { inline_keyboard: [
    [{ text: '👁 Vista privada', callback_data: cb('review:preview') }],
    [{ text: '📨 Solicitar activación', callback_data: cb('review:request') }],
    [{ text: 'Terminar por ahora', callback_data: cb('review:finish') }],
    [{ text: '↩ Atrás', callback_data: cb('back') }],
  ] })
}

function settingsKeyboard() {
  return { inline_keyboard: [[{ text: '⚙️ Configurar mi tienda', callback_data: 'm:appearance' }], [{ text: '↩ Menú principal', callback_data: 'm:menu' }]] }
}

async function readChecklist(ctx: AssistantContext): Promise<Array<{ label: string; ok: boolean }>> {
  const row = await ctx.db.prepare(
    `SELECT c.name, c.business_type, c.whatsapp_phone, c.logo_url, c.cover_image_url, c.primary_color,
       c.description, COALESCE(s.template, 'moderno') AS template,
       (SELECT COUNT(*) FROM products p WHERE p.store_id = c.id AND p.is_archived = 0) AS products
     FROM store_config c JOIN stores s ON s.id = c.id WHERE c.id = ?`,
  ).bind(ctx.store.id).first<{ name: string; business_type: string; whatsapp_phone: string; logo_url: string | null; cover_image_url: string | null; primary_color: string; description: string; template: string; products: number }>()
  const pending = await ctx.db.prepare("SELECT 1 AS pending FROM store_activation_requests WHERE store_id = ? AND status = 'pending' LIMIT 1").bind(ctx.store.id).first()
  return [
    { label: 'Identidad del negocio', ok: Boolean(row?.name && row?.business_type) },
    { label: 'Logotipo o nombre del negocio', ok: true },
    { label: 'Colores y plantilla', ok: Boolean(row?.primary_color && row?.template) },
    { label: 'WhatsApp comercial', ok: Boolean(row?.whatsapp_phone) },
    { label: 'Portada', ok: Boolean(row?.cover_image_url) },
    { label: `${Number(row?.products || 0)} producto(s) en el catálogo`, ok: Number(row?.products || 0) > 0 },
    { label: 'Descripción comercial', ok: Boolean(row?.description?.trim()) },
    { label: pending ? 'Solicitud de activación en revisión' : 'Activación por el equipo administrador', ok: Boolean(pending) },
  ]
}

async function paletteThemeJson(ctx: AssistantContext, palette: LogoPalette['palette']): Promise<string> {
  const row = await ctx.db.prepare('SELECT theme_config FROM store_config WHERE id = ?').bind(ctx.store.id).first<{ theme_config: string | null }>()
  let theme: Record<string, any> = {}
  try { theme = row?.theme_config ? JSON.parse(row.theme_config) : {} } catch { theme = {} }
  theme.style = { ...(theme.style || {}), palette: { ...palette } }
  return JSON.stringify(theme)
}

async function templateThemeJson(ctx: AssistantContext, template: TemplateKey): Promise<string> {
  const row = await ctx.db.prepare('SELECT theme_config FROM store_config WHERE id = ?').bind(ctx.store.id).first<{ theme_config: string | null }>()
  let theme: Record<string, any> = {}
  try { theme = row?.theme_config ? JSON.parse(row.theme_config) : {} } catch { theme = {} }
  const palette = theme?.style?.palette || templatePalette(template)
  const { align, ...design } = TEMPLATE_DESIGNS[template]
  theme.template = template
  // Keep the merchant's colors: light or dark mode follows the background actually in use.
  theme.style = { ...(theme.style || {}), ...design, palette, darkMode: isDarkBackground(palette?.background) }
  if (theme.hero && align) theme.hero = { ...theme.hero, align }
  return JSON.stringify(theme)
}

/** Claims the step and writes the business change, sync and audit atomically. */
async function applyOnboardingMutation(
  ctx: AssistantContext,
  progress: OnboardingRecord,
  expectedStep: OnboardingStep,
  nextStep: OnboardingStep,
  state: Record<string, unknown>,
  fields: Record<string, unknown>,
  template?: TemplateKey,
): Promise<OnboardingRecord | null> {
  const allowed = new Set(['name', 'business_type', 'whatsapp_phone', 'whatsapp_orders', 'theme_config', 'primary_color', 'secondary_color', 'accent_color', 'button_color'])
  const entries = Object.entries(fields).filter(([key]) => allowed.has(key))
  if (entries.length !== Object.keys(fields).length) throw new Error('INVALID_ONBOARDING_STORE_FIELDS')
  const cleaned = Object.fromEntries(Object.entries(state).filter(([, value]) => value !== undefined))
  const configUpdates = entries.map(([key]) => `${key} = ?`)
  const configValues = entries.map(([, value]) => value)
  const mutationToken = crypto.randomUUID()
  const gate = `EXISTS (SELECT 1 FROM store_onboardings WHERE store_id = ? AND telegram_user_id = ? AND version = ? AND status = 'in_progress' AND step = ? AND mutation_token = ?)`
  const gateBindings = [ctx.store.id, ctx.telegramUserId, progress.version + 1, nextStep, mutationToken]
  const statements: D1PreparedStatement[] = [ctx.db.prepare(
    `UPDATE store_onboardings SET step = ?, state_json = ?, version = version + 1, mutation_token = ?, expires_at = unixepoch() + ?, updated_at = unixepoch()
     WHERE store_id = ? AND telegram_user_id = ? AND version = ? AND status = 'in_progress' AND step = ? AND expires_at > unixepoch()`,
  ).bind(nextStep, JSON.stringify(cleaned), mutationToken, TTL_SECONDS, ctx.store.id, ctx.telegramUserId, progress.version, expectedStep)]
  if (entries.length) {
    statements.push(ctx.db.prepare(
      `UPDATE store_config SET ${configUpdates.join(', ')}, updated_at = datetime('now') WHERE id = ? AND ${gate}`,
    ).bind(...configValues, ctx.store.id, ...gateBindings))
    if ('name' in fields || 'business_type' in fields || template) {
      const storeUpdates = [
        ...('name' in fields ? ['name = (SELECT name FROM store_config WHERE id = ?)'] : []),
        ...('business_type' in fields ? ['business_type = ?'] : []),
        ...(template ? ['template = ?'] : []),
        "updated_at = datetime('now')",
      ]
      const storeValues = [
        ...('name' in fields ? [ctx.store.id] : []),
        ...('business_type' in fields ? [fields.business_type] : []),
        ...(template ? [template] : []),
      ]
      statements.push(ctx.db.prepare(`UPDATE stores SET ${storeUpdates.join(', ')} WHERE id = ? AND ${gate}`)
        .bind(...storeValues, ctx.store.id, ...gateBindings))
    }
    statements.push(ctx.db.prepare(
      `INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id)
       SELECT 'store_updated', 'store', ?, ?, ?, 'telegram', ? WHERE ${gate}`,
    ).bind(String(ctx.store.id), JSON.stringify({ changes: fields, template: template || undefined }), `telegram:${ctx.telegramUserId}`, ctx.store.id, ...gateBindings))
  }
  const results = await ctx.db.batch(statements)
  if (!Number(results[0]?.meta.changes || 0)) return getOnboarding(ctx)
  return getOnboarding(ctx)
}

async function finish(ctx: AssistantContext, progress: OnboardingRecord): Promise<void> {
  await transition(ctx, progress, 'review', progress.state, 'completed')
}

async function go(ctx: AssistantContext, progress: OnboardingRecord, step: OnboardingStep): Promise<void> {
  const next = await transition(ctx, progress, step, progress.state)
  if (next) await renderOnboarding(ctx, next)
}

async function transition(ctx: AssistantContext, progress: OnboardingRecord, step: OnboardingStep, state: Record<string, unknown>, status: OnboardingStatus = 'in_progress'): Promise<OnboardingRecord | null> {
  const cleaned = Object.fromEntries(Object.entries(state).filter(([, value]) => value !== undefined))
  const result = await ctx.db.prepare(
    `UPDATE store_onboardings SET status = ?, step = ?, state_json = ?, version = version + 1, mutation_token = NULL,
       expires_at = unixepoch() + ?, completed_at = CASE WHEN ? = 'completed' THEN unixepoch() ELSE NULL END, updated_at = unixepoch()
     WHERE store_id = ? AND telegram_user_id = ? AND version = ? AND status = 'in_progress' AND expires_at > unixepoch()`
  ).bind(status, step, JSON.stringify(cleaned), TTL_SECONDS, status, ctx.store.id, ctx.telegramUserId, progress.version).run()
  if (!result.meta.changes) return getOnboarding(ctx)
  return { status, step, state: cleaned, version: progress.version + 1, expires_at: Math.floor(Date.now() / 1000) + TTL_SECONDS }
}

async function insertOnboarding(ctx: AssistantContext): Promise<void> {
  await ctx.db.prepare(
    `INSERT OR IGNORE INTO store_onboardings (store_id, telegram_user_id, status, step, expires_at) VALUES (?, ?, 'in_progress', 'welcome', unixepoch() + ?)`
  ).bind(ctx.store.id, ctx.telegramUserId, TTL_SECONDS).run()
}

function isDarkBackground(background: unknown): boolean {
  return typeof background === 'string' && /^#[0-9a-f]{6}$/i.test(background) && contrastRatio(background, '#000000') < contrastRatio(background, '#FFFFFF')
}

/** Private preview link; a palette or template is shown without saving anything. */
export function storePreviewUrl(ctx: AssistantContext, option: { palette?: LogoPalette['palette']; template?: TemplateKey } = {}): string {
  const params = new URLSearchParams()
  if (option.palette) params.set('palette', previewPaletteParam(option.palette))
  if (option.template) params.set('template', option.template)
  const query = params.toString()
  return `${adminStoreUrl(ctx.env.PUBLIC_STORE_BASE_URL, ctx.store)}/store-preview${query ? `?${query}` : ''}`
}

async function currentPrimary(ctx: AssistantContext): Promise<string> {
  const row = await ctx.db.prepare('SELECT primary_color FROM store_config WHERE id = ?').bind(ctx.store.id).first<{ primary_color: string | null }>()
  const color = row?.primary_color || ''
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#1D4ED8'
}

/** "¿Cómo cambio los colores?" / "Muéstrame mi tienda en tonos azules": three legible options,
 * each with a real preview link. Applying one goes through the usual confirmation. */
export async function showPaletteIdeas(ctx: AssistantContext, text = ''): Promise<void> {
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite cambiar los colores. Pídele al propietario que lo haga.'); return }
  const named = namedColor(text)
  const base = named?.hex || await currentPrimary(ctx)
  const options = (palettesFromColors(base) || fallbackColorOptions()).filter((option) => isLegiblePalette(option.palette))
  const progress = await getOnboarding(ctx)
  if (progress?.status === 'in_progress' && progress.step === 'colors' && progress.expires_at > Math.floor(Date.now() / 1000)) {
    const next = await transition(ctx, progress, 'colors', { ...progress.state, colorOptions: options })
    if (next) await renderOnboarding(ctx, next)
    return
  }
  const hex = base.replace('#', '').toUpperCase()
  const intro = named ? `Así podría verse <b>${escapeHtml(ctx.store.name)}</b> en tonos ${escapeHtml(named.label)}.` : 'Estas son tres combinaciones para tu tienda.'
  await say(ctx, `🎨 ${intro}\n\nToca 👁 para ver la tienda con esos colores (no se guarda nada). Si te gusta, toca ✓ y te pediré confirmación antes de cambiarla.\n\nTambién puedes escribirme otro color, por ejemplo “tonos verdes”.`, { inline_keyboard: [
    ...options.map((option) => [
      { text: `✓ ${option.label}`, callback_data: `pal:${ctx.store.id}:${hex}:${option.id}` },
      { text: '👁 Ver', url: storePreviewUrl(ctx, { palette: option.palette }) },
    ]),
    [{ text: '🛠️ Ajustar cada tono en el panel', url: `${adminStoreUrl(ctx.env.PUBLIC_STORE_BASE_URL, ctx.store)}/appearance` }],
    [{ text: '↩ Menú principal', callback_data: 'm:menu' }],
  ] })
}

/** Rebuilds a palette offered by showPaletteIdeas from its callback (deterministic, nothing stored). */
export function paletteFromCallback(hex: string, id: string): LogoPalette | null {
  if (!/^[0-9A-F]{6}$/i.test(hex)) return null
  const option = (palettesFromColors(`#${hex}`) || []).find((item) => item.id === id)
  return option && isLegiblePalette(option.palette) ? option : null
}

export async function showTemplatePicker(ctx: AssistantContext): Promise<void> {
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite cambiar la plantilla. Pídele al propietario que lo haga.'); return }
  const progress = await getOnboarding(ctx)
  if (progress?.status === 'in_progress' && progress.step === 'template' && progress.expires_at > Math.floor(Date.now() / 1000)) { await renderOnboarding(ctx, progress); return }
  await say(ctx, '🧩 <b>Plantillas</b>\n\nCada una cambia la portada, la tipografía, las tarjetas de producto y la navegación. Tus productos y colores se conservan.\n\nToca 👁 para ver tu tienda con esa plantilla y ✓ para elegirla.', { inline_keyboard: [
    ...TEMPLATE_KEYS.map((key) => [{ text: `✓ ${TEMPLATE_LABELS[key]}`, callback_data: `tpl:${ctx.store.id}:pick:${key}` }, { text: '👁 Ver', url: storePreviewUrl(ctx, { template: key }) }]),
    [{ text: '↩ Menú principal', callback_data: 'm:menu' }],
  ] })
}

/** tpl:pick asks for confirmation; tpl:apply writes template, theme and audit in one batch. */
export async function handleTemplateCallback(ctx: AssistantContext, intent: 'pick' | 'apply', key: string): Promise<void> {
  if (!(TEMPLATE_KEYS as readonly string[]).includes(key)) { await say(ctx, 'No encontré esa plantilla. Abre de nuevo la lista con /configurar.'); return }
  if (!roleAllows(ctx.role, 'admin')) { await say(ctx, 'Tu rol no permite cambiar la plantilla. Pídele al propietario que lo haga.'); return }
  const template = key as TemplateKey
  if (intent === 'pick') {
    await say(ctx, `¿Aplico la plantilla <b>${escapeHtml(TEMPLATE_LABELS[template])}</b>? Tus productos, textos y colores se conservan.`, { inline_keyboard: [
      [{ text: '✅ Aplicar plantilla', callback_data: `tpl:${ctx.store.id}:apply:${template}` }, { text: '👁 Ver antes', url: storePreviewUrl(ctx, { template }) }],
      [{ text: '❌ Cancelar', callback_data: 'm:templates' }],
    ] })
    return
  }
  const themeConfig = await templateThemeJson(ctx, template)
  await ctx.db.batch([
    ctx.db.prepare("UPDATE store_config SET theme_config = ?, updated_at = datetime('now') WHERE id = ?").bind(themeConfig, ctx.store.id),
    ctx.db.prepare("UPDATE stores SET template = ?, updated_at = datetime('now') WHERE id = ?").bind(template, ctx.store.id),
    ctx.db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('store_template_updated', 'store', ?, ?, ?, 'telegram', ?)`)
      .bind(String(ctx.store.id), JSON.stringify({ template }), `telegram:${ctx.telegramUserId}`, ctx.store.id),
  ])
  await say(ctx, `✅ Listo: tu tienda ahora usa la plantilla <b>${escapeHtml(TEMPLATE_LABELS[template])}</b>.`, { inline_keyboard: [
    [{ text: '👁 Ver mi tienda', url: storePreviewUrl(ctx) }],
    [{ text: '⚙️ Configurar mi tienda', callback_data: 'm:appearance' }, { text: '↩ Menú principal', callback_data: 'm:menu' }],
  ] })
}

const STEP_HELP: Record<OnboardingStep, string> = {
  welcome: 'Toca “🚀 Configurar mi tienda” para empezar. Son pasos cortos y puedes pausar cuando quieras.',
  business: 'Revisa el nombre, el tipo de comercio y el WhatsApp. Si algo no está bien, toca “Modificar información”.',
  logo: 'Envíame tu logotipo como foto o archivo (PNG, JPG o WebP). Si no tienes uno, usaremos el nombre de tu negocio.',
  colors: 'Toca 👁 para ver tu tienda con cada combinación y ✓ para elegirla. También puedes escribirme “tonos azules” o el color que prefieras.',
  template: 'Toca 👁 para ver cada plantilla con tus datos y ✓ para elegirla. Puedes cambiarla después.',
  banner: 'La portada es la foto grande del inicio. Envía una foto horizontal o usa el diseño de la plantilla.',
  product: 'Envíame fotos del producto. Te propongo nombre y descripción; el precio y las existencias me los dices tú.',
  more_products: 'Puedes agregar otro producto o pasar a revisar la tienda. No hay un mínimo obligatorio.',
  review: 'Revisa la lista y abre la vista privada. Cuando estés listo, solicita la activación al equipo.',
}

/** /ayuda during the guided setup explains the current step before the general help. */
export async function onboardingHelp(ctx: AssistantContext): Promise<boolean> {
  const progress = await getOnboarding(ctx)
  if (!progress || progress.status !== 'in_progress' || progress.expires_at <= Math.floor(Date.now() / 1000)) return false
  await say(ctx, `❓ <b>Ayuda de este paso</b>\n\n${STEP_HELP[progress.step]}\n\nGuardo tu avance automáticamente. Escribe /continuar para volver al paso, /configurar para el menú de ajustes o pregúntame lo que necesites.`, {
    inline_keyboard: [[{ text: '▶️ Seguir configuración', callback_data: `ob:${ctx.store.id}:resume_step` }], [{ text: '↩ Menú principal', callback_data: 'm:menu' }]],
  })
  return true
}

function fallbackColorOptions(): LogoPalette[] {
  return [
    { id: 'faithful', label: 'Neutra y fiel a tu marca', palette: templatePalette('minimalista') },
    { id: 'balanced', label: 'Elegante y equilibrada', palette: templatePalette('boutique') },
    { id: 'vibrant', label: 'Vibrante y comercial', palette: templatePalette('moderno') },
  ]
}
