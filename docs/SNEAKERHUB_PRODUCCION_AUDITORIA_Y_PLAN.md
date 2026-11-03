# SneakerHub — auditoría de producción y plan de conexión

Fecha de auditoría: 2026-11-02. Alcance remoto: consultas de solo lectura. No se desplegó producción, no se conectó el webhook a producción y no se importaron datos.

## Resultado resumido

- La base con los datos reales encontrados en este checkout es una D1 local de Wrangler. Tiene 19 productos, 90 variantes, 5 categorías, 4 pedidos y 1 fila de configuración.
- En la cuenta Cloudflare disponible, la lista de D1 solo contiene `sneakerhub-telegram-staging-db` y la lista R2 solo contiene `sneakerhub-telegram-staging-assets`. No aparece una D1 o R2 original de producción.
- El Worker `catalogo-lite-api`, aunque aparece en `worker/wrangler.toml`, no existe en esa cuenta Cloudflare. Tampoco apareció un proyecto de Pages. No se puede determinar el Worker que atiende la tienda pública ni descartar que los recursos estén en otra cuenta.
- La instalación original no se modificó. El backup local de D1/R2/fotos se verificó con SHA-256 y su manifiesto está en `.tmp/sneakerhub-prod-connection-audit-20261102/manifest.json`.

## Dónde están los datos locales

| Recurso | Ubicación verificada | Contenido |
|---|---|---|
| Configuración declarada de D1 | `worker/wrangler.toml`, binding `DB`, nombre `catalogo-lite-db`, ID `local-dev-placeholder` | El ID es un placeholder; no identifica una D1 remota. |
| D1 local encontrada | `worker/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/` | Archivo SQLite válido de 151552 bytes; 19 productos, 90 variantes, 5 categorías, 4 pedidos, 1 configuración y 10 auditorías. |
| Fotografías estáticas | `frontend/public/seed-images/sneakerhub/` | 42 archivos. Los 19 productos tienen imagen referenciada: 18 usan `/seed-images/sneakerhub/...`; uno referencia `/api/assets/products/...`. |
| R2 local de Wrangler | `worker/.wrangler/state/v3/r2/catalogo-lite-assets/` | 7 objetos: 5 bajo `products/` y 2 bajo `store/`; no hay cargas multipart. El objeto de producto referenciado está en este R2 local. |
| Worker declarado localmente | `worker/wrangler.toml`, nombre `catalogo-lite-api` | Wrangler informó que el Worker no existe en la cuenta OAuth consultada. |

La D1 local no tiene ledger `d1_migrations`. El esquema coincide con `0001_initial.sql`, `0002_agent.sql` y `0003_theme.sql`; no contiene las tablas `telegram_operations` ni `telegram_rate_limits` de `0004_telegram_agent.sql`. La migración 0004 no se aplicó a la base original.

## Inventario remoto visible

Wrangler OAuth autenticó correctamente, pero en esa cuenta las lecturas devolvieron:

- D1: solo `sneakerhub-telegram-staging-db`, UUID `18ac228c-c142-45c7-b801-6ae0c6e1f8eb`.
- R2: solo `sneakerhub-telegram-staging-assets`.
- Worker `catalogo-lite-api`: no existe en esa cuenta.
- Pages: no hay proyectos listados.

Conclusión acotada: los 19 productos están en la D1 local de este checkout; no se encontró una copia remota en la cuenta consultada. Para identificar la tienda pública se necesita acceso a la cuenta Cloudflare correcta o su URL pública/configuración de Pages. No se debe conectar el bot a `sneakerhub-telegram-staging-db` para atender clientes reales.

## Backup local verificado

`.tmp/sneakerhub-prod-connection-audit-20261102/` contiene copia del SQLite original, R2 local, metadatos Wrangler y las imágenes de semilla. El manifiesto SHA-256 verifica 56 archivos: D1, siete blobs R2, archivos de metadatos y 42 imágenes. Una segunda comprobación confirmó que los 56 originales todavía coinciden con la copia. La copia no se subió ni se agregó a Git. Mantenerla privada porque el SQLite contiene pedidos y datos de clientes.

## Cierre de pruebas reales de staging

