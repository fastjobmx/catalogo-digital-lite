import type { Env } from '../index'
import { parseActionPayload, type ActionName } from '../validation/actions'
import { applyConfirmedCatalogMutation } from './business'

export interface TelegramMessage {
 message_id: number
 from?: {
 id: number
 first_name: string
 last_name?: string
 username?: string
 }
 chat: {
 id: number
 type: 'private' | 'group' | 'supergroup' | 'channel'
 title?: string
 }
 date: number
 text?: string
 voice?: { file_id: string; duration: number }
 photo?: Array<{ file_id: string }>
}

export interface TelegramUpdate {
 update_id: number
 message?: TelegramMessage
}

export interface TelegramSendMessageResponse {
 ok: boolean
 result: {
 message_id: number
 }
}

interface PendingTelegramOperation {
 operation_id: string
 action: string
 params_json: string
 before_json: string
 after_json: string
}

const TELEGRAM_API_BASE = 'https://api.telegram.org'

export async function sendTelegramMessage(
 botToken: string,
 chatId: number | string,
 text: string,
 parseMode: 'HTML' | 'Markdown' = 'HTML'
): Promise<TelegramSendMessageResponse> {
 const url = `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`
 const response = await fetch(url, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 chat_id: chatId,
 text,
 parse_mode: parseMode,
 }),
 })

 if (!response.ok) {
 const error = await response.json().catch(() => ({ description: 'Unknown error' }))
 throw new Error(`Telegram API error: ${(error as any).description || response.status}`)
 }

 return response.json() as Promise<TelegramSendMessageResponse>
}

async function sendEnvironmentMessage(
 botToken: string,
 chatId: number | string,
 env: Env['Bindings'],
 text: string,
): Promise<TelegramSendMessageResponse> {
 const label = env.TELEGRAM_ENV_LABEL?.trim()
 const banner = label ? `🧪 <b>${escapeTelegramHtml(label)}</b>\n\n` : ''
 return sendTelegramMessage(botToken, chatId, `${banner}${text}`)
}

export async function processTelegramUpdate(
 update: TelegramUpdate,
 env: Env['Bindings'],
 db: D1Database
): Promise<void> {
 const botToken = env.TELEGRAM_BOT_TOKEN
 if (!botToken) {
 console.error('TELEGRAM_BOT_TOKEN not configured')
 return
 }

 const message = update.message
 if (!message) return

 const chatId = message.chat.id
 const userId = message.from?.id
 const dbOwner = await db.prepare('SELECT telegram_owner_id FROM store_config WHERE id = 1').first()
 const linkedOwner = (dbOwner as { telegram_owner_id?: string } | null)?.telegram_owner_id
 const ownerId = env.TELEGRAM_OWNER_ID || linkedOwner
 if (!ownerId || !message.from || String(userId) !== ownerId || message.chat.type !== 'private' || String(chatId) !== ownerId) {
 return
 }

 if (message.voice) {
  if (!env.GEMINI_API_KEY) {
    await sendEnvironmentMessage(botToken, chatId, env, 'Las notas de voz requieren GEMINI_API_KEY. Estado: PENDIENTE DE CREDENCIALES.')
    return
  }
  if (message.voice.duration > 120) {
    await sendEnvironmentMessage(botToken, chatId, env, 'La nota de voz supera el máximo permitido de 120 segundos.')
    return
  }
  try {
    const audio = await downloadTelegramVoice(botToken, message.voice.file_id)
    await handleFreeText('Interpreta la nota de voz adjunta.', update.update_id, chatId, botToken, env, db, audio)
  } catch (error) {
    console.error('Telegram voice processing failed:', error instanceof Error ? error.message : 'unknown error')
    await sendEnvironmentMessage(botToken, chatId, env, 'No pude procesar la nota de voz. No se aplicó ninguna modificación.')
  }
  return
 }

 if (!message.text) {
  await sendEnvironmentMessage(botToken, chatId, env, message.photo?.length
    ? 'La recepción de fotografías aún no está habilitada. No se guardó ni sustituyó ninguna imagen.'
    : 'Tipo de mensaje no compatible. Usa texto o una nota de voz.')
  return
 }

 const text = message.text.trim()

 // Command routing
 if (text.startsWith('/')) {
 await handleCommand(text, chatId, botToken, env, db)
 } else {
  await handleFreeText(text, update.update_id, chatId, botToken, env, db)
 }
}

