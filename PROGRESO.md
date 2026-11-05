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
| 3.0 | Plataforma multitienda, asistente IA por tienda, bot maestro y aprovisionamiento | **Implementada y verificada localmente; pendiente de despliegue autorizado** (ver sección final) |

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

## Proyecto de tiendas independientes — Fase 1 (2026-11-01)

- Auditoría y arquitectura documentadas en [`docs/ARQUITECTURA_MULTI_TIENDA.md`](docs/ARQUITECTURA_MULTI_TIENDA.md).
- Git limpio al iniciar (`main`, `7d8a4b3`). Frontend: 40/40 pruebas y build OK. Worker: 29/29 pruebas y `tsc --noEmit` OK. 69 imágenes JPEG/WebP locales decodificadas.
- Riesgos detectados antes del generador: seeds existentes modifican o borran datos; el setup/reset apunta al estado D1 local de la tienda maestra; credenciales de demostración están en configuración versionada y hay valores de respaldo en autenticación.
- Se fijó el diseño: plantilla maestra y destinos autónomos, manifiestos sin secretos, bases locales separadas, solo demo local en la Fase 2 y sin reusar seeds existentes.
- Punto de restauración previo a esta edición: `.tmp/multi-store-phase1-checkpoint-before/` (`PROGRESO.md`, `docs/PENDIENTES.md` y `SHA256SUMS.txt`).
- Sin cambios de código o configuración, sin D1/seed/reset, sin productos/fotos tocados, sin recursos remotos ni despliegue durante la Fase 1.

## Proyecto de tiendas independientes — Fase 2 (2026-11-01)

- Implementado [`scripts/new-store.ps1`](scripts/new-store.ps1) para Windows PowerShell 5.1. Acepta datos de tienda, `-DryRun`, `-Destination`; limita opciones a `demo`, tema `default` y seed `None`; rechaza `production` y destinos existentes.
- Cada ejecución construye un proyecto por allowlist, sin `.git`, dependencias, seeds, fotos ni configuración local de SneakerHub; genera `.dev.vars` aleatorio ignorado por Git, UUID D1, estado Wrangler y puertos propios; escribe manifiesto y registro sin secretos.
- Las migraciones `0001`–`0003` y el alta de `store_config` se ejecutaron en cuatro instalaciones de humo distintas. Sus SQLite están en rutas separadas, con identidad propia, 0 productos y 0 categorías; sus credenciales y puertos son distintos. No se tocó el D1 de la plantilla.
- La instalación generada incluye fallback vacío para el catálogo/identidad, namespace localStorage por slug y carga diferida del catálogo SneakerHub. El bundle independiente probado no incluyó los SKU de SneakerHub.
- Verificación: frontend 42/42 y build OK; Worker 29/29 y typecheck OK. Build/typecheck de un proyecto generado también OK. `-DryRun` y rechazo de modo `production` verificados.
- Límite: no se pudo completar `npm ci --offline` porque el caché no contiene todos los paquetes; el build de humo usó dependencias ya instaladas sin copiarlas. La instalación en una máquina nueva requiere acceso al registro npm.
- Las pruebas de humo permanecen temporalmente bajo `local-stores/`, ignoradas por Git; no son Patitas/TecnoCell ni tienen catálogo. La Fase 3 aún debe agregar presets, seeds y medios autorizados antes de crear las dos demos comerciales.

## Proyecto de tiendas independientes — Fase 3 (2026-11-01)

- Añadidos presets separados para configuración comercial/tema y catálogo: `database/seed-presets/patitas-felices/` y `database/seed-presets/tecnocell-accesorios/`. Sus seeds usan `INSERT OR IGNORE`, claves SKU/slug propias y nunca actualizan ni borran filas existentes.
- El generador acepta seeds `PatitasFelices` y `TecnoCellAccesorios`, temas `auto`, `default`, `pet-soft` y `tech-minimal`; aplica los datos solo a D1 local nueva, copia solo medios incluidos en `assets.json`, registra checksums/procedencia y mantiene generación vacía con `Seed None`.
- Agregadas siete fotos de Pexels para las demos y optimizadas a JPEG de hasta 1400 px. La carpeta heredada `seed-images/tecnocell` se dejó intacta y excluida por falta de procedencia. La atribución, enlaces de origen, licencia y SHA-256 están en los manifiestos de assets.
- Catálogos: Patitas Felices 3 categorías y 3 productos; TecnoCell Accesorios 4 categorías y 4 productos. Los productos llevan metadatos de demo y las fichas piden confirmar marca, precio, stock y especificaciones antes de vender.
- Validación final completada: se generaron ambas instalaciones desde el script y se verificaron D1 separadas, conteos, checksums/decodificación de imágenes y ausencia de SKU SneakerHub en datos y bundle. Builds frontend y typecheck de Worker aprobaron en las dos copias.

## Proyecto de tiendas independientes — Fase 4 (parcial, 2026-11-01)

- Generadas `local-stores/patitas-felices` y `local-stores/tecnocell-accesorios`, cada una con UUID D1, archivo SQLite, puertos y credenciales aleatorias propios. Las credenciales no se imprimieron ni se guardaron en manifiestos.
- Patitas Felices: 3 productos, 3 categorías y 3 variantes. TecnoCell Accesorios: 4 productos, 4 categorías y 4 variantes. Las siete imágenes seleccionadas existen, se decodifican y coinciden con SHA-256 y procedencia del preset.
- Reaplicar SQL de catálogo dejó los conteos intactos. Reintentar el mismo slug se rechazó y los hashes de manifiesto, registro y D1 permanecieron iguales. No se encontró el SKU SneakerHub `VANTA-18` en las D1 ni en el bundle de la demo independiente.
- Build frontend y `tsc --noEmit` de Worker aprobaron para ambas instalaciones. Se verificaron también los planes `-DryRun`.
- Pendiente de aceptación manual en navegador: recorrido visual de storefront/admin, carrito y preparación de pedido por WhatsApp. No se declara validado ese flujo.

## Proyecto de tiendas independientes — Fase 5 (2026-11-01)

- Documentada la preparación del aprovisionamiento y sus límites operativos en [`docs/AUTOMATIZACION_TIENDAS.md`](docs/AUTOMATIZACION_TIENDAS.md), con comandos y referencias oficiales de Cloudflare.
- Este avance fue de planificación/documentación: no se inició sesión, no se crearon D1/R2/Workers/Pages remotos, no se escribieron secretos remotos y no se desplegó.
- La Fase 6 se completó a continuación; ver el registro siguiente.

## Proyecto de tiendas independientes — Fase 6 (2026-11-01)

