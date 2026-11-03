# Plan de activación HTTPS para staging de SneakerHub

**Estado vigente (2026-11-02): staging desplegado y webhook activo.** La sección “Activación realizada” al final supersede las notas de preparación pendientes que siguen como historial.

## Estado comprobado

- La instalación principal usa D1 `catalogo-lite-db` con `database_id = local-dev-placeholder` en el archivo local, y R2 `catalogo-lite-assets`.
- El entorno local staging usa Worker `sneakerhub-telegram-staging`, D1 `sneakerhub-telegram-test-db`, ID solo local `a0d6409c-2777-44c0-8dd1-ef546018b404`, R2 `sneakerhub-telegram-test-assets` y persistencia `.tmp/sneakerhub-telegram-staging/persist-v2`.
- Esos bindings no apuntan a los recursos originales. El ID local no es un ID remoto y no se debe reutilizar en Cloudflare.
- Cloudflare `whoami` confirmó acceso a la cuenta. El bucket `sneakerhub-telegram-staging-assets` existe. Una lectura de objetos no fue necesaria.
- El propietario autorizó intencionalmente usar la credencial principal. En esta ejecución, `getMe` del token disponible en `.dev.vars.staging` identificó `@SneakerHubPruebas_bot`, no `@SneakerHubAdmin_bot`; no se modificó el webhook. Corregir localmente el valor en el archivo staging y verificar la identidad principal antes de conectar.
- Gemini real sí respondió con el modelo y clave configurados: se validó una propuesta JSON de lectura para `TEST-TRN-001`, sin consultar D1.
- El Worker staging local cargó las variables de `worker/.dev.vars.staging` y arrancó correctamente. Health respondió 200, catálogo devolvió solo el SKU ficticio y admin sin sesión respondió 401.
- La D1 remota staging ya existe y tiene migraciones 0001–0004 y el seed ficticio: 1 producto, 2 variantes, 1 categoría, 0 pedidos, 0 auditorías y 0 operaciones.
- El listado D1 en la cuenta estaba vacío antes de crearla; el UUID asignado es `18ac228c-c142-45c7-b801-6ae0c6e1f8eb` (región ENAM). La consulta posterior confirmó el nombre y UUID.
- La D1 aparece en el listado de recursos con `num_tables=0`, pero consultas SQL remotas de solo lectura confirmaron las tablas, el ledger 0001–0004 y el SKU ficticio `TEST-TRN-001`; el metadato de conteo del listado no refleja el esquema actual.

## Recursos remotos propuestos

| Recurso | Nombre candidato | Estado |
|---|---|---|
| Worker | `sneakerhub-telegram-staging` | No creado; workers.dev HTTPS quedaría habilitado |
| D1 | `sneakerhub-telegram-staging-db` | Creado; UUID `18ac228c-c142-45c7-b801-6ae0c6e1f8eb` |
| R2 | `sneakerhub-telegram-staging-assets` | Existe; confirmado en el listado de Cloudflare |
| URL | `https://sneakerhub-telegram-staging.<subdominio-workers>.workers.dev` | No existe hasta desplegar; confirmar la URL exacta de la salida de Wrangler |

La configuración de partida sin secretos está en [`worker/wrangler.remote-staging.toml.example`](../worker/wrangler.remote-staging.toml.example). La copia que contenga el UUID real se llamará `worker/wrangler.remote-staging.toml` y está excluida de Git.

## Pasos remotos pendientes (historial supersedido)

Estos pasos son la lista previa al despliegue. Ya fueron completados; ver “Activación realizada” al final para la configuración vigente.

La cuenta y los recursos staging se verificaron. El Worker aún no existe en Cloudflare.

La D1 y el bucket R2 staging ya existen; no crear recursos duplicados ni repetir migraciones.

La configuración local ignorada `worker/wrangler.remote-staging.toml` ya contiene el UUID remoto verificado y el nombre candidato de R2. Revisar que solo refiera D1/R2 staging; no modificar `wrangler.toml` ni el entorno `production`. El archivo fuente sin secretos sigue en `worker/wrangler.remote-staging.toml.example`.

```powershell
notepad .\wrangler.remote-staging.toml
```

Las migraciones 0001–0004 y el seed ficticio ya se aplicaron a la D1 remota staging. Wrangler guardó su historial de migraciones. La verificación de solo lectura devolvió 1 producto, 2 variantes, 1 categoría, 0 pedidos, 0 auditorías y 0 operaciones. No repetirlas salvo una consulta previa del ledger de migraciones.

No ejecutar `wrangler secret put`: crea y despliega versiones por separado. Para enviar el código y las credenciales privadas en una sola operación, Wrangler admite `--secrets-file` con formato dotenv. El archivo local `worker/.dev.vars.staging` está ignorado por Git y el dry-run con este archivo pasó sin mostrar sus valores. La API de Wrangler preserva secretos existentes que no aparezcan en el archivo; el Worker de staging todavía no existe.

