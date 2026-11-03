import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase } from '../../test/sqliteD1'
import { seedCatalog, seedStore } from '../testing/harness'
import {
  applyConfirmedCatalogMutation, applyConfirmedProductEdit, applyConfirmedStoreMutation, applyConfirmedTelegramProductCreation,
  createCatalogCategory, createCatalogProduct, updateCatalogProduct, updateStoreConfiguration, updateVariantStocksById,
} from './business'

type Db = ReturnType<typeof createTestDatabase>
let db: Db
let otherStore: number

const SNAPSHOT_SQL = `SELECT p.sku, p.name, p.price, p.description, p.brand, p.category_id, p.is_featured, p.is_active, p.is_archived,
  (SELECT json_group_array(json_object('id', v.id, 'sku', v.sku, 'size', v.size, 'stock', v.stock)) FROM (SELECT * FROM product_variants WHERE product_id = p.id ORDER BY id) v) AS variants
  FROM products p WHERE p.store_id = ? AND p.sku = ?`

function snapshot(storeId: number, sku: string): Record<string, unknown> {
  return db.query(SNAPSHOT_SQL, storeId, sku)[0]!
}

function pendingOperation(operationId: string, storeId: number, action: string, params: unknown, before: unknown, after: unknown = {}) {
  db.query(`INSERT INTO telegram_operations (operation_id, update_id, chat_id, store_id, action, params_json, before_json, after_json, expires_at)
    VALUES (?, ?, '123', ?, ?, ?, ?, ?, unixepoch() + 900)`, operationId, Math.floor(Math.random() * 1e9), storeId, action, JSON.stringify(params), JSON.stringify(before), JSON.stringify(after))
}

beforeEach(async () => {
  db = createTestDatabase()
  otherStore = await seedStore(db, { slug: 'otra-tienda', name: 'Otra Tienda' })
  await seedCatalog(db, 1, { categories: [{ name: 'Running', slug: 'running' }], products: [{ sku: 'DEMO-001', name: 'Demo', price: 250000, category: 'running', variants: [{ size: '38', color: 'Negro', stock: 2 }, { size: '39', color: 'Negro', stock: 3 }] }] })
  await seedCatalog(db, otherStore, { categories: [{ name: 'Running', slug: 'running' }], products: [{ sku: 'DEMO-001', name: 'Producto ajeno', price: 10, category: 'running' }] })
})

const ctx = (storeId = 1) => ({ actor: 'tester', source: 'admin' as const, storeId })

