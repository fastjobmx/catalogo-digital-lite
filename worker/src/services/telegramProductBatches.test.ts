import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPng } from '../../test/sqliteD1'
import { callbackUpdate, createHarness, createStoreUser, seedStore, stubTelegram, type Harness } from '../testing/harness'
import { processTelegramUpdate } from './telegram'
import { parseTelegramProductCaption } from './telegramProductBatches'

const OWNER = 78001
let h: Harness
let storeId: number
let updateId = 780000
let messageId = 100

function visionResponse(payload: unknown) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 60 } }))
}

function stubServices(options: { gemini?: unknown; image?: Uint8Array; downloadFailure?: boolean } = {}) {
  const png = options.image || createPng(640, 480)
  const telegram = stubTelegram((url) => {
    if (url.includes('generativelanguage.googleapis.com')) return options.gemini === undefined ? new Response('{}', { status: 500 }) : visionResponse(options.gemini)
    if (url.includes('/getFile')) return options.downloadFailure
      ? new Response('{}', { status: 500 })
      : new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/product.png', file_size: png.byteLength } }))
    if (url.includes('/file/bot')) return new Response(png, { headers: { 'content-length': String(png.byteLength) } })
    return undefined
  })
  return telegram
}

const send = (update: unknown) => processTelegramUpdate(update as never, h.env, h.db)
const buttons = (telegram: ReturnType<typeof stubTelegram>) => (telegram.lastMarkup()?.inline_keyboard || []).flat()
const callbackFor = (telegram: ReturnType<typeof stubTelegram>, label: RegExp) => buttons(telegram).find((button) => label.test(button.text))?.callback_data
const text = (value: string, user = OWNER) => ({ update_id: ++updateId, message: { message_id: ++messageId, from: { id: user, first_name: 'Walter' }, chat: { id: user, type: 'private' as const }, date: 1, text: value } })
const photo = (fileId: string, options: { caption?: string; group?: string; fileUniqueId?: string; message?: number; update?: number; user?: number } = {}) => ({
  update_id: options.update ?? ++updateId,
  message: {
    message_id: options.message ?? ++messageId,
    from: { id: options.user ?? OWNER, first_name: 'Walter' }, chat: { id: options.user ?? OWNER, type: 'private' as const }, date: 1,
    photo: [{ file_id: fileId, ...(options.fileUniqueId ? { file_unique_id: options.fileUniqueId } : {}) }],
    ...(options.caption ? { caption: options.caption } : {}), ...(options.group ? { media_group_id: options.group } : {}),
  },
})

async function startBatch(telegram: ReturnType<typeof stubTelegram>, user = OWNER) {
  await send(text('/lote', user))
  expect(telegram.messages().at(-1)).toContain('una fotografía por cada artículo')
}

async function closeBatch(telegram: ReturnType<typeof stubTelegram>, user = OWNER) {
  await send(text('/listo', user))
  expect(telegram.messages().at(-1)).toContain('Recibí')
}

async function confirmPublish(telegram: ReturnType<typeof stubTelegram>, user = OWNER) {
  await send(text('/publicar', user))
  const confirm = callbackFor(telegram, /Confirmar/)
  expect(confirm).toMatch(/^tb:confirm:/)
  await send(callbackUpdate(user, confirm!))
}

beforeEach(async () => {
  h = createHarness({ TELEGRAM_BOT_TOKEN: 'test-bot-token', TELEGRAM_WEBHOOK_SECRET: 'webhook-secret' })
  storeId = await seedStore(h.db, { slug: 'lote-test', name: 'Lote Test', plan: 'profesional' })
  await h.db.prepare('UPDATE stores SET telegram_bulk_import_enabled = 1 WHERE id = ?').bind(storeId).run()
  await createStoreUser(h.db, { email: 'owner@lote.test', storeId, role: 'owner', telegramUserId: String(OWNER) })
  await h.db.prepare('INSERT INTO categories (store_id, name, slug) VALUES (?, ?, ?)').bind(storeId, 'Calzado', 'calzado').run()
  updateId = 780000; messageId = 100
})

