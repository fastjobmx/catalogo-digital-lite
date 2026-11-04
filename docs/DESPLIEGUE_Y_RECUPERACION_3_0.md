# Despliegue y recuperación — Plataforma 3.0

Procedimiento para activar la plataforma multitienda (migración `0007`, Worker 3.0, frontend con rutas `/t/<tienda>`, bot maestro) **sin interrumpir SneakerHub**. Nada de esto se ejecutó contra Cloudflare, Netlify ni Telegram durante el desarrollo: cada paso remoto requiere tu autorización.

## 0. Qué cambia y qué no

| Componente | Cambio | Riesgo |
|---|---|---|
| D1 `catalogo-lite-production-db` | Migración `0007_multi_tenant_platform.sql`: tablas de plataforma + `store_id` en catálogo, pedidos y auditoría. Los datos actuales pasan a la tienda 1. | Reconstruye `categories`, `products`, `product_variants`, `order_inventory_operations` (con copia fila a fila). Verificado sobre copia del respaldo. |
| Worker `catalogo-lite-api` | Código 3.0 (tenencia, roles, asistente, plataforma, bot maestro). | Requiere la migración aplicada antes. |
| Netlify | Frontend con `/t/<tienda>`, `/admin/activar`, `/plataforma`. | La tienda raíz (SneakerHub) no cambia de URL. |
| Telegram | Nuevo webhook `/api/master/webhook` para el bot maestro. El asistente de tiendas sigue en `/api/telegram/webhook`. | `@SneakerHubAdmin_bot` y `@SneakerHubPruebas_bot` no se tocan. |

## 1. Evidencia previa (local, ya realizada)

- `node scripts/verify-d1-migration.mjs .tmp/telegram-231-production/production-before.sql --rollback` → **OK**: integridad, 0 violaciones de FK, hashes idénticos en 9 tablas, secuencias AUTOINCREMENT preservadas, reversión idéntica.
- Wrangler D1 local (Miniflare) aplicó `0007` sobre la copia del respaldo: 71 comandos, conteos 19/90/5/7/6 idénticos.
- El **Worker actualmente en producción** funcionó sobre el esquema migrado (catálogo, login, pedido, confirmación con reserva de stock, categoría). Por eso el orden seguro es: **migrar primero, desplegar después**.
- Worker 3.0 en `workerd` sobre la copia migrada: smoke test 19/19 (aislamiento, aprovisionamiento, activación, mismo SKU en dos tiendas).

### Staging — migración 0007 y Worker 3.0 desplegados (2026-11-03, autorizado)

- Respaldo previo: `.tmp/staging-0007/staging-pre-0007.sql` (72.144 bytes, SHA-256 `bc4ab7537924619e801d3df039308d6f4c405f62ad89449ed98fd66025afbd68`, ignorado por Git). Verificado localmente con `verify-d1-migration.mjs --rollback`: OK.
- Marcador Time Travel previo: `0000007d-00000002-00005118-f4dfec99c1c77127f91a4382ca071b6d`.
- `wrangler d1 migrations apply` sobre `sneakerhub-telegram-staging-db`: 0007 aplicada (71 comandos). Estado remoto: 2 productos, 5 variantes, 1 categoría, 0 pedidos, 17 auditorías, 24 operaciones Telegram (idéntico al respaldo), 0 violaciones de FK, tienda 1 `tenis-manizales` activa.
- Worker `sneakerhub-telegram-staging`: versión anterior `ec76398d-daf7-4cce-8e0c-eee44c1ff846` → nueva `267eab01-6dcb-4ba1-b750-2a1e06adbe78`. Dry-run previo: solo bindings de staging.
- Smoke test HTTPS 13/13 (catálogo, tienda por dirección, 404 de tienda inexistente, 401 sin sesión, 403 del webhook sin secreto, bot maestro 503 sin configurar). Webhook de `@SneakerHubPruebas_bot` sigue en staging, sin pendientes ni errores; no se modificó.
- Inicio de sesión habilitado (autorizado): la autenticación ahora reconoce `ENVIRONMENT = "staging"` con reglas de no producción (contraseña de prueba en secreto, JWT fuerte obligatorio). Worker redesplegado de `267eab01` a `f4ff0779-da64-4021-a093-3060e4eca0a4`. Verificado por HTTPS: token inválido 503 → 401; login de superadministrador 200; `/api/admin/session`, estadísticas, `/api/platform/summary` y `/api/platform/health` responden con datos de staging.
- Hallazgo: la salud de la tienda 1 marca “propietario” pendiente porque su dueño está vinculado por el método heredado (`TELEGRAM_OWNER_ID`), no como usuario de plataforma. El asistente funciona igual; se resuelve asignando el propietario con `POST /api/platform/stores/<tienda>/owner` o `/asignar_admin`.

