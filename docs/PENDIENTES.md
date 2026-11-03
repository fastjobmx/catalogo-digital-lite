# Pendientes

## Plataforma 3.0 — pendientes (2026-11-03)

Requieren tu autorización o intervención (no se ejecutaron):

- [x] Producción: `0007` aplicada y Worker 3.0 desplegado (versión `7def7c60`) el 2026-11-03; smoke test 15/15.
- [x] Staging: `0007` aplicada y Worker 3.0 desplegado (versión `267eab01`) el 2026-11-03. Falta probar el asistente escribiendo a `@SneakerHubPruebas_bot`.
- [x] Staging: inicio de sesión del panel y `/api/platform` habilitados (versión `f4ff0779`).
- [ ] Staging/producción: la tienda 1 no tiene propietario como usuario de plataforma (su dueño se vincula por `TELEGRAM_OWNER_ID`); la salud lo marca pendiente. Asignarlo con `/asignar_admin` o `POST /api/platform/stores/<tienda>/owner` cuando se decida su correo.
- [x] Bot maestro creado en BotFather y secretos `MASTER_*` cargados en `catalogo-lite-api` (2026-11-03, por el propietario).
- [x] Menú y verificación del bot maestro en producción (`2022415f`, 2026-11-03); identidad comprobada: `@CatalogoDigitalMaestro_bot`, distinto del asistente.
- [x] Webhook del bot maestro registrado (2026-11-03); entrega sin errores y mensajes del administrador procesados.
- [ ] Prueba manual en Telegram del bot maestro: menú de 6 botones, `/crear_tienda` y cancelar; otra cuenta no debe recibir respuesta.
- [ ] Decidir el bot del **asistente compartido** (seguir con `@SneakerHubAdmin_bot` o un bot de nombre neutro) y definir `TELEGRAM_BOT_USERNAME`. Cambiar de bot implica un cambio de webhook autorizado aparte.
- [x] Frontend 3.0 publicado en Netlify (commit `ebc2ccb`, bundle `index-BYR7Loqy.js`) el 2026-11-03.
- [ ] Probar el asistente nuevo en producción escribiendo a `@SneakerHubAdmin_bot` (el dueño vinculado sigue siendo el propietario de la tienda 1).
- [ ] Definir precios reales de planes y servicios (hoy en 0; no hay cobros automáticos).

Verificación real pendiente (código y pruebas locales listos):

- [ ] Gemini real para visión de fotos, voz y descripciones (las pruebas usan respuestas simuladas; Gemini real respondió en sesiones anteriores solo para interpretación).
- [ ] Recorrido completo por Telegram real del asistente multitienda y del bot maestro.
- [ ] Ajustar `GEMINI_PRICE_*` a la tarifa vigente del modelo usado: el costo es una estimación configurable.

Funciones planificadas (no implementadas):

- [ ] Pantalla de equipo (invitar/revocar operadores) en el panel; hoy existe la API `/api/admin/team`.
- [ ] Activación automática de dominios propios (hoy: registro “pendiente” + pasos manuales DNS/Netlify).
- [ ] Notificaciones proactivas al propietario (nuevo pedido, stock bajo) y respuestas a clientes por WhatsApp.
- [ ] Importación de productos nuevos por CSV (hoy el CSV actualiza precios y stock de productos existentes).
- [ ] Idiomas adicionales del asistente (hoy español).



Lista honesta de lo que **no** está completo, para no dar por funcional lo que aún falta. Lo que aparece aquí es trabajo real pendiente, no documentación pendiente.

## Tiendas independientes (nuevo trabajo por fases)

### Fase 1 — Auditoría y arquitectura

- **Completada el 2026-11-01.** Ver [`ARQUITECTURA_MULTI_TIENDA.md`](ARQUITECTURA_MULTI_TIENDA.md) para el inventario, los límites de seguridad y el plano propuesto.
- Verificaciones actuales: frontend 40/40 y build OK; Worker 29/29 y typecheck OK; 69 archivos locales JPEG/WebP decodificados. La comprobación HTTP/navegador no se realizó en esta fase.

