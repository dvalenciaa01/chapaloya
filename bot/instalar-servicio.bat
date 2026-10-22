@echo off
chcp 65001 >nul
title Instalar el bot de Reservalope como servicio
cd /d "%~dp0"

rem Hace falta ser administrador: si no, pedir permiso y volver a abrir este archivo
net session >nul 2>nul
if errorlevel 1 (
  echo Se necesita permiso de administrador. Acepta la ventana que aparece.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\servicio.ps1" -Accion Instalar
if errorlevel 1 (
  echo.
  echo No se pudo instalar el servicio. Lee el mensaje de arriba.
)
echo.
pause
