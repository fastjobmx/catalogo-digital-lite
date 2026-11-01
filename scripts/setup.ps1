# ============================================
# Catalogo Digital Lite - Script de Instalacion
# ============================================
# Configura el entorno local de desarrollo: instala dependencias,
# prepara la base de datos D1 local (migraciones + datos demo)
# y crea el archivo .env.local del frontend.
#
# Uso:
#   .\setup.ps1                    # Instalar / reparar entorno
#   .\setup.ps1 -Reset             # Reiniciar base de datos local
#   .\setup.ps1 -StoreName "Tienda" # (reservado) nombre de la tienda
#   .\setup.ps1 -Help              # Mostrar ayuda

param(
    [switch]$Help,
    [switch]$Reset,
    [string]$StoreName = ""
)

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $rootDir "frontend"
$workerDir = Join-Path $rootDir "worker"
$dbStateDir = Join-Path $workerDir ".wrangler\state\v3\d1"

if ($Help) {
    Write-Host @"

Catalogo Digital Lite - Setup

Uso:
  .\setup.ps1                    # Configurar entorno de desarrollo
  .\setup.ps1 -Reset             # Reiniciar base de datos (pierde datos)
  .\setup.ps1 -StoreName "Tienda"# Reservado para nombre personalizado
  .\setup.ps1 -Help              # Mostrar esta ayuda

Este script:
  - Verifica Node.js y Wrangler
  - Instala dependencias del frontend y del worker
  - Prepara la base de datos D1 local
  - Aplica migraciones de esquema
  - Carga datos de demostracion (SneakerHub Lite)

"@ -ForegroundColor Cyan
    exit 0
}

Write-Host "`n== Configurando Catalogo Digital Lite ==" -ForegroundColor Cyan

# --- Verificar Node.js ---
try {
    $nodeVersion = (node --version) 2>&1
    Write-Host "  OK: Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Node.js no encontrado. Instala desde https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# --- Verificar Wrangler ---
Push-Location $workerDir
$wranglerOk = $false
try {
    $wranglerVersion = (npx wrangler --version) 2>&1
    Write-Host "  OK: Wrangler $wranglerVersion" -ForegroundColor Green
    $wranglerOk = $true
} catch {
    Write-Host "  AVISO: Wrangler no disponible via npx. Se instalara como dependencia." -ForegroundColor Yellow
}
Pop-Location

# --- Instalar dependencias ---
Write-Host "`n[1/3] Instalando dependencias del frontend..." -ForegroundColor Cyan
Push-Location $frontendDir
npm install
Pop-Location

Write-Host "`n[2/3] Instalando dependencias del worker..." -ForegroundColor Cyan
Push-Location $workerDir
npm install
Pop-Location

# --- Base de datos local ---
Write-Host "`n[3/3] Preparando base de datos D1 local..." -ForegroundColor Cyan

if ($Reset) {
    Write-Host "  AVISO: Reiniciando base de datos local (se pierden datos)..." -ForegroundColor Yellow
    if (Test-Path $dbStateDir) {
        Remove-Item -Recurse -Force $dbStateDir
    }
}

Push-Location $workerDir
try {
    Write-Host "  OK: Aplicando migracion 0001_initial..." -ForegroundColor Green
    npx wrangler d1 execute catalogo-lite-db --local --file="../database/migrations/0001_initial.sql"

    Write-Host "  OK: Aplicando migracion 0002_agent..." -ForegroundColor Green
    npx wrangler d1 execute catalogo-lite-db --local --file="../database/migrations/0002_agent.sql"

    Write-Host "  OK: Cargando datos de demostracion..." -ForegroundColor Green
    npx wrangler d1 execute catalogo-lite-db --local --file="../database/seeds/demo-store.sql"
} finally {
    Pop-Location
}

# --- .env.local del frontend ---
$envFile = Join-Path $frontendDir ".env.local"
if (-not (Test-Path $envFile)) {
    $envContent = @"
# En desarrollo VITE_API_URL se deja vacio y Vite hace proxy de /api
# hacia el Worker local (ver frontend/vite.config.ts -> puerto 8788).
VITE_API_URL=
"@
    $envContent | Out-File -FilePath $envFile -Encoding UTF8
    Write-Host "  OK: Archivo .env.local creado" -ForegroundColor Green
} else {
    Write-Host "  INFO: .env.local ya existe (no se modifica)" -ForegroundColor DarkGray
}

Write-Host @"

== Configuracion completada ==

Proximos pasos:

1. Iniciar el backend (Worker):
     cd worker
     npm run dev

2. En otra terminal, iniciar el frontend:
     cd frontend
     npm run dev

3. Abrir en el navegador:
     Tienda: http://localhost:5173
     Admin:  http://localhost:5173/admin

Credenciales de demo:
     Email:    admin@example.com
     Password: admin123

Para mas informacion, consulta docs/INSTALACION_LOCAL.md

"@ -ForegroundColor Green
