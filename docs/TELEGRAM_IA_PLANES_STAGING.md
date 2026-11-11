# Staging completo: sincronización de migraciones y Worker de pruebas

Solo STAGING. Producción (`catalogo-lite-api`, `catalogo-lite-production-db`, bots reales, landing, MOSTRALO PUES!) no se tocó. Sin push ni merge.

## 1. Verificación previa

| Comprobación | Resultado |
|---|---|
| D1 de staging | `sneakerhub-telegram-staging-db`, ID `18ac228c-c142-45c7-b801-6ae0c6e1f8eb` |
| D1 de producción | `catalogo-lite-production-db`, ID `10b10054-9e28-4346-8b2b-a19323ed27f3` (distinto) |
| Bindings del Worker de staging (`wrangler deploy --dry-run`) | `DB` = staging-db, `ASSETS` = bucket `sneakerhub-telegram-staging-assets`; sin service bindings. Producción usa `catalogo-lite-production-assets` |
| Bot de Telegram del Worker de staging | `getMe`/`getWebhookInfo` (solo lectura, sin leer secretos): `@SneakerHubPruebas_bot` (id 9169852191), webhook a la URL de staging, 0 pendientes, sin errores. El asistente de producción es otro bot (`@SneakerHubAdmin_bot`, id 9019695525) |
| Secretos de staging | Existen entradas propias: `ADMIN_*`, `GEMINI_API_KEY`, `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_ID`, `TELEGRAM_WEBHOOK_SECRET`. **Limitación:** no se pueden leer los valores, así que no se demuestra que `GEMINI_API_KEY` sea distinta de la de producción |
| Pruebas escribiendo en staging | Ningún proceso `vitest`/`wrangler` del proyecto activo |
| Copia de seguridad | Exportación SQL de 217.050 bytes, SHA-256 `3b63d1b02ccbc42cf81e9469e6b842ac95d675bf20f7bb3fca58f36e274ec119`, cargada y verificada (integridad `ok`, 57 tablas, 678 filas, 0 violaciones de relaciones) |
| Bookmark Time Travel | `00000388-00000000-00005120-cbcc889f16ab665d52bca89533711c27` (previo) y `00000389-00000000-00005120-40657ecd4410b53be2de0f33bbc9b1e3` (justo antes de aplicar 0017) |
| Estado previo | 57 tablas; `d1_migrations` con 13 filas (0001-0013); esquema con 0014, 0015, 0016 y 0023 ya aplicadas a mano |

## 2. Sincronización de migraciones

**Historial real de Wrangler:** tabla `d1_migrations(id INTEGER PK AUTOINCREMENT, name TEXT UNIQUE, applied_at)` con el nombre de archivo (`0013_catalog_trials.sql`).

**Reconciliación probada primero en una copia local** (verificador que calcula, con SQL real aplicado desde cero, los objetos que introduce cada migración y comprueba si existen):

| Migración | Estado físico antes | Acción |
|---|---|---|
| 0001-0013 | Registradas y completas | Ninguna |
| 0014, 0015, 0016, 0023 | Completas pero sin registrar | Solo registrar |
| 0017-0022 | Ausentes (0 objetos) | Aplicar y registrar |

Ninguna migración estaba parcial. Ensayo local: esquema e índices idénticos al esperado, 0 violaciones, datos previos intactos (comparación fila por fila de las columnas originales), registro igual a la lista de archivos y sin duplicados.

**Ejecución en el D1 de staging:** `0017` a `0022` por archivo (`wrangler d1 execute --file`), verificación con una exportación nueva (todas las migraciones completas, 66 tablas, esquema e índices iguales a lo esperado) y solo entonces un único `INSERT` con 10 nombres (0014 a 0023).

| Verificación final | Resultado |
|---|---|
| `wrangler d1 migrations list` | **«No migrations to apply!»** |
| `d1_migrations` | 23 filas, 23 nombres distintos (0001-0023) |
| Tablas | 57 → 66; integridad `ok`; `foreign_key_check` 0 |
| Datos previos | Sin cambios; diferencias esperadas: `d1_migrations` +10, `platform_operations` +1 y `platform_events` +1 (consulta de estado del bot) |
| Planes | basico, profesional, premium y legacy activos e iguales; emprendedor, negocio y mayorista inactivos |

## 3. Despliegue del Worker de staging

Versión anterior: **`2cc7fe68-a994-48b3-93ed-fd4b5fab3c16`** (6 nov). Código: commit `b34b100`.

| Versión | Configuración | Uso |
|---|---|---|
| `345b1faa-d6a3-4ccc-a4bc-743dac78f143` | `AI_MESSAGE_QUOTA_MODE=off`, intérprete y voz `false` | Humo y modo off |
| `9d587688-0a24-4a55-aac3-2cfd3d2bc1ab` | `shadow` | Pruebas HTTP con tiendas sintéticas |
| `d4439663-75f4-47ee-b4a7-69ff466d82a3` | `enforce` | Solo tiendas `qa-http-*` |
| **`2af7f1d2-f253-4520-928d-00dbdfabd7c4` (actual)** | **`shadow`, intérprete `true`, voz `true`** | Pruebas de Telegram con el bot exclusivo de pruebas |