- `/ayuda`, consulta de precio, consultas de inventario y `/cancelar` respondieron por Telegram. Se confirmó el precio ficticio de 100000 a 101000 COP, con una auditoría; repetir `SÍ` se rechazó. La propuesta 102000 COP se canceló antes de confirmar y no cambió el precio.
- Una nota de voz inicialmente omitió la talla; esa propuesta se canceló sin ejecutarla. La validación ahora exige variante y extrae una talla solo si la transcripción contiene exactamente una forma explícita `talla N`. Una voz posterior propuso y aplicó solo talla 38 de 5 a 6; talla 39 se mantuvo en 1. La operación tiene una auditoría; repetir la confirmación fue rechazado.
- Prueba de usuario desconocido: un payload sintético con ID distinto al propietario llegó al HTTPS staging y recibió 403. No hubo respuesta del bot ni cambio de catálogo. No se probó desde una segunda cuenta real de Telegram.
- Replay de webhook: se envió dos veces el mismo payload HTTPS de `/ayuda`; primer intento aceptado, segundo devuelto como duplicado, y D1 conserva una sola fila de `processed_updates`. Esta prueba simula el replay en el endpoint; no fue una retransmisión originada por Telegram.
- Error Gemini real: se desplegó temporalmente un nombre de modelo inexistente solo en staging, la consulta recibió el error sanitizado “modelo no disponible”, se restauró el modelo y una consulta posterior respondió. Precio, stock, operaciones y auditoría permanecieron iguales durante el error.
- Estado final ficticio D1 staging: `TEST-TRN-001` price 101000 COP; talla 38 stock 6; talla 39 stock 1; 4 operaciones aplicadas, 3 canceladas, 4 auditorías, 0 abiertas.
- Última consulta `getWebhookInfo`: URL continúa en staging, 0 pendientes. Telegram conserva como último error histórico `Connection reset by peer` fechado 2026-11-02 15:40 UTC; mensajes posteriores del dueño recibieron respuesta.
- Verificación local de código: Worker 70/70, TypeScript aprobado. Frontend no se modificó en esta fase; su último resultado reportado sigue 52/52 y build aprobado.

## Operaciones del bot

Permitidas en staging y en la implementación actual:

- Consultas de catálogo/inventario y los comandos de lectura soportados.
- `update_stock` y `update_price`: validación de esquema, vista anterior/propuesta, vencimiento, confirmación explícita del dueño, comparación del estado actual, reclamo condicional, modificación, auditoría y finalización en un único `D1.batch`.
- Confirmaciones duplicadas se rechazan; `/cancelar` solo cancela una propuesta pendiente. No revierte un cambio ya aplicado.

No habilitar todavía creación/borrado de productos, cambios de configuración, fotos ni otras mutaciones: no pasan por el mismo flujo transaccional de propuesta, confirmación y auditoría.

## Controles previos a producción

