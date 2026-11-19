// «Administra hablando.» A bento: the price change shown large (the private chat and what it changes in
// the store, as an open book) and one card per other operation. Operations verified in the production
// assistant (worker/src/services/assistant, worker/src/whatsapp/processor.ts):
//  - price change → summary with Confirmar / Corregir / Cancelar (WHATSAPP_HELP_TEXT example);
//  - stock entry («llegaron 10 pares…») → inventory.ts detectStockMovement → proposeStockMovement;
//  - product from a photo → draft reviewed before saving (WHATSAPP_HELP_TEXT: photo → product);
//  - pending orders → intents.ts get_pending_orders (a query: it changes nothing).
// Roles per operation from ROLE_HELP (worker/src/services/assistant/team.ts); no plan is said to include
// several users. Stock figures and order codes are examples and say so. Not stated: availability of any
// channel; shipping labels on WhatsApp (verified only on Telegram).
import type { ReactNode } from 'react'
import { formatCOP, products } from '../content/media'
import { Icon, type IconName } from '../components/ui/Icon'
import { Heading, Section, type, wrap } from './ui'

const bySku = (sku: string) => products.find((p) => p.sku === sku) ?? products[0]
const nord = bySku('NORD-02')
const NEW_PRICE = nord.price - 20_000

type OpKey = 'precios' | 'existencias' | 'productos' | 'pedidos'
type Op = { key: OpKey; area: string; icon: IconName; ask: string; kind: 'cambio' | 'consulta'; roles: string; result: string; note?: string }

const OPS: Op[] = [
  { key: 'precios', area: 'Precios', icon: 'tag', ask: `Cambia el precio del ${nord.sku} a ${formatCOP(NEW_PRICE).replace('$ ', '')}`, kind: 'cambio', roles: 'Propietario y Administrador', result: 'En tu tienda, al confirmar' },
  { key: 'existencias', area: 'Existencias', icon: 'box', ask: `Llegaron 10 pares del ${nord.sku} en talla 42`, kind: 'cambio', roles: 'Propietario, Administrador, Operador y Encargado de inventario', result: 'Existencias, al confirmar', note: 'Existencias de ejemplo.' },
  { key: 'productos', area: 'Productos', icon: 'camera', ask: `Agrega este producto a ${formatCOP(nord.price).replace('$ ', '')}`, kind: 'cambio', roles: 'Propietario y Administrador', result: 'Tu catálogo, con el borrador' },
  { key: 'pedidos', area: 'Pedidos', icon: 'chat', ask: '¿Qué pedidos tengo pendientes?', kind: 'consulta', roles: 'Propietario, Administrador, Operador y Vendedor', result: 'Pedidos por atender', note: 'Pedidos de ejemplo.' },
]

const TITLES: Record<OpKey, string> = { precios: 'Cambia un precio', existencias: 'Carga existencias', productos: 'Crea un producto desde una foto', pedidos: 'Consulta tus pedidos' }

const ORDERS = [{ code: 'PED-20261111-7F3A92C1', p: bySku('KINETIK-06') }, { code: 'PED-20261111-2C8D41E0', p: bySku('ASTRAL-03') }]

const GUARANTEES: { icon: IconName; text: string }[] = [
  { icon: 'shield', text: 'Solo responde a cuentas vinculadas con un código de un solo uso.' },
  { icon: 'check', text: 'Nada se guarda sin tu confirmación.' },
  { icon: 'users', text: 'Cada usuario autorizado ve solo lo que su rol permite.' },
]

function Actions() {
  return (
    <span className="mt-3 flex flex-wrap gap-1.5" aria-hidden="true">
      {['Confirmar', 'Corregir', 'Cancelar'].map((b, n) => <span key={b} className={`rounded-lg px-3 py-1.5 text-[0.8125rem] font-semibold ${n === 0 ? 'bg-(--v2-lime) text-[#0b0c10]' : 'bg-[#1f222b] text-[#c9ccd3]'}`}>{b}</span>)}
    </span>
  )
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return <div className="flex justify-between gap-4 py-1.5"><dt className="text-[#9a9fa9]">{k}</dt><dd className="text-right font-semibold tabular-nums">{children}</dd></div>
}

