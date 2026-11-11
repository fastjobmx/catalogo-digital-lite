# Tienda IA Express — sitio comercial

Sitio de marketing de **Tienda IA Express** («TiendIA Exprés» en el logo). Eslogan: «Tu tienda online, más fácil.».

Se creó como **copia independiente** de `apps/mostralopues-landing`. Mantiene los mismos componentes, animaciones, demostraciones, secciones, formulario y enlaces, con la nueva marca, y agrega la sección «Crea tu catálogo sin registro».

- **Proyecto de Cloudflare Pages:** `tiendaiaexpress` (en `wrangler.jsonc`). Es un proyecto distinto de `mostralopues`.
- **URL:** https://tiendaiaexpress.pages.dev
- **Publicar** (solo con autorización):

  ```
  cd apps/tiendaiaexpress-landing
  npm run cf:deploy
  ```

  Ese comando compila el sitio y lo publica únicamente en `--project-name tiendaiaexpress`.
- **Marca:** el original está en `../../brand/tiendaiaexpress/tiendia-expres-original.webp`. Los archivos de `src/assets/brand/` y los íconos de `public/` son recortes y versiones reducidas de ese original, sin redibujar.

## Comandos

| Acción | Comando |
|---|---|
| Desarrollo | `npm run dev` |
| Compilar | `npm run build` |
| Pruebas de precios | `npm run test:unit` |
| Pruebas | `npm run build:official`, luego `node scripts/serve.mjs` y en otra terminal `VITE_APP_URL=https://app.tiendiaexpres.com npx playwright test site commercial` (incluye axe WCAG 2.2 AA) |
| Revisar los enlaces en vivo | `npx playwright test links --project=desktop` |

## Indexación

Igual que el sitio original: `noindex` por defecto. Con `VITE_INDEXABLE=true` el sitio pasa a indexable y se agregan la URL canónica `https://tiendaiaexpress.pages.dev/`, `sitemap.xml` y `robots.txt`.

## Planes, precios y tiendas de ejemplo

- **Planes y precios:** se editan solo en `src/content/plans.ts` (tarjetas, comparador mensual/anual, mensajes de WhatsApp, formulario, preguntas frecuentes y JSON-LD salen de ahí). Cambiar este archivo **no** cambia límites ni créditos de ninguna tienda: eso vive en la tabla `plans` del backend.
- **Tiendas reales:** `src/content/stores.ts`. Una tienda aparece solo si está autorizada por el comercio y su captura está en `src/assets/stores/` (procedimiento en el encabezado del archivo).
- Informe completo, diferencias con el backend y condiciones pendientes: `docs/LANDING_PLANES_Y_PRECIOS.md`.