- El cuestionario inicial ahora guarda la configuración mediante `PUT /api/admin/store` con sesión administrativa; evita duplicar su categoría inicial al reintentar y ya no añade el producto ficticio fijo `DEMO-001`. Productos/fotos se gestionan desde las pantallas existentes de Productos y Apariencia.
- Añadido `worker/src/services/business.ts` para crear/editar productos, cambiar precio e inventario, crear/editar/desactivar categorías, actualizar campos de tienda, registrar auditoría y subir imágenes R2. Las rutas administrativas y las acciones existentes del ejecutor reutilizan esas operaciones.
- Preparación completada sin construir el agente completo de Telegram. Las acciones sensibles continúan en el flujo actual de autenticación/confirmación del bot; no se agregaron permisos o credenciales externos.
- Verificación posterior a los cambios: Worker 33/33 y typecheck OK; frontend 42/42 y build OK.

## Proyecto de tiendas independientes — Fase 7 (2026-11-01)

- Aceptación real en navegador completada para Patitas Felices y TecnoCell Accesorios. URLs locales al cierre: `http://127.0.0.1:5283/` (Worker `8898`) y `http://127.0.0.1:6081/` (Worker `9696`). Los cuatro servicios se dejaron activos.
- Confirmados identidad/tema, 3 productos y 3 categorías de Patitas, 4 productos y 4 categorías de TecnoCell, fotos decodificadas, fichas, login/admin, gestión de productos y guardado de apariencia.
- Aislamiento comprobado con cambio temporal de nombre, precio y color en Patitas: persistieron en esa tienda, TecnoCell no cambió y los datos originales de Patitas fueron restaurados. Foto PNG de prueba cargada solo al R2 local de Patitas; la misma ruta devolvió `Asset not found` en TecnoCell. Sin reset/reseed ni reemplazo de fotos.
- Se corrigió en ambas copias generadas una carrera que borraba el carrito guardado al recargar. Los dos carritos persistieron tras F5 y se limpiaron los artículos de prueba.
- WhatsApp quedó parcialmente aceptado: el botón detecta que no hay teléfono válido configurado en ninguna tienda. No se inventó el dato ni se envió un pedido.
- Suites: frontend 42/42, Worker 33/33; typecheck Worker y builds de frontend base + ambas demos aprobados. Riesgos críticos de seguridad documentados sin cambiar auth ni credenciales. Plantilla SneakerHub Premium intacta y sin despliegues.
- Informe completo, URLs, comandos, evidencia y riesgos: [`docs/ACEPTACION_TIENDAS_DEMO.md`](docs/ACEPTACION_TIENDAS_DEMO.md). Pruebas actualizadas en [`docs/PRUEBAS.md`](docs/PRUEBAS.md).

## Proyecto de tiendas independientes — Fase 8 (2026-11-01)

- Endurecida la autenticación del Worker: quitados los defaults versionados del `wrangler.toml` y los fallbacks de correo, contraseña y JWT; login y middleware fallan cerrados si falta configuración. En producción se validan longitud/variedad y marcadores débiles.
- `demo-local` ahora exige una bandera explícita junto a Vite dev; sesiones antiguas se descartan si el modo no está habilitado y las sesiones JWT se revalidan con el Worker. El panel etiqueta el modo solo local y el login ya no ofrece credenciales ficticias.
- Consolidadas en la plantilla y demos las correcciones generales del carrito y fallback WebP→JPEG. El generador entrega el CTA del preset en un módulo local a cada instalación; las demos existentes cargan ese módulo sin editar D1. La normalización de temas guardados antiguos evita copy de calzado; SneakerHub mantiene su texto y estilo.
- La revalidación del navegador encontró y corrigió un tema guardado sin `cta` que dejaba la home en blanco. Tras recargar, Patitas mostró 3/3 productos, 3 categorías y las fotos principales; TecnoCell mostró 4/4 productos, 4 categorías y las fotos principales. Se abrieron una ficha de cada una; login UI presente; WhatsApp bloqueado correctamente por número no configurado.
- Aislamiento: los manifiestos/UUID D1, nombres/buckets locales, puertos, slugs de sesión/almacenamiento y archivos `.dev.vars` siguen separados; archivos locales ignorados por Git y no idénticos. No se cambiaron credenciales, catálogo, D1/R2, carrito o apariencia en esta pasada. El frontend puede sincronizar su marcador interno de versión al abrirse.
- Extracción de rutinas UTF-8 del generador a `scripts/store-encoding.ps1` y test offline `scripts/test-generator-encoding.ps1`. Windows PowerShell 5.1 confirmó acentos, presets, CTA del preset, escape SQL, ausencia de mojibake y UTF-8 sin BOM. `-DryRun` pasó para ambos perfiles con slugs temporales; los slugs ocupados de las tiendas existentes se rechazaron sin cambios.
- Los intentos de crear una instalación nueva fallaron durante D1 local: primero `fetch failed`; en el reintento Wrangler seleccionó la base local y devolvió un error interno al migrar. El origen no quedó determinado. Como control, D1 aceptó `SELECT 1` y las tres migraciones en estados temporales nuevos, incluso con estructura de configuración generada. El generador limpió ambos staging y no dejó destino/registro ni creó recursos remotos.
- Resultados: frontend 52/52, Worker 39/39, `npx tsc --noEmit` y build de la plantilla + ambos demos OK. La última prueba de auth verifica que, al faltar las credenciales del administrador, una sesión previa tampoco entra a rutas protegidas. No se probó un login real en esta pasada; Fase 7 ya aceptó login, gestión, persistencia de apariencia, carrito e aislamiento.
- Verificación al cierre: los cuatro servicios locales respondieron HTTP 200 y ambos Workers devolvieron salud `ok`. Los `-DryRun` de ambos perfiles y la prueba de serialización CTA pasaron; la creación de una instalación de prueba permanece pendiente porque Wrangler D1 local falló en dos intentos.

## Proyecto de tiendas independientes — Fase 8.1 (2026-11-01)

