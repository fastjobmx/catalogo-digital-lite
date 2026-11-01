# Progreso del proyecto

Estado de las 6 fases de Catálogo Digital Lite. "Completado" significa **verificado** (compilado, ejecutado o probado), no solo escrito.

| Fase | Alcance | Estado |
|---|---|---|
| 1 | Análisis, storefront, carrito, WhatsApp | **Completado** |
| 2 | D1, API, CRUD, inventario por variante, panel admin | **Completado** |
| 3 | R2, carga de fotos, categorías, destacados | **Completado** (subida desde el panel verificada) |
| 4 | Telegram, autenticación, Gemini, operaciones seguras | **Parcial** (código completo; sin credenciales externas) |
| 5 | Cuestionario inicial y configuración por Telegram | **Parcial** (cuestionario web de 11 pasos; falta el flujo por Telegram) |
| 6 | Plantilla reutilizable, instalador, documentación, pruebas | **Completado** |

## Evidencia de lo verificado

### Backend (Cloudflare Worker + D1 + R2)

- `npx tsc --noEmit` → **0 errores**.
- `npx vitest run` → **23/23** pruebas en verde.
- Worker arranca en `http://127.0.0.1:8788` con bindings D1 y R2 locales.
- Endpoints verificados: `/api/health`, `/api/store`, `/api/products`, `/api/categories`, `/api/products/:sku`.
- Login JWT verificado; `/api/admin/stats` sin token → **401**.
- CRUD verificado de extremo a extremo: crear producto con variantes (GET confirma 2 variantes), actualizar stock por variante (20 → 77 → 20), archivar y restaurar.
- Carga a R2 verificada: `POST /api/upload/image` → asset recuperado con `200 image/png`; sin token → **401**.
- Pedidos verificados: `POST /api/orders` → `201` con total calculado; sin token `GET /api/orders` → **401**; `PATCH /api/orders/:id` cambia estado y rechaza estados inválidos (**400**); `GET /api/admin/stats` refleja `ordersToday`.
- Webhook de Telegram sin bot → **503** (degrada sin romper).
- CORS responde `Access-Control-Allow-Origin` para el origen local.

### Base de datos

- Reset reproducible con `scripts/reset-db.ps1`: migraciones `0001` + `0002` y seed aplicados.
- Contentido final: **5 categorías, 6 productos, 25 variantes**.
- Caso de la especificación verificado: **Reebok RBK-2514** con tallas **38–44** (7 variantes × 20 uds = **140 unidades**).

### Frontend (React + Vite + Tailwind)

- `npm run build` (`tsc --noEmit` + `vite build`) → **OK**, 1623 módulos.
- `npx vitest run` → **15/15** pruebas en verde.
- Servidor de desarrollo sirve el `index.html` y el proxy `/api` alcanza el Worker.
- Filtros por precio, talla y color en categoría y búsqueda (`components/ProductFilters.tsx`).

### Infraestructura de scripts

- `scripts/setup.ps1`, `scripts/reset-db.ps1` y `scripts/deploy.ps1` ejecutan sin errores de parseo en Windows PowerShell 5 (reescritos en ASCII).

## Resumen de pruebas

| Suite | Archivos | Pruebas | Resultado |
|---|---|---|---|
| Worker | 3 | 23 | ✅ |
| Frontend | 3 | 15 | ✅ |
| **Total** | **6** | **38** | **✅** |

## Documentación

Redactada y disponible en `docs/`: `ANALISIS_ORIGINAL`, `ARQUITECTURA`, `INSTALACION_LOCAL`, `DEPLOY_CLOUDFLARE`, `CONFIGURAR_TELEGRAM`, `CONFIGURAR_GEMINI`, `CREAR_NUEVA_TIENDA`, `GUIA_COMERCIANTE`, `PRUEBAS`, `PENDIENTES`.

## Lo que falta

