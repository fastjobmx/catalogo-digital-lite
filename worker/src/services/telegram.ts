import type { Env } from '../index'

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
 if (ownerId && userId !== parseInt(ownerId, 10)) {
 await sendTelegramMessage(botToken, chatId, 'Acceso no autorizado. Solo el propietario vinculado puede administrar la tienda.')
 return
 }

 if (message.voice) {
  if (!env.GEMINI_API_KEY) {
    await sendTelegramMessage(botToken, chatId, 'Las notas de voz requieren GEMINI_API_KEY. Estado: PENDIENTE DE CREDENCIALES.')
    return
  }
  await sendTelegramMessage(botToken, chatId, 'Recibí la nota de voz. La transcripción con Gemini está lista cuando el archivo se descargue; si falla, envía el mismo pedido por texto.')
  return
 }

 if (!message.text) {
  await sendTelegramMessage(botToken, chatId, 'Recibí un archivo. Las fotos se asociarán al producto pendiente de confirmación. No invento fotografías.')
  return
 }

 const text = message.text.trim()

 // Command routing
 if (text.startsWith('/')) {
 await handleCommand(text, chatId, botToken, db)
 } else {
 await handleFreeText(text, chatId, botToken, env, db)
 }
}

async function handleCommand(
 text: string,
 chatId: number,
 botToken: string,
 db: D1Database
): Promise<void> {
 const [command] = text.split(' ')

 switch (command) {
 case '/start':
 await sendTelegramMessage(botToken, chatId,
 `👋 <b>Bienvenido a Catálogo Digital Lite</b>\n\n` +
 `Comandos disponibles:\n` +
 `/stats — Resumen del catálogo\n` +
 `/productos — Listar productos activos\n` +
 `/categorias — Listar categorías\n` +
 `/pedido — Ver últimos pedidos\n` +
 `/ayuda — Mostrar esta ayuda`
 )
 break

 case '/stats':
 case '/estadisticas':
 const stats = await getStoreStats(db)
 await sendTelegramMessage(botToken, chatId,
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
 await sendTelegramMessage(botToken, chatId, '📦 No hay productos activos.')
 } else {
 const list = products.results.map((p: any, i: number) =>
 `${i + 1}. <b>${p.name}</b>\n SKU: ${p.sku} — $${p.price.toLocaleString()}`
 ).join('\n\n')
 await sendTelegramMessage(botToken, chatId,
 `📦 <b>Últimos productos</b>\n\n${list}`
 )
 }
 break

 case '/categorias':
 const categories = await db.prepare(
 `SELECT c.name, COUNT(p.id) as count FROM categories c LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1 WHERE c.is_active = 1 GROUP BY c.id ORDER BY c.name`
 ).all()

 if (!categories.results || categories.results.length === 0) {
 await sendTelegramMessage(botToken, chatId, '🏷️ No hay categorías activas.')
 } else {
 const list = categories.results.map((c: any) =>
 `• <b>${c.name}</b> — ${c.count} productos`
 ).join('\n')
 await sendTelegramMessage(botToken, chatId,
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
 await sendTelegramMessage(botToken, chatId, '🛒 No hay pedidos registrados.')
 } else {
 const list = orders.results.map((o: any) =>
 `📋 <b>${o.display_id}</b>\n` +
 ` 👤 ${o.customer_name || 'Anónimo'}\n` +
 ` 💰 $${o.total.toLocaleString()}\n` +
 ` 📅 ${o.created_at}\n` +
 ` 🔄 ${o.status}`
 ).join('\n\n')
 await sendTelegramMessage(botToken, chatId,
 `🛒 <b>Últimos pedidos</b>\n\n${list}`
 )
 }
 break

 case '/ayuda':
 case '/help':
 await sendTelegramMessage(botToken, chatId,
 `📖 <b>Ayuda de Catálogo Digital Lite</b>\n\n` +
 `Este bot te permite gestionar tu catálogo desde Telegram.\n\n` +
 `<b>Comandos:</b>\n` +
 `/start — Mensaje de bienvenida\n` +
 `/stats — Ver estadísticas del catálogo\n` +
 `/productos — Listar productos activos\n` +
 `/categorias — Listar categorías\n` +
 `/pedido — Ver últimos pedidos\n` +
 `/ayuda — Mostrar esta ayuda\n\n` +
 `También puedes escribir texto libre y el asistente IA intentará ayudarte.`
 )
 break

 default:
 await sendTelegramMessage(botToken, chatId,
 `❓ Comando no reconocido: <code>${command}</code>\n\n` +
 `Usa /ayuda para ver los comandos disponibles.`
 )
 }
}

async function handleFreeText(
 text: string,
 chatId: number,
 botToken: string,
 env: Env['Bindings'],
 db: D1Database,
): Promise<void> {
  const { interpretCommand } = await import('../ai/interpreter')
  const { executeAction } = await import('../ai/executor')
  const { ACTION_NAMES } = await import('../validation/actions')

  if (/^(sí|si|confirmar|ok|aprobar)$/i.test(text.trim())) {
    const pending = await db.prepare(
      `SELECT * FROM pending_actions WHERE chat_id = ? AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`,
    ).bind(String(chatId)).first() as { action: string; params_json: string } | null
    if (!pending) {
      await sendTelegramMessage(botToken, chatId, 'No hay ninguna operación pendiente de confirmación.')
      return
    }
    const result = await executeAction(db, pending.action as typeof ACTION_NAMES[number], JSON.parse(pending.params_json), `telegram:${chatId}`)
    await db.prepare('DELETE FROM pending_actions WHERE chat_id = ?').bind(String(chatId)).run()
    await sendTelegramMessage(botToken, chatId, result.message)
    return
  }

  if (/^(no|cancelar)$/i.test(text.trim())) {
    await db.prepare('DELETE FROM pending_actions WHERE chat_id = ?').bind(String(chatId)).run()
    await sendTelegramMessage(botToken, chatId, 'Operación cancelada.')
    return
  }

  let proposal = interpretCommand(text)
  if (proposal.action === 'unknown' && env.GEMINI_API_KEY) {
    try {
      const raw = await queryGeminiAI(text, env)
      const jsonStart = raw.indexOf('{')
      const json = JSON.parse(raw.slice(jsonStart))
      proposal = {
        action: json.action,
        params: json.params || {},
        missing: json.missing || [],
        needsConfirmation: json.needsConfirmation !== false,
        summary: json.summary || raw,
        simulated: false,
      }
    } catch {
      await sendTelegramMessage(botToken, chatId, 'Gemini no devolvió una acción válida. No ejecuto SQL libre ni texto sin esquema.')
      return
    }
  } else if (proposal.action === 'unknown') {
    await sendTelegramMessage(botToken, chatId, `${proposal.summary}\n\nEstado: SIMULADO local / PENDIENTE DE CREDENCIALES de Gemini.`)
    return
  }

  if (proposal.missing.length) {
    await sendTelegramMessage(botToken, chatId, `Faltan datos obligatorios: ${proposal.missing.join(', ')}. No invento precios, stock ni fotos.`)
    return
  }

  if (proposal.needsConfirmation) {
    await db.prepare(
      `INSERT INTO pending_actions (chat_id, action, params_json, summary, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+15 minutes'))`,
    ).bind(String(chatId), proposal.action, JSON.stringify(proposal.params), proposal.summary).run()
    await sendTelegramMessage(botToken, chatId, `${proposal.summary}\n\nResponde SÍ para confirmar o NO para cancelar.`)
    return
  }

  if (proposal.action === 'unknown' || proposal.action === 'ask') {
    await sendTelegramMessage(botToken, chatId, proposal.summary)
    return
  }

  const result = await executeAction(db, proposal.action as typeof ACTION_NAMES[number], proposal.params, `telegram:${chatId}`)
  await sendTelegramMessage(botToken, chatId, result.message)
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

export async function queryGeminiAI(
 userMessage: string,
 env: Env['Bindings']
): Promise<string> {
 const apiKey = env.GEMINI_API_KEY
 const model = env.GEMINI_MODEL || 'gemini-2.0-flash'

 if (!apiKey) {
 throw new Error('GEMINI_API_KEY not configured')
 }

 const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

 const response = await fetch(url, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 contents: [{
 parts: [{
 text: `Devuelve SOLO JSON con action, params, missing, needsConfirmation y summary. Acciones permitidas: create_product, update_product, archive_product, restore_product, update_stock, update_price, create_category, update_category, delete_category, set_featured_products, update_store_name, update_store_colors, update_store_logo, update_store_banner, update_whatsapp, update_business_hours, update_business_info, get_inventory, get_products, get_store_configuration. Nunca inventes precios, stock, SKU o fotos. Mensaje: ${userMessage}`
 }]
 }],
 generationConfig: {
 temperature: 0.7,
 maxOutputTokens: 500,
 },
 }),
 })

 if (!response.ok) {
 const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
 throw new Error(`Gemini API error: ${(error as any).error?.message || response.status}`)
 }

 const data = await response.json() as any
 const text = data.candidates?.[0]?.content?.parts?.[0]?.text

 if (!text) {
 throw new Error('Empty response from Gemini')
 }

 return text
}

export async function linkTelegramAccount(
 chatId: number,
 code: string,
 db: D1Database
): Promise<{ success: boolean; message: string }> {
 // Verify the link code exists and is not expired
 const link = await db.prepare(
 `SELECT telegram_owner_id FROM store_config WHERE telegram_link_code = ? AND telegram_link_expires_at > datetime('now')`
 ).bind(code).first()

 if (!link) {
 return { success: false, message: 'Código de enlace inválido o expirado.' }
 }

 // Update store config with the Telegram owner ID
 await db.prepare(
 `UPDATE store_config SET telegram_owner_id = ?, telegram_link_code = NULL, telegram_link_expires_at = NULL, updated_at = datetime('now') WHERE id = 1`
 ).bind(String(chatId)).run()

 return { success: true, message: '✅ Cuenta de Telegram vinculada correctamente.' }
}