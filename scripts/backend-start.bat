@echo off
title BTC Mining Pool Backend - Auto Start
echo Iniciando Backend Node.js...
echo Fecha: %date% %time%
echo.

REM Verificar si el backend ya está corriendo
tasklist /FI "IMAGENAME eq node.exe" 2>NUL | find /I /N "node.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo Backend Node.js ya esta corriendo. No se requiere accion.
    timeout /t 5 /nobreak >nul
    exit /b 0
)

REM Cambiar al directorio del proyecto
cd /d "C:\Users\Pere\old-btc-miner-v5-definitivo"

REM Iniciar el backend en segundo plano
start /B node server.js

echo Backend Node.js iniciado con exito.
echo Fecha: %date% %time%
echo Puerto: 3000
echo WebSocket: ws://localhost:3000/ws
echo.
echo Mantener esta ventana abierta para ver logs del backend.
echo Si cierras esta ventana, el backend se detendra.
