# Pruebas

Catálogo Digital Lite incluye pruebas automatizadas (Vitest) y una lista de **13 pruebas de aceptación** para verificar el sistema completo.

## Fase 8 — resultado actual (2026-11-01)

- Frontend: **52/52** pruebas en 16 archivos.
- Worker: **39/39** pruebas en 7 archivos; `npx tsc --noEmit` correcto.
- `npm run build` correcto en la plantilla y en `local-stores/patitas-felices` y `local-stores/tecnocell-accesorios`.
- Windows PowerShell **5.1.26100.9711**: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-generator-encoding.ps1` confirmó acentos, preset UTF-8, CTA del preset, escape SQL de apóstrofos, ausencia de mojibake y UTF-8 sin BOM. Los `-DryRun` de Patitas y TecnoCell pasaron con slugs temporales, mostraron puertos distintos y no crearon archivos, bases ni registro. Los slugs de las demos existentes se rechazaron sin cambios porque sus destinos ya existen.
- La causa del `fetch failed` en la ejecución restringida fue un rechazo `EACCES` de loopback (`127.0.0.1`); la misma operación D1 local pasó con permisos locales ampliados. El `internal error` de Wrangler 4.156.0 sigue sin causa confirmada: se repitió con el preset en `0001` y también en intentos vacíos posteriores, aunque una generación vacía real sí completó y los controles D1 aislados pasaron. Diagnósticos sanitizados: `.tmp/generator-diagnostics/`.
- Las pruebas de un `--cwd` staged y de un preflight `SELECT 1` tampoco fueron correcciones fiables: esos intentos de tienda vacía terminaron con `internal error` y se retiraron del flujo final.
- Navegador integrado: Patitas (`5283`/Worker `8898`) mostró 3 productos y 3 categorías; TecnoCell (`6081`/Worker `9696`) mostró 4 y 4. Las fotos de productos observadas se decodificaron y se abrieron las fichas `PF-DEMO-001` y `TC-DEMO-001`. Ambos botones de WhatsApp se detuvieron por falta de teléfono válido.
- Los formularios `/admin/login` muestran su marca y requieren sesión válida del servidor; no se enviaron credenciales en esta pasada. Administración, carrito persistente y aislamiento interactivo se aceptaron en la Fase 7. En Fase 8 no se cambiaron productos, carrito, apariencia, D1/R2 ni credenciales. El frontend puede sincronizar su marcador interno de versión al abrirse.
- La home de Patitas inicialmente quedó en blanco con un tema antiguo sin `cta`; la normalización de temas restaurados corrigió el caso. El generador conserva el CTA de cada preset en un módulo local a la instalación, sin copiar textos de demos a la plantilla ni escribir D1. SneakerHub Premium conserva el CTA por defecto.
- Riesgos y pasos de producción: [`FASE8_SEGURIDAD.md`](FASE8_SEGURIDAD.md) y [`CHECKLIST_PRODUCCION.md`](CHECKLIST_PRODUCCION.md).

## Fase 8.1 — generador (2026-11-01)

- `test-generador-fase81`: generación real con `Seed None`, migraciones 0001–0003, consulta D1 de tienda configurada y conteos de productos/categorías en cero. `GET /api/health` devolvió `ok`, `GET /api/products` devolvió `[]`, el login local obtuvo JWT y `/api/admin/stats` respondió con conteos en cero. Vite respondió HTTP 200.
- Build frontend de la tienda temporal y `npx tsc --noEmit` del Worker pasaron. Las dependencias se reutilizaron desde las instalaciones locales del workspace mediante enlaces temporales; `npm ci --offline` no fue posible porque `zod@3.25.76` no está en la caché. No se consultó el registro npm.
- DryRun del preset TecnoCell pasó. La generación completa del preset falló en `migration:0001_initial.sql` con `internal error`; no creó destino ni registro. Intentos vacíos posteriores también fallaron; por ello la generación real es intermitente, no estable. No se afirman como comprobados el seed, fotos, CTA ni carrito de una segunda tienda.
- `scripts/test-generator-encoding.ps1`: acentos/CTA/SQL y UTF-8 sin BOM pasaron. `scripts/test-generator-wrangler.ps1`: el proceso simulado devolvió 37, el generador devolvió 1, guardó diagnóstico sanitizado y limpió staging sin destino/registro.
- Repetir el slug de la tienda vacía fue rechazado con código 1; manifiesto y registro mantuvieron su SHA-256.
- Detalles, límites y pasos de reproducción: [`FASE81_GENERADOR_ESTABLE.md`](FASE81_GENERADOR_ESTABLE.md).

## Fase 8.2 — estabilidad del generador (2026-11-01)

- PowerShell 5.1.26100.9711 + Node 26.8.1 + npm 11.19.0 + Wrangler 4.156.0: tres generaciones consecutivas completadas con slugs nuevos: `phase82-vacio-01`, `phase82-patitas-02` y `phase82-tecnocell-03`.
- `wrangler d1 migrations apply` descubrió y aplicó 0001–0003 en orden; un segundo `apply` no encontró pendientes. `d1_migrations` registró los tres nombres. El flujo anterior con tres `d1 execute --file` también aplicó 0001–0003 una vez en una D1 temporal, pero no aporta ledger nativo.
- Consultas de solo lectura: cada D1 tiene 1 configuración; la tienda vacía tiene 0 productos/categorías; Patitas 3/3 y 3 referencias de foto; TecnoCell 4/4 y 4 referencias. UUID, puertos y persistencia son individuales. Los SHA-256 de las fotos coinciden con sus manifiestos. Los nombres con tildes y los mensajes CTA se conservaron.
- `test-generator-wrangler.ps1` pasó con fallo controlado 37 y clasificó `SQLITE_BUSY` como `sqlite-lock`; el generador limpió el staging y no creó destino/registro. `test-generator-encoding.ps1` pasó (acentos, CTA, escape SQL y UTF-8 sin BOM).
- Suites en la plantilla: Frontend 52/52, Worker 39/39, typecheck Worker OK y build Frontend OK. No se ejecutaron builds/login/API de las copias nuevas porque las dependencias no se instalaron.
- `npm ci` falló en los seis paquetes generados (worker y frontend de cada tienda) con `ENOTFOUND registry.npmjs.org` al descargar `zod@3.25.76`. Los lockfiles quedaron intactos. Node 24 LTS y Wrangler 4.156.1 alternativos tampoco se pudieron obtener de npm; esas filas de la matriz siguen sin probarse.
- El generador pasó tres pruebas en la combinación disponible, pero esta fase queda parcial hasta disponer del registro npm y completar las filas alternativas. No se aprueba aún un piloto que requiera instalar/buildar las copias generadas. Informe: [`FASE82_ESTABILIDAD.md`](FASE82_ESTABILIDAD.md).

## Tiendas independientes — generación e aislamiento (2026-11-01)

Validación de las demos locales generadas:

- `-DryRun` ejecutado para los dos perfiles; el generador mostró los temas y puertos previstos.
- D1 de Patitas Felices: 3 productos, 3 categorías y 3 variantes. D1 de TecnoCell Accesorios: 4 productos, 4 categorías y 4 variantes. UUID, rutas SQLite, puertos y credenciales son distintos.
- Reaplicar el SQL de cada catálogo mantuvo los conteos. Intentar regenerar un slug existente fue rechazado; los hashes de manifiesto, registro y D1 no cambiaron.
- Los siete archivos de imagen se decodificaron y coincidieron con los SHA-256 de sus manifiestos. Cada instalación contiene únicamente las imágenes de su preset seleccionado.
- No aparece el SKU de SneakerHub `VANTA-18` en ninguna D1 generada ni en el bundle independiente examinado.
- Build de frontend y `npx tsc --noEmit` del Worker aprobados para ambas copias; los builds incluyen 3 imágenes Patitas y 4 imágenes TecnoCell.
- En la fase 6 se volvieron a ejecutar las suites: Worker 33/33 (incluye 4 pruebas nuevas de servicios compartidos) y frontend 42/42; typecheck/build también pasaron.

La aceptación interactiva se completó en navegador el 2026-11-01 para storefront, categorías, fichas, fotografías, login/admin, edición de productos, apariencia, carrito y aislamiento. WhatsApp se probó hasta el control de pedido; los dos demos no tienen teléfono válido y la app mostró el mensaje esperado sin abrir un destino externo. Evidencia, URLs y límites: [`ACEPTACION_TIENDAS_DEMO.md`](ACEPTACION_TIENDAS_DEMO.md).

## Aceptación interactiva de Patitas y TecnoCell — Fase 7 (2026-11-01)

- URLs usadas: Patitas `http://127.0.0.1:5283/` (Worker `8898`), TecnoCell `http://127.0.0.1:6081/` (Worker `9696`). Las cuatro respuestas locales se validaron en navegador.
- Catálogo: Patitas muestra 3 productos/3 categorías y TecnoCell 4/4. Se abrieron fichas y las fotos principales, de categoría y de los productos visibles se decodificaron en navegador (`naturalWidth > 0`). Los demos usan fotos JPEG propias; ninguna foto existente fue sobrescrita.
- Administración: login propio por tienda, lista y edición de productos y guardado de apariencia se comprobaron. Los cambios temporales de nombre, precio y color de Patitas persistieron tras recargar y luego fueron restaurados.
- Carrito: agregado, total y persistencia tras recargar se comprobaron en ambas tiendas. Se corrigió el orden de carga/persistencia solo en las dos copias generadas; los carritos quedaron vacíos después de las pruebas.
- Aislamiento: UUID/archivo D1, puertos, buckets locales, credenciales, namespace de almacenamiento y configuración son distintos. Cambio de Patitas no alteró nombre/precio/paleta de TecnoCell. Una imagen de 1 × 1 px se leyó desde Patitas y la misma ruta respondió `Asset not found` desde TecnoCell; su referencia de categoría se retiró al acabar.
- WhatsApp: **bloqueado por falta de teléfono configurado en ambos comercios**; el control mostró el aviso y no envió mensaje ni abrió WhatsApp.
- Seguridad: se confirmaron defaults versionados de desarrollo y fallbacks en auth/JWT; no se cambió la arquitectura ni se mostraron credenciales de `.dev.vars`. Consultar el informe de aceptación para severidades.
- Automatización posterior: frontend 42/42, Worker 33/33, typecheck Worker y builds base + ambas copias generadas aprobados.
- No hubo reset/reseed, despliegue, cambio de credenciales ni modificación de SneakerHub Premium.

