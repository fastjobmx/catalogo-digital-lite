# Análisis del Proyecto Original — Catálogo Digital

## Resumen ejecutivo

El proyecto original es un marketplace multi-proveedor construido sobre **Mercur** (MedusaJS v2) con Next.js 16 como storefront. Incluye panel de proveedor, administración global, integración WhatsApp (Meta/Twilio), importación CSV/Excel y sistema de pedidos con estados. La arquitectura es pesada: requiere PostgreSQL, Redis opcional, S3/R2 para imágenes y un servidor Node permanente.

**Catálogo Digital Lite** reutiliza la identidad visual y los patrones UX comprobados, pero elimina toda dependencia de Medusa/Mercur/PostgreSQL en favor de Cloudflare Workers + D1 + R2.

---

## Componentes visuales reutilizables

Los siguientes componentes del storefront original (`apps/storefront/src/components/`) se adaptaron directamente a React + Vite + Tailwind:

| Componente original | Adaptación Lite | Notas |
|---|---|---|
| `header.tsx` | `components/layout/Header.tsx` | Barra superior con horarios/teléfono, logo, buscador desktop/mobile, badge de carrito |
| `footer.tsx` | `components/layout/Footer.tsx` | Grid 4 columnas: marca, contacto, redes, métodos de pago/entrega |
| `cart-drawer.tsx` | `components/cart/CartDrawer.tsx` | Drawer lateral derecho con stepper de cantidad, datos del cliente, checkout WhatsApp |
| `whatsapp-button.tsx` | `components/WhatsAppButton.tsx` | Botón flotante verde fijo bottom-right |
| `product-card.tsx` | Pendiente Fase 1 | Tarjeta con badge Oferta/Nuevo/Agotado, ratio configurable |
| `product-image.tsx` | Pendiente Fase 3 | srcset WebP 1200/600/300 + blur placeholder |
| `variant-selector.tsx` | Pendiente Fase 1 | Selector de talla/color con estado soldOut por variante |
| `price-tag.tsx` | Pendiente Fase 1 | Precio + compareAt + badge descuento automático |
| `filter-sheet.tsx` | Pendiente Fase 1 | Hoja inferior móvil + barra lateral desktop |
| `category-chips.tsx` | Integrado en Header | Chips horizontales con scroll |
| `empty-state.tsx` | Usado en SearchPage/CartDrawer | Estados vacíos amigables |
| `skeleton.tsx` | Usado en HomePage/CategoryPage | Placeholders animados |
| `store-profile.tsx` | Integrado en HomePage | Portada tipo Instagram con gradiente |

### Patrones de diseño conservados

- **Tokens CSS**: `--brand-primary`, `--brand-on-primary`, `--brand-secondary`, `--brand-on-secondary` inyectados dinámicamente desde StoreContext
- **Contraste automático**: `getLuminance()` calcula texto blanco/negro según luminosidad del color de marca
- **Tipografía**: Manrope 400/500/600/700/800, precios con `tabular-nums`
- **Radios y sombras**: `rounded-card` (16px), `shadow-card` / `shadow-card-hover`
- **Objetivos táctiles**: mínimo 44px (`min-h-11`)
- **Reduced motion**: `prefers-reduced-motion` desactiva transiciones
- **Paleta base**: Canvas `#F8F9FA`, Surface `#FFFFFF`, Ink `#212529`, Muted `#6C757D`, Line `#E5E7EB`

---

## Lo que NO se reutiliza

| Dependencia original | Razón de exclusión | Alternativa Lite |
|---|---|---|
| MedusaJS / Mercur | Framework pesado, requiere Node + Postgres | Cloudflare Workers + Hono |
| PostgreSQL | Servidor dedicado, costo fijo | Cloudflare D1 (SQLite edge) |
| Next.js 16 SSR | Requiere servidor Node o Vercel serverless | Vite SPA + Cloudflare Pages |
| `@medusajs/ui` | Acoplado al ecosistema Medusa | Tailwind CSS puro + componentes propios |
| pg-boss (cola) | Requiere Postgres | Webhooks directos + cron de Workers |
| Redis | Caché compartida compleja | KV de Cloudflare o caché en memoria de Worker |
| SheetJS/xlsx | Vulnerabilidades conocidas | Importación CSV nativa o futura librería ligera |
| Docker / docker-compose | Complejidad de desarrollo local | Wrangler dev + emulación local D1/R2 |

---

## Diferencias arquitectónicas clave

### Inventario por variante (nuevo en Lite)

El proyecto original maneja stock por referencia general. Lite implementa inventario **independiente por variante**:

```
Producto: Tenis Reebok Ref. 2514
├── Variante Talla 38 → stock: 20
├── Variante Talla 39 → stock: 20
├── ...
└── Variante Talla 44 → stock: 20
Total: 140 unidades
```

Esto requiere tablas relacionales `products` + `product_variants` en D1 con transacciones para consistencia.

### Configuración dinámica sin redeploy

En el original, algunos datos de marca viven en código o requieren rebuild. En Lite, **toda la configuración** (colores, logo, WhatsApp, horarios, redes) proviene de la base de datos y se actualiza en tiempo real vía API + StoreContext.

### Autenticación simplificada

El original usa sesiones de Medusa/Mercur con JWT + cookies. Lite implementa autenticación propia con JWT firmado en el Worker, válida solo para el propietario vinculado por Telegram o credenciales admin.

---

## Licencias y atribución

- El proyecto original no especifica licencia explícita en los archivos revisados.
- Las fotos del seed provienen de Pexels, Unsplash, Pixabay y Wikimedia Commons (atribuidas en `CREDITS.md` del original).
- Lite usará imágenes de demostración propias o de fuentes libres correctamente atribuidas.
- No se copia código de Medusa/Mercur; solo se reutilizan patrones visuales y de UX.

---

## Decisiones tomadas

1. **Vite sobre Next.js**: SPA estática desplegable en Cloudflare Pages sin servidor Node.
2. **Tailwind 3 sobre Tailwind 4**: El original usa Tailwind 4 con `@theme inline`; Lite usa Tailwind 3 con config JS para compatibilidad amplia.
3. **React Router v7**: Routing cliente estándar para SPA.
4. **StoreContext como fuente única**: Los datos de tienda se cargan una vez y se propagan vía contexto; los cambios del admin actualizan el contexto en tiempo real.
5. **Carrito en localStorage**: Persistente entre sesiones, sin backend requerido para la experiencia básica.
6. **Checkout WhatsApp puro**: Sin pasarela de pago; el pedido se formatea y abre `wa.me` directamente.