- Punto de restauración de los archivos de generador, migraciones, configuración y documentos: `.tmp/phase81-checkpoint-20261101/manifest.json` con SHA-256 por archivo. No se sobrescribieron las tiendas existentes.
- Se instrumentó `scripts/new-store.ps1`: pasos, comando sanitizado, `cwd`, config, persistencia, duración, salida y código externo; diagnósticos redactados antes de retirar staging; `-Diagnostic` conserva eventos también cuando termina bien. Todas las operaciones D1 declaran `--local`, el mismo config y persistencia absoluta, en orden secuencial. `--cwd` al staging y un preflight `SELECT 1` también dieron `internal error` en intentos vacíos y no se retuvieron. El generador completó una tienda vacía, pero falló en intentos posteriores; Wrangler local sigue intermitente sin causa confirmada.
- El primer `fetch failed` se reprodujo junto a `EACCES` al conectar a loopback sin elevación; el `SELECT 1` y las tres migraciones pasaron con permisos locales ampliados en D1 temporal. Node 26.8.1, npm 11.19.0, Wrangler 4.156.0, Windows PowerShell 5.1.26100.9711.
- Éxito extremo a extremo: `local-stores/test-generador-fase81` se creó desde cero con `Seed None`. Manifiesto/UUID, D1 local y migraciones 0001–0003; consulta D1 confirmó configuración y conteos de catálogo en cero. `/api/health` OK, `/api/products` devolvió `[]`, login emitió JWT válido, ruta admin protegida y Vite respondió HTTP 200. Frontend generado compiló y Worker pasó typecheck.
- Límite pendiente: la nueva tienda con preset TecnoCell pasó DryRun pero Wrangler devolvió repetidamente `internal error` al ejecutar `0001_initial.sql`, también después de la reproducción con loopback permitido. El mismo Wrangler/config/persistencia y migraciones pasan en un control aislado, de modo que la diferencia aún no tiene causa confirmada. El intento no dejó tienda ni registro y no tocó las demos existentes.
- Pruebas de regresión: `scripts/test-generator-wrangler.ps1` verificó código externo 37, fallo controlado del generador, diagnóstico sanitizado y ausencia de destino/registro; `test-generator-encoding.ps1` pasó. Repetir el slug generado se rechazó sin cambios.
- Suites: frontend 52/52, Worker 39/39; build frontend, typecheck Worker, build frontend generado y arranque/health/login pasaron. `npm ci --offline` no tuvo `zod@3.25.76` en caché; se validó con dependencias locales del workspace sin acceder al registro npm.
- No se crearon recursos Cloudflare ni se desplegó. La validación del segundo preset (seed/fotos/CTA/carrito) queda pendiente. Informe: [`docs/FASE81_GENERADOR_ESTABLE.md`](docs/FASE81_GENERADOR_ESTABLE.md).
- Seguridad residual: posibles valores antiguos en el historial Git deben tratarse como expuestos si se reutilizaron; producción necesita secrets propios, `ENVIRONMENT=production`, `ALLOWED_ORIGIN` exacto, protección contra intentos de login y decisión sobre JWT en `localStorage`. WhatsApp real sigue pendiente. Detalle: [`docs/FASE8_SEGURIDAD.md`](docs/FASE8_SEGURIDAD.md) y [`docs/CHECKLIST_PRODUCCION.md`](docs/CHECKLIST_PRODUCCION.md).

## Proyecto de tiendas independientes — Fase 8.2 (2026-11-01)

- El generador migró a `wrangler d1 migrations apply`, con `database/migrations` separado de los SQL de inicialización/seed y `npx.cmd --no-install` para usar el Wrangler local fijo. Se añadió clasificación sanitizada de errores y el test simulado valida `SQLITE_BUSY` → `sqlite-lock`.
- Matriz disponible: Windows PowerShell 5.1.26100.9711, Node 26.8.1, npm 11.19.0 y Wrangler 4.156.0. Tres generaciones nuevas consecutivas pasaron: vacía, Patitas (3 productos/categorías/fotos) y TecnoCell (4 productos/categorías/fotos). D1 confirmó ledger, configuración, UTF-8 y persistencias separadas.
- El flujo nativo aplicó 0001–0003 en orden y el segundo `apply` no duplicó migraciones; el flujo anterior de tres `d1 execute --file` también pasó una vez en un control aislado. No se atribuye una causa definitiva al `internal error` histórico.
- Node 24 LTS y Wrangler 4.156.1 alternativos no se probaron: el registro npm respondió `ENOTFOUND`. `npm ci` también falló en los seis paquetes de las tiendas nuevas al descargar `zod@3.25.76`; no se cambiaron lockfiles ni se copiaron `node_modules`.
- Suites de plantilla: Frontend 52/52, Worker 39/39, typecheck Worker y build Frontend OK. Los builds/login/API de las copias generadas quedan pendientes por `npm ci`; no se recomienda todavía un piloto que dependa de esas validaciones. SneakerHub, Patitas, TecnoCell y `test-generador-fase81` no se modificaron. No hubo recursos remotos ni despliegue.
- Informe: [`docs/FASE82_ESTABILIDAD.md`](docs/FASE82_ESTABILIDAD.md). La fase permanece parcialmente abierta hasta completar las filas de compatibilidad y la instalación limpia de dependencias.

## MVP privado Telegram + Gemini — 2026-11-02

- Se reutilizó el webhook actual y se integraron Gemini estructurado, autorización por ID numérico, deduplicación, limitación, confirmaciones persistentes, voz OGG limitada y transacción D1 para cambios de precio/stock.
- Gemini real pasó una consulta de solo lectura. Telegram `getMe`/`getWebhookInfo` confirmaron el bot y que no hay webhook; después del envío del challenge se validó una coincidencia en chat privado, se confirmó la cuenta y se guardó su ID local.
- Migración aditiva comprobada sobre clon SQLite; no se aplicó a la base original. D1/R2 originales permanecen con los conteos esperados.
- Worker 55/55 + typecheck; frontend 52/52 + build. Sin deploy, webhook definitivo ni mutaciones de datos.
- Estado: implementación parcial. Falta confirmar la cuenta propietaria, probar mensajes/voz y escrituras en un entorno temporal con recursos propios, y revisar resultados antes de cualquier activación.

## Rediseño visual SneakerHub Premium — FASE 1 (2026-11-02)

### Alcance implementado y verificado
- Sistema de diseño: tokens `--color-*` (10) + tipografía (Inter/Manrope por defecto) + radios/densidad/componentes unificados en `frontend/src/styles/globals.css`, `tailwind.config.js` y `frontend/src/types/theme.ts`.
- `mergeTheme` migra `style.canvas/surface/ink/fontPrimary` y columnas legacy `primaryColor/secondaryColor/accentColor/buttonColor`; la paleta es la única fuente de verdad del storefront.
- Header reescrito: topbar opcional, logo sin distorsión, nav de categorías, buscador, carrito con contador, menú móvil (Escape/fondo), contacto WhatsApp, sticky configurable.
- Hero reescrito: foto desktop/móvil opcional, overlay direccional, alineación izquierda/centro/derecha, altura y overlay configurables, CTA con enlaces reales, conteos reales, sin valoración inventada.
- Home: secciones toggleables (hero, categorías, destacados, promo, ofertas, nuevos, beneficios, contacto, testimonios, cta); se ocultan sin datos.
- Tarjetas, galería, precios, badges, skeleton y estados vacíos rediseñados al sistema visual.
- Admin `Appearance.tsx` reescrito al nuevo esquema (paleta completa, tipografía, header, hero, secciones, presets por `id`); `Settings.tsx` y `Onboarding.tsx` sincronizan colores a la paleta.
- `index.html`: fuentes preconectadas, descripción y `theme-color` del tema.
- `database/seeds/demo-store.sql`: seed idempotente de 18 productos, 5 categorías, variantes y stock; nunca toca productos reales.