/** The assistant's answer (illustrative content, real flow). */
function Answer({ op }: { op: OpKey }) {
  const head = (t: string) => <p className="text-[0.7rem] font-semibold uppercase tracking-[0.07em] text-[#9a9fa9]">{t}</p>
  if (op === 'precios') return <>{head('Resumen del cambio')}<dl className="mt-1.5 text-[0.95rem]"><Row k="Producto">{nord.name}</Row><Row k="Precio"><s className="mr-1.5 font-normal text-[#9a9fa9]">{formatCOP(nord.price)}</s>{formatCOP(NEW_PRICE)}</Row></dl><Actions /></>
  if (op === 'existencias') return <>{head('Entrada de existencias')}<dl className="mt-1.5 text-[0.95rem]"><Row k="Producto">{nord.name} · talla 42</Row><Row k="Entrada">+10 pares</Row></dl><Actions /></>
  if (op === 'productos') return <>{head('Borrador del producto')}<dl className="mt-1.5 text-[0.95rem]"><Row k="Nombre">{nord.name}</Row><Row k="Categoría">{nord.category}</Row><Row k="Precio">{formatCOP(nord.price)}</Row></dl><Actions /></>
  return <>{head('Pedidos pendientes')}<p className="mt-1.5 text-[0.95rem]">Tienes 2 pedidos por atender. Consultar no cambia nada.</p></>
}

/** What the operation means in the store (right side). */
function Result({ op }: { op: OpKey }) {
  if (op === 'precios') return (
    <div className="flex items-center gap-5">
      <img src={nord.src} alt="" width={480} height={480} loading="lazy" decoding="async" className="size-32 shrink-0 rounded-2xl bg-[#eef0f3] object-cover ring-[3px] ring-(--v2-lime) sm:size-40" />
      <div className="min-w-0">
        <p className="text-[1.125rem] font-semibold">{nord.name}</p>
        <p className="mt-1 text-[0.95rem] text-[#6e6e73] line-through tabular-nums">{formatCOP(nord.price)}</p>
        <p className="text-[1.75rem] font-bold leading-tight tracking-[-0.03em] tabular-nums">{formatCOP(NEW_PRICE)}</p>
        <span className="mt-2 inline-block rounded-full bg-(--v2-lime) px-2.5 py-0.5 text-[0.75rem] font-bold text-[#0b0c10]">Actualizado</span>
      </div>
    </div>
  )
  if (op === 'existencias') return (
    <div>
      <div className="flex items-center gap-4"><img src={nord.src} alt="" width={480} height={480} loading="lazy" decoding="async" className="size-16 shrink-0 rounded-xl bg-[#eef0f3] object-cover" /><p className="text-[1.0625rem] font-semibold">{nord.name}</p></div>
      <ul className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Existencias por talla (ejemplo)">
        {[['40', '3'], ['41', '5'], ['42', '14'], ['43', '2'], ['44', '6'], ['45', '1']].map(([size, qty]) => (
          <li key={size} className={`rounded-xl px-2 py-2.5 text-center ${size === '42' ? 'bg-[#1d1d1f] text-white ring-[3px] ring-(--v2-lime)' : 'bg-[#f3f3f5]'}`}>
            <span className="block text-[0.75rem]">Talla {size}</span>
            <span className="block text-[1.125rem] font-bold tabular-nums">{size === '42' ? <><s className="mr-1 text-[0.8rem] font-medium text-[#b4b8c2]">4</s>14</> : qty}</span>
          </li>
        ))}
      </ul>
    </div>
  )
  if (op === 'productos') return (
    <ul className="grid grid-cols-4 gap-2 sm:gap-3" aria-label="Catálogo con el borrador nuevo">
      {['ASTRAL-03', 'VANTA-01', 'KINETIK-06'].map((sku) => { const p = bySku(sku); return (
        <li key={sku}><img src={p.src} alt="" width={480} height={480} loading="lazy" decoding="async" className="aspect-square w-full rounded-xl bg-[#eef0f3] object-cover" /><p className="mt-1.5 truncate text-[0.8rem] font-semibold">{p.name}</p></li>
      ) })}
      <li className="rounded-2xl p-1.5 outline-[3px] outline-dashed outline-(--v2-lime)"><img src={nord.src} alt="" width={480} height={480} loading="lazy" decoding="async" className="aspect-square w-full rounded-xl bg-[#eef0f3] object-cover" /><p className="mt-1.5 text-[0.72rem] font-semibold leading-tight text-[#6e6e73]">Borrador</p></li>
    </ul>
  )
  return (
    <ul className="divide-y divide-black/[.07]" aria-label="Pedidos pendientes (ejemplo)">
      {ORDERS.map((o) => (
        <li key={o.code} className="flex items-center gap-4 py-3">
          <img src={o.p.src} alt="" width={480} height={480} loading="lazy" decoding="async" className="size-14 shrink-0 rounded-xl bg-[#eef0f3] object-cover" />
          <span className="min-w-0 flex-1"><span className="block truncate text-[0.95rem] font-semibold">{o.p.name}</span><span className="block truncate text-[0.78rem] text-[#6e6e73]">{o.code}</span></span>
          <span className="shrink-0 text-right"><span className="block text-[0.95rem] font-bold tabular-nums">{formatCOP(o.p.price)}</span><span className="block text-[0.75rem] font-semibold text-[#6e6e73]">Pendiente</span></span>
        </li>
      ))}
    </ul>
  )
}

