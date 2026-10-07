# Scripts de Inicio Automático

## Configuración Completada

Tu PC ahora está configurado para minar Bitcoin 24/7. Todo se inicia automáticamente al encender Windows.

## ¿Qué hace cada script?

### 1. Bitcoin Core
- **Archivo**: `bitcoin-core-start.bat`
- **Función**: Inicia Bitcoin Core con el datadir correcto (`C:\Users\Pere\AppData\Local\Bitcoin`)
- **Verificación**: Si ya está corriendo, no lo reinicia

### 2. Backend Node.js
- **Archivo**: `backend-start.bat`
- **Función**: Inicia el servidor de la pool en puerto 3000
- **Verificación**: Si ya está corriendo, no lo reinicia
- **Nota**: Requiere que esta ventana permanezca abierta para ver los logs

### 3. Tailscale Funnel
- **Archivo**: `tailscale-funnel-start.bat`
- **Función**: Expone el backend a Internet via Tailscale
- **URL pública**: `https://desktop-8imie7p.tailfdb082.ts.net`
- **Verificación**: Si ya está corriendo, no lo reinicia

## Ubicación de los accesos directos

Los tres scripts están en:
```
C:\Users\Pere\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup
```

## Cómo funciona

1. **Al encender el PC**: Windows ejecuta automáticamente los tres scripts
2. **Bitcoin Core**: Empieza a sincronizar la blockchain (si no está sincronizada)
3. **Backend**: Inicia el servidor de la pool
4. **Tailscale Funnel**: Expone el backend a Internet

## Verificación manual

Para verificar que todo está corriendo:

```powershell
# Ver Bitcoin Core
Get-Process -Name "bitcoin-qt"

# Ver Backend
Get-Process -Name "node"

# Ver Tailscale Funnel
tailscale funnel status

# Ver salud del backend
Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/health"
```

## Minería desde el móvil

Cuando todo esté sincronizado:

1. Abre en tu móvil: `https://mining-bitcoin.vercel.app`
2. Introduce tu dirección Bitcoin
3. Click en "START MINING"

## Sincronización de Bitcoin Core

- **Tiempo estimado**: 12-24 horas (primera vez)
- **Estado actual**: Ver en Bitcoin Core → "Verificación de bloques"
- **Cuando esté listo**: Podrás minar bloques reales

## Solución de problemas

### Bitcoin Core no se inicia
- Verifica que la ruta sea correcta: `C:\Program Files\Bitcoin\bitcoin-qt.exe`
- Verifica el datadir: `C:\Users\Pere\AppData\Local\Bitcoin`

### Backend no se inicia
- Verifica que Node.js esté instalado: `node --version`
- Verifica que las dependencias estén instaladas: `npm install`

### Tailscale Funnel no se inicia
- Verifica que Tailscale esté instalado: `tailscale version`
- Verifica que estés logueado: `tailscale status`

## Logs del backend

La ventana del backend muestra los logs en tiempo real:
- Conexiones de mineros
- Shares recibidos
- Bloques encontrados
- Errores del sistema

**No cierres esta ventana** o el backend se detendrá.

## Apagar el sistema

Para detener todo manualmente:

```powershell
# Detener Tailscale Funnel
tailscale funnel --https=443 off

# Detener Backend
Get-Process -Name "node" | Stop-Process -Force

# Detener Bitcoin Core
Get-Process -Name "bitcoin-qt" | Stop-Process -Force
```

## Coste mensual

- **Electricidad**: ~€10-15/mes (dependiendo de tu tarifa)
- **Tailscale**: Gratis
- **Vercel**: Gratis
- **Total**: ~€10-15/mes
