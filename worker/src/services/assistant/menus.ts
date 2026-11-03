import type { InlineKeyboard } from './telegramApi'
import type { Membership } from '../../tenancy/access'
import { escapeHtml } from './tools'

/** Friendly main menu: the first thing an owner sees. */
export function mainMenuKeyboard(multiStore = false): InlineKeyboard {
  const rows: InlineKeyboard['inline_keyboard'] = [
    [{ text: '➕ Agregar producto', callback_data: 'm:new_product' }, { text: '📦 Ver inventario', callback_data: 'm:inventory' }],
    [{ text: '🛒 Consultar pedidos', callback_data: 'm:orders' }, { text: '🎨 Editar mi tienda', callback_data: 'm:appearance' }],
    [{ text: '✨ Preguntar a la IA', callback_data: 'm:ask_ai' }, { text: '📊 Reportes', callback_data: 'm:reports' }],
    [{ text: '🏷️ Categorías', callback_data: 'm:categories' }, { text: '❔ Ayuda', callback_data: 'm:help' }],
  ]
  if (multiStore) rows.push([{ text: '🔁 Cambiar de tienda', callback_data: 'm:switch_store' }])
  return { inline_keyboard: rows }
}

export function backToMenu(): InlineKeyboard {
  return { inline_keyboard: [[{ text: '↩ Menú principal', callback_data: 'm:menu' }]] }
}

export function orderMenuKeyboard(): InlineKeyboard {
  return { inline_keyboard: [
    [{ text: '⏳ Pendientes', callback_data: 'm:orders_pending' }, { text: '📋 Recientes', callback_data: 'm:orders' }],
    [{ text: '📈 Resumen 30 días', callback_data: 'm:sales' }, { text: '🏆 Más vendidos', callback_data: 'm:top' }],
    [{ text: '↩ Menú principal', callback_data: 'm:menu' }],
  ] }
}

export function inventoryKeyboard(): InlineKeyboard {
  return { inline_keyboard: [
    [{ text: '⚠️ Poco stock', callback_data: 'm:low_stock' }, { text: '🚫 Agotados', callback_data: 'm:out_of_stock' }],
    [{ text: '📝 Sin descripción', callback_data: 'm:no_description' }, { text: '🖼️ Sin fotos', callback_data: 'm:no_photos' }],
    [{ text: '↩ Menú principal', callback_data: 'm:menu' }],
  ] }
}

export function appearanceKeyboard(): InlineKeyboard {
  return { inline_keyboard: [
    [{ text: '🖼️ Cambiar banner', callback_data: 'm:banner' }, { text: '🔖 Cambiar logo', callback_data: 'm:logo' }],
    [{ text: '🎨 Color principal', callback_data: 'm:primary_color' }, { text: '📝 Título de portada', callback_data: 'm:hero_title' }],
    [{ text: '✏️ Nombre comercial', callback_data: 'm:name' }, { text: '📱 WhatsApp', callback_data: 'm:whatsapp' }],
    [{ text: '🕒 Horario', callback_data: 'm:hours' }, { text: '⭐ Destacados', callback_data: 'm:featured' }],
    [{ text: '↩ Menú principal', callback_data: 'm:menu' }],
  ] }
}

export function operationKeyboard(operationId: string): InlineKeyboard {
  return { inline_keyboard: [[
    { text: '✅ Confirmar', callback_data: `op:confirm:${operationId}` },
    { text: '✖ Cancelar', callback_data: `op:cancel:${operationId}` },
  ], [
    { text: '👁 Ver de nuevo', callback_data: `op:preview:${operationId}` },
  ]] }
}

export function storePickerKeyboard(memberships: Membership[]): InlineKeyboard {
  return { inline_keyboard: memberships.slice(0, 20).map((membership) => [{ text: `🏪 ${membership.name}${membership.status === 'draft' ? ' (borrador)' : ''}`, callback_data: `s:select:${membership.storeId}` }]) }
}

export function greeting(firstName: string, storeName: string, isFirstTime = false): string {
  const name = firstName ? `, ${escapeHtml(firstName)}` : ''
  return isFirstTime
    ? `¡Hola${name}! 👋 Soy el asistente de <b>${escapeHtml(storeName)}</b>.\nPuedo ayudarte a publicar productos, revisar tu inventario, consultar pedidos y cuidar la apariencia de tu tienda.\n\n¿Qué hacemos hoy?`
    : `¡Hola${name}! 👋 Bienvenido a <b>${escapeHtml(storeName)}</b>.\n¿Qué hacemos hoy?`
}

export const HELP_TEXT = [
  '📖 <b>Cómo te ayudo</b>',
  '',
  'Escríbeme como le hablarías a un colaborador, o envíame una nota de voz. Por ejemplo:',
  '• “Quiero agregar unos tenis negros” y luego envía las fotos',
  '• “Muéstrame los productos con menos de cinco unidades”',
  '• “Cambia el precio de ABC123 a 180.000”',
  '• “Oculta los productos agotados”',
  '• “Escribe una descripción más atractiva para ABC123”',
  '• “¿Cuáles son los productos más vendidos este mes?”',
  '• “Cambia el color principal de mi tienda a azul oscuro”',
  '',
  'También puedes enviarme:',
  '📷 Fotos para crear un producto o cambiar el banner',
  '📄 Un archivo CSV para actualizar precios y stock',
  '',
  'Antes de cambiar algo importante te muestro una vista previa y te pido confirmación.',
  'Comandos: /menu · /productos · /pedidos · /cancelar · /tienda · /ayuda',
].join('\n')
