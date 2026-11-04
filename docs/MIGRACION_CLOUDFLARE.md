# Migración del frontend de Netlify a Cloudflare

Fecha: 2026-11-04. Objetivo: que la plataforma funcione sin Netlify.

## 1. Resultado

| Elemento | Estado |
|---|---|
| **URL nueva** | **https://catalogo-digital-ia.catalogo-lite-worker.workers.dev** |
| Frontend | Worker `catalogo-digital-ia` (Workers Static Assets), versión `23744f4e-8a78-4214-9ce5-119680dd90d8` |
| Backend | Worker `catalogo-lite-api`, versión `7890daf2-a831-4582-b330-ef16004649da` (antes `93d77cc7`): enlaces y CORS apuntan a Cloudflare |
| Base de datos e imágenes | Las mismas D1 (`catalogo-lite-production-db`) y R2 (`catalogo-lite-production-assets`); nada duplicado |
| Bots | Los tres sin cambios de tokens ni webhooks |
| Netlify | Ya no construye (`ignore = "exit 0"`). El último deploy sigue en línea para enlaces antiguos |

## 2. Arquitectura

```
Navegador ──► catalogo-digital-ia (Worker)
                 ├─ archivos estáticos (HTML, JS, CSS, imágenes, fuentes) servidos por Cloudflare
                 ├─ rutas desconocidas → index.html (SPA: /plataforma, /t/<tienda>/admin, …)
                 └─ /api/*  ──service binding──► catalogo-lite-api ──► D1 · R2 · Gemini
Telegram ──► catalogo-lite-api (webhooks sin cambios)
```

- `frontend/wrangler.jsonc`:
  - `assets.not_found_handling = "single-page-application"`.
  - `run_worker_first = ["/api/*"]`: solo la API ejecuta el script; los archivos estáticos se sirven sin ejecutarlo.
  - Service binding `API` → `catalogo-lite-api`.
