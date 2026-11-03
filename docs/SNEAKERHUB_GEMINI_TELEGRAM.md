# MVP privado de Telegram y Gemini para SneakerHub

Estado: **staging HTTPS activo; pruebas de flujo completadas**. Falta una prueba con segunda cuenta real de Telegram; una solicitud HTTPS con ID no autorizado sí fue rechazada. La actualización de activación al final de este documento supersede los estados provisionales anteriores. El bot principal apunta actualmente al Worker de staging, que opera solo sobre el catálogo ficticio. La auditoría de producción está en [`SNEAKERHUB_PRODUCCION_AUDITORIA_Y_PLAN.md`](SNEAKERHUB_PRODUCCION_AUDITORIA_Y_PLAN.md).

## Línea base y preservación

- Rama `main`; el repositorio ya tenía muchos cambios locales de trabajo y se conservaron.
- Respaldo verificable creado en `.tmp/telegram-gemini-final-baseline-20261102-080647/`, con código/documentos del punto de partida, D1 SQLite, metadatos y blobs R2, y manifiesto SHA-256. No se incluyó `.dev.vars`.
- Comparación lógica completa contra la línea base: las 10 tablas de aplicación D1 y sus filas son idénticas; solo difiere una fila de `_cf_METADATA` de Wrangler. D1 conserva 19 productos, 90 variantes, 5 categorías, 4 pedidos, 1 configuración y 10 auditorías.
- Los siete objetos R2 originales tienen los mismos metadatos y hashes de blob que en el respaldo; no se modificaron las fotos referenciadas. No hay cargas multipart pendientes.
- Se encontró además un artefacto SQLite Wrangler de 0 bytes. No se borró ni se reemplazó; se utilizó la base de 151552 bytes para leer el catálogo.
- La base original de instalación no recibió la migración. `0004_telegram_agent.sql` se probó primero en un clon del respaldo y luego en la D1 local exclusiva de staging; en esta última se aplicaron también 0001–0003 para disponer del esquema completo.

## Implementación

- `worker/src/routes/telegram.ts`: reutiliza el webhook existente, valida el secreto y el ID numérico autorizado, exige chat privado, deduplica `update_id`, limita solicitudes y mantiene `/start`, `/ayuda`, `/estado` y `/cancelar`.
- `worker/src/services/telegram.ts`: crea propuestas duraderas con ID, estado previo/propuesto y vencimiento. Los callbacks duplicados no vuelven a ejecutar una operación.
- `worker/src/services/business.ts`: aplica `update_price` y `update_stock` con comparación del estado observado, reclamo condicional, mutación, auditoría y finalización en un único `D1.batch`. Cloudflare documenta `batch()` como transacción secuencial con rollback si falla una sentencia. Otras mutaciones se rechazan por ahora porque aún no cuentan con este controlador atómico.
- `worker/src/ai/gemini.ts`: usa la API oficial `generateContent`, modelo configurable, salida JSON estructurada y validación con los esquemas actuales. El tipo MIME para JSON está ajustado al enum oficial `APPLICATION_JSON`.
- La ruta de voz solo consume el `file_path` devuelto por `getFile` y construye la descarga en el host oficial de Telegram. Aplica timeout, máximo de 10 MiB, extensiones OGG y firma `OggS`; envía transcripción/propuesta por el flujo habitual de confirmación.
- La generación del código temporal de enlace administrativo ahora usa `crypto.randomUUID()` en lugar de `Math.random()`.
- Fotografías por Telegram no están habilitadas. No se admiten cargas al R2 mediante el bot ni sustituciones de imágenes.

## Verificación previa al staging HTTPS (historial)

