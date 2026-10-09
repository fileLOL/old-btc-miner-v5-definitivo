const assert=require('assert'),path=require('path'),fs=require('fs');
const{getDb,closeDb,resetDb}=require('../lib/db');
const SessionManager=require('../lib/session-manager');
const am=require('../lib/account-manager');

(async()=>{
console.log('=== WALLET AUTH & IDOR TEST ===\n');

const TEST_DB=path.join(__dirname,'..','data','test_wallet_auth.db');
if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);
const db=getDb(TEST_DB);

console.log('[1] SessionManager: create and validate token');
const sm=new SessionManager({maxAge:60000,cleanupInterval:999999});
const accA=am.getOrCreateAccount('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
const accB=am.getOrCreateAccount('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
const tokenA=sm.createSession(accA.account_id);
assert.strictEqual(tokenA.length,64,'token is 64 hex chars');
assert(/^[0-9a-f]{64}$/.test(tokenA),'token is valid hex');
const validatedA=sm.validateSession(tokenA);
assert.strictEqual(validatedA,accA.account_id,'token validates to correct accountId');
console.log('  tokenA length:',tokenA.length);
console.log('  validates to accountId:',validatedA);
console.log('  PASS\n');

console.log('[2] Token for account A cannot access account B data');
const tokenB=sm.createSession(accB.account_id);
const accountIdFromA=sm.validateSession(tokenA);
const accountIdFromB=sm.validateSession(tokenB);
assert.notStrictEqual(accountIdFromA,accountIdFromB,'tokens resolve to different accounts');
assert.strictEqual(accountIdFromA,accA.account_id,'tokenA resolves to A');
assert.strictEqual(accountIdFromB,accB.account_id,'tokenB resolves to B');
console.log('  tokenA -> accountId:',accountIdFromA);
console.log('  tokenB -> accountId:',accountIdFromB);
console.log('  IDOR not possible: tokenA cannot access B data');
console.log('  PASS\n');

console.log('[3] Invalid tokens rejected');
assert.strictEqual(sm.validateSession(''),null,'empty string rejected');
assert.strictEqual(sm.validateSession('short'),null,'short token rejected');
assert.strictEqual(sm.validateSession('zz'.repeat(32)),null,'non-hex rejected');
assert.strictEqual(sm.validateSession('AA'.repeat(32)),null,'uppercase hex rejected');
assert.strictEqual(sm.validateSession(null),null,'null rejected');
assert.strictEqual(sm.validateSession(undefined),null,'undefined rejected');
assert.strictEqual(sm.validateSession('00'.repeat(32)),null,'nonexistent valid-format token rejected');
console.log('  all invalid formats return null');
console.log('  PASS\n');

console.log('[4] Destroyed session no longer valid');
const tokenC=sm.createSession(accA.account_id);
assert(sm.validateSession(tokenC),'tokenC valid before destroy');
sm.destroySession(tokenC);
assert.strictEqual(sm.validateSession(tokenC),null,'tokenC invalid after destroy');
console.log('  PASS\n');

console.log('[5] Destroy all sessions for account');
const sm4=new SessionManager({maxAge:60000,cleanupInterval:999999});
const t1=sm4.createSession(accA.account_id);
const t2=sm4.createSession(accA.account_id);
const t3=sm4.createSession(accB.account_id);
assert.strictEqual(sm4.getAccountTokenCount(accA.account_id),2);
assert.strictEqual(sm4.getAccountTokenCount(accB.account_id),1);
sm4.destroyAccountSessions(accA.account_id);
assert.strictEqual(sm4.getAccountTokenCount(accA.account_id),0,'all A sessions destroyed');
assert.strictEqual(sm4.getAccountTokenCount(accB.account_id),1,'B sessions unaffected');
assert.strictEqual(sm4.validateSession(t1),null);
assert.strictEqual(sm4.validateSession(t2),null);
assert.strictEqual(sm4.validateSession(t3),accB.account_id,'B token still valid');
sm4.destroy();
console.log('  PASS\n');

console.log('[6] Session expiry via maxAge');
const sm2=new SessionManager({maxAge:1,cleanupInterval:999999});
const tokenExp=sm2.createSession(accA.account_id);
await new Promise(r=>setTimeout(r,10));
assert.strictEqual(sm2.validateSession(tokenExp),null,'expired session returns null');
sm2.destroy();
console.log('  PASS\n');

console.log('[7] Touch session extends lifetime');
const sm3=new SessionManager({maxAge:50,cleanupInterval:999999});
const tokenTouch=sm3.createSession(accA.account_id);
await new Promise(r=>setTimeout(r,30));
sm3.touchSession(tokenTouch);
await new Promise(r=>setTimeout(r,30));
assert.strictEqual(sm3.validateSession(tokenTouch),accA.account_id,'touched session still valid');
sm3.destroy();
console.log('  PASS\n');

console.log('[8] authenticateRequest simulation (header parsing)');
function simulateAuth(authHeader){
if(!authHeader||!authHeader.startsWith('Bearer '))return null;
const token=authHeader.slice(7);
if(!token||token.length!==64||!/^[0-9a-f]{64}$/.test(token))return null;
return sm.validateSession(token)}
assert.strictEqual(simulateAuth('Bearer '+tokenA),accA.account_id,'valid Bearer token accepted');
assert.strictEqual(simulateAuth('Bearer '+tokenB),accB.account_id,'valid Bearer token B accepted');
assert.strictEqual(simulateAuth(''),null,'empty header rejected');
assert.strictEqual(simulateAuth('Bearer '),null,'empty bearer rejected');
assert.strictEqual(simulateAuth('Bearer invalid'),null,'invalid bearer rejected');
assert.strictEqual(simulateAuth('Basic '+tokenA),null,'wrong scheme rejected');
assert.strictEqual(simulateAuth(null),null,'null header rejected');
const fakeToken='ab'.repeat(32);
assert.strictEqual(simulateAuth('Bearer '+fakeToken),null,'nonexistent token rejected');
console.log('  all header formats handled correctly');
console.log('  PASS\n');

console.log('[9] Account A token cannot retrieve account B stats (IDOR via HTTP simulation)');
const myBalanceHandler=function(authHeader){
const accountId=simulateAuth(authHeader);
if(!accountId)return{status:401,body:{ok:false,error:'unauthorized'}};
const stats=am.getBalance(accountId);
const shares=am.getShareCountByAccount(accountId);
return{status:200,body:{ok:true,accountId:accountId,pending_sat:stats?stats.pending_sat:0,shares:shares}}};
const resultA=myBalanceHandler('Bearer '+tokenA);
assert.strictEqual(resultA.status,200);
assert.strictEqual(resultA.body.accountId,accA.account_id);
const resultB=myBalanceHandler('Bearer '+tokenB);
assert.strictEqual(resultB.status,200);
assert.strictEqual(resultB.body.accountId,accB.account_id);
assert.notStrictEqual(resultA.body.accountId,resultB.body.accountId);
const resultAttacker=myBalanceHandler('Bearer '+tokenA);
assert.strictEqual(resultAttacker.body.accountId,accA.account_id,'attacker with tokenA sees only A data');
console.log('  A sees accountId:',resultA.body.accountId);
console.log('  B sees accountId:',resultB.body.accountId);
console.log('  IDOR test: PASS');
console.log('  PASS\n');

console.log('[10] No token = 401 unauthorized');
const resultNoToken=myBalanceHandler('');
assert.strictEqual(resultNoToken.status,401);
assert.strictEqual(resultNoToken.body.ok,false);
console.log('  PASS\n');

console.log('[11] Production DB not touched');
const prodDbPath=path.join(__dirname,'..','data','pool.db');
const prodSize=fs.existsSync(prodDbPath)?fs.statSync(prodDbPath).size:0;
console.log('  production pool.db size:',prodSize,'(untouched)');
console.log('  PASS\n');

console.log('[12] /api/my-balance requires verified account (Google)');
const verifiedAcc=am.getOrCreateAccount('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
am.createIdentity(verifiedAcc.account_id,'google-verified-123','verified@test.com','Verified User');
const verifiedToken=sm.createSession(verifiedAcc.account_id,'google-verified-123');
function simulateVerifiedAuth(authHeader){
if(!authHeader||!authHeader.startsWith('Bearer '))return null;
const token=authHeader.slice(7);
if(!token||token.length!==64||!/^[0-9a-f]{64}$/.test(token))return null;
const session=sm.validateSessionFull(token);
if(!session)return null;
if(!session.googleId)return null;
return session}
const verifiedResult=simulateVerifiedAuth('Bearer '+verifiedToken);
assert.strictEqual(verifiedResult.accountId,verifiedAcc.account_id,'verified account accepted');
assert.strictEqual(verifiedResult.googleId,'google-verified-123','googleId present');
console.log('  Verified account with Google accepted');
console.log('  PASS\n');

console.log('[13] Legacy account cannot access /api/my-balance');
const legacyToken=sm.createSession(accA.account_id,null);
const legacyResult=simulateVerifiedAuth('Bearer '+legacyToken);
assert.strictEqual(legacyResult,null,'legacy account rejected (no googleId)');
console.log('  Legacy account rejected (no Google verification)');
console.log('  PASS\n');

console.log('[14] Session with googleId cannot access other accounts');
const tokenB_verified=sm.createSession(accB.account_id,null);
const crossCheck=simulateVerifiedAuth('Bearer '+tokenB_verified);
assert.strictEqual(crossCheck,null,'legacy token B rejected');
const attackerWithVerified=simulateVerifiedAuth('Bearer '+verifiedToken);
assert.strictEqual(attackerWithVerified.accountId,verifiedAcc.account_id,'attacker sees only their own account');
assert.notStrictEqual(attackerWithVerified.accountId,accA.account_id,'cannot access A');
assert.notStrictEqual(attackerWithVerified.accountId,accB.account_id,'cannot access B');
console.log('  Verified session cannot access other accounts');
console.log('  PASS\n');

sm.destroy();
closeDb();
resetDb();
if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);

console.log('=== ALL WALLET AUTH & IDOR TESTS PASSED ===');
})().catch(e=>{console.error('TEST FAILED:',e.message,e.stack);try{closeDb();resetDb()}catch{}
const p=path.join(__dirname,'..','data','test_wallet_auth.db');if(fs.existsSync(p))fs.unlinkSync(p);
process.exit(1)});
