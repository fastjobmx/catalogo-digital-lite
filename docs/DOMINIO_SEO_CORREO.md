# TiendIA Exprés — Dominio, SEO técnico y sistema de correo

Fecha: 2026-11-10 · Rama: `feat/dominio-seo-correo` · **Nada de esto está en producción.**

Dominio previsto: `tiendiaexpres.com` (**pendiente de compra**). Ningún registro DNS, proyecto ni secreto remoto se ha tocado.

Leyenda de estados:

| Estado | Significado |
|---|---|
| **Implementado** | Código escrito y probado en local; no publicado. |
| **Preparado** | Configuración lista, inactiva hasta definir una variable o tener el dominio. |
| **Verificado** | Probado en local de punta a punta (Workers locales y base aislada). |
| **Pendiente** | Requiere tu autorización o un paso tuyo. |
| **Bloqueado** | No se puede hacer hasta comprar el dominio o tener una cuenta. |
| **Configurado remotamente** | Ninguno en esta fase. |

---

## 1. Arquitectura encontrada

| Pieza | Dónde vive | Hostname actual |
|---|---|---|
| Sitio comercial (landing) | Cloudflare **Pages**, proyecto `tiendaiaexpress`. Estático y prerenderizado (SSR en el build), sin Functions. | `tiendaiaexpress.pages.dev` |
| Plataforma: tiendas `/t/<tienda>`, panel `/admin`, superadmin `/plataforma`, prueba `/prueba` | **Worker con Static Assets** `catalogo-digital-ia` (`frontend/wrangler.jsonc`). Su script `frontend/cloudflare/worker.js` agrega los metadatos de cada página y reenvía `/api/*` por *service binding*. | `catalogo-digital-ia.catalogo-lite-worker.workers.dev` |
| API | Worker `catalogo-lite-api` (Hono + D1 `catalogo-lite-production-db` + R2 `catalogo-lite-production-assets`). Cron cada 15 minutos. | `catalogo-lite-api.catalogo-lite-worker.workers.dev` |
| MOSTRALO PUES! | Pages, proyecto `mostralopues`, independiente. | `mostralopues.pages.dev` (**no se toca**) |
| Netlify | Retirado; build cancelado (`netlify.toml`). | `catalogo-digital-ia.netlify.app` |

**Dependencias de hostname en el código**

| Dónde | Uso | Qué cambia con el dominio |
|---|---|---|
| `worker/wrangler.production.toml` → `PUBLIC_STORE_BASE_URL` | Todos los enlaces que genera el servidor: correos (recuperación, verificación, invitación, bienvenida), botones de Telegram, guías y pedidos. | Una sola variable: `https://app.tiendiaexpres.com`. |
| `worker/wrangler.production.toml` → `ALLOWED_ORIGIN` | CORS. El panel llama a `/api` en el **mismo origen** (service binding), así que CORS no interviene. | Agregar el origen nuevo es opcional e inofensivo. |
| `apps/tiendaiaexpress-landing` → `VITE_SITE_URL`, `VITE_APP_URL` (**nuevo**) | Canonical, Open Graph, sitemap y botones «Ingresar», «Prueba gratis» y «Tienda demo». | Variables de build. |
| `frontend` → `VITE_PLATFORM_SITE_URL` (**nuevo**) | Enlace de atribución «Creado con TiendIA Exprés» en cada catálogo. | Variable de build. |
| `worker/src/email/templates.ts` → `EMAIL_LOGO_URL` | Logo de los correos (`/brand/...` del hostname técnico). | **No hace falta cambiarlo:** `/brand/*` se sirve como archivo estático y nunca se redirige. |
| Webhooks de Telegram | Apuntan al hostname `workers.dev` del API. | **No se cambian** (requiere una migración aparte). |
| Sesiones | JWT en `localStorage` por origen. | Al pasar a `app.tiendiaexpres.com` cada persona inicia sesión una vez. Las pruebas sin registro vigentes (48 h) y los carritos guardados no se trasladan. |
| `store_domains` | Dominios propios de comercios (tabla existente). | **No se tocan.** |

