# RENDER DEPLOY — Backend Remoto 24/7

## Arquitectura Fase A (0€/mes)

```
PC ENCENDIDO:
Browser → Vercel (frontend) → Render (backend) → Tailscale Funnel → Tu PC (Bitcoin Core RPC)

PC APAGADO:
Browser → Vercel (frontend) → Render (backend) → Bitcoin Core OFFLINE
  - Dashboard carga
  - WebSocket conecta
  - Pool stats visibles
  - Mining NO disponible
  - Blockchain data muestra "OFFLINE"
```

**Coste total: 0€/mes** (Render Free + Vercel Free + Tailscale Free + cron-job.org Free)

---

## PRE-REQUISITOS

Antes de empezar necesitas tener:

1. **GitHub**: Cuenta en https://github.com (tu repo ya esta aqui)
2. **Tailscale**: Instalado en tu PC con Funnel disponible
3. **Bitcoin Core**: Corriendo en tu PC con RPC habilitado
4. **Cuenta Render**: Gratuita en https://render.com (crearemos en el Paso 1)
5. **Cuenta cron-job.org**: Gratuita en https://cron-job.org (crearemos en el Paso 7)

---

## PASO 1: Configurar Tailscale Funnel para Bitcoin Core RPC

**OBJETIVO**: Exponer el puerto 8332 de Bitcoin Core (RPC) via HTTPS para que Render pueda conectarse.

### 1.1 Verificar bitcoin.conf

Tu `bitcoin.conf` debe estar en `C:\Users\Pere\AppData\Local\Bitcoin\bitcoin.conf`.

Abrelo con notepad y asegurate de que contiene:

```
server=1
rpcuser=btcpool
rpcpassword=UNA_CONTRASENA_SEGURA_AQUI
rpcbind=0.0.0.0
rpcallowip=0.0.0.0/0
```

> **IMPORTANTE**: 
> - `rpcuser` y `rpcpassword` son las credenciales que Render usara para conectarse
> - Usa una contrasena fuerte (minimo 20 caracteres, mezcla de letras/numeros)
> - `rpcbind=0.0.0.0` permite conexiones desde cualquier interfaz (necesario para Tailscale Funnel)
> - **NO compartas estas credenciales con nadie ni las subas a git**

Despues de editar `bitcoin.conf`, reinicia Bitcoin Core:
1. Cierra Bitcoin Core completamente (click derecho en el icono → Exit)
2. Vuelve a abrir Bitcoin Core
3. Espera a que se sincronice

### 1.2 Verificar que bitcoin-cli funciona localmente

Abre PowerShell y ejecuta:

```powershell
& "C:\Program Files\Bitcoin\daemon\bitcoin-cli.exe" -rpcuser=btcpool -rpcpassword=TU_PASSWORD getblockchaininfo
```

Debe devolver un JSON con informacion de la blockchain. Si da error, revisa `bitcoin.conf`.

### 1.3 Activar Tailscale Funnel para puerto 8332

Abre PowerShell **como Administrador** y ejecuta:

```powershell
tailscale funnel 8332
```

Esto crea un proxy HTTPS publico:

```
https://desktop-8nime7p.tailfdb982.ts.net:8443 → http://localhost:8332
```

> **NOTA**: El hostname exacto (`desktop-8nime7p.tailfdb982.ts.net`) es el TUYO. Para ver tu hostname real:
> ```powershell
> tailscale status
> ```
> Busca la linea que dice `tailfdb...` o `ts.net`.

### 1.4 Verificar que Funnel funciona

Desde PowerShell (puede ser en la misma maquina):

```powershell
curl https://desktop-8nime7p.tailfdb982.ts.net:8443
```

> Debe devolver un error HTTP (como "401 Unauthorized" o similar). Eso es BUENO — significa que Bitcoin Core esta respondiendo pero requiere autenticacion.
>
> Si recibes "Connection refused" o timeout, Funnel no esta funcionando. Verifica:
> 1. Bitcoin Core esta corriendo
> 2. `tailscale funnel 8332` esta activo
> 3. Firewall de Windows permite puerto 8332 localmente

