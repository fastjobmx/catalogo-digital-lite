# SneakerHub Premium — Tema reutilizable

Sitio: `catalogo-lite` (storefront MedusaJS/Cloudflare Worker)  
Versión de la demo del catálogo: `DEMO_CATALOG_VERSION = 2026-11-01-sneakerhub-premium-2`  
Estado: Fase 1 implementada y verificada (build + suites). Fases 2+ pendientes.

## 1. Qué es este tema

SneakerHub Premium es un tema de tienda de moda urbana y sneakers construido como una **capa de presentación configurable sobre el storefront existente de Catálogo Lite**. No sustituye la aplicación ni la API: comparte componentes, productos, categorías, base de datos (D1), almacenamiento (R2) y panel administrativo. Lo que cambia es solo la identidad visual y la composición del home.

No es una maqueta. Los productos, precios, stock y carrito son reales y se sirven desde la API del Worker.

## 2. Alcance de la Fase 1 (implementado)

- Auditoría de estructura, README, PROGRESO/PENDIENTES, package.json, rutas/API y esquema D1.
- Sistema de diseño con tokens CSS configurables desde el administrador.
- Rediseño del header: topbar opcional, logo/wordmark sin distorsión, navegación por categorías, buscador, carrito con contador, menú móvil, contacto/WhatsApp, sticky configurable.
- Hero editorial: foto desktop, foto móvil opcional, etiqueta, título, subtítulo, descripción, dos CTA con enlaces reales, alineación izquierda/centro/derecha, overlay y altura configurables, activable/desactivable.
- Composición del home: promobar, hero, categorías visuales, colección destacada, nuevos lanzamientos, banner editorial, ofertas, beneficios, contacto/WhatsApp, footer. Cada sección toggleable; se oculta si no hay datos.
- Plomería de administración para los nuevos campos (Appearance) y migración tolerante del tema guardado.
- Seed idempotente de 18 productos, 5 categorías, variantes y stock; nunca sobrescribe productos reales.

## 3. Alcance fuera de esta fase

- Galería de fotos y página individual de producto (`/producto/:slug`).
- Curaduría completa de fotografías (18–24 productos).
- Presets Boutique Elegance y Tech Minimal (solo Streetwear Premium está definido por defecto).
- Personalizador completo de 10 pestañas y vista previa aislada.
- Pruebas visuales a 375/390/768/1024/1440 px con capturas (bloqueado en este entorno: sin ventana de navegador visible).

## 4. Sistema de diseño

### Tokens de color (configurables desde /admin/apariencia)

| Variable | Valor por defecto | Uso |
|---|---|---|
| `--color-background` | `#F7F6F2` | Fondo general |
| `--color-surface` | `#FFFFFF` | Tarjetas, header, paneles |
| `--color-text` | `#171717` | Texto principal |
| `--color-text-muted` | `#717171` | Texto secundario |
| `--color-border` | `#E5E3DE` | Líneas y bordes |
| `--color-primary` | `#222222` | Enlaces, foco, selección |
| `--color-secondary` | `#D9D0C1` | Etiquetas suaves, bloques |
| `--color-accent` | `#8D806D` | Acento editorial |
| `--color-button` | `#222222` | Fondo botón principal |
| `--color-button-text` | `#F7F6F2` | Texto sobre botón principal |

Todos se definen en `frontend/src/styles/globals.css` y se aplican desde `StoreContext` a partir de `theme.style.palette`. Las columnas antiguas `primaryColor/secondaryColor/accentColor/buttonColor` se mantienen para compatibilidad con la API y se escriben derivadas de la paleta al guardar.

### Tipografía

- Interfaz y textos: **Inter** (defecto).
- Títulos y display: **Manrope** (defecto).
- Lista segura de fuentes seleccionable: Inter, Manrope, DM Sans, Space Grotesk, Sora, Playfair Display.
- Escala de texto: compacta / normal / amplia. Peso de títulos: semibold / bold / extrabold.

Las fuentes se cargan desde Google Fonts en `frontend/index.html`. `StoreContext` valida que la fuente elegida esté en la lista segura (`SAFE_FONTS`) y aplica `--font-sans`, `--font-display`, `--font-size-base` y `--heading-weight`.

### Espaciado y componentes

Escala consistente de sección/card/grid (`--section-space`, `--card-pad`, `--grid-gap`) vinculada a `theme.style.density`. Componentes unificados: botones (`.btn-brand`, `.btn-accent`, `.btn-ghost`, `.btn-dark`), badges, inputs (`.input-field`), cards (`.card`), chips, modales, drawers, selectores de variantes, alertas, skeletons y estados vacíos.

## 5. Estructura de archivos modificados/creados (Fase 1)

