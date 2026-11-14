# Asistente WhatsApp — preparación para producción (2026-11-12)

**Veredicto: NO APTO PARA PRODUCCIÓN todavía.** El código y la base están listos para desplegarse **apagados**
(sin riesgo para los seis comercios), pero faltan requisitos de Meta, pruebas reales y la forma de que un
comercio real obtenga su código. Nada de lo de este documento se ejecutó en producción: sin push, merge,
migración, despliegue ni activación.

## 1. Qué pasó prueba real (staging, número temporal de Meta, 2026-11-12 01:57–02:08 UTC)

Fuente: `whatsapp_messages` y `audit_log` del D1 de staging. El contenido de los mensajes se borra al
procesarlos (por diseño), así que se clasifica por tipo y por auditoría.

| Función | Real | Evidencia / nota |
|---|---|---|
| Recepción con firma HMAC y número correcto | ✅ | POST 200, mensajes guardados; la muestra de «Probar» se descarta por número ajeno |
| Aviso a número no vinculado | ✅ | Entrante `ignored` + respuesta leída en 2 s |
| Vinculación con código | ✅ parcial | `whatsapp_linked`. El código se creó **directo en D1**, no desde el panel (ver §10) |
| Consultas de texto | ✅ | 9 textos procesados con respuesta |
| Confirmaciones con botones | ✅ | 6 respuestas interactivas; `update_price` confirmado (producto 1) |
| Foto | ✅ parcial | Imagen procesada → `category_created`. **No se creó producto** (flujo no terminado o cancelado) |
| Creación de producto | ❌ | Ningún producto nuevo en staging |
| Nota de voz | ❌ | Ningún audio recibido |
| CSV / documento | ❌ | Ningún documento recibido |
| Revocación / «desvincular» | ❌ | La identidad sigue activa |
| Cambio entre varias tiendas | ❌ | El usuario de prueba solo tiene una tienda |
| Telegram real con el motor nuevo | ❌ | No se probó el bot de Telegram de staging tras estos commits |

Todo lo demás (secuestro de cuenta, códigos vencidos, PDF hostil, etc.) está cubierto **solo con dobles de
prueba**: 50 pruebas de WhatsApp, suite completa 634 pasan / 17 omitidas.

## 2. Diferencias staging ↔ producción

| | Staging | Producción |
|---|---|---|
| Worker | `sneakerhub-telegram-staging` · `531d850f` (rama hasta `1a887ba`, subida por otra cuenta) | `catalogo-lite-api` · `56b1450b` = `c08c55d` |
| Código | rama = `c08c55d` + 5 commits (`e6ccce0`, `f98465c`, `c71956e`, `1a887ba`, `8ceb7f2`) + esta preparación | `c08c55d`; `/api/whatsapp/*` responde 404 |
| D1 | `sneakerhub-telegram-staging-db` (`18ac228c…`), 24 migraciones | `catalogo-lite-production-db` (`10b10054…`), 23 migraciones (hasta 0023) |
| R2 | `sneakerhub-telegram-staging-assets` | `catalogo-lite-production-assets` |
| `AI_MESSAGE_QUOTA_MODE` | `shadow` (por `--var`) | `shadow` (por `--var`; ahora también en `wrangler.production.toml`) |
| `GEMINI_MODEL` | `gemini-3.8-flash` | sin definir (usa el predeterminado del código) |
| Canal WhatsApp | **activo** (`true`), piloto `1`, número de prueba | no existe; queda `false` y piloto vacío en el toml |
| Secretos WhatsApp | ACCESS_TOKEN, APP_SECRET, VERIFY_TOKEN | ninguno |
| Otros secretos | sin RESEND ni MASTER_* | RESEND_*, MASTER_*, ADMIN_PASSWORD_HASH |

Rama y producción comparten historia lineal: `c08c55d` (producción) y `origin/main` están contenidos en la rama.
**Riesgo de despliegue:** el Worker de producción va por delante de `main`; desplegar esta rama mantiene todo lo
que hoy corre (Telegram IA con cuota en shadow, fotos en pedidos, estudio creativo).

## 3. Cambios del motor compartido que también recibe Telegram

1. `e6ccce0` — el contexto acepta un canal; sin canal es Telegram como antes (`say`, fotos, «escribiendo…», descargas).
2. `c71956e` — **cambia respuestas de Telegram**: el intérprete reconoce referencias sin la palabra «referencia»
   («Agrega tenis blancos AD223, tallas 38, 39 y 40, cinco de cada una») y decide con el catálogo: borrador si no
   existe, reposición si existe, pregunta si es ambiguo. Entiende «ciento ochenta mil», millones hablados,
   «a la 38», «de cada talla», docenas. Nada se guarda sin confirmar.
3. `1a887ba` — **cambia respuestas de Telegram**: «Jordan1» se pregunta si es referencia o nombre; «de cada talla»
   pregunta el color si hay varios y solo toca variantes activas.
