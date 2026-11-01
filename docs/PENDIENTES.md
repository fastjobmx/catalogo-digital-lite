# Pendientes

Lista honesta de lo que **no** está completo, para no dar por funcional lo que aún falta. Lo que aparece aquí es trabajo real pendiente, no documentación pendiente.

## Requiere credenciales externas (código listo, no probado en vivo)

| Ítem | Estado real |
|---|---|
| Bot de Telegram | El webhook está implementado. Sin `TELEGRAM_BOT_TOKEN` responde **503** (verificado). No se ha probado contra la API real de Telegram porque no hay token. |
| Gemini | El intérprete local determinista funciona y está probado. La llamada a Gemini con clave real **no** se ha ejecutado. Sin clave, el bot responde `SIMULADO local / PENDIENTE DE CREDENCIALES`. |
| Despliegue en Cloudflare | Scripts listos (`scripts/deploy.ps1`) pero **no** ejecutados: requieren cuenta, D1 remota, R2 y secrets propios. |

## Funcionalidad incompleta (trabajo pendiente)

1. **Transcripción de notas de voz.** El webhook acepta notas de voz, pero la descarga del archivo y su transcripción con Gemini **no** están implementadas: hoy responde con un aviso.
2. **Cuestionario inicial.** La versión web (`/admin/onboarding`) tiene **11 pasos** (la especificación pedía 16). La tabla `onboarding_sessions` existe en D1, pero el flujo multi-paso **por Telegram** no está implementado.
3. **Límite de peticiones del webhook.** No hay *rate limiting* por chat ni por IP en `POST /api/telegram/webhook`.
4. **Segundo seed de ejemplo.** `database/seeds/boutique-demo.sql` (tienda "Maison Lumière") existe como alternativa, pero ningún script lo aplica; solo se usa `demo-store.sql`.

## Resueltos

- **Carga de fotos en el panel.** `POST /api/upload/image` (R2) conectado al formulario de `/admin/products`: botón de subida, miniaturas, eliminación y alternativa por URL. Verificado: 401 sin token, subida y lectura desde R2.
- **Filtros de tienda por talla, color y precio.** Implementados en categoría y búsqueda mediante `frontend/src/components/ProductFilters.tsx` (los desplegables de talla y color se generan solo si existen variantes con ese dato).
- **Persistencia de pedidos.** Nuevo `POST /api/orders` (validado con Zod) registrado desde el checkout de WhatsApp; `GET /api/orders` y `PATCH /api/orders/:id` protegidos con JWT. `/api/admin/stats` ya cuenta los pedidos del día y el panel `/admin/orders` los muestra y permite cambiar el estado.

## Notas de entorno

- **Puerto del Worker en desarrollo: 8788** (el 8787 suele estar ocupado por otros procesos). Vite hace proxy de `/api` a `http://localhost:8788`.
- **CORS**: en producción define `ALLOWED_ORIGIN` (dominio de Cloudflare Pages, separado por comas) para que el frontend pueda llamar al Worker.
- **D1 local** no admite `UNION ALL` en `SELECT` compuestos; los seeds usan subconsultas en su lugar.
- Los scripts `.ps1` deben mantenerse en **ASCII** para que Windows PowerShell 5 los interprete correctamente.

## Continuación visual — SneakerHub Premium

- **Verificación del estado Git.** El directorio `catalogo-lite` no contiene metadatos Git y los comandos ejecutados desde esta ruta devuelven un error al resolver el repositorio padre. Se conservaron copias previas de los archivos de la Fase 1 en `.tmp/phase1-checkpoint-20261101/`; confirmar el estado con un checkout Git válido antes de integrar o publicar.
- **Revisión visual local.** El navegador no se pudo inspeccionar: la herramienta de control se detuvo porque no pudo determinar la URL activa con suficiente certeza. La solicitud HTTP local también fue denegada por permisos de socket; completar esta revisión desde un navegador accesible.
- **Licencias de imágenes heredadas.** No se encontró fuente de `ASTRAL-03.jpg`, `NORD-02.jpg`, `VOLTA-04.jpg`, `hero-editorial.jpg` ni `logo.jpg`. Confirmar o sustituir antes de redistribuir la plantilla comercialmente. Ver el inventario en `docs/ASSETS_DEMO.md`.
- **Galerías del catálogo demo.** Las 18 fichas tienen una foto principal, pero ninguna galería secundaria. Preparar vistas adicionales autorizadas antes de dar por completa la experiencia de detalle.
- **Colores de variantes demo.** Las variantes actuales contienen tallas y stock, pero `color` es `null` en todas. Definir combinaciones de talla/color antes de considerar cubierta la selección de variantes.
- **Fase 4 en vivo.** Probar con una sesión admin que la apariencia persiste en D1 y que las cargas de logo, favicon, portada, banner y categorías quedan disponibles desde R2. La vista previa y las suites automatizadas pasaron; la persistencia remota no fue comprobada en esta sesión.
- **Fase 5 en vivo.** Completar revisión visual de admin/responsive y flujo manual con API/Worker activos. La revisión estática de rutas y el build pasaron; no se contó con una sesión de navegador conectada. No se modificaron automatizaciones ni se desplegó.

## Cómo retomar

Cada pendiente de la sección "Funcionalidad incompleta" es autocontenido:

- Voz → `worker/src/services/telegram.ts` (`message.voice`).
- Cuestionario Telegram → `onboarding_sessions` + estados del bot.
- Límite de peticiones → middleware en `worker/src/routes/telegram.ts` (tabla de marcas de tiempo por chat).
- Segundo seed → añadir `-Seed boutique` a `scripts/setup.ps1` / `reset-db.ps1`.

## Diagnóstico urgente de catálogo (2026-11-01)

