# Arquitectura - Catálogo Digital Lite

## Visión general

Catálogo Digital Lite es una tienda digital para comercios pequeños, con prioridad móvil y sin infraestructura pesada. Toda la lógica vive en el borde (edge) de Cloudflare:

- **Frontend**: React + Vite + TypeScript + Tailwind CSS → **Cloudflare Pages**.
- **Backend**: Cloudflare **Workers** con **Hono** (API REST) → sin servidor Node permanente.
- **Base de datos**: Cloudflare **D1** (SQLite gestionado).
- **Archivos**: Cloudflare **R2** (imágenes de productos, logo, portada).
- **IA**: Google **Gemini** (opcional) para interpretar lenguaje natural.
- **Mensajería**: **Telegram Bot API** (webhook) para administrar la tienda.

No se usa Medusa, Mercur, Redis, Docker ni PostgreSQL.

```
Navegador (móvil/escritorio)
   │
   ├── Cloudflare Pages ── React SPA (tienda + /admin)
   │
   └── fetch /api/*  ─────► Cloudflare Worker (Hono)
                                │
                                ├── D1  (store_config, products, product_variants, categories, orders, audit_log, ...)
                                ├── R2  (imágenes)
                                ├── Gemini API   (opcional)
                                └── Telegram API (opcional)
```

## Estructura del repositorio

```
catalogo-lite/
├── frontend/                 # SPA React + Vite + Tailwind
│   ├── src/
│   │   ├── components/       # Header, Footer, CartDrawer, ProductCard, WhatsAppButton...
│   │   ├── pages/            # Home, Product, Category, Search, NotFound
│   │   ├── admin/            # Panel /admin: Dashboard, Products, Categories, Settings,
│   │   │                     # Onboarding, Simulator, Orders
│   │   ├── contexts/         # StoreContext, CartContext, CatalogContext, AuthContext
│   │   ├── lib/              # format, whatsapp, interpretCommand
│   │   └── services/api.ts   # Cliente tipado del Worker
│   └── vite.config.ts        # Proxy /api -> Worker local (8788)
├── worker/                   # API Cloudflare Workers + Hono
│   └── src/
│       ├── routes/           # health, store, products, categories, upload, admin, telegram
│       ├── middleware/auth.ts
│       ├── services/         # auth (JWT), telegram
│       ├── ai/               # interpreter (parser determinista), executor (acciones)
│       └── validation/       # actionSchemas (Zod, 20 acciones)
├── database/
│   ├── migrations/           # 0001_initial.sql, 0002_agent.sql
│   └── seeds/                # demo-store.sql (SneakerHub Lite), boutique-demo.sql
├── scripts/                  # setup.ps1, reset-db.ps1, deploy.ps1
└── docs/
```

## Modelo de datos (D1)

Definido en `database/migrations/0001_initial.sql` y `0002_agent.sql`.

| Tabla | Propósito |
|---|---|
| `store_config` | Fila única (id=1) con identidad, colores, contacto, moneda, vinculación Telegram |
| `categories` | Categorías con `slug`, orden y estado activo |
| `products` | Producto con SKU único, precio, precio de comparación, destacado, `is_active`, `is_archived` |
| `product_variants` | **Inventario independiente por variante** (talla/color), `UNIQUE(product_id, sku)`, `ON DELETE CASCADE` |
| `orders` | Pedidos (display_id, cliente, total, estado) |
| `audit_log` | Auditoría de cada operación (acción, entidad, payload, autor, origen) |
| `admin_sessions` | Sesiones del panel |
| `processed_updates` | Deduplicación de `update_id` de Telegram |
| `pending_actions` | Operaciones pendientes de confirmación por Telegram |
| `onboarding_sessions` | Progreso del cuestionario inicial |

### Inventario por variante

El stock **no** vive en `products` sino en `product_variants`. Esto permite, por ejemplo, que un tenis tenga 20 unidades por cada talla (38 a 44 = 140 en total) sin duplicar el producto.

## API REST

Públicas (sin autenticación):

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del Worker |
| GET | `/api/store` | Configuración pública de la tienda |
| GET | `/api/products` | Listado de productos (`?category=`, `?q=`, `?featured=1`) |
| GET | `/api/products/:sku` | Detalle de producto con variantes |
| GET | `/api/categories` | Categorías activas con conteo |
| GET | `/api/assets/:key` | Imagen almacenada en R2 |
| POST | `/api/upload/image` | Subir imagen (requiere token admin) |
| POST | `/api/orders` | Registrar un pedido del checkout (validado con Zod) |
| POST | `/api/telegram/webhook` | Webhook de Telegram |

Protegidas (JWT `Authorization: Bearer`):

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/admin/login` | Login → token JWT (24 h) |
| GET | `/api/admin/stats` | Resumen (productos, categorías, stock, pedidos) |
| PUT | `/api/admin/store` | Actualizar configuración de la tienda |
| POST/PUT/DELETE | `/api/admin/products[/:id]` | CRUD y archivado de productos |
| PUT | `/api/admin/products/:id/variants` | Actualizar stock de variantes |
| POST | `/api/admin/products/:id/restore` | Restaurar producto archivado |
| POST/DELETE | `/api/admin/categories[/:id]` | Crear / desactivar categorías |
| GET | `/api/orders` | Listado de pedidos recientes |
| PATCH | `/api/orders/:id` | Cambiar estado del pedido |
| POST | `/api/admin/telegram/link-code` | Generar código de vinculación (10 min) |
| GET | `/api/admin/telegram/status` | Estado de vinculación del bot |

## Seguridad

- **Autenticación real**: JWT HS256 firmado con `jose`; el Worker valida el token en cada ruta protegida. Nunca se confía en un ID de comercio enviado por el navegador.
- **Agente determinista**: la IA nunca ejecuta SQL libre. Toda acción pasa por `actionSchemas` (Zod) y `executeAction` (switch tipado).
- **Confirmación explícita**: las operaciones que crean/eliminan datos requieren confirmación (SÍ/NO) y quedan en `pending_actions` con caducidad (15 min).
- **Auditoría**: cada operación escribe en `audit_log`.
- **Telegram**: solo el propietario vinculado puede administrar; códigos de un solo uso con caducidad; verificación de `TELEGRAM_WEBHOOK_SECRET`; deduplicación de `update_id`.
- **Secretos**: `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN` y `JWT_SECRET` viven solo en el Worker (secrets); el frontend nunca los recibe.

## Doble modo del frontend

`StoreContext`, `CatalogContext` y `AuthContext` funcionan en dos modos:

1. **Modo demo (localStorage)**: si el Worker no está disponible, la tienda funciona con datos ficticios (`SneakerHub Lite`) y el carrito/checkout WhatsApp operan localmente.
2. **Modo backend (D1)**: si `/api/health` responde, la tienda carga configuración, productos y categorías reales desde D1.

Esto permite mostrar la tienda sin servicios externos y conectarla después sin cambiar el código.

## Flujo de personalización

El comerciante guarda cambios (colores, nombre, contacto) desde `/admin/settings` o desde Telegram. Se persisten en `store_config` (D1) y la tienda los carga al abrir. No se requiere reconstruir ni redesplegar.
