const WebSocket = require('ws');

console.log('=== PRUEBA DE REGISTRO DETALLADA ===\n');

const wsUrl = 'wss://ceiling-phantom-environment-ease.trycloudflare.com/ws';
const btcAddress = 'bc1qd2fu79gkkn8juju67t066jhwpw6r4t3plxsamn';

console.log('Conectando a:', wsUrl);
console.log('Dirección BTC:', btcAddress.substring(0, 10) + '...\n');

const ws = new WebSocket(wsUrl, {
  headers: { 'Origin': 'https://mining-btc.vercel.app' }
});

let minerId = null;
const startTime = Date.now();

function log(msg) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[${elapsed}s] ${msg}`);
}

const timeout = setTimeout(() => {
  log('TIMEOUT: Test completado');
  ws.close();
  process.exit(0);
}, 10000);

ws.on('open', () => {
  log('✓ WebSocket conectado');
  
  // Enviar registro inmediatamente
  setTimeout(() => {
    const registerMsg = {
      type: 'register',
      btcAddress: btcAddress,
      googleToken: null
    };
    log('Enviando mensaje register:');
    log(JSON.stringify(registerMsg, null, 2));
    ws.send(JSON.stringify(registerMsg));
  }, 100);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  log(`✓ Mensaje recibido: ${msg.type}`);
  
  if (msg.type === 'welcome') {
    minerId = msg.minerId;
    log(`  minerId: ${minerId}`);
    log(`  version: ${msg.version}`);
  }
  
  if (msg.type === 'registered') {
    log(`  ✓ REGISTRO EXITOSO`);
    log(`  accountId: ${msg.accountId}`);
    log(`  btcAddress: ${msg.btcAddress.substring(0, 10)}...`);
    log(`  isNew: ${msg.isNew}`);
    log(`  verified: ${msg.verified}`);
  }
  
  if (msg.type === 'registerFailed') {
    log(`  ✗ REGISTRO FALLIDO`);
    log(`  Error: ${msg.error}`);
  }
  
  if (msg.type === 'newJob') {
    log(`  jobId: ${msg.jobId}`);
    log(`  height: ${msg.height}`);
    log(`  hasHeader: ${!!msg.header}`);
    log(`  hasMidstate: ${!!msg.midstate}`);
  }
  
  if (msg.type === 'error') {
    log(`  Error: ${msg.error}`);
  }
});

ws.on('error', (error) => {
  log(`✗ WebSocket error: ${error.message}`);
});

ws.on('close', (code, reason) => {
  log(`✗ WebSocket cerrado`);
  log(`  Código: ${code}`);
  log(`  Razón: ${reason}`);
  clearTimeout(timeout);
  process.exit(code === 1000 ? 0 : 1);
});