## Servicios reutilizables y cuestionario — Fase 6 (2026-11-01)

- Cuestionario: el guardado usa la sesión admin y `PUT /api/admin/store`; la categoría inicial se omite si ya existe, y un reintento no añade un producto marcador. Los errores del backend se muestran en el formulario.
- Worker: cuatro pruebas para whitelist de configuración/productos, conflicto de slug y rechazo de stock negativo.
- Resultado final de suites: Worker 33/33 en 6 archivos, `npx tsc --noEmit` correcto; frontend 42/42 en 12 archivos, `npm run build` correcto.
- No se probó una integración real con Telegram ni se verificó en navegador este cuestionario contra una sesión admin.

## Pruebas automatizadas

### Ejecutar

```powershell
# Worker: validación de acciones, intérprete IA y autenticación JWT
cd worker
npm test

# Frontend: formato, mensaje de WhatsApp e intérprete del simulador
cd ..\frontend
npm test
```

### Cobertura actual

**Worker** — `worker/src`

| Archivo | Qué verifica |
|---|---|
| `validation/actions.test.ts` | Las 20 acciones deterministas; rechazo de acciones no permitidas (no hay SQL libre); validación de `create_product` con variantes; stock no negativo; formato hexadecimal de colores; precios enteros; límite de 20 SKUs destacados |
| `ai/interpreter.test.ts` | Alta con rango de tallas (38–44 → 7 variantes); no inventa precio ni stock; WhatsApp; color primario; inventario; payload JSON; texto no reconocido |
| `services/auth.test.ts` | Creación y verificación de JWT; rechazo de token con otro secreto o corrupto; validación de credenciales; secreto configurado |
| `routes/admin-login.test.ts` | Login 503 sin configuración, 401 para credenciales erróneas, rutas protegidas 503 con JWT inválido o sin credenciales de administrador configuradas |
| `routes/admin-categories.test.ts` | Rutas administrativas con configuración completa y sesión JWT válida |

