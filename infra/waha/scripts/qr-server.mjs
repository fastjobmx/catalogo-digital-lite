#!/usr/bin/env node
// Página local para escanear el QR de la sesión del asistente sin manejar la clave administrativa.
// Solo escucha en 127.0.0.1:3099, pide el QR a WAHA del lado del servidor y se apaga sola cuando
// la sesión queda vinculada (WORKING) o a los 10 minutos.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const session = env.WAHA_SESSION || 'tiendia'
const key = readFileSync(join(root, '.secrets', 'admin-key.txt'), 'utf8').trim()
const waha = (path, init = {}) => fetch(`http://127.0.0.1:3000${path}`, { ...init, headers: { 'X-Api-Key': key, Accept: 'application/json', ...(init.headers || {}) } })

const page = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vincular asistente</title><style>body{font-family:system-ui,sans-serif;max-width:520px;margin:32px auto;padding:0 16px;color:#111}
img{width:320px;height:320px;border:1px solid #ddd;border-radius:8px;image-rendering:pixelated}#s{font-weight:600}ol{line-height:1.6}</style></head>
<body><h1>Vincular WhatsApp del Asistente TiendIA</h1><p>Estado: <span id="s">…</span></p><img id="q" alt="Código QR"><ol>
<li>En el teléfono del número del asistente abre WhatsApp.</li><li>Menú ⋮ → <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b>.</li>
<li>Escanea este código. Se renueva solo cada pocos segundos.</li></ol><p>Nunca compartas este código ni una captura de él.</p>
<script>async function t(){const r=await fetch('/state').then(r=>r.json()).catch(()=>({status:'sin conexión'}));document.getElementById('s').textContent=r.status;
const q=document.getElementById('q');if(r.qr){q.src=r.qr;q.style.display=''}else{q.style.display='none'}if(r.status!=='WORKING')setTimeout(t,4000)}t()</script></body></html>`

const server = createServer(async (req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(page) }
  if (req.url === '/state') {
    const s = await waha(`/api/sessions/${session}`).then((r) => r.json()).catch(() => ({}))
    let qr = null
    if (s.status === 'SCAN_QR_CODE') {
      const q = await waha(`/api/${session}/auth/qr`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      if (q?.data) qr = `data:${q.mimetype || 'image/png'};base64,${q.data}`
    }
    if (s.status === 'WORKING') setTimeout(() => { console.log('Sesión vinculada (WORKING). Cerrando la página local.'); process.exit(0) }, 3000)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    return res.end(JSON.stringify({ status: s.status || 'desconocido', qr }))
  }
  res.writeHead(404); res.end()
})
server.listen(3099, '127.0.0.1', () => console.log('Abre http://127.0.0.1:3099 para escanear el QR.'))
setTimeout(() => { console.log('Tiempo agotado: página cerrada.'); process.exit(0) }, 10 * 60 * 1000)
