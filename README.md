# Catálogo Digital Lite

Tienda digital profesional, ligera e independiente para comercios. Construida con React + Vite + Tailwind CSS (frontend) y Cloudflare Workers + D1 + R2 (backend). Sin Medusa, sin Mercur, sin PostgreSQL, sin servidor Node permanente.

> **Onboarding 3.1 (2026-11-04):** bienvenida guiada para tiendas nuevas, progreso persistente, paletas desde logotipo, 13 plantillas, editor con vista previa privada y solicitudes de activación. Verificación local: Worker 191/191, frontend 63/63, typecheck y build correctos. La validación remota de staging espera acceso Cloudflare a su D1. Ver [docs/ONBOARDING_CLIENTES.md](docs/ONBOARDING_CLIENTES.md).
>
> **Importación masiva por Telegram:** los administradores pueden enviar fotos de varios productos, revisar/corregir datos y confirmar su publicación en el catálogo. La IA para sugerir datos visuales es opcional y usa créditos con autorización explícita. Ver [docs/IMPORTACION_MASIVA_TELEGRAM.md](docs/IMPORTACION_MASIVA_TELEGRAM.md).
>
> **Plataforma 3.0 (2026-11-03):** multitienda compartida (`/t/<tienda>`), asistente de Telegram con Gemini para cada tienda, bot maestro con `/crear_tienda` y aprovisionamiento automático. Ver [docs/PLATAFORMA_3_0.md](docs/PLATAFORMA_3_0.md) y [docs/DESPLIEGUE_Y_RECUPERACION_3_0.md](docs/DESPLIEGUE_Y_RECUPERACION_3_0.md).
>
> **Estado anterior:** storefront, backend D1/R2, panel `/admin` con autenticación JWT, inventario por variante, agente de acciones tipadas, scripts e infraestructura de pruebas **funcionando y verificados** (38/38 pruebas en verde). Telegram y Gemini están implementados pero **pendientes de credenciales** para probarse en vivo. Detalle en [PROGRESO.md](PROGRESO.md) y [docs/PENDIENTES.md](docs/PENDIENTES.md).

## Quick start (Windows / PowerShell)

Dos terminales:

```powershell
# Terminal 1 — Backend (Worker + D1 + R2 locales, puerto 8788)
cd "D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite\worker"
npm install
npm run dev

# Terminal 2 — Frontend (Vite, puerto 5173)
cd "D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite\frontend"
npm install
npm run dev
```

- Tienda: http://localhost:5173
- Panel admin: http://localhost:5173/admin — credenciales demo `admin@example.com` / `admin123`

O ejecuta el instalador, que prepara dependencias y la base de datos:

```powershell
cd "D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite"
.\scripts\setup.ps1              # instalar / reparar entorno
.\scripts\reset-db.ps1           # reiniciar datos demo (SneakerHub Lite)
```

## Arquitectura

```
catalogo-lite/
├── frontend/          # React + Vite + Tailwind → Cloudflare Pages
│   ├── src/
│   │   ├── components/   # Header, Footer, CartDrawer, WhatsAppButton
│   │   ├── pages/        # Home, Product, Category, Search, NotFound
│   │   ├── admin/        # Panel admin (Dashboard, Products, Categories, Settings, Onboarding, Simulator, Orders)
│   │   ├── contexts/     # StoreContext, CatalogContext, CartContext, AuthContext
│   │   ├── lib/          # format, whatsapp, interpretCommand (+ pruebas *.test.ts)
│   │   └── styles/       # globals.css con tokens CSS configurables
│   └── package.json
├── worker/            # Cloudflare Workers + Hono → API REST (+ pruebas *.test.ts)
├── database/          # Migraciones D1 + seeds
├── scripts/           # setup.ps1, reset-db.ps1, deploy.ps1
├── docs/              # Documentación completa
├── PROGRESO.md        # Estado de las fases
├── .env.example       # Variables ficticias seguras
└── .gitignore
```

## Lo que funciona ahora (verificado)

**Tienda (sin servicios externos):**
- ✅ Storefront responsivo (móvil primero) con portada, categorías, destacados y novedades
- ✅ Búsqueda y navegación por categorías
- ✅ **Filtros por precio, talla y color** (categoría y búsqueda)
- ✅ Detalle de producto con galería y selector de variantes
- ✅ Carrito persistente en localStorage con stepper de cantidad
- ✅ Checkout WhatsApp con pedido formateado (productos, SKU, variantes, cantidades, total)
- ✅ Botón flotante de WhatsApp, horarios, ubicación, redes y políticas
- ✅ Personalización en vivo (nombre, colores, contacto, moneda)
- ✅ Modo demostración con datos ficticios (SneakerHub Lite)

