# MOSTRALO PUES! — Reporte de fases B, C y D

Fecha: 2026-11-04. **Estado: publicado** en https://mostralopues.pages.dev, con autorización del propietario.

## 0. Publicación (2026-11-04)

**Destino:** proyecto Cloudflare Pages `mostralopues`, rama de producción `main`, despliegue `6cff6fa8`.

**Por qué cambió de Worker a Pages:**

- El propietario pidió una URL más corta.
- Un Worker solo puede vivir bajo `*.catalogo-lite-worker.workers.dev`, y cambiar ese subdominio de la cuenta afectaría a la plataforma y a los webhooks.
- El Worker `mostralopues` **no se creó**.

**Verificación en vivo:**

| Prueba | Resultado |
|---|---|
| Página, `robots.txt`, `og.png` y favicon | 200 |
| Ruta inexistente y `sitemap.xml` | 404 |
| Compresión | Brotli; HTML de 20 KB transferidos |
| Encabezados | Seguridad completa (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy) y `X-Robots-Tag: noindex` |
| Caché de recursos con hash | `immutable` |
| Playwright contra la URL publicada | 20/20 |
| Seis anchuras | Sin errores ni desbordes |

**Lighthouse en vivo, con la CDN de Cloudflare:**

| | Performance | Accesibilidad | Buenas prácticas | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|
| Móvil | 90 | 100 | 100 | 66* | 3,4 s | 0 | 20 ms |
| Escritorio | 98 | 100 | 100 | 66* | 0,8 s | 0 | 70 ms |

\* SEO 66 por el `noindex` intencional.

El LCP móvil simulado sigue por encima de 2,5 s; ver §8.

## 1. Qué se construyó

Una página completa, en español con voseo, con el concepto «De una foto a un negocio en movimiento».

| Sección | Contenido | Movimiento |
|---|---|---|
| Navegación | Logo oficial en píldora marfil, 7 enlaces, «Ingresar a mi tienda», «Quiero mi tienda». Menú móvil a pantalla completa, accesible. | Sombra al hacer scroll |
| Hero | «SI NO LO **MOSTRÁS**, NO LO **VENDÉS.**», subtítulo, 2 CTA. Teléfono 3D con la captura real de SneakerHub, 3 tarjetas con productos reales y chips Foto, Mensaje y Venta. | Entrada orquestada en CSS (marca, título por líneas, subrayado dibujado, teléfono, tarjetas, CTA), sin esperar al JS. Parallax sutil con el cursor. |
| Cómo funciona | Escenas **Mostrá · Organizá · Vendé**, todo con datos reales: foto, ficha, categorías, tallas, carrito y pedido por WhatsApp. | Escena fija ligada al scroll: el escenario oscuro se expande, el teléfono gira y cambia entre 4 capturas reales. Barra de progreso. |
| Asistente | Chat de Telegram **etiquetado «Demostración ilustrativa»** y 5 pasos: foto, información, ficha, confirmación, publicado. | Se reproduce una vez al entrar en pantalla; botón «Repetir demostración» |
| Capacidades | Bento de 8 tarjetas **disponibles**, cada una con su interacción: plantillas reales, categorías, tallas, carrito, WhatsApp, Telegram, estados de pedido, paletas. Lista «Y además» (5 reales) y «En camino» (5 próximas). | Interacciones con botón, no solo hover |
| Demo | Capturas reales de SneakerHub en navegador y teléfono, con pestañas Inicio, Producto y Carrito. «Explorar tienda demo» abre en pestaña nueva. | Cambio de pestaña |
| Beneficios | Tres titulares gigantes, cada uno con su demostración: copiar enlace (funcional), chat (ilustrativo), teléfono con WhatsApp. | Revelado por palabras con scroll |
| Crear vs administrar | Dos columnas: tienda y asistente | — |
| Planes | Catálogo Lite, Catálogo IA y Soluciones a medida. **Sin precios.** Botones «Consultá este plan» (WhatsApp) y «Solicitá tu tienda» (preselecciona el plan). | — |
| Preguntas frecuentes | 8 respuestas verificadas, en acordeón nativo `<details>` | — |
| Contacto | Formulario que prepara el mensaje en WhatsApp | Estados de carga y resultado |
| Footer | Logo en placa marfil, eslogan, navegación, enlaces para comercios y redes | — |

