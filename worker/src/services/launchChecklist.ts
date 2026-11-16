/** «Listo para vender»: the steps that make a new store ready to sell, computed from the real data of the store
 * (never from what the browser says). Deterministic and read-only. */

export type ChecklistItem = { key: string; label: string; hint: string; done: boolean; path: string }

const DEFAULT_NAME = 'Mi Tienda'
const DEFAULT_PRIMARY = '#0057FF'

export async function launchChecklist(db: D1Database, storeId: number) {
  const row = await db.prepare(
    `SELECT s.name AS storeName, s.slug, s.status, c.name AS configName, c.logo_url AS logo, c.primary_color AS primaryColor, c.whatsapp_phone AS whatsapp, c.description,
            (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id AND p.is_archived = 0) AS products,
            (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id AND p.is_archived = 0 AND (p.image_urls IS NULL OR p.image_urls IN ('', '[]'))) AS withoutPhoto,
            (SELECT COUNT(*) FROM categories k WHERE k.store_id = s.id) AS categories,
            (SELECT COUNT(*) FROM orders o WHERE o.store_id = s.id) AS orders
     FROM stores s LEFT JOIN store_config c ON c.id = s.id WHERE s.id = ?`,
  ).bind(storeId).first<{ storeName: string; slug: string; status: string; configName: string | null; logo: string | null; primaryColor: string | null; whatsapp: string | null; description: string | null; products: number; withoutPhoto: number; categories: number; orders: number }>()
  if (!row) return { items: [], done: 0, total: 0, ready: false }
  const products = Number(row.products || 0)
  const name = (row.configName || row.storeName || '').trim()
  const items: ChecklistItem[] = [
    { key: 'identidad', label: 'Nombre y logotipo', hint: 'Tus clientes reconocen tu marca desde el primer vistazo.', done: Boolean(name && name !== DEFAULT_NAME && row.logo), path: '/admin/appearance#marca' },
    { key: 'colores', label: 'Colores de tu marca', hint: 'Elige los colores de tu tienda.', done: Boolean(row.primaryColor && row.primaryColor.toUpperCase() !== DEFAULT_PRIMARY), path: '/admin/appearance' },
    { key: 'whatsapp', label: 'WhatsApp para recibir pedidos', hint: 'Los pedidos llegan a este número.', done: String(row.whatsapp || '').replace(/\D/g, '').length >= 10, path: '/admin/settings' },
    { key: 'primer_producto', label: 'Tu primer producto', hint: 'Con precio y existencias.', done: products >= 1, path: '/admin/products?new=1' },
    { key: 'fotos', label: 'Todos tus productos con foto', hint: 'Un producto con foto se vende mucho más.', done: products >= 1 && Number(row.withoutPhoto || 0) === 0, path: '/admin/products' },
    { key: 'catalogo', label: 'Al menos 5 productos', hint: 'Un catálogo con variedad invita a comprar.', done: products >= 5, path: '/admin/products?new=1' },
    { key: 'categorias', label: 'Organiza en categorías', hint: 'Ayuda a encontrar rápido lo que buscan.', done: Number(row.categories || 0) >= 1, path: '/admin/categories' },
    { key: 'pedido', label: 'Haz un pedido de prueba', hint: 'Abre tu tienda, agrega al carrito y envía el pedido: así ves lo que vive tu cliente.', done: Number(row.orders || 0) >= 1, path: '/' },
  ]
  const done = items.filter((item) => item.done).length
  return { items, done, total: items.length, ready: done === items.length, published: row.status === 'active' }
}