afterEach(() => vi.unstubAllGlobals())

describe('per-store Telegram bulk import flag', () => {
  it('blocks starting and photo intake when the platform has not enabled the feature', async () => {
    await h.db.prepare('UPDATE stores SET telegram_bulk_import_enabled = 0 WHERE id = ?').bind(storeId).run()
    const telegram = stubServices()
    await send(text('/lote'))
    expect(telegram.messages().at(-1)).toContain('está desactivada')
    await send(photo('disabled-photo'))
    expect(h.db.query('SELECT COUNT(*) AS n FROM telegram_product_batches')).toEqual([{ n: 0 }])
    expect(h.db.query('SELECT COUNT(*) AS n FROM telegram_product_batch_items')).toEqual([{ n: 0 }])
  })
})

describe('Telegram batch field extraction', () => {
  it('extracts only facts explicitly written in an image caption', () => {
    expect(parseTelegramProductCaption('Sandalias negras talla 38, precio 80000, 5 unidades')).toEqual({
      name: 'Sandalias negras', description: null, price: 80000, stock: 5, size: '38', color: null, categoryName: null, sku: null,
    })
  })

  it('does not invent price, quantity, size, or SKU from a bare photo caption', () => {
    expect(parseTelegramProductCaption('Bolso beige')).toEqual({ name: 'Bolso beige', description: null, price: null, stock: null, size: null, color: null, categoryName: null, sku: null })
  })

  it('extracts an explicitly labeled description, category, and SKU without suggesting them', () => {
    expect(parseTelegramProductCaption('Nombre: Camiseta negra, descripción: algodón suave, categoría: Ropa, SKU: CAM-23, precio 80000, talla M, color Negro, 3 unidades')).toMatchObject({
      name: 'Camiseta negra', description: 'algodón suave', categoryName: 'Ropa', sku: 'CAM-23', price: 80000, size: 'M', color: 'Negro', stock: 3,
    })
  })

  it('parses a numbered product list with bare prices in the numbered format', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('list-1'))
    await send(photo('list-2'))
    await closeBatch(telegram)
    await send(text('1. Zapatos blancos 90000 5 unidades\n2. Zapatos negros 95000 8 unidades'))
    const items = h.db.query<{ name: string; price: number; stock: number }>('SELECT name, price, stock FROM telegram_product_batch_items ORDER BY position')
    expect(items).toEqual([{ name: 'Zapatos blancos', price: 90000, stock: 5 }, { name: 'Zapatos negros', price: 95000, stock: 8 }])
  })

  it('does not apply a malformed numbered product association', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('only-1'))
    await closeBatch(telegram)
    await send(text('2. Producto que no corresponde 80000 3 unidades'))
    expect(h.db.query<{ name: string | null }>('SELECT name FROM telegram_product_batch_items')).toEqual([{ name: null }])
    expect(telegram.messages().at(-1)).toContain('Apliqué 0 línea(s)')
  })
})

