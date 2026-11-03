# Create an isolated local demo installation from the Catalogo Lite template.
# Windows PowerShell 5 compatible. Remote provisioning is intentionally disabled.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$StoreName,

    [string]$Slug = "",

    [Parameter(Mandatory = $true)]
    [string]$BusinessType,

    [ValidateSet("auto", "default", "pet-soft", "tech-minimal")]
    [string]$Theme = "auto",

    [ValidateSet("demo", "production")]
    [string]$Mode = "demo",

    [string]$Destination = "",

    [ValidateSet("None", "PatitasFelices", "TecnoCellAccesorios")]
    [string]$Seed = "None",

    [switch]$DryRun,

    [switch]$Diagnostic
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot
$storesRoot = [System.IO.Path]::GetFullPath((Join-Path $rootDir "local-stores"))
$stagePath = $null
$createdDestination = $false
$currentStep = "preflight"
$diagnosticEvents = New-Object System.Collections.ArrayList
$diagnosticId = [guid]::NewGuid().ToString("N")
. (Join-Path $PSScriptRoot "store-encoding.ps1")

function Get-SanitizedDiagnosticText {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return "" }
    $clean = $Text -replace '(?i)(ADMIN_EMAIL|ADMIN_PASSWORD|JWT_SECRET|TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|GEMINI_API_KEY)\s*[:=]\s*[^\s,;]+', '$1=<redacted>'
    $clean = $clean -replace '(?i)Bearer\s+[A-Za-z0-9._-]+', 'Bearer <redacted>'
    $clean = $clean -replace '(?i)(token|password|secret|api[_-]?key)("?\s*:\s*")([^"\r\n]+)', '$1$2<redacted>'
    return $clean
}

function Save-GeneratorDiagnostic {
    param([string]$FailureMessage = "")
    if (-not $Diagnostic -and -not $FailureMessage) { return }
    $diagnosticDirectory = Join-Path $rootDir ".tmp\generator-diagnostics"
    if (-not (Test-Path -LiteralPath $diagnosticDirectory)) {
        New-Item -ItemType Directory -Path $diagnosticDirectory -Force | Out-Null
    }
    $diagnosticPath = Join-Path $diagnosticDirectory ("new-store-{0}-{1}.json" -f $diagnosticId, (Get-Date -Format "yyyyMMdd-HHmmss"))
    $record = [ordered]@{
        timestampUtc = [DateTime]::UtcNow.ToString("o")
        slug = $Slug
        failedStep = if ($FailureMessage) { $currentStep } else { $null }
        failure = Get-SanitizedDiagnosticText $FailureMessage
        events = @($diagnosticEvents.ToArray())
    }
    $json = ConvertTo-Json -InputObject $record -Depth 12
    Write-Utf8NoBom -Path $diagnosticPath -Text $json
    if ($Diagnostic -or $FailureMessage) { Write-Host "Generator diagnostic: $diagnosticPath" }
}