/** The private chat for one operation: the request and the assistant's answer. */
function Chat({ op, compact }: { op: Op; compact?: boolean }) {
  return (
    <div className={`flex flex-col gap-3 rounded-[1.5rem] bg-[#16181f] text-[#f5f5f7] ${compact ? 'p-4' : 'p-5 md:p-6'}`}>
      <p className="flex items-center gap-2 text-[0.8125rem] text-[#9a9fa9]"><span className="grid size-6 place-items-center rounded-full bg-[#0c0d11] text-[#25d366]"><Icon name="whatsapp" size={13} /></span><span className="font-semibold text-[#f5f5f7]">Asistente TiendIA</span> · chat privado</p>
      <div className="flex justify-end">
        <div className="max-w-[90%] rounded-2xl rounded-br-md bg-[#2b2f39] px-4 py-2.5 text-[0.95rem] leading-snug">
          {op.key === 'productos' ? <img src={nord.src} alt={`Foto de ${nord.name} enviada al asistente`} width={480} height={480} loading="lazy" decoding="async" className="mb-2 aspect-[4/3] w-20 rounded-lg bg-white object-cover" /> : null}
          {op.ask}
        </div>
      </div>
      <div className="rounded-2xl rounded-bl-md bg-[#0c0d11] px-4 py-3"><Answer op={op.key} /></div>
    </div>
  )
}

const roles = (op: Op) => <p className="mt-4 flex items-start gap-2 text-[0.8125rem] leading-snug text-(--v2-subtle)"><Icon name="users" size={14} className="mt-0.5 shrink-0" /><span>Pueden hacerlo: {op.roles}.{op.note ? ` ${op.note}` : ''}</span></p>