### Siguientes fases

- **Fase 2 — Generador local:** completada. `scripts/new-store.ps1` crea únicamente instalaciones demo locales y aisladas; `-DryRun`, rechazo de destinos existentes y build/typecheck de instalaciones generadas verificados. Ver [`GENERADOR_DEMOS.md`](GENERADOR_DEMOS.md).
- **Fase 3 — Presets y seeds:** completada para Patitas Felices y TecnoCell Accesorios. Incluye manifiestos, catálogos idempotentes e imágenes con procedencia/licencia registrada. Los seeds heredados continúan siendo inadecuados para instalaciones existentes: `demo-store.sql` actualiza configuración y elimina SKU conocidos; `boutique-demo.sql` borra tablas completas. No aplicarlos en tiendas existentes.
- **Fase 4 — Aislamiento y regresión:** aceptación automatizada e interactiva local completada en Fase 7. D1, UUID, puertos, sesiones/almacenamiento, buckets locales y catálogos independientes verificados; sin SKU de SneakerHub en D1 o bundle.
- **Fase 5 — Cloudflare:** completada como preparación documental en [`AUTOMATIZACION_TIENDAS.md`](AUTOMATIZACION_TIENDAS.md). No se ejecutó aprovisionamiento, modificación de recursos remotos ni despliegue; cualquier ejecución remota queda fuera de este avance.
- **Fase 6 — Configurador y servicios reutilizables:** completada para configuración inicial y preparación de operaciones compartidas. El cuestionario guarda por API autenticada y no inserta productos ficticios; `worker/src/services/business.ts` comparte operaciones de catálogo, inventario, configuración e imágenes entre rutas administrativas y el ejecutor existente. El agente completo de Telegram sigue fuera del alcance.
- **Fase 7 — aceptación local:** completada en navegador para storefront, productos/categorías, fotografías, ficha, login y administración, personalización, carrito persistente y aislamiento. Informe: [`ACEPTACION_TIENDAS_DEMO.md`](ACEPTACION_TIENDAS_DEMO.md).
- **Fase 8 — seguridad y consolidación:** CTA independiente/preset, carga de carrito antes de persistir y fallback WebP→JPEG están consolidados en la plantilla y las demos. Auth falla cerrado sin configuración; la demo offline es opt-in solo en Vite dev. Frontend 52/52, Worker 39/39 y builds de ambas tiendas OK. Ver [`FASE8_SEGURIDAD.md`](FASE8_SEGURIDAD.md).
- **Bloqueo funcional:** configurar el número WhatsApp verdadero de cada tienda antes de probar la redirección y confirmar pedidos. No se inventó ni se guardó un número.
- **Bloqueos de producción:** configurar secretos propios por tienda y `ENVIRONMENT=production`, fijar `ALLOWED_ORIGIN` al dominio real y rotar cualquier valor antiguo que se hubiera usado fuera del entorno local. No se cambiaron credenciales ni el historial Git. Ver [`CHECKLIST_PRODUCCION.md`](CHECKLIST_PRODUCCION.md).
- **Generador — Fase 8.2 con validación parcial:** tres generaciones consecutivas pasaron con PowerShell 5.1, Node 26.8.1 y Wrangler 4.156.0 usando migraciones nativas D1. Se verificaron catálogo y fotos por preset. Falta repetir la matriz con Node LTS alterno y Wrangler alternativo; el DNS del registro npm dio `ENOTFOUND`, así que `npm ci` falló en los seis paquetes y no se pudieron verificar builds/login/API dentro de las copias generadas. El generador pasó las suites de plantilla; aún no se recomienda preparar una tienda piloto hasta resolver dependencias/entorno. Ver [`FASE82_ESTABILIDAD.md`](FASE82_ESTABILIDAD.md).
- **UX demo:** las instalaciones existentes cargan el CTA propio del preset desde configuración local generada; la plantilla no incluye copy de Patitas/TecnoCell. SneakerHub Premium conserva su texto.

## Requiere credenciales externas (código listo, no probado en vivo)

