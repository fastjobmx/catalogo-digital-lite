# ============================================
# Catalogo Digital Lite - Script de Despliegue
# ============================================
# Despliega frontend (Pages) y backend (Workers) en Cloudflare.
#
# Uso:
#   .\deploy.ps1                 # Desplegar frontend + backend
#   .\deploy.ps1 -FrontendOnly   # Solo frontend (Cloudflare Pages)
#   .\deploy.ps1 -BackendOnly    # Solo backend (Cloudflare Workers)
#   .\deploy.ps1 -SkipBuild      # Omitir build del frontend (usar dist/)
#   .\deploy.ps1 -Help           # Mostrar ayuda

param(
    [switch]$Help,
    [switch]$FrontendOnly,
    [switch]$BackendOnly,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $rootDir "frontend"
$workerDir = Join-Path $rootDir "worker"

if ($Help) {
    Write-Host @"

Catalogo Digital Lite - Deploy

Uso:
  .\deploy.ps1                 # Desplegar frontend + backend
  .\deploy.ps1 -FrontendOnly   # Solo frontend (Cloudflare Pages)
  .\deploy.ps1 -BackendOnly    # Solo backend (Cloudflare Workers)
  .\deploy.ps1 -SkipBuild      # Omitir build del frontend
  .\deploy.ps1 -Help           # Mostrar esta ayuda

Requisitos previos:
  - wrangler login             # Autenticar con Cloudflare
  - D1 database creada         # wrangler d1 create catalogo-lite-db
  - R2 bucket creado           # wrangler r2 bucket create catalogo-lite-assets
  - Secrets configurados       # Ver docs/DEPLOY_CLOUDFLARE.md

"@ -ForegroundColor Cyan
    exit 0
}

Write-Host "`n== Desplegando Catalogo Digital Lite en Cloudflare ==`n" -ForegroundColor Cyan

# ============================================
# Backend (Workers)
# ============================================
if (-not $FrontendOnly) {
    Write-Host "[1/2] Desplegando backend (Cloudflare Workers)..." -ForegroundColor Cyan
    Push-Location $workerDir

    try {
        $whoami = (npx wrangler whoami) 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ERROR: No autenticado. Ejecuta: wrangler login" -ForegroundColor Red
            Pop-Location
            exit 1
        }
        Write-Host "  OK: Autenticado en Cloudflare" -ForegroundColor Green
    } catch {
        Write-Host "  ERROR verificando autenticacion" -ForegroundColor Red
        Pop-Location
        exit 1
    }

    Write-Host "  OK: Aplicando migraciones a D1 (remoto)..." -ForegroundColor Green
    $migration1 = Join-Path $rootDir "database\migrations\0001_initial.sql"
    npx wrangler d1 execute catalogo-lite-db --remote --file=$migration1
    $migration2 = Join-Path $rootDir "database\migrations\0002_agent.sql"
    npx wrangler d1 execute catalogo-lite-db --remote --file=$migration2

    $loadSeed = Read-Host "Cargar datos de demostracion en produccion? (s/N)"
    if ($loadSeed -eq 's' -or $loadSeed -eq 'S') {
        $seedFile = Join-Path $rootDir "database\seeds\demo-store.sql"
        npx wrangler d1 execute catalogo-lite-db --remote --file=$seedFile
        Write-Host "  OK: Datos de demostracion cargados" -ForegroundColor Green
    }

    Write-Host "  OK: Desplegando Worker..." -ForegroundColor Green
    npx wrangler deploy

    Pop-Location
    Write-Host "  OK: Backend desplegado" -ForegroundColor Green
}

# ============================================
# Frontend (Pages)
# ============================================
if (-not $BackendOnly) {
    Write-Host "`n[2/2] Desplegando frontend (Cloudflare Pages)..." -ForegroundColor Cyan
    Push-Location $frontendDir

    if (-not $SkipBuild) {
        Write-Host "  OK: Construyendo bundle de produccion..." -ForegroundColor Green
        npm run build
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ERROR: Build fallo. Corrige los errores e intenta de nuevo." -ForegroundColor Red
            Pop-Location
            exit 1
        }
    }

    Write-Host "  OK: Desplegando a Cloudflare Pages..." -ForegroundColor Green
    npx wrangler pages deploy dist --project-name=catalogo-lite --branch=main

    Pop-Location
    Write-Host "  OK: Frontend desplegado" -ForegroundColor Green
}

Write-Host @"

== Despliegue completado ==

Proximos pasos:

1. Configurar secrets en Cloudflare Dashboard:
     ADMIN_EMAIL / ADMIN_PASSWORD
     JWT_SECRET
     TELEGRAM_BOT_TOKEN
     GEMINI_API_KEY

2. Configurar webhook de Telegram:
     curl https://tu-worker.workers.dev/api/telegram/setup

3. Vincular cuenta de Telegram:
     Envia /link <codigo> al bot (genera codigo en admin/settings)

4. Verificar tienda:
     Abre la URL de Cloudflare Pages en tu navegador

Para mas informacion, consulta docs/DEPLOY_CLOUDFLARE.md

"@ -ForegroundColor Green