### Evidencia de lo verificado
- `frontend`: `npx tsc --noEmit` → 0 errores; `npx vitest run` → **52/52** en 16 archivos.
- `worker`: `npx tsc --noEmit` → 0 errores; `npx vitest run` → **23/23** en 3 archivos.
- Worker en `http://127.0.0.1:8788`: `/api/products` → **18 productos**, `/api/categories` → **5 categorías**, `/api/store` → paleta por defecto y hero `/seed-images/sneakerhub/hero-editorial.jpg`.
- Seed aplicado a D1 local con `wrangler d1 execute --local --file database/seeds/demo-store.sql` → éxito.
- Navegador en `http://localhost:5173/`: título "SneakerHub Premium", **0 errores de consola**, hero y menú renderizan.

### Documentación creada/actualizada
- `docs/STREETWEAR_PREMIUM.md` (nueva): alcance, sistema de diseño, archivos, cómo iniciar, límites.
- `docs/GUIA_PERSONALIZACION.md` (nueva): cómo editar colores, tipografía, header, hero y secciones desde `/admin/apariencia`.
- `docs/PRUEBAS_VISUALES.md` (nueva): qué se verificó y qué queda pendiente.
- `docs/ASSETS_DEMO.md` (actualizada): hero-editorial.jpg como portada por defecto, TERA-15.jpg como banner promo, TERA-16 sin "portada por defecto".

### Límites y honestidad (no afirmar como hecho)
- **No se captaron pantallas a 375/390/768/1024/1440 px:** `browser.screenshot` requiere una pestaña visible en ventana de escritorio, no disponible en este entorno. Ver `docs/PRUEBAS_VISUALES.md`.
- **Persistencia remota en D1 desde `/admin/apariencia`:** no se comprobó con sesión de administrador conectada.
- **Render React en vivo y HTTP de las 18 fotos:** localhost estuvo bloqueado por permisos de socket en momentos de la sesión; se confirmó a nivel de archivo (18 JPEG decodificados) y de API (18 filas), no a través del navegador por cada imagen.
- Tres imágenes heredadas sin ficha de origen: `ASTRAL-03.jpg`, `NORD-02.jpg`, `VOLTA-04.jpg`. Confirmar o sustituir antes de redistribuir comercialmente (ver `docs/ASSETS_DEMO.md`).
- No se tocó Telegram, Gemini, credenciales, producción ni productos reales en esta fase.

### Próximo (FASE 2)
- Fotografía y catálogo: página individual de producto (`/producto/:slug`), galerías y curaduría de las 18 fotos; completar licencias heredadas o sustituirlas.

## Pruebas reales de Telegram + Gemini — staging local (2026-11-02)

- Preparado `--env staging` con Worker/nombre propios, D1 UUID local dedicado, R2 de staging y persistencia separada `.tmp/sneakerhub-telegram-staging/persist-v2`. Health/catalog y put/get/delete de R2 verificados. Secretos locales en `worker/.dev.vars.staging` (ignorado); plantilla sin secretos en `worker/.dev.vars.staging.example`.
- Aplicadas las migraciones 0001–0004 solo a esa D1 y cargado el seed ficticio `TEST-TRN-001` (1 producto, 2 variantes, 1 categoría, cero pedidos). El Worker staging respondió health 200 y mostró exclusivamente el SKU ficticio.
- Prueba de servicio transaccional sobre la D1 staging: cambio de stock aplicado una vez, segunda confirmación rechazada como `not_pending`; fallo del insert de auditoría revirtió la segunda modificación y conservó estado previo.
- Gemini API real aceptó JSON estructurado para interpretación de lectura usando el modelo configurado; no se consultó D1. Mocks Worker 64/64, TypeScript OK; frontend 52/52 y build OK.
- D1/R2 original permanecen en 19 productos, 90 variantes, 5 categorías, 4 pedidos, 1 configuración, 10 auditorías y 7 objetos. Sin deploy, recursos remotos ni webhook.
- Pendiente para primera prueba Telegram: credenciales de un bot de prueba distinto y API key Gemini exclusiva de staging; después se requerirán autorización específica, endpoint HTTPS y webhook solo para ese bot. No se activará el definitivo.

## Activación HTTPS staging preparada (2026-11-02)

- Revisión final local: health 200; catálogo devuelve solo `TEST-TRN-001`; `/api/admin/stats` sin token devuelve 401; webhook local sin token de bot de pruebas devuelve 503 antes de procesar.
- D1 staging: cancelación aplicada al registro de prueba pendiente; el stock ficticio permanece en 6, con 1 operación aplicada, 1 cancelada y una auditoría. Doble confirmación y rollback por auditoría ya se verificaron contra la D1 local staging.
- La verificación anterior de Telegram/Gemini se hizo con valores que la comparación actual encontró iguales a `.dev.vars`; no se consideran credenciales staging independientes. Reemplazar y volver a verificar antes de otras llamadas.
- D1/R2 original se compararon con la línea base: todas las tablas/filas de aplicación D1 idénticas; los 7 objetos R2 coinciden por metadatos y SHA de blobs. Solo difiere metadata interna `_cf_METADATA` de Wrangler.
- Plan de recursos/comandos HTTPS: [`docs/SNEAKERHUB_STAGING_HTTPS_PLAN.md`](docs/SNEAKERHUB_STAGING_HTTPS_PLAN.md). No se desplegó ni se registró webhook.
- Actualización remota: creada D1 `sneakerhub-telegram-staging-db` (UUID `18ac228c-c142-45c7-b801-6ae0c6e1f8eb`), migraciones 0001–0004 y seed ficticio aplicados. No se desplegó ni registró webhook.

## Preparación del deploy HTTPS staging — 2026-11-02