**Autenticación y correo existentes** (en producción desde la migración `0014`): contraseñas PBKDF2, tokens de un solo uso guardados como hash (activación, recuperación de 60 min, verificación), sesiones que se cierran al cambiar la contraseña, respuesta genérica en «¿Olvidaste tu contraseña?», motor de correo con Resend **sin configurar** (cada envío queda como «Sin proveedor»), plantillas editables en `/plataforma/correos`.

**No existe registro público.** Las cuentas nacen por invitación (superadmin, bot maestro, activación de una prueba) y la persona crea su contraseña con un enlace seguro. Ver §20.

## 2. Dominio y DNS — **Bloqueado** (dominio sin comprar)

Topología recomendada (un solo cambio de variables por pieza, sin tocar el API ni Telegram):

| Hostname | Destino | Cómo |
|---|---|---|
| `tiendiaexpres.com` (canónico) | Pages `tiendaiaexpress` | **Custom domain** del proyecto Pages (no un CNAME suelto). |
| `www.tiendiaexpres.com` | 301 → `https://tiendiaexpres.com` | Custom domain en Pages + **Redirect Rule** que conserva ruta y parámetros. |
| `app.tiendiaexpres.com` | Worker `catalogo-digital-ia` | **Workers Custom Domain** (bloque comentado en `frontend/wrangler.jsonc`). |
| API | Sin cambios (`workers.dev`) | El panel la usa por service binding; los webhooks siguen igual. |

Alternativa descartada: servir tiendas y landing en el mismo hostname. Mezcla un proyecto Pages y un Worker en las mismas rutas y complica las reversiones.

Pasos (cuando lo compres y autorices):
1. Comprar en Cloudflare Registrar (los nameservers quedan en Cloudflare). Si es en otro registrador: agregar la zona y cambiar los nameservers.
2. Anotar los registros iniciales de la zona (respaldo).
3. Pages → `tiendaiaexpress` → Custom domains → `tiendiaexpres.com` y `www.tiendiaexpres.com`.
4. Regla de redirección `www` → apex (301, conserva ruta y consulta).
5. Descomentar `routes` en `frontend/wrangler.jsonc` y desplegar, o agregar el Custom Domain desde el panel.

## 3. HTTPS — **Bloqueado**

- Certificados administrados por Cloudflare (Pages y Workers Custom Domains los emiten y renuevan solos).
- SSL/TLS **Full (strict)** y **Always Use HTTPS** en la zona.
- HSTS: la landing ya envía `max-age=31536000` **sin** `includeSubDomains` ni `preload`. Mantenerlo así hasta que todos los subdominios (`app`, `send`, futuros) respondan por HTTPS. Activar `preload` es casi irreversible.
- Encabezados de seguridad: la landing tiene CSP estricta; el panel tiene `nosniff`, `X-Frame-Options`, `Referrer-Policy` y `Permissions-Policy` (`frontend/public/_headers`).

## 4. Redirecciones — **Preparado**

| Origen | Destino | Mecanismo | Estado |
|---|---|---|---|
| `www.tiendiaexpres.com/*` | `tiendiaexpres.com/*` | Redirect Rule 301 | Bloqueado |
| `tiendaiaexpress.pages.dev/*` | `tiendiaexpres.com/*` | **Bulk Redirect** de la cuenta (método recomendado por Cloudflare para `*.pages.dev`), con *preserve path* y *query*. Solo ese hostname exacto: **nunca** `mostralopues.pages.dev`. | Pendiente |
| `catalogo-digital-ia…workers.dev/*` | `app.tiendiaexpres.com/*` | Código nuevo en `frontend/cloudflare/worker.js`: `CANONICAL_ORIGIN` + `REDIRECT_TO_CANONICAL=true`. Solo GET y HEAD; **`/api/*` nunca se redirige**, así que imágenes, botones de Telegram y llamadas viejas siguen funcionando. | Implementado y probado; desactivado |

Antes de activar las redirecciones, comprobar en `app.`: login, `/t/<tienda>`, producto, pedido por WhatsApp, imágenes `/api/assets`, `/admin/activar`, `/admin/restablecer`, `/admin/verificar-correo`, `/prueba` y un botón de Telegram.