describe('business services shared by admin, Telegram and the platform', () => {
  it('applies product name edits atomically with audit and preserves price, variants and the other store', async () => {
    const before = snapshot(1, 'DEMO-001')
    pendingOperation('op-edit-1', 1, 'update_product', { sku: 'DEMO-001', name: 'Nuevo nombre' }, before)
    const status = await applyConfirmedProductEdit(db, { operationId: 'op-edit-1', chatId: '123', storeId: 1, actor: 'telegram:123', sku: 'DEMO-001', fields: { name: 'Nuevo nombre' }, before, beforeJson: JSON.stringify(before), after: { ...before, name: 'Nuevo nombre' } })
    expect(status).toBe('applied')
    expect(snapshot(1, 'DEMO-001')).toMatchObject({ name: 'Nuevo nombre', price: 250000 })
    expect(snapshot(otherStore, 'DEMO-001')).toMatchObject({ name: 'Producto ajeno', price: 10 })
    expect(db.query("SELECT store_id FROM audit_log WHERE action = 'product_updated'")).toEqual([{ store_id: 1 }])
    expect(db.query("SELECT status FROM telegram_operations WHERE operation_id = 'op-edit-1'")).toEqual([{ status: 'applied' }])
  })

  it('does not report a concurrent product edit as applied', async () => {
    const before = snapshot(1, 'DEMO-001')
    pendingOperation('op-edit-2', 1, 'update_product', { sku: 'DEMO-001', name: 'New' }, before)
    db.query("UPDATE products SET price = 1 WHERE store_id = 1 AND sku = 'DEMO-001'")
    expect(await applyConfirmedProductEdit(db, { operationId: 'op-edit-2', chatId: '123', storeId: 1, actor: 'telegram:123', sku: 'DEMO-001', fields: { name: 'New' }, before, beforeJson: JSON.stringify(before), after: { ...before, name: 'New' } })).toBe('stale')
    expect(snapshot(1, 'DEMO-001')).toMatchObject({ name: 'Demo' })
  })

  it('cannot confirm an operation recorded for another store', async () => {
    const before = snapshot(1, 'DEMO-001')
    pendingOperation('op-cross', otherStore, 'update_price', { sku: 'DEMO-001', price: 5 }, before)
    const status = await applyConfirmedCatalogMutation(db, { operationId: 'op-cross', chatId: '123', storeId: 1, actor: 'x', action: 'update_price', params: { sku: 'DEMO-001', price: 5 }, before, beforeJson: JSON.stringify(before), after: { ...before, price: 5 } })
    expect(status).not.toBe('applied')
    expect(snapshot(1, 'DEMO-001')).toMatchObject({ price: 250000 })
  })

  it('applies only allowlisted store fields to the current store and keeps the registry name in sync', async () => {
    const updated = await updateStoreConfiguration(db, { name: 'Renombrada', telegram_owner_id: '999', primary_color: '#123456' }, ctx(otherStore))
    expect(updated).toBe(2)
    expect(db.query('SELECT name, primary_color, telegram_owner_id FROM store_config WHERE id = ?', otherStore)).toEqual([{ name: 'Renombrada', primary_color: '#123456', telegram_owner_id: null }])
    expect(db.query('SELECT name FROM stores WHERE id = ?', otherStore)).toEqual([{ name: 'Renombrada' }])
    expect(db.query('SELECT name FROM store_config WHERE id = 1')).toEqual([{ name: 'SneakerHub Test' }])
  })

  it('rejects a category slug conflict only inside the same store', async () => {
    await expect(createCatalogCategory(db, { name: 'Running 2', slug: 'running' }, ctx(1))).rejects.toThrow('CATEGORY_SLUG_EXISTS')
    await expect(createCatalogCategory(db, { name: 'Nueva', slug: 'nueva' }, ctx(otherStore))).resolves.toMatchObject({ slug: 'nueva' })
  })

  it('allows the same SKU in two stores but never twice in one store', async () => {
    await expect(createCatalogProduct(db, { sku: 'DEMO-001', name: 'Dup', price: 1 }, ctx(1))).rejects.toThrow('SKU_ALREADY_EXISTS')
    const third = await seedStore(db, { slug: 'tercera', name: 'Tercera' })
    await expect(createCatalogProduct(db, { sku: 'DEMO-001', name: 'Propio', price: 1, variants: [{ stock: 1 }] }, ctx(third))).resolves.toMatchObject({ sku: 'DEMO-001' })
  })

  it('refuses categories that belong to another store', async () => {
    const foreignCategory = db.query<{ id: number }>('SELECT id FROM categories WHERE store_id = ?', otherStore)[0]!.id
    await expect(createCatalogProduct(db, { sku: 'NEW-1', name: 'X', price: 1, categoryId: foreignCategory }, ctx(1))).rejects.toThrow('CATEGORY_NOT_FOUND')
    await expect(updateCatalogProduct(db, { sku: 'DEMO-001' }, { categoryId: foreignCategory }, ctx(1))).rejects.toThrow('CATEGORY_NOT_FOUND')
  })

  it('maps product updates through the fixed column allowlist and the current store only', async () => {
    expect(await updateCatalogProduct(db, { sku: 'DEMO-001' }, { name: 'Ok', store_id: 2, sku: 'HACK' }, ctx(1))).toBe(true)
    expect(snapshot(1, 'DEMO-001')).toMatchObject({ name: 'Ok' })
    expect(await updateCatalogProduct(db, { sku: 'NO-EXISTE' }, { name: 'x' }, ctx(1))).toBe(false)
  })

  it('rejects negative inventory and never updates variants of another store', async () => {
    await expect(updateVariantStocksById(db, [{ id: 1, stock: -1 }], ctx(1))).rejects.toThrow('INVALID_STOCK')
    const foreignVariant = db.query<{ id: number }>('SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.store_id = ?', otherStore)[0]!.id
    expect(await updateVariantStocksById(db, [{ id: foreignVariant, stock: 99 }], ctx(1))).toBe(0)
    expect(db.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = ?', foreignVariant)[0]!.stock).toBe(5)
  })
})

describe('atomic confirmed catalog mutations', () => {
  it('applies claim, price update, audit and completion together', async () => {
    const before = snapshot(1, 'DEMO-001')
    pendingOperation('op-price', 1, 'update_price', { sku: 'DEMO-001', price: 180000 }, before)
    expect(await applyConfirmedCatalogMutation(db, { operationId: 'op-price', chatId: '123', storeId: 1, actor: 'x', action: 'update_price', params: { sku: 'DEMO-001', price: 180000 }, before, beforeJson: JSON.stringify(before), after: { ...before, price: 180000 } })).toBe('applied')
    expect(snapshot(1, 'DEMO-001')).toMatchObject({ price: 180000 })
    // A second confirmation of the same operation never applies twice.
    expect(await applyConfirmedCatalogMutation(db, { operationId: 'op-price', chatId: '123', storeId: 1, actor: 'x', action: 'update_price', params: { sku: 'DEMO-001', price: 1 }, before, beforeJson: JSON.stringify(before), after: {} })).toBe('not_pending')
    expect(snapshot(1, 'DEMO-001')).toMatchObject({ price: 180000 })
  })

  it('rolls back the whole operation when the audit insert fails', async () => {
    const before = snapshot(1, 'DEMO-001')
    pendingOperation('op-stock', 1, 'update_stock', { sku: 'DEMO-001', size: '38', stock: 9 }, before)
    db.sqlite.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END;`)
    await expect(applyConfirmedCatalogMutation(db, { operationId: 'op-stock', chatId: '123', storeId: 1, actor: 'x', action: 'update_stock', params: { sku: 'DEMO-001', size: '38', stock: 9 }, before, beforeJson: JSON.stringify(before), after: {} })).rejects.toThrow(/audit down/)
    expect(db.query("SELECT stock FROM product_variants WHERE sku = 'DEMO-001-38'")).toEqual([{ stock: 2 }])
    expect(db.query("SELECT status FROM telegram_operations WHERE operation_id = 'op-stock'")).toEqual([{ status: 'pending' }])
  })
})

describe('atomic Telegram product publication', () => {
  const category = () => db.query<{ id: number; name: string; slug: string }>('SELECT id, name, slug FROM categories WHERE store_id = 1')[0]!
  const product = (sku = 'TG-001') => ({ sku, name: 'Telegram', description: 'Desde Telegram', price: 99000, categoryId: category().id, imageUrls: ['/api/assets/stores/1/products/telegram/x/1.jpg'], variants: [{ sku: `${sku}-1`, size: '40', color: 'Negro', stock: 2 }] })

  it('creates product, variants, audit and marks the operation applied in one batch', async () => {
    pendingOperation('op-create', 1, 'create_product', { draft: 1 }, {}, {})
    const status = await applyConfirmedTelegramProductCreation(db, { operationId: 'op-create', chatId: '123', storeId: 1, actor: 'x', paramsJson: JSON.stringify({ draft: 1 }), beforeJson: '{}', afterJson: '{}', category: category(), product: product() })
    expect(status).toBe('applied')
    expect(db.query("SELECT store_id, sku FROM products WHERE sku = 'TG-001'")).toEqual([{ store_id: 1, sku: 'TG-001' }])
    expect(db.query("SELECT COUNT(*) AS n FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.sku = 'TG-001'")).toEqual([{ n: 1 }])
  })

  it('does not insert when the pending operation was cancelled', async () => {
    pendingOperation('op-cancelled', 1, 'create_product', { draft: 2 }, {}, {})
    db.query("UPDATE telegram_operations SET status = 'cancelled' WHERE operation_id = 'op-cancelled'")
    const status = await applyConfirmedTelegramProductCreation(db, { operationId: 'op-cancelled', chatId: '123', storeId: 1, actor: 'x', paramsJson: JSON.stringify({ draft: 2 }), beforeJson: '{}', afterJson: '{}', category: category(), product: product('TG-002') })
    expect(status).toBe('not_pending')
    expect(db.query("SELECT id FROM products WHERE sku = 'TG-002'")).toEqual([])
  })
})

describe('atomic confirmed store mutations', () => {
  it('updates allowlisted fields of the operation store and rejects stale snapshots', async () => {
    const before = { name: 'SneakerHub Test' }
    pendingOperation('op-store', 1, 'update_store_name', { name: 'EROS SHOP' }, before)
    expect(await applyConfirmedStoreMutation(db, { operationId: 'op-store', chatId: '123', storeId: 1, actor: 'x', before, beforeJson: JSON.stringify(before), after: { name: 'EROS SHOP' }, fields: { name: 'EROS SHOP' } })).toBe('applied')
    expect(db.query('SELECT name FROM store_config WHERE id = 1')).toEqual([{ name: 'EROS SHOP' }])
    expect(db.query('SELECT name FROM stores WHERE id = 1')).toEqual([{ name: 'EROS SHOP' }])
    expect(db.query('SELECT name FROM store_config WHERE id = ?', otherStore)).toEqual([{ name: 'Otra Tienda' }])

    pendingOperation('op-stale', 1, 'update_store_name', { name: 'Otro' }, before)
    expect(await applyConfirmedStoreMutation(db, { operationId: 'op-stale', chatId: '123', storeId: 1, actor: 'x', before, beforeJson: JSON.stringify(before), after: { name: 'Otro' }, fields: { name: 'Otro' } })).toBe('stale')
    await expect(applyConfirmedStoreMutation(db, { operationId: 'op-x', chatId: '123', storeId: 1, actor: 'x', before: { name: 'a' }, beforeJson: '{}', after: {}, fields: { telegram_owner_id: '1' } })).rejects.toThrow('INVALID_STORE_MUTATION_FIELDS')
  })
})
