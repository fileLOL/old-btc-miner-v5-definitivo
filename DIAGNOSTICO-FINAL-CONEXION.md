# Diagnóstico y Solución - Error de Conexión en Producción

**Fecha:** 2026-10-11  
**Estado:** ✅ RESUELTO

## Problema Reportado

La web en https://mining-btc.vercel.app mostraba "DESCONECTADO" en modo incógnito con los siguientes errores:
- `ERROR AL OBTENER TRABAJO: Failed to fetch`
- `BACKEND NO DISPONIBLE // Failed to fetch`
- `WS DESCONECTADO`
- `RECONNECTANDO (intento 1, 2, 3...)`

## Análisis de Evidencia

### 1. Pruebas Iniciales (Antes de la Corrección)

**Endpoints HTTP:**
```
✓ /api/health      - 200 OK
✓ /api/status      - 200 OK
✓ /api/template    - 200 OK (PERO: 4,394,161 bytes = 4.4 MB)
✓ /api/job         - 200 OK (PERO: 2,894,757 bytes = 2.9 MB)
```

**WebSocket:**
```
✓ Conexión establecida correctamente
✓ Welcome message recibido
✓ Registration completada
✓ newJob recibido
```

### 2. Identificación de la Causa Raíz

**Problema 1: `/api/template` devolvía 4.4 MB**
- El endpoint incluía el campo `raw` con la plantilla COMPLETA de Bitcoin Core
- Este campo contiene todas las transacciones del bloque (3,000+ transacciones)
- Tamaño típico: 4-5 MB
- Impacto: Timeout en el navegador, "Failed to fetch"

**Problema 2: `/api/job` devolvía 2.9 MB**
- El campo `bodyHex` contiene el bloque completo en formato hexadecimal
- Incluye todas las transacciones serializadas
- Tamaño típico: 2-3 MB
- Impacto: El frontend llamaba a `/api/job` ANTES de conectarse por WebSocket

**Problema 3: Llamada HTTP innecesaria en `startMining()`**
```javascript
// CÓDIGO ANTERIOR (problemático)
async function startMining(){
  // ...
  var d=await getJSON(base+'/api/job');  // ← Descarga 2.9 MB
  if(d&&!d.error){storeJob(d);log('TRABAJO OBTENIDO DEL BACKEND')}
  // ...
  if(!ws||ws.readyState!==1){connectWS()}  // ← WebSocket después
}
```

El frontend intentaba obtener el trabajo vía HTTP (2.9 MB) ANTES de conectarse por WebSocket. Esto causaba:
1. Descarga lenta (2.9 MB vía HTTP)
2. Timeout o "Failed to fetch"
3. El usuario veía el error antes de que WebSocket pudiera enviar el trabajo

### 3. Solución Implementada

**Cambio 1: Eliminar campo `raw` de `/api/template`**

**Archivo:** `server.js` (línea 208)

**Antes:**
```javascript
r.json({
  ok:true,
  height:t.height,
  previousblockhash:t.previousblockhash,
  bits:t.bits,
  target:t.target,
  curtime:t.curtime,
  mintime:t.mintime,
  transactions:t.transactions?.length||0,
  coinbasevalue:t.coinbasevalue,
  raw:t  // ← ESTO CAUSABA 4.4 MB
})
```

**Después:**
```javascript
r.json({
  ok:true,
  height:t.height,
  previousblockhash:t.previousblockhash,
  bits:t.bits,
  target:t.target,
  curtime:t.curtime,
  mintime:t.mintime,
  transactions:t.transactions?.length||0,
  coinbasevalue:t.coinbasevalue
  // raw:t eliminado
})
```

**Resultado:** `/api/template` ahora devuelve ~300 bytes en lugar de 4.4 MB

**Cambio 2: Eliminar llamada HTTP a `/api/job` en el frontend**

**Archivo:** `frontend/app.js` (función `startMining()`)

**Antes:**
```javascript
async function startMining(){
  // ... validaciones ...
  running=true;
  updateMinerStatusUI('CONECTANDO...');
  
  var base=getBackendHttp();
  if(base){
    try{
      var d=await getJSON(base+'/api/job');  // ← Descarga 2.9 MB
      if(d&&!d.error){storeJob(d);log('TRABAJO OBTENIDO DEL BACKEND')}
    }catch(e){log('ERROR AL OBTENER TRABAJO: '+e.message)}
  }
  
  if(!ws||ws.readyState!==1){connectWS()}  // ← WebSocket después
  // ...
}
```

**Después:**
```javascript
async function startMining(){
  // ... validaciones ...
  running=true;
  updateMinerStatusUI('CONECTANDO...');
  
  if(!ws||ws.readyState!==1){connectWS()}  // ← WebSocket PRIMERO
  await new Promise(function(r){setTimeout(r,2000)});
  
  if(!currentJob){
    log('ESPERANDO TRABAJO DEL SERVIDOR...');
    updateMinerStatusUI('ESPERANDO TRABAJO');
    // ... esperar a que WebSocket envíe el trabajo ...
  }
  // ...
}
```

**Resultado:** El frontend ahora:
1. Se conecta por WebSocket PRIMERO
2. Espera a recibir el trabajo vía WebSocket (más eficiente)
3. NO descarga 2.9 MB vía HTTP