4. `services/business.ts` — el origen de auditoría sale del actor (`whatsapp:` → `whatsapp`, todo lo demás
   `telegram`): para Telegram no cambia.
5. Cron cada 15 min: `maintainWhatsApp` limpia solo tablas `whatsapp_*`. **Exige 0024 aplicada antes del
   código**; si no, registra un error cada 15 min (no rompe las otras tareas).
6. Pendiente conocido: pedidos y guías creados desde WhatsApp quedan con origen `telegram` (restricción de
   esquema; requiere migración aparte).

## 4. Los seis comercios (línea base, solo lectura, 2026-11-12 02:12 UTC)

| Tienda | Estado | Plan | Productos | Miembros |
|---|---|---|---|---|
| 1 | active | legacy | 21 | 0 |
| 2 | active | premium | 0 | 1 |
| 3 | active | premium | 25 | 1 |
| 4 | active | profesional | 115 | 2 |
| 5 | active | premium | 7 | 1 |
| 6 | draft | basico | 0 | 1 |

0024 solo **crea** cuatro tablas `whatsapp_*`; no altera `stores`, `plans`, `store_memberships`, productos,
variantes ni pedidos. Con el canal en `false` ninguna ruta nueva actúa (webhook → 503 sin App Secret;
código → 503). Repetir esta consulta después de cada paso y compararla:

```sql
SELECT s.id, s.status, s.plan_code,
  (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id) AS productos,
  (SELECT COUNT(*) FROM store_memberships m WHERE m.store_id = s.id) AS miembros
FROM stores s ORDER BY s.id;
```

## 5. Respaldo y reversión

Antes de migrar (el mismo día, justo antes):

1. Copia: `npx wrangler d1 export catalogo-lite-production-db --remote -c wrangler.production.toml --output ../.tmp/production-0024/production-pre-0024-<hora>.sql`
2. Bookmark: `npx wrangler d1 time-travel info catalogo-lite-production-db -c wrangler.production.toml`
   (referencia de hoy: `00000491-00000000-00005121-ba073fae5f0f4491ec0e5cf0584a45d6`; tomar uno nuevo).
3. Retornos de código: `56b1450b` (actual), `ca3c5c23` (cuota off), `3c61c48a` (original).

Reversión, en orden y deteniéndose en el primer paso que baste:

1. **Apagar** (segundos): `WHATSAPP_ADMIN_BOT_ENABLED=false` → redesplegar con el toml, o
   `npx wrangler secret delete WHATSAPP_APP_SECRET -c wrangler.production.toml` (el webhook pasa a 503 de inmediato).
2. **Código anterior**: `npx wrangler rollback 56b1450b-ebfc-4337-86e5-e1f3cb0897dd -c wrangler.production.toml`
   (funciona con 0024 aplicada: es aditiva).
3. **Esquema** (solo con el canal apagado y nueva autorización): `database/rollback/0024_whatsapp_admin_bot.down.sql`
   y borrar la fila `0024_whatsapp_admin_bot.sql` de `d1_migrations` para poder reaplicarla.
4. No restaurar el bookmark sin evaluar los datos que se perderían (pedidos del día).

## 6. Migración 0024 — ensayo sobre copia de producción

Copia exportada 2026-11-12 02:13 UTC (959.486 bytes, sha256 `c9e86b50…`, en `.tmp/production-0024/`, fuera de Git).
`node scripts/verify-d1-migration.mjs .tmp/production-0024/production-pre-0024.sql --rollback`:

- Pendiente solo `0024_whatsapp_admin_bot.sql`; aplicada sin errores; `integrity=ok`, 0 violaciones de FK antes y después.
- Todas las tablas existentes con filas y hash idénticos (products 168, variants 704, orders 25, audit_log 413…).
- Reversión: datos idénticos al original.
- El script marca «FALLÓ» por dos comprobaciones heredadas de la fase 0007 que ya no aplican (exige que todo esté en
  la tienda 1 y que la reversión retire `stores`): no son defectos de 0024.

Comando para el día aprobado: `npx wrangler d1 migrations apply catalogo-lite-production-db --remote -c wrangler.production.toml`.

## 7–8. Canal apagado y piloto

- `wrangler.production.toml`: `WHATSAPP_ADMIN_BOT_ENABLED = "false"`, `WHATSAPP_PILOT_STORE_IDS = ""`,
  `AI_MESSAGE_QUOTA_MODE = "shadow"` (antes solo iba por `--var`; si se olvidaba, la cuota pasaba a `off`).
- **Corregido en código**: antes, piloto vacío = **todas** las tiendas. Ahora vacío = **ninguna**; `*` abre a
  todas y no debe usarse en producción. Prueba nueva: «sin lista de piloto ninguna tienda queda habilitada».
- Lista piloto propuesta: **una sola tienda**, elegida por el usuario con autorización escrita del comercio
  (candidatas por actividad: 4 *profesional* o 3 *premium*). Nunca la tienda 6 (draft) ni la 1 (legacy sin miembros).