- Worker: 11 archivos, 55 pruebas aprobadas; `npx tsc --noEmit` aprobado.
- Frontend: 16 archivos, 52 pruebas aprobadas; `npm run build` aprobado.
- Migración 0004 probada sobre un clon SQLite, con conteos preservados y comprobación de tablas, índices y `execution_token`.
- Se realizó una llamada real de solo lectura a Gemini con `GEMINI_MODEL` para proponer una consulta de inventario tipada del SKU `KINETIK-05`. Pasó la validación de esquema. No consultó ni escribió D1.
- Telegram `getMe` y `getWebhookInfo` respondieron correctamente. La identidad del bot es `@SneakerHubAdmin_bot`; el webhook está ausente. `pending_update_count` era 1. Tras el envío del código temporal, se encontró una coincidencia exacta en un chat privado y el usuario confirmó la cuenta. Su ID numérico quedó guardado localmente en `.dev.vars` sin mostrar secretos.
- No se ha probado Telegram de extremo a extremo con webhook HTTPS y bot de prueba; el desafío del dueño se recibió por `getUpdates`, pero no se envió `/start` al Worker. No se recibió una nota de voz real; la integración no se declara terminada.

## Staging local aislado preparado (historial)

- Ejecutar el entorno con `wrangler dev --config wrangler.toml --env staging --local --persist-to ../.tmp/sneakerhub-telegram-staging/persist-v2`. El Worker se llama `sneakerhub-telegram-staging`, usa D1 `sneakerhub-telegram-test-db` y R2 `sneakerhub-telegram-test-assets` con un ID local distinto a los recursos originales.
- La D1 temporal recibió las migraciones 0001–0004 y el seed ficticio `database/seeds/telegram-agent-staging.sql`. Quedó con 1 producto (`TEST-TRN-001`), 2 variantes, 1 categoría, 0 pedidos, 1 auditoría y 2 operaciones de prueba (1 aplicada, 1 pendiente por el caso de rollback). No hay datos de clientes.
- El stock de talla 38 pasó de 4 a 6 en staging con una confirmación; repetir la operación no la volvió a ejecutar. Una segunda operación con trigger de fallo en auditoría revirtió sus cambios de estado e inventario. Después, la operación pendiente se canceló por la instrucción `/cancelar`; estado final: 1 aplicada y 1 cancelada, una auditoría. El trigger temporal ya fue eliminado.
- El Worker staging respondió `/api/health` con 200 y `/api/products` solo devolvió el SKU ficticio. Se probó put/get/delete de un objeto de texto efímero en el R2 de staging; quedó vacío. La D1/R2 original continuó en 19/90/5/4 y 7 objetos.
- `worker/.dev.vars.staging.example` es una plantilla sin secretos y puede guardarse en Git. `worker/.dev.vars.staging` está ignorado y conserva el ID autorizado. Una comparación local posterior encontró que token Telegram y clave Gemini coinciden con `.dev.vars`; por tanto, sus credenciales no son independientes hasta ser reemplazadas.
- La interpretación Gemini anterior produjo una consulta tipada para `TEST-TRN-001` sin llamada D1; al coincidir la clave con `.dev.vars`, no cuenta como verificación de una credencial staging exclusiva.
- Cobertura final con mocks: Worker 12 archivos / 64 pruebas aprobadas; frontend 16 archivos / 52 pruebas aprobadas; typecheck Worker y build frontend aprobados.
- No se desplegó, creó un recurso remoto, registró webhook ni modificó el webhook definitivo.

## Credenciales de staging

- `worker/.dev.vars.staging` está ignorado por Git y tiene secreto webhook, JWT y credenciales administrativas independientes, además del ID de dueño autorizado.
- El propietario autorizó reutilizar credenciales principales. `getMe` del token staging disponible identificó `@SneakerHubPruebas_bot`, no `@SneakerHubAdmin_bot`; no se llamó a `setWebhook` ni se alteró el webhook.
- La consulta Gemini real con el modelo/clave configurados respondió JSON válido de solo interpretación para `TEST-TRN-001`, sin acceso a D1.
- Los primeros valores aleatorios de staging generados durante la preparación aparecieron en una salida técnica por un error de formato del archivo; se reemplazaron antes de iniciar staging y no se usaron. No eran valores del entorno definitivo.

## Activación remota parcial (estado anterior; supersedido, 2026-11-02)