Humo en modo off: `/api/health` 200, catálogo y tienda 200, webhook sin secreto 403, rutas de plataforma y de consumo sin token 401.

## 4. Pruebas HTTP reales en staging (tiendas sintéticas `qa-http-a` y `qa-http-b`, ya borradas)

| Prueba | Resultado |
|---|---|
| Consumo del comerciante, modo off | 200: `mode=off`, plan profesional, sin tope, 0 usados, ciclo calendario |
| Modo shadow, plan Emprendedor de prueba con 400 interacciones sembradas | `used=400`, `limit=500`, `remaining=100`, `percent=80`; fotos 40/50 y descripciones 10/200 |
| Cambio de ciclo (ancla día 15) | `used=0`, `cycle.source=store`; los 400 quedan en el ciclo anterior |
| Modo enforce | La API muestra `mode=enforce` y los mismos 400/500 |
| Permisos | Comerciante A sobre tienda B: 403; B sobre A: 403; sin token: 401; comerciante en `/api/platform/*` (consumo, costos, planes, detalle y PUT de configuración): 403; endpoint existente `ai-usage`: 200 |
| Planes nuevos inactivos | Confirmado en el D1 (3 filas con `is_active=0`, 0 tiendas) |

**No verificado por HTTP, por límites de acceso:**
- Rutas de **superadministrador** (`/api/platform/ai-messages`, `/ai-costs`, `/plans`): el superadministrador solo existe como secreto del Worker y no manejo contraseñas ni claves. Quedan comprobados el 401/403 de acceso y, por código, las pruebas locales y las 15 remotas contra el D1. Se preparó `scripts/staging-superadmin-check.mjs`, que ejecutas tú con tus credenciales en tu terminal.
- `/consumo` y los **consumos concurrentes con alertas 80/100 %**: pasan por el webhook de Telegram, protegido con un secreto que no tengo. Se validaron con las pruebas locales y las 15 remotas (8 solicitudes simultáneas con tope 3 dejan exactamente 3; alertas una sola vez). Falta escribir `/consumo` desde tu Telegram al bot de pruebas.

## 5. Telegram y voz

Bot exclusivo de pruebas: `@SneakerHubPruebas_bot`, con el Worker nuevo, `shadow` y el intérprete y la voz activos. **Estado: listo para que lo pruebes; no tengo cómo enviarle mensajes ni notas de voz.** Pruebas sugeridas: alta de producto con referencia, tallas y cantidades; precio «180»; Corregir; Confirmar; Cancelar; mensaje repetido; `/consumo`; y una **nota de voz humana**. La validación de audio humano **no se da por completada**. Las pruebas con voz sintética (automatizadas) siguen verdes.

## 6. Costos observados

Sin llamadas de IA en esta etapa: costo de IA = 0 (etapas previas: unos US$0,009 de voz sintética).

## 7. Reversión

1. **Worker (primero):** `npx wrangler rollback 2cc7fe68-a994-48b3-93ed-fd4b5fab3c16 -c wrangler.remote-staging.toml`. El código anterior ignora las columnas y tablas nuevas (todo es aditivo), así que funciona con el esquema actual.
2. **Apagado inmediato sin cambiar código:** redeploy con `AI_MESSAGE_QUOTA_MODE=off`, o con `TELEGRAM_SMART_INTERPRETER_ENABLED=false` / `TELEGRAM_VOICE_ENABLED=false`.
3. **Esquema:** solo si hiciera falta y tras revertir el Worker: `database/rollback/0023_ai_message_quota.down.sql` (y los `down` existentes de 0020-0022). 0017-0019 no tienen rollback escrito.
4. **Datos:** restauración desde la exportación o el bookmark de Time Travel **solo con autorización adicional** y evaluando antes qué datos posteriores se perderían (en staging, solo pruebas).

## 8. Bloqueos pendientes para producción

- Pruebas con tu Telegram: `/consumo`, flujo de productos, duplicados y nota de voz humana.
- Superadministrador por HTTP (`scripts/staging-superadmin-check.mjs`, con tus credenciales).
- Medición de costos reales (texto, imágenes) en `shadow` o con lectura agregada autorizada; confirmar presupuestos de referencia.
- Política de uso razonable de Negocio y Mayorista; decisión sobre aplicar las cuotas de fotos y descripciones.
- Confirmar que la `GEMINI_API_KEY` de staging no es la de producción (o aceptar compartirla).
- Autorización expresa para migrar y desplegar producción (migración 0023 primero, luego código, modo `off`).