async function handleCommand(
 text: string,
 chatId: number,
 botToken: string,
 env: Env['Bindings'],
 db: D1Database
): Promise<void> {
 const rawCommand = text.split(' ')[0] || ''
 const command = (rawCommand.split('@')[0] || '').toLowerCase()

 switch (command) {
 case '/start':
 await sendEnvironmentMessage(botToken, chatId, env,
 `👋 <b>Bienvenido a Catálogo Digital Lite</b>\n\n` +
 `Comandos disponibles:\n` +
 `/estado — Resumen del catálogo\n` +
 `/cancelar — Cancelar propuesta pendiente; no revierte cambios ya ejecutados\n` +
 `/productos — Listar productos activos\n` +
 `/categorias — Listar categorías\n` +
 `/pedido — Ver últimos pedidos\n` +
 `/ayuda — Mostrar esta ayuda`
 )
 break

 case '/estado':
 case '/stats':
 case '/estadisticas':
 const stats = await getStoreStats(db)
 await sendEnvironmentMessage(botToken, chatId, env,
 `📊 <b>Resumen del Catálogo</b>\n\n` +
 `📦 Productos activos: ${stats.products}\n` +
 `🏷️ Categorías: ${stats.categories}\n` +
 `📋 Stock total: ${stats.totalStock} unidades\n` +
 `🛒 Pedidos hoy: ${stats.ordersToday}`
 )
 break

 case '/productos':
 const products = await db.prepare(
 `SELECT sku, name, price FROM products WHERE is_active = 1 AND is_archived = 0 ORDER BY created_at DESC LIMIT 10`
 ).all()

 if (!products.results || products.results.length === 0) {
 await sendEnvironmentMessage(botToken, chatId, env, '📦 No hay productos activos.')
 } else {
 const list = products.results.map((p: any, i: number) =>
 `${i + 1}. <b>${p.name}</b>\n SKU: ${p.sku} — $${p.price.toLocaleString()}`
 ).join('\n\n')
 await sendEnvironmentMessage(botToken, chatId, env,
 `📦 <b>Últimos productos</b>\n\n${list}`
 )
 }
 break

 case '/categorias':
 const categories = await db.prepare(
 `SELECT c.name, COUNT(p.id) as count FROM categories c LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1 WHERE c.is_active = 1 GROUP BY c.id ORDER BY c.name`
 ).all()

 if (!categories.results || categories.results.length === 0) {
 await sendEnvironmentMessage(botToken, chatId, env, '🏷️ No hay categorías activas.')
 } else {
 const list = categories.results.map((c: any) =>
 `• <b>${c.name}</b> — ${c.count} productos`
 ).join('\n')
 await sendEnvironmentMessage(botToken, chatId, env,
 `🏷️ <b>Categorías</b>\n\n${list}`
 )
 }
 break

 case '/pedido':
 case '/pedidos':
 const orders = await db.prepare(
 `SELECT display_id, customer_name, total, status, created_at FROM orders ORDER BY created_at DESC LIMIT 5`
 ).all()

 if (!orders.results || orders.results.length === 0) {
 await sendEnvironmentMessage(botToken, chatId, env, '🛒 No hay pedidos registrados.')
 } else {
 const list = orders.results.map((o: any) =>
 `📋 <b>${o.display_id}</b>\n` +
 ` 👤 ${o.customer_name || 'Anónimo'}\n` +
 ` 💰 $${o.total.toLocaleString()}\n` +
 ` 📅 ${o.created_at}\n` +
 ` 🔄 ${o.status}`
 ).join('\n\n')
 await sendEnvironmentMessage(botToken, chatId, env,
 `🛒 <b>Últimos pedidos</b>\n\n${list}`
 )
 }
 break

 case '/ayuda':
 case '/help':
 await sendEnvironmentMessage(botToken, chatId, env,
 `📖 <b>Ayuda de Catálogo Digital Lite</b>\n\n` +
 `Este bot te permite gestionar tu catálogo desde Telegram.\n\n` +
 `<b>Comandos:</b>\n` +
 `/start — Mensaje de bienvenida\n` +
 `/estado — Estado y estadísticas\n` +
 `/cancelar — Cancelar propuesta pendiente; no revierte cambios ya ejecutados\n` +
 `/productos — Listar productos activos\n` +
 `/categorias — Listar categorías\n` +
 `/pedido — Ver últimos pedidos\n` +
 `/ayuda — Mostrar esta ayuda\n\n` +
 `También puedes escribir texto libre y el asistente IA intentará ayudarte.`
 )
 break

 case '/cancelar': {
   const pending = await db.prepare(
     `UPDATE telegram_operations SET status = 'cancelled', completed_at = datetime('now')
      WHERE operation_id = (SELECT operation_id FROM telegram_operations
        WHERE chat_id = ? AND status = 'pending' AND expires_at > unixepoch()
        ORDER BY created_at DESC LIMIT 1) RETURNING operation_id`,
   ).bind(String(chatId)).first()
   await sendEnvironmentMessage(botToken, chatId, env, pending
     ? 'Propuesta cancelada. No se realizó ningún cambio.'
     : 'No hay ninguna propuesta pendiente. Si el cambio ya se ejecutó, /cancelar no lo revierte; solicita una nueva propuesta y confírmala para cambiarlo.')
   break
 }

 default:
 await sendEnvironmentMessage(botToken, chatId, env,
 `❓ Comando no reconocido: <code>${command}</code>\n\n` +
 `Usa /ayuda para ver los comandos disponibles.`
 )
 }
}