### Movimiento reducido y sin JavaScript

- **Movimiento reducido:** la historia se muestra como una lista estática con capturas reales. Sin escena fija, sin parallax y sin animaciones.
- **Sin JavaScript:** todo el contenido está en el HTML prerenderizado.

## 2. Aislamiento (confirmado)

- **Archivos creados:** solo dentro de `apps/mostralopues-landing/`, más `docs/MOSTRALOPUES_FASE_A.md` y una línea en `PROGRESO.md`.
- **Plataforma sin tocar:** no se modificó `frontend/`, `worker/`, `database/`, ningún Worker existente, D1, R2, bot, webhook, autenticación ni la tienda SneakerHub.
- **SneakerHub en modo lectura:**
  - Solo se leyó la API pública (`GET /api/products`, `/api/categories`, `/api/store`).
  - Las capturas se tomaron con un navegador sin sesión.
  - Se agregó un producto al carrito **solo dentro de ese navegador de prueba**: el carrito es local, sin checkout y sin envío.
- **Único recurso nuevo en Cloudflare:** el proyecto Pages `mostralopues`, creado al publicar. El Worker `mostralopues` no existe: `wrangler deployments list --name mostralopues` responde «does not exist».
- **`wrangler.jsonc`:**
  - `name: "mostralopues"`.
  - Solo `pages_build_output_dir: ./dist`.
  - Sin Functions, bindings, secretos ni dominios.
  - No apunta a `catalogo-digital-ia` ni a `catalogo-lite-api`.
  - `scripts/check-dist.mjs` verifica antes de publicar que `dist/` no contenga referencias a la API privada ni a secretos.

## 3. Build y dry-run

**`npm run build`:** typecheck, build de cliente, build SSR y prerender.

| Recurso | Tamaño |
|---|---|
| JS inicial | 97 KB gzip |
| GSAP (diferido) | 44 KB gzip |
| Teléfono 3D (diferido) | 143 KB gzip |
| CSS | 12 KB gzip |
| Transferencia inicial en móvil (Lighthouse) | ~300 KB |

**Antes de publicar:**

- **Dry-run del Worker** (`wrangler deploy --dry-run`, cuando el plan era un Worker): leyó 58 archivos, respondió «No bindings found» y no publicó nada.
- **Comprobación de `dist/` con `npm run cf:check`:** 57 archivos, señales de indexación coherentes y sin referencias privadas.
- **Publicación con `wrangler pages deploy`:** 56 archivos más `_headers`.

## 4. Pruebas

### Playwright: `tests/site.spec.ts`, 20/20 en escritorio 1440 y móvil 390

**Página:**

- Carga sin errores de consola.
- Un solo `h1`.
- El contenido está en el HTML sin JavaScript.

**SEO e indexación:**

- `meta robots` noindex.
- Encabezado `X-Robots-Tag`.
- `robots.txt` sin sitemap.
- Sin canonical.
- `/sitemap.xml` responde 404.

**Enlaces:**

- Cada enlace interno (`#...`) apunta a una sección que existe.
- Los enlaces externos abren en pestaña nueva con `noopener`.
- Se usan los destinos configurados: tienda, panel, WhatsApp, Facebook, Instagram y TikTok.

**Imágenes:** todas tienen `alt`.

**Movimiento reducido:**

- Muestra el diseño estático con las 3 escenas.
- Sin escena fija.

**Formulario:**

- Vacío: muestra errores junto a cada campo y no abre WhatsApp.
- Completo: abre `wa.me/573506912734` con el mensaje armado y avisa que falta enviarlo.
- El campo trampa (honeypot) bloquea el envío.

**Teclado:**

- «Saltar al contenido» es el primer foco.
- El menú móvil abre con Enter, cierra con Escape y devuelve el foco.

### Destinos reales: `tests/links.spec.ts` y comprobación en navegador

