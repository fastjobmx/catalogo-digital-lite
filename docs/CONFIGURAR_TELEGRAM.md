# Configurar Telegram

El bot de Telegram permite administrar la tienda por chat (texto y voz), con acciones seguras y auditadas. Es **opcional**: sin bot, la tienda y el panel web funcionan igual.

## 1. Crear el bot

1. Abre Telegram y busca **@BotFather**.
2. Envía `/newbot` y sigue las instrucciones (nombre y usuario del bot).
3. BotFather devuelve un **token** con este formato:

   ```
   123456789:AAH...tu_token_aqui
   ```

4. Guarda el token. **Nunca** lo pongas en el frontend.

## 2. Configurar los secrets del Worker

En local (desarrollo), edita `worker/wrangler.toml` o usa `worker/.dev.vars`:

```
TELEGRAM_BOT_TOKEN=123456789:AAH...tu_token_aqui
TELEGRAM_WEBHOOK_SECRET=una_cadena_aleatoria_secreta
TELEGRAM_OWNER_ID=123456789
```

En producción:

```powershell
cd worker
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_OWNER_ID
```

- `TELEGRAM_OWNER_ID`: tu ID numérico de Telegram (puedes obtenerlo con @userinfobot). Solo ese usuario podrá administrar la tienda. Si se deja vacío, se usa el propietario vinculado en `store_config`.

## 3. Registrar el webhook

El Worker expone `GET /api/telegram/setup` (protegido con token admin) que llama a `setWebhook` de Telegram:

```powershell
# 1) Obtener token admin
$login = Invoke-RestMethod -Uri http://127.0.0.1:8788/api/admin/login -Method Post `
  -Body '{"email":"admin@example.com","password":"admin123"}' -ContentType 'application/json'

# 2) Registrar el webhook
Invoke-RestMethod -Uri http://127.0.0.1:8788/api/telegram/setup `
  -Headers @{ Authorization = "Bearer $($login.token)" }
```

En producción, la URL pública del Worker debe ser accesible por Telegram (HTTPS). Se puede fijar manualmente con `TELEGRAM_WEBHOOK_URL`.

Para eliminar el webhook:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8788/api/telegram/webhook -Method Delete
```

## 4. Vincular tu cuenta (un solo uso)

1. En el panel web entra a **/admin/settings** → sección **Telegram** → **Generar código**.
   (O llama a `POST /api/admin/telegram/link-code`; el código caduca en 10 minutos.)
2. En Telegram, abre tu bot y envía:

   ```
   /link ABC123
   ```

3. El bot confirma: *"Cuenta de Telegram vinculada correctamente."* A partir de ese momento el bot solo responde a ese usuario.

## 5. Comandos disponibles

| Comando | Descripción |
|---|---|
| `/start` | Mensaje de bienvenida |
| `/stats` | Productos activos, categorías, stock total, pedidos de hoy |
| `/productos` | Últimos 10 productos activos |
| `/categorias` | Categorías con número de productos |
| `/pedido` | Últimos 5 pedidos |
| `/ayuda` | Ayuda |

También se acepta **texto libre** y **notas de voz** (requieren `GEMINI_API_KEY`).

## 6. Operaciones seguras

- El intérprete local reconoce comandos como:

  > Agrega producto Reebok referencia RBK-2514 precio 189900 stock 20 desde 38 hasta 44

  El bot responde con un resumen y pide **SÍ** para confirmar o **NO** para cancelar. La operación pendiente caduca en 15 minutos.
- Si falta un dato (precio, stock, referencia), el bot **no lo inventa**: indica qué falta.
- Toda acción ejecutada se registra en `audit_log`.
- Las actualizaciones duplicadas de Telegram se descartan mediante `processed_updates`.

## 7. Verificación rápida

```powershell
# El webhook sin token de bot debe responder 503 (no está configurado)
curl.exe -i -X POST http://127.0.0.1:8788/api/telegram/webhook ^
  -H "Content-Type: application/json" ^
  -d "{\"update_id\":1,\"message\":{\"chat\":{\"id\":1},\"text\":\"hola\"}}"
```

Con el bot ya configurado, el mismo POST con un `update_id` nuevo debería devolver `{"ok":true}`.

## Notas

- Si no configuras Telegram, el panel web muestra el estado `linked: false` y puedes completar la configuración de la tienda desde **/admin/settings** o el **cuestionario guiado** (`/admin/onboarding`).
- El modo simulado del intérprete (sin Gemini) está claramente identificado: las respuestas sin credenciales indican `SIMULADO local / PENDIENTE DE CREDENCIALES`.