## 5. Auditoría SEO

| Hallazgo (producción hoy) | Impacto | Estado |
|---|---|---|
| `/robots.txt` y `/sitemap.xml` de la plataforma devolvían el HTML de la app (200). | Robots inválido, sin sitemap. | **Implementado y verificado:** se generan de verdad. |
| `/t/no-existe` respondía 200 («soft 404»). | Páginas basura indexables. | **Implementado y verificado:** 404 + `noindex`. |
| Tiendas y productos sin `canonical`. | Duplicados (`/product/` y `/producto/`, barra final, hostnames). | **Implementado y verificado.** |
| Sin datos estructurados en catálogos. | Sin resultados enriquecidos de producto. | **Implementado y verificado:** JSON-LD. |
| Búsqueda interna indexable. | Contenido escaso. | **Implementado:** `noindex, follow`. |
| El bundle principal (597 KB) incluía todo el panel para los compradores. | Peor LCP e INP en móvil. | **Implementado:** panel diferido. Ahora 424 KB y sin advertencia. |
| La landing es una sola página; título genérico. | Pocas consultas cubiertas. | Título y descripción actualizados; páginas nuevas, ver §20. |
| El `index.html` del panel carga 6 familias de Google Fonts para todas las tiendas. | Bloquea el render. | **Pendiente:** cargar solo la fuente del tema (cambio de diseño, no incluido). |
| La landing ya prerenderiza su HTML (SSR) y usa un interruptor único `VITE_ALLOW_INDEXING`. | Correcto. | Se conserva. |
| Faltan páginas legales (términos y privacidad). | Confianza; obligatorio para correo comercial. | **Pendiente:** contenido tuyo. |

## 6. Metadatos implementados

**Landing** (`apps/tiendaiaexpress-landing/index.html`):
- Title: `Tienda IA Express | Crea tu tienda online y catálogo digital con IA`.
- Description: «Crea tu tienda online y catálogo digital, carga productos con fotos, Excel o Telegram y recibe pedidos por WhatsApp. Herramientas de inteligencia artificial opcionales.» Ajustada a lo real: la importación por Excel y la carga desde fotos y Telegram existen; la IA se presenta como opcional, porque la creación de fichas desde una foto sigue «en pruebas finales» según el propio sitio.
- Ya tenía Open Graph, Twitter Card, favicon, manifest y `lang="es-CO"`. JSON-LD: `Organization` (con `sameAs` a las redes reales), `WebSite` y `SoftwareApplication` sin precios ni calificaciones.

**Plataforma** (`frontend/cloudflare/worker.js`, en el HTML antes del JavaScript):

| Página | Title | Robots | Canonical | JSON-LD |
|---|---|---|---|---|
| Tienda | Nombre del comercio | index | Sí | `OnlineStore` |
| Producto | `Producto \| Comercio` | index | `/producto/<sku>` | `Product` + `Offer` (solo con precio y moneda reales; `InStock` solo si hay stock) + `BreadcrumbList` |
| Búsqueda | `Buscar \| Comercio` | noindex, follow | No | No |
| Panel, plataforma, login, recuperación, verificación, activación | Tienda IA Express | noindex, nofollow (meta + `X-Robots-Tag`) | No | No |
| Prueba sin registro | Tienda IA Express | noindex, nofollow | No | No |
| Inexistente, borrador o suspendida | «Página no encontrada» | **404**, noindex | No | No |

Cada tienda conserva su nombre, descripción, logo e imágenes. Nunca se usan reseñas, calificaciones ni precios inventados.

## 7. Robots y sitemaps

- **Landing:** `robots.txt` con `Sitemap:` y `sitemap.xml` solo cuando `VITE_ALLOW_INDEXING=true`. Hoy: `noindex` antes del lanzamiento, sin cambios.
- **Plataforma** (Implementado y verificado):
  - `/robots.txt`: permite todo salvo `/api/`, con excepción de `/api/assets/`. Las áreas privadas usan `noindex` y no `Disallow`, para que el buscador pueda leerlo.
  - `/sitemap.xml`: índice de sitemaps → `/sitemaps/tiendas.xml` más `/sitemaps/productos/<tienda>.xml` por tienda. Hasta 50 000 URL por archivo, así escala a miles de comercios.
  - Datos de `GET /api/seo/stores` y `GET /api/seo/stores/:slug/products`. Solo incluye tiendas **activas** con configuración y productos **activos y no archivados**, sin campos privados. Caché de 1 hora.

