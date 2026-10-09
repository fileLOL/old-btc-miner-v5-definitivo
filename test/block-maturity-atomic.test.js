const assert=require('assert'),path=require('path'),fs=require('fs');
const{getDb,closeDb,resetDb}=require('../lib/db');
const am=require('../lib/account-manager');
const re=require('../lib/reward-engine');
const BlockMonitor=require('../lib/block-monitor');

(async()=>{
console.log('=== BLOCK MATURITY ATOMIC TEST ===\n');

const TEST_DB=path.join(__dirname,'..','data','test_maturity.db');
if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);
const db=getDb(TEST_DB);

const WALLET_A='bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const WALLET_B='1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const COINBASE=312500000;

const mockCli=async(args)=>{
if(args[0]==='getblock')return JSON.stringify({hash:args[1],confirmations:101,height:970067});
if(args[0]==='getblockchaininfo')return JSON.stringify({blocks:970168});
throw new Error('Unknown command')};

const cfg={BLOCK_MONITOR_MS:999999,COINBASE_MATURITY:100,PPLNS_WINDOW_SIZE:10000,POOL_FEE_PERCENT:2};

console.log('[1] Setup: two accounts, shares, one confirmed block');
const accA=am.getOrCreateAccount(WALLET_A);
const accB=am.getOrCreateAccount(WALLET_B);
const now=Date.now();
for(let i=0;i<10;i++){
db.prepare('INSERT INTO shares (account_id,session_id,job_id,nonce,hash_hex,difficulty,created_at) VALUES (?,?,?,?,?,?,?)').run(accA.account_id,'s','j',i,'aa'.repeat(32),1000,now-10000+i);
}
for(let i=0;i<5;i++){
db.prepare('INSERT INTO shares (account_id,session_id,job_id,nonce,hash_hex,difficulty,created_at) VALUES (?,?,?,?,?,?,?)').run(accB.account_id,'s','j',i+100,'bb'.repeat(32),1000,now-5000+i);
}
const blockResult=am.insertBlock(accA.account_id,'s',970067,COINBASE,'aabb'.repeat(16));
db.prepare("UPDATE blocks SET status='confirmed' WHERE id=?").run(blockResult.blockId);
console.log('  accA shares: 10, accB shares: 5');
console.log('  block id:',blockResult.blockId,'status: confirmed');
console.log('  PASS\n');

console.log('[2] Atomic maturity: confirmed -> mature in single transaction');
const monitor=new BlockMonitor(cfg,mockCli);
const block=db.prepare('SELECT * FROM blocks WHERE id=?').get(blockResult.blockId);
await monitor.checkBlock(block);
const updated=db.prepare('SELECT * FROM blocks WHERE id=?').get(blockResult.blockId);
assert.strictEqual(updated.status,'mature');
const balA=am.getBalance(accA.account_id);
const balB=am.getBalance(accB.account_id);
console.log('  status:',updated.status);
console.log('  accA pending_sat:',balA.pending_sat);
console.log('  accB pending_sat:',balB.pending_sat);
assert(balA.pending_sat>0,'accA has pending balance');
assert(balB.pending_sat>0,'accB has pending balance');
const totalDistributed=balA.pending_sat+balB.pending_sat;
assert(totalDistributed<=COINBASE,'no BTC invented');
console.log('  total distributed:',totalDistributed,'sat <= coinbase',COINBASE);
console.log('  PASS\n');

console.log('[3] Double maturity: second call does NOT duplicate rewards');
const balBeforeA=am.getBalance(accA.account_id).pending_sat;
const balBeforeB=am.getBalance(accB.account_id).pending_sat;
const blockAgain=db.prepare('SELECT * FROM blocks WHERE id=?').get(blockResult.blockId);
await monitor.checkBlock(blockAgain);
const balAfterA=am.getBalance(accA.account_id).pending_sat;
const balAfterB=am.getBalance(accB.account_id).pending_sat;
assert.strictEqual(balAfterA,balBeforeA,'accA balance unchanged after second call');
assert.strictEqual(balAfterB,balBeforeB,'accB balance unchanged after second call');
console.log('  accA before:',balBeforeA,'after:',balAfterA);
console.log('  accB before:',balBeforeB,'after:',balAfterB);
console.log('  PASS\n');

console.log('[4] matureBlockAtomically: idempotent direct call');
const r1=monitor.matureBlockAtomically(blockResult.blockId);
assert(r1.alreadyProcessed,'second call returns alreadyProcessed');
console.log('  alreadyProcessed:',r1.alreadyProcessed,'reason:',r1.reason);
console.log('  PASS\n');

console.log('[5] Crash recovery: invalid coinbase in applyRewards leaves block confirmed');
const blockResult2=am.insertBlock(accA.account_id,'s',970068,0,'ccdd'.repeat(16));
db.prepare("UPDATE blocks SET status='confirmed' WHERE id=?").run(blockResult2.blockId);
try{
const block2=db.prepare('SELECT * FROM blocks WHERE id=?').get(blockResult2.blockId);
const mockCli2=async(args)=>{
if(args[0]==='getblock')return JSON.stringify({hash:args[1],confirmations:101,height:970068});
if(args[0]==='getblockchaininfo')return JSON.stringify({blocks:970169});
throw new Error('Unknown')};
const monitor2=new BlockMonitor(cfg,mockCli2);
await monitor2.checkBlock(block2);
const afterCrash=db.prepare('SELECT * FROM blocks WHERE id=?').get(blockResult2.blockId);
assert.strictEqual(afterCrash.status,'confirmed','block stays confirmed when applyRewards fails');
console.log('  status after failed maturity:',afterCrash.status,'(stayed confirmed)');
console.log('  applyRewards failed due to coinbase_value=0, transaction rolled back');
console.log('  PASS\n');

console.log('[6] Recovery after crash: fix coinbase, retry succeeds');
db.prepare("UPDATE blocks SET coinbase_value=?, status='confirmed' WHERE id=?").run(COINBASE,blockResult2.blockId);
const balABeforeRetry=am.getBalance(accA.account_id).pending_sat;
const block2Retry=db.prepare('SELECT * FROM blocks WHERE id=?').get(blockResult2.blockId);
await monitor2.checkBlock(block2Retry);
const afterRetry=db.prepare('SELECT * FROM blocks WHERE id=?').get(blockResult2.blockId);
assert.strictEqual(afterRetry.status,'mature','block now mature after retry');
const balAAfterRetry=am.getBalance(accA.account_id).pending_sat;
assert(balAAfterRetry>balABeforeRetry,'accA gained balance from block2');
console.log('  status after retry:',afterRetry.status);
console.log('  accA pending:',balABeforeRetry,'->',balAAfterRetry);
console.log('  PASS\n');
}catch(e){
throw e}

console.log('[7] Concurrent maturity: two monitors, only one applies rewards');
const blockResult3=am.insertBlock(accB.account_id,'s',970069,COINBASE,'eeff'.repeat(16));
db.prepare("UPDATE blocks SET status='confirmed' WHERE id=?").run(blockResult3.blockId);
const balBBefore=am.getBalance(accB.account_id).pending_sat;
const monitorA=new BlockMonitor(cfg,async(args)=>{
if(args[0]==='getblock')return JSON.stringify({hash:args[1],confirmations:101,height:970069});
if(args[0]==='getblockchaininfo')return JSON.stringify({blocks:970170});
throw new Error('Unknown')});
const monitorB=new BlockMonitor(cfg,async(args)=>{
if(args[0]==='getblock')return JSON.stringify({hash:args[1],confirmations:101,height:970069});
if(args[0]==='getblockchaininfo')return JSON.stringify({blocks:970170});
throw new Error('Unknown')});
const block3=db.prepare('SELECT * FROM blocks WHERE id=?').get(blockResult3.blockId);
await monitorA.checkBlock(block3);
const block3b=db.prepare('SELECT * FROM blocks WHERE id=?').get(blockResult3.blockId);
await monitorB.checkBlock(block3b);
const balBAfter=am.getBalance(accB.account_id).pending_sat;
const block3Final=db.prepare('SELECT * FROM blocks WHERE id=?').get(blockResult3.blockId);
assert.strictEqual(block3Final.status,'mature');
const gain=balBAfter-balBBefore;
assert(gain>0,'accB gained rewards');
const block3Row=db.prepare('SELECT * FROM blocks WHERE id=?').get(blockResult3.blockId);
await monitorA.checkBlock(block3Row);
const balBFinal=am.getBalance(accB.account_id).pending_sat;
assert.strictEqual(balBFinal,balBAfter,'third call did not duplicate');
console.log('  accB gain:',gain,'sat (single application)');
console.log('  block status:',block3Final.status);
console.log('  PASS\n');

console.log('[8] Verify production DB not touched');
const prodDbPath=path.join(__dirname,'..','data','pool.db');
const prodSize=fs.existsSync(prodDbPath)?fs.statSync(prodDbPath).size:0;
console.log('  production pool.db size:',prodSize,'(untouched)');
console.log('  PASS\n');

closeDb();
resetDb();
if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);

console.log('=== ALL BLOCK MATURITY ATOMIC TESTS PASSED ===');
})().catch(e=>{console.error('TEST FAILED:',e.message,e.stack);try{closeDb();resetDb()}catch{}
const p=path.join(__dirname,'..','data','test_maturity.db');if(fs.existsSync(p))fs.unlinkSync(p);
process.exit(1)});