- Login administrativo: el endpoint valida credenciales y falla cerrado si faltan secretos, pero el código revisado no limita intentos fallidos. Añadir rate limiting persistente o una regla equivalente antes de exponer producción; no confiar en `X-Forwarded-For` arbitrario.
- CORS: el Worker permite localhost por defecto y toma orígenes adicionales de `ALLOWED_ORIGIN`. Falta conocer el dominio real de Pages y definir una allowlist exacta; no usar `*`.
- Secretos: mantener `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `TELEGRAM_WEBHOOK_SECRET` de producción separados de staging. `TELEGRAM_OWNER_ID` debe seguir siendo el ID numérico confirmado. No poner secretos en `[vars]`.
- Fotos: validar MIME/firma y tamaño, copiar cada objeto al R2 final preservando clave/metadatos y verificar hashes/lecturas HTTP. Mantener las imágenes estáticas referenciadas por la SPA junto al despliegue del frontend.

## Plan seguro para usar los 19 productos

1. Confirmar la cuenta Cloudflare que sirve la tienda y registrar la URL pública, el origen de Pages, Worker real y bindings D1/R2 actuales. No continuar si esos recursos no se pueden identificar.
2. Acordar recursos destino exclusivos de producción y obtener aprobación separada antes de crearlos. No reutilizar D1/R2 de staging.
3. Crear backup nuevo de la fuente y, si existe una D1 remota previa, exportarla con `wrangler d1 export ... --remote --output <ruta-privada.sql>`. Inventariar R2 y calcular hashes antes de importar. Guardar los artefactos en ubicación privada excluida de Git.
4. Preparar una D1 candidata aislada. Aplicar y validar allí `0001`–`0004`; no aplicar migraciones a la SQLite original. Importar de forma ordenada categorías, productos, variantes, configuración necesaria, pedidos e historial de auditoría, preservando IDs y claves foráneas. No migrar sesiones JWT activas ni operaciones pendientes de Telegram.
5. Comparar antes/después los conteos de productos, variantes, categorías, pedidos, configuración y auditoría; verificar unicidad SKU, integridad de variantes, precios/stock, estado de pedidos y hashes de cada foto. No importar datos de clientes a staging.
6. Subir el R2 local preservando las claves `products/` y `store/`; revisar la ruta `/api/assets`. Confirmar que las 18 referencias a `/seed-images/sneakerhub/` se incluyan en Pages. Probar una muestra de cada tipo de imagen y luego todas las referencias.
7. Añadir antes del despliegue el limitador de login, definir `ALLOWED_ORIGIN` con el origen exacto y revisar secretos/bindings. El Worker final debe usar únicamente la D1/R2 aprobadas.
8. Hacer una publicación supervisada del Worker candidato y smoke tests de health, CORS desde el origen exacto, login inválido/limitado, catálogo, fotos y acceso admin. Comparar otra vez conteos y hashes. Aún no se cambia el webhook.
9. Después de aprobación separada para cutover, verificar `getMe`/`getWebhookInfo`, URL HTTPS, secreto y bindings; conservar `drop_pending_updates=false`, cambiar el webhook una sola vez y comprobar entrega. No ejecutar `deleteWebhook` ni descartar actualizaciones.

## Reversión prevista

- Mantener intactos los datos/fotos de origen y los backups; no restaurar snapshots sobre la base original.
- Si falla el smoke test antes del cutover, volver a la versión Worker candidata anterior y conservar D1/R2 nuevas para diagnóstico.
- Si falla después del cutover, volver el webhook a la URL de staging mediante `setWebhook` con el secreto staging y sin descartar pendientes, o al endpoint previamente verificado cuando se conozca. Verificar `getWebhookInfo` y entregas.
- No importar cambios desde la D1 nueva de vuelta a la original automáticamente. Cualquier reversión de pedidos, stock o cambios confirmados requiere comparación y autorización específica.

### Comandos de preparación (plantilla; no ejecutados)

No usar hasta verificar la cuenta correcta, acordar nombres e IDs y recibir autorización para recursos remotos. Sustituir los marcadores; nunca pegar secretos en la terminal:

```powershell
# Exportar solo datos de la D1 local a un archivo privado ignorado por Git.
npx wrangler d1 export catalogo-lite-db --local --config .\worker\wrangler.toml --no-schema `
  --table categories --table products --table product_variants --table store_config --table orders --table audit_log `
  --output .\.tmp\sneakerhub-production-data.sql

# Solo después de aprobar y confirmar cuenta/nombres:
npx wrangler d1 create <PRODUCTION_D1_NAME>
npx wrangler r2 bucket create <PRODUCTION_R2_BUCKET>

# Después de crear los recursos y escribir la configuración privada con el UUID correcto:
npx wrangler d1 migrations apply <PRODUCTION_D1_NAME> --remote --config .\worker\wrangler.production.toml
npx wrangler d1 execute <PRODUCTION_D1_NAME> --remote --file .\.tmp\sneakerhub-production-data.sql --config .\worker\wrangler.production.toml
npx wrangler d1 export <PRODUCTION_D1_NAME> --remote --output .\.tmp\sneakerhub-production-after.sql --config .\worker\wrangler.production.toml

# Transferir cada objeto R2 después de inventariar sus claves y hashes:
npx wrangler r2 object put <PRODUCTION_R2_BUCKET>/<OBJECT_KEY> --file <LOCAL_FILE> --content-type <MIME_TYPE>
```

Validar export/import primero en una D1 candidata vacía; no ejecutar directamente contra producción. La configuración `worker/wrangler.toml` actual contiene un ID placeholder, por lo que no sirve como configuración remota.

## Límites actuales de la auditoría

- La cuenta OAuth consultada no muestra recursos de producción. La existencia de recursos en otras cuentas o proveedores no queda verificada.
- No se identificó el dominio público ni la configuración real de `VITE_API_URL`/Pages en este checkout.
- Rate limiting de login y una prueba desde una segunda cuenta real de Telegram siguen pendientes. El replay duplicado se ensayó enviando dos veces el mismo payload al HTTPS staging; no fue una retransmisión originada por Telegram. El fallo Gemini sí se indujo por Telegram y se restauró correctamente.
