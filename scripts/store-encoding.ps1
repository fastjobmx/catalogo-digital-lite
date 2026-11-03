# Shared UTF-8 and SQL string helpers for the local store generator.
function Read-Utf8Text {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function ConvertTo-SqlString {
    param([AllowEmptyString()][string]$Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text
    )
    $encoding = New-Object System.Text.UTF8Encoding -ArgumentList $false
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function ConvertTo-StorePresetCtaModule {
    param([object]$Cta)
    $ctaJson = if ($Cta) { ConvertTo-Json -InputObject $Cta -Depth 10 -Compress } else { "null" }
    return @"
import type { ClosingCtaConfig } from '../types/theme'

// Filled by the generator from the selected local theme preset.
export const STORE_PRESET_CTA: Partial<ClosingCtaConfig> | null = $ctaJson
"@
}