| Ítem | Estado real |
|---|---|
| Bot de Telegram | El webhook está implementado. Sin `TELEGRAM_BOT_TOKEN` responde **503** (verificado). No se ha probado contra la API real de Telegram porque no hay token. |
| Gemini | El intérprete local determinista funciona y está probado. La llamada a Gemini con clave real **no** se ha ejecutado. Sin clave, el bot responde `SIMULADO local / PENDIENTE DE CREDENCIALES`. |
| Despliegue en Cloudflare | Scripts listos (`scripts/deploy.ps1`) pero **no** ejecutados: requieren cuenta, D1 remota, R2 y secrets propios. |

## Funcionalidad incompleta (trabajo pendiente)

1. **Transcripción de notas de voz.** El webhook acepta notas de voz, pero la descarga del archivo y su transcripción con Gemini **no** están implementadas: hoy responde con un aviso.
2. **Cuestionario inicial.** La versión web (`/admin/onboarding`) tiene **11 pasos** (la especificación pedía 16). La tabla `onboarding_sessions` existe en D1, pero el flujo multi-paso **por Telegram** no está implementado.
3. **Límite de peticiones.** No hay *rate limiting* por chat/IP en `POST /api/telegram/webhook` ni por intentos en `/api/admin/login`; añadirlo antes de exposición pública.
4. **Tiendas demo aisladas.** Las instalaciones locales nuevas usan `scripts/new-store.ps1` y seeds idempotentes bajo `database/seed-presets/`. El seed heredado de SneakerHub y `boutique-demo.sql` siguen fuera del generador; antes de publicar cualquier tienda real, verificar precios, inventario, imágenes y datos de contacto del preset.

## Resueltos

- **Carga de fotos en el panel.** `POST /api/upload/image` (R2) conectado al formulario de `/admin/products`: botón de subida, miniaturas, eliminación y alternativa por URL. Verificado: 401 sin token, subida y lectura desde R2.
- **Filtros de tienda por talla, color y precio.** Implementados en categoría y búsqueda mediante `frontend/src/components/ProductFilters.tsx` (los desplegables de talla y color se generan solo si existen variantes con ese dato).
- **Persistencia de pedidos.** Nuevo `POST /api/orders` (validado con Zod) registrado desde el checkout de WhatsApp; `GET /api/orders` y `PATCH /api/orders/:id` protegidos con JWT. `/api/admin/stats` ya cuenta los pedidos del día y el panel `/admin/orders` los muestra y permite cambiar el estado.

## Notas de entorno

- **Puerto del Worker en desarrollo: 8788** (el 8787 suele estar ocupado por otros procesos). Vite hace proxy de `/api` a `http://localhost:8788`.
- **CORS**: en producción define `ALLOWED_ORIGIN` (dominio de Cloudflare Pages, separado por comas) para que el frontend pueda llamar al Worker.
- **D1 local** no admite `UNION ALL` en `SELECT` compuestos; los seeds usan subconsultas en su lugar.
- Los scripts `.ps1` deben mantenerse en **ASCII** para que Windows PowerShell 5 los interprete correctamente.

## Continuación visual — SneakerHub Premium (FASE 1 completada 2026-11-02)

