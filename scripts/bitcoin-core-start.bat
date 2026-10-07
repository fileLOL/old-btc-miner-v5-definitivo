@echo off
title Bitcoin Core - Auto Start
echo Iniciando Bitcoin Core con datadir correcto...
echo Fecha: %date% %time%
echo.

REM Verificar si Bitcoin Core ya está corriendo
tasklist /FI "IMAGENAME eq bitcoin-qt.exe" 2>NUL | find /I /N "bitcoin-qt.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo Bitcoin Core ya esta corriendo. No se requiere accion.
    timeout /t 5 /nobreak >nul
    exit /b 0
)

REM Iniciar Bitcoin Core con el datadir correcto
start "" "C:\Program Files\Bitcoin\bitcoin-qt.exe" -datadir="C:\Users\Pere\AppData\Local\Bitcoin"

echo Bitcoin Core iniciado con exito.
echo Fecha: %date% %time%
echo.
echo Este script se cerrara automaticamente en 10 segundos...
timeout /t 10 /nobreak >nul
exit /b 0
