# MIGRACION A VPS — FASE B (Bitcoin Core 24/7)

Cuando quieras que Bitcoin Core funcione 24/7 sin tu PC encendido.

## Opciones de VPS (ordenadas por precio)

### Opcion 1: Hetzner CX22 (~4.5€/mes) — RECOMENDADO

| Spec | Valor |
|------|-------|
| vCPU | 2 |
| RAM | 4 GB |
| Disco | 40 GB SSD |
| Trafico | 20 TB |
| Localizacion | Falkenstein (DE), Ashburn (US), Hillsboro (US) |
| URL | https://www.hetzner.com/cloud

Suficiente para Bitcoin Core pruned + backend Node.js.

### Opcion 2: Netcup VPS 1000 (~5€/mes)

| Spec | Valor |
|------|-------|
| vCPU | 2 |
| RAM | 4 GB |
| Disco | 80 GB SSD |
| URL | https://www.netcup.de |

### Opcion 3: Contabo (~6€/mes)

| Spec | Valor |
|------|-------|
| vCPU | 4 |
| RAM | 8 GB |
| Disco | 50 GB SSD / 200 GB NVMe |
| URL | https://contabo.com |

## PASO 1: Crear VPS

1. Registrate en Hetzner (o proveedor elegido)
2. Crea un servidor: Ubuntu 22.04 o 24.04, CX22 o superior
3. Espera a que te den la IP publica

## PASO 2: Conectarse al VPS

```bash
ssh root@TU_IP_VPS
```

## PASO 3: Instalar Bitcoin Core (pruned)

```bash
apt update && apt upgrade -y
apt install -y software-properties-common
add-apt-repository -y ppa:bitcoin/bitcoin
apt update
apt install -y bitcoind
```

Crear usuario dedicado:
```bash
useradd -m -s /bin/bash btcpool
```

Configurar bitcoin.conf:
```bash
mkdir -p /home/btcpool/.bitcoin
cat > /home/btcpool/.bitcoin/bitcoin.conf << 'EOF'
server=1
daemon=1
prune=5000
rpcuser=btcpool
rpcpassword=CAMBIA_ESTO_POR_UN_PASSWORD_SEGURO
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
txindex=0
EOF
chown -R btcpool:btcpool /home/btcpool/.bitcoin
```

NOTA: `prune=5000` = 5GB max. Suficiente para operar. NO permite `txindex=1` con pruning.

Crear systemd service:
```bash
cat > /etc/systemd/system/bitcoind.service << 'EOF'
[Unit]
Description=Bitcoin Core Daemon
After=network.target

[Service]
User=btcpool
Group=btcpool
Type=forking
PIDFile=/home/btcpool/.bitcoin/bitcoind.pid
ExecStart=/usr/bin/bitcoind -daemon -conf=/home/btcpool/.bitcoin/bitcoin.conf
ExecStop=/usr/bin/bitcoin-cli -rpcuser=btcpool -rpcpassword=CAMBIA_ESTO_POR_UN_PASSWORD_SEGURO stop
Restart=always
RestartSec=10
TimeoutSec=600

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable bitcoind
systemctl start bitcoind
```

Verificar:
```bash
systemctl status bitcoind
tail -f /home/btcpool/.bitcoin/debug.log
```

Bitcoin Core empieza a sincronizar. Con pruned, la primera sincronizacion tarda 6-24 horas dependiendo de la conexion.

Verificar progreso:
```bash
bitcoin-cli -rpcuser=btcpool -rpcpassword=CAMBIA_ESTO_POR_UN_PASSWORD_SEGURO getblockchaininfo | grep verificationprogress
```

## PASO 4: Instalar Node.js + Backend

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

mkdir -p /opt/btc-pool
cd /opt/btc-pool

# Clonar repositorio
git clone https://github.com/fileLOL/old-btc-miner-v5-definitivo.git .

npm install
```

Crear .env:
```bash
cat > /opt/btc-pool/.env << 'EOF'
BITCOIN_RPC_URL=http://127.0.0.1:8332
BITCOIN_RPC_USER=btcpool
BITCOIN_RPC_PASSWORD=CAMBIA_ESTO_POR_UN_PASSWORD_SEGURO
PAYOUT_ADDRESS=bc1q...tu-direccion-aqui
SHARE_DIFFICULTY=7000000000000000
PORT=3000
CORS_ORIGIN=https://mining-bitcoin.vercel.app
MAX_MINERS=100
PAYOUT_DRY_RUN=true
POOL_FEE_PERCENT=2
PPLNS_WINDOW_SIZE=10000
MIN_PAYOUT_SAT=50000
EOF
```

NOTA: En el VPS, `BITCOIN_RPC_URL=http://127.0.0.1:8332` porque Bitcoin Core y el backend estan en la misma maquina.

## PASO 5: Systemd para el backend

```bash
cat > /etc/systemd/system/btc-pool.service << 'EOF'
[Unit]
Description=BTC Miner Pool Backend
After=bitcoind.service
Requires=bitcoind.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/btc-pool
ExecStart=/usr/bin/node server-render.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable btc-pool
systemctl start btc-pool
```

Verificar:
```bash
systemctl status btc-pool
curl http://127.0.0.1:3000/api/health
```

## PASO 6: Nginx como reverse proxy con SSL

```bash
apt install -y nginx certbot python3-certbot-nginx

cat > /etc/nginx/sites-available/btc-pool << 'EOF'
server {
    listen 80;
    server_name TU_DOMINIO_AQUI;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
EOF

ln -s /etc/nginx/sites-available/btc-pool /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

certbot --nginx -d TU_DOMINIO_AQUI
```

## PASO 7: Actualizar frontend

Edita `frontend/config.js`:
```javascript
window.BACKEND_URL=window.BACKEND_URL||'wss://TU_DOMINIO_AQUI';
```

Edita .env del VPS:
```
CORS_ORIGIN=https://mining-bitcoin.vercel.app
```

Redeploy frontend:
```powershell
git push origin master
```

## PASO 8: Apagar Render (dejar de usar free tier)

En Render Dashboard → Settings → Delete Service.

O mantener Render como fallback si quieres.

## VERIFICACION FINAL

1. PC apagado
2. Abre https://mining-bitcoin.vercel.app
3. Bitcoin Core debe mostrar "CONNECTED"
4. Blockchain data visible (height, difficulty, hashrate)
5. Template se carga
6. Mining funciona
7. WebSocket conectado
8. Shares se aceptan

## ARQUITECTURA FINAL FASE B

```
Browser → Vercel (frontend, 0€) → VPS Hetzner (~5€/mes)
                                    ├── Nginx (reverse proxy + SSL)
                                    ├── Node.js (server-render.js)
                                    ├── Bitcoin Core (pruned, mainnet)
                                    ├── SQLite (pool.db, persistente)
                                    └── WebSocket
```

| Servicio | Funcion | Coste | Persistente | Depende de PC |
|----------|---------|-------|-------------|---------------|
| Vercel | Frontend | 0€ | Si | No |
| Hetzner VPS | Backend + BTC | ~5€/mes | Si | No |
| Bitcoin Core pruned | Nodo real | Incluido | Si (40GB disco) | No |
| **TOTAL** | | **~5€/mes** | | **NO** |
