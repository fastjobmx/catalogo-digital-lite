# Enciende, apaga o revisa el bot de WhatsApp (WAHA) de TiendIA Expres en este PC.
#   powershell -ExecutionPolicy Bypass -File scripts\whatsapp.ps1 encender | apagar | estado
# Nunca imprime claves. Solo usa Docker Desktop, docker compose y los scripts de esta carpeta.
param([ValidateSet('encender', 'apagar', 'estado')][string]$accion = 'estado')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$publico = 'https://waha.tiendiaexpres.com/gateway-health'

function Escribir($texto, $color = 'Gray') { Write-Host $texto -ForegroundColor $color }

function DockerListo {
  try { docker info --format '{{.ServerVersion}}' 2>$null | Out-Null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

function AsegurarDocker {
  if (DockerListo) { return }
  Escribir 'Encendiendo Docker Desktop...' 'Yellow'
  $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (-not (Test-Path $exe)) { throw 'No encuentro Docker Desktop instalado.' }
  Start-Process $exe | Out-Null
  for ($i = 0; $i -lt 60; $i++) { Start-Sleep -Seconds 3; if (DockerListo) { Escribir 'Docker listo.' 'Green'; return } }
  throw 'Docker Desktop no arranco en 3 minutos. Abrelo a mano y vuelve a intentar.'
}

function EstadoSesion {
  try { return (node scripts/session.mjs status 2>$null | Out-String | ConvertFrom-Json) } catch { return $null }
}

function TunelPublico {
  try { return ((Invoke-WebRequest -Uri $publico -UseBasicParsing -TimeoutSec 10).Content.Trim() -eq 'ok') } catch { return $false }
}

function MostrarEstado {
  $s = EstadoSesion
  $tunel = TunelPublico
  Escribir ''
  if ($s -and $s.status -eq 'WORKING' -and $tunel) {
    Escribir "WhatsApp ENCENDIDO: sesion $($s.name) vinculada al numero $($s.me), tunel publico OK." 'Green'
  } else {
    $estado = if ($s -and $s.status) { $s.status } else { 'sin respuesta' }
    Escribir "WhatsApp NO esta atendiendo. Sesion: $estado. Tunel publico: $(if ($tunel) { 'OK' } else { 'sin respuesta' })." 'Red'
  }
}

switch ($accion) {
  'encender' {
    AsegurarDocker
    Escribir 'Arrancando WAHA, gateway y tunel...' 'Yellow'
    docker compose up -d --remove-orphans
    if ($LASTEXITCODE -ne 0) { throw 'docker compose no pudo arrancar los servicios.' }
    for ($i = 0; $i -lt 40; $i++) {
      try { if ((Invoke-WebRequest -Uri 'http://127.0.0.1:3000/ping' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { break } } catch {}
      Start-Sleep -Seconds 3
    }
    $s = EstadoSesion
    if (-not $s -or -not $s.status) {
      Escribir 'No existe la sesion: la creo.' 'Yellow'
      node scripts/session.mjs create | Out-Null
      Start-Sleep -Seconds 5
      $s = EstadoSesion
    } elseif ($s.status -in @('STOPPED', 'FAILED')) {
      Escribir "Sesion en $($s.status): la reinicio." 'Yellow'
      node scripts/session.mjs restart | Out-Null
      Start-Sleep -Seconds 8
      $s = EstadoSesion
    }
    if ($s -and $s.status -eq 'SCAN_QR_CODE') {
      Escribir 'Hay que vincular el numero: abro la pagina del QR (http://127.0.0.1:3099).' 'Yellow'
      Escribir 'En el telefono del bot: WhatsApp > Dispositivos vinculados > Vincular un dispositivo.' 'Yellow'
      Start-Process -WindowStyle Minimized node -ArgumentList 'scripts/qr-server.mjs'
      Start-Sleep -Seconds 2
      Start-Process 'http://127.0.0.1:3099'
      for ($i = 0; $i -lt 100; $i++) { Start-Sleep -Seconds 6; $s = EstadoSesion; if ($s -and $s.status -eq 'WORKING') { break } }
    }
    for ($i = 0; $i -lt 10 -and -not (TunelPublico); $i++) { Start-Sleep -Seconds 3 }
    MostrarEstado
  }
  'apagar' {
    if (-not (DockerListo)) { Escribir 'Docker ya esta apagado: WhatsApp no esta atendiendo.' 'Green'; break }
    Escribir 'Apagando WAHA, gateway y tunel (la sesion y el numero quedan guardados)...' 'Yellow'
    docker compose stop
    Escribir 'WhatsApp APAGADO. El bot no respondera hasta que lo enciendas. Telegram y el panel siguen igual.' 'Green'
  }
  'estado' {
    if (-not (DockerListo)) { Escribir 'Docker esta apagado: WhatsApp NO esta atendiendo.' 'Red'; break }
    docker compose ps --format 'table {{.Service}}\t{{.Status}}'
    MostrarEstado
  }
}
