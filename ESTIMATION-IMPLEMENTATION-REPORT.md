# Informe de Implementación: Ganancia Estimada Condicional

**Fecha:** 2026-01-09  
**Objetivo:** Mostrar en el Wallet una estimación orientativa de la contribución del minero sin comprometer la contabilidad real del pool.

---

## Resumen

Se implementó la funcionalidad de "Ganancia Estimada (Condicional)" que muestra al minero una estimación de lo que recibiría si el pool encontrara un bloque en ese momento, basada en:
- La proporción de shares del minero en la ventana PPLNS actual
- El último bloque maduro encontrado por el pool
- La comisión del pool (2%)

**Importante:** Esta estimación NO es una promesa de pago, solo una referencia histórica.

---

## Cambios Realizados

### 1. Backend - reward-engine.js

**Nuevas funciones agregadas:**

#### `getPoolDifficultySnapshot(windowSize)`
- Obtiene las últimas `windowSize` shares de TODOS los mineros
- Calcula la dificultad total del pool en la ventana
- Calcula la dificultad por cada cuenta
- Retorna: `{ totalDifficulty, accountDifficulty (Map), shareCount }`

#### `getEstimatedReward(accountId, windowSize, poolFeePercent)`
- Calcula la estimación de recompensa para un minero específico
- Usa el último bloque maduro como referencia
- Aplica la fórmula PPLNS: `(coinbase - fee) × (miner_difficulty / total_difficulty)`
- Retorna:
  - `estimated_sat`: cantidad estimada en satoshis
  - `has_valid_data`: boolean indicando si hay datos válidos
  - `reason`: razón si no hay datos válidos
  - `reference_block_id`, `reference_block_height`, `reference_coinbase_sat`: datos del bloque de referencia
  - `miner_proportion`: proporción del minero en la ventana
  - `total_difficulty`: dificultad total en la ventana

#### `getLastMatureBlock()`
- Obtiene el último bloque con status='mature'
- Retorna el bloque completo o null si no hay bloques maduros

### 2. Backend - server.js

**Endpoint `/api/my-balance` modificado:**

Se agregaron los siguientes campos a la respuesta:
```json
{
  "estimated_sat": 204166666,
  "estimated_has_data": true,
  "estimated_reason": null,
  "estimated_reference_block": 1,
  "estimated_reference_height": 970067,
  "estimated_reference_coinbase_sat": 312500000,
  "estimated_proportion": 0.6667
}
```

Cuando no hay datos válidos:
```json
{
  "estimated_sat": 0,
  "estimated_has_data": false,
  "estimated_reason": "no shares in window" // o "no mature blocks"
}
```

### 3. Frontend - app.js

**Función `updateWalletUI(d)` modificada:**

Se agregó lógica para mostrar la estimación:
- Si `estimated_has_data` es true: muestra el valor en formato BTC
- Si `estimated_has_data` es false: muestra "N/A" con estilo visual diferente
- Muestra la referencia del bloque (altura) si está disponible

### 4. Frontend - index.html

**Sección "Ganancia estimada (condicional)" agregada:**

```html
<div class="wallet-section">
  <div class="wallet-section-title">Ganancia estimada (condicional)</div>
  <div class="wallet-row-balance">
    <span class="wallet-balance-label">Estimación</span>
    <span class="wallet-balance-value estimated" id="walletEstimated">N/A</span>
  </div>
  <div class="wallet-estimated-reference" id="walletEstimatedReference"></div>
  <div class="wallet-estimated-disclaimer">
    Simulación basada en datos históricos. No es una promesa de pago. 
    Depende de que el pool encuentre bloques, de las reglas PPLNS, 
    de las comisiones y de la maduración.
  </div>
</div>
```

### 5. Frontend - style.css

**Nuevos estilos agregados:**