- Cloudflare acceso verificado; R2 habilitado y bucket `sneakerhub-telegram-staging-assets` existente. La D1 con UUID esperado mantiene ledger 0001–0004 y solo el SKU ficticio `TEST-TRN-001`.
- Wrangler confirmó que el Worker remoto `sneakerhub-telegram-staging` aún no existe; su nombre no coincide con el Worker principal `catalogo-lite-api`. La configuración remota refiere solo la D1/R2 staging.
- `.dev.vars.staging` está ignorado por Git, tiene el propietario numérico y el modelo. El propietario autorizó reutilizar la clave Gemini principal; la prueba real pasó. `getMe` del token disponible identificó `@SneakerHubPruebas_bot`, no `@SneakerHubAdmin_bot`; se detuvo sin modificar webhooks.
- Dry-run pasó. El deploy falló antes de publicar porque el proceso no tiene `CLOUDFLARE_API_TOKEN`; el flujo OAuth interactivo se detuvo sin automatizar autenticación. No se creó Worker ni URL.
- D1/R2 staging verificados, D1 devuelve solo `TEST-TRN-001`; no se ejecutaron migraciones ni escrituras. Worker 64/64 + TypeScript; frontend 52/52 + build. Producción sin cambios.
- Worker 64/64, TypeScript OK; frontend 52/52 y build OK. D1/R2 originales no fueron consultados para escritura ni modificados.

## Plataforma 3.0 multitienda — 2026-11-03

Punto de partida verificado: árbol sin commitear equivalente a producción (Worker 121/121, frontend 55/55, build OK). Punto de restauración: `.tmp/platform30-checkpoint-*/` (tar de archivos modificados/nuevos + commit de `git stash create`).

| Fase | Estado | Evidencia |
|---|---|---|
| 1. Estabilizar | **Verificada** | Línea base OK. Defectos corregidos: navegación durante el render en `LoginPage`; tiendas no disponibles mostraban la identidad de SneakerHub; edición de producto inexistente devolvía 400 en vez de 404; intérprete no reconocía SKU alfanuméricos sin guion en cambios de stock. |
| 2. Asistente IA | **Implementada; verificada con Telegram/Gemini simulados** | 21 pruebas: saludo y menú, poco stock con números en palabras, más vendidos honesto, cambio de precio confirmado una sola vez, “este producto”, ocultar agotados, cancelación, propuesta obsoleta, rol operador, varias tiendas, tienda suspendida, alta con fotos + visión + precio + stock + SKU sugerido + publicación, presupuesto agotado, aviso al 80 %, CSV, banner por foto, error sin detalles técnicos. Falta prueba con Telegram y Gemini reales. |
| 3. Multitienda | **Verificada localmente** | Migración `0007` + reversión verificadas sobre copia del respaldo de producción (hashes idénticos, secuencias preservadas) y en Wrangler D1 local. 11 pruebas negativas de aislamiento. |
| 4. Bot maestro | **Implementada; verificada con Telegram simulado** | 8 pruebas: acceso solo por ID, deduplicación propia, `/crear_tienda` completo, edición/cancelación, doble toque sin duplicado, suspensión por lenguaje natural con confirmación y auditoría, límites de IA y planes. Falta crear el bot real. |
| 5. Aprovisionamiento | **Verificada localmente** | 10 pruebas (idempotencia, reanudación tras fallo, slug ocupado, correo reservado, activación de propietario, estados) + smoke 19/19 en `workerd` sobre la copia migrada + creación y activación desde `/plataforma` en navegador. |
| 6. Preparación comercial | **Parcial** | Docs: `PLATAFORMA_3_0.md`, `DESPLIEGUE_Y_RECUPERACION_3_0.md`, `GUIA_BOTS_3_0.md`. Planes/servicios registrables sin cobros. Despliegue y bots reales pendientes de autorización. |

Totales: Worker **156/156** (19 archivos) y `tsc` OK; frontend **58/58**, `tsc` y build OK (JS inicial 521 kB; `/plataforma` y activación cargan aparte).

No se ejecutó nada remoto: sin migraciones en D1 remota, sin deploy, sin cambios de webhook, sin secretos, sin Netlify. No se crearon productos en staging ni producción; las pruebas locales usaron SQLite en memoria y una copia aislada en `.tmp/platform30-d1-local-*`.

Archivos principales: `database/migrations/0007_multi_tenant_platform.sql`, `database/rollback/0007_…down.sql`, `scripts/verify-d1-migration.mjs`, `worker/src/tenancy/*`, `worker/src/services/{provisioning,platform,platformUsers,templates}.ts`, `worker/src/services/assistant/*`, `worker/src/services/master/bot.ts`, `worker/src/routes/{platform,auth,master}.ts`, `frontend/src/lib/tenant.ts`, `frontend/src/admin/{PlatformPage,ActivationPage}.tsx`.

Siguiente paso recomendado: aplicar `0007` y desplegar en **staging** con autorización, luego producción siguiendo `docs/DESPLIEGUE_Y_RECUPERACION_3_0.md`.

### Staging 3.0 desplegado — 2026-11-03

Con autorización: migración `0007` aplicada en `sneakerhub-telegram-staging-db` (datos idénticos al respaldo, 0 violaciones de FK) y Worker `sneakerhub-telegram-staging` actualizado de `ec76398d` a `267eab01-6dcb-4ba1-b750-2a1e06adbe78`. Smoke test HTTPS 13/13; webhook de `@SneakerHubPruebas_bot` sin cambios ni errores. Producción no se tocó. Detalle y reversión en `docs/DESPLIEGUE_Y_RECUPERACION_3_0.md`. Pendiente: probar el asistente nuevo escribiendo al bot de pruebas.

Después (autorizado): la autenticación reconoce `ENVIRONMENT = "staging"` con reglas de no producción; Worker de staging redesplegado a `f4ff0779-da64-4021-a093-3060e4eca0a4`. Worker 157/157 y `tsc` OK. Verificado por HTTPS: login de superadministrador 200 y `/api/admin/session`, estadísticas, resumen y salud de plataforma con datos reales de staging. La salud marca “propietario” pendiente en la tienda 1 (dueño heredado por `TELEGRAM_OWNER_ID`, sin membresía de plataforma).

### Producción 3.0 desplegada — 2026-11-03

Con autorización: respaldo fresco verificado (`c6403037…`), migración `0007` aplicada en `catalogo-lite-production-db` con datos idénticos (20 productos, 95 variantes, 5 categorías, 7 pedidos), y Worker `catalogo-lite-api` actualizado de `f4619f2f` a `7def7c60-24d1-4f10-8662-8098bf5faf50`. Smoke test HTTPS 15/15 y tienda pública en navegador sin errores. Sin pedidos ni datos de prueba en producción; secretos y webhooks sin cambios. Después (autorizado): commit `ebc2ccb` y push a `main`; Netlify publicó el frontend 3.0 (bundle `index-BYR7Loqy.js`) y se verificaron en navegador la raíz, `/t/sneakerhub-premium`, una tienda inexistente, `/admin/activar` y `/plataforma`. Pendiente: crear el bot maestro y probar el asistente nuevo con `@SneakerHubAdmin_bot`. Reversión en `docs/DESPLIEGUE_Y_RECUPERACION_3_0.md`.