describe('photo collection, album order, and durable review', () => {
  it('creates exactly one persistent product draft for one photo and records caption facts', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('single', { caption: 'Sandalias negras talla 38, precio 80000, 5 unidades' }))
    expect(h.db.query('SELECT COUNT(*) AS n FROM telegram_product_batch_items')).toEqual([{ n: 1 }])
    expect(h.db.query<{ name: string; price: number; stock: number }>('SELECT name, price, stock FROM telegram_product_batch_items')).toEqual([{ name: 'Sandalias negras', price: 80000, stock: 5 }])
  })

  it('treats five photos as five independent products and supports a Telegram album id', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    for (let i = 1; i <= 5; i++) await send(photo(`album-${i}`, { group: 'album-five', caption: `Producto ${i}, precio ${i * 10000}, ${i} unidades` }))
    expect(h.db.query('SELECT COUNT(*) AS n FROM telegram_product_batch_items')).toEqual([{ n: 5 }])
    expect(h.db.query<{ media_group_id: string; n: number }>('SELECT media_group_id, COUNT(*) AS n FROM telegram_product_batch_items GROUP BY media_group_id')).toEqual([{ media_group_id: 'album-five', n: 5 }])
  })

  it('accepts ten photo messages in one album and does not wait for an album-complete signal', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    for (let i = 1; i <= 10; i++) await send(photo(`ten-${i}`, { group: 'album-ten', message: 300 + i }))
    await closeBatch(telegram)
    expect(h.db.query('SELECT COUNT(*) AS n FROM telegram_product_batch_items')).toEqual([{ n: 10 }])
    expect(h.db.query<{ status: string }>('SELECT status FROM telegram_product_batches')).toEqual([{ status: 'needs_review' }])
    expect(telegram.messages().at(-1)).toContain('10 fotografía(s)')
  })

  it('accepts eleven photos across consecutive messages and closes only on /listo', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    for (let i = 1; i <= 11; i++) await send(photo(`eleven-${i}`))
    expect(h.db.query<{ status: string }>('SELECT status FROM telegram_product_batches')).toEqual([{ status: 'receiving' }])
    await closeBatch(telegram)
    expect(h.db.query('SELECT COUNT(*) AS n FROM telegram_product_batch_items')).toEqual([{ n: 11 }])
  })

  it('accepts thirty photos in three albums and keeps deterministic message order', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    for (let album = 0; album < 3; album++) for (let slot = 0; slot < 10; slot++) {
      const ordinal = album * 10 + slot
      await send(photo(`thirty-${ordinal}`, { group: `album-${album}`, message: 500 + ordinal }))
    }
    const positions = h.db.query<{ position: number }>('SELECT position FROM telegram_product_batch_items ORDER BY position')
    expect(positions.map((row) => row.position)).toEqual(Array.from({ length: 30 }, (_, index) => 500 + index))
    expect(telegram.messages().filter((message) => /^Recibí \d+ foto\(s\)/.test(message))).toHaveLength(4)
  })

  it('sorts photos received out of order by Telegram message id', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('later', { message: 902 }))
    await send(photo('earlier', { message: 901 }))
    await closeBatch(telegram)
    expect(h.db.query<{ telegram_file_id: string }>('SELECT telegram_file_id FROM telegram_product_batch_items ORDER BY position')).toEqual([{ telegram_file_id: 'earlier' }, { telegram_file_id: 'later' }])
  })

  it('deduplicates a repeated webhook image file within the active batch', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('same-file-a', { message: 930, fileUniqueId: 'same-unique-id' }))
    await send(photo('same-file-b', { message: 931, fileUniqueId: 'same-unique-id' }))
    expect(h.db.query('SELECT COUNT(*) AS n FROM telegram_product_batch_items')).toEqual([{ n: 1 }])
    expect(telegram.messages().at(-1)).toContain('duplicado técnico')
  })

  it('rejects an invalid document when the batch only accepts supported images', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send({ update_id: ++updateId, message: { message_id: ++messageId, from: { id: OWNER, first_name: 'Walter' }, chat: { id: OWNER, type: 'private' }, date: 1, document: { file_id: 'bad-doc', file_name: 'catalog.svg', mime_type: 'image/svg+xml' } } })
    expect(h.db.query('SELECT COUNT(*) AS n FROM telegram_product_batch_items')).toEqual([{ n: 0 }])
    expect(telegram.messages().at(-1)).toContain('JPG, PNG o WebP')
  })

  it('accepts a compatible image document as one product item', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    const image = { file_id: 'photo-document', file_unique_id: 'doc-photo-unique', file_name: 'shoe.png', mime_type: 'image/png' }
    await send({ update_id: ++updateId, message: { message_id: ++messageId, from: { id: OWNER, first_name: 'Walter' }, chat: { id: OWNER, type: 'private' }, date: 1, document: image, caption: 'Zapato blanco, precio 95000, 2 unidades' } })
    expect(h.db.query('SELECT COUNT(*) AS n FROM telegram_product_batch_items')).toEqual([{ n: 1 }])
    expect(telegram.messages().at(-1)).toContain('Recibí 1 foto(s)')
  })

  it('enforces the configured aggregate image-storage limit', async () => {
    h.env.TELEGRAM_BATCH_MAX_BYTES = '100'
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('over-byte-budget'))
    expect(h.db.query('SELECT COUNT(*) AS n FROM telegram_product_batch_items')).toEqual([{ n: 0 }])
    expect(telegram.messages().at(-1)).toContain('límite de almacenamiento')
    expect(h.assets.objects.size).toBe(0)
  })

  it('continues when a Telegram image cannot be downloaded and does not insert an item', async () => {
    const telegram = stubServices({ downloadFailure: true })
    await startBatch(telegram)
    await send(photo('download-fails'))
    expect(h.db.query('SELECT COUNT(*) AS n FROM telegram_product_batch_items')).toEqual([{ n: 0 }])
    expect(telegram.messages().at(-1)).toContain('No agregué este producto')
  })

  it('resumes an interrupted receiving batch after a new assistant update', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    const id = h.db.query<{ id: string }>('SELECT id FROM telegram_product_batches')[0]!.id
    await send(photo('resume-1'))
    await send(text('/lote'))
    expect(h.db.query<{ id: string; status: string }>('SELECT id, status FROM telegram_product_batches')).toEqual([{ id, status: 'receiving' }])
    expect(telegram.messages().at(-1)).toContain('lote abierto')
  })
})