**Frontend** — `frontend/src`

| Archivo | Qué verifica |
|---|---|
| `lib/format.test.ts` | `formatMoney` (COP sin decimales), `discountPercent` (con casos nulos), `slugify` (acentos y símbolos) |
| `lib/whatsapp.test.ts` | Encabezado, productos, SKU, variante, cantidades, total y moneda; datos de cliente y entrega |
| `lib/interpretCommand.test.ts` | Modo simulado, campos faltantes, variantes por rango, comando no reconocido |
| `lib/authMode.test.ts` | Sesión offline demo solo con Vite dev y activación explícita |
| `contexts/CartContext.test.ts` | Hidratación síncrona antes de persistir y recuperación de almacenamiento inválido |
| `lib/storeTheme.test.ts`, `types/theme.test.ts` | CTA propio de instalaciones independientes y preservación del CTA SneakerHub al fusionar temas antiguos |

Resultado esperado:

```
Worker:   Test Files 6 passed | Tests 33 passed
Frontend: Test Files 12 passed | Tests 42 passed
```

> Ese bloque conserva la línea base de Fase 7; la suite actual al cierre de Fase 8 es Worker **7 archivos/39 pruebas** y frontend **16 archivos/52 pruebas**.

## Comprobaciones de compilación y tipos

```powershell
# Frontend (incluye tsc --noEmit + build de producción)
cd frontend
npm run build

# Tipos del worker
cd ..\worker
npx tsc --noEmit
```

## Verificación manual del backend (PowerShell)

Con el Worker en marcha (`cd worker; npm run dev`, puerto 8788):

```powershell
# Salud
Invoke-RestMethod http://127.0.0.1:8788/api/health

# Productos con variantes
(Invoke-RestMethod http://127.0.0.1:8788/api/products)[0].variants.Count

# Login admin: usar los valores locales de worker/.dev.vars; no imprimir el token ni guardarlo en archivos.
$adminEmail = Read-Host 'Email configurado localmente'
$securePassword = Read-Host 'Contraseña local' -AsSecureString
$adminPassword = [System.Net.NetworkCredential]::new('', $securePassword).Password
$body = @{ email = $adminEmail; password = $adminPassword } | ConvertTo-Json -Compress
$login = Invoke-RestMethod http://127.0.0.1:8788/api/admin/login -Method Post `
  -Body $body -ContentType 'application/json'