## 8. Search Console — **Bloqueado**

Requiere tu cuenta de Google:
1. Crear la propiedad de **dominio** `tiendiaexpres.com` (cubre el apex, `www` y `app`) y verificarla con el TXT `google-site-verification=…` en Cloudflare DNS.
2. Enviar `https://tiendiaexpres.com/sitemap.xml` y `https://app.tiendiaexpres.com/sitemap.xml`.
3. Inspeccionar la portada, una tienda y un producto; pedir la indexación.
4. GA4 y conversiones: no se instaló nada (la CSP de la landing bloquea scripts externos). Si lo autorizas, la opción liviana es Cloudflare Web Analytics; GA4 requiere ajustar la CSP y un aviso de cookies.

Enviar un sitemap no garantiza la indexación. No hay métricas ni posiciones que reportar todavía.

## 9. Proveedor de correo — **Resend** (ya integrado)

| | Resend | Cloudflare Email Sending | Brevo | Postmark |
|---|---|---|---|---|
| Estado | Estable, ya integrado en el código | **Beta pública** desde abril de 2026, solo Workers Paid, precio final sin publicar | Estable | Estable |
| Workers | `fetch` a la API (en uso) | Binding nativo | API HTTP | API HTTP |
| Webhooks de entrega, rebote y queja | Sí, en todos los planes | Limitados | Sí | Sí |
| Idempotencia nativa | Sí (`Idempotency-Key`) | No documentada | No | No |

Decisión: **mantener Resend.** Ya está en el código, tiene idempotencia y webhooks firmados, y Cloudflare Email Sending sigue en beta, lo que no conviene para correos de acceso. El envío pasa por una sola función (`deliverOnce`), así que migrar de proveedor más adelante toca un solo archivo.

## 10. Costos (consultados el 2026-11-10)

- Resend Free: 0 USD, 3 000 correos al mes, máximo 100 por día, 1 endpoint de webhook. Alcanza para empezar.
- Resend Pro: 20 USD al mes por 50 000 correos, sin límite diario; excedente de 0,90 USD por cada 1 000.
- Cloudflare Email Routing (recepción y reenvío): gratis. DMARC Management de Cloudflare: gratis.
- Dominio `.com` en Cloudflare Registrar: a precio de costo. Confirma el valor al comprarlo.

## 11. SPF, DKIM y DMARC — **Bloqueado** (los valores los entrega Resend al agregar el dominio; no se inventan)

| Nombre | Tipo | Origen del valor | Para qué |
|---|---|---|---|
| `resend._domainkey.tiendiaexpres.com` | TXT | Resend (clave DKIM) | Firma DKIM alineada con el remitente. |
| `send.tiendiaexpres.com` | MX | Resend | Retorno de rebotes (aísla el *return-path*). |
| `send.tiendiaexpres.com` | TXT | Resend (`v=spf1 include:…`) | SPF del *return-path*. Alineación relajada con el dominio raíz. |
| `tiendiaexpres.com` | MX + TXT SPF | Cloudflare Email Routing (los crea él) | Recepción de `soporte@`, `ventas@`, `seguridad@`. Un solo SPF en la raíz. |
| `_dmarc.tiendiaexpres.com` | TXT | Tú | Fase 1: `v=DMARC1; p=none; rua=mailto:<dirección de informes>; fo=1`. Tras 2 a 4 semanas de informes limpios: `p=quarantine`. Después: `p=reject`. |

`/plataforma/correos` → **Verificar configuración** consulta el DNS público por DoH y marca qué falta. También detecta varios registros SPF en el mismo nombre.

**Direcciones propuestas**