describe('validation, corrections, plan limits, and publication', () => {
  it('does not publish a product without its required name, price, or quantity', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('missing-fields'))
    await closeBatch(telegram)
    await send(text('/publicar'))
    expect(telegram.messages().at(-1)).toContain('0 listos')
    expect(h.db.query('SELECT COUNT(*) AS n FROM products WHERE store_id = ?', storeId)).toEqual([{ n: 0 }])
  })

  it('applies a multi-product numbered correction to the corresponding photos only', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    for (let i = 1; i <= 3; i++) await send(photo(`correction-${i}`))
    await closeBatch(telegram)
    await send(text('1. Zapatos blancos 90000 5 unidades\n2. Zapatos negros 95000 8 unidades'))
    expect(h.db.query<{ name: string | null; status: string }>('SELECT name, status FROM telegram_product_batch_items ORDER BY position')).toEqual([
      { name: 'Zapatos blancos', status: 'ready_to_publish' }, { name: 'Zapatos negros', status: 'ready_to_publish' }, { name: null, status: 'needs_review' },
    ])
  })

  it('applies price, size, global stock, and range category corrections without adding stock', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    for (let i = 1; i <= 5; i++) await send(photo(`bulk-edit-${i}`))
    await closeBatch(telegram)
    await send(text('Del 1 al 5 ponles categoría calzado'))
    await send(text('Todos los productos tienen 3 unidades'))
    await send(text('El producto 3 vale 85000'))
    await send(text('El producto 3 es talla 40'))
    const row = h.db.query<{ price: number; stock: number; size: string; category_name: string }>('SELECT price, stock, size, category_name FROM telegram_product_batch_items WHERE position = (SELECT MIN(position) + 2 FROM telegram_product_batch_items)')[0]
    expect(row).toMatchObject({ price: 85000, stock: 3, size: '40', category_name: 'calzado' })
    expect(telegram.messages().join('\n')).toContain('No sumé existencias')
  })

  it('excludes a selected product from publication without archiving anything already in the catalog', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('keep', { caption: 'Mochila azul, precio 90000, 2 unidades' }))
    await send(photo('skip', { caption: 'Gorra roja, precio 30000, 4 unidades' }))
    await closeBatch(telegram)
    await send(text('El 2 no lo publiques'))
    expect(h.db.query<{ status: string }>('SELECT status FROM telegram_product_batch_items ORDER BY position')).toEqual([{ status: 'ready_to_publish' }, { status: 'ignored' }])
    await confirmPublish(telegram)
    expect(h.db.query('SELECT COUNT(*) AS n FROM products WHERE store_id = ?', storeId)).toEqual([{ n: 1 }])
    expect(h.db.query<{ status: string }>('SELECT status FROM telegram_product_batches')).toEqual([{ status: 'published' }])
  })

  it('publishes one photo as one product, creates a variant, stores the image, and audits it', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('publish-one', { caption: 'Sandalias negras talla 38, precio 80000, 5 unidades' }))
    await closeBatch(telegram)
    await confirmPublish(telegram)
    const product = h.db.query<{ sku: string; name: string; price: number; image_urls: string }>('SELECT sku, name, price, image_urls FROM products WHERE store_id = ?', storeId)[0]!
    expect(product).toMatchObject({ name: 'Sandalias negras', price: 80000 })
    expect(product.sku).toMatch(/^TG-[A-F0-9]{8}-\d+$/)
    expect(JSON.parse(product.image_urls)).toHaveLength(1)
    expect(h.db.query<{ size: string; stock: number }>('SELECT size, stock FROM product_variants WHERE product_id = (SELECT id FROM products WHERE sku = ?)', product.sku)).toEqual([{ size: '38', stock: 5 }])
    expect(h.db.query('SELECT action FROM audit_log WHERE action = \'product_created\' AND source = \'telegram\'')).toHaveLength(1)
    expect(telegram.messages().at(-2)).toContain('Productos publicados en esta operación: 1')
  })

  it('requires explicit confirmation and only publishes complete products', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('complete', { caption: 'Bolso beige, precio 120000, 4 unidades' }))
    await send(photo('incomplete'))
    await closeBatch(telegram)
    await send(text('/publicar'))
    expect(telegram.messages().at(-1)).toContain('¿Confirmas esta publicación?')
    expect(h.db.query('SELECT COUNT(*) AS n FROM products WHERE store_id = ?', storeId)).toEqual([{ n: 0 }])
    const confirm = callbackFor(telegram, /Confirmar 1/)
    await send(callbackUpdate(OWNER, confirm!))
    expect(h.db.query('SELECT COUNT(*) AS n FROM products WHERE store_id = ?', storeId)).toEqual([{ n: 1 }])
    expect(h.db.query<{ status: string }>('SELECT status FROM telegram_product_batch_items ORDER BY position')).toEqual([{ status: 'published' }, { status: 'needs_review' }])
  })

  it('keeps successful products when another product fails in the same confirmed operation', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('works', { caption: 'Bolso beige, precio 120000, 4 unidades' }))
    await send(photo('broken', { caption: 'Roto negro, precio 10000, 1 unidad' }))
    await closeBatch(telegram)
    h.db.sqlite.exec("CREATE TRIGGER reject_roto BEFORE INSERT ON products WHEN NEW.name = 'Roto negro' BEGIN SELECT RAISE(ABORT, 'blocked for test'); END;")
    await confirmPublish(telegram)
    expect(h.db.query('SELECT COUNT(*) AS n FROM products WHERE store_id = ?', storeId)).toEqual([{ n: 1 }])
    expect(h.db.query<{ status: string }>('SELECT status FROM telegram_product_batch_items ORDER BY position')).toEqual([{ status: 'published' }, { status: 'failed' }])
    expect(h.db.query<{ status: string }>('SELECT status FROM telegram_product_batches')).toEqual([{ status: 'partially_published' }])
  })

  it('handles an R2 failure per item and reports no false success', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('lost-r2', { caption: 'Billetera café, precio 50000, 2 unidades' }))
    await closeBatch(telegram)
    const key = h.db.query<{ temp_key: string }>('SELECT temp_key FROM telegram_product_batch_items')[0]!.temp_key
    await h.assets.delete(key)
    await confirmPublish(telegram)
    expect(h.db.query('SELECT COUNT(*) AS n FROM products WHERE store_id = ?', storeId)).toEqual([{ n: 0 }])
    expect(telegram.messages().join('\n')).toContain('Productos fallidos: 1')
    expect(telegram.messages().join('\n').toLowerCase()).toContain('no se informó éxito')
  })

  it('does not duplicate products when the publish confirmation is repeated', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('idempotent', { caption: 'Camisa blanca, precio 70000, 2 unidades' }))
    await closeBatch(telegram)
    await send(text('/publicar'))
    const confirm = callbackFor(telegram, /Confirmar/)
    await send(callbackUpdate(OWNER, confirm!))
    await send(callbackUpdate(OWNER, confirm!))
    expect(h.db.query('SELECT COUNT(*) AS n FROM products WHERE store_id = ?', storeId)).toEqual([{ n: 1 }])
    expect(h.db.query('SELECT COUNT(*) AS n FROM product_variants WHERE product_id = (SELECT id FROM products WHERE store_id = ?)', storeId)).toEqual([{ n: 1 }])
  })

  it('enforces the backend-configured batch maximum and the store plan capacity', async () => {
    h.env.TELEGRAM_BATCH_MAX_ITEMS = '4'
    await h.db.prepare('UPDATE plans SET max_products = 3 WHERE code = ?').bind('profesional').run()
    await h.db.prepare('INSERT INTO products (store_id, sku, name, price) VALUES (?, ?, ?, ?)').bind(storeId, 'EXIST-1', 'Existente', 100).run()
    const telegram = stubServices()
    await startBatch(telegram)
    expect(h.db.query<{ max_items: number }>('SELECT max_items FROM telegram_product_batches')).toEqual([{ max_items: 2 }])
    await send(photo('cap-1', { caption: 'A, precio 1, 1 unidad' }))
    await send(photo('cap-2', { caption: 'B, precio 1, 1 unidad' }))
    await send(photo('cap-3', { caption: 'C, precio 1, 1 unidad' }))
    expect(h.db.query('SELECT COUNT(*) AS n FROM telegram_product_batch_items')).toEqual([{ n: 2 }])
    expect(telegram.messages().at(-1)).toContain('límite de 2 productos')
  })

  it('respects plan capacity again at publish time if products were added after review', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('plan-change', { caption: 'Pantalón azul, precio 85000, 2 unidades' }))
    await send(photo('plan-change-2', { caption: 'Camisa verde, precio 65000, 3 unidades' }))
    await closeBatch(telegram)
    await h.db.prepare('UPDATE plans SET max_products = 2 WHERE code = ?').bind('profesional').run()
    await h.db.prepare('INSERT INTO products (store_id, sku, name, price) VALUES (?, ?, ?, ?)').bind(storeId, 'NEW-1', 'Otro producto', 100).run()
    await confirmPublish(telegram)
    expect(h.db.query('SELECT COUNT(*) AS n FROM products WHERE store_id = ?', storeId)).toEqual([{ n: 2 }])
    expect(h.db.query<{ status: string }>('SELECT status FROM telegram_product_batch_items ORDER BY position')).toEqual([{ status: 'published' }, { status: 'failed' }])
  })
})

