@echo off
chcp 65001 >nul
title Bot de WhatsApp - Reservalope
cd /d "%~dp0"

rem Si el bot ya esta instalado como servicio (instalar-servicio.bat), ya
rem esta encendido: abrir otro desconectaria el WhatsApp de las barberias.
schtasks /query /tn "Reservalope Bot" >nul 2>nul
if not errorlevel 1 (
  echo El bot ya esta instalado como servicio de Windows y se enciende solo.
  echo No hace falta abrir iniciar.bat. Lo que hace queda en logs\bot.log.
  echo Para volver a usar esta ventana, ejecuta antes desinstalar-servicio.bat.
  pause
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo Falta instalar Node.js 22. Descargalo de https://nodejs.org e instalalo con las opciones por defecto.
  pause
  exit /b 1
)

rem El bot necesita Node 22 o superior. Si el que esta primero en el PATH es
rem mas antiguo (por ejemplo, por nvm), usar el instalado en Program Files.
node -e "process.exit(+process.versions.node.split('.')[0] < 22 ? 1 : 0)"
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
node -e "process.exit(+process.versions.node.split('.')[0] < 22 ? 1 : 0)"
if errorlevel 1 (
  echo Este bot necesita Node.js 22 o superior. Instala la version LTS desde https://nodejs.org
  pause
  exit /b 1
)

rem El Bloc de notas a veces guarda el archivo como .env.txt
if not exist ".env" if exist ".env.txt" ren ".env.txt" ".env"
if not exist ".env" if not exist "%ProgramData%\Reservalope\bot.env" if not defined BOT_ENV_FILE (
  echo Falta el archivo .env en esta carpeta. Revisa el paso 5 de la guia en bot\README.md
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando por primera vez, espera un momento...
  call npm ci --omit=dev
  if errorlevel 1 (
    echo No se pudo instalar. Revisa tu conexion a internet y vuelve a intentarlo.
    pause
    exit /b 1
  )
)

:inicio
echo.
echo Bot encendido. No cierres esta ventana: si la cierras, se apaga el bot.
echo Lo que hace tambien queda guardado en logs\bot.log
node src\index.js
set "CODIGO=%errorlevel%"
echo.
rem 0 = apagado a proposito; 2 = falta configuracion; 3 = ya hay otro bot encendido
if "%CODIGO%"=="0" (
  echo El bot se apago.
  pause
  exit /b 0
)
if "%CODIGO%"=="2" (
  echo Corrige la configuracion indicada arriba y vuelve a abrir iniciar.bat.
  pause
  exit /b 2
)
if "%CODIGO%"=="3" (
  echo Ya hay un bot encendido en esta computadora. Esta ventana se cierra sin abrir otro.
  pause
  exit /b 3
)
echo El bot se detuvo. Se vuelve a encender en 10 segundos...
timeout /t 10 /nobreak >nul
goto inicio