Reversión de staging si fuera necesaria:

```powershell
cd worker
npx wrangler rollback ec76398d-daf7-4cce-8e0c-eee44c1ff846 --config wrangler.remote-staging.toml
# Base: solo hay una tienda, así que sirve el script de reversión; Time Travel como alternativa:
npx wrangler d1 execute sneakerhub-telegram-staging-db --remote --config wrangler.remote-staging.toml --file ../database/rollback/0007_multi_tenant_platform.down.sql
npx wrangler d1 time-travel restore sneakerhub-telegram-staging-db --config wrangler.remote-staging.toml --bookmark=0000007d-00000002-00005118-f4dfec99c1c77127f91a4382ca071b6d
```

### Producción — migración 0007 y Worker 3.0 desplegados (2026-11-03, autorizado)

- Respaldo previo: `.tmp/production-0007/production-pre-0007.sql` (78.817 bytes, SHA-256 `c64030376ad3caa1502b03de638606ef0767614dc704ce1b20c224ebebe64fe6`, ignorado por Git). Verificado localmente con `verify-d1-migration.mjs --rollback`: OK (20 productos, 95 variantes, 5 categorías, 7 pedidos, 6 reservas, 19 auditorías, 2 operaciones Telegram; hashes y secuencias idénticos).
- Marcador Time Travel previo: `00000035-00000000-00005118-93e7cecb3467346d2fdd232c16f50cd1`.
- `wrangler d1 migrations apply catalogo-lite-production-db --remote`: 0007 aplicada (71 comandos). Estado remoto idéntico al respaldo, 0 violaciones de FK, tienda 1 `sneakerhub-premium` activa (plan `legacy`). El Worker anterior siguió respondiendo 200 sobre el esquema migrado antes del despliegue.
- Worker `catalogo-lite-api`: versión anterior `f4619f2f-9f86-487c-acad-143e94c5283f` → nueva `7def7c60-24d1-4f10-8662-8098bf5faf50`. Dry-run previo: solo bindings de producción. Variable nueva: `PUBLIC_STORE_BASE_URL`.
- Smoke test HTTPS 15/15: salud, configuración, 20/20 productos activos, ficha, categorías, tienda por dirección, 404 de tienda inexistente, autenticación configurada (token inválido → 401), plataforma y setup sin sesión → 401, webhook sin secreto → 403, bot maestro 503, CORS desde Netlify con `X-Store-Slug`, sitio Netlify 200 e imagen R2 por el proxy de Netlify. En navegador: la tienda pública carga 72 enlaces de producto sin errores de consola.
- No se crearon pedidos ni datos y no se tocaron secretos ni webhooks.
- Frontend 3.0 publicado (autorizado): commit `ebc2ccb` en `main` → Netlify sirvió el bundle `index-BYR7Loqy.js` (antes `index-DmZ4oTeo.js`). Verificado en navegador: la raíz muestra SneakerHub con 72 enlaces de producto y sin errores de consola; `/t/sneakerhub-premium` sirve la misma tienda con enlaces bajo su dirección; `/t/tienda-que-no-existe` muestra “Esta tienda no está disponible” sin marca de SneakerHub; `/admin/activar` rechaza un enlace inválido; `/plataforma` carga su módulo y pide iniciar sesión. Para revertir solo el frontend: “Publish deploy” del despliegue anterior en Netlify o `git revert` del commit.

### Corrección del asistente — 2026-11-03 (autorizado)

Fallos vistos al probar `@SneakerHubAdmin_bot`: las tallas se rechazaban con punto final o sin color, y la visión de fotos se cortaba en 600 tokens de salida (JSON incompleto). Corregido el análisis de tallas/precio/código, ampliados los límites de salida de Gemini (fotos 2.048), detectadas respuestas truncadas y registradas todas las fallas de IA en `platform_events`. Worker 162/162.

- Staging: `f4ff0779` → `022cce45-92f6-4d68-8cb5-b38813ee9429` (smoke 13/13).
- Producción: `7def7c60` → `50fac136-a110-4402-b97e-5a6c5e4f91f0` (smoke 15/15). Para revertir solo esta corrección: `npx wrangler rollback 7def7c60-24d1-4f10-8662-8098bf5faf50 --config wrangler.production.toml`.

### Activación del bot maestro — 2026-11-03