function ConvertTo-TomlString {
    param([string]$Value)
    $escaped = $Value.Replace("\", "\\").Replace('"', '\"')
    return '"' + $escaped + '"'
}

function Get-WranglerErrorCategory {
    param([string]$Text)
    if ($Text -match '(?i)\b(EPERM|EACCES|access is denied|permission denied)\b') { return "permissions" }
    if ($Text -match '(?i)\b(SQLITE_BUSY|database is locked|SQLITE_LOCKED)\b') { return "sqlite-lock" }
    if ($Text -match '(?i)(syntax error|no such table|no such column|constraint failed|foreign key constraint|SQLITE_ERROR)') { return "sql" }
    if ($Text -match '(?i)\b(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed)\b') { return "local-network" }
    if ($Text -match '(?i)\binternal error\b') { return "internal-wrangler" }
    if ($Text -match '(?i)(cannot find module|module not found|npm error|command not found|not recognized as the name)') { return "dependencies" }
    if ($Text -match '(?i)(EBUSY|EEXIST|file is being used|being used by another process)') { return "filesystem-conflict" }
    if ($Text -match '(?i)(no migrations folder|no migrations present|migration directory|configuration is invalid)') { return "configuration" }
    return "unknown"
}

function Get-RandomHex {
    param([int]$ByteCount = 32)
    $bytes = New-Object byte[] $ByteCount
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
}

function Copy-SourceTree {
    param(
        [string]$SourceRoot,
        [string]$DestinationRoot
    )

    $sourceFull = [System.IO.Path]::GetFullPath($SourceRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
    foreach ($file in Get-ChildItem -LiteralPath $sourceFull -Recurse -File | Where-Object { $_.Name -notmatch '\.test\.(ts|tsx)$' }) {
        $relative = $file.FullName.Substring($sourceFull.Length).TrimStart([char[]]@('\', '/'))
        $target = Join-Path $DestinationRoot $relative
        $targetParent = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $targetParent)) {
            New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
        }
        Copy-Item -LiteralPath $file.FullName -Destination $target
    }
}

function Invoke-LocalWrangler {
    param(
        [string]$DatabaseName,
        [string]$ConfigPath,
        [string]$PersistPath,
        [string]$SqlFile,
        [string]$Command,
        [switch]$ApplyMigrations,
        [Parameter(Mandatory = $true)][string]$Step
    )

    if ($ApplyMigrations) {
        $arguments = @("d1", "migrations", "apply", $DatabaseName, "--local", "--persist-to", $PersistPath, "--config", $ConfigPath)
        $safeArguments = "npx.cmd --no-install wrangler d1 migrations apply <database> --local --persist-to `"$PersistPath`" --config `"$ConfigPath`""
    } else {
        $arguments = @("d1", "execute", $DatabaseName, "--local", "--persist-to", $PersistPath, "--config", $ConfigPath)
        if ($SqlFile) {
            $arguments += @("--file", $SqlFile)
        } else {
            $arguments += @("--command", $Command)
        }
        $safeArguments = "npx.cmd --no-install wrangler d1 execute <database> --local --persist-to `"$PersistPath`" --config `"$ConfigPath`""
        if ($SqlFile) { $safeArguments += " --file `"$(Split-Path -Leaf $SqlFile)`"" }
        else { $safeArguments += " --command <redacted-sql>" }
    }

    $localConfigHome = Join-Path (Split-Path -Parent $PersistPath) "wrangler-home"
    New-Item -ItemType Directory -Path $localConfigHome -Force | Out-Null
    $logDirectory = Join-Path $localConfigHome "logs"
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $oldXdgConfigHome = $env:XDG_CONFIG_HOME
    $oldWranglerSendMetrics = $env:WRANGLER_SEND_METRICS
    $oldWranglerLogPath = $env:WRANGLER_LOG_PATH
    $started = [System.Diagnostics.Stopwatch]::StartNew()
    $exitCode = $null
    $outputLines = @()
    $oldErrorActionPreference = $ErrorActionPreference
    $npxExecutable = Get-Command npx.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $npxExecutable) { throw "The local npx.cmd executable is unavailable." }
    Push-Location (Join-Path $rootDir "worker")
    try {
        Set-Variable -Name currentStep -Value $Step -Scope 1
        $env:XDG_CONFIG_HOME = $localConfigHome
        $env:WRANGLER_SEND_METRICS = "false"
        $env:WRANGLER_LOG_PATH = Join-Path $localConfigHome "logs"
        $ErrorActionPreference = "Continue"
        $outputLines = @(& $npxExecutable.Source --no-install wrangler @arguments 2>&1 | ForEach-Object { [string]$_ })
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $oldErrorActionPreference
        $env:XDG_CONFIG_HOME = $oldXdgConfigHome
        $env:WRANGLER_SEND_METRICS = $oldWranglerSendMetrics
        $env:WRANGLER_LOG_PATH = $oldWranglerLogPath
        Pop-Location
        $started.Stop()
    }
    $event = [ordered]@{
        step = $Step
        command = $safeArguments
        workingDirectory = (Join-Path $rootDir "worker")
        configPath = $ConfigPath
        persistPath = $PersistPath
        exitCode = $exitCode
        durationMs = $started.ElapsedMilliseconds
        output = @($outputLines | Select-Object -Last 24 | ForEach-Object { Get-SanitizedDiagnosticText $_ })
        errorCategory = if ($exitCode -ne 0) { Get-WranglerErrorCategory ($outputLines -join "`n") } else { $null }
    }
    if ($exitCode -ne 0) {
        $latestLog = Get-ChildItem -LiteralPath $logDirectory -Filter "wrangler-*.log" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($latestLog) {
            $wranglerLogLines = [System.IO.File]::ReadAllLines($latestLog.FullName, [System.Text.Encoding]::UTF8)
            $event.diagnosticLog = @($wranglerLogLines | Select-Object -Last 160 | ForEach-Object { Get-SanitizedDiagnosticText ([string]$_) })
        }
        $event.errorCategory = Get-WranglerErrorCategory ((@($event.output) + @($event.diagnosticLog)) -join "`n")
    }
    [void]$diagnosticEvents.Add($event)
    if ($exitCode -ne 0) {
        Set-Variable -Name currentStep -Value $Step -Scope 1
        throw "Wrangler local D1 step '$Step' failed with exit code $exitCode."
    }
}

try {
    if ($Mode -ne "demo") {
        throw "Mode 'production' is not available. This generator only creates local demos."
    }

    if ([string]::IsNullOrWhiteSpace($StoreName) -or $StoreName.Length -lt 2 -or $StoreName.Length -gt 80 -or $StoreName -match '[\x00-\x1F]') {
        throw "StoreName must contain 2 to 80 printable characters."
    }
    if ([string]::IsNullOrWhiteSpace($BusinessType) -or $BusinessType.Length -lt 2 -or $BusinessType.Length -gt 80 -or $BusinessType -match '[\x00-\x1F]') {
        throw "BusinessType must contain 2 to 80 printable characters."
    }

    $seedDirectory = $null
    $assetDirectory = $null
    $businessPreset = $null
    $catalogSeedPath = $null
    $presetAssets = @()
    $presetAssetManifest = $null
    $themeDirectory = $null
    $effectiveTheme = $Theme
    if ($Seed -eq "PatitasFelices") { $seedDirectory = "patitas-felices"; $assetDirectory = "patitas" }
    if ($Seed -eq "TecnoCellAccesorios") { $seedDirectory = "tecnocell-accesorios"; $assetDirectory = "tecnocell-demo" }
    if ($Theme -eq "auto") {
        if ($Seed -eq "PatitasFelices") { $effectiveTheme = "pet-soft" }
        elseif ($Seed -eq "TecnoCellAccesorios") { $effectiveTheme = "tech-minimal" }
        else { $effectiveTheme = "default" }
    }
    if ($effectiveTheme -eq "pet-soft" -and $Seed -ne "PatitasFelices") { throw "Theme 'pet-soft' requires Seed 'PatitasFelices'." }
    if ($effectiveTheme -eq "tech-minimal" -and $Seed -ne "TecnoCellAccesorios") { throw "Theme 'tech-minimal' requires Seed 'TecnoCellAccesorios'." }
    if ($effectiveTheme -eq "pet-soft") { $themeDirectory = "patitas-felices" }
    if ($effectiveTheme -eq "tech-minimal") { $themeDirectory = "tecnocell-accesorios" }
    if ($seedDirectory) {
        $presetRoot = Join-Path $rootDir ("database\seed-presets\" + $seedDirectory)
        foreach ($required in @("business.json", "catalog.sql", "theme.json", "assets.json")) {
            if (-not (Test-Path -LiteralPath (Join-Path $presetRoot $required))) { throw "Preset file is missing: $required" }
        }
        $businessPresetPath = Join-Path $presetRoot "business.json"
        $businessPreset = (Read-Utf8Text -Path $businessPresetPath) | ConvertFrom-Json -ErrorAction Stop
        $catalogSeedPath = Join-Path $presetRoot "catalog.sql"
        $assetManifestPath = Join-Path $presetRoot "assets.json"
        $presetAssetManifest = (Read-Utf8Text -Path $assetManifestPath) | ConvertFrom-Json -ErrorAction Stop
        $assetRoot = Join-Path $rootDir ("frontend\public\seed-images\" + $assetDirectory)
        if (-not (Test-Path -LiteralPath $assetRoot)) { throw "Preset asset directory is missing: $assetRoot" }
        foreach ($assetRecord in @($presetAssetManifest.assets)) {
            if ([string]$assetRecord.file -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid preset asset filename: $($assetRecord.file)" }
            $assetPath = Join-Path $assetRoot ([string]$assetRecord.file)
            if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) { throw "Preset asset is missing: $assetPath" }
            $assetHash = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($assetHash -ne [string]$assetRecord.sha256) { throw "Preset asset checksum mismatch: $($assetRecord.file)" }
            $presetAssets += Get-Item -LiteralPath $assetPath
        }
        if ($presetAssets.Count -eq 0) { throw "No local image assets found for preset '$seedDirectory'." }
    }
    $themePresetData = $null
    if ($themeDirectory) {
        $themePath = Join-Path $rootDir ("database\seed-presets\" + $themeDirectory + "\theme.json")
        $themePresetData = (Read-Utf8Text -Path $themePath) | ConvertFrom-Json -ErrorAction Stop
    }
    $themeConfigJson = if ($themePresetData) { ConvertTo-Json -InputObject $themePresetData -Depth 30 -Compress } else { "{}" }

    if ([string]::IsNullOrWhiteSpace($Slug)) {
        $normalized = $StoreName.Normalize([System.Text.NormalizationForm]::FormD)
        $builder = New-Object System.Text.StringBuilder
        foreach ($character in $normalized.ToCharArray()) {
            if ([System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($character) -ne [System.Globalization.UnicodeCategory]::NonSpacingMark) {
                [void]$builder.Append($character)
            }
        }
        $Slug = [regex]::Replace($builder.ToString().ToLowerInvariant(), "[^a-z0-9]+", "-").Trim("-")
    }
    $Slug = $Slug.ToLowerInvariant()
    if ($Slug.Length -lt 2 -or $Slug.Length -gt 48 -or $Slug -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') {
        throw "Slug must be 2 to 48 lowercase letters/numbers separated by single hyphens."
    }

    if ([string]::IsNullOrWhiteSpace($Destination)) {
        $destinationFull = [System.IO.Path]::GetFullPath((Join-Path $storesRoot $Slug))
    } elseif ([System.IO.Path]::IsPathRooted($Destination)) {
        $destinationFull = [System.IO.Path]::GetFullPath($Destination)
    } else {
        $destinationFull = [System.IO.Path]::GetFullPath((Join-Path $storesRoot $Destination))
    }

    $destinationParent = [System.IO.Path]::GetDirectoryName($destinationFull)
    $normalizedParent = $destinationParent.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $normalizedRoot = $storesRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    if (-not [string]::Equals($normalizedParent, $normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Destination must be a direct child of '$storesRoot'."
    }
    if ([string]::Equals($destinationFull, $rootDir, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Destination cannot be the template directory."
    }
    if (Test-Path -LiteralPath $destinationFull) {
        throw "Destination already exists; nothing was changed: $destinationFull"
    }
    if (Test-Path -LiteralPath $storesRoot) {
        $rootItem = Get-Item -LiteralPath $storesRoot -Force
        if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "The local-stores root cannot be a reparse point or symbolic link."
        }
    }

    $registryPath = Join-Path $storesRoot "registry.json"
    $registry = @()
    if (Test-Path -LiteralPath $registryPath) {
        try {
            $registryData = Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json -ErrorAction Stop
            if ($null -ne $registryData) { $registry = @($registryData) }
        } catch {
            throw "The local store registry is invalid; refusing to continue: $registryPath"
        }
    }
    if (@($registry | Where-Object { $_.slug -eq $Slug }).Count -gt 0) {
        throw "Slug '$Slug' is already registered; nothing was changed."
    }

    $migrationFiles = @(
        "0001_initial.sql",
        "0002_agent.sql",
        "0003_theme.sql"
    )
    foreach ($migration in $migrationFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $rootDir "database\migrations\$migration"))) {
            throw "Required migration is missing: $migration"
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $rootDir "worker\package-lock.json"))) {
        throw "Worker package-lock.json is missing."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $rootDir "frontend\package-lock.json"))) {
        throw "Frontend package-lock.json is missing."
    }

    $hashBytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Slug))
    $portOffset = ([int]$hashBytes[0] * 256 + [int]$hashBytes[1]) % 1000
    $workerPort = 8788 + $portOffset
    $frontendPort = 5173 + $portOffset
    if (@($registry | Where-Object { $_.workerPort -eq $workerPort -or $_.frontendPort -eq $frontendPort }).Count -gt 0) {
        throw "A registered demo already uses the selected local ports. Choose another slug."
    }

    $databaseName = "catalogo-lite-$Slug-local"
    $databaseId = [guid]::NewGuid().ToString()
    $destinationDisplay = $destinationFull

    Write-Host "Store:       $StoreName"
    Write-Host "Slug:        $Slug"
    Write-Host "Business:    $BusinessType"
    Write-Host "Theme:       $effectiveTheme"
    Write-Host "Mode:        $Mode"
    if ($Seed -eq "None") { Write-Host "Seed:        None (store configuration only; no products)" }
    else { Write-Host "Seed:        $Seed (isolated local catalog and selected assets)" }
    Write-Host "Destination: $destinationDisplay"
    Write-Host "Local D1:    $databaseName"
    Write-Host "Worker URL:  http://127.0.0.1:$workerPort"
    Write-Host "Frontend:    http://127.0.0.1:$frontendPort"
    Write-Host "Remote resources: none"

    if ($DryRun) {
        Write-Host "DRY RUN: no files, databases, or registry entries were created."
        exit 0
    }

    if (-not (Test-Path -LiteralPath $storesRoot)) {
        New-Item -ItemType Directory -Path $storesRoot | Out-Null
    }
    $stagePath = Join-Path $storesRoot (".staging-" + $Slug + "-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $stagePath | Out-Null
    Copy-Item -LiteralPath (Join-Path $rootDir ".gitignore") -Destination (Join-Path $stagePath ".gitignore")

    $frontendStage = Join-Path $stagePath "frontend"
    $workerStage = Join-Path $stagePath "worker"
    $databaseStage = Join-Path $stagePath "database"
    $migrationStage = Join-Path $databaseStage "migrations"
    New-Item -ItemType Directory -Path $frontendStage,$workerStage,$databaseStage,$migrationStage | Out-Null

    Copy-SourceTree -SourceRoot (Join-Path $rootDir "frontend\src") -DestinationRoot (Join-Path $frontendStage "src")
    $presetCta = if ($themePresetData) { $themePresetData.cta } else { $null }
    $presetCtaSource = ConvertTo-StorePresetCtaModule -Cta $presetCta
    Write-Utf8NoBom -Path (Join-Path $frontendStage "src\data\storePresetCta.ts") -Text $presetCtaSource
    foreach ($relative in @("index.html", "tsconfig.json", "package-lock.json", "tailwind.config.js", "postcss.config.js")) {
        $source = Join-Path (Join-Path $rootDir "frontend") $relative
        Copy-Item -LiteralPath $source -Destination $frontendStage
    }
    $publicStage = Join-Path $frontendStage "public"
    New-Item -ItemType Directory -Path $publicStage | Out-Null
    Copy-Item -LiteralPath (Join-Path $rootDir "frontend\public\favicon.svg") -Destination $publicStage
    if ($presetAssets.Count -gt 0) {
        $presetPublic = Join-Path $publicStage ("seed-images\" + $assetDirectory)
        New-Item -ItemType Directory -Path $presetPublic -Force | Out-Null
        foreach ($asset in $presetAssets) { Copy-Item -LiteralPath $asset.FullName -Destination $presetPublic }
    }

    Copy-SourceTree -SourceRoot (Join-Path $rootDir "worker\src") -DestinationRoot (Join-Path $workerStage "src")
    foreach ($relative in @("tsconfig.json", "package-lock.json")) {
        $source = Join-Path (Join-Path $rootDir "worker") $relative
        Copy-Item -LiteralPath $source -Destination $workerStage
    }
    foreach ($migration in $migrationFiles) {
        Copy-Item -LiteralPath (Join-Path $rootDir "database\migrations\$migration") -Destination (Join-Path $migrationStage $migration)
    }

    $frontendPackage = Get-Content -LiteralPath (Join-Path $rootDir "frontend\package.json") -Raw | ConvertFrom-Json
    $frontendPackage.scripts = [ordered]@{
        dev = "vite"
        build = "tsc --noEmit && vite build"
        preview = "vite preview"
    }
    Write-Utf8NoBom -Path (Join-Path $frontendStage "package.json") -Text ($frontendPackage | ConvertTo-Json -Depth 30)

    $workerPackage = Get-Content -LiteralPath (Join-Path $rootDir "worker\package.json") -Raw | ConvertFrom-Json
    $workerPackage.scripts = [ordered]@{
        dev = "wrangler dev --persist-to .wrangler/state --local"
        types = "wrangler types"
    }
    Write-Utf8NoBom -Path (Join-Path $workerStage "package.json") -Text ($workerPackage | ConvertTo-Json -Depth 30)

    $viteConfig = @"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: $frontendPort,
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:$workerPort',
    },
  },
})
"@
    Write-Utf8NoBom -Path (Join-Path $frontendStage "vite.config.ts") -Text $viteConfig
    @"