| Dirección | Envío | Recepción | Bandeja real |
|---|---|---|---|
| `notificaciones@` | **Remitente** de todos los correos automáticos (`EMAIL_FROM`) | Reenvío opcional | No |
| `soporte@` | Reply-To (`EMAIL_REPLY_TO`) | Email Routing → tu correo verificado | Sí, para responder |
| `ventas@` | No | Email Routing | Sí |
| `seguridad@` | No | Email Routing | Sí |
| `bienvenida@` | **No se recomienda:** sería otra identidad sin función propia. La bienvenida sale de `notificaciones@`. | — | — |

Email Routing solo reenvía. Para **responder como** `soporte@`, configura «Enviar como» en Gmail con el SMTP de Resend (`smtp.resend.com`). Así no hace falta un proveedor de buzones pago.

## 12. Plantillas de correo — **Implementado**

Todas con logo, colores de marca, diseño responsive en tablas, versión HTML y versión de texto plano, y soporte por WhatsApp en el pie. Nunca contienen contraseñas.

| Clave | Asunto | Disparador | Categoría |
|---|---|---|---|
| `email_verification` | Confirma tu correo electrónico \| TiendIA Exprés | Usuarios y accesos, regularización | Seguridad |
| `welcome` | ¡Bienvenido a TiendIA Exprés! Tu tienda está lista para comenzar | Activación de cuenta con correo verificado. Incluye negocio, usuario, **plan**, **dirección de la tienda** y acceso al panel. | Bienvenida |
| `password_reset` | Restablece tu contraseña \| TiendIA Exprés | «¿Olvidaste tu contraseña?» (enlace de 60 min, un solo uso) | Seguridad |
| `password_changed` (**nueva**) | Tu contraseña fue cambiada \| TiendIA Exprés | Restablecimiento completado (sin enlaces de acceso) | Seguridad |
| `invitation` | Te invitaron a administrar {{nombre_comercio}} | Invitación administrativa | Seguridad |
| `admin_notice` | Aviso sobre {{nombre_comercio}} | Avisos del superadmin | Avisos |

Las plantillas de sistema que no editaste se actualizan solas al nuevo diseño. Las que editaste se respetan.

Pedidos, facturación y reportes: **no se crearon**. Ver §20.

## 13. Pruebas de envío — **Pendiente**

No se envió ningún correo real: no hay cuenta de Resend ni dominio. Las pruebas automáticas simulan al proveedor. Que la API acepte un mensaje **no** prueba que llegue a la bandeja: el estado «Entregado» solo aparece cuando el webhook de Resend lo confirma.

Cuando exista el dominio, enviar desde `/plataforma/correos` a Gmail, Outlook y Yahoo. Revisar «Mostrar original»: `SPF=PASS`, `DKIM=PASS` y `DMARC=PASS`, y que no llegue a spam.

## 14. Panel «Correos y notificaciones» — **Implementado** (`/plataforma/correos`)

Nuevo bloque «Estado del servicio de correo»:
- Proveedor, remitente, Reply-To y si el webhook está configurado. **Nunca muestra claves.**
- Contadores de 30 días: registrados, aceptados por el proveedor, entregados (confirmados por webhook), rebotes y quejas, fallidos y sin proveedor.
- **Alerta** cuando fallan o rebotan correos de verificación, recuperación o invitación en los últimos 7 días.
- **Verificar configuración**: SPF, DKIM, DMARC y MX de rebotes del dominio remitente. Solo lee el DNS público.
- **Categorías**: «Seguridad y acceso» es esencial y no se puede pausar. «Bienvenida» y «Avisos administrativos» se pueden pausar.
- **Direcciones bloqueadas** por rebote permanente o queja, con «Desbloquear» auditado.
- El historial muestra el estado de entrega y el número de intentos.

Se conservan las funciones que ya existían: plantillas, vista previa, envío de prueba solo a direcciones autorizadas, historial y regularización.

Limitación: no hay botón «Reintentar». El sistema no guarda enlaces ni tokens, a propósito, así que no puede reenviar un enlace viejo. Los errores transitorios se reintentan solos (hasta 3 intentos con la misma clave de idempotencia) y la persona puede volver a pedir el enlace.

## 15. Archivos modificados