- **Estado:** build OK (tsc 0 errores), suites frontend 52/52 y worker 23/23 en verde; seed de 18 productos aplicado a D1 local; API sirve `/api/products` (18), `/api/categories` (5) y `/api/store` con paleta por defecto.
- **Documentación creada:** `docs/STREETWEAR_PREMIUM.md`, `docs/GUIA_PERSONALIZACION.md`, `docs/PRUEBAS_VISUALES.md`; `docs/ASSETS_DEMO.md` actualizada.
- **Verificación visual a 375/390/768/1024/1440 px ❌ pendiente:** `browser.screenshot` requiere una pestaña visible en ventana de escritorio, no disponible en este entorno. Completar desde un navegador accesible y documentar en `docs/PRUEBAS_VISUALES.md`.
- **Persistencia remota en D1 desde `/admin/apariencia` ❌ pendiente:** no se probó con sesión de administrador conectada.
- **HTTP de las 18 fotos y render React en vivo ❌ pendiente:** localhost estuvo bloqueado por permisos de socket; se confirmó a nivel de archivo y API, no a través del navegador por cada imagen.
- **Licencias de imágenes heredadas:** no se encontró fuente de `ASTRAL-03.jpg`, `NORD-02.jpg`, `VOLTA-04.jpg`, `hero-editorial.jpg` ni `logo.jpg`. Confirmar o sustituir antes de redistribuir comercialmente. Ver `docs/ASSETS_DEMO.md`.
- **Galerías del catálogo demo:** las 18 fichas tienen una foto principal, pero ninguna galería secundaria. Preparar vistas adicionales autorizadas antes de dar por completa la experiencia de detalle (FASE 2).
- **Colores de variantes demo:** `color` es `null` en todas las variantes. Definir combinaciones de talla/color antes de considerar cubierta la selección de variantes.

## Cómo retomar (visual)

Desde una máquina con navegador accesible y sin bloqueo de sockets en localhost:

1. Worker: `cd worker && npx wrangler dev --port 8788`
2. Frontend: `cd frontend && npx vite --port 5173`
3. `npx tsc --noEmit` y `npx vitest run` en ambos.
4. Abrir `http://localhost:5173/` y capturar a 375, 390, 768, 1024 y 1440 px (home, header, menú móvil, hero, categorías, rails, contacto, footer).
5. Abrir `http://localhost:5173/admin/apariencia` y verificar cambio de paleta, presets, guardar/restaurar.
6. Documentar resultados en `docs/PRUEBAS_VISUALES.md` y actualizar `PROGRESO.md`.

## Tiendas independientes (nuevo trabajo por fases)

### Fase 1 — Auditoría y arquitectura

- **Completada el 2026-11-01.** Ver [`ARQUITECTURA_MULTI_TIENDA.md`](ARQUITECTURA_MULTI_TIENDA.md) para el inventario, los límites de seguridad y el plano propuesto.
- Verificaciones actuales: frontend 40/40 y build OK; Worker 29/29 y typecheck OK; 69 archivos locales JPEG/WebP decodificados. La comprobación HTTP/navegador no se realizó en esta fase.

### Siguientes fases

