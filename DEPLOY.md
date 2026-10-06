# DEPLOY — OLD BTC MINER V5 POOL

## IMPORTANTE: Nueva arquitectura disponible

**Si quieres que la app funcione 24/7 sin tu PC encendido**, consulta:
- [RENDER-DEPLOY.md](RENDER-DEPLOY.md) — Backend en Render Free (0€/mes)
- [MIGRATION-VPS.md](MIGRATION-VPS.md) — Backend + Bitcoin Core en VPS (~5€/mes)

La guia de abajo es para **deploy local con Tailscale** (requiere PC encendido).

---

Complete deployment guide for running a public mining pool backed by your local Bitcoin Core.

---

## Architecture

```
Internet → Vercel (frontend static) → WebSocket → Tu PC (backend) → Bitcoin Core
```

- **Frontend** (Vercel): HTML + JS + SHA-256d Web Workers
- **Backend** (tu PC): Node.js + WebSocket server + Bitcoin Core RPC
- **Tunnel**: Tailscale Funnel (gratuito, sin dominio)

**Todo gratis.** Zero VPS, zero hosting costs.

---

## PARTE 1: Backend en tu PC

### 1.1 Requisitos

- Windows 10/11
- Node.js 18+ instalado
- Bitcoin Core sincronizado en mainnet
- `bitcoin-cli` funcional

### 1.2 Configurar .env

```powershell
cd C:\Users\Pere\old-btc-miner-v5-definitivo
copy .env.example .env
notepad .env
```

Edita `.env`:
```
BITCOIN_CLI=C:\Program Files\Bitcoin\daemon\bitcoin-cli.exe
PAYOUT_ADDRESS=tu_direccion_btc_aqui
SHARE_DIFFICULTY=16
PORT=3000
CORS_ORIGIN=*
MAX_MINERS=100
```

### 1.3 Instalar dependencias

```powershell
npm install
```

### 1.4 Arrancar Bitcoin Core

Asegurate de que `bitcoin.conf` contiene:
```
server=1
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
```

### 1.5 Arrancar el backend

```powershell
start-backend.bat
```

O manualmente:
```powershell
node server.js
```

Deberias ver:
```
OLD BTC MINER V5 POOL -> http://0.0.0.0:3000
WebSocket: ws://0.0.0.0:3000/ws
Payout address: [CONFIGURED]
```

### 1.6 Verificar backend

```powershell
curl http://127.0.0.1:3000/api/health
```

Debe devolver: `{"ok":true,"uptime":...,"miners":0,"version":"5.1.0-pool"}`

```powershell
curl http://127.0.0.1:3000/api/pool-stats
```

Debe devolver stats del pool con `jobManager.currentJobId` no null.

---

## PARTE 2: Tunnel con Tailscale Funnel

### 2.1 Instalar Tailscale

1. Descarga de: https://tailscale.com/download/windows
2. Instala y haz login con tu cuenta (Google/Microsoft/GitHub)
3. Tu PC recibira un hostname estable: `tu-pc.tail1234.ts.net`

### 2.2 Activar Funnel

PowerShell como Administrador:
```powershell
tailscale funnel enable 3000
```

Tu backend ahora es accesible en:
- HTTPS: `https://tu-pc.tail1234.ts.net/`
- WSS: `wss://tu-pc.tail1234.ts.net/ws`

### 2.3 Verificar tunnel

Desde otro dispositivo o navegador:
```
https://tu-pc.tail1234.ts.net/api/health
```

---

## PARTE 3: Frontend en Vercel

### 3.1 Configurar BACKEND_URL

Edita `frontend/config.js`:
```javascript
window.BACKEND_URL='wss://tu-pc.tail1234.ts.net/ws';
```

Reemplaza `tu-pc.tail1234.ts.net` con tu hostname real de Tailscale.

### 3.2 Deploy a Vercel

```powershell
npm install -g vercel
vercel login
vercel --prod
```