- `.wallet-balance-value.estimated`: color azul (#42a5f5) para la estimación
- `.wallet-value-na`: estilo para valores "N/A" (gris, cursiva)
- `.wallet-estimated-reference`: estilo para la referencia del bloque
- `.wallet-estimated-disclaimer`: cuadro con fondo azul claro para el mensaje de advertencia

### 6. Tests - test/estimation.test.js

**Nuevo archivo de tests creado con 11 casos de prueba:**

1. **Empty window:** no hay shares, no hay bloques maduros → `has_valid_data: false`, `reason: "no shares in window"`
2. **Shares but no mature blocks:** hay shares pero no hay bloques maduros → `has_valid_data: false`, `reason: "no mature blocks"`
3. **Add mature block:** hay shares y bloque maduro → `has_valid_data: true`, `estimated_sat > 0`
4. **Proportional calculation:** verifica que la proporción se calcula correctamente (minero con 10 shares de 15 totales = 66.67%)
5. **Pool fee deduction:** verifica que se descuenta correctamente el 2% de comisión
6. **Zero difficulty shares:** minero con shares de dificultad 0 → `has_valid_data: false`, `reason: "miner has no shares in window"`
7. **Balances unchanged:** verifica que la estimación NO modifica los balances reales
8. **getLastMatureBlock:** verifica que retorna el bloque correcto
9. **Snapshot with different window sizes:** verifica que el snapshot funciona con diferentes tamaños de ventana
10. **Production DB not touched:** verifica que no se modifica la base de datos de producción
11. **Integration test:** prueba completa con múltiples mineros y bloques

**Resultado:** Todos los tests pasan ✓

---

## Fórmulas Matemáticas

### Proporción del minero
```
miner_proportion = miner_difficulty / total_difficulty
```

Donde:
- `miner_difficulty`: suma de la dificultad de las shares del minero en la ventana PPLNS
- `total_difficulty`: suma de la dificultad de TODAS las shares en la ventana PPLNS

### Estimación de recompensa
```
estimated_sat = (coinbase_value × (1 - pool_fee_percent/100)) × miner_proportion
```

Donde:
- `coinbase_value`: valor del coinbase del último bloque maduro
- `pool_fee_percent`: porcentaje de comisión del pool (2%)
- `miner_proportion`: proporción calculada arriba

### Ejemplo concreto
```
Coinbase: 312,500,000 sat (3.125 BTC)
Pool fee: 2% = 6,250,000 sat
Distributable: 306,250,000 sat
Miner proportion: 10/15 = 66.67%
Estimated reward: 306,250,000 × 0.6667 = 204,166,666 sat
```

---

## Diferencias entre Ventana PPLNS y getSharesInWindow

**IMPORTANTE:** Se identificó que existen dos conceptos diferentes de "ventana":

### 1. Ventana PPLNS (usada para la estimación y recompensas reales)
- **Criterio:** últimas N shares por CANTIDAD
- **Query:** `WHERE created_at <= ? ORDER BY created_at DESC LIMIT ?`
- **Usada en:** `calculatePPLNS()`, `getEstimatedReward()`, `getPoolDifficultySnapshot()`

### 2. Ventana por tiempo (usada para estadísticas)
- **Criterio:** shares de los últimos N segundos
- **Query:** `WHERE created_at >= ?`
- **Usada en:** `getSharesInWindow()`
- **Nota:** Esta ventana es DIFERENTE y no coincide con PPLNS

La estimación usa la ventana PPLNS real, por lo que es defendible y coincide con el cálculo de recompensas reales.

---

## Verificaciones de Seguridad

### ✓ No modifica balances
La función `getEstimatedReward()` es de solo lectura, no ejecuta UPDATE ni INSERT en la base de datos.

### ✓ No inventa BTC
La estimación se calcula estrictamente a partir del último bloque maduro real, descontando la comisión del pool.

### ✓ No persiste datos
La estimación se calcula en cada llamada al endpoint y no se guarda en ninguna tabla.

### ✓ Muestra "N/A" cuando no hay datos
Si no hay shares en la ventana o no hay bloques maduros, se muestra "N/A" en lugar de inventar un valor.

### ✓ Disclaimer explícito
El frontend muestra un mensaje claro indicando que es una simulación y no una promesa de pago.

---

## Archivos Modificados

| Archivo | Tipo | Descripción |
|---------|------|-------------|
| `lib/reward-engine.js` | MODIFICADO | Agregadas 3 funciones nuevas |
| `server.js` | MODIFICADO | Endpoint `/api/my-balance` actualizado |
| `frontend/app.js` | MODIFICADO | Función `updateWalletUI()` actualizada |
| `frontend/index.html` | MODIFICADO | Sección "Ganancia estimada" agregada |
| `frontend/style.css` | MODIFICADO | Estilos para estimación agregados |
| `public/*` | COPIADO | Sincronizado desde frontend/ |
| `test/estimation.test.js` | NUEVO | 11 tests de estimación |
| `package.json` | MODIFICADO | Test agregado al script `npm test` |

---

## Resultados de Tests

### Tests ejecutados: 22 suites, ~250 tests

| Suite | Tests | Estado |
|-------|-------|--------|
| sha256d.test.js | 4 suites | ✅ PASS |
| midstate.test.js | 1 suite | ✅ PASS |
| serialization.test.js | 1 suite | ✅ PASS |
| core.test.js | 1 suite | ✅ PASS |
| address-validator.test.js | 20 tests | ✅ PASS |
| account-manager.test.js | 23 tests | ✅ PASS |
| reward-engine.test.js | 11 tests | ✅ PASS |
| block-monitor.test.js | 9 tests | ✅ PASS |
| e2e.test.js | 10 steps | ✅ PASS |
| payout-processor.test.js | 9 tests | ✅ PASS |
| payout-monitor.test.js | 8 tests | ✅ PASS |
| payout-recovery.test.js | 10 tests | ✅ PASS |
| test-payout-runner.test.js | 16 tests | ✅ PASS |
| audit.test.js | 10 tests | ✅ PASS |
| pool-modules.test.js | 20 tests | ✅ PASS |
| audit-share-block.test.js | 17 tests | ✅ PASS |
| block-maturity-atomic.test.js | 8 tests | ✅ PASS |
| wallet-auth.test.js | 14 tests | ✅ PASS |
| wallet-balance.test.js | 9 tests | ✅ PASS |
| google-auth.test.js | 15 tests | ✅ PASS |
| **estimation.test.js** | **11 tests** | ✅ **PASS (NUEVO)** |

**Total:** 22 suites, ~250 tests, 0 fallos ✅

---

## Consideraciones Importantes

### 1. La estimación cambia constantemente
Cada vez que:
- Un minero envía una share → la proporción cambia
- Un bloque madura → el valor de referencia cambia
- Shares antiguas salen de la ventana → la proporción cambia

Por lo tanto, la estimación es un "snapshot" del momento actual, no una predicción futura.

### 2. No es una promesa de pago
La estimación asume que:
- El pool encontrará otro bloque con el mismo coinbase
- La proporción del minero se mantendrá constante
- No habrá cambios en las reglas PPLNS

En la realidad, todos estos factores pueden cambiar.

### 3. Solo se muestra si hay datos válidos
Si no hay bloques maduros o el minero no tiene shares en la ventana, se muestra "N/A" en lugar de un valor engañoso.

### 4. Compatible con PAYOUT_DRY_RUN=true
La estimación funciona igual en modo dry-run y en modo producción, ya que se basa en bloques maduros reales.

---

## Próximos Pasos (Futuro)

Si en el futuro se desea mejorar la estimación:

1. **Promedio de últimos N bloques:** Usar el promedio de los últimos 3-5 bloques maduros en lugar de solo el último, para suavizar variaciones.

2. **Proyección temporal:** Mostrar "si continúas minando a este ritmo, en X horas tendrías Y sat".

3. **Estimación de tiempo:** Mostrar "a este ritmo, necesitas minar X horas más para alcanzar el mínimo de payout".

4. **Gráficos históricos:** Mostrar un gráfico de la estimación a lo largo del tiempo.

**Nota:** Ninguna de estas mejoras está implementada actualmente y requerirían análisis adicional.

---

## Conclusión

La implementación de "Ganancia Estimada (Condicional)" cumple con todos los requisitos:

✅ Muestra progreso económico al minero mientras aporta shares  
✅ Diferencia claramente entre estimación, balance pendiente y balance confirmado  
✅ Se actualiza en tiempo real al recibir shares aceptadas  
✅ NO modifica balances ni inventa recompensas  
✅ Explica claramente que es una estimación, no una garantía  
✅ Usa fórmula defendible basada en PPLNS real  
✅ Incluye tests exhaustivos  
✅ Mantiene PAYOUT_DRY_RUN=true  
✅ No modifica la base de datos de producción

**Estado:** ✅ IMPLEMENTACIÓN COMPLETA Y VERIFICADA