Secretos `MASTER_BOT_TOKEN`, `MASTER_WEBHOOK_SECRET` y `MASTER_ADMIN_TELEGRAM_IDS` cargados por el propietario en `catalogo-lite-api` (versiones `4ae1fade` y `f9928a44`, mismo código que `50fac136`). Cambios: menú pedido (6 opciones), “Ayuda con IA”, IDs de administrador separados por comas, punto y coma o espacios, y verificación/registro del webhook sin leer secretos (sección 4). Worker 177/177.

- Staging: `022cce45` → `c62112c4-c378-45bd-8e16-cd8267b3dcb2` (smoke 14/14; estado vía código de un solo uso: `@SneakerHubPruebas_bot` con su webhook de staging, sin pendientes ni errores; staging no tiene bot maestro).
- Producción (autorizado): `f9928a44` → `2022415f-d2ae-470d-83cd-796d51e248f2` (smoke 14/14; los 10 secretos se conservan). Estado por código de un solo uso: bot maestro `@CatalogoDigitalMaestro_bot` (id 9166610650), distinto del asistente `@SneakerHubAdmin_bot` (id 9019695525); secreto configurado; 1 ID de administrador válido y 0 inválidos; webhook maestro aún sin registrar (1 actualización en cola). Webhook del asistente sin cambios, apuntando a `/api/telegram/webhook`, 0 pendientes. Su último error registrado por Telegram (“Connection reset by peer”, 2026-11-03 20:42 UTC) coincide con el despliegue anterior y no dejó actualizaciones sin entregar.
- Webhook del bot maestro registrado (autorizado, 2026-11-03) con `node scripts/master-maintenance.mjs webhook`: `https://catalogo-lite-api.catalogo-lite-worker.workers.dev/api/master/webhook`, `message` y `callback_query`. Telegram entregó las actualizaciones en cola: 3 procesadas desde 1 chat de administrador, 0 errores del bot maestro, 0 pendientes y sin errores de entrega; 1 tienda (no se creó ninguna). Webhook de `@SneakerHubAdmin_bot` sin cambios y sin pendientes.
- Para revertir solo este cambio: `npx wrangler rollback f9928a44-557f-4a81-a3b0-6271eb82460f --config wrangler.production.toml`. **No** revertir a versiones anteriores a `f9928a44` o se perderán los secretos maestros.

### Creación automática de tiendas — 2026-11-03

Asistente de `/crear_tienda` con el orden pedido, colores para todas las plantillas, logotipo opcional, entrega sin datos internos y enlace al asistente IA. Además, eliminación protegida de tiendas de prueba (`DELETE /api/platform/stores/<dirección>`). Worker 181/181.

- Staging: `c62112c4` → `374ef15b` (prueba integral) → `8a7afb51-665a-4eaf-a3b3-4fe14d9f3a1e` (smoke 14/14). Tienda de prueba `prueba-entrega-ia` creada, verificada, activada y luego eliminada sin restos; tienda principal de staging con la misma huella antes y después. Detalle en `docs/ENTREGA_DE_TIENDAS.md` §6.
- Producción (autorizado): `2022415f` → `88c33008-53b2-4b2e-bf69-2837850a5ee8`. Smoke 14/14; los 10 secretos se conservan; `DELETE /api/platform/stores` sin sesión → 401. Bot maestro y asistente con su webhook, 0 pendientes y sin errores nuevos; 1 tienda; 0 errores en la última hora. No se creó ninguna tienda. Para revertir solo este cambio: `npx wrangler rollback 2022415f-d2ae-470d-83cd-796d51e248f2 --config wrangler.production.toml`.

Reversión de producción si fuera necesaria (mientras solo exista la tienda 1):

```powershell
cd worker
npx wrangler rollback f4619f2f-9f86-487c-acad-143e94c5283f --config wrangler.production.toml
# Solo si además hay que revertir la base (exportar antes el estado actual):
npx wrangler d1 execute catalogo-lite-production-db --remote --config wrangler.production.toml --file ../database/rollback/0007_multi_tenant_platform.down.sql
npx wrangler d1 time-travel restore catalogo-lite-production-db --config wrangler.production.toml --bookmark=00000035-00000000-00005118-93e7cecb3467346d2fdd232c16f50cd1
```

El Worker anterior funciona con el esquema migrado, por lo que revertir solo el Worker basta en la mayoría de los casos. `time-travel restore` descarta todo lo escrito después del marcador (pedidos incluidos): usarlo solo con autorización expresa.

## 2. Procedimiento de despliegue en producción (ejecutado el 2026-11-03; referencia para futuras migraciones)