**API** (`worker/`):
- Nuevos: `src/routes/seo.ts`, `src/routes/email.ts` (webhook), `src/email/webhooks.ts` (firma Svix, eventos, verificación DNS).
- Modificados: `src/email/send.ts` (reintentos, supresión, categorías, Reply-To, etiquetas, retención), `src/email/templates.ts`, `src/email/manage.ts`, `src/routes/platform.ts`, `src/routes/auth.ts` (aviso de cambio de contraseña y datos de bienvenida), `src/index.ts` (rutas, variables y retención diaria en el cron).
- Pruebas: `src/routes/seo.test.ts`, `src/routes/email-delivery.test.ts`, `src/routes/users-email.test.ts`.

**Base de datos:** `database/migrations/0019_email_delivery.sql`, solo aditiva: estado de entrega, intentos, `email_events`, `email_suppressions` y `email_category_settings`. Reversión en `database/rollback/0019_email_delivery.down.sql`.

**Plataforma** (`frontend/`):
- Nuevo: `src/admin/PlatformEmailHealth.tsx`.
- Modificados: `cloudflare/worker.js` y `cloudflare/worker.test.ts`, `src/App.tsx` (panel diferido), `src/admin/PlatformEmailPage.tsx`, `src/services/api.ts`, `src/lib/platformBrand.ts`, `.env.cloudflare`, `wrangler.jsonc` (bloque del dominio comentado).

**Landing:** `index.html`, `vite.config.ts`, `src/config/site.ts`, `src/types/globals.d.ts`, `.env.example`.

**Raíz:** `.env.example`, `docs/DOMINIO_SEO_CORREO.md`, `README.md`.

## 16. Variables necesarias

| Variable | Dónde | Tipo | Valor previsto |
|---|---|---|---|
| `RESEND_API_KEY` | API | **Secreto** (`wrangler secret put --config wrangler.production.toml`) | Clave de Resend con permiso solo de envío |
| `RESEND_WEBHOOK_SECRET` | API | **Secreto** | `whsec_…` del webhook de Resend |
| `EMAIL_PROVIDER` | API | Variable | `resend` |
| `EMAIL_FROM` | API | Variable | `TiendIA Exprés <notificaciones@tiendiaexpres.com>` |
| `EMAIL_REPLY_TO` | API | Variable | `soporte@tiendiaexpres.com` |
| `EMAIL_TEST_RECIPIENTS` | API | Variable | Tus direcciones de prueba |
| `EMAIL_LOG_RETENTION_DAYS` | API | Variable | `180` (por defecto) |
| `PUBLIC_STORE_BASE_URL` | API | Variable | `https://app.tiendiaexpres.com` |
| `ALLOWED_ORIGIN` | API | Variable | Agregar `https://app.tiendiaexpres.com` (opcional) |
| `CANONICAL_ORIGIN` / `REDIRECT_TO_CANONICAL` | Worker `catalogo-digital-ia` | Variables | `https://app.tiendiaexpres.com` / `false`, y luego `true` |
| `VITE_PLATFORM_SITE_URL` | Build del panel | Build | `https://tiendiaexpres.com/` |
| `VITE_SITE_URL`, `VITE_APP_URL`, `VITE_ALLOW_INDEXING` | Build de la landing | Build | `https://tiendiaexpres.com`, `https://app.tiendiaexpres.com`, `true` el día del lanzamiento |

Webhook en Resend: `https://catalogo-lite-api.catalogo-lite-worker.workers.dev/api/email/webhooks/resend` con los eventos `delivered`, `delivery_delayed`, `bounced`, `complained` y `failed`.

## 17. Cambios remotos realizados

**Ninguno.** No se tocó producción, DNS, Pages, Workers, D1, R2 ni secretos. Las únicas consultas a producción fueron GET públicos de solo lectura (portada, `robots.txt`, `sitemap.xml`, una tienda inexistente y `/api/products`) para la auditoría.

## 18. Pruebas