### 1.5 Anotar tu URL de Funnel

Tu URL de Bitcoin Core RPC accesible desde Internet es:

```
https://TU-HOSTNAME.tailXXXX.ts.net:8443
```

**ANOTALA**. La necesitaras en el Paso 3.

> **Ejemplo real** (reemplaza con tu hostname):
> ```
> https://desktop-8nime7p.tailfdb982.ts.net:8443
> ```

---

## PASO 2: Crear cuenta en Render y conectar GitHub

### 2.1 Crear cuenta

1. Ve a https://render.com
2. Click **"Get Started"** o **"Sign Up"**
3. Selecciona **"GitHub"** (recomendado) o "Email"
4. Autoriza a Render para acceder a tus repos de GitHub
5. No requiere tarjeta de credito para el free tier

### 2.2 Crear Web Service desde Blueprint

Render soporta **Blueprints** — detecta automaticamente `render.yaml` en tu repo.

1. En el Dashboard de Render, click **"New +"**
2. Selecciona **"Blueprint"**
3. Si es la primera vez, click **"Connect GitHub"** y autoriza Render
4. Busca y selecciona: **`fileLOL/old-btc-miner-v5-definitivo`**
5. Click **"Connect"**

Render detectara `render.yaml` automaticamente y te mostrara un resumen:

```
Service: btc-miner-pool
Type: Web Service
Region: Frankfurt
Plan: Free
Build Command: npm install
Start Command: node server-render.js
```

### 2.3 Configurar variables de entorno (SECRETAS)

Render te pedira que configures las variables marcadas como `sync: false` en `render.yaml`.

**Haz click en "Advanced"** o busca la seccion **"Environment Variables"**.

Debes rellenar estas 4 variables:

| Variable | Valor | Donde obtenerlo |
|----------|-------|-----------------|
| `BITCOIN_RPC_URL` | `https://TU-HOSTNAME.ts.net:8443` | Del Paso 1.5 |
| `BITCOIN_RPC_USER` | `btcpool` (o el que pusiste en bitcoin.conf) | De tu `bitcoin.conf` |
| `BITCOIN_RPC_PASSWORD` | Tu contrasena RPC | De tu `bitcoin.conf` |
| `PAYOUT_ADDRESS` | Tu direccion Bitcoin (bc1q...) | Tu wallet |

> **SECURIDAD**:
> - **BITCOIN_RPC_URL**: NO es secreto. Es tu hostname publico de Tailscale.
> - **BITCOIN_RPC_USER**: NO es muy sensible, pero no lo compartas.
> - **BITCOIN_RPC_PASSWORD**: **MUY SECRETO**. Nunca lo subas a git, nunca lo compartas.
> - **PAYOUT_ADDRESS**: Publico (es tu direccion Bitcoin para recibir recompensas).
>
> **NUNCA pegues estos valores en el chat ni en ningun sitio publico.**

### 2.4 Verificar configuracion antes de deploy

Antes de hacer click en "Apply", verifica:

- [ ] Name: `btc-miner-pool`
- [ ] Region: `Frankfurt` (o el mas cercano a ti)
- [ ] Branch: `master`
- [ ] Plan: **Free** (muy importante — no debe decir "Starter" ni "Standard")
- [ ] Build Command: `npm install`
- [ ] Start Command: `node server-render.js`
- [ ] Health Check Path: `/api/health`
- [ ] Las 4 variables de entorno estan rellenadas

### 2.5 Hacer deploy

Click **"Apply"** → Render empezara a:

1. Clonar tu repo de GitHub
2. Ejecutar `npm install`
3. Arrancar `node server-render.js`

El primer deploy tarda 2-5 minutos. Veras logs en tiempo real.

### 2.6 Verificar que el deploy fue exitoso

En los logs de Render debes ver:

```
OLD BTC MINER V5 POOL -> http://0.0.0.0:3000
WebSocket: ws://0.0.0.0:3000/ws
Bitcoin Core RPC: https://****@desktop-8nime7p.tailfdb982.ts.net:8443
Payout address: [CONFIGURED]
Pool fee: 2% | PPLNS window: 10000 | Min payout: 50000 sat
Payout mode: DRY RUN (no real payments)
```

> Si ves `Bitcoin Core RPC: https://****@...` — las credenciales estan correctamente enmascaradas.

### 2.7 Obtener tu URL de Render

Despues del deploy exitoso, Render te asigna una URL:

```
https://btc-miner-pool.onrender.com
```

> **IMPORTANTE**: El nombre exacto depende del nombre que le diste al servicio. Puede ser diferente.
> 
> Para ver tu URL exacta:
> 1. En el Dashboard de Render, click en tu servicio `btc-miner-pool`
> 2. Arriba veras la URL: `https://NOMBRE-SERVICIO.onrender.com`
> 3. **ANOTALA** — la necesitaras para el frontend y el keepalive.

### 2.8 Probar el backend

Desde tu navegador o PowerShell:

```
https://btc-miner-pool.onrender.com/api/health
```

Debe devolver:

```json
{
  "ok": true,
  "uptime": 12.345,
  "miners": 0,
  "version": "5.1.0-pool",
  "bitcoin_core": "online"
}
```

> Si `bitcoin_core` dice `"online"` — tu Tailscale Funnel esta funcionando y Render se conecta correctamente a tu Bitcoin Core.
>
> Si dice `"offline"` — Render no puede alcanzar tu Bitcoin Core. Revisa:
> 1. Que Tailscale Funnel este activo: `tailscale funnel status`
> 2. Que `BITCOIN_RPC_URL` en Render sea correcta
> 3. Que `BITCOIN_RPC_USER` y `BITCOIN_RPC_PASSWORD` coincidan con `bitcoin.conf`

---

## PASO 3: Actualizar frontend para apuntar a Render

**OBJETIVO**: Que `https://mining-bitcoin.vercel.app` se conecte al backend en Render.

### 3.1 Editar frontend/config.js

Abre `frontend/config.js` y reemplaza el placeholder con tu URL real de Render:

```javascript
window.BACKEND_URL=window.BACKEND_URL||'wss://btc-miner-pool.onrender.com';
```

> **IMPORTANTE**: 
> - Usa **SOLO** el hostname: `wss://btc-miner-pool.onrender.com`
> - **NO** incluyas `/ws` al final — el frontend lo anade automaticamente
> - Reemplaza `btc-miner-pool.onrender.com` con **TU** URL real de Render (la del Paso 2.7)

### 3.2 Commit y push

```powershell
cd C:\Users\Pere\old-btc-miner-v5-definitivo
git add frontend/config.js
git commit -m "Config: point frontend to Render backend"
git push origin master
```

Vercel detecta el push automaticamente y redeploya el frontend.

### 3.3 Verificar frontend

1. Abre `https://mining-bitcoin.vercel.app` en tu navegador
2. Abre la consola del navegador (F12 → Console)
3. Debes ver:
   - `SYSTEM INIT`
   - `BACKEND CONNECTED // v5.1.0-pool`
   - `NODE OK // MAINNET // HEIGHT ...` (si Bitcoin Core esta online)
   - `WEBSOCKET CONNECTED`

4. El panel debe mostrar:
   - Backend: `btc-miner-pool.onrender.com` (o tu URL)
   - Bitcoin Core: `CONNECTED` (verde) si tu PC esta encendido
   - Bitcoin Core: `OFFLINE` (rojo) si tu PC esta apagado

---

## PASO 4: Configurar Keepalive (evitar spin-down de Render)

**PROBLEMA**: Render Free suspende tu servicio despues de 15 minutos sin trafico. Cuando alguien visita, tarda ~60 segundos en despertar.

**SOLUCION**: Usar cron-job.org para hacer una peticion cada 5 minutos a `/api/health`.

### 4.1 Crear cuenta en cron-job.org

1. Ve a https://cron-job.org
2. Click **"Sign Up"** → crea cuenta gratuita con email
3. Confirma el email

