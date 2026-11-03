[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot
$slug = "test-wrangler-failure-" + [guid]::NewGuid().ToString("N").Substring(0, 6)
$destination = Join-Path (Join-Path $rootDir "local-stores") $slug
$mockDirectory = Join-Path $rootDir (".tmp\wrangler-mock-" + [guid]::NewGuid().ToString("N"))
$mockNpx = Join-Path $mockDirectory "npx.cmd"
$oldPath = $env:PATH

try {
    New-Item -ItemType Directory -Path $mockDirectory -Force | Out-Null
    [System.IO.File]::WriteAllText($mockNpx, "@echo off`r`necho SQLITE_BUSY: database is locked 1>&2`r`nexit /b 37`r`n", [System.Text.Encoding]::ASCII)
    $env:PATH = $mockDirectory + [System.IO.Path]::PathSeparator + $oldPath

    $oldErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "new-store.ps1") `
            -StoreName "Wrangler failure probe" `
            -Slug $slug `
            -BusinessType "Test" `
            -Mode demo `
            -Seed None `
            -Theme default `
            -Diagnostic 2>&1 | ForEach-Object { [string]$_ })
        $generatorExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $oldErrorActionPreference
    }

    if ($generatorExitCode -eq 0) { throw "Generator unexpectedly accepted the failing Wrangler stub." }
    if (Test-Path -LiteralPath $destination) { throw "A failed invocation created a destination." }

    $registryPath = Join-Path (Join-Path $rootDir "local-stores") "registry.json"
    if (Test-Path -LiteralPath $registryPath) {
        $registry = @(Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json -ErrorAction Stop)
        if (@($registry | Where-Object { $_.slug -eq $slug }).Count -gt 0) { throw "A failed invocation wrote a success registry entry." }
    }

    $stagingPattern = Join-Path (Join-Path $rootDir "local-stores") (".staging-" + $slug + "-*")
    if (@(Get-ChildItem -Path $stagingPattern -Force -ErrorAction SilentlyContinue).Count -gt 0) { throw "Failed staging was not cleaned after diagnosis." }

    $diagnosticDirectory = Join-Path $rootDir ".tmp\generator-diagnostics"
    $matchingDiagnostic = $null
    foreach ($file in Get-ChildItem -LiteralPath $diagnosticDirectory -Filter "new-store-*.json" -File -ErrorAction SilentlyContinue) {
        $record = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json -ErrorAction Stop
        if ($record.slug -eq $slug) { $matchingDiagnostic = $record; break }
    }
    if (-not $matchingDiagnostic) { throw "The failed invocation did not preserve a diagnostic." }
    if ($matchingDiagnostic.failedStep -ne "apply-migrations") { throw "Unexpected failure step: $($matchingDiagnostic.failedStep)" }
    if (@($matchingDiagnostic.events | Where-Object { $_.exitCode -eq 37 }).Count -ne 1) { throw "The external process exit code was not preserved." }
    if ($matchingDiagnostic.events[0].errorCategory -ne "sqlite-lock") { throw "The Wrangler error was not classified as a SQLite lock: $($matchingDiagnostic.events[0].errorCategory)" }
    if ($matchingDiagnostic.events[0].workingDirectory -ne (Join-Path $rootDir "worker")) { throw "The Wrangler working directory was not recorded." }
    if (-not $matchingDiagnostic.events[0].configPath -or -not $matchingDiagnostic.events[0].persistPath) { throw "Wrangler config/persistence paths were not recorded." }
    if ($matchingDiagnostic.events[0].command -notmatch '--config' -or $matchingDiagnostic.events[0].command -notmatch '--persist-to' -or $matchingDiagnostic.events[0].command -match '--remote') { throw "Wrangler did not use the recorded local config/persistence invocation." }
    if ($output -join "`n" -match "ADMIN_PASSWORD=|JWT_SECRET=|<redacted>[^\r\n]+") { throw "The diagnostic output may expose a secret." }

    [pscustomobject]@{
        result = "passed"
        expectedExternalExitCode = 37
        classifiedError = $matchingDiagnostic.events[0].errorCategory
        generatorExitCode = $generatorExitCode
        failedStep = $matchingDiagnostic.failedStep
        destinationCreated = $false
        registryEntryCreated = $false
        stagingCleaned = $true
        diagnosticPreserved = $true
        secretsPrinted = $false
    } | ConvertTo-Json -Depth 4
} finally {
    $env:PATH = $oldPath
    if (Test-Path -LiteralPath $mockDirectory) {
        Remove-Item -LiteralPath $mockDirectory -Recurse -Force
    }
}
