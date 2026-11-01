# ============================================
# Catalogo Digital Lite - Reiniciar base de datos local (D1)
# ============================================
# Elimina el estado local de D1, vuelve a aplicar las migraciones
# y carga los datos de demostracion de SneakerHub Lite.
# Uso:  .\reset-db.ps1

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$workerDir = Join-Path $rootDir "worker"
$stateDir = Join-Path $workerDir ".wrangler\state\v3\d1"

Write-Host "`n[1/4] Reiniciando base de datos local..." -ForegroundColor Cyan

if (Test-Path $stateDir) {
    Remove-Item -Recurse -Force $stateDir
    Write-Host "  OK: Estado local de D1 eliminado" -ForegroundColor Green
} else {
    Write-Host "  INFO: No habia estado local previo" -ForegroundColor DarkGray
}

Push-Location $workerDir
try {
    Write-Host "  OK: Aplicando migracion 0001_initial..." -ForegroundColor Green
    npx wrangler d1 execute catalogo-lite-db --local --file="../database/migrations/0001_initial.sql"
    if ($LASTEXITCODE -ne 0) { throw "Fallo la migracion 0001_initial" }

    Write-Host "  OK: Aplicando migracion 0002_agent..." -ForegroundColor Green
    npx wrangler d1 execute catalogo-lite-db --local --file="../database/migrations/0002_agent.sql"
    if ($LASTEXITCODE -ne 0) { throw "Fallo la migracion 0002_agent" }

    Write-Host "  OK: Aplicando migracion 0003_theme..." -ForegroundColor Green
    npx wrangler d1 execute catalogo-lite-db --local --file="../database/migrations/0003_theme.sql"
    if ($LASTEXITCODE -ne 0) { throw "Fallo la migracion 0003_theme" }

    Write-Host "  OK: Cargando datos de demostracion..." -ForegroundColor Green
    npx wrangler d1 execute catalogo-lite-db --local --file="../database/seeds/demo-store.sql"
    if ($LASTEXITCODE -ne 0) { throw "Fallo la carga del seed" }
} finally {
    Pop-Location
}

Write-Host "`n[OK] Base de datos local reiniciada (SneakerHub Lite).`n" -ForegroundColor Green