- **Fase 2 — Generador local:** completada. `scripts/new-store.ps1` crea únicamente instalaciones demo locales y aisladas; `-DryRun`, rechazo de destinos existentes y build/typecheck de instalaciones generadas verificados. Ver [`GENERADOR_DEMOS.md`](GENERADOR_DEMOS.md).
- **Fase 3 — Presets y seeds:** completada para Patitas Felices y TecnoCell Accesorios. Incluye manifiestos, catálogos idempotentes e imágenes con procedencia/licencia registrada. Los seeds heredados continúan siendo inadecuados para instalaciones existentes: `demo-store.sql` actualiza configuración y elimina SKU conocidos; `boutique-demo.sql` borra tablas completas. No aplicarlos en tiendas existentes.
- **Fase 4 — Aislamiento y regresión:** aceptación automatizada e interactiva local completada en Fase 7. D1, UUID, puertos, sesiones/almacenamiento, buckets locales y catálogos independientes verificados; sin SKU de SneakerHub en D1 o bundle.
- **Fase 5 — Cloudflare:** completada como preparación documental en [`AUTOMATIZACION_TIENDAS.md`](AUTOMATIZACION_TIENDAS.md). No se ejecutó aprovisionamiento, modificación de recursos remotos ni despliegue; cualquier ejecución remota queda fuera de este avance.
- **Fase 6 — Configurador y servicios reutilizables:** completada para configuración inicial y preparación de operaciones compartidas. El cuestionario guarda por API autenticada y no inserta productos ficticios; `worker/src/services/business.ts` comparte operaciones de catálogo, inventario, configuración e imágenes entre rutas administrativas y el ejecutor existente. El agente completo de Telegram sigue fuera del alcance.
- **Fase 7 — aceptación local:** completada en navegador para storefront, productos/categorías, fotografías, ficha, login y administración, personalización, carrito persistente y aislamiento. Informe: [`ACEPTACION_TIENDAS_DEMO.md`](ACEPTACION_TIENDAS_DEMO.md).
- **Fase 8 — seguridad y consolidación:** CTA independiente/preset, carga de carrito antes de persistir y fallback WebP→JPEG están consolidados en la plantilla y las demos. Auth falla cerrado sin configuración; la demo offline es opt-in solo en Vite dev. Frontend 52/52, Worker 39/39 y builds de ambas tiendas OK. Ver [`FASE8_SEGURIDAD.md`](FASE8_SEGURIDAD.md).
- **Bloqueo funcional:** configurar el número WhatsApp verdadero de cada tienda antes de probar la redirección y confirmar pedidos. No se inventó ni se guardó un número.
- **Bloqueos de producción:** configurar secretos propios por tienda y `ENVIRONMENT=production`, fijar `ALLOWED_ORIGIN` al dominio real y rotar cualquier valor antiguo que se hubiera usado fuera del entorno local. No se cambiaron credenciales ni el historial Git. Ver [`CHECKLIST_PRODUCCION.md`](CHECKLIST_PRODUCCION.md).
- **Generador — Fase 8.2 con validación parcial:** tres generaciones consecutivas pasaron con PowerShell 5.1, Node 26.8.1 y Wrangler 4.156.0 usando migraciones nativas D1. Se verificaron catálogo y fotos por preset. Falta repetir la matriz con Node LTS alterno y Wrangler alternativo; el DNS del registro npm dio `ENOTFOUND`, así que `npm ci` falló en los seis paquetes y no se pudieron verificar builds/login/API dentro de las copias generadas. El generador pasó las suites de plantilla; aún no se recomienda preparar una tienda piloto hasta resolver dependencias/entorno. Ver [`FASE82_ESTABILIDAD.md`](FASE82_ESTABILIDAD.md).
- **UX demo:** las instalaciones existentes cargan el CTA propio del preset desde configuración local generada; la plantilla no incluye copy de Patitas/TecnoCell. SneakerHub Premium conserva su texto.

## Requiere credenciales externas (código listo, no probado en vivo)

| Ítem | Estado real |
|---|---|
| Bot de Telegram | El webhook está implementado. Sin `TELEGRAM_BOT_TOKEN` responde **503** (verificado). No se ha probado contra la API real de Telegram porque no hay token. |
| Gemini | El intérprete local determinista funciona y está probado. La llamada a Gemini con clave real **no** se ha ejecutado. Sin clave, el bot responde `SIMULADO local / PENDIENTE DE CREDENCIALES`. |
| Despliegue en Cloudflare | Scripts listos (`scripts/deploy.ps1`) pero **no** ejecutados: requieren cuenta, D1 remota, R2 y secrets propios. |

## Funcionalidad incompleta (trabajo pendiente)

1. **Transcripción de notas de voz.** El webhook acepta notas de voz, pero la descarga del archivo y su transcripción con Gemini **no** están implementadas: hoy responde con un aviso.
2. **Cuestionario inicial.** La versión web (`/admin/onboarding`) tiene **11 pasos** (la especificación pedía 16). La tabla `onboarding_sessions` existe en D1, pero el flujo multi-paso **por Telegram** no está implementado.
3. **Límite de peticiones.** No hay *rate limiting* por chat/IP en `POST /api/telegram/webhook` ni por intentos en `/api/admin/login`; añadirlo antes de exposición pública.
4. **Tiendas demo aisladas.** Las instalaciones locales nuevas usan `scripts/new-store.ps1` y seeds idempotentes bajo `database/seed-presets/`. El seed heredado de SneakerHub y `boutique-demo.sql` siguen fuera del generador; antes de publicar cualquier tienda real, verificar precios, inventario, imágenes y datos de contacto del preset.

## Resueltos

