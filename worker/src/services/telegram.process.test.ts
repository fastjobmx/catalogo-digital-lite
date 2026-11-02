import { afterEach, describe, expect, it, vi } from 'vitest'
import { processTelegramUpdate, type TelegramUpdate } from './telegram'

afterEach(() => vi.unstubAllGlobals())

const ownerId = 12345
const env = {
  TELEGRAM_BOT_TOKEN: 'mock-bot-token',
  TELEGRAM_OWNER_ID: String(ownerId),
} as never

function telegramFetch() {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

function makeDb(options: {
  inventory?: Array<Record<string, unknown>>
  pending?: Record<string, unknown> | null
  cancelPending?: boolean
} = {}) {
  const batches: Array<Array<{ sql: string; values: unknown[] }>> = []
  const sqlCalls: Array<{ sql: string; values: unknown[] }> = []
  const db = {
    prepare(sql: string) {
      const statement = {
        sql,
        values: [] as unknown[],
        bind(...values: unknown[]) { this.values = values; return this },
        async first() {
          sqlCalls.push({ sql, values: this.values })
          if (sql.includes('SELECT telegram_owner_id')) return { telegram_owner_id: null }
          if (sql.includes('SELECT * FROM telegram_operations')) return options.pending || null
          if (sql.includes("SET status = 'cancelled'")) return options.cancelPending ? { operation_id: 'pending-1' } : null
          return null
        },
        async all() {
          sqlCalls.push({ sql, values: this.values })
          return { results: options.inventory || [] }
        },
        async run() {
          sqlCalls.push({ sql, values: this.values })
          return { meta: { changes: 1 } }
        },
      }
      return statement
    },
    async batch(statements: Array<{ sql: string; values: unknown[] }>) {
      batches.push(statements.map((statement) => ({ sql: statement.sql, values: statement.values })))
      return statements.map(() => ({ meta: { changes: 1 } }))
    },
  }
  return { db: db as unknown as D1Database, batches, sqlCalls }
}

function update(text: string, userId = ownerId): TelegramUpdate {
  return {
    update_id: 401,
    message: {
      message_id: 1,
      from: { id: userId, first_name: 'Test Owner' },
      chat: { id: userId, type: 'private' },
      date: 1,
      text,
    },
  }
}

describe('Telegram owner update processing', () => {
  it('/start responds for the numeric owner', async () => {
    const fetcher = telegramFetch()
    const { db } = makeDb()
    await processTelegramUpdate(update('/start'), env, db)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(body.text).toContain('/ayuda')
  })

  it('labels staging replies as the fictional test catalog', async () => {
    const fetcher = telegramFetch()
    const { db } = makeDb()
    await processTelegramUpdate(update('/start'), {
      TELEGRAM_BOT_TOKEN: 'mock-bot-token',
      TELEGRAM_OWNER_ID: String(ownerId),
      TELEGRAM_ENV_LABEL: 'STAGING - CATALOGO FICTICIO',
    } as never, db)
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(body.text).toContain('STAGING - CATALOGO FICTICIO')
  })

  it('serves /ayuda and /estado to the numeric owner', async () => {
    const fetcher = telegramFetch()
    const { db } = makeDb()
    await processTelegramUpdate(update('/ayuda'), env, db)
    await processTelegramUpdate({ ...update('/estado'), update_id: 402 }, env, db)
    const responses = fetcher.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).text)
    expect(responses[0]).toContain('Ayuda')
    expect(responses[1]).toContain('Productos activos')
  })

  it('rejects a different numeric user before sending or processing a message', async () => {
    const fetcher = telegramFetch()
    const { db, sqlCalls } = makeDb()
    await processTelegramUpdate(update('/start', 999), env, db)
    expect(fetcher).not.toHaveBeenCalled()
    expect(sqlCalls.some(({ sql }) => sql.includes('SELECT telegram_owner_id'))).toBe(true)
  })

  it('answers a stock lookup using the current inventory executor', async () => {
    const fetcher = telegramFetch()
    const { db, sqlCalls } = makeDb({ inventory: [{ product_sku: 'TEST-TRN-001', size: '38', stock: 4 }] })
    await processTelegramUpdate(update('consulta inventario'), env, db)
    expect(sqlCalls.some(({ sql, values }) => sql.includes('FROM product_variants') && values.length === 2)).toBe(true)
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(body.text).toContain('TEST-TRN-001')
    expect(body.text).toContain('"stock": 4')
  })

  it('cancels the owner’s pending operation', async () => {
    const fetcher = telegramFetch()
    const { db, sqlCalls } = makeDb({ cancelPending: true })
    await processTelegramUpdate(update('/cancelar'), env, db)
    expect(sqlCalls.some(({ sql }) => sql.includes("SET status = 'cancelled'"))).toBe(true)
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).text).toBe('Propuesta cancelada. No se realizó ningún cambio.')
  })

  it('explains /cancelar does not roll back an already executed operation', async () => {
    const fetcher = telegramFetch()
    const { db } = makeDb({ cancelPending: false })
    await processTelegramUpdate(update('/cancelar'), env, db)
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).text).toContain('/cancelar no lo revierte')
  })

  it('refuses non-atomic mutations before creating a pending operation', async () => {
    const fetcher = telegramFetch()
    const { db, sqlCalls } = makeDb()
    await processTelegramUpdate(update('{"action":"update_store_name","params":{"name":"No tocar"}}'), env, db)
    expect(sqlCalls.some(({ sql }) => sql.includes('INSERT INTO telegram_operations'))).toBe(false)
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).text).toContain('aún no está habilitada')
  })

  it('does not create a mutation when Gemini fails', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('Gemini network failure'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })))
    vi.stubGlobal('fetch', fetcher)
    const { db, batches, sqlCalls } = makeDb()
    await processTelegramUpdate(update('¿Puedes ayudarme con esta consulta especial?'), {
      TELEGRAM_BOT_TOKEN: 'mock-bot-token',
      TELEGRAM_OWNER_ID: String(ownerId),
      GEMINI_API_KEY: 'mock-key',
      GEMINI_MODEL: 'test-model',
      TELEGRAM_ENV_LABEL: 'STAGING - CATALOGO FICTICIO',
    } as never, db)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(batches).toHaveLength(0)
    expect(sqlCalls.some(({ sql }) => sql.includes('INSERT INTO telegram_operations'))).toBe(false)
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).text).toContain('Gemini rechazó la solicitud')
  })

  it('confirms stock through one batch containing claim, mutation, audit and completion', async () => {
    const fetcher = telegramFetch()
    const before = {
      sku: 'TEST-TRN-001', name: 'Tenis de prueba', price: 100000, description: 'Producto ficticio',
      brand: 'Marca Demo', category_id: 1, is_featured: 0, is_active: 1, is_archived: 0,
      variants: JSON.stringify([{ id: 1, sku: 'TEST-TRN-001-38', size: '38', stock: 4 }]),
    }
    const pending = {
      operation_id: 'pending-test', action: 'update_stock', params_json: JSON.stringify({ sku: 'TEST-TRN-001', size: '38', stock: 6 }),
      before_json: JSON.stringify(before), after_json: JSON.stringify({ ...before, variants: JSON.stringify([{ id: 1, sku: 'TEST-TRN-001-38', size: '38', stock: 6 }]) }),
    }
    const { db, batches } = makeDb({ pending })
    await processTelegramUpdate(update('sí'), env, db)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(4)
    expect(batches[0]?.map(({ sql }) => sql).join('\n')).toContain('INSERT INTO audit_log')
    expect(batches[0]?.[1]?.sql).toContain('UPDATE product_variants SET stock = ?')
    const reply = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).text
    expect(reply).toContain('Stock actualizado')
    expect(reply).toContain('no revierte cambios ejecutados')
  })

  it('transcribes an authorized OGG voice message through the same read-only proposal flow', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { file_path: 'voice/test.oga', file_size: 4 } })))
      .mockResolvedValueOnce(new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), { headers: { 'content-type': 'audio/ogg' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          action: 'get_inventory', params: { sku: 'TEST-TRN-001' }, missing: [],
          summary: 'Consultar inventario de prueba', transcript: 'Consulta el inventario de prueba',
        }) }] } }],
      })))
      .mockImplementation(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })))
    vi.stubGlobal('fetch', fetcher)
    const { db } = makeDb({ inventory: [{ product_sku: 'TEST-TRN-001', size: '38', stock: 4 }] })
    const voiceUpdate: TelegramUpdate = {
      update_id: 402,
      message: {
        message_id: 2,
        from: { id: ownerId, first_name: 'Test Owner' },
        chat: { id: ownerId, type: 'private' },
        date: 1,
        voice: { file_id: 'fake-telegram-file-id', duration: 5 },
      },
    }
    const voiceEnv = {
      TELEGRAM_BOT_TOKEN: 'mock-bot-token',
      TELEGRAM_OWNER_ID: String(ownerId),
      GEMINI_API_KEY: 'mock-gemini-key',
      GEMINI_MODEL: 'test-model',
    } as never
    await processTelegramUpdate(voiceUpdate, voiceEnv, db)
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('https://api.telegram.org/file/')
    expect(JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body)).text).toContain('Transcripción:')
    expect(JSON.parse(String(fetcher.mock.calls[4]?.[1]?.body)).text).toContain('TEST-TRN-001')
  })
})