VITE_INDEPENDENT_INSTALLATION=true
VITE_STORE_SLUG=$Slug
"@ | Set-Content -LiteralPath (Join-Path $frontendStage ".env.local") -Encoding ASCII

    $wranglerConfig = @"
name = "catalogo-lite-$Slug"
main = "src/index.ts"
compatibility_date = "2024-12-05"
compatibility_flags = ["nodejs_compat"]
send_metrics = false

[vars]
ENVIRONMENT = "development"
STORE_NAME = $(ConvertTo-TomlString $StoreName)
STORE_CURRENCY = "COP"
STORE_COUNTRY = "CO"
ALLOWED_ORIGIN = "http://127.0.0.1:$frontendPort,http://localhost:$frontendPort"

[[d1_databases]]
binding = "DB"
database_name = "$databaseName"
database_id = "$databaseId"
migrations_dir = "../database/migrations"

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "catalogo-lite-$Slug-assets"

[dev]
ip = "127.0.0.1"
port = $workerPort
"@
    Write-Utf8NoBom -Path (Join-Path $workerStage "wrangler.toml") -Text $wranglerConfig

    $adminPassword = Get-RandomHex -ByteCount 24
    $jwtSecret = Get-RandomHex -ByteCount 48
    $devVars = @"
ENVIRONMENT=development
ADMIN_EMAIL=admin@$Slug.local
ADMIN_PASSWORD=$adminPassword
JWT_SECRET=$jwtSecret
"@
    Set-Content -LiteralPath (Join-Path $workerStage ".dev.vars") -Value $devVars -Encoding ASCII

    $storeDescription = if ($businessPreset) { [string]$businessPreset.description } else { "" }
    $storeSlogan = if ($businessPreset) { [string]$businessPreset.slogan } else { "" }
    $primaryColor = if ($businessPreset) { [string]$businessPreset.primaryColor } else { "#222222" }
    $secondaryColor = if ($businessPreset) { [string]$businessPreset.secondaryColor } else { "#E7E3DC" }
    $accentColor = if ($businessPreset) { [string]$businessPreset.accentColor } else { "#8D806D" }
    $buttonColor = if ($businessPreset) { [string]$businessPreset.buttonColor } else { "#222222" }
    $coverImage = if ($businessPreset) { ConvertTo-SqlString ([string]$businessPreset.coverImage) } else { "NULL" }
    $whatsappMessage = if ($businessPreset) { [string]$businessPreset.defaultWhatsappMessage } else { "Hola! Quiero hacer un pedido:" }
    $deliveryMethods = if ($businessPreset) { (ConvertTo-Json -InputObject @($businessPreset.deliveryMethods) -Compress).Replace("'", "''") } else { '["envio","recogida"]' }
    $pickupAvailable = if ($businessPreset -and $businessPreset.pickupAvailable) { 1 } else { 0 }
    $storeNameSql = ConvertTo-SqlString $StoreName
    $storeDescriptionSql = ConvertTo-SqlString $storeDescription
    $storeSloganSql = ConvertTo-SqlString $storeSlogan
    $businessTypeSql = ConvertTo-SqlString $BusinessType
    $primaryColorSql = ConvertTo-SqlString $primaryColor
    $secondaryColorSql = ConvertTo-SqlString $secondaryColor
    $accentColorSql = ConvertTo-SqlString $accentColor
    $buttonColorSql = ConvertTo-SqlString $buttonColor
    $whatsappMessageSql = ConvertTo-SqlString $whatsappMessage
    $themeConfigSql = ConvertTo-SqlString $themeConfigJson
    $configSql = @"