async function handleFreeText(
 text: string,
  updateId: number,
 chatId: number,
 botToken: string,
 env: Env['Bindings'],
 db: D1Database,
  audio?: { mimeType: 'audio/ogg'; data: string },
): Promise<void> {
  const { interpretCommand } = await import('../ai/interpreter')
  const { executeAction } = await import('../ai/executor')
  const { ACTION_NAMES } = await import('../validation/actions')

  if (/^(no|cancelar)$/i.test(text.trim())) {
    const pending = await db.prepare(
      `UPDATE telegram_operations SET status = 'cancelled', completed_at = datetime('now')
       WHERE operation_id = (SELECT operation_id FROM telegram_operations
         WHERE chat_id = ? AND status = 'pending' AND expires_at > unixepoch()
         ORDER BY created_at DESC LIMIT 1) RETURNING operation_id`,
    ).bind(String(chatId)).first()
    await sendEnvironmentMessage(botToken, chatId, env, pending
      ? 'Propuesta cancelada. No se realizó ningún cambio.'
      : 'No hay ninguna propuesta pendiente. Si el cambio ya se ejecutó, /cancelar no lo revierte; solicita una nueva propuesta y confírmala para cambiarlo.')
    return
  }

  if (/^(sí|si|confirmar|ok|aprobar)$/i.test(text.trim())) {
    const pending = await db.prepare(
      `SELECT * FROM telegram_operations WHERE chat_id = ? AND status = 'pending' AND expires_at > unixepoch()
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(String(chatId)).first() as PendingTelegramOperation | null
    if (!pending) {
      await sendEnvironmentMessage(botToken, chatId, env, 'No hay ninguna operación pendiente de confirmación.')
      return
    }
    const parsedOperation = parseActionPayload({ action: pending.action, params: JSON.parse(pending.params_json) })
    if (!parsedOperation.success || !isAtomicCatalogAction(parsedOperation.data.action)) {
      await db.prepare("UPDATE telegram_operations SET status = 'stale', completed_at = datetime('now') WHERE operation_id = ? AND status = 'pending'").bind(pending.operation_id).run()
      await sendEnvironmentMessage(botToken, chatId, env, 'La operación guardada no supera la validación actual. No se aplicó.')
      return
    }
    try {
      const params = parsedOperation.data.params as Record<string, unknown>
      const before = JSON.parse(pending.before_json) as Record<string, unknown>
      const after = JSON.parse(pending.after_json)
      const status = await applyConfirmedCatalogMutation(db, {
        operationId: pending.operation_id,
        chatId: String(chatId),
        actor: `telegram:${chatId}`,
        action: parsedOperation.data.action,
        params: params as { sku: string; price?: number; stock?: number; size?: string },
        before,
        beforeJson: pending.before_json,
        after,
      })
      if (status === 'applied') {
        const oldValues = stockValues(before, params)
        const message = parsedOperation.data.action === 'update_price'
          ? `Precio actualizado: ${params.sku}, $${Number(params.price).toLocaleString('es-CO')}. /cancelar solo detiene propuestas pendientes; no revierte cambios ejecutados.`
          : `Stock actualizado: ${params.sku}${params.size ? ` talla ${params.size}` : ''}; ${oldValues.join(', ')} → ${params.stock}. /cancelar solo detiene propuestas pendientes; no revierte cambios ejecutados.`
        await sendEnvironmentMessage(botToken, chatId, env, message)
      } else if (status === 'stale') {
        await sendEnvironmentMessage(botToken, chatId, env, 'El estado del producto o inventario cambió desde la propuesta. No se aplicó; consulta y vuelve a proponerlo.')
      } else if (status === 'expired') {
        await sendEnvironmentMessage(botToken, chatId, env, 'La confirmación venció. La operación no se aplicó.')
      } else {
        await sendEnvironmentMessage(botToken, chatId, env, 'La operación ya se procesó o no está pendiente.')
      }
    } catch (error) { throw error }
    return
  }

  let proposal = interpretCommand(text)
  if (proposal.action === 'unknown' && env.GEMINI_API_KEY) {
    try {
      const { interpretWithGemini } = await import('../ai/gemini')
      const json = await interpretWithGemini(text, env, fetch, audio)
      if (audio) {
        const transcript = json.transcript?.trim()
        if (!transcript) {
          await sendEnvironmentMessage(botToken, chatId, env, 'Gemini no incluyó una transcripción válida. No se aplicó ninguna modificación.')
          return
        }
        await sendEnvironmentMessage(botToken, chatId, env, `<b>Transcripción:</b> ${escapeTelegramHtml(transcript)}`)
      }
      proposal = {
        action: json.action,
        params: json.params,
        missing: json.missing || [],
        needsConfirmation: json.needsConfirmation,
        summary: json.summary,
        simulated: false,
      }
    } catch (error) {
      const { GeminiRequestError } = await import('../ai/gemini')
      const category = error instanceof GeminiRequestError ? error.category : 'request'
      console.error('Gemini proposal rejected:', category)
      const feedbackByCategory: Record<string, string> = {
        quota: 'Gemini alcanzó su cuota o límite temporal. Intenta más tarde.',
        service: 'Gemini no está disponible ahora. Intenta más tarde.',
        api_key: 'Gemini rechazó la API Key configurada.',
        permission_or_billing: 'Gemini denegó el acceso: revisa permisos y facturación del proyecto.',
        model: 'El modelo de Gemini configurado no está disponible para esta API Key.',
        structured_schema: 'Gemini rechazó el esquema de salida estructurada configurado.',
        request: 'Gemini rechazó la solicitud o devolvió un resultado inválido.',
      }
      const feedback = feedbackByCategory[category] || feedbackByCategory.request || 'Gemini rechazó la solicitud.'
      await sendEnvironmentMessage(botToken, chatId, env, feedback)
      return
    }
  } else if (proposal.action === 'unknown') {
    await sendEnvironmentMessage(botToken, chatId, env, `${proposal.summary}\n\nEstado: SIMULADO local / PENDIENTE DE CREDENCIALES de Gemini.`)
    return
  }

  if (proposal.missing.length) {
    await sendEnvironmentMessage(botToken, chatId, env, `Faltan datos obligatorios: ${proposal.missing.join(', ')}. No invento precios, stock ni fotos.`)
    return
  }

  if (proposal.needsConfirmation) {
    if (proposal.action === 'unknown' || proposal.action === 'ask' || !isAtomicCatalogAction(proposal.action)) {
      await sendEnvironmentMessage(botToken, chatId, env, 'Esta modificación aún no está habilitada para aplicación transaccional. No se guardó ni ejecutó.')
      return
    }
    await db.prepare(
      `UPDATE telegram_operations SET status = 'expired', completed_at = datetime('now')
       WHERE chat_id = ? AND status = 'pending' AND expires_at <= unixepoch()`,
    ).bind(String(chatId)).run()
    const before = await readActionState(db, proposal.action as typeof ACTION_NAMES[number], proposal.params)
    if (!before || typeof before !== 'object') {
      await sendEnvironmentMessage(botToken, chatId, env, 'No encontré ese producto en el catálogo. No se creó una operación pendiente.')
      return
    }
    const productState = before as Record<string, unknown>
    if (productState.is_active !== 1 || productState.is_archived !== 0) {
      await sendEnvironmentMessage(botToken, chatId, env, 'El producto no está activo. No se creó una operación pendiente.')
      return
    }
    const after = proposedActionState(before, proposal.action, proposal.params)
    const operationId = crypto.randomUUID()
    try {
      await db.prepare(
        `INSERT INTO telegram_operations (operation_id, update_id, chat_id, action, params_json, before_json, after_json, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch() + 900)`,
      ).bind(operationId, updateId, String(chatId), proposal.action, JSON.stringify(proposal.params), JSON.stringify(before), JSON.stringify(after)).run()
    } catch (error) {
      if (error instanceof Error && /unique constraint/i.test(error.message)) {
        await sendEnvironmentMessage(botToken, chatId, env, 'Ya existe una operación pendiente o en proceso. Confírmala, cancélala o espera a que venza antes de crear otra.')
        return
      }
      throw error
    }
    await sendEnvironmentMessage(botToken, chatId, env,
      `<b>Operación ${operationId.slice(0, 8)}</b>\n${escapeTelegramHtml(proposal.summary)}\n\n` +
      `<b>Estado actual:</b> ${escapeTelegramHtml(JSON.stringify(before))}\n` +
      `<b>Propuesto:</b> ${escapeTelegramHtml(JSON.stringify(after))}\n\n` +
      `Vence en 15 minutos. Responde SÍ para confirmar o /cancelar.`)
    return
  }

  if (proposal.action === 'unknown' || proposal.action === 'ask') {
    await sendEnvironmentMessage(botToken, chatId, env, proposal.summary)
    return
  }

  if (!['get_inventory', 'get_products', 'get_store_configuration'].includes(proposal.action)) {
    await sendEnvironmentMessage(botToken, chatId, env, 'Esta modificación no está habilitada sin confirmación transaccional.')
    return
  }

  const result = await executeAction(db, proposal.action as typeof ACTION_NAMES[number], proposal.params, `telegram:${chatId}`)
  await sendEnvironmentMessage(botToken, chatId, env, result.message)
}

function isAtomicCatalogAction(action: ActionName): action is 'update_price' | 'update_stock' {
 return action === 'update_price' || action === 'update_stock'
}

async function getStoreStats(db: D1Database): Promise<{
 products: number
 categories: number
 totalStock: number
 ordersToday: number
}> {
 const [productsResult, categoriesResult, variantsResult, ordersResult] = await Promise.all([
 db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1 AND is_archived = 0').first(),
 db.prepare('SELECT COUNT(*) as count FROM categories WHERE is_active = 1').first(),
 db.prepare('SELECT SUM(stock) as total FROM product_variants WHERE is_active = 1').first(),
 db.prepare(`SELECT COUNT(*) as count FROM orders WHERE date(created_at) = date('now')`).first(),
 ])

 return {
 products: (productsResult as any)?.count ?? 0,
 categories: (categoriesResult as any)?.count ?? 0,
 totalStock: (variantsResult as any)?.total ?? 0,
 ordersToday: (ordersResult as any)?.count ?? 0,
 }
}

function escapeTelegramHtml(value: string): string {
 return value.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!)
}

export async function downloadTelegramVoice(botToken: string, fileId: string): Promise<{ mimeType: 'audio/ogg'; data: string }> {
 const fileResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`, { signal: AbortSignal.timeout(10000) })
 if (!fileResponse.ok) throw new Error('Telegram getFile failed')
 const fileInfo = await fileResponse.json() as { ok?: boolean; result?: { file_path?: string; file_size?: number } }
 const path = fileInfo.result?.file_path
 if (!fileInfo.ok || !path || !/\.(?:oga|ogg)$/i.test(path) || path.startsWith('/') || path.split('/').includes('..')) throw new Error('Invalid Telegram file metadata')
 if (fileInfo.result?.file_size && fileInfo.result.file_size > 10 * 1024 * 1024) throw new Error('Voice file too large')
 const fileUrl = `https://api.telegram.org/file/bot${botToken}/${path.split('/').map(encodeURIComponent).join('/')}`
 const response = await fetch(fileUrl, { signal: AbortSignal.timeout(10000) })
 if (!response.ok) throw new Error('Telegram file download failed')
 const declaredLength = Number(response.headers.get('content-length') || 0)
 if (declaredLength > 10 * 1024 * 1024) throw new Error('Voice file too large')
 if (!response.body) throw new Error('Telegram file has no body')
 const reader = response.body.getReader()
 const chunks: Uint8Array[] = []
 let total = 0
 while (true) {
  const result = await reader.read()
  if (result.done) break
  total += result.value.byteLength
  if (total > 10 * 1024 * 1024) {
   await reader.cancel()
   throw new Error('Voice file too large')
  }
  chunks.push(result.value)
 }
 if (!total) throw new Error('Voice file size is invalid')
 const bytes = new Uint8Array(total)
 let offset = 0
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
 if (bytes[0] !== 0x4f || bytes[1] !== 0x67 || bytes[2] !== 0x67 || bytes[3] !== 0x53) throw new Error('Telegram voice is not an OGG stream')
 let binary = ''
 for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)))
 return { mimeType: 'audio/ogg', data: btoa(binary) }
}