**Panel y backend:**
- ✅ Persistencia real en Cloudflare D1 (configuración, productos, variantes, categorías, pedidos)
- ✅ **Subida de fotos a Cloudflare R2** desde el formulario de productos (archivo o URL)
- ✅ **Registro de pedidos** en D1 al enviar el pedido por WhatsApp, con panel de estados
- ✅ Autenticación real con JWT; rutas admin protegidas (401 sin token)
- ✅ CRUD de productos y categorías, archivado y restauración (sin borrado definitivo)
- ✅ **Inventario independiente por variante** (talla/color)
- ✅ Auditoría de cada operación en `audit_log`
- ✅ Agente de acciones deterministas tipadas con Zod (20 acciones), con confirmación y sin SQL libre

## Lo que requiere claves o servicios externos

| Funcionalidad | Servicio | Estado |
|---|---|---|
| Persistencia de productos/config | Cloudflare D1 | ✅ Funciona en local (probado) |
| Registro de pedidos | Cloudflare D1 | ✅ Funciona en local (probado) |
| Almacenamiento de imágenes | Cloudflare R2 | ✅ Funciona en local (subida y lectura probadas) |
| Autenticación admin | JWT + Worker | ✅ Funciona (401 verificado) |
| Bot de Telegram | Telegram Bot API | ⏳ Código listo; requiere `TELEGRAM_BOT_TOKEN` |
| Agente IA (texto/voz) | Google Gemini | ⏳ Intérprete local funciona; Gemini requiere `GEMINI_API_KEY` |
| Despliegue producción | Cloudflare Pages + Workers | ⏳ Scripts listos; requiere cuenta Cloudflare |

Detalle de lo que falta en [docs/PENDIENTES.md](docs/PENDIENTES.md).

## Personalización por comercio

Cada instalación es independiente. La configuración se almacena en D1 y se carga vía API. Los cambios reflejan instantáneamente sin redeploy:

- Nombre, descripción, eslogan, tipo de negocio
- Colores primario, secundario, acento, botones
- Logotipo, favicon, imagen de portada
- WhatsApp principal y de pedidos
- Teléfono, correo, dirección, horarios
- Redes sociales (Instagram, Facebook, TikTok)
- Moneda, país, métodos de entrega
- Mensaje predeterminado de WhatsApp

## Inventario por variante

A diferencia del proyecto original (stock por referencia), Lite maneja inventario **independiente por variante**:

```
Producto: Tenis Reebok Ref. 2514
├── Talla 38 → 20 unidades
├── Talla 39 → 20 unidades
├── ...
└── Talla 44 → 20 unidades
Total: 140 unidades
```

## Pruebas

```powershell
cd worker   ; npm test    # 23 pruebas (acciones, intérprete, JWT)
cd ..\frontend ; npm test # 15 pruebas (formato, WhatsApp, simulador)
```

Resultado más reciente: **Worker 191/191 y frontend 63/63 en verde**. Ver [docs/PRUEBAS.md](docs/PRUEBAS.md).

## Documentación

- [Análisis del proyecto original](docs/ANALISIS_ORIGINAL.md)
- [Arquitectura](docs/ARQUITECTURA.md)
- [Instalación local](docs/INSTALACION_LOCAL.md)
- [Despliegue en Cloudflare](docs/DEPLOY_CLOUDFLARE.md)
- [Configurar Telegram](docs/CONFIGURAR_TELEGRAM.md)
- [Configurar Gemini](docs/CONFIGURAR_GEMINI.md)
- [Crear una nueva tienda](docs/CREAR_NUEVA_TIENDA.md)
- [Guía del comerciante](docs/GUIA_COMERCIANTE.md)
- [Pruebas](docs/PRUEBAS.md)
- [Pendientes](docs/PENDIENTES.md)
- [Plataforma 3.0 multitienda](docs/PLATAFORMA_3_0.md)
- [Onboarding inteligente, paletas y plantillas 3.1](docs/ONBOARDING_CLIENTES.md)
- [Despliegue y recuperación 3.0](docs/DESPLIEGUE_Y_RECUPERACION_3_0.md)
- [Guía de los bots](docs/GUIA_BOTS_3_0.md)
- [Dominio, SEO técnico y correo de TiendIA Exprés](docs/DOMINIO_SEO_CORREO.md)
- [Progreso del proyecto](PROGRESO.md)

## Licencia

Proyecto propio. Los patrones visuales se adaptaron del catálogo original con permiso del propietario. Las imágenes de demo son de fuentes libres correctamente atribuidas.