- `frontend/cloudflare/worker.js`: reenvía `/api/*` al backend. Reemplaza la redirección `/api/assets/*` de Netlify, sin salto público.
- `frontend/.env.cloudflare`: `VITE_API_URL` vacío. **El frontend llama a la API en su mismo origen**, así que no depende de CORS y funcionará igual con dominios propios.
- `frontend/public/_headers`: `nosniff`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy`, HSTS y caché inmutable para `/assets/*`.

Publicar el frontend:

```powershell
cd frontend
npm run deploy:cloudflare   # build en modo cloudflare + wrangler deploy (usa el Wrangler de worker/)
```

## 3. Verificación en la URL nueva (2026-11-04)

- **Rutas:** `/`, `/plataforma`, `/admin/login`, `/t/muy-parcero`, `/t/muy-parcero/admin` y `/t/muy-parcero/product/…` responden 200 por HTTPS, también al recargar directamente. Los JS, CSS y SVG cargan; `/_headers` no queda expuesto.
- **Tiendas:**
  - SneakerHub Premium: 24 productos y su composición de siempre.
  - Muy Parcero: 11 productos, con su logo, colores, plantilla y portada.
  - Catálogos separados por tienda.
- **Imágenes de R2:** 20 de 20 cargadas por `/api/assets/…`. Ninguna depende de Netlify.
- **Producto y carrito:** producto con tallas y precio; añadir al carrito funciona, con cupón y casilla de promociones. **No se envió ningún pedido** para no crear datos comerciales.
- **Seguridad:** el inicio de sesión con credenciales inválidas da 401, y `/api/admin/session` y `/api/platform/summary` sin sesión dan 401. Los paneles redirigen a su inicio de sesión. Las cabeceras de seguridad están presentes.
- **Diseño responsive:** sin desbordamiento horizontal a 375 px en ambas tiendas. Sin errores de consola en la navegación pública.
- **Pruebas:** Worker 245/245 y frontend 67/67, con compilación correcta. El paquete es el mismo que publicaba Netlify; solo cambia la dirección de la API.

Pendiente de verificar por el propietario: el **inicio de sesión real** (no tengo tu contraseña de producción) y un recorrido en Telegram que entregue un enlace nuevo (por ejemplo, “👁 Ver mi tienda” o “🔑 Nuevos accesos”).

## 4. Enlaces generados por el backend (aplicado con autorización)

**Aplicado el 2026-11-04:** Worker `93d77cc7` → `7890daf2`; 10 secretos intactos. CORS acepta el origen de Cloudflare y el de Netlify (transición) y rechaza cualquier otro. Tiendas 200, panel sin sesión 401, webhooks sin secreto 403. Bots (`master-maintenance.mjs status`): `@CatalogoDigitalMaestro_bot`, `@SneakerHubAdmin_bot` y `@SneakerHubPruebas_bot` con los mismos webhooks, 0 pendientes y sin errores. Desde ahora el bot maestro, el asistente y los avisos entregan enlaces `workers.dev`.

Detalle del cambio:

El backend todavía genera los enlaces con la base de Netlify (`PUBLIC_STORE_BASE_URL`). Afecta a:
- Bot maestro: URL de cada tienda nueva, accesos y activación.
- Asistente: vista previa privada, panel y “Ver mi tienda”.
- Avisos de pedidos.

El cambio ya está preparado en `worker/wrangler.production.toml`, con las pruebas pasadas (245/245):

```toml
ALLOWED_ORIGIN = "https://catalogo-digital-ia.catalogo-lite-worker.workers.dev,https://catalogo-digital-ia.netlify.app"
PUBLIC_STORE_BASE_URL = "https://catalogo-digital-ia.catalogo-lite-worker.workers.dev"
```

Despliegue (no cambia secretos ni webhooks):

```powershell
cd worker
npx wrangler deploy --config wrangler.production.toml
```

Reversión del backend: `npx wrangler rollback 93d77cc7-ac57-4a43-a320-fdc303345250 --config wrangler.production.toml` (vuelve a los enlaces de Netlify). **No bajar de `f9928a44`.**

## 5. Referencias a Netlify corregidas

| Lugar | Antes | Ahora |
|---|---|---|
| `worker/wrangler.production.toml` `PUBLIC_STORE_BASE_URL` | netlify.app | workers.dev (se aplica en el paso 4) |
| `worker/wrangler.production.toml` `ALLOWED_ORIGIN` | solo netlify.app | workers.dev + netlify.app durante la transición |
| Redirección `/api/assets/*` (`netlify.toml`) | Netlify → API | Service binding en el Worker del frontend |
| `VITE_API_URL` (build en Netlify) | URL pública de la API | mismo origen (`.env.cloudflare`) |
| Textos del bot maestro sobre dominios | “DNS y Netlify” | “DNS y el dominio en Cloudflare” |
| Comentarios en `worker/src/index.ts`, `routes/platform.ts` y `frontend/src/lib/publicDemo.ts` | Netlify | Cloudflare / genérico |
| `netlify.toml` | builds activos | `ignore = "exit 0"` (sin builds) |
| `docs/DESPLIEGUE_GITHUB_NETLIFY.md` | guía vigente | marcada como obsoleta |

**Sin cambios, a propósito:** registros históricos en `PROGRESO.md` y en los documentos de despliegue y auditoría anteriores.

**Datos:** la base no contiene URLs de Netlify (logos, portadas, productos, variantes y pedidos revisados), no hay dominios propios registrados y no hay enlaces de activación vigentes. Ningún enlace temporal queda roto.

**Enlaces ya entregados con el dominio anterior:** las direcciones de tienda (`…netlify.app/t/<tienda>`) que recibieron los propietarios de Distribumax y Muy Parcero siguen funcionando mientras el sitio de Netlify esté en línea, porque el CORS lo mantiene durante la transición. Avísales de la dirección nueva antes de apagar Netlify. Si un acceso caducado hace falta, se regenera en el bot maestro con **🔑 Nuevos accesos** (después del paso 4, ya con la URL de Cloudflare).

## 6. Retiro de Netlify

1. **Builds:** desactivados desde el repositorio (`ignore = "exit 0"`). Para cortarlos también en Netlify: *Site configuration → Build & deploy → Continuous deployment → Stop builds*.
2. **Antes de apagar el sitio:**
   - Completa el paso 4.
   - Comprueba que el bot maestro entrega enlaces `workers.dev` y avisa a los propietarios.
   - Quita `https://catalogo-digital-ia.netlify.app` de `ALLOWED_ORIGIN`.
3. **No se eliminó** el sitio ni se desconectó ningún dominio: requiere tu autorización final.

## 7. Reversión

- **Volver a Netlify como frontend:** quitar `ignore = "exit 0"` de `netlify.toml` y volver a publicar desde Netlify. Si el paso 4 ya se aplicó, revertir el backend a `93d77cc7`.
- **Frontend en Cloudflare:** `cd frontend; node ../worker/node_modules/wrangler/bin/wrangler.js rollback <versión>`. La primera versión publicada fue `b7661eef` (llamadas a la API por la URL pública); la actual es `23744f4e` (mismo origen).

## 8. Costos y límites (verificar en la página de precios de Cloudflare antes de crecer)

| Servicio | Gratis | Qué genera consumo |
|---|---|---|
| Workers Static Assets | Las solicitudes a archivos estáticos no ejecutan el Worker y no cuentan como solicitudes | — |
| Workers (frontend y API) | Plan Free: 100.000 solicitudes por día entre todos los Workers; plan Paid (5 USD/mes): 10 millones al mes incluidos | Cada llamada a `/api/*` ejecuta el Worker del frontend y la API; las imágenes de R2 también pasan por ahí |
| D1 | 5 GB y límites diarios de lecturas y escrituras | Consultas |
| R2 | 10 GB y millones de operaciones al mes; **sin costo de salida** | Almacenamiento y operaciones por encima del cupo |
| Cloudflare for SaaS (futuro) | Primeros hostnames personalizados incluidos; luego cobro por hostname | Solo al activarlo para dominios de clientes |

No se activó ningún servicio de pago.

## 9. Dominios propios (siguiente etapa)

- **Base ya lista:** el frontend llama a la API en su mismo origen y el backend resuelve la tienda por `store_domains` (estado `activo`, con el plan que incluya dominio propio).
- **Falta:**
  - Asociar el dominio al Worker `catalogo-digital-ia` (*Custom Domains*; o Cloudflare for SaaS para dominios fuera de tu cuenta).
  - Que el frontend envíe `X-Store-Host` cuando no esté en `/t/<tienda>`.
- No se implementó todavía para no retrasar la salida de Netlify.