### 4.2 Crear un nuevo cron job

1. En el Dashboard, click **"Create Cronjob"**
2. Rellena:

| Campo | Valor |
|-------|-------|
| **Title** | `Render Keepalive - BTC Pool` |
| **URL** | `https://btc-miner-pool.onrender.com/api/health` |
| **Execution schedule** | Cada 5 minutos |

3. En **"Execution schedule"**:
   - Selecciona **"Every X minutes"**
   - Valor: **5**

4. Click **"Create"**

### 4.3 Verificar keepalive

```
URL:       https://btc-miner-pool.onrender.com/api/health
Metodo:    GET
Frecuencia: Cada 5 minutos
Respuesta esperada: {"ok":true,"uptime":...,"bitcoin_core":"online"}
```

> Reemplaza `btc-miner-pool.onrender.com` con **TU** URL real de Render.
>
> Despues de crear el cron job, espera 10 minutos y verifica en Render que el servicio no se ha dormido.

---

## PASO 5: Verificacion completa

### 5.1 Con PC ENCENDIDO + Bitcoin Core corriendo

```powershell
# Desde PowerShell:
curl https://btc-miner-pool.onrender.com/api/status
```

Debe mostrar:
```json
{
  "ok": true,
  "bitcoin_core": "online",
  "chain": "main",
  "blocks": 870000,
  "headers": 870000,
  "difficulty": ...,
  "networkhashps": ...
}
```

En el navegador (`https://mining-bitcoin.vercel.app`):
- Bitcoin Core: **CONNECTED** (verde)
- Height visible
- Difficulty visible
- Network hashrate visible
- WebSocket: **CONNECTED**

### 5.2 Con PC APAGADO

```powershell
curl https://btc-miner-pool.onrender.com/api/status
```

Debe mostrar:
```json
{
  "ok": true,
  "bitcoin_core": "offline",
  "error": "...",
  "blocks": 0,
  "chain": "unknown"
}
```

En el navegador:
- Bitcoin Core: **OFFLINE** (rojo)
- Dashboard carga correctamente
- WebSocket sigue conectado al backend en Render
- Mining NO disponible (espera a que Bitcoin Core vuelva)

### 5.3 Test de mining (con PC encendido)

1. Abre `https://mining-bitcoin.vercel.app`
2. Introduce tu direccion BTC en el campo "BTC Address"
3. Click **[ START MINING ]**
4. Debes ver:
   - `WEBSOCKET CONNECTED`
   - `MINER ID: miner_xxx`
   - `REGISTERED // bc1q...`
   - `NEW JOB: ...`
   - `MINING // N WORKERS`
   - Hashrate > 0

---

## LIMITACIONES FASE A

| Limitacion | Impacto |
|------------|---------|
| **Disco efimero en Render** | SQLite (pool.db) se borra en cada reinicio/despliegue. Cuentas, shares, balances se pierden. |
| **512 MB RAM** | Suficiente para el backend. NO para Bitcoin Core. |
| **Spin-down tras 15 min** | Resuelto con keepalive de cron-job.org (cada 5 min). |
| **Bitcoin Core en tu PC** | Mining solo funciona cuando PC esta encendido. |
| **Tailscale Funnel requiere PC encendido** | Si apagas el PC, Render no puede conectarse a Bitcoin Core. |

---

## VARIABLES DE ENTORNO — RESUMEN

### En Render (Dashboard → Environment):

| Variable | Valor | Tipo |
|----------|-------|------|
| `BITCOIN_RPC_URL` | `https://TU-HOSTNAME.ts.net:8443` | De Tailscale Funnel |
| `BITCOIN_RPC_USER` | `btcpool` | De bitcoin.conf |
| `BITCOIN_RPC_PASSWORD` | Tu contrasena | De bitcoin.conf |
| `PAYOUT_ADDRESS` | Tu direccion BTC | Tu wallet |

### En render.yaml (ya configuradas):