El dry-run pasó. El intento de deploy no llegó a publicar: la ejecución no interactiva informó que falta `CLOUDFLARE_API_TOKEN`; el flujo OAuth requiere inicio de sesión interactivo y se detuvo sin automatizarlo. También falta corregir la identidad del bot que devuelve el token staging. Cuando Wrangler tenga autenticación local y `getMe` identifique el bot principal, ejecutar (desde `worker/`):

```powershell
npx wrangler deploy --config .\wrangler.remote-staging.toml --secrets-file .\.dev.vars.staging
```

El comando no se completó: no se desplegó Worker ni se creó URL HTTPS. `GEMINI_MODEL` también está declarado en `[vars]`. El nombre `sneakerhub-telegram-staging` sigue sin existir en Cloudflare y es diferente del Worker principal `catalogo-lite-api`. No subir el frontend.

Tomar la URL HTTPS exacta de la salida del deploy y comprobar primero `GET /api/health`, `GET /api/products` (debe mostrar solo `TEST-TRN-001`) y admin sin token (debe responder 401). Consultar de nuevo D1/R2 remotas y confirmar sus nombres antes de conectar Telegram.

## Webhook del bot de prueba — instrucciones previas, supersedidas

El webhook actual corresponde al bot principal `@SneakerHubAdmin_bot` y apunta al Worker staging, tras autorización expresa del propietario. Las instrucciones históricas siguientes no se aplican al estado vigente.

Antes de registrar nada:

1. Ejecutar `getMe` con el token del bot de prueba y comprobar su identidad.
2. Ejecutar `getWebhookInfo` con ese mismo token. Si muestra un webhook que deba conservarse, detenerse; no sobrescribirlo.
3. Confirmar URL `https://` de staging, Worker/D1/R2 remotos independientes y `TELEGRAM_OWNER_ID` del dueño autorizado.
4. Obtener aprobación expresa para registrar solo el bot de prueba.

El endpoint ya existente `GET /api/telegram/setup`, autenticado con JWT administrativo de staging, registra el webhook de acuerdo con `TELEGRAM_WEBHOOK_URL` o el origen HTTPS y envía `TELEGRAM_WEBHOOK_SECRET`. **No se llamó.** No usar el token definitivo en ninguna prueba.

Después de la aprobación, comprobar `/start`, `/ayuda`, `/estado`, consulta `TEST-TRN-001`, propuesta de stock, confirmación una vez, repetición rechazada y voz OGG/Opus con transcripción y confirmación. No activar fotos; otras mutaciones siguen rechazadas hasta ser transaccionales.

## Reversión de staging

- No borrar D1/R2 remotas automáticamente. Suspender primero el Worker de staging y, si el usuario lo aprueba, quitar solo el webhook del bot de prueba.
- Conservar la D1, auditoría y R2 de staging para revisión. La instalación y webhook definitivos permanecen fuera del procedimiento.

## Activación realizada (2026-11-02)

- Worker independiente `sneakerhub-telegram-staging` desplegado en `https://sneakerhub-telegram-staging.catalogo-lite-worker.workers.dev`, vinculado a D1 `sneakerhub-telegram-staging-db` (UUID `18ac228c-c142-45c7-b801-6ae0c6e1f8eb`) y R2 `sneakerhub-telegram-staging-assets`.
- `GET /api/health` devolvió 200; `/api/products` devolvió solo `TEST-TRN-001`; administración sin token devolvió 401.
- El webhook de `@SneakerHubAdmin_bot` apunta a `/api/telegram/webhook` en esta URL. No hay actualizaciones pendientes ni errores de entrega reportados. No se descartaron actualizaciones ni se tocó el webhook de otro bot.
- Pruebas reales confirmadas: `/start`, `/estado`, consulta del SKU, interpretación Gemini por lenguaje natural, dos confirmaciones de stock (cada una con una auditoría), rechazo de confirmación duplicada y cancelación sin escritura. Estado ficticio actual: talla 38 = 5, talla 39 = 1. La propuesta de talla 39 se confirmó antes de que el usuario cancelara; se conservó tal cambio en staging.
- Nota de voz real aprobada: Telegram entregó una nota OGG/Opus, Gemini la transcribió y el Worker respondió inventario de staging sin crear operación ni auditoría ni alterar stock. `/ayuda` también respondió con la lista de comandos. Las suites automatizadas reportadas: Worker 65/65, typecheck correcto, frontend 52/52 y build correcto.
- No se publicaron cambios en `catalogo-lite-api`, frontend, checkout ni recursos originales. Para la fase posterior de inventario real se requiere aprobación separada y revisión de bindings antes de cambiar cualquier recurso.
