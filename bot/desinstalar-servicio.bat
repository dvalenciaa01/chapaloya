@echo off
chcp 65001 >nul
title Quitar el servicio del bot de Reservalope
cd /d "%~dp0"

net session >nul 2>nul
if errorlevel 1 (
  echo Se necesita permiso de administrador. Acepta la ventana que aparece.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\servicio.ps1" -Accion Desinstalar
if errorlevel 1 (
  echo.
  echo No se pudo quitar el servicio. Lee el mensaje de arriba.
)
echo.
pause