- Estado D1 local respaldado y verificado desde snapshot: 18 productos activos/no archivados, 85 variantes activas y 5 categorías activas; no fue necesario recuperar ni importar datos.
- Las 18 imágenes principales referenciadas por D1 existen bajo `frontend/public/seed-images/sneakerhub/` y son JPEG legibles. No se encontraron rutas rotas en el catálogo local actual.
- Falta cotejar `GET /api/products` y carga real de imágenes vía navegador; Worker/Vite no estaban accesibles por las restricciones de sockets locales. No hay captura ni respuesta HTTP en vivo.
- El dato documental de D1 inicial (6 productos/25 variantes) no coincide con el snapshot presente (18/85). No se ejecutaron seeds ni se cambió D1/R2.
- Se corrigió el fallback silencioso a demo cuando hay backend seleccionado y falla el API; también se evita borrar productos demo/overrides de tienda al subir la versión del catálogo.
- Un fallo de lectura de configuración ya no se interpreta como backend desconectado si el health check respondió; la tienda conserva la fuente backend y presenta el error.
- **Pendiente obligatorio en equipo local del usuario:** ejecutar HTTP GET y navegador en `localhost`. En este entorno ambos puertos se bloquearon por permisos de socket, así que no hay conteo API ni HTTP 200 de fotos comprobado. Consultar los comandos exactos entregados en el cierre de la tarea.

## Rendimiento del catálogo — verificación local pendiente (2026-11-01)

- Código optimizado: listado del Worker con una consulta conjunta en lugar de la consulta de variantes repetida por producto; deduplicación de GET concurrentes en frontend; WebP con fallback JPEG para las imágenes locales.
- Comparación local de archivos: 21 JPEG = 3,188,131 bytes; 21 WebP = 2,027,680 bytes (36.4% menos bytes en derivados locales). No representa una prueba HTTP.
- Build y pruebas automatizadas pasan; la prueba de ruta del Worker verifica una sola consulta para devolver los 18 productos simulados de la prueba.
- Sigue pendiente abrir la tienda y consultar `GET /api/products` en el equipo local del usuario. En esta sesión, el sistema bloqueó la conexión a localhost antes de que pudiera verificarse cualquiera de los puertos; por ello no se conoce el total HTTP real, estado de cada imagen, solicitudes de red ni render React.
- No hubo modificaciones a D1/R2/inventario ni a imágenes originales; no se aplicaron seeds ni se desplegó.

## Imágenes de tienda pública — aceptación en navegador pendiente (2026-11-01)

- La URL JPEG raíz comparada para ASTRAL-03 coincide entre el valor de catálogo y el origen usado en las vistas. El admin muestra JPEG directo; el storefront ofrece WebP y oculta el elemento hasta `onLoad`. Se agregó fallback de una sola pasada a JPEG ante el error del WebP.
- Los 18 JPEG y los 18 derivados WebP existen en disco; los cuatro archivos de productos reportados se decodifican. Esto no confirma HTTP 200 ni descarga del navegador.
- Frontend: 39/39 pruebas en 11 archivos y build OK; Worker: 29/29 pruebas y typecheck OK. Hay regresión SSR para las imágenes de ProductCard. Categoría y búsqueda priorizan sus primeras cuatro imágenes; el resto permanece lazy.
- **Pendiente antes de declarar resuelto:** iniciar Worker/Vite en el equipo local, ejecutar el bloque de `docs/PRUEBAS.md` para revisar API y HTTP/Content-Type/bytes de los 18 JPEG/WebP, recorrer las páginas en navegador y confirmar `currentSrc`, `naturalWidth`, opacidad, skeleton y errores de consola. Este entorno rechazó la escucha local con `EACCES`; no se inventaron resultados de red ni visuales.
- No tocar fotografías/datos/admin/estilo; no ejecutar seeds/reset ni desplegar.

### Actualización: causa de imágenes invisibles corregida (2026-11-01)

- La categoría Running reprodujo la causa: las 4 imágenes se descargaban y decodificaban (`naturalWidth>0`), pero `ProductImage` reiniciaba su estado tras `onLoad`, dejándolas en opacidad cero.
- Corregido con reconciliación del elemento `img` ya completo/decodificado. En navegador, después de recarga completa, Running muestra 4/4 fotos con opacidad 1.
- Frontend 40/40 pruebas y build OK. Queda pendiente recorrer el catálogo completo para comprobar las 18 en cada ruta y obtener estados HTTP explícitos/API; no se afirma esa cobertura total.

## Corrección crítica de UX — aceptación local pendiente (2026-11-01)

- Implementadas correcciones para scroll de rutas, búsqueda/fallback de producto por SKU, normalización central de fotos y fallback WebP→JPEG, además de sidebar de admin clara y móvil con foco/teclado.
- Verificación read-only del snapshot D1: 18 productos activos; 18/18 imágenes locales existen, se decodifican y su nombre corresponde al SKU. Sus derivados WebP también existen. Esto no demuestra que Vite/Worker los sirvan por HTTP.
- Build frontend OK; bundle inicial 464.58 kB (135.19 kB gzip) y chunk de Apariencia 37.31 kB (9.71 kB gzip); frontend 33/33 pruebas; Worker typecheck OK y 29/29 pruebas.
- Falta confirmar en navegador los flujos de la solicitud (home/categoría/búsqueda → detalle, reload, atrás/adelante, scroll, carrito y vistas admin/móvil) y medir HTTP 200/Content-Type de las 18 fotos. La herramienta de navegador no pudo determinar la URL activa; las llamadas localhost están bloqueadas por permisos de socket.
- Copias previas verificables: `.tmp/critical-ux-20261101/before/manifest.csv`. Git no está disponible porque esta carpeta no tiene `.git`.
