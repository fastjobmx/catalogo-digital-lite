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

## Rediseño «Premium Commerce SaaS» (rama `feat/landing-premium-saas`, 2026-11-12)

- Dirección de arte: verde profundo `#062B25` y blanco cálido `#F8F9F6` dominantes, lima `#CBFA3A` para acciones y morado `#A43FE5` como acento. Tipografías: Plus Jakarta Sans (títulos) y Manrope (texto).
- Secuencia: portada, comercios publicados, problema y solución, funciones (bento), cómo funciona, tiendas reales, catálogo interactivo, Estudio Creativo, administración, planes y comparador, puesta en marcha, condiciones, preguntas, contacto y pie.
- Se retiró la escena 3D con scroll (three.js y GSAP): las animaciones son CSS y respetan `prefers-reduced-motion`.
- Material real: `node scripts/snapshot-real-stores.mjs` y `python scripts/optimize_real.py` (fotos originales, pantallas y cifras públicas de las tiendas autorizadas en `src/content/stores.ts`; piezas del Estudio Creativo desde `docs/capturas-fabrica-creativos/`).
- Precios: siguen saliendo solo de `src/content/plans.ts` (sin cambios de valores). Condiciones de la prueba gratis: `site.trial` en `src/config/site.ts`, leídas de la página `/prueba` en producción.
- Redacción en tuteo colombiano; `tests/site.spec.ts` falla si reaparece el voseo.
- Capturas para revisión: `node scripts/screens.mjs http://localhost:4318 tests/screens/nueva`.