| Conjunto | Resultado |
|---|---|
| API (`worker`, vitest) | **40 archivos en verde**, con 12 pruebas nuevas: sitemap, reintentos, idempotencia, supresión, categorías, webhook firmado (firma inválida, vencida o duplicada, rebote transitorio contra permanente), retención, verificación DNS y panel. |
| Panel (`frontend`, vitest) | **21 archivos en verde**, con 7 pruebas nuevas del Worker de tiendas (canonical, redirección, JSON-LD sin calificaciones, robots, sitemaps y 503 sin API). La del 404 con HTMLRewriter se omite en Node y se verificó con `wrangler dev`. |
| Typecheck | API, panel y landing correctos. |
| Builds | Panel (`build:cloudflare`) y landing (`build` + `check-dist`) correctos. Simulación de la landing con el dominio: canonical, robots y sitemap en `tiendiaexpres.com`. |
| Punta a punta local | `wrangler dev` de los dos Workers con base D1 aislada (todas las migraciones, incluida `0019`). Tienda 200 con su canonical y JSON-LD. Producto con `Offer` real. Inexistente, borrador y producto inexistente: 404 + `noindex`. Búsqueda `noindex, follow`. Login `noindex`. `robots.txt`, índice, sitemap de tiendas y de productos (sin borradores ni archivados). Webhook sin secreto: 503. |
| No verificado | Vista visual del nuevo bloque del panel (el login local del superadmin no quedó operativo en la prueba aislada), correos reales, DNS real, Search Console, redirecciones reales y rendimiento móvil medido (Lighthouse). |

## 19. Reversión

- **Código:** la rama no está fusionada. Si se publica, antes de cada despliegue se anotan los IDs de versión actuales:
  - Panel: `cd frontend; node ../worker/node_modules/wrangler/bin/wrangler.js rollback <versión-anterior>`
  - API: `cd worker; npx wrangler rollback <versión-anterior> --config wrangler.production.toml`
  - Landing: Pages → Deployments → *Rollback* al despliegue anterior.
- **Base de datos:** respaldo y punto de Time Travel antes de aplicar `0019`. Si hace falta revertir: `database/rollback/0019_email_delivery.down.sql`.
- **Redirecciones:** `REDIRECT_TO_CANONICAL=false` (inmediato) y desactivar la regla Bulk Redirect de `pages.dev`.
- **Dominio:** quitar los Custom Domains de Pages y del Worker. Los hostnames técnicos nunca dejan de funcionar.
- **Correo:** borrar `EMAIL_PROVIDER` y todo vuelve a «Sin proveedor». DMARC con `p=none` no bloquea nada.

## 20. Pendientes de autorización o decisión

1. **Comprar `tiendiaexpres.com`** (Cloudflare Registrar recomendado) y confirmar la topología `apex` = landing, `app.` = plataforma.
2. **Autorizar el despliegue** de esta rama: migración `0019`, API, panel y landing. Hoy no cambia nada visible para los compradores, salvo los 404 correctos, el SEO y un bundle más liviano.
3. **Crear la cuenta de Resend** (permiso necesario: tu cuenta), agregar el dominio y copiar sus registros DNS. Cargar los secretos tú mismo con `wrangler secret put` (no los pegues en el chat).
4. **Email Routing:** verificar tu correo de destino y crear las reglas `soporte@`, `ventas@`, `seguridad@` y la dirección para informes DMARC.
5. **Search Console:** tu cuenta de Google y el TXT de verificación.
6. **Decisiones de producto** (no implementadas a propósito):
   - **Registro público:** hoy no existe. Si lo quieres, define la aprobación, el plan inicial y la protección contra abuso (Turnstile). La verificación de correo ya existe.
   - **Correos de pedidos al comprador:** el pedido llega por WhatsApp, el correo del comprador es opcional y no hay consentimiento registrado. Definir el canal y el consentimiento antes de enviar.
   - **Facturación** (plan, vencimiento, pago, créditos IA): no hay eventos de pago verificados que respalden esos correos.
   - **Reportes semanales:** requieren preferencias de suscripción por usuario.
   - **Marketing:** subdominio propio (p. ej. `novedades.`), consentimiento explícito, baja en un clic y sin mezclar compradores de distintos comercios.