| Destino | Resultado |
|---|---|
| Tienda demo `https://catalogo-digital-ia.catalogo-lite-worker.workers.dev/` | 200, SneakerHub Premium |
| Panel `…/admin/login` | 200. El inicio de sesión no depende de la tienda: devuelve las tiendas de la cuenta. |
| WhatsApp `wa.me/573506912734` | 200, abre el chat del +57 350 691 2734 |
| Facebook `facebook.com/mostralopues/` | Página «Mostralo PUES». A bots les responde 400; se verificó en un navegador real. |
| Instagram `instagram.com/mostralopues/` | 200, «MOSTRALO PUES! \| Tiendas con IA (@mostralopues)» |
| TikTok `tiktok.com/@mostralopues` | 200, perfil «mostralopues» con la bio «Si no lo mostrás, no lo vendés.» |

### Anchuras: 360, 390, 768, 1024, 1440 y 1920

En todas:

- Sin errores de consola.
- Sin desplazamiento horizontal.
- Sin contenido recortado fuera de la pantalla: el script también detecta lo que oculta `overflow: hidden`.

**Capturas:** en [`docs/capturas/`](docs/capturas/):

- Hero en cada ancho.
- Las tres escenas en escritorio y en móvil.
- Todas las secciones a 1440 y 390.

### Lighthouse 13.5 (medido, no estimado)

Medido sobre el build servido con compresión, como Cloudflare (`scripts/serve.mjs`). Chrome 145 sin interfaz, con GPU Intel UHD. Reportes HTML de la medición en vivo en `tests/lighthouse/live-*.report.html`.

| | Performance | Accesibilidad | Buenas prácticas | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|
| Móvil (4G simulado, CPU ×4) | **93** | **100** | **100** | 66* | 3,0 s | 0 | 20 ms |
| Escritorio | **99** | **100** | **100** | 66* | 0,8 s | 0 | 20 ms |

\* El SEO baja **solo** por `is-crawlable`: es el `noindex` intencional de prepublicación. Con `VITE_ALLOW_INDEXING=true` esa auditoría pasa.

**Objetivos frente a lo medido:**

| Objetivo | Resultado |
|---|---|
| Performance ≥ 90 | ✅ |
| Accesibilidad ≥ 95 | ✅ |
| CLS ≤ 0,1 | ✅ |
| LCP ≤ 2,5 s en escritorio | ✅ |
| LCP ≤ 2,5 s en móvil simulado | ❌ **No se cumple: 3,0 s** |

Sobre el LCP en móvil:

- **Elemento:** la primera captura del teléfono, de 37 KB.
- **Por qué:** el modelo de Lighthouse simula una red 4G lenta.
- **Pendiente:** debe medirse otra vez en la URL publicada, con la CDN de Cloudflare.

**Optimizaciones aplicadas durante el refinamiento** (todas medidas, antes y después):

| Cambio | Efecto |
|---|---|
| GSAP diferido | JS inicial de 142 a 97 KB gzip |
| Three.js sin R3F ni drei | Chunk 3D de 263 a 143 KB gzip |
| Reflejos matcap generados por código en lugar de PMREM | Sin tareas largas al iniciar el 3D. TBT de escritorio de 450 a 20 ms. |
| Bucle del teléfono CSS solo cuando algo cambia | — |
| 3D en móvil solo tras el primer scroll | — |
| 3D desactivado en GPU por software | — |
| Pose inicial en unidades de contenedor | CLS de 0,066 a 0 |
| Precarga de fuentes | — |
| Capturas en 480/720 con `srcset` | — |

## 5. Funciones reales, demostraciones y futuras

**Disponible** (verificado en el código y en producción):

- Catálogo responsive con 13 plantillas.
- Productos y categorías.
- Precios y variantes con stock.
- Carrito.
- Pedido por WhatsApp.
- Panel web.
- Administración desde Telegram.
- Personalización con paletas a partir del logo.
- Varias tiendas en una cuenta de Telegram.
- Pedidos con estados: recibido, confirmado, en preparación, enviado y entregado, con transportadora y guía.
- Inventario por talla con movimientos.
- Cupones.
- Equipo con roles.

**Demostración ilustrativa** (etiquetada en la página):

- Conversación de Telegram completa, de la foto a la publicación.
- Chat de cambio de precio.
- Ejemplos «Cargá 10 pares…» y «Pedido de ejemplo».

**Próximamente** (etiquetado «Próximamente» o «En camino»):