INSERT INTO store_config (
  id, name, description, slogan, business_type, primary_color, secondary_color,
  accent_color, button_color, cover_image_url, currency, country, delivery_methods,
  pickup_available, default_whatsapp_message, theme_config
) VALUES (
  1, $storeNameSql, $storeDescriptionSql, $storeSloganSql, $businessTypeSql, $primaryColorSql, $secondaryColorSql,
  $accentColorSql, $buttonColorSql, $coverImage, 'COP', 'CO', '$deliveryMethods',
  $pickupAvailable, $whatsappMessageSql, $themeConfigSql
);
"@
    $configSqlPath = Join-Path $databaseStage "store-config.sql"
    Write-Utf8NoBom -Path $configSqlPath -Text $configSql

    $readme = @"
# Local demo: $StoreName

This generated project is isolated from the master template. It has its own local D1/R2 persistence, Worker config, ports, and untracked admin credentials.

## Start the API

```powershell
Set-Location .\worker
npm ci
npm run dev
```

## Start the storefront (in a second PowerShell window)

```powershell
Set-Location .\frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:$frontendPort`. The API listens on `http://127.0.0.1:$workerPort`.
Admin email and password are stored only in `worker\.dev.vars`.

This installation uses seed '$Seed'. Catalog seed data and images are local demo references; verify product details and replace illustrative photos before any real sale. Remote provisioning is disabled in this generator.
"@
    Write-Utf8NoBom -Path (Join-Path $stagePath "README-LOCAL.md") -Text $readme

    $configPath = Join-Path $workerStage "wrangler.toml"
    $persistPath = Join-Path $workerStage ".wrangler\state"
    Invoke-LocalWrangler -DatabaseName $databaseName -ConfigPath $configPath -PersistPath $persistPath -ApplyMigrations -Step "apply-migrations"
    Invoke-LocalWrangler -DatabaseName $databaseName -ConfigPath $configPath -PersistPath $persistPath -SqlFile $configSqlPath -Step "initialize-store-config"
    if ($catalogSeedPath) {
        $seedStage = Join-Path $databaseStage ("seed-presets\" + $seedDirectory)
        New-Item -ItemType Directory -Path $seedStage -Force | Out-Null
        Copy-Item -LiteralPath $catalogSeedPath -Destination (Join-Path $seedStage "catalog.sql")
        Copy-Item -LiteralPath (Join-Path $rootDir ("database\seed-presets\" + $seedDirectory + "\business.json")) -Destination $seedStage
        Copy-Item -LiteralPath (Join-Path $rootDir ("database\seed-presets\" + $seedDirectory + "\theme.json")) -Destination $seedStage
        Copy-Item -LiteralPath (Join-Path $rootDir ("database\seed-presets\" + $seedDirectory + "\assets.json")) -Destination $seedStage
        Invoke-LocalWrangler -DatabaseName $databaseName -ConfigPath $configPath -PersistPath $persistPath -SqlFile (Join-Path $seedStage "catalog.sql") -Step "apply-preset-seed"
    }
    Invoke-LocalWrangler -DatabaseName $databaseName -ConfigPath $configPath -PersistPath $persistPath -Command "SELECT name FROM store_config WHERE id = 1;" -Step "verify-store-config"

    $migrationHashes = @{}
    foreach ($migration in $migrationFiles) {
        $migrationHashes[$migration] = (Get-FileHash -LiteralPath (Join-Path $migrationStage $migration) -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $presetAssetHashes = [ordered]@{}
    foreach ($asset in $presetAssets) { $presetAssetHashes[$asset.Name] = (Get-FileHash -LiteralPath $asset.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    $templateCommit = "unknown"
    $gitOutput = & git -C $rootDir rev-parse HEAD 2>$null
    if ($LASTEXITCODE -eq 0 -and [string]$gitOutput -match '^[0-9a-fA-F]{40}$') {
        $templateCommit = [string]$gitOutput
    }

    $manifest = [ordered]@{
        formatVersion = 1
        storeName = $StoreName
        slug = $Slug
        businessType = $BusinessType
        theme = $effectiveTheme
        mode = $Mode
        seed = $Seed
        templateCommit = $templateCommit
        databaseName = $databaseName
        databaseId = $databaseId
        workerPort = $workerPort
        frontendPort = $frontendPort
        migrations = $migrationHashes
        productCount = if ($Seed -eq "PatitasFelices") { 3 } elseif ($Seed -eq "TecnoCellAccesorios") { 4 } else { 0 }
        categoryCount = if ($Seed -eq "PatitasFelices") { 3 } elseif ($Seed -eq "TecnoCellAccesorios") { 4 } else { 0 }
        presetAssets = $presetAssetHashes
        assetProvenance = if ($presetAssetManifest) { $presetAssetManifest.assets } else { @() }
        createdUtc = [DateTime]::UtcNow.ToString("o")
    }
    Write-Utf8NoBom -Path (Join-Path $stagePath "manifest.json") -Text ($manifest | ConvertTo-Json -Depth 20)

    Move-Item -LiteralPath $stagePath -Destination $destinationFull
    $stagePath = $null
    $createdDestination = $true

    $registryEntry = [ordered]@{
        slug = $Slug
        storeName = $StoreName
        destination = $destinationFull
        mode = $Mode
        workerPort = $workerPort
        frontendPort = $frontendPort
        manifest = (Join-Path $destinationFull "manifest.json")
    }
    $updatedRegistry = @($registry) + @($registryEntry)
    $registryTemp = Join-Path $storesRoot (".registry-" + [guid]::NewGuid().ToString("N") + ".tmp")
    try {
        Write-Utf8NoBom -Path $registryTemp -Text ($updatedRegistry | ConvertTo-Json -Depth 20)
        Move-Item -LiteralPath $registryTemp -Destination $registryPath -Force
    } catch {
        throw "The demo was created at '$destinationFull', but registry update failed. Keep the installation and register it manually after inspecting manifest.json. $($_.Exception.Message)"
    }

    if ($Diagnostic) {
        try { Save-GeneratorDiagnostic } catch { Write-Warning "Could not preserve successful generator diagnostic: $(Get-SanitizedDiagnosticText $_.Exception.Message)" }
    }
    Write-Host "Created isolated local demo at: $destinationFull"
    Write-Host "Admin credentials are saved in worker\.dev.vars (not printed)."
    Write-Host "No cloud resources were created. See README-LOCAL.md for startup commands."
} catch {
    $failureMessage = Get-SanitizedDiagnosticText $_.Exception.Message
    try { Save-GeneratorDiagnostic -FailureMessage $failureMessage } catch { Write-Warning "Could not preserve generator diagnostic: $(Get-SanitizedDiagnosticText $_.Exception.Message)" }
    if ($stagePath -and (Test-Path -LiteralPath $stagePath)) {
        $stageFull = [System.IO.Path]::GetFullPath($stagePath)
        if ($stageFull.StartsWith($storesRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $stageFull -Recurse -Force
        }
    }
    Write-Error "Generator failed during '$currentStep': $failureMessage"
    exit 1
}