# Stats protegidas
Invoke-RestMethod http://127.0.0.1:8788/api/admin/stats -Headers @{ Authorization = "Bearer $($login.token)" }
Remove-Variable adminPassword, body, login, securePassword -ErrorAction SilentlyContinue
```

## 13 pruebas de aceptación

| # | Prueba | Cómo verificarla |
|---|---|---|
| 1 | La tienda se abre y muestra portada, categorías, destacados y novedades | Abrir `http://localhost:5173/` |
| 2 | Buscador y filtros por categoría/precio/talla/color funcionan | Probar `/search` y `/category/tenis-running` |
| 3 | Detalle de producto con galería y selector de variantes | Abrir un producto y cambiar talla |
| 4 | Carrito persistente: recargar la página mantiene los artículos | Añadir al carrito y recargar (F5) |
| 5 | El pedido se envía completo a WhatsApp (productos, SKU, variantes, cantidades, total) | Pulsar "Pedir por WhatsApp" y revisar el mensaje |
| 6 | El panel `/admin` exige autenticación real | Abrir `/admin` sin sesión → redirige a login; `/api/admin/stats` sin token → 401 |
| 7 | Crear variantes de talla maneja inventarios independientes | Crear producto con tallas 38–44; vender una talla y ver que las demás no cambian |
| 8 | Evita duplicar productos por referencia existente | Crear un producto con un SKU ya usado → responde `SKU already exists` (409) |
| 9 | Archivar y restaurar conserva el producto (no borrado definitivo) | Archivar y luego restaurar en `/admin/products` |
| 10 | Personalización persistente (nombre, colores, contacto) | Cambiar en `/admin/settings`, recargar y ver que persiste |
| 11 | El agente IA solo ejecuta acciones tipadas y pide confirmación | `/admin/simulator` o Telegram: una operación pide SÍ/NO |
| 12 | El agente IA nunca inventa precios/stock/fotos | Enviar un comando sin precio → el bot pide el dato faltante |
| 13 | Los secretos no llegan al frontend | `GEMINI_API_KEY` y `TELEGRAM_BOT_TOKEN` solo existen como secrets del Worker |

## Estado histórico al cierre de Fase 7

- Resultado de ese corte: **75/75** (33 Worker + 42 frontend); la cifra actual se registra en la sección Fase 8.
- La aceptación 1–13 debe repetirse tras cambios del comportamiento de tienda o al preparar datos/credenciales nuevos.

## Continuación visual — Fase 1 (2026-11-01)

- `frontend`: `npm run build` — OK (TypeScript y Vite; 1633 módulos).
- `frontend`: `npm test` — OK (15/15 pruebas).
- `worker`: `npx tsc --noEmit` — OK.
- `worker`: `npm test` — OK (23/23 pruebas).
- Se intentó revisar la tienda en un navegador, pero el control visual se detuvo porque no pudo determinar la URL activa con certeza. Una petición HTTP local para verificar la página y la foto también fue denegada por permisos de socket; por ello no se registra aprobación visual ni de respuesta local.

## Continuación visual — Fase 2 (2026-11-01)

- Auditoría local: las 18 fichas del catálogo demo tienen foto principal existente; no se encontró galería secundaria ni colores asignados a las variantes.
- Validación de rutas de imagen: **18 encontradas, 0 faltantes**.
- Reemplazadas y optimizadas `VANTA-01.jpg`, `KINETIK-05.jpg`, `KINETIK-06.jpg` y `VOLTA-21.jpg`; se conservaron sus rutas para las referencias del seed.
- `frontend`: `npm run build` — OK (1633 módulos).
- `frontend`: `npx vitest run` — OK (15/15 pruebas).
- No se ejecutaron seeds ni se modificó D1; los cambios SQL, cuando aplican, solo documentan el seed reproducible.

## Continuación visual — Fase 3 (2026-11-01)

- `frontend`: `npm run build` — OK (1633 módulos; incluye `tsc --noEmit`).
- `frontend`: `npx vitest run` — OK (15/15 pruebas).
- `worker`: `npx tsc --noEmit` — OK.
- `worker`: `npx vitest run` — OK (23/23 pruebas).
- Revisión de código: los enlaces directos y el carrito consultan productos y variantes vigentes antes de formar el pedido; stock o precio distinto detienen el envío y solicitan revisar los datos.
- Revisión de código: el endpoint registra la solicitud como `pendiente` y `whatsapp_sent = 0`; no descuenta inventario. No se pudo hacer prueba visual/local contra el backend en esta sesión.
- La selección de color y la galería quedan soportadas cuando la API provee esas variantes e imágenes. Las fichas demo continúan con `color = null` y una foto por producto; no se presenta la funcionalidad como probada con datos de muestra.

## Continuación visual — Fase 4 (2026-11-01)

- `frontend`: `npm run build` — OK (TypeScript y Vite; 1633 módulos).
- `frontend`: `npm test -- --run` — OK (15/15 pruebas).
- Se revisó la cobertura de `/admin/appearance`, la fusión tolerante de `theme_config` y el uso de categorías/destacados en la portada.
- Persistencia de D1 y cargas R2 no probadas en vivo: requieren una sesión administrativa y servicios locales conectados.
- `frontend`: `npm run lint` no disponible: ESLint 9 está instalado, pero no hay `eslint.config.js` ni configuración compatible en el proyecto.

## Continuación visual — Fase 5 (2026-11-01)

- Auditoría de rutas administrativas: el enlace de Apariencia desde Configuración quedó apuntando a la ruta canónica `/admin/appearance`; `/admin/apariencia` redirige para conservar enlaces antiguos.
- Menú móvil del admin: cierre con Escape, diálogo etiquetado, cierre accesible desde el fondo y `aria-current` en la navegación.
- `frontend`: `npm run build` — OK (TypeScript y Vite; 1633 módulos).
- `frontend`: `npm test -- --run` — OK (15/15 pruebas).
- La prueba visual en anchos reales y el flujo completo con Worker/API quedan pendientes: el entorno actual no tiene una sesión admin ni el navegador local conectado a la aplicación.

