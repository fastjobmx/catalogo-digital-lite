# Instalación Local — Catálogo Digital Lite

## Requisitos previos

- **Node.js 20+** → [https://nodejs.org](https://nodejs.org)
- **Wrangler CLI** → `npm install -g wrangler`
- **PowerShell 5.1+** (Windows) o Bash (macOS/Linux)

## Instalación automática (Windows)

```powershell
cd "D:\LANDING 4000\CATALOGO DIGITAL\catalogo-lite"
.\scripts\setup.ps1
```

Este script:
1. Verifica Node.js y Wrangler
2. Instala dependencias del frontend y worker
3. Crea la base de datos D1 local
4. Aplica migraciones de esquema
5. Carga datos de demostración (SneakerHub Lite)
6. Genera `.env.local` con URL del backend

### Opciones del script

```powershell
.\scripts\setup.ps1 -Help          # Mostrar ayuda
.\scripts\setup.ps1 -Reset         # Reiniciar base de datos (pierde datos)
.\scripts\setup.ps1 -StoreName "Mi Tienda"  # Nombre personalizado
```

## Instalación manual

### 1. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Abre http://localhost:5173

### 2. Backend (Worker)

```powershell
cd worker
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

El Worker se ejecuta en http://localhost:8788 (configurado en `worker/wrangler.toml` → `[dev] port`).

### 3. Verificar conexión

```powershell
curl http://localhost:8788/api/health
# {"status":"ok","environment":"development","timestamp":"..."}
```

### 4. Reiniciar la base de datos (opcional)

```powershell
.\scripts\reset-db.ps1
```
Elimina el estado local de D1, reaplica las migraciones y recarga los datos demo de SneakerHub Lite.

## Credenciales de demo

El correo y la contraseña se configuran en `worker/.dev.vars` y no se incluyen
como valores de ejemplo en esta guía. Las instalaciones generadas reciben
credenciales aleatorias propias; conserva ese archivo fuera de Git. La tienda
debe tener un WhatsApp válido configurado antes de aceptar pedidos.

En producción, configura `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `JWT_SECRET` como
secrets del Worker, según [`CHECKLIST_PRODUCCION.md`](CHECKLIST_PRODUCCION.md).

## Estructura de archivos generados

```
catalogo-lite/
├── frontend/.env.local        # URL del backend (generado por setup.ps1)
├── worker/.wrangler/state/    # Base de datos D1 local
└── scripts/setup.ps1          # Script de instalación
```

## Solución de problemas

### Error: "Wrangler not found"
```powershell
npm install -g wrangler
wrangler login  # Autenticar con Cloudflare (opcional para modo local)
```

### Error: "Database already exists"
```powershell
.\scripts\setup.ps1 -Reset
```

### El frontend no conecta con el backend
En desarrollo, el frontend usa el **proxy de Vite** (`/api` → `http://localhost:8788`). Verifica que:

- `frontend/vite.config.ts` apunte al puerto `8788`.
- El Worker esté ejecutándose (`cd worker; npm run dev`).
- `frontend/.env.local` **no** sobrescriba la URL con un puerto incorrecto (en local, `VITE_API_URL` debe quedar vacío).

### TypeScript errors tras actualizar
```powershell
cd frontend && npm install && npx tsc --noEmit
cd worker && npm install && npx tsc --noEmit
```

## Siguiente paso

Una vez verificado el entorno local, consulta [DEPLOY_CLOUDFLARE.md](DEPLOY_CLOUDFLARE.md) para desplegar en producción.
