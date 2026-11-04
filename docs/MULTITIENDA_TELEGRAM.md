# Varias tiendas desde una misma cuenta de Telegram

Un mismo usuario de Telegram (identificado **solo por su ID numérico**) puede ser propietario o administrador de varias tiendas y trabajar con ellas en el mismo asistente (`@SneakerHubAdmin_bot` en producción, `@SneakerHubPruebas_bot` en staging). No se crean bots por tienda. El bot maestro sigue administrando la plataforma.

## 1. Diagnóstico del caso “Muy Parcero” (2026-11-04, solo lectura en producción)

| Comprobación | Resultado |
|---|---|
| SneakerHub (tienda 1) | Sin membresías: el asistente te reconoce como dueño por el ID heredado `TELEGRAM_OWNER_ID` del Worker. |
| Muy Parcero (tienda 3) | Tiene un propietario (cuenta creada por el bot maestro con el correo indicado), **sin ID de Telegram vinculado**. |
| Enlace de vinculación de Muy Parcero | 1 código de un solo uso **vigente y sin usar**. |
| Cuentas con tu ID numérico | Ninguna en `platform_users`; la sesión del asistente apunta a la tienda 1. |
| Gemini / valores fijos | Gemini recibe la tienda desde el servidor (`ctx.store`); no hay otro `store_id` de SneakerHub fijado. |

**Causa: vinculación incompleta.** Al crear Muy Parcero no se indicó tu ID de Telegram como propietario; se generó un código de vinculación que no se usó. Para el asistente solo existía una tienda autorizada (SneakerHub), así que la eligió automáticamente sin mostrar selector.

## 2. Cómo vincular Muy Parcero (no requiere desplegar nada)

Funciona con la versión que ya está en producción:

1. En `@CatalogoDigitalMaestro_bot`, busca el mensaje “🎉 ¡Tienda creada!” de **Muy Parcero** y toca el enlace de acceso al asistente (abre `@SneakerHubAdmin_bot` con `/start link_…`).
   - Si prefieres, copia el código de ese mensaje y envíale a `@SneakerHubAdmin_bot`: `/link CODIGO`.
2. El asistente responde “Tu Telegram quedó vinculado a Muy Parcero”.
3. Escribe `/tiendas`: verás SneakerHub Premium y Muy Parcero.

Si ya no tienes el mensaje o el código venció (vale 72 horas): en el bot maestro abre la tienda Muy Parcero → **🔑 Nuevos accesos**. Genera un código nuevo y el anterior deja de servir. Luego repite los pasos 1–3.

No se vincula nada por nombre de usuario ni por correo: solo con el código de un solo uso abierto desde tu propia cuenta.

## 3. Cambios implementados (staging; producción pendiente de autorización)

- **`/tiendas` y `/cambiar_tienda`** (también `/tienda` y el botón “🔄 Cambiar de tienda”): la lista sale de las membresías activas de la base de datos. La tienda actual aparece marcada con ✅. Con una sola tienda se usa automáticamente y se explica cómo vincular otra.
- **⚙️ Administrar accesos:** explica la vinculación con `/link` o el enlace de un solo uso.
- **Tienda actual siempre visible:** el menú principal muestra “🏪 Tienda actual: …”. Con varias tiendas, todos los mensajes la indican.
- **Al elegir otra tienda:**
  - Se valida la membresía; una tienda sin acceso responde “No tienes acceso a esa tienda”.
  - Se guarda la tienda activa por cuenta y se limpia el contexto de conversación.
  - Se **cancelan los cambios y borradores pendientes** de la tienda anterior.
  - Se registra `telegram_store_switched` en la auditoría.
  - Respuesta: “¡Perfecto! Ahora estás administrando …” con los botones ➕ Agregar producto, 📦 Inventario, 🛒 Pedidos, 🎨 Mi tienda, 🔄 Cambiar tienda y ✨ Asistente IA.
- **Botones atados a su tienda:** paletas (`pal:<tienda>:…`), plantillas (`tpl:<tienda>:…`), onboarding (`ob:<tienda>:…`) y confirmaciones solo actúan sobre su propia tienda. Un botón viejo de otra tienda responde “Ese botón pertenece a otra tienda y no lo apliqué”.
- **Gemini:** recibe solo los datos de la tienda activa. Un SKU se busca solo dentro de esa tienda; si no existe, se indica sin tocar otras tiendas.
- **Vincular una tienda adicional:** si tu Telegram ya tiene una cuenta y usas el código de otra tienda, se **agrega una membresía** a tu cuenta con el rol de ese acceso. No se crea una cuenta duplicada ni cambian tus otras tiendas. Nunca se modifica una membresía existente (no se puede rebajar a un propietario).
- **Bot maestro:** al crear una tienda con el ID de Telegram de alguien que ya tiene cuenta, se reutiliza esa cuenta y se agrega la membresía. Si el correo indicado pertenece a otra cuenta, se detiene para no mezclar personas. El asistente le avisa “Tienes una nueva tienda disponible” sin cambiar su tienda activa.
- **Grupos:** el asistente no responde datos administrativos fuera de chats privados.

## 4. Pruebas

- `worker/src/services/assistant/multistore.test.ts` cubre:
  1. Una tienda.
  2. Dos tiendas.
  3. Cambio entre tiendas.
  4. Persistencia de la tienda activa.
  5. Gemini tras un cambio de tienda.
  6. Mismo SKU en dos tiendas.
  7. Pendientes al cambiar de tienda.
  8. Usuario sin permisos.
  9. Revocación de acceso.
  10. Tienda adicional por código y por el bot maestro.
  11. Conservación de SneakerHub (dueño heredado).
  12. Aislamiento de botones.

  También cubre los chats de grupo.
- Worker: **215/215** y `tsc` OK.
- **Staging (escritura, 2026-11-04):** Worker `40ab6cd4-7796-4ab9-9200-4abf51a13075`. Prueba 16/16 con dos tiendas ficticias del mismo usuario ficticio:
  - Una sola cuenta con dos membresías.
  - Selector sin tienda elegida al inicio.
  - Cambio A → B.
  - Pendiente de A cancelado.
  - Confirmación vieja y botón de A sin efecto.
  - Auditoría del cambio.
  - Tienda principal no seleccionable sin membresía.
  - Tiendas eliminadas y tienda principal idéntica.

## 5. Publicación en producción (pendiente de autorización)

Solo cambia el Worker; no hay migración ni cambios de frontend.

```powershell
cd worker
npx wrangler deploy --config wrangler.production.toml
```

Reversión: `npx wrangler rollback ac6acb57-4ee2-4174-8705-bff90877cf99 --config wrangler.production.toml` (no bajar de `f9928a44`).

El paso 2 (vincular Muy Parcero) puede hacerse antes o después de publicar.