## Rediseño admin — Fase 1 (2026-11-01)

- `frontend`: `npm run build` — OK (TypeScript y Vite; 1633 módulos).
- `frontend`: `npm test -- --run` — OK (15/15).
- El estado del servicio se presenta según `backendAvailable`; se retiró el indicador falso de sistema activo.
- No se probaron login ni datos comerciales en vivo; no se generaron capturas.

## Rediseño admin — Fase 2 (2026-11-01)

- `frontend`: `npm run build` — OK; `npm test -- --run` — OK (15/15).
- Verificado por código: el borrador de Apariencia solo se persiste al pulsar Guardar; recuperar versión guardada descarta modificaciones sin enviar cambios.
- Pendiente: previsualización con componentes reales y comprobación visual de persistencia en sesión admin conectada.

## Rediseño admin — Fase 3 (2026-11-01)

- `frontend`: `npm run build` — OK; `npm test -- --run` — OK (15/15).
- Revisado por código el filtrado/orden local, el stock por variante y la confirmación de archivado.
- No probado en D1/R2 local: el entorno no tiene sesión admin conectada.

## Rediseño admin — Fase 4 (2026-11-01)

- `frontend`: `npm run build` — OK; `npm test -- --run` — OK (15/15).
- Pedidos: revisión estática de conteos reales, filtro y mutación de estado mediante API existente.
- Configuración: revisión estática del orden API primero y mensajes de resultado.
- Sin prueba conectada contra D1/API y sin revisión visual en navegador.

## Rediseño admin — Fase 5 (2026-11-01)

- Frontend: build OK y 15/15 pruebas.
- Worker: `npx tsc --noEmit` OK y 23/23 pruebas.
- Accesibilidad revisada por código: menú escapable con retorno de foco y campo de categoría etiquetado.
- No hubo captura visual ni prueba manual en las cinco resoluciones solicitadas porque no está disponible un navegador conectado al sitio local.
- Dashboard: la lista de pedidos usa la API protegida existente; stock bajo se calcula desde el catálogo y las variantes cargadas. Build y suites del frontend continúan pasando.
- Categorías: auditoría estática de reordenamiento en Apariencia y consumo del orden por la cuadrícula pública; build OK y 15/15 frontend.
- Configuración: build OK tras validación previa de formato de correo y teléfono WhatsApp. No se modifican ajustes locales si falla la llamada remota.
- Categorías: edición conectada a PUT protegido; pruebas generales frontend 15/15, Worker 23/23 y typecheck Worker OK. No se hizo petición de integración a D1 local en esta sesión.
- Categorías: desactivación conectada al DELETE protegido existente; build frontend y 15/15 tests OK; typecheck Worker OK. Sin prueba D1 conectada.
- Dashboard: si `stats` aún no está disponible, los KPIs representan dato desconocido (“—”) en vez de cero; build frontend y suite 15/15 OK.
- Worker: suite de ruta `admin-categories.test.ts`; verifica 401 sin token, 409 ante slug duplicado, 400 ante datos vacíos y actualización exitosa. Typecheck OK y total Worker 27/27.

## Recuperación catálogo — verificación local solicitada (2026-11-01)

- Intento `GET http://127.0.0.1:8788/api/health` y `GET http://127.0.0.1:5173/`: ambos bloqueados antes de establecer conexión por permisos de socket.
- Consulta de puertos mediante CIM también denegada; no se pudo saber si existían listeners.
- Archivos JPEG locales verificados en el pase previo; build Vite contiene 21 recursos seed, incluido `hero-editorial.jpg`.
- `frontend`: build OK, 19/19 pruebas. `worker`: `npx tsc --noEmit` OK, 27/27 pruebas.
- Sin verificación de respuesta real API, HTTP 200/404 de imágenes, consola del navegador ni carrito/WhatsApp en vivo.
- Enlace de alta rápida: revisión de código del parámetro `?new=1`; el formulario se abre y se elimina el parámetro. Build y pruebas frontend OK (15/15).
- Editor de fotos: build y pruebas frontend OK (15/15); revisión de código de selección de foto principal y confirmación de borrado.

## Optimización de rendimiento del catálogo (2026-11-01)

- `frontend`: `npm run build` — OK (TypeScript y Vite); salida: JS 495.31 kB / 141.16 kB gzip, CSS 50.32 kB / 9.79 kB gzip.
- `frontend`: `npm test -- --run` — OK (19/19).
- `worker`: `npx tsc --noEmit` — OK.
- `worker`: `npm test` — OK (28/28), incluida `routes/products.test.ts`: cuerpo agrupado con 18 productos, campos de foto/categoría/variante y una sola consulta.
- Archivos locales: 21 JPEG (3,188,131 bytes) y 21 WebP (2,027,680 bytes); se comprobaron cero derivados WebP faltantes. Los originales siguen presentes; reducción de tamaño de archivos derivados: 36.4%.
- El intento HTTP contra localhost está bloqueado por permisos de socket. No hay resultado real de `GET /api/products`, estado HTTP de imágenes, tiempo API, inspección de consola o comprobación visual. Ejecutar manualmente las instrucciones siguientes en PowerShell.

### Verificación real en el equipo local

Abrir dos terminales de PowerShell:

```powershell
# Terminal 1: Worker en 8788
Set-Location 'D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite\worker'
npm run dev
```

```powershell
# Terminal 2: storefront en 5173
Set-Location 'D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite\frontend'
npm run dev -- --host 127.0.0.1
```

En una tercera terminal, ejecutar para contar productos, variantes, categorías, URLs y estados HTTP de imagen:

```powershell
$api = 'http://127.0.0.1:8788/api/products'
$site = 'http://127.0.0.1:5173'
$products = @(Invoke-RestMethod $api -TimeoutSec 20)
$products.Count # El endpoint filtra activos/no archivados en SQL; todos los devueltos son activos
(($products | Select-Object -ExpandProperty categorySlug -Unique) | Measure-Object).Count
$products | Select-Object sku, name, categoryName, categorySlug, imageUrls
$products | ForEach-Object { $_.variants.Count } | Measure-Object -Sum
$images = $products | ForEach-Object { $_.imageUrls } | Where-Object { $_ } | Sort-Object -Unique
foreach ($image in $images) {
  $url = if ($image -match '^https?://') { $image } else { "$site$image" }
  try {
    $response = Invoke-WebRequest $url -Method Head -TimeoutSec 20
    [pscustomobject]@{ Url = $url; Status = [int]$response.StatusCode }
  } catch {
    [pscustomobject]@{ Url = $url; Status = $_.Exception.Message }
  }
}
# Tiempo promedio de GET /api/products, sin caché del script
1..5 | ForEach-Object {
  $timer = Measure-Command { $null = Invoke-RestMethod $api -TimeoutSec 20 }
  [pscustomobject]@{ Intento = $_; Milisegundos = [math]::Round($timer.TotalMilliseconds) }
}
```

Abrir `http://127.0.0.1:5173/` en el navegador; confirmar visualmente el catálogo, abrir un producto, agregarlo al carrito y abrir `/admin`. En las herramientas de desarrollador, revisar Network/Console y el contador de imágenes cargadas; `currentSrc` muestra si el navegador eligió WebP. Guardar los resultados antes de reportar resolución en vivo.

## Corrección crítica UX — ficha, fotos, scroll y admin (2026-11-01)

- `frontend`: `npm run build` — OK (1,637 módulos); bundle inicial 464.58 kB / 135.19 kB gzip, chunk lazy de Apariencia 37.31 kB / 9.71 kB gzip, CSS 51.25 kB / 9.91 kB gzip. Sin advertencia de chunk sobre 500 kB.
- `frontend`: `npm test -- --run` — OK (9 archivos, 33 pruebas). Nuevas regresiones: resolución segura de imágenes y WebP; búsqueda SKU KINETIK-06; render server-side de `/product/KINETIK-06` y alias `/producto/KINETIK-06`; planes PUSH/POP/anchor de scroll; enlaces visibles del admin y sección real de inventario.
- `worker`: `npx tsc --noEmit` — OK; `npm test` — OK (5 archivos, 29 pruebas). `/api/products/:sku` entrega `imageUrls`, `categoryId` y categoría en el contrato camelCase del frontend.
- Snapshot D1 (solo lectura): 18 productos activos, cada uno con ruta de imagen cuyo nombre base coincide con el SKU. `Pillow` decodificó 18/18 JPEG. JPEG 2,670,655 bytes; WebP 18/18, 1,693,542 bytes.
- **No ejecutado en vivo:** HTTP GET al endpoint, 200/Content-Type de imágenes, captura visual, pruebas interactivas de carrito/admin o tamaños 375/390/768/1440. No afirmar aprobado visual; localhost está bloqueado en este entorno.

### Pasos de aceptación en el equipo local

Con Worker y Vite iniciados como en la sección “Optimización de rendimiento del catálogo” de este documento, ejecuta:

```powershell
$api = 'http://127.0.0.1:8788/api/products'
$site = 'http://127.0.0.1:5173'
$products = @(Invoke-RestMethod $api -TimeoutSec 20)
"Productos activos devueltos: $($products.Count)"
$detail = Invoke-RestMethod "$api/KINETIK-06" -TimeoutSec 20
$detail | Select-Object sku, name, imageUrls, categoryName, categorySlug
foreach ($product in $products) {
  foreach ($image in $product.imageUrls) {
    $url = if ($image -match '^https?://') { $image } else { "$site$image" }
    try {
      $response = Invoke-WebRequest $url -Method Get -TimeoutSec 20
      [pscustomobject]@{ SKU = $product.sku; Url = $url; Status = [int]$response.StatusCode; ContentType = $response.Headers['Content-Type']; Bytes = $response.RawContentLength }
    } catch {
      [pscustomobject]@{ SKU = $product.sku; Url = $url; Status = $_.Exception.Message; ContentType = ''; Bytes = 0 }
    }
  }
}
```

En el navegador, abrir `/`, entrar a KINETIK-06 desde portada, una categoría y `/search`; confirmar título “Kinetik Aero Carbon”, foto, tallas, precio, añadir al carrito y volver. Repetir con `/product/KINETIK-06` y `/producto/KINETIK-06`; recargar, navegar entre productos, bajar hasta el footer, abrir otro producto y probar Atrás/Adelante. En DevTools Network revisar las 18 respuestas y `currentSrc` de una tarjeta/ficha para ver WebP o fallback JPEG.