### Primera prueba real del asistente en producción — 2026-11-03

La nota de voz funcionó con Gemini real. Fallaron dos cosas, ya corregidas y desplegadas con autorización: (1) las tallas se rechazaban con punto final o sin color, repitiendo el mismo mensaje; (2) la visión de fotos se cortaba en 600 tokens de salida y no proponía nombre ni descripción (la falla no quedaba en `platform_events`). Ahora se aceptan punto final, separadores "y"/líneas y unidades; el color sale del texto, del nombre o queda "Único"; el error indica qué fragmento no se entendió; los límites de Gemini subieron (fotos 2.048) y toda falla de IA se registra. Worker 162/162. Staging `022cce45` (13/13) y producción `50fac136-a110-4402-b97e-5a6c5e4f91f0` (15/15). Pendiente: repetir el alta de producto con fotos en `@SneakerHubAdmin_bot` para confirmar la visión real.


### Activación del bot maestro — 2026-11-03

El propietario creó el bot maestro en BotFather y cargó `MASTER_BOT_TOKEN`, `MASTER_WEBHOOK_SECRET` y `MASTER_ADMIN_TELEGRAM_IDS` en `catalogo-lite-api` (versión activa `f9928a44`, mismo código que `50fac136`). Verificado sin leer valores: los tres nombres existen en ese Worker y `/api/master/webhook` responde 403 sin secreto o con uno incorrecto. Cambios: menú pedido (Crear nueva tienda, Ver mis tiendas, Administrar propietarios, Configuración de plataforma, Estadísticas, Ayuda con IA), bienvenida, IDs de administrador separados por comas, punto y coma o espacios, y `POST /api/master/maintenance/status|webhook` para que el Worker haga `getMe`/`getWebhookInfo`/`setWebhook` y responda solo datos no sensibles (superadministrador o código de un solo uso cuyo hash se guarda en la tabla existente `platform_operations`; script `scripts/master-maintenance.mjs`). Se eliminó `GET /api/master/setup`. Worker 177/177 y `tsc` OK. Staging `c62112c4-c378-45bd-8e16-cd8267b3dcb2` (smoke 14/14; estado: `@SneakerHubPruebas_bot` con su webhook de staging, sin pendientes ni errores). Después (autorizado): producción `f9928a44` → `2022415f-d2ae-470d-83cd-796d51e248f2`, smoke 14/14 y secretos intactos. `status` confirmó que el token maestro es de `@CatalogoDigitalMaestro_bot` (distinto de `@SneakerHubAdmin_bot`), secreto configurado y 1 ID de administrador válido; webhook del asistente sin cambios y sin pendientes. El bot no respondía porque su webhook no estaba registrado (Telegram retenía los mensajes). Con autorización se registró: Telegram entregó la cola, 3 actualizaciones procesadas desde el chat del administrador, 0 errores, 0 pendientes y ninguna tienda creada; el webhook del asistente no cambió. Pendiente: prueba manual del menú, `/crear_tienda` con cancelación y rechazo de otra cuenta.

### Creación automática de tiendas desde el bot maestro — 2026-11-03

Revisión: el aprovisionamiento ya registraba la tienda, generaba una dirección única, aplicaba configuración, plantilla, categorías, plan, propietario, accesos de un solo uso, verificación y auditoría, todo idempotente. Completado: el asistente de `/crear_tienda` pregunta en el orden pedido (negocio, tipo de comercio, propietario con nombre, WhatsApp, plantilla, uno o dos colores para cualquier plantilla, logotipo opcional, plan). El resumen ofrece Crear tienda · Modificar información · Cancelar. La entrega muestra nombre, URL pública, estado, acceso del propietario (panel y enlace de un toque al asistente IA, cuyo usuario se obtiene del propio bot si `TELEGRAM_BOT_USERNAME` no está definido) e instrucciones, sin identificadores internos. El logotipo se guarda en `stores/<id>/store/`. Nueva eliminación protegida de tiendas de prueba (`DELETE /api/platform/stores/<dirección>`: nunca la principal ni una activa, exige escribir la dirección, un solo lote y auditoría `store_purged`). Worker 181/181 (prueba de entrega de extremo a extremo incluida). Staging `8a7afb51`: tienda de prueba creada (10/10 pasos), activada por el propietario en el navegador, aislada de la principal, publicada y eliminada sin restos; huella de la tienda principal idéntica. Después (autorizado): producción `2022415f` → `88c33008-53b2-4b2e-bf69-2837850a5ee8`, smoke 14/14, secretos intactos, ambos bots sin pendientes ni errores nuevos, sin tiendas creadas. Pendiente: primera tienda real y decidir el bot del asistente compartido. Guía: `docs/ENTREGA_DE_TIENDAS.md`.

### Onboarding inteligente 3.1 — 2026-11-03

Se partió del trabajo 3.1 sin commit (onboarding persistente, paletas, 13 plantillas, migración `0008`) y se completó: vista previa real sin guardar (`/admin/store-preview?template=&palette=`) enlazada desde cada opción de color y plantilla en Telegram; “tonos azules”/“¿cómo cambio los colores?” con tres paletas legibles y confirmación (paleta completa en `update_store_colors`); selector de plantillas fuera del onboarding con confirmación y auditoría; `/ayuda` según el paso; “Quiero subir cinco productos”; botones del producto “✅ Guardar producto / ✏️ Editar / ❌ Cancelar”; composición distinta por familia (cabecera, portada y tarjeta: `frontend/src/lib/templateLayouts.ts`); retorno a la vista previa tras iniciar sesión; botones con URL relativa omitidos para no romper mensajes. Worker 202/202 + `tsc`; frontend 67/67 + build. SneakerHub conserva su composición.

Staging (autorizado en la solicitud): respaldo `.tmp/staging-0008/`, `0008` aplicada sin cambios de datos, Worker `8a7afb51` → `b6b92066-2340-4620-abed-1d6bbe3aa4ac`; E2E HTTPS 15/15 con tiendas ficticias eliminadas al final; smoke OK. Producción, Netlify, webhooks y secretos sin cambios. Capturas en `docs/capturas-3-1/`. Detalle, publicación y riesgos: `docs/ONBOARDING_CLIENTES.md`. Pendiente: prueba con Telegram real y autorización para producción.

Producción (autorizado, 2026-11-03): commit `b110b2d` en `main`, respaldo `.tmp/production-0008/`, `0008` aplicada sin cambios de datos (tiendas 1–3 marcadas como existentes), Worker `88c33008` → `ac6acb57-4ee2-4174-8705-bff90877cf99`, secretos intactos, smoke OK, Netlify `index-DrZH2Exj.js` verificado en navegador. Pendiente: recorrer el onboarding en Telegram real con una tienda de prueba.

