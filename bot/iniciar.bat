@echo off
chcp 65001 >nul
title Bot de WhatsApp - Reservalope
cd /d "%~dp0"

where node >/dev/null 2>nul
if errorlevel 1 (
  echo Falta instalar Node.js 22. Descargalo de https://nodejs.org e instalalo con las opciones por defecto.
  pause
  exit /b 1
)

rem El Bloc de notas a veces guarda el archivo como .env.txt
if not exist ".env" if exist ".env.txt" ren ".env.txt" ".env"
if not exist ".env" (
  echo Falta el archivo .env en esta carpeta. Revisa el paso 3 de la guia en bot\README.md
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
node src\index.js
echo.
echo El bot se detuvo. Se vuelve a encender en 10 segundos...
timeout /t 10 /nobreak >nul
goto inicio