7. **Contenido comercial:** términos y privacidad, y páginas reales para planes, preguntas frecuentes, catálogo para WhatsApp e importación de productos. El contenido ya existe en secciones de la landing; convertirlo en páginas exige textos tuyos, no páginas de relleno.
8. **Rendimiento:** cargar solo la fuente del tema de cada tienda y medir con Lighthouse y Search Console (Core Web Vitals) después del lanzamiento.

---

## 21. Despliegue etapa 1 (2026-11-10, autorizado: «Yes, stage 1»)

Dominio comprado en Cloudflare Registrar (misma cuenta que los Workers). Zona activa con los nameservers `bob` y `desiree.ns.cloudflare.com`.

### Qué se publicó (commit `f3c32ad`)

| Pieza | Antes | Después |
|---|---|---|
| Respaldo D1 | — | `.tmp/production-0019/production-pre-0019.sql` (2347 `INSERT`) |
| Punto Time Travel | — | `000003bc-00000000-0000511f-898c9a7269d94f115bf83acc10f86c26` |
| Base `catalogo-lite-production-db` | migraciones hasta `0018` | `0019_email_delivery` aplicada |
| API `catalogo-lite-api` | `d56b0a5c-91ba-4f73-a4cd-3c66c18ea3e8` | `97c00587-226f-4e70-be27-4454cababf15` (los 10 secretos intactos, sin variables de correo nuevas) |
| Panel `catalogo-digital-ia` | `d2123104-d9d5-4850-8806-8fdd1372dec5` | `51fd1f28-f0d7-4bbc-8ecc-cafda9eb9ea8` + Custom Domain **`app.tiendiaexpres.com`**, `CANONICAL_ORIGIN=https://app.tiendiaexpres.com`, `REDIRECT_TO_CANONICAL=false` |

### Verificación en vivo

- **Probado en los dos hostnames** (`app.tiendiaexpres.com` y `workers.dev`), con resultados idénticos:
  - Responden 200: portada, tienda `luz-magica`, producto `LM-005`, login, restablecer, verificar correo, activar, plataforma, prueba, `robots.txt`, índice de sitemaps, sitemap de tiendas y de productos, `/api/health`, `/api/store`, favicon y logo `/brand`.
  - Responden 404 con `noindex`: tienda y producto inexistentes.
  - La búsqueda envía `noindex, follow` y las páginas privadas `noindex, nofollow`.
- **Metadatos reales:** el producto `LM-005` muestra «Tocador Imperia | Luz Mágica», canonical en `app.`, JSON-LD `OnlineStore`, `Product` y `Offer` en COP, y su `og:image` responde 200 (`image/webp`).
- **Navegador:** la tienda y el login cargan, las llamadas a `/api/*` y las imágenes `/api/assets/*` responden 200 y no hay errores en la consola.
- **API:** el `POST` de «¿Olvidaste tu contraseña?» con un correo inexistente responde la respuesta genérica.
- **Conteos iguales antes y después:** 5 tiendas, 167 productos, 19 pedidos, 4 usuarios, 5 membresías y 1 registro de correo.

### Observaciones

- `http://app.tiendiaexpres.com` responde 200 sin redirigir a HTTPS. Falta activar **Always Use HTTPS** en la zona (SSL/TLS → Edge Certificates); el CLI no tiene permiso de configuración de zona.
- `tiendiaexpres.com` y `www` todavía no responden: falta agregarlos como Custom domains del proyecto Pages `tiendaiaexpress`.
- Los enlaces de correos y Telegram siguen usando `workers.dev` (`PUBLIC_STORE_BASE_URL` sin cambios) hasta la etapa 2.

### Reversión de la etapa 1

```
cd frontend; node ../worker/node_modules/wrangler/bin/wrangler.js rollback d2123104-d9d5-4850-8806-8fdd1372dec5
cd worker; npx wrangler rollback d56b0a5c-91ba-4f73-a4cd-3c66c18ea3e8 --config wrangler.production.toml
```

- Quitar el Custom Domain `app.tiendiaexpres.com` en Workers → `catalogo-digital-ia` → Settings → Domains.
- La migración `0019` es aditiva y compatible con el código anterior: no hace falta revertirla. Si se quisiera, usar `database/rollback/0019_email_delivery.down.sql` o el punto de Time Travel.
