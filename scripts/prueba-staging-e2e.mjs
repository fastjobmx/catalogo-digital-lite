#!/usr/bin/env node
// Validación de extremo a extremo de la prueba gratis real contra el staging AISLADO tiendia-prueba-staging (datos ficticios).
// Uso:  node scripts/prueba-staging-e2e.mjs <fase> [correo]     (estado en STATE_FILE, por defecto ./.prueba-e2e-state.json)
//   fase 1  registro, acceso, 7 productos, rechazo del 8.º, personalización, catálogo, pedido y aislamiento
//   fase 2  (después de vencer la prueba, controlado por SQL) bloqueos, lectura, ampliación autorizada
//   fase 3  contratación, verificación de pago y conversión de la MISMA tienda, y comparación de datos
// Credenciales del superadministrador de staging: STAGING_ADMIN_EMAIL / STAGING_ADMIN_PASSWORD (entorno); nunca se imprimen.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BASE = process.env.PRUEBA_API || 'https://tiendia-prueba-staging.catalogo-lite-worker.workers.dev'
const STATE_FILE = process.env.STATE_FILE || './.prueba-e2e-state.json'
const phase = process.argv[2]
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 1))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK   ' : 'FALLA'} ${name}${detail ? ' · ' + detail : ''}`) }

async function call(path, { method = 'GET', token, store, body, headers = {}, raw } = {}) {
  const h = { 'User-Agent': 'tiendia-prueba-e2e/1.0', ...headers }
  if (token) h.Authorization = `Bearer ${token}`
  if (store) h['X-Store-Slug'] = store
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json'
  const response = await fetch(BASE + path, { method, headers: h, body: raw ? body : body === undefined ? undefined : JSON.stringify(body) })
  let data = null
  try { data = await response.json() } catch { data = null }
  return { status: response.status, body: data }
}

async function adminToken() {
  const email = process.env.STAGING_ADMIN_EMAIL, password = process.env.STAGING_ADMIN_PASSWORD
  if (!email || !password) throw new Error('Define STAGING_ADMIN_EMAIL y STAGING_ADMIN_PASSWORD')
  const r = await call('/api/admin/login', { method: 'POST', body: { email, password } })
  if (!r.body?.token) throw new Error('Login de superadministrador rechazado: ' + r.status)
  return r.body.token
}

const png = (size = 256) => {
  const crc = (buf) => { let c, crcTable = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 } let x = 0xffffffff; for (const b of buf) x = crcTable[(x ^ b) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([len, body, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0xb0)])
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}
const product = (i, extra = {}) => ({ sku: `E2E-${i}`, name: `Producto ficticio ${i}`, price: 10000 + i, imageUrls: [], variants: [{ size: 'M', color: 'Rojo', stock: 5 }], ...extra })
const login = async (email, password) => (await call('/api/admin/login', { method: 'POST', body: { email, password } })).body?.token

async function snapshot(token, slug) {
  const products = (await call('/api/products', { token, store: slug })).body
  const list = Array.isArray(products) ? products : []
  const orders = (await call('/api/orders', { token, store: slug })).body
  const orderList = Array.isArray(orders) ? orders : orders?.items || []
  const settings = (await call('/api/admin/store', { token, store: slug })).body
  return { products: list.map((p) => ({ id: p.id, sku: p.sku, name: p.name, price: p.price, images: p.imageUrls || p.image_urls })), orders: orderList.map((o) => ({ id: o.id, total: o.total })), settings: { name: settings?.name, primary: settings?.primary_color ?? settings?.primaryColor, logo: settings?.logo_url ?? settings?.logoUrl } }
}