Ver [docs/PENDIENTES.md](docs/PENDIENTES.md). En resumen: transcripción de voz, cuestionario por Telegram, límite de peticiones del webhook, el segundo seed de ejemplo y las pruebas en vivo de Telegram/Gemini (requieren credenciales). La carga de fotos, los filtros por talla/color/precio y la persistencia de pedidos ya están resueltos y verificados.

## Continuación visual — SneakerHub Premium (2026-11-01)

| Fase solicitada | Estado | Avance |
|---|---|---|
| 1. Inspección y detalles visuales | **Implementada; build y suites verificados** | Portada con fotografía local de calzado y composición adaptable; footer con más contraste y mejor flujo móvil; acceso flotante a WhatsApp más discreto. La revisión visual del navegador quedó bloqueada por la herramienta. |
| 2. Fotografías y catálogo | **Parcial; auditoría y reemplazos implementados** | Las 18 fotos principales existen; 4 imágenes ajustadas y documentadas. Falta confirmar licencia de archivos heredados, completar galerías y definir colores por variante. |
| 3. Producto, variantes, carrito y WhatsApp | **Parcial; auditoría y correcciones implementadas** | Selección talla/color por variante activa, límites de stock, carrito con confirmación y revalidación de precio/stock antes de preparar WhatsApp. Pendiente revisar muestras demo de colores/galerías y verificación visual local. |
| 4. Personalización y presets | **Implementada; build y suites verificados** | Apariencia organizada por secciones, identidad de marca, carga de imágenes, selector/orden de destacados y categorías, presets, controles responsive y vista previa para móvil/escritorio. La escritura real a D1/R2 requiere sesión y no se pudo validar en vivo. |
| 5. Administrador, responsive y pruebas | **Parcial; revisión de rutas y build verificados** | Corregido el enlace de Apariencia en Configuración, conservado un alias español, mejorada la semántica/cierre con Escape del menú móvil. Falta revisión visual manual en navegador/API locales. |

La portada por defecto usa `TERA-16.jpg`, con fuente Pexels registrada en el
manifiesto local. En Fase 2 se revisaron las 18 fichas y sus fotos: todas las
rutas existen, se reemplazaron 4 imágenes con desajuste o marcas visibles y se
documentaron las fuentes conocidas en [`docs/ASSETS_DEMO.md`](docs/ASSETS_DEMO.md).
Quedan fotos heredadas cuya procedencia no se pudo confirmar, una sola foto por
producto y variantes demo sin color. No se reinició ni se aplicó seed a D1.

## Rediseño del administrador — Fase 1 (2026-11-01)

- Dashboard renovado con cabecera de tienda, acciones primarias, estado de servicio basado en disponibilidad real y lista de configuración enlazada a Apariencia/Configuración.
- Se quitó el rótulo incondicional “Sistema activo”; no se inventaron pedidos recientes ni porcentajes.
- `frontend`: `npm run build` — OK; `npm test -- --run` — OK (15/15).
- Pendiente: completar el header global con breadcrumbs/menú de usuario y ampliar dashboard con pedidos recientes y alertas de inventario cuando las APIs reales estén disponibles. Sin capturas porque no hay navegador local conectado.

## Rediseño del administrador — Fase 2 (2026-11-01)

- Apariencia identifica de forma explícita el borrador sin guardar y aclara que no se publica hasta guardar; “Recuperar versión guardada” descarta el borrador local.
- La vista previa actual sigue siendo una representación reducida basada en la configuración y datos de catálogo disponibles; no se declara como render real del storefront. La previsualización real aislada queda pendiente de refactor seguro de componentes/contextos.
- `frontend`: build OK y pruebas 15/15.

## Rediseño del administrador — Fase 3 (2026-11-01)

