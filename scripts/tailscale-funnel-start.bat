@echo off
title Tailscale Funnel - Auto Start
echo Iniciando Tailscale Funnel para puerto 3000...
echo Fecha: %date% %time%
echo.

REM Verificar si Tailscale Funnel ya está corriendo
tailscale funnel status 2>NUL | findstr /C:"proxy http://127.0.0.1:3000" >nul
if "%ERRORLEVEL%"=="0" (
    echo Tailscale Funnel ya esta corriendo en puerto 3000. No se requiere accion.
    timeout /t 5 /nobreak >nul
    exit /b 0
)

REM Desactivar Funnel existente si hay
tailscale funnel --https=443 off 2>nul
timeout /t 2 /nobreak >nul

REM Iniciar Tailscale Funnel en segundo plano
start /B tailscale funnel --bg 3000

echo Tailscale Funnel iniciado con exito.
echo Fecha: %date% %time%
echo URL publica: https://desktop-8imie7p.tailfdb082.ts.net
echo.
echo Este script se cerrara automaticamente en 10 segundos...
timeout /t 10 /nobreak >nul
exit /b 0