describe('authorization, history, cancellation, credits, and isolation', () => {
  it('blocks a seller role from starting or publishing a batch', async () => {
    const seller = 78002
    await createStoreUser(h.db, { email: 'seller@lote.test', storeId, role: 'seller', telegramUserId: String(seller) })
    const telegram = stubServices()
    await send(text('/lote', seller))
    expect(h.db.query('SELECT COUNT(*) AS n FROM telegram_product_batches')).toEqual([{ n: 0 }])
    expect(telegram.messages().at(-1)).toContain('Tu rol no permite publicar productos')
  })

  it('cancels the lot and removes temporary files without touching existing products', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('cancel-photo'))
    const key = h.db.query<{ temp_key: string }>('SELECT temp_key FROM telegram_product_batch_items')[0]!.temp_key
    expect(h.assets.objects.has(key)).toBe(true)
    await send(text('/cancelar'))
    expect(h.db.query<{ status: string }>('SELECT status FROM telegram_product_batches')).toEqual([{ status: 'cancelled' }])
    expect(h.assets.objects.has(key)).toBe(false)
    expect(h.db.query('SELECT COUNT(*) AS n FROM products WHERE store_id = ?', storeId)).toEqual([{ n: 0 }])
  })

  it('serves tenant-scoped import history through the admin panel API', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('history-photo'))
    const owner = await createStoreUser(h.db, { email: 'panel@lote.test', storeId, role: 'owner' })
    const { userToken } = await import('../testing/harness')
    const token = await userToken(owner, 'panel@lote.test')
    const response = await h.request('/api/admin/telegram-imports', { token, store: 'lote-test' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ items: [{ photos: 1, pending: 1, published: 0 }] })
  })

  it('allows the authorized store admin to review and correct a batch and fetches only its own photo', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('web-review-photo'))
    const batchId = h.db.query<{ id: string }>('SELECT id FROM telegram_product_batches')[0]!.id
    const itemId = h.db.query<{ id: number }>('SELECT id FROM telegram_product_batch_items')[0]!.id
    const owner = await createStoreUser(h.db, { email: 'review@lote.test', storeId, role: 'owner' })
    const { userToken } = await import('../testing/harness')
    const token = await userToken(owner, 'review@lote.test')
    const before = await h.request(`/api/admin/telegram-imports/${batchId}`, { token, store: 'lote-test' })
    expect(await before.json()).toMatchObject({ items: [{ id: itemId, name: null, validationErrors: expect.arrayContaining(['Falta el nombre']) }] })
    const update = await h.request(`/api/admin/telegram-imports/${batchId}/items/${itemId}`, {
      method: 'PUT', token, store: 'lote-test', body: { name: 'Bolso de prueba', price: 90000, stock: 2, categoryName: 'Calzado', sku: 'BOLSO-TEST' },
    })
    expect(update.status).toBe(200)
    expect(await update.json()).toMatchObject({ items: [{ id: itemId, name: 'Bolso de prueba', price: 90000, stock: 2, status: 'ready_to_publish' }] })
    const image = await h.request(`/api/admin/telegram-imports/${batchId}/items/${itemId}/photo`, { token, store: 'lote-test' })
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(image.headers.get('cache-control')).toContain('no-store')
  })

  it('prevents a Telegram account without store membership from viewing another shop batch', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('private-photo'))
    const other = await seedStore(h.db, { slug: 'other-lote', name: 'Other Lote' })
    const otherOwner = 78003
    await createStoreUser(h.db, { email: 'other@lote.test', storeId: other, role: 'owner', telegramUserId: String(otherOwner) })
    await send(text('/publicar', otherOwner))
    expect(telegram.messages().at(-1)).toContain('No hay un lote pendiente')
  })

  it('keeps simultaneous batches and product images isolated by store', async () => {
    const other = await seedStore(h.db, { slug: 'other-batch', name: 'Other Batch' })
    await h.db.prepare('UPDATE stores SET telegram_bulk_import_enabled = 1 WHERE id = ?').bind(other).run()
    const otherOwner = 78004
    await createStoreUser(h.db, { email: 'other-owner@lote.test', storeId: other, role: 'owner', telegramUserId: String(otherOwner) })
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('store-a', { caption: 'Bolso uno, precio 30000, 1 unidad' }))
    await send(text('/lote', otherOwner))
    await send(photo('store-b', { caption: 'Bolso dos, precio 40000, 2 unidades', user: otherOwner }))
    const rows = h.db.query<{ store_id: number; name: string }>('SELECT store_id, name FROM telegram_product_batch_items ORDER BY id')
    expect(rows).toEqual([{ store_id: storeId, name: 'Bolso uno' }, { store_id: other, name: 'Bolso dos' }])
  })

  it('keeps durable batch photos through the scheduled temporary-asset cleanup', async () => {
    const telegram = stubServices()
    await startBatch(telegram)
    await send(photo('cleanup-safe'))
    const key = h.db.query<{ temp_key: string }>('SELECT temp_key FROM telegram_product_batch_items')[0]!.temp_key
    const { cleanupExpiredTelegramProductAssets } = await import('./telegramProductImages')
    await cleanupExpiredTelegramProductAssets(h.db, h.assets as unknown as R2Bucket)
    expect(h.assets.objects.has(key)).toBe(true)
  })

  it('does not analyze photos until the merchant explicitly confirms the estimate', async () => {
    h.env.GEMINI_API_KEY = 'test-key'
    const telegram = stubServices({ gemini: { name: 'Bolso artesanal', description: 'Bolso visible de color café con costuras decorativas.', category: 'Accesorios', colors: ['Café'], features: ['costuras visibles'], visibleBrand: '', confidence: 'alta', isProductPhoto: true } })
    await startBatch(telegram)
    await send(photo('ai-opt-in'))
    await closeBatch(telegram)
    await send(text('/sugerir'))
    expect(telegram.messages().at(-1)).toContain('Costo estimado')
    expect(telegram.calls.some((call) => call.url.includes('generativelanguage.googleapis.com'))).toBe(false)
    const confirm = callbackFor(telegram, /Analizar primeras 3/)
    expect(confirm).toMatch(/^tb:analyze:/)
    await send(callbackUpdate(OWNER, confirm!))
    expect(telegram.calls.some((call) => call.url.includes('generativelanguage.googleapis.com'))).toBe(true)
    const row = h.db.query<{ name: string; description: string; price: number | null; stock: number | null; status: string }>('SELECT name, description, price, stock, status FROM telegram_product_batch_items')[0]!
    expect(row).toMatchObject({ name: 'Bolso artesanal', price: null, stock: null, status: 'needs_review' })
  })

  it('keeps manual entry available when AI is disabled for the store', async () => {
    h.env.GEMINI_API_KEY = 'test-key'
    h.db.query('UPDATE stores SET ai_enabled = 0 WHERE id = ?', storeId)
    const telegram = stubServices({ gemini: {} })
    await startBatch(telegram)
    await send(photo('ai-disabled'))
    await closeBatch(telegram)
    await send(text('/sugerir'))
    expect(telegram.messages().at(-1)).toContain('desactivada')
    expect(telegram.calls.some((call) => call.url.includes('generativelanguage.googleapis.com'))).toBe(false)
  })

  it('does not call the AI when the estimated photo credits are unavailable', async () => {
    h.env.GEMINI_API_KEY = 'test-key'
    await h.db.prepare('INSERT INTO ai_credit_costs (feature, credits, enabled, updated_by) VALUES (?, ?, 1, ?)').bind('foto_a_producto', 2, 'test').run()
    const telegram = stubServices({ gemini: {} })
    await startBatch(telegram)
    await send(photo('ai-no-credit'))
    await closeBatch(telegram)
    await send(text('/sugerir'))
    expect(telegram.messages().at(-1)).toContain('costaría aproximadamente 2 créditos')
    expect(telegram.messages().at(-1)).toContain('completar el lote manualmente')
    expect(telegram.calls.some((call) => call.url.includes('generativelanguage.googleapis.com'))).toBe(false)
  })

  it('deduplicates a Telegram webhook retry before it creates another batch item', async () => {
    const telegram = stubServices()
    const message = { update_id: 789991, message: { message_id: 990, from: { id: OWNER, first_name: 'Walter' }, chat: { id: OWNER, type: 'private' }, date: 1, text: '/lote' } }
    const call = () => h.request('/api/telegram/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret' }, body: message })
    expect((await call()).status).toBe(200)
    expect(await (await call()).json()).toMatchObject({ duplicate: true })
    expect(h.db.query('SELECT COUNT(*) AS n FROM telegram_product_batches')).toEqual([{ n: 1 }])
    expect(telegram.messages().filter((message) => message.includes('Vamos a cargar varios productos'))).toHaveLength(1)
  })
})