- `/admin/products` presenta un listado tabular compacto con miniatura, referencia, categoría, precio, stock agregado, destacado y acciones.
- Añadidos filtros de categoría, destacado, stock bajo/agotado y orden por nombre/precio/stock; las variantes y su inventario individual permanecen disponibles en un panel desplegable.
- Archivar ahora solicita confirmación; se conserva el formulario CRUD y la carga de imágenes existente.
- Build frontend OK y pruebas 15/15. Sin sesión admin conectada, no se verificó persistencia en D1/R2.

## Rediseño del administrador — Fase 4 (parcial, 2026-11-01)

- Categorías pasó a tarjetas visuales con portada derivada de productos reales, conteo, acceso al catálogo y confirmación antes de desactivar. El formulario ahora comunica errores y estado de guardado.
- Pedidos muestra conteos derivados de registros reales, filtro por estado y actualización del estado vía API; mantiene claro que el pedido iniciado por WhatsApp no significa pago.
- Configuración ahora espera éxito de API antes de actualizar estado local y muestra errores/confirmación inline.
- Build frontend OK y pruebas 15/15. Pendientes: edición de categorías (sin endpoint existente), pruebas conectadas D1/R2 y rediseño visual más profundo de la ficha de pedido/configuración.

## Rediseño del administrador — Fase 5 (parcial, 2026-11-01)

- Menú móvil: cierre con Escape, cierre accesible y retorno de foco al control que lo abrió; se añadió etiqueta accesible al campo de nueva categoría.
- `frontend`: build OK, pruebas 15/15. `worker`: typecheck y pruebas 23/23.
- No se pudo realizar captura ni inspección en resoluciones 375–1440 px porque no hay navegador local de la aplicación conectado; no se afirma validación visual manual.
- Dashboard completado con pedidos recientes mediante `getOrders` solo para sesión conectada y alerta de stock bajo calculada sobre variantes del catálogo cargado. Los errores y estados vacíos no se sustituyen por datos de ejemplo.
- Categorías destacadas ahora se pueden reordenar desde Apariencia y el storefront respeta ese orden configurado.
- Build frontend OK y pruebas 15/15 tras el ajuste.
- Las tarjetas de Categorías enlazan al control existente de visibilidad, portada y orden en Apariencia; Configuración valida correo y WhatsApp antes de guardar.
- Build frontend OK y pruebas 15/15.
- Se agregó edición de nombre/slug de categoría con ruta PUT protegida, conflicto 409 ante slug duplicado y auditoría; el formulario existente permite editar en local o vía API.
- La desactivación de categoría ahora llama al DELETE protegido existente cuando hay sesión backend, refresca el catálogo al completar y reporta errores en el panel; antes solo actualizaba estado local.
- Verificación tras el endpoint: build frontend OK, 15/15 frontend, typecheck Worker OK y 23/23 Worker. No se aplicó migración.
- Los KPIs del dashboard ahora muestran “—” cuando no hay estadísticas de servidor, evitando presentar ausencia de datos como cero.
- Añadidas pruebas de ruta para edición de categorías: rechazo sin token, conflicto por slug duplicado, actualización válida y validación de campos. Worker: typecheck OK, 27/27 pruebas.

## Recuperación catálogo SneakerHub — diagnóstico (2026-11-01)