- Se creó `sneakerhub-telegram-staging-db` en Cloudflare (UUID `18ac228c-c142-45c7-b801-6ae0c6e1f8eb`, región ENAM). Se aplicaron 0001–0004 y el seed ficticio en esa D1; consulta remota confirmó 1 producto, 2 variantes, 1 categoría y 0 pedidos, auditorías u operaciones.
- Se habilitó R2 y el bucket `sneakerhub-telegram-staging-assets` aparece en la cuenta. D1/seed/migraciones se verificaron en remoto por consultas de solo lectura.
- El Worker staging no existe aún. El dry-run pasó; el deploy falló antes de publicar porque falta `CLOUDFLARE_API_TOKEN` en el proceso de Wrangler. El flujo OAuth interactivo se detuvo sin automatizar autenticación. Corregir el token staging para que `getMe` identifique `@SneakerHubAdmin_bot`; no se registró webhook.
- La instalación original permanece intacta: sus tablas/filas de aplicación D1 y metadatos/hashes de los siete objetos R2 coinciden con la línea base.
- Pasos remotos restantes: [`SNEAKERHUB_STAGING_HTTPS_PLAN.md`](SNEAKERHUB_STAGING_HTTPS_PLAN.md).

## Variables privadas requeridas

Configurar localmente en `worker/.dev.vars` o como secretos del entorno privado, nunca en `[vars]` de Wrangler:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (Base64URL aleatorio de 32 bytes; ya generado localmente si no existía)
- `TELEGRAM_OWNER_ID` (ID numérico, se guarda solo después de verificar y confirmar la cuenta)
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- Las credenciales administrativas y `JWT_SECRET` ya existentes deben conservarse.

Para la verificación del dueño, se consulta primero `getWebhookInfo`; si hay webhook activo no se usa `getUpdates`. Con webhook ausente se envía un código aleatorio de un solo uso en privado, se busca únicamente ese código en actualizaciones privadas y se pide confirmación humana de la cuenta detectada antes de guardar `TELEGRAM_OWNER_ID`. No se autoriza por nombre de usuario.

## Activación privada pendiente (historial supersedido)

Los siguientes pasos describen el plan previo al despliegue. Ya se ejecutaron; consultar “Actualización de activación HTTPS” al final para el estado vigente.

1. Habilitar R2 desde Cloudflare Dashboard y verificar la disponibilidad del nombre `sneakerhub-telegram-staging-assets`; después crear solo ese bucket.
2. Cargar secretos remotos independientes de staging y desplegar el Worker staging con la configuración ignorada `worker/wrangler.remote-staging.toml`. La D1 remota staging ya existe, con migraciones 0001–0004 y datos ficticios; no repetir su creación ni migración.
3. Verificar URL HTTPS, health, catálogo ficticio, autorización y aislamiento D1/R2. La identidad del bot de prueba y su webhook vacío ya fueron comprobados.
4. Solicitar aprobación expresa antes de registrar el webhook únicamente para el bot de prueba; probar `/start`, comandos, duplicados, permisos y límites.
5. Completar voz real y comparar estado/auditoría antes y después. Pedir aprobación separada para cualquier despliegue a SneakerHub o webhook definitivo.

No ejecutar `/api/telegram/setup`, `setWebhook`, `deleteWebhook`, despliegue ni migración sobre la instalación original durante estas pruebas.

## Lista para aceptación real

- [x] ID del dueño confirmado; rechazo de usuario distinto probado con mocks.
- [x] `/ayuda` probado por HTTPS; `/start`, `/estado`, `/cancelar` y consulta de inventario también respondieron. Rate limit y `update_id` duplicado tienen pruebas automatizadas.
- [x] Consulta real Gemini de solo interpretación y respuesta estructurada; errores simulados están cubiertos por tests.
- [x] Stock confirmado con auditoría; repetición rechazada y cancelación sin escritura probadas en remoto. La expiración y concurrencia siguen cubiertas por validación automatizada, no por un ensayo real simultáneo.
- [x] Voz OGG/Opus real transcrita por Gemini; la consulta de stock respondió sin cambiar D1, abrir operación ni crear auditoría. Los límites y fallos de voz tienen pruebas automatizadas.
- [x] Fotos fuera del alcance; no habilitadas.
- [x] D1/R2 originales comparados contra línea base; staging contiene solo datos ficticios.
- [ ] Aprobación separada pendiente para conectar inventario real de producción.

