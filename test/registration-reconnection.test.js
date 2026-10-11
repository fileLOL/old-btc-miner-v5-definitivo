const WebSocket = require('ws');
const path = require('path');

console.log('=== PRUEBA DE REGISTRO CON SESIONES ACTIVAS ===\n');

// Configuración
const WS_URL = process.env.WS_URL || 'ws://localhost:3000/ws';
const BTC_ADDRESS = 'bc1qd2fu79gkkn8juju67t066jhwpw6r4t3plxsamn';
const TEST_TIMEOUT = 10000;

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  return new Promise(async (resolve) => {
    try {
      await fn();
      console.log(`✓ ${name}`);
      testsPassed++;
      resolve(true);
    } catch (error) {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${error.message}`);
      testsFailed++;
      resolve(false);
    }
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function createConnection() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, {
      headers: { 'Origin': 'https://mining-btc.vercel.app' }
    });
    
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout'));
    }, TEST_TIMEOUT);
    
    ws.on('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    
    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function registerAndVerify(ws, address) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Registration timeout'));
    }, TEST_TIMEOUT);
    
    const messageHandler = (data) => {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === 'registered') {
        clearTimeout(timeout);
        ws.removeListener('message', messageHandler);
        resolve(msg);
      }
      
      if (msg.type === 'registerFailed') {
        clearTimeout(timeout);
        ws.removeListener('message', messageHandler);
        reject(new Error(`Registration failed: ${msg.error}`));
      }
    };
    
    ws.on('message', messageHandler);
    
    ws.send(JSON.stringify({
      type: 'register',
      btcAddress: address,
      googleToken: null
    }));
  });
}

async function runTests() {
  console.log('Test 1: Conexión inicial y registro');
  await test('Primera conexión funciona', async () => {
    const ws = await createConnection();
    const result = await registerAndVerify(ws, BTC_ADDRESS);
    assert(result.accountId, 'accountId debe existir');
    assert(result.btcAddress === BTC_ADDRESS, 'btcAddress debe coincidir');
    ws.close();
    await new Promise(resolve => setTimeout(resolve, 500));
  });
  
  console.log('\nTest 2: Reconexión después de cerrar');
  await test('Segunda conexión funciona (sesión anterior cerrada)', async () => {
    const ws = await createConnection();
    const result = await registerAndVerify(ws, BTC_ADDRESS);
    assert(result.accountId, 'accountId debe existir');
    assert(result.btcAddress === BTC_ADDRESS, 'btcAddress debe coincidir');
    ws.close();
    await new Promise(resolve => setTimeout(resolve, 500));
  });
  
  console.log('\nTest 3: Múltiples reconexiones rápidas');
  await test('Tres conexiones secuenciales funcionan', async () => {
    for (let i = 0; i < 3; i++) {
      const ws = await createConnection();
      const result = await registerAndVerify(ws, BTC_ADDRESS);
      assert(result.accountId, `Conexión ${i + 1}: accountId debe existir`);
      ws.close();
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  });
  
  console.log('\nTest 4: Conexión sin cerrar la anterior');
  await test('Nueva conexión reemplaza la anterior', async () => {
    // Primera conexión (no la cerramos inmediatamente)
    const ws1 = await createConnection();
    await registerAndVerify(ws1, BTC_ADDRESS);
    
    // Segunda conexión inmediatamente (la primera sigue abierta)
    const ws2 = await createConnection();
    const result = await registerAndVerify(ws2, BTC_ADDRESS);
    assert(result.accountId, 'accountId debe existir');
    
    // Cerrar ambas
    ws1.close();
    ws2.close();
    await new Promise(resolve => setTimeout(resolve, 500));
  });
  
  console.log('\nTest 5: Dirección BTC diferente');
  await test('Diferente dirección BTC funciona', async () => {
    const differentAddress = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
    const ws = await createConnection();
    const result = await registerAndVerify(ws, differentAddress);
    assert(result.accountId, 'accountId debe existir');
    assert(result.btcAddress === differentAddress, 'btcAddress debe coincidir');
    ws.close();
    await new Promise(resolve => setTimeout(resolve, 500));
  });
  
  console.log('\n=== RESUMEN ===');
  console.log(`Pruebas pasadas: ${testsPassed}`);
  console.log(`Pruebas fallidas: ${testsFailed}`);
  
  if (testsFailed === 0) {
    console.log('\n✓ Todas las pruebas pasaron');
    process.exit(0);
  } else {
    console.log('\n✗ Algunas pruebas fallaron');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Error en las pruebas:', error);
  process.exit(1);
});