- Snapshot read-only de Wrangler D1/R2 respaldado en `.tmp/urgent-recovery-20261101/consistent-snapshot/`; 9 archivos / 8,712,192 bytes, SQLite `integrity_check=ok`, manifiesto `snapshot-manifest.sha256`. Copia en bruto adicional quedó sin verificar porque había archivos SQLite en uso; no se sobrescribió.
- D1 snapshot: **18 productos, 18 activos/no archivados, 85 variantes activas, 5 categorías activas**. `theme_config` tiene `featuredSkus=[]`; selección explícita de categorías/productos desactivada.
- Las 18 fichas apuntan a JPEG locales existentes; las 18 imágenes pasan validación del formato. El build Vite también contiene 21 recursos de `seed-images/sneakerhub`.
- No se pudo consultar `GET /api/products` ni inspeccionar el sitio en vivo: llamadas a localhost denegadas por permisos de socket y sin navegador activo. El resultado API de 18 se infiere de SQL del endpoint más D1, no de una respuesta HTTP observada.
- Correcciones: fallos del API ya no sustituyen silenciosamente el catálogo por datos demo; se comunica el error. El fallo de configuración ahora se separa de health-check/backend no disponible y no cambia una sesión conectada a demo. Actualizar versión demo deja intactos los productos locales y overrides visuales. `ProductImage` reinicia estado si cambia el recurso. Filtros de catálogo completos extraídos y cubiertos por pruebas.
- Frontend: build OK, **19/19** pruebas. Worker: typecheck OK, **27/27** pruebas. No se escribió D1, no se aplicó seed ni migración, no se desplegó.
- Verificación HTTP solicitada (segunda pasada): falló por política de sockets locales (`Invoke-WebRequest` a 127.0.0.1:8788 y :5173); CIM tampoco permitió consultar listeners. No se puede afirmar conteo de respuesta API, HTTP de imágenes ni render React en vivo.
- Vite build conserva 21 assets en `dist/seed-images/sneakerhub`; `hero-editorial.jpg` existe. Build actual OK; Frontend 19/19; Worker typecheck OK y 27/27.
- CTA “Agregar producto” del dashboard ahora abre el formulario desde `/admin/products?new=1` y limpia el parámetro de navegación.
- Editor de fotos de producto permite marcar cuál es la principal y confirma antes de eliminar una imagen; controles visibles al enfocar por teclado.
- Build frontend OK y pruebas 15/15.

En Fase 4 se amplió `/admin/appearance`: ahora permite editar nombre, eslogan,
descripción, logo y favicon; subir logo, favicon, fotos de portada/banner y
portadas de categoría al almacenamiento existente; seleccionar/ordenar los
productos destacados y limitar categorías visibles; y alternar una previsualización
de móvil/escritorio. Los cambios guardan en la API antes de actualizar el estado
local cuando hay backend; en modo demo permanecen en el navegador. No se pudo
comprobar una sesión administrativa real ni la persistencia remota en esta sesión.
El filtro de selección explícita distingue “usar selección predeterminada” de
“no mostrar ninguno”, incluso si la selección queda vacía.

La página de producto conserva `/product/:sku` y también responde en
`/producto/:sku`. La generación de mensajes incluye SKU de variante, talla, color,
cantidad, precio y subtotal; el inventario se vuelve a consultar antes de abrir
WhatsApp. Las solicitudes se registran como pendientes y con `whatsapp_sent = 0`;
abrir la conversación no confirma la compra ni descuenta stock. El carrito conserva
datos en `localStorage`, limita cantidades con el stock conocido y solicita
confirmación antes de vaciarse. Ver `docs/PRUEBAS.md` para compilación y suites.

## Optimización de rendimiento del catálogo (2026-11-01)

- Diagnóstico de código: `/api/products` ejecutaba 1 consulta de productos más una consulta de variantes por producto (19 consultas para 18 fichas). Ahora carga productos, categorías y variantes activas con un `LEFT JOIN` en una sola consulta; la agrupación en memoria conserva la forma de respuesta. Una prueba de ruta comprueba 18 filas de producto, variantes/foto/categoría y exactamente una consulta SQL.
- El cliente agrupa solicitudes GET idénticas mientras están en curso; no almacena respuestas ya completadas, para que cambios de precio y stock sigan consultándose al servidor.
- Se generaron variantes WebP para 21 JPEG locales sin reemplazar los originales. Total medido en archivos: JPEG 3,188,131 bytes; WebP 2,027,680 bytes; diferencia 1,160,451 bytes (36.4%). Los componentes usan WebP con JPEG como fallback. Esta es una comparación de archivos, no una medición de transferencia real por HTTP.
- Build frontend: OK; JS 495.31 kB (141.16 kB gzip), CSS 50.32 kB (9.79 kB gzip). Suites: frontend 19/19; Worker 28/28; `npx tsc --noEmit` del Worker OK.
- No se obtuvo perfil de red ni render de navegador: las solicitudes a `127.0.0.1:8788` y `:5173` fallan por permisos de socket en este entorno. No se afirma latencia HTTP ni carga efectiva de imágenes.
- Sin modificaciones al diseño, datos de D1/R2, inventario o catálogo; no se ejecutaron seeds, resets ni despliegues. Hay respaldo previo a edición en `.tmp/performance-20261101/before/`.
- Pendiente local: ejecutar la verificación HTTP y visual descrita al cierre de `docs/PRUEBAS.md` para medir latencia, respuesta API, HTTP de fotos y comportamiento real del navegador.

