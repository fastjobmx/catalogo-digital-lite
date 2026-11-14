/** Los tres interruptores de la capa conversacional (texto, multimedia y pedidos) son independientes: cada uno
 * enciende solo su parte y, apagado, deja esa parte en el flujo anterior, en las ocho combinaciones. También por
 * tienda: una tienda fuera de la lista no cambia aunque otra esté encendida. Sin IA. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHarness, createStoreUser, photoUpdate, seedCatalog, seedStore, stubTelegram, textUpdate } from '../../../testing/harness'
import { processTelegramUpdate } from '../../telegram'

const OWNER = 9951
const OTHER = 9952

async function probe(switches: { text: string; media: string; orders: string }, user = OWNER) {
  const h = createHarness({
    TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_WEBHOOK_SECRET: 'webhook-secret', GEMINI_API_KEY: '',
    ASSISTANT_AGENT_STORE_IDS: switches.text, ASSISTANT_MEDIA_STORE_IDS: switches.media, ASSISTANT_ORDERS_STORE_IDS: switches.orders,
  })
  const tienda = await seedStore(h.db, { slug: 'interruptores', name: 'Interruptores', status: 'active' })
  const otra = await seedStore(h.db, { slug: 'vecina', name: 'Vecina', status: 'active' })
  h.db.query('INSERT INTO store_onboarding_legacy_stores (store_id) VALUES (?), (?)', tienda, otra)
  await createStoreUser(h.db, { email: 'ana@interruptores.test', storeId: tienda, role: 'owner', telegramUserId: String(OWNER) })
  await createStoreUser(h.db, { email: 'berta@vecina.test', storeId: otra, role: 'owner', telegramUserId: String(OTHER) })
  for (const store of [tienda, otra]) {
    await seedCatalog(h.db, store, { products: [{ sku: 'SAN-1', name: 'Sandalias Guess', price: 80000, variants: [{ size: '38', color: 'Negro', stock: 1 }, { size: '39', color: 'Negro', stock: 2 }] }] })
    h.db.query(`INSERT INTO orders (store_id, display_id, items_json, subtotal, total, status) VALUES (?, ?, '[]', 80000, 80000, 'pendiente')`, store, `PED-20261113-AB12CD${store}0`)
  }
  const telegram = stubTelegram()
  const ask = async (update: unknown) => {
    const from = telegram.messages().length
    await processTelegramUpdate(update as never, h.env, h.db)
    return telegram.messages().slice(from).join('\n').replace(/<[^>]+>/g, '')
  }
  const result = {
    text: await ask(textUpdate(user, 'cuántos quedan de las sandalias')),
    orders: await ask(textUpdate(user, 'cómo van los pedidos')),
    media: await ask(photoUpdate(user, 'foto-interruptores-1')),
    tienda, otra,
  }
  vi.unstubAllGlobals()
  return result
}

const NEW = { text: /Sandalias Guess · \$80\.000 COP/, orders: /Pedidos en curso: 1 pendiente de confirmar/, media: /Recibí la foto\. Si son varias/ }
const OLD = { text: /📦 Sandalias Guess \(SAN-1\)/, orders: /Resumen de pedidos · últimos 30 días/, media: /¿Qué hago con ella\?/ }

afterEach(() => vi.unstubAllGlobals())

describe('interruptores independientes de texto, multimedia y pedidos', () => {
  const combos = [0, 1, 2, 3, 4, 5, 6, 7].map((bits) => ({ text: Boolean(bits & 1), media: Boolean(bits & 2), orders: Boolean(bits & 4) }))
  it.each(combos)('texto=$text · multimedia=$media · pedidos=$orders', async (combo) => {
    const answers = await probe({ text: combo.text ? '*' : '', media: combo.media ? '*' : '', orders: combo.orders ? '*' : '' })
    for (const part of ['text', 'media', 'orders'] as const) {
      expect(answers[part], `${part} ${combo[part] ? 'encendido' : 'apagado'}`).toMatch(combo[part] ? NEW[part] : OLD[part])
      expect(answers[part]).not.toMatch(combo[part] ? OLD[part] : NEW[part])
    }
  })

  it('por tienda: con la lista en otra tienda, esta sigue completa en el flujo anterior', async () => {
    // In a fresh database the two seeded stores get ids 2 and 3 (1 is the legacy store): only the neighbour is listed.
    const mine = await probe({ text: '3', media: '3', orders: '3' })
    expect([mine.tienda, mine.otra]).toEqual([2, 3])
    for (const part of ['text', 'media', 'orders'] as const) expect(mine[part]).toMatch(OLD[part])
    const theirs = await probe({ text: '3', media: '3', orders: '3' }, OTHER)
    for (const part of ['text', 'media', 'orders'] as const) expect(theirs[part]).toMatch(NEW[part])
  })

  it('sin ninguna variable (como está producción hoy) todo responde el flujo anterior', async () => {
    const answers = await probe({ text: '', media: '', orders: '' })
    for (const part of ['text', 'media', 'orders'] as const) expect(answers[part]).toMatch(OLD[part])
  })
})
