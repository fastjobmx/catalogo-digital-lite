# Create unique local Worker credentials without printing or overwriting secrets.
[CmdletBinding()]
param(
    [string]$WorkerDirectory = "worker"
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$workerPath = [System.IO.Path]::GetFullPath((Join-Path $root $WorkerDirectory))
$rootPrefix = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $workerPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "WorkerDirectory must point to a folder inside this project."
}
if (-not (Test-Path -LiteralPath (Join-Path $workerPath "wrangler.toml") -PathType Leaf)) {
    throw "The selected folder does not contain wrangler.toml."
}

$varsPath = Join-Path $workerPath ".dev.vars"
if (Test-Path -LiteralPath $varsPath) {
    throw "Credentials already exist; nothing was changed. Use the documented rotation procedure instead."
}

$relativeVarsPath = $varsPath.Substring($rootPrefix.Length).Replace("\", "/")
& git -C $root check-ignore -q -- $relativeVarsPath
if ($LASTEXITCODE -ne 0) {
    throw "The credentials file is not ignored by Git; refusing to write it."
}

function New-RandomHex {
    param([int]$ByteCount)
    $bytes = New-Object byte[] $ByteCount
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
}

$adminEmail = "admin-$(New-RandomHex -ByteCount 6)@localhost"
$adminPassword = New-RandomHex -ByteCount 32
$jwtSecret = New-RandomHex -ByteCount 48
$content = @"
ENVIRONMENT=development
ADMIN_EMAIL=$adminEmail
ADMIN_PASSWORD=$adminPassword
JWT_SECRET=$jwtSecret
"@

$utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
[System.IO.File]::WriteAllText($varsPath, $content, $utf8NoBom)
Write-Host "Created local credentials file: $varsPath"
Write-Host "Values were not printed. Open this file locally to sign in; do not commit or share it."