## Corrección crítica de UX — ficha, fotografías y navegación admin (2026-11-01)

- Respaldo previo a edición verificado por SHA-256 en `.tmp/critical-ux-20261101/before/manifest.csv`; no hay metadatos Git en la carpeta para obtener un diff o estado de cambios.
- La ruta `/product/:slug` sí montaba `ProductPage`, pero la página resolvía únicamente desde la lista global y no pedía el SKU individual si faltaba. Ahora busca sin distinguir mayúsculas, consulta `GET /api/products/:sku` solo cuando el catálogo global no lo contiene y separa carga/error de “no encontrado”. La ruta `/producto/:slug` se conserva.
- La navegación SPA no tenía restauración de scroll. `RouteScrollManager` inicia arriba en PUSH/direct load, restaura la posición de historial en POP y prioriza anchors. No usa temporizadores.
- Catálogo de fotos: consulta read-only del snapshot D1, los 18 productos activos tienen URL raíz `/seed-images/sneakerhub/{SKU}.jpg`; los 18 archivos existen, el nombre coincide con el SKU y se decodifican. Los derivados WebP existen para los 18. Bytes: JPEG de productos 2,670,655; WebP 1,693,542. Esto verifica archivos, no HTTP ni render del navegador.
- `ProductImage` centraliza la normalización de rutas a raíz, soporta HTTPS seguro y assets `/api/assets`, rechaza valores vacíos/inseguros y reintenta el JPEG original si falla el WebP. Tarjetas, galería y lightbox usan el mismo origen; al cambiar de SKU se reinicia la galería. Los originales no se alteraron.
- La sidebar desktop/móvil ahora usa fondo claro beige, cabecera de marca oscura, grupos y enlaces visibles, activo/hover/foco más legibles, overflow interno, usuario y acciones inferiores. “Inventario” enlaza a la sección real de variantes de Productos. El drawer atrapa foco, cierra con Escape/botón/fondo/navegación y bloquea el scroll de fondo.
- El header muestra breadcrumb de grupo, “Ver tienda” y sesión; se retiró el título repetido del header para dejar el H1 de cada página.
- Frontend: build OK (9 suites / 33 pruebas); Worker: typecheck OK y 5 suites / 29 pruebas. El bundle inicial queda en 464.58 kB (135.19 kB gzip); Apariencia se carga al entrar en su ruta, en un chunk de 37.31 kB (9.71 kB gzip). Ya no aparece la advertencia de chunk mayor a 500 kB.
- Pendiente de aceptación en vivo: el entorno no permitió conectar a localhost y la herramienta de navegador no pudo determinar la URL activa. No se afirma respuesta real del API, HTTP/Content-Type de fotos, consola, scroll en navegador, carrito ni revisión a 375/390/768/1440 px. Los comandos y pasos están en `docs/PRUEBAS.md`.
- No se tocaron productos, nombres persistidos, precios, fotos originales, stock/inventario, Telegram, Gemini ni producción; no se ejecutaron seeds ni reset de base de datos.

## Corrección crítica de imágenes del storefront (2026-11-01)