Probar `/admin` con sesión: todos los enlaces deben verse en la barra clara; “Inventario” debe abrir y desplazar a sus variantes. Probar drawer y cierre por botón, Escape y navegación. Repetir a 375, 390, 768 y 1440 px; verificar Console, estado activo y que no haya rutas rotas.

## Corrección crítica de imágenes en el storefront (2026-11-01)

### Verificación automatizada

- `frontend`: `npm test -- --run` — 11 archivos, 39 pruebas OK. Incluye normalización de URL, fallback WebP→JPEG, markup SSR de `ProductImage` y `ProductCard`, ruta R2, lazy loading por defecto y prioridad eager/high.
- `frontend`: `npm run build` — OK. JS inicial 464.76 kB (135.27 kB gzip), CSS 51.25 kB (9.91 kB gzip), chunk Apariencia 37.31 kB (9.71 kB gzip).
- `worker`: `npm test -- --run` — 5 archivos, 29 pruebas OK; `npx tsc --noEmit` — OK.
- Snapshot local de solo lectura: las 18 rutas JPEG y sus WebP existen; los formatos locales de los cuatro SKU reportados decodifican correctamente. No equivale a una respuesta HTTP ni a carga en navegador.

### Resultado de la comparación

Para ASTRAL-03 (y el resto de los SKU inspeccionados), admin y storefront parten del mismo JPEG guardado: `/seed-images/sneakerhub/ASTRAL-03.jpg`. El admin lo asigna directamente a `img.src`. En tienda, `ProductImage` resuelve la ruta desde la raíz y ofrece `/seed-images/sneakerhub/ASTRAL-03.webp` mediante `<picture>`; la etiqueta queda en `opacity-0` hasta recibir `onLoad`. Si la petición WebP falla, ahora se retira el `<source>` y se remonta la etiqueta para solicitar el JPEG; el fallback se intenta una sola vez. Las tarjetas usan el mismo `ProductImage` para la foto principal; las páginas de producto usan el mismo componente para galería y foto principal. No se cambió el admin ni CSS de diseño.

La causa exacta de los huecos observados no puede atribuirse a la red sin un navegador: la inspección local fue bloqueada al intentar abrir el puerto Vite (`EACCES`). No se observaron estados HTTP, consola, `currentSrc`, `naturalWidth` o estilos computados en vivo. Por tanto, el fallback corrige el caso de fallo de WebP, pero la aceptación visual sigue pendiente.

### Comprobación HTTP en Windows PowerShell

Inicia Worker y frontend en dos ventanas desde la carpeta del proyecto:

```powershell
cd 'D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite\worker'
npm run dev
```

```powershell
cd 'D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite\frontend'
npm run dev -- --host 127.0.0.1
```

En una tercera ventana, consulta la API y descarga cada imagen en GET para registrar estado, tipo y bytes. Para las rutas JPEG locales también consulta el WebP que `ProductImage` ofrece al navegador:

```powershell
$api = 'http://127.0.0.1:8788/api/products'
$site = 'http://127.0.0.1:5173'
$products = @(Invoke-RestMethod $api -TimeoutSec 20)
"Productos devueltos: $($products.Count)"
$products | Select-Object sku, name, categoryName, categorySlug, imageUrls
$urls = foreach ($product in $products) {
  foreach ($image in @($product.imageUrls)) {
    if (-not $image) { continue }
    $url = if ($image -match '^https?://') { $image } else { "$site$([uri]::EscapeUriString($image))" }
    [pscustomobject]@{ SKU = $product.sku; URL = $url }
    if ($image -match '^/?seed-images/.+\.jpe?g$') {
      [pscustomobject]@{ SKU = $product.sku; URL = ($url -replace '\.jpe?g$', '.webp') }
    }
  }
}
$urls | ForEach-Object {
  try {
    $response = Invoke-WebRequest $_.URL -Method Get -TimeoutSec 30 -UseBasicParsing
    [pscustomobject]@{ SKU = $_.SKU; URL = $_.URL; Status = [int]$response.StatusCode; ContentType = $response.Headers['Content-Type']; Bytes = $response.RawContentLength }
  } catch {
    [pscustomobject]@{ SKU = $_.SKU; URL = $_.URL; Status = $_.Exception.Message; ContentType = ''; Bytes = 0 }
  }
}
```

Confirma que la respuesta tenga 18 productos y revisa individualmente ASTRAL-03, NORD-02, NORD-22 y VANTA-01. En el navegador abre Inicio, catálogo, cada categoría, resultados de búsqueda y `/product/KINETIK-06`; desplázate hasta el final. En DevTools ejecuta esto para contar fotos con recurso decodificado y visibilidad:

```javascript
[...document.querySelectorAll('img')].map(img => ({
  src: img.getAttribute('src'), currentSrc: img.currentSrc,
  complete: img.complete, naturalWidth: img.naturalWidth,
  naturalHeight: img.naturalHeight,
  opacity: getComputedStyle(img).opacity,
  visible: img.getBoundingClientRect().width > 0 && img.getBoundingClientRect().height > 0
}))
```