| Archivo | Cambio |
|---|---|
| `frontend/src/types/theme.ts` | Esquema completo de tema: paleta de 10 colores, tipografía, header, hero, secciones, promo, footer; 3 presets; `mergeTheme` con migración de `style.canvas/surface/ink/fontPrimary` y columnas legacy; defaults actualizados. |
| `frontend/src/styles/globals.css` | Tokens `--color-*` canónicos + aliases legacy, clases tipográficas, rediseño de botones/cards/badges/inputs. |
| `frontend/tailwind.config.js` | Colores, fuentes, radios, sombras y espacios ligados a variables CSS. |
| `frontend/src/contexts/StoreContext.tsx` | Mapea API → tema, aplica variables CSS de paleta/tipografía/radio/densidad, valida fuente segura. |
| `frontend/src/components/layout/Header.tsx` | Topbar, logo, nav, buscador, carrito, menú móvil, contacto, sticky. |
| `frontend/src/components/home/HeroSection.tsx` | `<picture>` con fuente móvil, overlay direccional, CTA reales, conteos reales, sin valoración inventada. |
| `frontend/src/components/home/ContactSection.tsx` | Solo con datos reales; WhatsApp no confirma pedidos. |
| `frontend/src/components/home/ProductCard.tsx`, `ProductImage.tsx`, `PriceTag.tsx`, `PromoBanner.tsx`, `BenefitsSection.tsx`, `CtaSection.tsx`, `CategoryGrid.tsx`, `ProductRail.tsx` | Rediseñados al sistema visual. |
| `frontend/src/pages/HomePage.tsx` | Composición de home ordenada, contacto, strip demo, orden de secciones. |
| `frontend/src/data/demoCatalog.ts` | 18 productos, 5 categorías, imágenes locales reales, `DEMO_CATALOG_VERSION` incrementada. |
| `frontend/src/admin/pages/Appearance.tsx` | Reescrito al nuevo esquema: paleta completa, tipografía, header, hero, secciones, presets por `id`, sincronía con columnas legacy al guardar. |
| `frontend/src/admin/pages/Settings.tsx` | Colores movidos a Apariencia (única fuente de verdad); enlace a Apariencia. |
| `frontend/src/admin/pages/Onboarding.tsx` | Colores del onboarding se escriben en la paleta del tema. |
| `frontend/index.html` | Fuentes preconectadas, descripción y `theme-color` del tema. |
| `database/seeds/demo-store.sql` | Seed idempotente de 18 productos / 5 categorías / tema por defecto; nunca toca productos reales. |
| `worker/src/lib/storeMap.ts` | (ya existente) normalización de `theme_config` para D1. |

## 6. Cómo iniciar

Terminal 1 — Worker (backend):
```
cd D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite\worker
npx wrangler dev --port 8788
```
URL: `http://127.0.0.1:8788`

Terminal 2 — Frontend (storefront + admin):
```
cd D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite\frontend
npx vite --port 5173
```
URL: `http://localhost:5173/`  
Admin: `http://localhost:5173/admin` (login `/admin/login`)

Comprobación rápida:
- `cd frontend && npx tsc --noEmit` → 0 errores
- `cd frontend && npx vitest run` → suites en verde
- `cd worker && npx vitest run` → suites en verde

## 7. Límites y honestidad

- Las imágenes de los 18 productos demo son archivos locales de `frontend/public/seed-images/sneakerhub`. Su procedencia y licencia están en `docs/ASSETS_DEMO.md`. Tres archivos heredados (ASTRAL-03, NORD-02, VOLTA-04) no tienen ficha de origen recuperable: confirmar o sustituir antes de redistribuir comercialmente.
- No se captaron pantallas a 375/390/768/1024/1440 px porque el entorno no tiene ventana de navegador visible (la herramienta de control requiere pestaña visible). Se verificó carga limpia, cero errores de consola y 18 productos servidos por la API en `http://127.0.0.1:8788`.
- La persistencia real en D1 del tema guardado desde `/admin/apariencia` no se comprobó con una sesión de administrador conectada en esta sesión.
- No se tocó Telegram, Gemini, credenciales, producción ni productos reales.

## 8. Documentación relacionada

- `docs/GUIA_PERSONALIZACION.md` — cómo editar colores, tipografía, header, hero y secciones.
- `docs/ASSETS_DEMO.md` — inventario, autor, fuente y licencia de cada imagen demo.
- `docs/PRUEBAS_VISUALES.md` — qué se probó, qué queda por verificar visualmente.
- `docs/PENDIENTES.md` — trabajo honesto no completado.
- `PROGRESO.md` — estado por fase y evidencia de lo verificado.
