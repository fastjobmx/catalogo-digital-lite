# Crear una nueva tienda (plantilla reutilizable)

Cada instalación de Catálogo Digital Lite es **independiente**: su propio dominio, base de datos D1, bucket R2, Worker, bot de Telegram y clave de IA. Esta guía describe cómo crear una segunda tienda a partir de la plantilla.

## Requisitos

- Node.js 20+ y `wrangler` (se instala con las dependencias del `worker`).
- Cuenta de Cloudflare con D1 y R2 habilitados.
- `wrangler login` hecho en tu máquina.

## Paso 1: Duplicar el proyecto

```powershell
Copy-Item "D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite" `
          "D:\LANDING 4000\CATALOGO DIGITAL\mi-nueva-tienda" -Recurse
cd "D:\LANDING 4000\CATALOGO DIGITAL\mi-nueva-tienda"
```

Elimina artefactos locales que no deben copiarse:

```powershell
Remove-Item -Recurse -Force .\worker\.wrangler -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .\frontend\dist, .\frontend\node_modules, .\worker\node_modules -ErrorAction SilentlyContinue
```

## Paso 2: Renombrar recursos en `worker/wrangler.toml`

Cambia los nombres de la base de datos y del bucket por unos **únicos** para la nueva tienda:

```toml
name = "mi-nueva-tienda-worker"

[[d1_databases]]
binding = "DB"
database_name = "mi-nueva-tienda-db"
database_id = "REEMPLAZAR_CON_EL_ID_REAL"

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "mi-nueva-tienda-assets"
```

## Paso 3: Crear los recursos en Cloudflare

```powershell
cd worker
npx wrangler d1 create mi-nueva-tienda-db       # copia el database_id a wrangler.toml
npx wrangler r2 bucket create mi-nueva-tienda-assets
```

Aplica el esquema y (opcionalmente) los datos demo a la base **remota**:

```powershell
npx wrangler d1 execute mi-nueva-tienda-db --remote --file=../database/migrations/0001_initial.sql
npx wrangler d1 execute mi-nueva-tienda-db --remote --file=../database/migrations/0002_agent.sql
npx wrangler d1 execute mi-nueva-tienda-db --remote --file=../database/seeds/demo-store.sql
```

> Para una tienda real, **omite** el seed demo y carga los productos del comerciante desde el panel o por Telegram.

## Paso 4: Configurar los secrets

```powershell
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put JWT_SECRET
# Opcionales:
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_OWNER_ID
npx wrangler secret put GEMINI_API_KEY
```

`JWT_SECRET` debe ser distinto en cada instalación (mínimo 32 caracteres).

## Paso 5: Ajustar la identidad de la tienda

Edita los valores por defecto en el seed (`database/seeds/demo-store.sql`) o directamente desde el panel una vez desplegado. También puedes ajustar los `vars` de `wrangler.toml`:

```toml
[vars]
ENVIRONMENT = "production"
STORE_NAME = "Mi Nueva Tienda"
STORE_CURRENCY = "COP"
STORE_COUNTRY = "CO"
```

## Paso 6: Desplegar

```powershell
# Worker
cd worker
npx wrangler deploy

# Frontend (Pages)
cd ..\frontend
npm install
npm run build
npx wrangler pages deploy dist --project-name=mi-nueva-tienda
```

O usa el script incluido:

```powershell
.\scripts\deploy.ps1
```

## Paso 7: Conectar la tienda con su Worker

En Cloudflare Pages, define la variable de entorno del frontend:

```
VITE_API_URL=https://mi-nueva-tienda-worker.tu-subdominio.workers.dev
```

Vuelve a desplegar Pages para que el build la tome.

## Paso 8: Primeras tareas del comerciante

1. Entrar a `https://<tu-pages>/admin` e iniciar sesión.
2. Cambiar nombre, colores, contacto, horarios y redes en **/admin/settings**.
3. Crear categorías y productos (con variantes de talla/color).
4. Configurar y vincular Telegram (ver `CONFIGURAR_TELEGRAM.md`).

## Checklist de independencia

- [ ] Nombre de Worker único.
- [ ] D1 con `database_name` y `database_id` propios.
- [ ] Bucket R2 propio.
- [ ] `JWT_SECRET` propio.
- [ ] Bot de Telegram propio (o sin bot).
- [ ] `VITE_API_URL` apuntando al Worker correcto.
- [ ] Sin reutilizar secretos de otra instalación.
