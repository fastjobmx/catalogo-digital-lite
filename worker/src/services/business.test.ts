import { describe, expect, it } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import { applyConfirmedCatalogMutation, createCatalogCategory, updateCatalogProduct, updateStoreConfiguration, updateVariantStocksById } from './business'

function makeDb(options: {
  first?: (sql: string, values: unknown[]) => unknown
  run?: (sql: string, values: unknown[]) => unknown
} = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const statement = (sql: string, values: unknown[] = []) => {
    const current = {
      bind: (...next: unknown[]) => statement(sql, next),
      first: async () => options.first?.(sql, values) ?? null,
      all: async () => ({ results: [] }),
      run: async () => {
        calls.push({ sql, values })
        return options.run?.(sql, values) ?? { meta: { changes: 1, last_row_id: 7 } }
      },
    }
    return current
  }
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: Array<{ run: () => Promise<unknown> }>) => Promise.all(statements.map((item) => item.run())),
  }
  return { db: db as unknown as D1Database, calls }
}

describe('business services shared by admin and action executor', () => {
  it('applies only allowlisted store fields and records the action', async () => {
    const { db, calls } = makeDb()
    await updateStoreConfiguration(db, { name: 'Nueva tienda', injected_sql: 'DROP TABLE products' }, { actor: 'admin@test', source: 'admin' })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.sql).toContain('name = ?')
    expect(calls[0]?.sql).not.toContain('injected_sql')
    expect(calls[0]?.values).toContain('Nueva tienda')
    expect(calls[1]?.sql).toContain('audit_log')
  })

  it('rejects a category slug conflict before inserting', async () => {
    const { db, calls } = makeDb({ first: () => ({ id: 2 }) })
    await expect(createCatalogCategory(db, { name: 'General', slug: 'general' }, { actor: 'bot:1', source: 'telegram' }))
      .rejects.toThrow('CATEGORY_SLUG_EXISTS')
    expect(calls).toHaveLength(0)
  })

  it('maps product updates through the fixed column allowlist', async () => {
    const { db, calls } = makeDb()
    await updateCatalogProduct(db, { id: 7 }, { price: 12500, imageUrls: ['/product.jpg'], arbitrary: 'ignored' }, { actor: 'admin@test', source: 'admin' })

    expect(calls[0]?.sql).toContain('price = ?')
    expect(calls[0]?.sql).toContain('image_urls = ?')
    expect(calls[0]?.sql).not.toContain('arbitrary')
    expect(calls[0]?.values).toContain('["/product.jpg"]')
    expect(calls[1]?.sql).toContain('audit_log')
  })

  it('rejects negative inventory before issuing a database update', async () => {
    const { db, calls } = makeDb()
    await expect(updateVariantStocksById(db, [{ id: 3, stock: -1 }], { actor: 'bot:1', source: 'telegram' }))
      .rejects.toThrow('INVALID_STOCK')
    expect(calls).toHaveLength(0)
  })
})

function makeAtomicDb(options: { claimChanges?: number; failBatch?: boolean } = {}) {
  const batches: Array<Array<{ sql: string; values: unknown[] }>> = []
  const db = {
    prepare(sql: string) {
      let values: unknown[] = []
      return {
        bind(...next: unknown[]) { values = next; return this },
        async first() { return { status: 'stale' } },
        async run() { return { meta: { changes: 1 } } },
        sql,
        get values() { return values },
      }
    },
    async batch(statements: Array<{ sql: string; values: unknown[] }>) {
      batches.push(statements.map((item) => ({ sql: item.sql, values: item.values })))
      if (options.failBatch) throw new Error('audit insert failed')
      return statements.map((_, index) => ({ meta: { changes: index === 0 ? (options.claimChanges ?? 1) : 1 } }))
    },
  }
  return { db: db as unknown as D1Database, batches }
}

const operationSnapshot = {
  sku: 'KINETIK-05', name: 'Kinetik 05', price: 100000, description: '', brand: null,
  category_id: null, is_featured: 0, is_active: 1, is_archived: 0,
  variants: JSON.stringify([{ id: 12, sku: 'KINETIK-05-38', size: '38', stock: 4 }]),
}

describe('atomic confirmed catalog mutations', () => {
  it('batches conditional claim, price update, audit, and completion as one D1 transaction', async () => {
    const { db, batches } = makeAtomicDb()
    const beforeJson = JSON.stringify(operationSnapshot)
    const status = await applyConfirmedCatalogMutation(db, {
      operationId: 'op-1', chatId: '123', actor: 'telegram:123', action: 'update_price',
      params: { sku: 'KINETIK-05', price: 125000 }, before: operationSnapshot, beforeJson,
      after: { ...operationSnapshot, price: 125000 },
    })
    expect(status).toBe('applied')
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(4)
    expect(batches[0]?.[0]?.sql).toContain("status = 'applying'")
    expect(batches[0]?.[1]?.sql).toContain('UPDATE products SET price = ?')
    expect(batches[0]?.[2]?.sql).toContain('INSERT INTO audit_log')
    expect(batches[0]?.[3]?.sql).toContain("status = 'applied'")
    expect(batches[0]?.[0]?.sql).toContain('p.price IS ?')
  })

  it('does not run a stale or concurrently claimed operation', async () => {
    const { db, batches } = makeAtomicDb({ claimChanges: 0 })
    const status = await applyConfirmedCatalogMutation(db, {
      operationId: 'op-2', chatId: '123', actor: 'telegram:123', action: 'update_stock',
      params: { sku: 'KINETIK-05', size: '38', stock: 5 }, before: operationSnapshot,
      beforeJson: JSON.stringify(operationSnapshot), after: { stock: 5 },
    })
    expect(status).toBe('stale')
    expect(batches).toHaveLength(1)
    expect(batches[0]?.[1]?.sql).toContain('UPDATE product_variants SET stock = ?')
    expect(batches[0]?.[1]?.values).toContain(12)
    expect(batches[0]?.[1]?.sql).toContain('execution_token = ?')
  })

  it('surfaces audit failure so D1 batch can roll back the entire operation', async () => {
    const { db, batches } = makeAtomicDb({ failBatch: true })
    await expect(applyConfirmedCatalogMutation(db, {
      operationId: 'op-3', chatId: '123', actor: 'telegram:123', action: 'update_price',
      params: { sku: 'KINETIK-05', price: 125000 }, before: operationSnapshot,
      beforeJson: JSON.stringify(operationSnapshot), after: { price: 125000 },
    })).rejects.toThrow('audit insert failed')
    expect(batches[0]).toHaveLength(4)
  })
})
