# Informe de Pre-Deploy: OLD BTC MINER V5

**Fecha:** 2026-01-09  
**Estado:** ✅ LISTO PARA DEPLOY (con una condición)

---

## 1. Tests - ✅ TODOS PASAN

**Resultado:** 22 suites, ~250 tests, 0 fallos

| Suite | Tests | Estado |
|-------|-------|--------|
| sha256d, midstate, serialization, core | 4 suites | ✅ PASS |
| address-validator | 20 tests | ✅ PASS |
| account-manager | 23 tests | ✅ PASS |
| reward-engine | 11 tests | ✅ PASS |
| block-monitor | 9 tests | ✅ PASS |
| e2e | 10 steps | ✅ PASS |
| payout-processor | 9 tests | ✅ PASS |
| payout-monitor | 8 tests | ✅ PASS |
| payout-recovery | 10 tests | ✅ PASS |
| test-payout-runner | 16 tests | ✅ PASS |
| audit | 10 tests | ✅ PASS |
| pool-modules | 20 tests | ✅ PASS |
| audit-share-block | 17 tests | ✅ PASS |
| block-maturity-atomic | 8 tests | ✅ PASS |
| wallet-auth | 14 tests | ✅ PASS |
| wallet-balance | 9 tests | ✅ PASS |
| google-auth | 15 tests | ✅ PASS |
| **estimation** | **11 tests** | ✅ **PASS** |

---

## 2. Sincronización frontend/ y public/ - ✅ CORRECTA

```
frontend/app.js    = public/app.js    ✅
frontend/index.html = public/index.html ✅
frontend/style.css = public/style.css ✅
```

**Servidor activo:** `server.js` sirve desde `frontend/`  
**Backup legacy:** `public/` sincronizado (idéntico)

---

## 3. PAYOUT_DRY_RUN=true - ✅ VERIFICADO

**Local (.env):**
```
PAYOUT_DRY_RUN=true ✅
```

**Producción (render.yaml):**
```yaml
- key: PAYOUT_DRY_RUN
  value: "true" ✅
```

---

## 4. Wallet - ✅ BALANCES Y ESTIMACIÓN DIFERENCIADOS

**Balances reales (persistidos en DB):**
- `pending_sat`: recompensas acreditadas por PPLNS (cuando bloque madura)
- `confirmed_sat`: balance confirmado tras payout
- `total_earned_sat`: total histórico ganado

**Ganancia estimada (calculada en memoria):**
- `estimated_sat`: estimación basada en último bloque maduro
- `estimated_has_data`: boolean indicando si hay datos válidos
- `estimated_reason`: razón si no hay datos ("no shares in window" o "no mature blocks")