- Fichas con IA desde una foto: programada, falta verificarla con Gemini real.
- Mejoramiento fotográfico.
- Estadísticas avanzadas.
- Asistente de ventas.
- Promociones inteligentes.

**No disponible** (se dice en las preguntas frecuentes):

- Pagos en línea.
- Registro automático: el alta la hace el equipo.

**Sin cifras inventadas:** no hay testimonios, ventas, precios, descuentos ni garantías.

## 6. Estado de los CTA

| CTA | Destino | Estado |
|---|---|---|
| Quiero mi tienda / Solicitá tu tienda | Formulario → WhatsApp +57 350 691 2734 | ✅ Funciona. Avisa que falta tocar «Enviar» en WhatsApp. |
| Ver una tienda real / Explorar tienda demo | Tienda SneakerHub | ✅ 200, pestaña nueva |
| Ingresar a mi tienda | `/admin/login` de la plataforma | ✅ 200 |
| Consultá este plan | WhatsApp con el plan en el mensaje | ✅ |
| Redes sociales | Facebook, Instagram y TikTok | ✅ Comprobadas |

## 7. Pendientes de configuración

1. **Indexación:** el sitio está publicado con `noindex`. Cuando sea el lanzamiento oficial, `VITE_ALLOW_INDEXING=true` y volver a desplegar.
2. **Enlaces legales:** términos y privacidad todavía no existen. Se agregan en `site.legal` y aparecen solos en el footer.
3. **Planes:** confirmar nombres y contenido de las tres categorías (hoy dicen «Categorías de servicio propuestas»).
4. **Indexación:** cuando haya dominio oficial, `VITE_SITE_URL=<dominio>` y `VITE_ALLOW_INDEXING=true`. Dominio propio: Custom domain en el proyecto Pages `mostralopues`, aparte y con autorización.
5. **Fichas con IA desde una foto:** si se verifica con Gemini real, pasarla de «En camino» a «Disponible» en `src/content/copy.ts`.
6. **Formulario con backend propio:** opcional, más adelante.
   - Endpoint con Cloudflare Turnstile (Pages Function o Worker propio de este sitio).
   - Destino nuevo: correo o un bot propio.
   - No debe reutilizar los secretos ni los bots de la plataforma.

## 8. Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| LCP móvil simulado de 3,0 s (> 2,5 s) | Medir en producción. Si persiste: captura inicial más liviana o mostrar el teléfono solo tras la primera pintura. |
| Las capturas de SneakerHub cambian con la tienda | La página dice la fecha de captura. Para actualizar: `node scripts/snapshot-sneakerhub.mjs && python scripts/optimize_images.py`. |
| El 3D se desactiva en equipos lentos, sin GPU, con ahorro de datos o con movimiento reducido | Es intencional: el teléfono CSS usa la misma trayectoria y las mismas capturas |
| Copias transparentes del logo derivadas de PNG | Reemplazables por PNG transparente o SVG oficial. Los originales están en `brand-originals/`. |
| Mensaje de WhatsApp: el texto viaja en la URL de `wa.me` | Solo lo abre la persona y no se guarda nada. Está explicado en el formulario. |
| Facebook bloquea comprobaciones automáticas | Verificado a mano en navegador real |

## 9. Skills y herramientas utilizadas

| Herramienta | Uso |
|---|---|
| **`frontend-design`** (Anthropic, `anthropics/claude-plugins-official`) | Procedencia revisada; plugin disponible pero no instalado en esta sesión. Se leyeron y aplicaron sus instrucciones: plan en dos pasadas, un solo momento de movimiento orquestado, nada de tarjetas idénticas ni etiquetas genéricas, autocrítica con capturas. Donde contradice el brief (acentuar MOSTRÁS y VENDÉS, titulares en mayúsculas), manda el brief. |
| **`ui-ux-pro-max`** (instalada) | Lista previa a la entrega, guía GSAP de pinning y scroll, tipografía. Su paleta automática se descartó por no ser de la marca. |
| Navegador integrado | Referencias visuales, prueba con GPU real y verificación de redes sociales |
| Playwright, Lighthouse, Wrangler | Capturas, pruebas, medición y dry-run |
| `awwwards-3d` | Skill externa, no instalada. Solo se tomó la idea del scroll interpolado hacia la escena. |
