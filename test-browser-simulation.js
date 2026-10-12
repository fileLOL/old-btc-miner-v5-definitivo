// Test script para simular el comportamiento del navegador
const WebSocket = require('ws');

console.log('=== SIMULACIÓN DE NAVEGADOR ===\n');

// 1. Test HTTP endpoints
console.log('1. Probando endpoints HTTP...');
const fetch = require('node-fetch');

async function testEndpoints() {
  try {
    // Health check
    const health = await fetch('https://desktop-8imie7p.tailfdb082.ts.net/api/health', {
      headers: { 'Origin': 'https://mining-btc.vercel.app' }
    });
    console.log('   /api/health:', health.status, health.ok ? 'OK' : 'FAIL');
    
    // Template (sin raw)
    const template = await fetch('https://desktop-8imie7p.tailfdb082.ts.net/api/template', {
      headers: { 'Origin': 'https://mining-btc.vercel.app' }
    });
    const templateData = await template.json();
    console.log('   /api/template:', template.status, `size=${JSON.stringify(templateData).length} bytes`, template.ok ? 'OK' : 'FAIL');
    console.log('   - height:', templateData.height);
    console.log('   - transactions:', templateData.transactions);
    console.log('   - has raw field:', 'raw' in templateData);
    
    // Job
    const job = await fetch('https://desktop-8imie7p.tailfdb082.ts.net/api/job', {
      headers: { 'Origin': 'https://mining-btc.vercel.app' }
    });
    const jobData = await job.json();
    console.log('   /api/job:', job.status, `size=${JSON.stringify(jobData).length} bytes`, job.ok ? 'OK' : 'FAIL');
    
  } catch (error) {
    console.log('   ERROR:', error.message);
  }
}

// 2. Test WebSocket
console.log('\n2. Probando WebSocket...');
function testWebSocket() {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://desktop-8imie7p.tailfdb082.ts.net/ws', {
      headers: { 'Origin': 'https://mining-btc.vercel.app' }
    });
    
    const timeout = setTimeout(() => {
      console.log('   TIMEOUT: No se recibió respuesta en 10s');
      ws.close();
      resolve();
    }, 10000);
    
    ws.on('open', () => {
      console.log('   WebSocket: Connected');
    });
    
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      console.log('   Received:', message.type);
      
      if (message.type === 'welcome') {
        console.log('   - minerId:', message.minerId);
        console.log('   - version:', message.version);
        
        // Simular registro
        setTimeout(() => {
          ws.send(JSON.stringify({
            type: 'register',
            btcAddress: 'bc1qd2fu79gkkn8juju67t066jhwpw6r4t3plxsamn'
          }));
          console.log('   Sent: register');
        }, 500);
      }
      
      if (message.type === 'registered') {
        console.log('   - accountId:', message.accountId);
        console.log('   - verified:', message.verified);
      }
      
      if (message.type === 'newJob') {
        console.log('   - jobId:', message.jobId);
        console.log('   - height:', message.height);
        console.log('   - has header:', !!message.header);
        console.log('   - has midstate:', !!message.midstate);
        console.log('   - has bodyHex:', !!message.bodyHex);
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });
    
    ws.on('error', (error) => {
      console.log('   ERROR:', error.message);
      clearTimeout(timeout);
      resolve();
    });
    
    ws.on('close', () => {
      console.log('   WebSocket: Closed');
    });
  });
}

// Ejecutar tests
(async () => {
  await testEndpoints();
  await testWebSocket();
  console.log('\n=== TEST COMPLETADO ===');
})();