export function AdminV2() {
  const [price, ...rest] = OPS
  return (
    <Section id="administracion" labelledBy="administracion-title">
      <div className={wrap}>
        <Heading id="administracion-title" center kicker="Por chat" title="Administra hablando." intro={<>Tú y los usuarios que autorices le escriben al asistente en WhatsApp o Telegram. <strong className="font-semibold text-(--v2-text)">Tus clientes no hablan con el asistente.</strong></>} />

        {/* Bento: one idea per card. The large card is the price change as an open book (chat | your store),
            turning with a fine pointer; the three others each show one real operation and tilt the same way. */}
        <ul className="v2-bento mx-auto mt-12 grid max-w-6xl gap-4 md:mt-16 lg:grid-cols-3 lg:gap-5" aria-label="Qué puedes hacer por chat">
          <li className="lg:col-span-3">
            <article aria-labelledby="op-precios" className="rounded-[1.75rem] bg-(--v2-surface) p-5 md:p-7">
              <h3 id="op-precios" className="flex items-center gap-2.5 text-[1.375rem] font-semibold tracking-[-0.02em]"><Icon name={price.icon} size={20} className="text-(--v2-subtle)" />Cambia un precio</h3>
              <div data-v2-tilt="" className="v2-deck mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-5">
                <div className="v2-swap"><Chat op={price} /></div>
                <div className="v2-swap flex flex-col rounded-[1.5rem] bg-white p-5 text-[#1d1d1f] md:p-7">
                  <p className="text-[0.8125rem] font-semibold text-[#6e6e73]">{price.result}</p>
                  <div className="mt-4 flex flex-1 flex-col justify-center"><Result op={price.key} /></div>
                </div>
              </div>
              {roles(price)}
            </article>
          </li>
          {rest.map((op) => (
            <li key={op.key} className="flex">
              <article aria-labelledby={`op-${op.key}`} data-v2-tilt="" className="v2-tile flex w-full flex-col rounded-[1.75rem] bg-(--v2-surface) p-5 md:p-6">
                <h3 id={`op-${op.key}`} className="flex items-center gap-2.5 text-[1.25rem] font-semibold tracking-[-0.02em]"><Icon name={op.icon} size={19} className="text-(--v2-subtle)" />{TITLES[op.key]}</h3>
                <div className="mt-4 flex-1"><Chat op={op} compact /></div>
                {roles(op)}
              </article>
            </li>
          ))}
        </ul>
        <p className={`mx-auto mt-4 max-w-6xl ${type.small}`}>Ejemplos ilustrativos. El asistente entiende texto, notas de voz y fotos; cada cambio queda pendiente hasta que lo confirmas.</p>

        <div className="mx-auto mt-12 max-w-6xl border-t border-(--v2-line) pt-8">
          <ul className="grid gap-3 md:grid-cols-3 md:gap-8">
            {GUARANTEES.map((g) => (
              <li key={g.text} className="flex gap-2.5 text-[0.9rem] leading-snug text-(--v2-muted)"><Icon name={g.icon} size={17} className="mt-0.5 shrink-0 text-(--v2-subtle)" />{g.text}</li>
            ))}
          </ul>
          <details className="group mt-6 max-w-2xl rounded-xl ring-1 ring-inset ring-(--v2-line) [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-[0.9rem] font-semibold">
              ¿Cómo se vincula un WhatsApp o un Telegram?
              <Icon name="plus" size={16} className="shrink-0 text-(--v2-subtle) transition-transform duration-200 group-open:rotate-45" />
            </summary>
            <p className="v2-disclose px-4 pb-4 text-[0.9rem] leading-relaxed text-(--v2-muted)">
              Generas un código de un solo uso desde tu cuenta de TiendIA Exprés y se lo envías al asistente; en WhatsApp, así: <code className="rounded bg-(--v2-raised) px-1.5 py-0.5 text-[0.85rem] text-(--v2-text)">VINCULAR TU-CODIGO</code>. Nunca se vincula un WhatsApp solo por el número de teléfono, y para quitarlo basta con escribir «desvincular».
            </p>
          </details>
        </div>
      </div>
    </Section>
  )
}
