# ==========================================================================
# Instala o quita el bot como tarea programada de Windows "Reservalope Bot".
# Lo usan instalar-servicio.bat y desinstalar-servicio.bat (como administrador).
#
# La tarea:
#   - arranca al encender la PC, sin que nadie inicie sesion;
#   - corre como SYSTEM, sin ventana (no se puede cerrar por error);
#   - ejecuta servicio.bat, que reinicia el bot si se cae y guarda lo que
#     pasa en logs\bot.log (y logs\servicio.log para errores graves).
# Ademas deja el archivo de claves (.env) y las sesiones solo para SYSTEM y
# Administradores.
#
# Nota: este archivo va sin tildes a proposito (PowerShell 5 de Windows lee
# mal los acentos de un archivo UTF-8 sin BOM).
# ==========================================================================
param(
  [Parameter(Mandatory = $true)][ValidateSet('Instalar', 'Desinstalar')][string]$Accion
)
$ErrorActionPreference = 'Stop'
$TaskName = 'Reservalope Bot'
$BotDir = Split-Path -Parent $PSScriptRoot
$LockFile = Join-Path $BotDir 'bot.lock'
$StopFile = Join-Path $BotDir 'bot.stop'
$EnvLocal = Join-Path $BotDir '.env'
$EnvShared = Join-Path $env:ProgramData 'Reservalope\bot.env'
$SessionsDir = Join-Path $BotDir 'sessions'
$LogsDir = Join-Path $BotDir 'logs'
$Sys = '*S-1-5-18'        # SYSTEM (por SID: funciona con Windows en cualquier idioma)
$Adm = '*S-1-5-32-544'    # Administradores

function Say($t) { Write-Host $t }

function Get-LockPid {
  if (-not (Test-Path $LockFile)) { return $null }
  try { return [int]((Get-Content $LockFile -Raw | ConvertFrom-Json).pid) } catch { return $null }
}

# Apaga con calma el bot que este corriendo en esta carpeta (bot.stop) y,
# si no responde, lo termina.
function Stop-Bot {
  $botPid = Get-LockPid
  if (-not $botPid) { return }
  if (-not (Get-Process -Id $botPid -ErrorAction SilentlyContinue)) { return }
  Say "Apagando el bot que esta encendido (proceso $botPid)..."
  Set-Content -Path $StopFile -Value 'stop'
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    if (-not (Get-Process -Id $botPid -ErrorAction SilentlyContinue)) { return }
  }
  Stop-Process -Id $botPid -Force -ErrorAction SilentlyContinue
  Remove-Item $StopFile -ErrorAction SilentlyContinue
}

# icacls sin que un mensaje en stderr detenga el script
function Invoke-Icacls {
  $ErrorActionPreference = 'Continue'
  $out = & icacls @args 2>&1
  return $LASTEXITCODE
}

function Protect-Path($path, [switch]$Folder) {
  if (-not (Test-Path $path)) { return }
  if ($Folder) {
    $code = Invoke-Icacls $path /inheritance:r /grant:r "${Sys}:(OI)(CI)F" "${Adm}:(OI)(CI)F" /Q
    if (Get-ChildItem -Path $path -Force) { Invoke-Icacls (Join-Path $path '*') /reset /T /C /Q | Out-Null }
  } else {
    $code = Invoke-Icacls $path /inheritance:r /grant:r "${Sys}:F" "${Adm}:F" /Q
  }
  if ($code -ne 0) { Say "  Aviso: no se pudieron cambiar los permisos de $path" }
}

function Unprotect-Path($path, [switch]$Folder) {
  if (-not (Test-Path $path)) { return }
  Invoke-Icacls $path /inheritance:e /Q | Out-Null
  if ($Folder) { Invoke-Icacls $path /reset /T /C /Q | Out-Null } else { Invoke-Icacls $path /reset /Q | Out-Null }
}

function Find-Node {
  $candidates = @()
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { $candidates += $cmd.Source }
  $pf = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path $pf) { $candidates += $pf }
  foreach ($n in $candidates) {
    $major = & $n -e "process.stdout.write(process.versions.node.split('.')[0])"
    if ([int]$major -ge 22) { return $n }
  }
  return $null
}

function Get-HealthPort {
  $port = 8080
  foreach ($f in @($EnvShared, $EnvLocal)) {
    if (Test-Path $f) {
      $line = Select-String -Path $f -Pattern '^\s*BOT_HEALTH_PORT\s*=\s*(\d+)' | Select-Object -First 1
      if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
      break
    }
  }
  return $port
}

