# Despliegue en Cloudflare — Catálogo Digital Lite

## Arquitectura de producción

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Cloudflare      │     │  Cloudflare       │     │  Cloudflare  │
│  Pages           │────▶│  Workers          │────▶│  D1 + R2     │
│  (Frontend SPA)  │     │  (API REST + Bot) │     │  (DB +_imgs) │
└─────────────────┘     └──────────────────┘     └─────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │  Telegram API │
                        │  Gemini AI    │
                        └──────────────┘
```

**Costo estimado:** $0/mes dentro del plan gratuito de Cloudflare.

## Prerrequisitos

1. Cuenta en [Cloudflare](https://dash.cloudflare.com/sign-up) (plan gratuito)
2. Wrangler CLI instalado y autenticado:
   ```powershell
   npm install -g wrangler
   wrangler login
   ```
3. Node.js 20+

## Paso 1: Crear recursos en Cloudflare

### Base de datos D1

```powershell
wrangler d1 create catalogo-lite-db
```

Copia el `database_id` que aparece en la salida. Actualízalo en `worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "catalogo-lite-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # ← Reemplazar
```

### Bucket R2 (imágenes)

```powershell
wrangler r2 bucket create catalogo-lite-assets
```

### Proyecto Pages (frontend)

```powershell
cd frontend
npx wrangler pages project create catalogo-lite --production-branch=main
```

## Paso 2: Configurar secrets

En el Dashboard de Cloudflare → Workers → `catalogo-lite-api` → Settings → Variables and Secrets:

| Variable | Descripción | Ejemplo |
|---|---|---|
| `ADMIN_EMAIL` | Email del administrador | `admin@mitienda.com` |
| `ADMIN_PASSWORD` | Contraseña del admin | `(generar contraseña segura)` |
| `JWT_SECRET` | Clave para firmar tokens JWT | `(generar con `openssl rand -hex 32`)` |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram | `(obtener de @BotFather)` |
| `TELEGRAM_WEBHOOK_SECRET` | Secret para validar webhooks | `(generar aleatorio)` |
| `TELEGRAM_OWNER_ID` | Chat ID del dueño de la tienda | `(obtener tras vincular)` |
| `GEMINI_API_KEY` | API key de Google Gemini | `(obtener en AI Studio)` |
| `GEMINI_MODEL` | Modelo de Gemini (opcional) | `gemini-2.0-flash` |

O desde CLI:

```powershell
cd worker
wrangler secret put ADMIN_EMAIL
wrangler secret put ADMIN_PASSWORD
wrangler secret put JWT_SECRET
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put GEMINI_API_KEY
```

## Paso 3: Desplegar

### Opción A: Script automático

```powershell
cd "D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite"
.\scripts\deploy.ps1
```

### Opción B: Manual

```powershell
# Backend
cd worker
wrangler d1 execute catalogo-lite-db --remote --file=..\database\migrations\0001_initial.sql
wrangler deploy

# Frontend
cd ..\frontend
npm run build
npx wrangler pages deploy dist --project-name=catalogo-lite --branch=main
```

## Paso 4: Configurar webhook de Telegram

Después de desplegar el Worker, configura el webhook:

```powershell
curl https://catalogo-lite-api.tu-subdominio.workers.dev/api/telegram/setup
```

Respuesta esperada:
```json
{"success":true,"webhook_url":"https://...","telegram_response":{"ok":true}}
```

## Paso 5: Vincular cuenta de Telegram

1. Inicia sesión en el panel admin de tu tienda desplegada
2. Ve a **Configuración → Telegram**
3. Genera un código de vinculación
4. En Telegram, envía al bot: `/link <código>`
5. Recibirás confirmación: "✅ Cuenta de Telegram vinculada correctamente"

A partir de ese momento, solo tú podrás usar los comandos del bot.

## Paso 6: Verificar

1. Abre la URL de Cloudflare Pages → la tienda debe cargar
2. Ve a `/admin` → inicia sesión con las credenciales configuradas
3. Crea un producto de prueba → verifica que aparezca en la tienda pública
4. Envía `/stats` al bot de Telegram → debe responder con estadísticas reales

## Dominio personalizado (opcional)

En Cloudflare Pages → Custom domains → Agregar tu dominio.

Para el Worker, agrega una ruta personalizada en `wrangler.toml`:

```toml
routes = [
  { pattern = "api.mitienda.com", zone_name = "mitienda.com" }
]
```

Luego actualiza `VITE_API_URL` en las variables de entorno de Pages:

```
VITE_API_URL=https://api.mitienda.com
```

## Actualizaciones futuras

```powershell
# Actualizar backend
cd worker && wrangler deploy

# Actualizar frontend
cd frontend && npm run build && npx wrangler pages deploy dist --project-name=catalogo-lite
```

## Monitoreo

- **Logs del Worker:** Cloudflare Dashboard → Workers → `catalogo-lite-api` → Logs
- **Analíticas de Pages:** Cloudflare Dashboard → Pages → `catalogo-lite` → Analytics
- **Errores de Telegram:** Se registran en los logs del Worker; el bot siempre responde 200 para evitar reintentos infinitos

## Rollback

Si algo sale mal:

```powershell
# Rollback del Worker a versión anterior
wrangler rollback

# Rollback de Pages: redeploy commit anterior
npx wrangler pages deploy dist --project-name=catalogo-lite --commit-hash=<hash-anterior>
```