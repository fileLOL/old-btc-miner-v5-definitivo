// Test script simplificado - Solo WebSocket
const WebSocket = require('ws');

console.log('=== TEST WEBSOCKET COMPLETO ===\n');

const ws = new WebSocket('wss://desktop-8imie7p.tailfdb082.ts.net/ws', {
  headers: { 'Origin': 'https://mining-btc.vercel.app' }
});

const timeout = setTimeout(() => {
  console.log('\nTIMEOUT: No se recibió newJob en 15s');
  ws.close();
  process.exit(1);
}, 15000);

ws.on('open', () => {
  console.log('1. WebSocket: Connected ✓');
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  
  if (message.type === 'welcome') {
    console.log('2. Welcome recibido ✓');
    console.log('   - minerId:', message.minerId);
    console.log('   - version:', message.version);
    
    // Simular registro
    setTimeout(() => {
      ws.send(JSON.stringify({
        type: 'register',
        btcAddress: 'bc1qd2fu79gkkn8juju67t066jhwpw6r4t3plxsamn'
      }));
      console.log('3. Register enviado ✓');
    }, 500);
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
    console.log('   - has header:', !!message.header, '(' + (message.header ? message.header.length : 0) + ' bytes)');
    console.log('   - has midstate:', !!message.midstate, '(' + (message.midstate ? message.midstate.length : 0) + ' bytes)');
    console.log('   - has bodyHex:', !!message.bodyHex, '(' + (message.bodyHex ? message.bodyHex.length : 0) + ' chars)');
    console.log('   - coinbasevalue:', message.coinbasevalue, 'sat');
    
    clearTimeout(timeout);
    
    console.log('\n=== TEST EXITOSO ===');
    console.log('El frontend debería poder conectarse y recibir trabajo correctamente.');
    
    ws.close();
    setTimeout(() => process.exit(0), 1000);
  }
});

ws.on('error', (error) => {
  console.log('\nERROR:', error.message);
  clearTimeout(timeout);
  process.exit(1);
});

ws.on('close', () => {
  console.log('\nWebSocket: Closed');
});
