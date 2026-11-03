[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "store-encoding.ps1")

$businessPath = Join-Path $rootDir "database\seed-presets\tecnocell-accesorios\business.json"
$themePath = Join-Path $rootDir "database\seed-presets\tecnocell-accesorios\theme.json"
$business = (Read-Utf8Text -Path $businessPath) | ConvertFrom-Json -ErrorAction Stop
$theme = (Read-Utf8Text -Path $themePath) | ConvertFrom-Json -ErrorAction Stop
$themeJson = ConvertTo-Json -InputObject $theme -Depth 30 -Compress
$presetCtaModule = ConvertTo-StorePresetCtaModule -Cta $theme.cta

$acuteO = [char]0x00F3
$acuteI = [char]0x00ED
$acuteA = [char]0x00E1
$probe = [string]::Concat(
    "Descripci", $acuteO, "n: Tecnolog", $acuteI, "a y reposter", $acuteI,
    "a - 'Cat", $acuteA, "logo' y configuraci", $acuteO, "n m", $acuteO, "vil."
)
$businessDescriptionSql = ConvertTo-SqlString -Value ([string]$business.description)
$descriptionSql = ConvertTo-SqlString -Value $probe
$themeSql = ConvertTo-SqlString -Value $themeJson
$sql = "INSERT INTO phase8_encoding_probe (business_description, description, theme_config) VALUES ($businessDescriptionSql, $descriptionSql, $themeSql);"

$tempDirectory = Join-Path $rootDir ".tmp"
if (-not (Test-Path -LiteralPath $tempDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $tempDirectory | Out-Null
}
$outputPath = Join-Path $tempDirectory ("generator-utf8-" + [guid]::NewGuid().ToString("N") + ".sql")
$ctaOutputPath = Join-Path $tempDirectory ("generator-cta-" + [guid]::NewGuid().ToString("N") + ".ts")

try {
    Write-Utf8NoBom -Path $outputPath -Text $sql
    Write-Utf8NoBom -Path $ctaOutputPath -Text $presetCtaModule
    $written = Read-Utf8Text -Path $outputPath
    $ctaWritten = Read-Utf8Text -Path $ctaOutputPath
    $bytes = [System.IO.File]::ReadAllBytes($outputPath)
    $hasUtf8Bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $result = [pscustomobject]@{
        powershellVersion = $PSVersionTable.PSVersion.ToString()
        accentsPreserved = $written.Contains([string]::Concat("Tecnolog", $acuteI, "a")) -and $written.Contains([string]::Concat("reposter", $acuteI, "a")) -and $written.Contains([string]::Concat("configuraci", $acuteO, "n"))
        presetUtf8Preserved = $written.Contains([string]$business.description) -and $written.Contains([string]::Concat("m", $acuteO, "vil"))
        presetCtaPreserved = $ctaWritten.Contains([string]$theme.cta.title) -and $ctaWritten.Contains([string]$theme.cta.description)
        sqlQuoteEscaped = $written.Contains([string]::Concat("''Cat", $acuteA, "logo''"))
        mojibakeAbsent = -not ($written.Contains([string]::Concat("Tecnolog", [char]0x00C3, [char]0x00AD)) -or $written.Contains([string]::Concat("m", [char]0x00C3, [char]0x00B3, "vil")))
        utf8BomAbsent = -not $hasUtf8Bom
    }

    if (-not ($result.accentsPreserved -and $result.presetUtf8Preserved -and $result.presetCtaPreserved -and $result.sqlQuoteEscaped -and $result.mojibakeAbsent -and $result.utf8BomAbsent)) {
        $result | ConvertTo-Json -Compress
        throw "UTF-8 generator regression probe failed."
    }

    $result | ConvertTo-Json -Compress
} finally {
    if (Test-Path -LiteralPath $outputPath -PathType Leaf) {
        Remove-Item -LiteralPath $outputPath -Force
    }
    if (Test-Path -LiteralPath $ctaOutputPath -PathType Leaf) {
        Remove-Item -LiteralPath $ctaOutputPath -Force
    }
}