## Reversión

- Eliminar o desactivar solo el webhook de prueba con su bot de prueba, si se configuró.
- Restaurar cambios de código desde el punto de respaldo, revisando cada archivo para no sobrescribir cambios previos del usuario.
- `0004` es aditiva; si se aplicó en un entorno temporal, conservar sus filas y no borrar tablas a ciegas.
- No restaurar automáticamente snapshots antiguos sobre SneakerHub. Conservar y comparar el estado actual antes de cualquier recuperación.

## Actualización de activación HTTPS (2026-11-02)

- Worker staging desplegado: `sneakerhub-telegram-staging`, URL `https://sneakerhub-telegram-staging.catalogo-lite-worker.workers.dev`. Health 200; catálogo contiene únicamente `TEST-TRN-001`; endpoint administrativo sin token responde 401.
- `@SneakerHubAdmin_bot` quedó conectado al webhook HTTPS de staging. `getMe` confirmó el bot y `getWebhookInfo` confirmó URL staging, sin actualizaciones pendientes ni error de entrega. No se modificó el webhook mediante `deleteWebhook` ni se descartaron actualizaciones pendientes.
- `/start`, `/estado`, consulta de inventario y pregunta en lenguaje natural respondieron en Telegram con la etiqueta `STAGING - CATALOGO FICTICIO`. La consulta de lenguaje natural devolvió los datos de staging mediante el fallback Gemini; la clave/modelo también pasaron una consulta real estructurada de solo interpretación.
- Se confirmaron dos operaciones de stock en D1 staging: talla 38 `4 → 5` y talla 39 `2 → 1`. Cada operación tiene una auditoría asociada al ID autorizado. Repetir la confirmación de la primera operación fue rechazado; no generó otra escritura ni otra auditoría. La tercera operación (talla 38 `5 → 6`) se canceló: quedó `cancelled`, sin auditoría y sin cambio de inventario. Resultado actual ficticio: talla 38 = 5, talla 39 = 1; no hay operaciones abiertas.
- El usuario confirmó accidentalmente la segunda propuesta antes de cancelar; se dejó ese cambio de staging y no se revirtió automáticamente.
- Prueba real de nota de voz: aprobada; una consulta OGG/Opus fue transcrita y respondió con el inventario, sin mutación. `/ayuda` real también respondió con la lista de comandos. Fotos por Telegram permanecen fuera del alcance.
- `/ayuda`, precio real, confirmación de precio, cancelación preconfirmación, mutación de stock por voz confirmada, confirmación repetida, replay HTTPS duplicado, rechazo HTTPS de un ID desconocido y error real de modelo Gemini se probaron en staging. Un cambio de código exige talla para actualizar stock; la talla omitida en una primera voz se rechazó sin escritura. La confirmación de voz posterior cambió solo talla 38.
- Estado ficticio final de staging: price 101000 COP; talla 38 = 6 y talla 39 = 1; 4 operaciones aplicadas, 3 canceladas, 4 auditorías y ninguna abierta.
- Suites verificadas después de los cambios: Worker 70/70 y TypeScript aprobado; frontend sin cambios en esta fase, último resultado 52/52 y build aprobado.
- `getWebhookInfo` conserva la URL staging y 0 pendientes; muestra como último error histórico `Connection reset by peer` (2026-11-02 15:40 UTC). Mensajes posteriores del dueño recibieron respuesta.
- La D1/R2 y el Worker originales no recibieron cambios; no se desplegó el frontend ni se conectó el inventario real. Se requiere aprobación separada antes de apuntar el bot a recursos de producción.