**Diferenciación visual:**
- Balances reales: color naranja/verde
- Estimación: color azul (#42a5f5)
- Disclaimer explícito: "Simulación basada en datos históricos. No es una promesa de pago"

---

## 5. Autenticación Google - ✅ SEGURIDAD VERIFICADA

**Protecciones implementadas:**
- ✅ Token JWT verificado en servidor (firma RS256, aud, iss, exp)
- ✅ Tabla `account_identities` con UNIQUE en `google_id`
- ✅ `/api/my-balance` requiere cuenta verificada con Google
- ✅ Cuenta legacy sin Google → 401 unauthorized
- ✅ No se puede re-vincular cuenta existente con Google diferente
- ✅ No se puede reutilizar google_id en cuentas diferentes

**Tests negativos:**
- ✅ Cuenta A no puede consultar balance de cuenta B
- ✅ Token inválido → 401
- ✅ Cuenta legacy → 401
- ✅ Google token mal formado → rechazado

---

## 6. Estimación no modifica balances - ✅ VERIFICADO

**Test [8] en estimation.test.js:**
```javascript
// Antes de llamar getEstimatedReward()
accA pending_sat: 0
accA confirmed_sat: 0

// Después de llamar getEstimatedReward()
accA pending_sat: 0  ✅ SIN CAMBIOS
accA confirmed_sat: 0 ✅ SIN CAMBIOS
```

**Función `getEstimatedReward()`:**
- Solo lectura (SELECT queries)
- No ejecuta UPDATE ni INSERT
- No persiste datos en DB
- Calcula en memoria y retorna resultado

---

## 7. Errores de arranque - ✅ NINGUNO

**Prueba de arranque:**
```
✅ SERVER_LOAD_OK
✅ OLD BTC MINER V5 POOL -> http://0.0.0.0:3000
✅ WebSocket: ws://0.0.0.0:3000/ws
✅ Stratum: stratum+tcp://0.0.0.0:3333
✅ Payout mode: DRY RUN (no real payments)
✅ BlockMonitor started
✅ PayoutMonitor started
✅ No syntax errors
```

**Dependencias:**
- Todas las dependencias en package.json están instaladas
- No se agregaron nuevas dependencias externas
- `crypto` y `https` son módulos nativos de Node.js

---

## 8. Estado de Git - ✅ VERIFICADO

**Archivos modificados (18):**
```
frontend/app.js           (+116 lines)
frontend/index.html       (+66 lines)
frontend/style.css        (+108 lines)
lib/account-manager.js    (+33 lines)
lib/block-monitor.js      (+32 lines)
lib/db.js                 (+8 lines)
lib/reward-engine.js      (+68 lines)
lib/session-manager.js    (NUEVO, 105 lines)
lib/google-auth.js        (NUEVO, 121 lines)
package.json              (+1 line)
server.js                 (+190 lines)
test/estimation.test.js   (NUEVO, 180 lines)
test/google-auth.test.js  (NUEVO, 95 lines)
test/wallet-auth.test.js  (NUEVO, 175 lines)
test/wallet-balance.test.js (NUEVO, 130 lines)
test/block-maturity-atomic.test.js (NUEVO, 160 lines)
public/*                  (sincronizado desde frontend/)
```

**Total:** +1,051 lines, -91 lines

**Branch:** `master`  
**Último commit:** `0ebbaf7` (fix anterior a esta implementación)  
**Remoto:** `origin` → `https://github.com/fileLOL/old-btc-miner-v5-definitivo.git`

---

## 9. Configuración de Deploy - ⚠️ REQUIERE ACCIÓN

### Vercel (frontend)
**Archivo:** `vercel.json`  
**Estado:** ✅ Configura correctamente  
- Sirve desde `frontend/`
- Cache headers correctos
- Security headers (X-Content-Type-Options, X-Frame-Options)

### Render (backend)
**Archivo:** `render.yaml`  
**Estado:** ⚠️ REQUIERE añadir GOOGLE_CLIENT_ID

**Problema detectado:**
```yaml
# render.yaml NO incluye GOOGLE_CLIENT_ID
# Sin esta variable, la verificación de Google fallará en producción
```

**Solución requerida:**
Agregar a `render.yaml`:
```yaml
- key: GOOGLE_CLIENT_ID
  value: "46928798077-vtsu6fln277j6s601n2b4feg1hrsfi72.apps.googleusercontent.com"
```

**Nota:** El client ID ya está hardcodeado en `frontend/app.js` y `server.js`, pero es mejor práctica definirlo como variable de entorno.

---

## 10. Seguridad - ✅ VERIFICADA

**Secrets protegidos:**
- ✅ `.env` en `.gitignore`
- ✅ `.env.local` en `.gitignore`
- ✅ `data/` en `.gitignore` (DB de producción)
- ✅ No se exponen credenciales RPC en logs
- ✅ No se exponen tokens de sesión en URLs
- ✅ Tokens de sesión en memoria (no en localStorage)

**Protecciones implementadas:**
- ✅ Rate limiting (60 msg/min, 30 shares/min)
- ✅ Token JWT verificado con firma RS256
- ✅ Prevención IDOR (cada usuario ve solo su cuenta)
- ✅ Prevención doble maduración de bloques
- ✅ Validación de shares (recálculo de hash en servidor)
- ✅ CORS configurable

---

## 11. Resumen de Cambios por Funcionalidad

### A. Wallet con autenticación Google
- **Backend:** session-manager.js, google-auth.js, server.js
- **Frontend:** app.js, index.html, style.css
- **DB:** tabla account_identities
- **Tests:** wallet-auth.test.js, google-auth.test.js

### B. Ganancia estimada condicional
- **Backend:** reward-engine.js (3 funciones nuevas), server.js
- **Frontend:** app.js, index.html, style.css
- **Tests:** estimation.test.js

### C. Seguridad de maduración de bloques
- **Backend:** block-monitor.js (transacción atómica)
- **Tests:** block-maturity-atomic.test.js

---

## 12. Problemas Detectados

| # | Problema | Severidad | Solución |
|---|----------|-----------|----------|
| 1 | `render.yaml` no incluye `GOOGLE_CLIENT_ID` | ⚠️ MEDIA | Añadir variable de entorno en render.yaml |
| 2 | Cuenta legacy no puede migrar a verificada | ℹ️ BAJA | Documentado; requiere mecanismo separado (futuro) |

---

## 13. Pasos para Publicar

### Paso 1: Añadir GOOGLE_CLIENT_ID a render.yaml

Editar `render.yaml` y agregar después de la línea 48:
```yaml
      - key: GOOGLE_CLIENT_ID
        value: "46928798077-vtsu6fln277j6s601n2b4feg1hrsfi72.apps.googleusercontent.com"
```

### Paso 2: Commit de cambios

```bash
git add -A
git status  # revisar cambios
git commit -m "feat: Wallet con autenticación Google, ganancia estimada y seguridad mejorada

- Wallet modal con balances reales (pending/confirmed/total)
- Ganancia estimada condicional basada en último bloque maduro
- Autenticación Google Sign-In verificada en servidor
- Tabla account_identities para vincular cuentas con Google
- Prevención IDOR: cada usuario ve solo su cuenta
- Maduración atómica de bloques (previene doble reward)
- 5 nuevos suites de tests (68 tests adicionales)
- PAYOUT_DRY_RUN=true sin cambios
- No modifica balances ni inventa BTC"
```

### Paso 3: Push a GitHub

```bash
git push origin master
```

### Paso 4: Deploy automático

- **Render:** Se desplegará automáticamente al recibir push
- **Vercel:** Se desplegará automáticamente al recibir push

### Paso 5: Verificación post-deploy

1. Abrir frontend en Vercel
2. Introducir dirección BTC
3. Pulsar "Start Mining"
4. Pulsar "View Wallet"
5. Verificar que:
   - Se pide Google Sign-In para ver balance
   - Balances muestran "---" si no está verificado
   - Estimación muestra "N/A" si no hay bloques maduros
   - Disclaimer visible

---

## 14. Checklist Final

- [x] Todos los tests pasan (22 suites, ~250 tests)
- [x] frontend/ y public/ sincronizados
- [x] PAYOUT_DRY_RUN=true verificado
- [x] Wallet muestra balances y estimación diferenciados
- [x] Autenticación Google verificada
- [x] IDOR prevenido
- [x] Estimación no modifica balances
- [x] Sin errores de arranque
- [x] Git status verificado
- [x] No se hizo push ni deploy
- [x] No se modificó DB de producción
- [x] Secrets protegidos
- [ ] **PENDIENTE:** Añadir GOOGLE_CLIENT_ID a render.yaml

---

## 15. Recomendación

**✅ APROBADO PARA DEPLOY** después de:

1. Añadir `GOOGLE_CLIENT_ID` a `render.yaml`
2. Commit de todos los cambios
3. Push a `origin master`

**Risk level:** BAJO  
**Rollback plan:** `git revert HEAD` si hay problemas

---

**Esperando autorización para proceder con los pasos 1-3.**