## 9. Cuotas y costos

- Costos de Meta: solo en `whatsapp_messages` (categoría, facturable, costo estimado). No tocan los contadores de Telegram.
- Mensajes con IA desde WhatsApp: se registran en el **mismo** `ai_message_ledger` por tienda (clave `wa:…`,
  canal `telegram_text`/`telegram_voice`). Es decir, **comparten la cuota mensual del plan** con Telegram.
  En producción la cuota está en `shadow`: no bloquea a nadie. **Decisión pendiente**: cuota común por tienda
  (diseño actual) o separada. En staging no hubo filas nuevas en el ledger durante la prueba: no verificado en real.

## 10. Código de vinculación para cuentas reales

La API ya existe y es segura: `POST /api/whatsapp/link-code` exige sesión de usuario del comercio (no el
superadministrador), tienda en piloto y canal activo; código de un solo uso, 15 min, guardado como hash,
reemplaza los anteriores, 5 intentos fallidos por hora por número, auditado.
**Falta la pantalla**: el panel (`frontend/src/admin/pages/Settings.tsx`) solo tiene el botón de Telegram.
Bloqueo: agregar «Vincular WhatsApp» que llame a esa ruta y muestre el código y el enlace `wa.me`.
No generar códigos de comercios reales directo en D1.

## 11. Secretos

- Sin tokens de Meta en el repositorio ni en el historial (las coincidencias `EAA…` son imágenes base64 e IDs
  de archivos de Telegram). `.dev.vars*` están ignorados y no tienen claves de WhatsApp.
- Se borró el registro temporal de la escucha en vivo (tenía cabeceras de firma).
- Rotación obligatoria: ninguna por exposición. Pero **producción no debe reutilizar los secretos de staging**:
  token de usuario del sistema propio, `WHATSAPP_VERIFY_TOKEN` nuevo. El App Secret es por app: si producción usa la
  misma app que staging, lo comparten (decidir app separada o aceptar el riesgo).
- El token de staging, si es el temporal, vence en ~24 h.

## 12. Qué falta en Meta

1. Cuenta de WhatsApp Business empresarial `4258788981080562`: salir de «Revisión en curso» y verificar el negocio
   del portafolio `2052936289150996`.
2. Número colombiano **exclusivo** para el asistente, registrado en esa cuenta, con nombre visible aprobado.
   No el número de prueba (+1 555…), ni soporte, ni personal, ni el de un comercio.
3. Medio de pago en la cuenta empresarial (y tarifa oficial de Colombia cargada en `WHATSAPP_RATES_USD_MICROS`).
4. Token permanente de **usuario del sistema** con `whatsapp_business_messaging` y `whatsapp_business_management`.
5. App `1021175547699077` en modo **Live** (hoy «En desarrollo»): requisito para recibir mensajes de números reales.
6. Suscribir la app a la cuenta empresarial (`POST /4258788981080562/subscribed_apps`) y configurar el webhook de
   producción `https://<api de producción>/api/whatsapp/webhook` con campo `messages`. Una app tiene una sola URL de
   webhook: si es la misma app de staging, la URL deja de apuntar a staging (decidir app separada).

## 13. Despliegue progresivo (cada paso requiere aprobación específica)

| Paso | Acción | Verificación | Apagado |
|---|---|---|---|
| 0 | Merge a `main` sin push a producción; pruebas reales pendientes de §1 en staging, incluido Telegram de staging | 634 pruebas; lista §1 completa | — |
| 1 | Respaldo (§5) + `migrations apply` 0024 | Consulta §4 idéntica; 24 migraciones; 0 FK | down §5.3 |
| 2 | Desplegar con `wrangler.production.toml` (canal `false`, piloto vacío, shadow) | salud 200, catálogo, pedido de prueba por WhatsApp de compradores, panel, Telegram «hola»/consulta; `/api/whatsapp/webhook` POST → 503 | rollback `56b1450b` |
| 3 | Secretos de producción + webhook de Meta (canal aún `false`) | firma inválida → 401; válida → 200 `disabled` | borrar `WHATSAPP_APP_SECRET` |
| 4 | Piloto: `PILOT_STORE_IDS=<una tienda>` y `ENABLED=true`; código desde el panel | vincular, consultar, cambiar precio, foto, voz, desvincular; reporte de uso diario | `ENABLED=false` |
| 5 | Ampliar tienda por tienda | costos y cuota por tienda, errores | quitar la tienda de la lista |

## Bloqueos para pasar a APTO

1. Meta §12 (cuenta empresarial aprobada, número colombiano, pago, token de sistema, app Live, suscripción y webhook).
2. Pantalla «Vincular WhatsApp» en el panel (§10).
3. Pruebas reales faltantes (§1): creación de producto completa, voz, CSV, desvincular, y regresión del bot de Telegram de staging.
4. Decisiones: cuota común o separada (§9); app de Meta única o separada para producción (§11, §12.6); tienda piloto (§8).
5. Aprobación expresa para cada paso de §13.