# Quita accesos directos a iniciar.bat de las carpetas de Inicio: con el
# servicio instalado sobran y abririan un segundo bot.
function Remove-StartupShortcuts {
  $dirs = @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))
  $shell = New-Object -ComObject WScript.Shell
  foreach ($d in $dirs) {
    if (-not $d -or -not (Test-Path $d)) { continue }
    Get-ChildItem -Path $d -Filter *.lnk | ForEach-Object {
      $target = $shell.CreateShortcut($_.FullName).TargetPath
      if ($target -and $target.ToLower().EndsWith('iniciar.bat')) {
        Remove-Item $_.FullName
        Say "  Se quito el acceso directo de Inicio: $($_.Name)"
      }
    }
  }
}

if ($Accion -eq 'Instalar') {
  Say 'Instalando el bot de Reservalope como servicio de Windows...'
  $node = Find-Node
  if (-not $node) { throw 'Falta Node.js 22 o superior. Instalalo desde https://nodejs.org (version LTS) y vuelve a intentarlo.' }
  Say "  Node.js: $node"

  if (-not (Test-Path $EnvLocal) -and (Test-Path (Join-Path $BotDir '.env.txt'))) {
    Rename-Item (Join-Path $BotDir '.env.txt') '.env'
  }
  if (-not (Test-Path $EnvLocal) -and -not (Test-Path $EnvShared)) {
    throw "Falta el archivo .env en $BotDir (o $EnvShared). Revisa la guia en bot\README.md."
  }

  if (-not (Test-Path (Join-Path $BotDir 'node_modules'))) {
    Say '  Instalando dependencias (la primera vez tarda un poco)...'
    Push-Location $BotDir
    try {
      $npm = Join-Path (Split-Path -Parent $node) 'npm.cmd'
      if (-not (Test-Path $npm)) { $npm = 'npm.cmd' }
      $ErrorActionPreference = 'Continue'
      & $npm ci --omit=dev
      $ErrorActionPreference = 'Stop'
      if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias. Revisa tu conexion a internet.' }
    } finally { Pop-Location }
  }

  # Un bot abierto con iniciar.bat, o una version anterior de la tarea
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  }
  Stop-Bot
  Remove-StartupShortcuts

  $bat = Join-Path $BotDir 'servicio.bat'
  $action = New-ScheduledTaskAction -Execute "$env:ComSpec" -Argument "/d /c `"`"$bat`"`"" -WorkingDirectory $BotDir
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -DontStopOnIdleEnd
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
    -Settings $settings -Description 'Bot de WhatsApp de Reservalope (envia avisos y recordatorios).' -Force | Out-Null
  Say "  Tarea programada '$TaskName' creada (arranca al encender la PC)."

  Say '  Protegiendo la clave de Supabase y las sesiones (solo SYSTEM y Administradores)...'
  if (-not (Test-Path $SessionsDir)) { New-Item -ItemType Directory -Path $SessionsDir | Out-Null }
  if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir | Out-Null }
  Protect-Path $EnvLocal
  Protect-Path $EnvShared
  if (Test-Path $EnvShared) { Protect-Path (Split-Path -Parent $EnvShared) -Folder }
  Protect-Path $SessionsDir -Folder
  Protect-Path $LogsDir -Folder

  Start-ScheduledTask -TaskName $TaskName
  Say '  Encendiendo el bot...'
  $port = Get-HealthPort
  $ok = $false
  for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
    Start-Sleep -Seconds 2
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port" -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200) { $ok = $true }
    } catch { }
  }
  Say ''
  if ($ok) {
    Say 'Listo: el bot esta encendido y arrancara solo cada vez que se prenda la PC.'
  } else {
    Say 'La tarea quedo instalada, pero el bot aun no responde. Revisa logs\bot.log y logs\servicio.log en la carpeta del bot.'
  }
  Say 'Ya no uses iniciar.bat. Para quitar el servicio: desinstalar-servicio.bat'
}

if ($Accion -eq 'Desinstalar') {
  Say 'Quitando el servicio del bot de Reservalope...'
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    # Primero la tarea (para que no lo vuelva a encender) y luego el bot
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  }
  Stop-Bot
  if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Say "  Tarea '$TaskName' eliminada."
  } else {
    Say "  No habia una tarea '$TaskName'."
  }
  Say '  Devolviendo los permisos normales a .env, sessions y logs...'
  Unprotect-Path $EnvLocal
  Unprotect-Path $SessionsDir -Folder
  Unprotect-Path $LogsDir -Folder
  Say ''
  Say 'Listo: el bot quedo apagado. Puedes volver a encenderlo con iniciar.bat o instalar-servicio.bat.'
}