if (phase === '1') {
  const reuse = process.env.REUSE === '1' && state.slug
  const email = reuse ? state.email : process.argv[3] || `ana.${Date.now()}@tiendia-prueba.test`
  const password = reuse ? state.password : `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`
  state.email = email; state.password = password
  const admin = await adminToken()
  const signup = reuse ? { status: 202 } : await call('/api/signup', { method: 'POST', body: { businessName: 'Flores Ficticias de Ana', email, ownerName: 'Ana Pérez', whatsapp: '+57 300 111 2233', acceptTerms: true } })
  check('1 registro', signup.status === 202, reuse ? 'tienda ya creada, se reutiliza' : `HTTP ${signup.status}`)
  const row = (await call('/api/platform/trial-stores', { token: admin })).body
  const found = (row?.items || []).find((s) => (s.ownerEmail || s.email) === email) || (row?.items || [])[0]
  state.slug = reuse ? state.slug : found?.slug || found?.store?.slug
  check('1 tienda real creada en estado de prueba', Boolean(state.slug), `slug=${state.slug}`)
  // El correo queda registrado (en staging aún sin proveedor: no_configurado) y se puede reenviar.
  const resend = await call('/api/signup/resend', { method: 'POST', body: { email } })
  check('10 reenvío seguro del enlace (respuesta uniforme)', resend.status === 202 && resend.body?.ok === true)
  // Con el correo aún apagado el enlace se emite por el mecanismo existente del superadministrador.
  const access = await call(`/api/platform/stores/${state.slug}/access`, { method: 'POST', token: admin })
  const link = access.body?.activationUrl || ''
  const token = decodeURIComponent((link.match(/token=([^&\s]+)/) || [])[1] || '')
  check('2 enlace de acceso del propietario emitido', Boolean(token))
  const activated = await call('/api/auth/activate', { method: 'POST', body: { token, password } })
  check('2-3 activación y acceso al panel real', activated.status === 200 && Boolean(activated.body?.token), `HTTP ${activated.status}`)
  state.token = activated.body?.token
  const trial = await call('/api/admin/trial', { token: state.token, store: state.slug })
  check('3 estado de la prueba visible (7 días, 7 productos)', trial.body?.trial?.productLimit === 7 && trial.body?.trial?.daysLeft >= 6, JSON.stringify({ status: trial.body?.trial?.status, daysLeft: trial.body?.trial?.daysLeft, verified: trial.body?.trial?.emailVerified }))
  // Productos: 7 permitidos, el 8.º rechazado por el backend; ráfaga concurrente.
  for (let i = 1; i <= 5; i++) check(`4 producto ${i}`, (await call('/api/admin/products', { method: 'POST', token: state.token, store: state.slug, body: product(i) })).status === 201)
  const burst = await Promise.all([6, 7, 8, 9, 10, 11].map((i) => call('/api/admin/products', { method: 'POST', token: state.token, store: state.slug, body: product(i) })))
  const created = burst.filter((r) => r.status === 201).length
  check('5 ráfaga concurrente: entran exactamente 2 más (7 en total)', created === 2, `creados=${created} rechazados=${burst.filter((r) => r.status === 409).map((r) => r.body?.code).join(',')}`)
  const eighth = await call('/api/admin/products', { method: 'POST', token: state.token, store: state.slug, body: product(99) })
  check('5 octavo producto rechazado por el backend', eighth.status === 409, JSON.stringify(eighth.body))
  // Personalización, foto, categoría y edición
  const form = new FormData(); form.set('file', new File([png(256)], 'foto.png', { type: 'image/png' })); form.set('folder', 'products')
  const upload = await call('/api/upload/image', { method: 'POST', token: state.token, store: state.slug, body: form, raw: true })
  state.imageUrl = upload.body?.url || upload.body?.imageUrl
  check('6 foto subida a la tienda', upload.status === 200 || upload.status === 201, `HTTP ${upload.status}`)
  const prods = (await call('/api/products', { store: state.slug })).body
  const list = Array.isArray(prods) ? prods : []
  state.firstId = list[0]?.id
  const edit = await call(`/api/admin/products/${state.firstId}`, { method: 'PUT', token: state.token, store: state.slug, body: { name: 'Ramo editado', price: 55000, imageUrls: state.imageUrl ? [state.imageUrl] : [] } })
  check('6 edición de producto y foto', edit.status === 200, `HTTP ${edit.status}`)
  const cat = await call('/api/admin/categories', { method: 'POST', token: state.token, store: state.slug, body: { name: 'Ramos', slug: 'ramos' } })
  check('6 categoría', cat.status === 201)
  const cfg = await call('/api/admin/store', { method: 'PUT', token: state.token, store: state.slug, body: { name: 'Flores de Ana Premium', primary_color: '#A414CF' } })
  check('6 nombre y color de la tienda', cfg.status === 200)
  const hack = await call('/api/admin/store', { method: 'PUT', token: state.token, store: state.slug, body: { product_limit: 50, plan_code: 'mayorista' } })
  const after = await call('/api/admin/trial', { token: state.token, store: state.slug })
  check('6 el comerciante no puede cambiar sus límites ni su plan', after.body?.trial?.productLimit === 7 && hack.status < 500, `HTTP ${hack.status}`)
  // Catálogo público y pedido
  const pub = await call('/api/products', { store: state.slug })
  check('7 catálogo público con 7 productos', Array.isArray(pub.body) && pub.body.length === 7, `n=${Array.isArray(pub.body) ? pub.body.length : '?'}`)
  const variant = list[1]
  const v = variant?.variants?.[0]
  const order = await call('/api/orders', { method: 'POST', store: state.slug, headers: { 'Idempotency-Key': `e2e-order-${Date.now()}-0001` }, body: { customerName: 'Cliente ficticio', customerPhone: '3001112233', items: [{ productId: variant?.id, variantId: v?.id, sku: list[1]?.sku, name: list[1]?.name, price: list[1]?.price, quantity: 1 }] } })
  check('7 pedido recibido', order.status === 201, `HTTP ${order.status} ${order.status === 201 ? '' : JSON.stringify(order.body).slice(0, 120)}`)
  const orders = (await call('/api/orders', { token: state.token, store: state.slug })).body
  check('7 el pedido aparece en el panel', JSON.stringify(orders).includes('Cliente ficticio'))
  // Aislamiento: segunda tienda ficticia
  if (!state.slugB) {
    const emailB = `beto.${Date.now()}@tiendia-prueba.test`
    await call('/api/signup', { method: 'POST', body: { businessName: 'Tienda de Beto', email: emailB, acceptTerms: true } })
    const rowB = ((await call('/api/platform/trial-stores', { token: admin })).body?.items || []).find((s) => (s.ownerEmail || s.email) === emailB)
    state.slugB = rowB?.slug || rowB?.store?.slug
  }
  check('18 segunda tienda creada', Boolean(state.slugB))
  check('18 la tienda A no puede abrir la B (403)', (await call('/api/admin/trial', { token: state.token, store: state.slugB })).status === 403)
  check('18 la tienda A no ve pedidos de la B (403)', (await call('/api/orders', { token: state.token, store: state.slugB })).status === 403)
  state.before = await snapshot(state.token, state.slug)
  save()
} else if (phase === '2') {
  const admin = await adminToken()
  const pub = await call('/api/store', { store: state.slug })
  check('9 vencida: la vitrina pública responde TRIAL_EXPIRED', pub.status === 404 && pub.body?.code === 'TRIAL_EXPIRED', JSON.stringify(pub.body))
  const prods = (await call('/api/products', { token: state.token, store: state.slug })).body
  const list = Array.isArray(prods) ? prods : []
  check('9 vencida: el comerciante sigue viendo sus datos', list.length >= 7)
  const newProduct = await call('/api/admin/products', { method: 'POST', token: state.token, store: state.slug, body: product(50) })
  check('9 vencida: no permite productos nuevos', newProduct.status === 409 && newProduct.body?.code === 'TRIAL_EXPIRED', JSON.stringify(newProduct.body))
  const status = await call('/api/admin/trial', { token: state.token, store: state.slug })
  check('9 vencida: el panel informa y ofrece contratar', status.body?.trial?.status === 'vencida' && status.body?.plans?.length === 3, status.body?.trial?.status)
  const bad = await call(`/api/platform/trial-stores/${state.slug}/extend`, { method: 'POST', token: state.token, body: { days: 5, reason: 'x' } })
  check('9 un comerciante no puede ampliar su prueba (403)', bad.status === 403)
  const ext = await call(`/api/platform/trial-stores/${state.slug}/extend`, { method: 'POST', token: admin, body: { days: 3, reason: 'Validación en staging' } })
  check('9 ampliación autorizada y auditada', ext.status === 200, `HTTP ${ext.status}`)
  check('9 la tienda vuelve a estar publicada', (await call('/api/store', { store: state.slug })).status === 200)
} else if (phase === '3') {
  const admin = await adminToken()
  const before = await snapshot(state.token, state.slug)
  const sess = (await call('/api/admin/session', { token: state.token, store: state.slug })).body
  state.storeId = sess?.store?.id
  const req = await call('/api/admin/trial/plan-request', { method: 'POST', token: state.token, store: state.slug, body: { planCode: 'emprendedor', cycle: 'mensual' } })
  check('12 contratación solicitada', req.status === 201, `HTTP ${req.status}`)
  const again = await call('/api/admin/trial/plan-request', { method: 'POST', token: state.token, store: state.slug, body: { planCode: 'emprendedor', cycle: 'mensual' } })
  check('19 solicitud repetida: sin duplicar', again.status === 200 && again.body?.requestId === req.body?.requestId, '')
  const stillTrial = await call('/api/admin/trial', { token: state.token, store: state.slug })
  check('13 sin pago verificado el plan NO se activa', stillTrial.body?.trial?.status !== 'convertida', stillTrial.body?.trial?.status)
  const requests = await call('/api/platform/plan-requests', { token: admin })
  const mine = (requests.body?.items || []).find((r) => r.storeSlug === state.slug || r.slug === state.slug)
  state.requestId = mine?.id
  check('13 la solicitud pendiente de pago aparece en la plataforma', Boolean(state.requestId))
  check('13 el comerciante no puede activar su propio plan (403)', (await call(`/api/platform/plan-requests/${state.requestId}/activate`, { method: 'POST', token: state.token, body: { confirm: true, paymentReference: 'yo pagué' } })).status === 403)
  check('13 sin referencia ni confirmación se rechaza (400)', (await call(`/api/platform/plan-requests/${state.requestId}/activate`, { method: 'POST', token: admin, body: { paymentReference: 'TRF' } })).status === 400)
  const replays = await Promise.all([1, 2, 3].map(() => call(`/api/platform/plan-requests/${state.requestId}/activate`, { method: 'POST', token: admin, body: { confirm: true, paymentReference: 'Pago de pruebas de staging 0001' } })))
  check('14 activación transaccional e idempotente (3 llamadas simultáneas)', replays.every((r) => r.status === 200), replays.map((r) => r.status).join(','))
  const after = await snapshot(state.token, state.slug)
  const sess2 = (await call('/api/admin/session', { token: state.token, store: state.slug })).body
  check('14 el ID de la tienda no cambió', sess2?.store?.id === state.storeId && sess2?.store?.slug === state.slug, `id=${sess2?.store?.id} plan=${sess2?.store?.planCode}`)
  check('15 mismos productos (ID, SKU, nombre, precio, fotos)', JSON.stringify(after.products) === JSON.stringify(before.products), `${after.products.length} productos`)
  check('15 mismos pedidos', JSON.stringify(after.orders) === JSON.stringify(before.orders), `${after.orders.length} pedidos`)
  check('15 misma configuración (nombre, color, logotipo)', JSON.stringify(after.settings) === JSON.stringify(before.settings))
  const more = await call('/api/admin/products', { method: 'POST', token: state.token, store: state.slug, body: product(120) })
  check('17 nuevas capacidades: producto número 8 permitido', more.status === 201, `HTTP ${more.status}`)
  check('17 la tienda recibe pedidos y se publica', (await call('/api/store', { store: state.slug })).status === 200)
  const trialAfter = await call('/api/admin/trial', { token: state.token, store: state.slug })
  check('17 el panel ya no muestra límites de prueba', trialAfter.body?.trial?.status === 'convertida' || trialAfter.body?.trial === null || trialAfter.body?.trial?.converted === true, JSON.stringify(trialAfter.body?.trial?.status))
} else {
  console.error('Uso: node scripts/prueba-staging-e2e.mjs <1|2|3> [correo]'); process.exit(2)
}
console.log(`\n${results.filter(Boolean).length} correctas, ${results.filter((r) => !r).length} fallidas`)
process.exit(results.every(Boolean) ? 0 : 1)