| Variable | Valor | Nota |
|----------|-------|------|
| `SHARE_DIFFICULTY` | `7000000000000000` | Dificultad de shares |
| `CORS_ORIGIN` | `*` | Permite cualquier origen |
| `MAX_MINERS` | `100` | Max mineros simultaneos |
| `POOL_FEE_PERCENT` | `2` | Fee del pool |
| `PPLNS_WINDOW_SIZE` | `10000` | Ventana PPLNS |
| `MIN_PAYOUT_SAT` | `50000` | Minimo para payout |
| `MAX_PAYOUT_SAT` | `100000000` | Maximo payout (1 BTC) |
| `TEMPLATE_REFRESH_MS` | `30000` | Refrescar template cada 30s |
| `JOB_TIMEOUT_MS` | `120000` | Job expira en 2 min |
| `BLOCK_MONITOR_MS` | `30000` | Monitor de bloques cada 30s |
| `COINBASE_MATURITY` | `100` | Confirmaciones para madurez |
| `PAYOUT_INTERVAL_MS` | `3600000` | Payouts cada 1 hora |
| `PAYOUT_MONITOR_INTERVAL_MS` | `300000` | Monitor pagos cada 5 min |
| `PAYOUT_PENDING_TIMEOUT_MS` | `3600000` | Timeout pagos pendientes |
| `PAYOUT_DRY_RUN` | `true` | Sin pagos reales |

---

## TROUBLESHOOTING

### Render: "Application failed to respond"

- El servicio se ha dormido. Espera 60 segundos o verifica que cron-job.org esta funcionando.

### Frontend: "BACKEND NOT CONFIGURED"

- Edita `frontend/config.js` — todavia tiene el placeholder. Reemplazalo con tu URL real de Render.

### Backend: `bitcoin_core: "offline"` (con PC encendido)

1. Verifica que Tailscale Funnel esta activo:
   ```powershell
   tailscale funnel status
   ```
2. Verifica que `BITCOIN_RPC_URL` en Render es correcta
3. Verifica que `BITCOIN_RPC_USER` y `BITCOIN_RPC_PASSWORD` coinciden con `bitcoin.conf`
4. Prueba manualmente:
   ```powershell
   curl -u btcpool:PASSWORD https://TU-HOSTNAME.ts.net:8443
   ```

### WebSocket no conecta

- La URL en `frontend/config.js` debe ser `wss://TU-RENDER-URL.onrender.com` (sin `/ws` al final)
- Si tiene `/ws` al final, se conecta a `/ws/ws` y falla

### "Payout address: [NOT SET]" en logs de Render

- Falta la variable `PAYOUT_ADDRESS` en el Dashboard de Render

---

## MIGRACION A FASE B (VPS 24/7)

Cuando quieras que Bitcoin Core funcione 24/7 sin tu PC, migra a un VPS (~5€/mes).

Ver: [MIGRATION-VPS.md](MIGRATION-VPS.md)

---

## CHECKLIST DE DESPLIEGUE

### Automatico (ya hecho):
- [x] `render.yaml` completo con todas las variables
- [x] `server-render.js` listo para Render (HTTP RPC, offline handling)
- [x] `frontend/config.js` con placeholder y deteccion
- [x] `frontend/app.js` con fix de WebSocket /ws
- [x] Seguridad: credenciales enmascaradas en logs
- [x] Seguridad: cero credenciales en git/frontend
- [x] `vercel.json` configurado para frontend estatico
- [x] Todos los tests pasan

### Manual (tu turno):
- [ ] **Paso 1**: Configurar bitcoin.conf + Tailscale Funnel para puerto 8332
- [ ] **Paso 2**: Crear cuenta Render + Blueprint + variables secretas
- [ ] **Paso 3**: Editar frontend/config.js con URL real de Render + push
- [ ] **Paso 4**: Crear keepalive en cron-job.org
- [ ] **Paso 5**: Verificar todo funciona

**PRIMER PASO: Empieza por el Paso 1** — configurar `bitcoin.conf` y activar Tailscale Funnel para el puerto 8332.
