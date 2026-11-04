# MOSTRALO PUES! — sitio comercial

Sitio de marketing de MOSTRALO PUES! («Si no lo mostrás, no lo vendés.»). **Proyecto independiente**: no importa nada de `frontend/` ni de `worker/` y se publica en su propio proyecto de **Cloudflare Pages** (`mostralopues`), solo con archivos estáticos.

- **Publicado:** https://mostralopues.pages.dev (2026-11-04, despliegue `6cff6fa8`). Por ahora con `noindex`.
- **Resultados de pruebas y lista de funciones reales, demostraciones y próximas:** [`REPORTE.md`](REPORTE.md).

## Stack

| Pieza | Uso |
|---|---|
| React 19 + TypeScript + Vite 8 | Página única, **prerenderizada en el build**: el HTML trae todo el contenido antes del JavaScript |
| Tailwind CSS 4 | Tokens de marca en `src/styles/global.css` (`@theme`) |
| GSAP 3 + ScrollTrigger | Historia ligada al scroll y revelado de beneficios. Se carga **diferido** (`src/motion/useScrollScene.ts`) |
| Three.js | Teléfono 3D hecho por código (`src/three/PhoneCanvas.tsx`) en un chunk diferido. Sin modelos ni HDR de terceros |
| Fuentes | Space Grotesk y Manrope, autoalojadas con `@fontsource` (OFL) |
| Playwright + Lighthouse | Pruebas, capturas y medición |

### Por qué no usa React Three Fiber, drei ni Lenis

- **React Three Fiber y drei:** la escena es un único objeto. Quitarlos redujo el chunk 3D de 263 KB a 143 KB gzip.
- **Lenis:** el scroll nativo es más accesible y GSAP suaviza la historia con `scrub`.

## Estructura

```
src/
  config/site.ts        contacto, WhatsApp, redes, URLs de la plataforma, enlaces legales
  content/copy.ts       textos, capacidades, planes, preguntas frecuentes (solo funciones reales)
  content/media.ts      capturas reales de SneakerHub y plantillas
  content/sneakerhub.json  datos públicos de SneakerHub (generado)
  components/brand/Logo.tsx  variantes aprobadas del logo
  components/ui/        botones, insignias, ícono, teléfono CSS
  sections/             Nav, Story (hero + historia), Assistant, Capabilities, Showcase,
                        Benefits, Commerce (comparación, planes, FAQ), Contact, Footer
  motion/               estado compartido, trayectoria del teléfono, GSAP diferido
  three/PhoneCanvas.tsx teléfono WebGL
brand-originals/        archivos de marca originales, sin modificar
scripts/                marca, snapshot, imágenes, prerender, servidor local, capturas
tests/                  Playwright (site.spec.ts, links.spec.ts) y Lighthouse
docs/capturas/          capturas reales de escritorio y móvil
```

## Desarrollo

```bash
cd apps/mostralopues-landing
npm install
npm run dev            # http://localhost:4317
```

| Comando | Qué hace |
|---|---|
| `npm run build` | Typecheck, build de cliente, build SSR y prerender en `dist/` (`index.html`, `404.html`, `robots.txt`, `_headers`) |
| `node scripts/serve.mjs` | Sirve `dist/` en http://localhost:4318 con compresión y encabezados, como Cloudflare |
| `npm test` | Pruebas de Playwright contra :4318. Requiere `serve.mjs` en marcha |
| `npx playwright test links --project=desktop` | Comprueba los destinos reales: tienda, panel, WhatsApp y redes |
| `node scripts/screens.mjs [url] [--story] [--w=390,1440]` | Capturas por ancho, en `tests/screens/` |
| `node scripts/sections.mjs [url]` | Una captura por sección |

**Parámetros de prueba en la URL:**

- `?no3d`: fuerza el teléfono CSS.
- `?force3d`: fuerza el 3D aunque el equipo sea lento.

### Regenerar recursos

```bash
npm run brand                         # copias transparentes del logo + favicons (Python + Pillow, numpy, scipy)
node scripts/snapshot-sneakerhub.mjs  # capturas y datos públicos de SneakerHub (solo lectura)
python scripts/optimize_images.py     # WebP optimizados + src/content/sneakerhub.json
node scripts/brand-icons.mjs          # íconos de redes desde simple-icons (CC0)
```

**Logo:** las copias transparentes solo quitan el fondo blanco plano.

- El interior blanco de la burbuja y el carrito blanco del isotipo se conservan.
- Los originales están en `brand-originals/`.
- El logo principal tiene letras verde oscuro: se usa **solo sobre fondos claros**. Sobre fondo oscuro va el isotipo, o el logo sobre una placa marfil.

## Configuración

Todo lo editable está en `src/config/site.ts` y en `src/content/copy.ts`.

**Variables de build** (ver `.env.example`):

| Variable | Valor por defecto | Efecto |
|---|---|---|
| `VITE_SITE_URL` | `https://mostralopues.pages.dev` | URL de Open Graph y, al indexar, canonical y sitemap |
| `VITE_ALLOW_INDEXING` | `false` | Ver abajo |

**Con `VITE_ALLOW_INDEXING=false`** (estado de prepublicación):

- `<meta robots noindex>` en la página.
- Encabezado `X-Robots-Tag: noindex`.
- `robots.txt` permite rastrear, para que Google pueda leer el noindex.
- Sin canonical y sin sitemap.

**Con `VITE_ALLOW_INDEXING=true`:**

- `index, follow`.
- Canonical y `og:url` con la URL del sitio.
- `sitemap.xml` incluido en `robots.txt`.

Para el lanzamiento oficial con dominio propio: crear `.env.production` con ambas variables y reconstruir.

## Publicación en Cloudflare Pages

**Proyecto Pages `mostralopues`:**

- **URL:** https://mostralopues.pages.dev
- **Contenido:** solo archivos estáticos de `dist/`.
- **Sin Functions ni bindings:** ni secretos, ni D1, ni R2, ni KV.
- **Encabezados:** salen de `dist/_headers`. Las rutas inexistentes devuelven `404.html`.

**Por qué Pages y no un Worker:**

- Un Worker siempre queda bajo `*.catalogo-lite-worker.workers.dev`.
- Acortar esa parte cambiaría también las URLs de la plataforma y de los webhooks de los bots.
- Pages da la URL corta `mostralopues.pages.dev` sin costo y sin tocar la plataforma.

```bash
cd apps/mostralopues-landing
npm run cf:check       # build + comprobación de dist/ (no publica)
npm run cf:deploy      # build + wrangler pages deploy (publica en producción)
```

**Notas de Wrangler 4.156:**

- El proyecto se creó con `wrangler pages project create mostralopues --production-branch main --force`. `--force` evita que Wrangler lo convierta en un Worker, que daría la URL larga.
- Los despliegues siguientes van directo a Pages: **no** pasar `--force` otra vez.

**Revertir o retirar:**

| Acción | Cómo |
|---|---|
| Ver despliegues | `node ../../worker/node_modules/wrangler/bin/wrangler.js pages deployment list --project-name mostralopues` |
| Volver a una versión anterior | Panel de Cloudflare → Workers & Pages → mostralopues → Deployments → Rollback, o volver a desplegar el commit anterior |
| Retirar el sitio | `node ../../worker/node_modules/wrangler/bin/wrangler.js pages project delete mostralopues` (solo este proyecto) |

**Dominio propio:** en el proyecto Pages → Custom domains. Después, `VITE_SITE_URL=<dominio>` y `VITE_ALLOW_INDEXING=true` en `.env.production`, y reconstruir.
