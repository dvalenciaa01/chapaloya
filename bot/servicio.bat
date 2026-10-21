@echo off
rem ==========================================================================
rem Lo ejecuta la tarea programada "Reservalope Bot" (instalar-servicio.bat),
rem sin ventana. No hace falta abrirlo a mano.
rem Enciende el bot y lo vuelve a encender si se cae. Lo que hace el bot se
rem guarda en logs\bot.log; aqui solo van los arranques y errores graves.
rem ==========================================================================
cd /d "%~dp0"
if not exist "logs" mkdir "logs"
rem Sin ventana: el registro va solo al archivo
set "BOT_LOG_CONSOLE=0"

rem Node 22 o superior: el del PATH o, si es antiguo, el de Program Files
node -e "process.exit(+process.versions.node.split('.')[0] < 22 ? 1 : 0)" >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"

:inicio
if exist "logs\servicio.log" for %%F in ("logs\servicio.log") do if %%~zF GTR 5000000 move /y "logs\servicio.log" "logs\servicio-anterior.log" >nul
echo [%date% %time%] Encendiendo el bot>> "logs\servicio.log"
node src\index.js >> "logs\servicio.log" 2>&1
set "CODIGO=%errorlevel%"
echo [%date% %time%] El bot termino (codigo %CODIGO%)>> "logs\servicio.log"

rem 0 = se apago a proposito (desinstalar-servicio.bat): no volver a encender
if "%CODIGO%"=="0" exit /b 0
rem 3 = ya hay otro bot encendido (por ejemplo, iniciar.bat): esperar 1 minuto
if "%CODIGO%"=="3" (
  ping -n 61 127.0.0.1 >nul
  goto inicio
)
rem 2 = falta configuracion (.env): reintentar cada 5 minutos
if "%CODIGO%"=="2" (
  ping -n 301 127.0.0.1 >nul
  goto inicio
)
rem Cualquier otro error (sin internet al arrancar, etc.): reintentar en 10 s
ping -n 11 127.0.0.1 >nul
goto inicio
