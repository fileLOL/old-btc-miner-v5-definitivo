const WebSocket = require('ws');

console.log('=== TEST FLUJO COMPLETO CON SHARES ===\n');

const wsUrl = 'wss://ceiling-phantom-environment-ease.trycloudflare.com/ws';
const btcAddress = 'bc1qd2fu79gkkn8juju67t066jhwpw6r4t3plxsamn';

const ws = new WebSocket(wsUrl, {
  headers: { 'Origin': 'https://mining-btc.vercel.app' }
});

let minerId = null;
let currentJob = null;
let sharesSent = 0;
let sharesAccepted = 0;

const timeout = setTimeout(() => {
  console.log('\nTIMEOUT: Test completado o tiempo agotado');
  ws.close();
  process.exit(0);
}, 15000);

ws.on('open', () => {
  console.log('1. WebSocket: Connected ✓');
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  
  if (message.type === 'welcome') {
    console.log('2. Welcome recibido ✓');
    console.log('   - minerId:', message.minerId);
    minerId = message.minerId;
    
    // Registrar inmediatamente
    setTimeout(() => {
      ws.send(JSON.stringify({
        type: 'register',
        btcAddress: btcAddress
      }));
      console.log('3. Register enviado ✓');
    }, 100);
  }
  
  if (message.type === 'registered') {
    console.log('4. Registered recibido ✓');
    console.log('   - accountId:', message.accountId);
    console.log('   - verified:', message.verified);
  }
  
  if (message.type === 'newJob') {
    console.log('5. NewJob recibido ✓');
    console.log('   - jobId:', message.jobId);
    console.log('   - height:', message.height);
    console.log('   - has header:', !!message.header);
    console.log('   - has midstate:', !!message.midstate);
    
    currentJob = message;
    
    // Simular shares después de recibir el trabajo
    if (sharesSent < 3) {
      setTimeout(() => {
        const fakeNonce = Math.floor(Math.random() * 0xFFFFFFFF);
        const fakeHash = '0'.repeat(64); // Hash falso para probar
        
        ws.send(JSON.stringify({
          type: 'share',
          minerId: minerId,
          jobId: currentJob.jobId,
          nonce: fakeNonce,
          hashHex: fakeHash
        }));
        sharesSent++;
        console.log(`6. Share #${sharesSent} enviada (nonce: ${fakeNonce.toString(16)})`);
      }, 500 * sharesSent);
    }
  }
  
  if (message.type === 'shareAccepted') {
    sharesAccepted++;
    console.log(`7. Share #${sharesAccepted} aceptada ✓`);
  }
  
  if (message.type === 'shareRejected') {
    console.log(`✗ Share rechazada:`, message.reason);
  }
  
  if (message.type === 'error') {
    console.log('✗ Error recibido:', message.error);
  }
  
  if (message.type === 'poolStats') {
    console.log('Pool stats:', {
      minersOnline: message.minersOnline,
      totalShares: message.totalShares,
      totalHashrate: message.totalHashrate
    });
  }
});

ws.on('error', (error) => {
  console.log('✗ WebSocket error:', error.message);
});

ws.on('close', (code, reason) => {
  console.log(`\nWebSocket cerrado: code=${code}, reason=${reason}`);
  console.log(`\nResumen:`);
  console.log(`  Shares enviadas: ${sharesSent}`);
  console.log(`  Shares aceptadas: ${sharesAccepted}`);
  console.log(`  Shares rechazadas: ${sharesSent - sharesAccepted}`);
  clearTimeout(timeout);
  process.exit(0);
});