async function readActionState(db: D1Database, action: ActionName, params: Record<string, unknown>): Promise<unknown> {
 const sku = String(params.sku || '')
 switch (action) {
  case 'create_product': return await db.prepare('SELECT id FROM products WHERE sku = ?').bind(sku).first()
  case 'update_product':
  case 'update_price':
  case 'archive_product':
  case 'restore_product':
  case 'update_stock':
   return await db.prepare(
    `SELECT p.sku, p.name, p.price, p.description, p.brand, p.category_id, p.is_featured, p.is_active, p.is_archived,
            (SELECT json_group_array(json_object('id', ordered.id, 'sku', ordered.sku, 'size', ordered.size, 'stock', ordered.stock))
             FROM (SELECT v.id, v.sku, v.size, v.stock FROM product_variants v WHERE v.product_id = p.id ORDER BY v.id) ordered) AS variants
     FROM products p WHERE p.sku = ?`,
   ).bind(sku).first()
  case 'create_category': return await db.prepare('SELECT id FROM categories WHERE slug = ?').bind(String(params.slug || String(params.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'))).first()
  case 'update_category':
  case 'delete_category': return await db.prepare('SELECT id, name, slug, is_active FROM categories WHERE id = ?').bind(Number(params.id)).first()
  case 'update_store_name':
  case 'update_store_colors':
  case 'update_store_logo':
  case 'update_store_banner':
  case 'update_whatsapp':
  case 'update_business_hours':
  case 'update_business_info': return await db.prepare('SELECT name, primary_color, secondary_color, accent_color, logo_url, cover_image_url, whatsapp_phone, hours, address, phone, email FROM store_config WHERE id = 1').first()
  case 'set_featured_products': return await db.prepare('SELECT sku, is_featured FROM products ORDER BY sku').all()
  default: return null
 }
}

function proposedActionState(before: unknown, action: string, params: Record<string, unknown>): unknown {
 if (action === 'create_product' || action === 'create_category') return { before, proposed: params }
 if (before && typeof before === 'object' && !Array.isArray(before)) {
  const current = before as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  if (action === 'update_price') patch.price = params.price
  if (action === 'update_product') for (const key of ['name', 'description', 'price', 'isFeatured']) if (key in params) patch[key] = params[key]
  if (action === 'update_stock') {
   const variants = parseVariants(current.variants)
   const next = variants.map((variant) => !params.size || variant.sku === `${params.sku}-${params.size}` || variant.size === params.size
     ? { ...variant, stock: params.stock }
     : variant)
   return { ...current, variants: JSON.stringify(next) }
  }
  if (action === 'archive_product') Object.assign(patch, { is_archived: 1, is_active: 0 })
  if (action === 'restore_product') Object.assign(patch, { is_archived: 0, is_active: 1 })
  if (action === 'update_category') patch.name = params.name
  if (action === 'delete_category') patch.is_active = 0
  if (action === 'update_store_name') patch.name = params.name
  if (action === 'update_store_colors') Object.assign(patch, params)
  if (action === 'update_store_logo') patch.logo_url = params.logoUrl
  if (action === 'update_store_banner') patch.cover_image_url = params.coverImageUrl
  if (action === 'update_whatsapp') patch.whatsapp_phone = params.whatsappPhone
  if (action === 'update_business_hours') patch.hours = params.hours
  if (action === 'update_business_info') Object.assign(patch, params)
  if (action === 'set_featured_products') return { before, featured_skus: params.skus }
  return { ...current, ...patch }
 }
 return { before, proposed: params }
}

function parseVariants(value: unknown): Array<{ id: number; sku: string; size: string | null; stock: number }> {
 try {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  return Array.isArray(parsed) ? parsed : []
 } catch {
  return []
 }
}

function stockValues(before: Record<string, unknown>, params: Record<string, unknown>): string[] {
 return parseVariants(before.variants)
  .filter((variant) => !params.size || variant.sku === `${params.sku}-${params.size}` || variant.size === params.size)
  .map((variant) => `${variant.size || variant.sku}: ${variant.stock}`)
}

export async function linkTelegramAccount(
 chatId: number,
 code: string,
 db: D1Database
): Promise<{ success: boolean; message: string }> {
 // Consume the one-time code and bind its owner in a single conditional write.
 const linked = await db.prepare(
  `UPDATE store_config SET telegram_owner_id = ?, telegram_link_code = NULL, telegram_link_expires_at = NULL,
                          updated_at = datetime('now')
   WHERE id = 1 AND telegram_link_code = ? AND telegram_link_expires_at > datetime('now')
   RETURNING telegram_owner_id`,
 ).bind(String(chatId), code).first()
 if (!linked) return { success: false, message: 'Código de enlace inválido o expirado.' }

 return { success: true, message: '✅ Cuenta de Telegram vinculada correctamente.' }
}