- **Carga de fotos en el panel.** `POST /api/upload/image` (R2) conectado al formulario de `/admin/products`: botón de subida, miniaturas, eliminación y alternativa por URL. Verificado: 401 sin token, subida y lectura desde R2.
- **Filtros de tienda por talla, color y precio.** Implementados en categoría y búsqueda mediante `frontend/src/components/ProductFilters.tsx` (los desplegables de talla y color se generan solo si existen variantes con ese dato).
- **Persistencia de pedidos.** Nuevo `POST /api/orders` (validado con Zod) registrado desde el checkout de WhatsApp; `GET /api/orders` y `PATCH /api/orders/:id` protegidos con JWT. `/api/admin/stats` ya cuenta los pedidos del día y el panel `/admin/orders` los muestra y permite cambiar el estado.

## Notas de entorno

- **Puerto del Worker en desarrollo: 8788** (el 8787 suele estar ocupado por otros procesos). Vite hace proxy de `/api` a `http://localhost:8788`.
- **CORS**: en producción define `ALLOWED_ORIGIN` (dominio de Cloudflare Pages, separado por comas) para que el frontend pueda llamar al Worker.
- **D1 local** no admite `UNION ALL` en `SELECT` compuestos; los seeds usan subconsultas en su lugar.
- Los scripts `.ps1` deben mantenerse en **ASCII** para que Windows PowerShell 5 los interprete correctamente.

## Cómo retomar

Cada pendiente de la sección "Funcionalidad incompleta" es autocontenido:

- Voz → `worker/src/services/telegram.ts` (`message.voice`).
- Cuestionario Telegram → `onboarding_sessions` + estados del bot.
- Límite de peticiones → middleware en `worker/src/routes/telegram.ts` (tabla de marcas de tiempo por chat).
- Segundo seed → presets autónomos documentados en [`GENERADOR_DEMOS.md`](GENERADOR_DEMOS.md); no conectar a `scripts/setup.ps1` ni `reset-db.ps1` porque operan sobre la plantilla.

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

## Telegram + Gemini — pendientes de aceptación real

- La identidad ya fue confirmada con el desafío enviado por chat privado y el ID numérico ya está guardado localmente.
- Staging local aislado está listo; 0001–0004 aplicadas a su D1 y el inventario es ficticio. La prueba real de stock/auditoría/rollback pasó allí.
- La comparación local actual encontró que token Telegram y clave Gemini en el archivo staging coinciden con `.dev.vars`; sustituirlos y repetir `getMe`, `getWebhookInfo` y la consulta Gemini antes de llamarlos independientes.
- D1 remota staging creada, UUID y ledger 0001–0004 verificados; seed ficticio `TEST-TRN-001` presente. El bucket R2 staging ya existe.
- Worker staging no existe todavía. Deploy bloqueado porque Wrangler no tiene `CLOUDFLARE_API_TOKEN` en el proceso y OAuth requiere login interactivo. Además, el token staging identifica `@SneakerHubPruebas_bot`, no el bot principal solicitado; corregirlo en `.dev.vars.staging` sin tocar `.dev.vars`. El webhook del bot principal no se cambió.
- Gemini real pasó interpretación JSON de solo lectura para `TEST-TRN-001`; D1 staging confirmó SKU y migraciones por SELECT. Suites: Worker 64/64, frontend 52/52; TypeScript y build OK.
- No aplicar 0004, desplegar ni cambiar el webhook de la instalación original.
- Plan de activación y comando condicionado a credenciales independientes: [`SNEAKERHUB_STAGING_HTTPS_PLAN.md`](SNEAKERHUB_STAGING_HTTPS_PLAN.md). D1/R2 staging verificados; no se desplegó.
- Las modificaciones atómicas de precio y stock están implementadas; otras mutaciones se rechazan hasta contar con controladores transaccionales. Fotografías por Telegram no implementadas.
- No activar el bot definitivo: no se ha realizado prueba integrada real de Telegram + Gemini ni se ha aprobado despliegue/webhook.
- Instrucciones y reversión: [`SNEAKERHUB_GEMINI_TELEGRAM.md`](SNEAKERHUB_GEMINI_TELEGRAM.md).
