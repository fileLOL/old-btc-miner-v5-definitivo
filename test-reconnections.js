const WebSocket = require('ws');

console.log('=== PRUEBA DE RECONEXIONES MÚLTIPLES ===\n');

const wsUrl = 'wss://ceiling-phantom-environment-ease.trycloudflare.com/ws';
const btcAddress = 'bc1qd2fu79gkkn8juju67t066jhwpw6r4t3plxsamn';

function testConnection(connectionNum) {
  return new Promise((resolve) => {
    console.log(`\n--- Conexión #${connectionNum} ---`);
    
    const ws = new WebSocket(wsUrl, {
      headers: { 'Origin': 'https://mining-btc.vercel.app' }
    });
    
    const startTime = Date.now();
    let registered = false;
    
    const timeout = setTimeout(() => {
      console.log(`  ✗ TIMEOUT`);
      ws.close();
      resolve(false);
    }, 5000);
    
    ws.on('open', () => {
      console.log(`  ✓ WebSocket conectado`);
      
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'register',
          btcAddress: btcAddress,
          googleToken: null
        }));
      }, 100);
    });
    
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === 'registered') {
        registered = true;
        const elapsed = Date.now() - startTime;
        console.log(`  ✓ Registro exitoso (${elapsed}ms)`);
        console.log(`  - accountId: ${msg.accountId}`);
        console.log(`  - isNew: ${msg.isNew}`);
      }
      
      if (msg.type === 'registerFailed') {
        console.log(`  ✗ Registro fallido: ${msg.error}`);
      }
      
      if (msg.type === 'error') {
        console.log(`  ✗ Error: ${msg.error}`);
      }
    });
    
    ws.on('close', (code, reason) => {
      clearTimeout(timeout);
      if (code !== 1000 && registered) {
        console.log(`  ✓ Cerrado normalmente (código: ${code})`);
      } else if (!registered) {
        console.log(`  ✗ Cerrado antes de registrar (código: ${code})`);
      }
      resolve(registered);
    });
    
    ws.on('error', (error) => {
      clearTimeout(timeout);
      console.log(`  ✗ Error: ${error.message}`);
      resolve(false);
    });
    
    // Cerrar después de 2 segundos si se registró
    setTimeout(() => {
      if (registered && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }, 2000);
  });
}

async function runTests() {
  const results = [];
  
  // Probar 5 conexiones secuenciales
  for (let i = 1; i <= 5; i++) {
    const result = await testConnection(i);
    results.push(result);
    
    // Esperar 500ms entre conexiones
    if (i < 5) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log('\n=== RESUMEN ===');
  console.log(`Conexiones exitosas: ${results.filter(r => r).length}/${results.length}`);
  
  if (results.every(r => r)) {
    console.log('✓ Todas las reconexiones funcionaron correctamente');
    process.exit(0);
  } else {
    console.log('✗ Algunas reconexiones fallaron');
    process.exit(1);
  }
}

runTests();