- ASTRAL-03 y los otros tres SKU reportados conservan la misma URL JPEG raíz del snapshot D1 que muestra el admin. El admin renderiza ese JPEG directamente; `ProductImage` del storefront puede seleccionar el derivado WebP y mantiene la foto con opacidad cero hasta `onLoad`. El snapshot local contiene los 18 JPEG y sus 18 WebP; ambos formatos de los SKU reportados se decodificaron correctamente. Esto descarta archivos inexistentes o corruptos en el snapshot, pero no prueba su disponibilidad HTTP.
- `ProductImage` ahora remonta el `<img>` al cambiar de WebP a original y, si falla el WebP seleccionado, lo reintenta una vez usando el JPEG guardado. El error del JPEG sí termina en el estado de imagen no disponible. Se conservaron estilos, dimensiones y carga diferida.
- Las tarjetas de categoría y búsqueda priorizan únicamente las primeras cuatro imágenes; las demás siguen con carga diferida. La imagen secundaria de tarjeta también pasa por la utilidad común de resolución. Inicio y ficha ya tenían prioridad en sus imágenes principales.
- Pruebas de regresión: resolución de rutas locales y R2, selección/fallback WebP, SSR de ProductImage y ProductCard, lazy/eager y `fetchPriority`. Frontend: 39/39 en 11 archivos; build OK, JS inicial 464.76 kB (135.27 kB gzip), CSS 51.25 kB (9.91 kB gzip), chunk de Apariencia 37.31 kB (9.71 kB gzip). Worker: typecheck OK y 29/29.
- No se pudo confirmar causa de red ni declarar resuelta la falla en vivo: iniciar Vite en `127.0.0.1:5173` fue rechazado con `EACCES` y no hubo navegador conectado. No hay estados HTTP, `currentSrc`, `naturalWidth` ni conteo real de imágenes cargadas. El procedimiento para verificar los 18 JPEG/WebP, API y DOM está en `docs/PRUEBAS.md`.
- Sin cambios en admin, diseño, productos, precios, stock, imágenes originales, D1/R2, Telegram, Gemini o producción. Sin seed, reset ni despliegue.

## Corrección del estado invisible de imágenes — reproducida y verificada (2026-11-01)

- Se abrió `http://127.0.0.1:5173/category/running` en navegador. Antes de corregir: las cuatro imágenes tenían `complete=true`, `naturalWidth` entre 933 y 1400 y `currentSrc` WebP válido, pero opacidad computada `0`. Esto demuestra que los recursos sí se descargaban y el problema era su estado de visibilidad.
- Causa confirmada: el `useEffect` de `ProductImage` reiniciaba `loaded=false` al montar/cambiar `src`. Cuando una imagen de caché completaba antes de ese efecto, `onLoad` ya había ocurrido y no volvía a dispararse; el estado quedaba falso y la regla existente la mantenía transparente.
- Corrección: el efecto ahora comprueba `complete` y `naturalWidth` del elemento actual; marca como cargada una imagen ya decodificada y conserva el fallback WebP→JPEG para recursos fallidos. No se modificaron estilos, fotos, datos ni filtros.
- Verificación visual posterior al cambio y tras recarga completa: **4/4 productos de Running visibles** (`KINETIK-05`, `KINETIK-06`, `TERA-08`, `LUMEN-07`), cada uno con `complete=true`, `naturalWidth>0` y opacidad `1`. `currentSrc` seleccionó sus `.webp`.
- Frontend: 40/40 pruebas en 11 archivos; build OK, JS inicial 464.94 kB (135.36 kB gzip). No se midieron estados HTTP explícitos ni la respuesta de `/api/products`; los valores `naturalWidth>0` confirman carga/decodificación real de las cuatro imágenes observadas. La verificación de las 18 fotos a través de todas las rutas queda pendiente.
- No se borraron ni reemplazaron archivos. Sin cambios en admin, productos, stock, precios, imágenes originales, D1/R2, seeds, reset o producción.