Una imagen cuenta como cargada si `complete` es `true`, `naturalWidth > 0`, tiene dimensiones visibles y opacidad computada distinta de cero. Verifica también Network/Console y confirma que el skeleton desaparezca tras cargar. Las primeras cuatro tarjetas de categoría/búsqueda son eager/high; las imágenes posteriores permanecen lazy para carga progresiva.

### Reproducción y resultado visual (2026-11-01)

- En el navegador local, `/category/running` mostraba cuatro imágenes WebP con `complete=true` y `naturalWidth>0`, pero `opacity: 0`. La causa era que el efecto de montaje de `ProductImage` podía reiniciar el estado después de que una imagen rápida/de caché hubiera disparado `onLoad`.
- `ProductImage` ahora reconcilia el estado al finalizar el efecto: si el elemento actual ya está completo y decodificado, marca `loaded=true`; si está completo con error, conserva el fallback a JPEG o informa el error. No se tocó CSS.
- Tras HMR y recarga completa, las cuatro fotos visibles de Running (`KINETIK-05`, `KINETIK-06`, `TERA-08`, `LUMEN-07`) tienen `complete=true`, `naturalWidth` de 933 a 1400 y opacidad `1`; `currentSrc` fue el WebP de cada producto.
- Frontend actualizado: 40/40 pruebas (11 archivos) y build OK; JS inicial 464.94 kB (135.36 kB gzip). No se consultaron códigos HTTP explícitos ni `GET /api/products` en esta comprobación; `naturalWidth>0` confirma descarga y decodificación en navegador para las cuatro observadas. La comprobación completa de las 18 en cada ruta sigue pendiente.

## MVP privado Telegram + Gemini (2026-11-02)

- Worker: 64/64 en 12 archivos; typecheck OK. Frontend: 52/52 en 16 archivos; build OK.
- Gemini API real de solo interpretación: una consulta tipada de `TEST-TRN-001` aceptada por esquema usando el modelo configurado; no accedió a D1.
- Staging local probado con persistencia Wrangler separada, D1 y R2 de nombres/IDs distintos. Se aplicaron 0001–0004 y el seed ficticio. Worker staging respondió health 200 y catálogo con un solo SKU de prueba. R2 staging pasó put/get/delete local; quedó vacío.
- Prueba D1 real en staging: stock ficticio 4→6, duplicado `not_pending`, y trigger de error de auditoría produjo rollback de stock/estado; la cancelación posterior dejó la segunda operación cancelada. Quedó 1 operación aplicada, 1 cancelada y 1 auditoría.
- Mocks cubren `/start`, `/ayuda`, `/estado`, propietario y usuario desconocido, consulta stock, confirmación, cancelación, mutaciones no atómicas, deduplicación/rate limit, batch de auditoría, descarga/transcripción OGG y errores de Telegram/Gemini.
- Telegram test bot real: `getMe` confirmó `@SneakerHubPruebas_bot`; `getWebhookInfo` confirmó webhook vacío y 0 pendientes. No se registró webhook ni se entregó `/start` por HTTPS al Worker.
- Gemini real con clave independiente staging: consulta estructurada `TEST-TRN-001` aprobada. Solo interpretación, sin D1.
- D1/R2 original comparados con la línea base: tablas y filas de aplicación D1 idénticas; metadatos y blobs de los 7 objetos R2 idénticos. No se desplegó; la única creación remota fue la D1 staging, con migraciones y seed ficticio solo en esa D1. No hubo escrituras en SneakerHub original.
- D1 remota staging creada y verificada (UUID `18ac228c-c142-45c7-b801-6ae0c6e1f8eb`); migraciones 0001–0004 y seed ficticio aplicados. R2 remoto requiere habilitación desde Dashboard; Worker remoto, secretos y webhook siguen pendientes. No se instalaron ni actualizaron dependencias.
- Plan de continuación: [`SNEAKERHUB_STAGING_HTTPS_PLAN.md`](SNEAKERHUB_STAGING_HTTPS_PLAN.md).
- Detalle y límites: [`SNEAKERHUB_GEMINI_TELEGRAM.md`](SNEAKERHUB_GEMINI_TELEGRAM.md).

## Plataforma 3.0 (2026-11-03)

```powershell
cd worker ; npm test ; npx tsc --noEmit      # 156/156, 19 archivos
cd ../frontend ; npm test ; npm run build     # 58/58, build OK
node scripts/verify-d1-migration.mjs .tmp/telegram-231-production/production-before.sql --rollback
```

- Las pruebas del Worker usan `worker/test/sqliteD1.js`: SQLite real con **todas** las migraciones (restricciones, disparadores, JSON y claves foráneas) y el Worker completo (`src/testing/harness.ts`). Telegram y Gemini se simulan con `fetch` falso; ninguna prueba llama servicios externos.
- `verify-d1-migration.mjs` carga una **copia** de un volcado D1, aplica las migraciones pendientes y compara conteos y hashes por tabla; con `--rollback` verifica también la reversión. Solo imprime agregados.
- Verificación adicional realizada: Wrangler D1 local (Miniflare) sobre la copia del respaldo, smoke test HTTP del Worker 3.0 en `workerd` (19/19), compatibilidad del Worker anterior con el esquema migrado (9/9) y revisión visual en navegador de `/t/<tienda>`, vista previa privada, activación y `/plataforma`.