### Varias tiendas por cuenta de Telegram — 2026-11-04

Diagnóstico de solo lectura en producción: Muy Parcero tenía propietario sin Telegram vinculado y su código de vinculación seguía sin usar; SneakerHub se reconoce por `TELEGRAM_OWNER_ID`, así que el asistente veía una sola tienda. Implementado: `/tiendas` y `/cambiar_tienda`, tienda actual visible, cancelación de pendientes al cambiar, botones atados a su tienda, tienda adicional por código para una cuenta existente (sin rebajar roles) y reutilización de la cuenta en el bot maestro. Worker 215/215; staging `40ab6cd4` con prueba de escritura 16/16. Producción sin cambios. Instrucciones y detalle: `docs/MULTITIENDA_TELEGRAM.md`.

Producción (autorizado, 2026-11-04): commit `7a7dd26`, Worker `ac6acb57` → `ebf20122-e2e3-4527-bd4f-d7f3cf2735de`; smoke OK, secretos y datos intactos, membresías sin modificar.

### Tallas con letras — 2026-11-04

El asistente rechazaba `S:10, M:10, L:15, XL:20.` (solo leía tallas numéricas). Corregido: tallas XS–6XL y preguntas ante rangos ("20 de la talla S a la XL") sin inventar existencias. Worker 218/218. Staging `d788f84d`; producción (autorizado) `ebf20122` → `226aef4e-a545-428c-91e6-079232507d84`, commit `68a8f84`; smoke OK, secretos intactos.

### Plataforma de comercio — auditoría y Fase 2 — 2026-11-04

Auditoría y matriz en `docs/PLATAFORMA_COMERCIO_AUDITORIA.md`. Fase 1 (multitienda) verificada en producción. Fase 2 implementada: pedidos desde Telegram (lista, detalle, transiciones confirmadas, pago verificado, despacho con guía, aviso de pedidos nuevos), transportadora y guía en el panel, migración `0009` con libro de movimientos de inventario y bloqueo de stock negativo, entradas y salidas con motivo por Telegram y alertas de stock bajo. Worker 229/229, frontend 67/67. Staging: `0009` aplicada (respaldo `.tmp/staging-0009/`), Worker `c2ca4381`, prueba de escritura 18/18. Producción sin cambios; el push debe ir después del Worker de producción.

### Fases 3–6 — 2026-11-04

Indicadores comerciales, roles vendedor y encargado de inventario con permisos explícitos y `/equipo`, cupones y consentimiento en el carrito, campañas con aprobación y envío manual, bajas, seguimiento de pedidos sin confirmar, límite de productos por plan, facturas de plataforma, estados de dominio y alertas de IA en el bot maestro. Migración `0010` (reconstruye `store_memberships` con las mismas filas). Worker 245/245, frontend 67/67. Staging `e136904a` con `0010`; prueba de escritura 24/25 (la única marca es la entrega de Telegram a un usuario ficticio). Producción sin cambios; orden de publicación en `docs/PLATAFORMA_COMERCIO_AUDITORIA.md` §4.

Producción fases 2–6 (autorizado, 2026-11-04): respaldo `.tmp/production-0010/`, `0009` y `0010` aplicadas sin cambios de datos (membresías intactas), Worker `226aef4e` → `93d77cc7-ac57-4a43-a320-fdc303345250`, push `a4804ba`, Netlify `index-9PRDiP3E.js`. Smoke test y navegador correctos.

### Migración a Cloudflare — 2026-11-04

Frontend publicado en Cloudflare Workers Static Assets: https://catalogo-digital-ia.catalogo-lite-worker.workers.dev (Worker `catalogo-digital-ia`, versión `23744f4e`), con fallback de SPA y `/api/*` por service binding hacia `catalogo-lite-api` (mismo origen, sin CORS). Validado: rutas, ambas tiendas, imágenes de R2, producto, carrito sin enviar pedidos, 401 sin sesión, móvil. Builds de Netlify desactivados (`ignore = "exit 0"`), sitio conservado. Pendiente con aprobación: desplegar el backend con `PUBLIC_STORE_BASE_URL` y `ALLOWED_ORIGIN` de Cloudflare (preparado en `wrangler.production.toml`; el despliegue fue bloqueado a la espera de autorización). Detalle: `docs/MIGRACION_CLOUDFLARE.md`.

Backend con URLs de Cloudflare (autorizado, 2026-11-04): `93d77cc7` → `7890daf2-a831-4582-b330-ef16004649da`; CORS Cloudflare + Netlify en transición, otros orígenes rechazados; los tres bots con webhooks intactos, 0 pendientes y sin errores.

### Restablecer contraseña — 2026-11-04

“¿Olvidaste tu contraseña?” en el panel: enlace de un solo uso (60 min, solo hash) al Telegram vinculado; `/admin/restablecer`; `/restablecer <correo>` en el bot maestro. Respuesta genérica, límites de intentos y auditoría. Worker 250/250, frontend 67/67; staging `9abfb6e7` con prueba 7/7. Producción pendiente de autorización. Correo electrónico pendiente de proveedor. Ver `docs/RESTABLECER_CONTRASENA.md`.

Producción (autorizado, 2026-11-04): backend `7890daf2` → `c0ba4940-32fc-40c8-9e2e-6c2e435c3432`, frontend `23744f4e` → `3f0bdfa0-ceae-4b58-b3c6-c27dc2c4d3d2`, sin migraciones. Verificado: botón “¿Olvidaste tu contraseña?”, página de restablecimiento, respuesta genérica, enlace falso 404, contraseña débil 400, tiendas 200, panel 401 y webhooks 403.

### MOSTRALO PUES! (sitio comercial) — 2026-11-04

Proyecto independiente en `apps/mostralopues-landing/` (React + Vite prerenderizado, GSAP diferido, teléfono 3D en Three.js). Worker propio `mostralopues`, solo archivos estáticos y sin bindings. **Sin desplegar**: el dry-run de Wrangler leyó 58 archivos y reportó «No bindings found». Playwright 20/20 en escritorio y móvil, más destinos reales verificados. Seis anchuras sin errores ni desbordes. Lighthouse móvil 93/100/100 y escritorio 99/100/100 (Performance, Accesibilidad, Buenas prácticas). SEO 66 por el `noindex` de prepublicación. LCP móvil simulado de 3,0 s, todavía por encima del objetivo de 2,5 s. La plataforma no se modificó. Detalle: `apps/mostralopues-landing/REPORTE.md`; propuesta: `docs/MOSTRALOPUES_FASE_A.md`.