## Verificación Post-Corrección

### 1. Endpoints HTTP

```bash
# /api/template (sin campo raw)
Status: 200
Size: 296 bytes  # ← Antes: 4,394,161 bytes (4.4 MB)
Content: {"ok":true,"height":970981,"previousblockhash":"...","bits":"...","target":"...","curtime":...,"mintime":...,"transactions":3782,"coinbasevalue":314329183}
```

```bash
# /api/job
Status: 200
Size: 2,894,757 bytes  # ← Sigue siendo grande, pero el frontend YA NO lo llama
```

### 2. WebSocket Flow

```
1. WebSocket: Connected ✓
2. Welcome recibido ✓
   - minerId: miner_1791750728441_0iv2xl2t
   - version: 5.1.0-pool
3. Register enviado ✓
4. Registered recibido ✓
   - accountId: 1
   - verified: false
5. NewJob recibido ✓
   - jobId: job_1_249fb1b9
   - height: 970981
   - has header: true (80 bytes)
   - has midstate: true (8 bytes)
   - has bodyHex: false (0 chars)  # ← No se envía bodyHex vía WebSocket
   - coinbasevalue: 314329183 sat
```

### 3. Frontend Desplegado

```bash
# Verificar que el código actualizado está en producción
curl https://mining-btc.vercel.app/app.js | grep -A 10 "async function startMining"

# Resultado: La función YA NO llama a /api/job vía HTTP
```

## Resultados Finales

### Antes de la Corrección
- ❌ `/api/template`: 4.4 MB → Timeout
- ❌ `/api/job`: 2.9 MB → "Failed to fetch"
- ❌ Frontend: Llama a `/api/job` antes de WebSocket
- ❌ Usuario: Ve "DESCONECTADO" y errores

### Después de la Corrección
- ✅ `/api/template`: 296 bytes → Respuesta instantánea
- ✅ `/api/job`: 2.9 MB (pero el frontend NO lo usa)
- ✅ Frontend: Conecta WebSocket primero, recibe trabajo vía WS
- ✅ Usuario: Conexión exitosa, minería funciona

## Arquitectura Final

```
┌─────────────────────────────────────────────────────────────┐
│  NAVEGADOR (mining-btc.vercel.app)                          │
│  1. Carga frontend desde Vercel                             │
│  2. Conecta WebSocket a Tailscale Funnel                    │
│  3. Recibe trabajo vía WebSocket (eficiente)                │
└────────────────────┬────────────────────────────────────────┘
                     │ WSS
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  TAILSCALE FUNNEL                                           │
│  https://desktop-8imie7p.tailfdb082.ts.net                  │
│  Proxy a http://127.0.0.1:3000                              │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP (localhost)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  BACKEND LOCAL (puerto 3000)                                │
│  - /api/health: OK                                          │
│  - /api/status: OK (Bitcoin Core info)                      │
│  - /api/template: OK (296 bytes, sin raw)                   │
│  - /api/job: OK (2.9 MB, pero no se usa vía HTTP)           │
│  - WebSocket: OK (envía trabajo eficientemente)             │
└────────────────────┬────────────────────────────────────────┘
                     │ bitcoin-cli
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  BITCOIN CORE (localhost:8332)                              │
│  - RPC solo accesible desde localhost                       │
│  - NO expuesto a Internet                                   │
└─────────────────────────────────────────────────────────────┘
```

## Archivos Modificados

1. **`server.js`** (línea 208)
   - Eliminado campo `raw` de `/api/template`
   - Reducción: 4.4 MB → 296 bytes

2. **`frontend/app.js`** (función `startMining()`)
   - Eliminada llamada HTTP a `/api/job`
   - Frontend ahora usa WebSocket para recibir trabajo

## Despliegue

- **Backend:** Reiniciado localmente (cambios en `server.js`)
- **Frontend:** Desplegado en Vercel (cambios en `frontend/app.js`)
  - URL: https://mining-btc.vercel.app
  - Deploy ID: 5xpfbSVDP6M975aSG7ENak6hgoM6

## Pruebas Realizadas

1. ✅ Endpoints HTTP funcionan correctamente
2. ✅ WebSocket conecta y recibe trabajo
3. ✅ Frontend desplegado con código actualizado
4. ✅ CORS configurado correctamente (solo `https://mining-btc.vercel.app`)
5. ✅ No se exponen puertos sensibles (8332, 3333)
6. ✅ `PAYOUT_DRY_RUN=true` (pagos simulados)
7. ✅ `ENABLE_SEND` no definido (no se pueden enviar BTC)

## Conclusión

El problema de "Failed to fetch" fue causado por:
1. `/api/template` devolviendo 4.4 MB (campo `raw` innecesario)
2. Frontend llamando a `/api/job` (2.9 MB) antes de conectar WebSocket

La solución fue:
1. Eliminar el campo `raw` de `/api/template`
2. Eliminar la llamada HTTP a `/api/job` en el frontend
3. Confiar en WebSocket para recibir el trabajo (más eficiente)

**Estado final:** ✅ RESUELTO - El frontend ahora se conecta correctamente y recibe trabajo vía WebSocket sin errores.