```powershell
cd "D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite\worker"

# 2.1 Respaldo fresco (no reemplaza Time Travel; queda local e ignorado por Git)
npx wrangler d1 export catalogo-lite-production-db --remote --config wrangler.production.toml --output ..\.tmp\pre-0007-production.sql

# 2.2 Verificar ese respaldo con el script (solo local)
node ..\scripts\verify-d1-migration.mjs ..\.tmp\pre-0007-production.sql --rollback

# 2.3 Anotar el marcador de Time Travel (punto de restauración)
npx wrangler d1 time-travel info catalogo-lite-production-db --config wrangler.production.toml

# 2.4 Aplicar la migración (el Worker actual sigue funcionando con el esquema nuevo)
npx wrangler d1 migrations apply catalogo-lite-production-db --remote --config wrangler.production.toml

# 2.5 Comprobaciones de solo lectura
npx wrangler d1 execute catalogo-lite-production-db --remote --config wrangler.production.toml --command "SELECT (SELECT COUNT(*) FROM products) p, (SELECT COUNT(*) FROM product_variants) v, (SELECT COUNT(*) FROM orders) o, (SELECT slug || ':' || status FROM stores WHERE id = 1) tienda"
```

Si 2.5 muestra los mismos conteos que antes, continuar:

```powershell
# 2.6 Secretos nuevos (solo si se activará el bot maestro; ver sección 4)
npx wrangler secret put MASTER_BOT_TOKEN --config wrangler.production.toml
npx wrangler secret put MASTER_WEBHOOK_SECRET --config wrangler.production.toml
npx wrangler secret put MASTER_ADMIN_TELEGRAM_IDS --config wrangler.production.toml

# 2.7 Pruebas exactas sobre el artefacto y despliegue
npm test ; npx tsc --noEmit ; npx wrangler deploy --dry-run --config wrangler.production.toml
npx wrangler deploy --config wrangler.production.toml
```

Después del Worker, publicar el frontend (Netlify, rama/commit aprobado). Verificación pública:

- `GET /api/health` → 200; `GET /api/products` → 19 productos (tienda raíz sin cabecera).
- `https://catalogo-digital-ia.netlify.app/` → SneakerHub igual que antes.
- Iniciar sesión en `/admin/login` con el superadministrador → `/plataforma` lista la tienda 1.

## 3. Slug de la tienda principal

La migración asigna a la tienda 1 el slug derivado de su nombre (en la copia: `sneakerhub-premium`). La tienda 1 se sigue sirviendo en la raíz; el slug solo aparece en listados. Para cambiarlo: `PUT /api/platform/stores/1/slug {"slug":"sneakerhub"}`.

## 4. Bot maestro

1. En Telegram, con **@BotFather**: `/newbot` → nombre sugerido “Catálogo IA Plataforma”, usuario terminado en `bot`. Guarda el token **solo** como secreto del Worker (`MASTER_BOT_TOKEN`).
2. Genera un secreto aleatorio para el webhook (`MASTER_WEBHOOK_SECRET`, 16+ caracteres; recomendado 32+) y define `MASTER_ADMIN_TELEGRAM_IDS` con tu ID numérico (puedes obtenerlo con @userinfobot; varios IDs separados por comas).
3. Verificación sin leer secretos (el propio Worker consulta Telegram y responde solo datos no sensibles):

   ```powershell
   cd "D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite"
   node scripts/master-maintenance.mjs status     # getMe y getWebhookInfo del bot maestro y del asistente (solo lectura)
   node scripts/master-maintenance.mjs webhook    # setWebhook del bot maestro (requiere autorización)
   ```

   El script genera un código de un solo uso, guarda en D1 solo su SHA-256 (tabla existente `platform_operations`, acción `maintenance`, vence en 10 minutos, vale para una sola acción) y llama a `POST /api/master/maintenance/status` o `/webhook`. Con `--staging` usa el Worker de pruebas. También se puede llamar con sesión de superadministrador (`Authorization: Bearer …`). La respuesta nunca incluye tokens, el secreto ni los IDs de administradores; cada uso queda en `platform_events` (`master_maintenance`).
   El registro se **niega** si el token maestro es el mismo del asistente o pertenece al mismo bot, si faltan IDs válidos o si el secreto es corto. Solo llama a `setWebhook` del bot maestro (`/api/master/webhook`, `message` y `callback_query`); los webhooks de `@SneakerHubAdmin_bot` y `@SneakerHubPruebas_bot` no se tocan. La antigua `GET /api/master/setup` se eliminó (un GET no debe tener efectos).