Publicado (autorizado, 2026-11-04) en **https://mostralopues.pages.dev**: proyecto Cloudflare Pages `mostralopues`, despliegue `6cff6fa8`. Se usó Pages en lugar de un Worker para tener la URL corta, así que el Worker `mostralopues` no se creó. Sigue con `noindex`. Verificado en vivo: Playwright 20/20, encabezados de seguridad y 404. Lighthouse en vivo: móvil 90/100/100, escritorio 98/100/100, con LCP móvil simulado de 3,4 s.

### Pedido por WhatsApp en celulares — 2026-11-04

El pedido se registraba, pero en celulares y en los navegadores de Instagram, Facebook y TikTok no llegaba a WhatsApp. Causa: la pestaña se abría en blanco y se redirigía después de registrar el pedido. Además, el botón «Enviar pedido por WhatsApp» quedaba fuera de la pantalla porque solo los productos tenían scroll.

Arreglo (`frontend/src/lib/whatsapp.ts`, `CartDrawer.tsx`, `ProductPage.tsx`):
- En celulares y en esas apps se navega a WhatsApp en la misma pestaña.
- En computador se abre una pestaña nueva; si el navegador la bloquea, se usa la misma pestaña.
- Botón de respaldo «Abrir WhatsApp».
- El carrito tiene un solo scroll y el botón de envío queda fijo abajo.

Verificación: frontend 69/69. Prueba de punta a punta con Playwright 9/9, en local y en producción, con el envío del pedido simulado (sin pedidos reales): Android, iPhone SE, ficha de producto y computador; todos abren `wa.me/<número de la tienda>`.

Publicado con autorización: frontend `3f0bdfa0` → `b467399d-9ebd-415c-9457-93879940c5ae`. Para revertir: `cd frontend; node ../worker/node_modules/wrangler/bin/wrangler.js rollback 3f0bdfa0-ceae-4b58-b3c6-c27dc2c4d3d2`.

Tienda Luz Mágica (`/t/luz-magica`, tienda 4, plan Profesional): creada desde el bot maestro. Se cargaron por API 115 productos, 273 fotos, 10 categorías, la plantilla Boutique rosa, el logo, la portada y los textos.

Botón «Plataforma · todas las tiendas» en el panel (solo superadministrador) y `scripts/set-superadmin.mjs` (restablece ADMIN_EMAIL/ADMIN_PASSWORD_HASH sin exponer la clave). Publicado con autorización: frontend `b467399d` → `7ced8c3b-f8ab-4e04-a6f4-45c6f36f090e`.

### Módulos IA de MOSTRALO PUES! — Fase 1 (diagnóstico) y Fase 2 (créditos) — 2026-11-05

El diagnóstico y el plan por fases están en `docs/MODULOS_IA_DIAGNOSTICO_Y_PLAN.md`. Decisiones aprobadas:

- Empezar la Fase 2 en local y staging.
- Usar `read-excel-file` y `pdfjs-dist` en la Fase 3.
- Para la prueba sin registro, solo límite por IP (sin Turnstile).

**Fase 2 — créditos de IA por tienda**

- **Migración aditiva `0011_ai_credits.sql`.** Crea tres tablas:
  - Libro de movimientos de solo inserción, con reservas que vencen a los 15 minutos, un único cierre por reserva y claves de idempotencia.
  - Costos por acción. Arranca vacía: no se fijan valores comerciales.
  - Solicitudes de recarga, sin cobro en línea.
- **Permisos.** Solo el superadministrador recarga o ajusta créditos, y un ajuste nunca deja el saldo negativo. El comercio solo ve su saldo y pide recargas.
- **`runWithCredits`.** Une el interruptor de IA de la tienda, el presupuesto mensual y la reserva de créditos. Si la IA falla, devuelve los créditos.
- **Interfaz.** Página «Créditos IA» en el panel y sección «Créditos de IA» en Plataforma.

**Verificación**

- Worker 265/265: 15 pruebas nuevas cubren doble envío, carrera por los últimos créditos, reserva vencida, autorrecarga prohibida, aislamiento entre tiendas y borrado de la tienda.
- Frontend 69/69, con `build` correcto.
- Staging: `0011` aplicada y Worker `9b3af30b-e602-46ce-a392-96597e9ab6f9`. Prueba de punta a punta 14/14 con una tienda temporal, que se eliminó al final.

**Pendiente**

- Producción: no se ha tocado.
- Las pantallas no se revisaron con datos reales en el navegador.

### Módulos IA — Fase 3 (importación desde CSV, Excel y PDF) — 2026-11-05

Asistente de 6 pasos en `/admin/importar`: Archivo → Lectura → Columnas → Vista previa → Confirmar → Resultado.

- **Lectura en el navegador.** El archivo se lee en el navegador con un lector CSV propio, `read-excel-file@9.3.12` y `pdfjs-dist@6.4.299`.
- **Validación en el servidor.** El servidor vuelve a validar todo, con la migración aditiva `0012` y lotes de 50 que se aplican una sola vez.
- **Productos que ya existen.** No se tocan, salvo que la tienda lo autorice expresamente; en ese caso cambian solo el precio y las existencias.
- **Datos que no se inventan.** No se importan filas sin precio y no se generan códigos sin permiso.
- **Contenido no confiable.** Las fórmulas no se ejecutan y el texto importado se guarda como texto.

**Verificación**

- Servidor 273/273 y panel 77/77.
- Staging: `0012` aplicada y Worker `e102c4a8-b78b-4e9f-9476-c1e876a6efdf`. Prueba en navegador 18/18, con una tienda temporal que se eliminó al final.

**Pendiente**

- La lectura de PDF escaneados con IA pasa a la Fase 4.
- Producción no se ha tocado.

### Módulos IA — Fase 4 (productos desde fotos y PDF escaneados con IA) — 2026-11-05

**Funciones nuevas**

- **«Desde fotos»** (`/admin/fotos`): la IA sugiere nombre, descripción y categoría. El código, el precio y las existencias los pone la tienda.
- **«Leer con IA»** en la importación: sirve para PDF escaneados, procesa hasta 20 páginas por vez y copia los datos tal como aparecen.

**Servidor**

- Rutas `POST /api/admin/ai/photo-product` y `POST /api/admin/ai/catalog-page`.
- Pasan por el interruptor de IA, el presupuesto mensual y los créditos.
- Solo se aceptan fotos de la propia tienda.

**Verificación**

- La visión de Gemini se verificó contra la API real.
- Servidor 280/280 y panel 78/78.
- Staging (Worker `fe874925-5d16-4d3b-9cb9-6dba5a559a62`): API 10/10 y navegador 13/13, con tiendas temporales que se eliminaron al final.

**Pendiente**

- Producción no se ha tocado.