Vercel usara `vercel.json` automaticamente. Tu frontend estara en:
```
https://tu-proyecto.vercel.app
```

### 3.3 Verificar frontend

1. Abre `https://tu-proyecto.vercel.app` en un navegador
2. Deberias ver la UI CRT verde/negro
3. Haz click en [ START MINING ]
4. El navegador debe mostrar:
   - "WEBSOCKET CONNECTED"
   - "MINER ID: miner_xxx"
   - "MINING // N WORKERS"
   - Hasrate > 0

---

## PARTE 4: Verificacion Completa

### 4.1 Desde el backend

```powershell
curl http://127.0.0.1:3000/api/pool-stats
```

Deberias ver `minersOnline: 1` (o mas si hay navegadores conectados).

### 4.2 Desde el navegador

Abre la consola del navegador (F12):
- Sin errores
- WebSocket conectado
- Shares siendo reportadas
- Job height actualizado

### 4.3 Test de mineria real (sin encontrar bloque)

1. Abre el frontend en multiples navegadores/pestanas
2. Cada uno debe recibir un minerId unico
3. El pool-stats debe mostrar minersOnline incrementando
4. Los shares deben ser aceptados si cumplen el share target
5. NO se muestra BTC ficticio — REWARD = 0 BTC hasta bloque real

---

## Seguridad

- Bitcoin Core RPC NO esta expuesto a Internet
- `.env` con payout address esta SOLO en tu PC
- El navegador NUNCA recibe credenciales
- CORS configurable en `.env`
- Rate limiting activo (60 msg/min, 30 shares/min por miner)
- Max miners configurable

---

## Troubleshooting

| Problema | Solucion |
|----------|----------|
| Backend no arranca | Verifica que Bitcoin Core esta corriendo |
| "Payout address: [NOT SET]" | Edita `.env` y pon tu direccion |
| WebSocket no conecta | Verifica `tailscale funnel enable 3000` |
| Frontend no muestra stats | Verifica `frontend/config.js` tiene URL correcta |
| Shares rechazados | Normal si no cumplen shareTarget, el worker sigue |
| "job not found" | Job expiro, el frontend recibe uno nuevo automaticamente |

---

## Archivos del proyecto

```
old-btc-miner-v5-definitivo/
├── server.js                 ← Backend pool (Node.js + WebSocket)
├── .env                      ← Config local (NO subir a git)
├── .env.example              ← Template
├── start-backend.bat         ← Arranque rapido Windows
├── lib/
│   ├── config.js             ← Carga .env
│   ├── block-builder.js      ← Mineria (extraida de server.js original)
│   ├── job-manager.js        ← Gestion de jobs y stale detection
│   ├── share-validator.js    ← Validacion server-side de shares
│   ├── miner-tracker.js      ← Tracking de mineros y stats
│   └── rate-limiter.js       ← Control de abuso
├── public/                   ← Frontend local (dev/test)
├── frontend/                 ← Frontend para Vercel
│   ├── config.js             ← BACKEND_URL (editar antes de deploy)
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── sha256d.js            ← Motor SHA-256d validado
│   └── worker.js             ← Web Worker con share reporting
├── test/                     ← Tests
│   ├── sha256d.test.js
│   ├── midstate.test.js
│   ├── serialization.test.js
│   ├── core.test.js
│   ├── integration.test.js   ← vs Bitcoin Core Mainnet
│   ├── pool-modules.test.js  ← Unit tests de lib/
│   └── pool-protocol.test.js ← WebSocket protocol tests
├── vercel.json               ← Config Vercel
├── TAILSCALE.md              ← Guia Tailscale detallada
└── DEPLOY.md                 ← Este archivo
```

---

## Comandos

```powershell
npm test                  ← Tests unitarios + pool modules
npm run test:pool         ← WebSocket protocol test
npm run test:integration  ← vs Bitcoin Core Mainnet
npm run bench             ← Benchmark SHA-256d
npm start                 ← Arrancar backend
```