4. Escribe `/start` al bot maestro. Menú: Crear nueva tienda · Ver mis tiendas · Administrar propietarios · Configuración de plataforma · Estadísticas · Ayuda con IA. Usuarios no autorizados, grupos y chats ajenos no reciben respuesta ni pueden crear o cambiar nada.

Para revertir solo el webhook del bot maestro: `deleteWebhook` de ese bot (o volver a registrar). No afecta a las tiendas ni a los otros bots.

**Asistente de tiendas:** el webhook actual (`/api/telegram/webhook`) ya es multitienda. Decide si el asistente compartido será `@SneakerHubAdmin_bot` (el dueño de SneakerHub sigue vinculado como propietario de la tienda 1) o un bot nuevo con nombre neutro. Si cambias de bot, el cambio de webhook es una operación separada que requiere autorización. Para enlaces de un toque define `TELEGRAM_BOT_USERNAME`.

## 5. Recuperación

| Situación | Acción |
|---|---|
| Falla `migrations apply` | D1 ejecuta la migración en una transacción: no se aplica parcialmente. Revisar el error, no reintentar a ciegas. El Worker actual sigue operando. |
| Conteos distintos tras migrar (antes de desplegar el Worker 3.0) | Ejecutar `database/rollback/0007_multi_tenant_platform.down.sql` (solo válido con una única tienda; tiene guarda que aborta si hay más) o restaurar con Time Travel al marcador de 2.3. |
| Worker 3.0 con fallas y **solo existe la tienda 1** | `npx wrangler rollback --config wrangler.production.toml` a la versión anterior: es compatible con el esquema migrado (verificado). |
| Worker 3.0 con fallas y **ya existen otras tiendas** | **No** volver al Worker anterior: no filtra por tienda y mezclaría catálogos. Suspender las tiendas nuevas (`/suspender` o `/plataforma`) y corregir hacia adelante, o restaurar D1 con Time Travel asumiendo la pérdida de lo creado después. |
| Aprovisionamiento interrumpido | Repetir con la misma `Idempotency-Key` (el bot maestro lo hace con “Reintentar”): continúa el mismo trabajo sin duplicar la tienda. Estado en `GET /api/platform/jobs/<id>`. |
| Propietario perdió el enlace o el código | `/acceso <tienda>` en el bot maestro o “Accesos” en `/plataforma`: genera nuevos y anula los anteriores sin usar. |
| Consumo de IA alto | `/limite_ia <tienda> <USD>` (0 bloquea la IA de esa tienda); tope global opcional `PLATFORM_AI_MONTHLY_CAP_MICROS`. |
| Tienda debe salir del aire | `/suspender <tienda> <motivo>`: deja de ser pública y su asistente queda en pausa; los datos se conservan. |

`wrangler d1 time-travel restore` reemplaza la base completa: úsalo solo con autorización explícita y después de exportar el estado actual.

## 6. Datos y secretos

- Los tokens de activación y los códigos de Telegram se guardan solo como hash SHA-256; se muestran una vez.
- El superadministrador se define únicamente por secretos (`ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `MASTER_ADMIN_TELEGRAM_IDS`); ninguna fila de la base puede otorgarlo.
- No copiar tokens de staging a producción ni del asistente al bot maestro.

## Onboarding 3.1 (migración 0008) — staging 2026-11-03

- Respaldo `.tmp/staging-0008/staging-pre-0008.sql` (SHA-256 `f610787cdc6d8569ba40be71c421cd2e4c08da66232cdb45d22ba47dca029dc7`); Time Travel previo `000000a7-00000000-00005119-1d8fb18e0efd16ec1b3a4bf6ae129278`.
- `0008_store_onboarding.sql` aplicada en `sneakerhub-telegram-staging-db`; Worker `8a7afb51` → `b6b92066-2340-4620-abed-1d6bbe3aa4ac`. E2E 15/15 y smoke OK.
- Reversión: `npx wrangler rollback 8a7afb51-665a-4eaf-a3b3-4fe14d9f3a1e --config wrangler.remote-staging.toml` y luego `database/rollback/0008_store_onboarding.down.sql`.
- Producción: no aplicada. Procedimiento en `docs/ONBOARDING_CLIENTES.md` §8.
- Producción (autorizado, 2026-11-03): `0008` aplicada en `catalogo-lite-production-db` (respaldo `.tmp/production-0008/`, Time Travel `00000084-00000024-00005119-d451fe6e78c2eb96805659e29b3f44ca`); Worker `88c33008` → `ac6acb57-4ee2-4174-8705-bff90877cf99`. Reversión en `docs/ONBOARDING_CLIENTES.md` §8.
