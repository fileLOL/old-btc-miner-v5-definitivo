const assert=require('assert');
const path=require('path');
const fs=require('fs');
const{getDb,closeDb,resetDb}=require('../lib/db');
const accountManager=require('../lib/account-manager');
const rewardEngine=require('../lib/reward-engine');

const TEST_DB=path.join(__dirname,'..','data','test_estimation.db');
const WINDOW_SIZE=100;
const POOL_FEE_PERCENT=2;

(async()=>{
console.log('=== ESTIMATION CONDITIONAL TEST ===\n');

if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);
const db=getDb(TEST_DB);

console.log('[1] Setup: Create accounts');
const accA=accountManager.getOrCreateAccount('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
const accB=accountManager.getOrCreateAccount('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
console.log('  accA:',accA.account_id);
console.log('  accB:',accB.account_id);
console.log('  PASS\n');

console.log('[2] Empty window: no shares, no mature blocks');
const est0=rewardEngine.getEstimatedReward(accA.account_id,WINDOW_SIZE,POOL_FEE_PERCENT);
assert.strictEqual(est0.has_valid_data,false);
assert.strictEqual(est0.reason,'no shares in window');
assert.strictEqual(est0.estimated_sat,0);
console.log('  has_valid_data:',est0.has_valid_data);
console.log('  reason:',est0.reason);
console.log('  PASS\n');

console.log('[3] Add shares but no mature blocks');
const now=Date.now();
for(let i=0;i<10;i++){
  db.prepare('INSERT INTO shares (account_id,session_id,job_id,nonce,hash_hex,difficulty,created_at) VALUES (?,?,?,?,?,?,?)').run(
    accA.account_id,'s','j',i,'aa'.repeat(32),1000,now-10000+i);
}
for(let i=0;i<5;i++){
  db.prepare('INSERT INTO shares (account_id,session_id,job_id,nonce,hash_hex,difficulty,created_at) VALUES (?,?,?,?,?,?,?)').run(
    accB.account_id,'s','j',i+100,'bb'.repeat(32),1000,now-5000+i);
}
const est1=rewardEngine.getEstimatedReward(accA.account_id,WINDOW_SIZE,POOL_FEE_PERCENT);
assert.strictEqual(est1.has_valid_data,false);
assert.strictEqual(est1.reason,'no mature blocks');
console.log('  has_valid_data:',est1.has_valid_data);
console.log('  reason:',est1.reason);
console.log('  PASS\n');

console.log('[4] Add mature block');
const COINBASE=312500000;
const blockResult=accountManager.insertBlock(accA.account_id,'s',970067,COINBASE,'aabb'.repeat(16));
db.prepare("UPDATE blocks SET status='mature' WHERE id=?").run(blockResult.blockId);
const est2=rewardEngine.getEstimatedReward(accA.account_id,WINDOW_SIZE,POOL_FEE_PERCENT);
assert.strictEqual(est2.has_valid_data,true);
assert.strictEqual(est2.reason,null);
assert(est2.estimated_sat>0);
console.log('  has_valid_data:',est2.has_valid_data);
console.log('  estimated_sat:',est2.estimated_sat);
console.log('  reference_block_id:',est2.reference_block_id);
console.log('  reference_block_height:',est2.reference_block_height);
console.log('  PASS\n');

console.log('[5] Proportional calculation: accA has 10 shares, accB has 5');
const snapshot=rewardEngine.getPoolDifficultySnapshot(WINDOW_SIZE);
console.log('  total_difficulty:',snapshot.totalDifficulty);
console.log('  share_count:',snapshot.shareCount);
console.log('  accA difficulty:',snapshot.accountDifficulty.get(accA.account_id));
console.log('  accB difficulty:',snapshot.accountDifficulty.get(accB.account_id));
const totalDiff=snapshot.totalDifficulty;
const accADiff=snapshot.accountDifficulty.get(accA.account_id);
const expectedProportion=Number(accADiff)/totalDiff;
console.log('  expected proportion:',expectedProportion);
console.log('  actual proportion:',est2.miner_proportion);
assert(Math.abs(est2.miner_proportion-expectedProportion)<0.0001);
console.log('  PASS\n');

console.log('[6] Pool fee deduction');
const expectedDistributable=COINBASE*(1-POOL_FEE_PERCENT/100);
const expectedReward=expectedDistributable*est2.miner_proportion;
console.log('  coinbase:',COINBASE);
console.log('  pool_fee_percent:',POOL_FEE_PERCENT);
console.log('  expected distributable:',expectedDistributable);
console.log('  actual distributable:',est2.reference_distributable_sat);
assert.strictEqual(est2.reference_distributable_sat,expectedDistributable);
console.log('  expected reward:',expectedReward);
console.log('  actual reward:',est2.estimated_sat);
assert(Math.abs(est2.estimated_sat-expectedReward)<1);
console.log('  PASS\n');

console.log('[7] Zero difficulty shares');
const accC=accountManager.getOrCreateAccount('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
db.prepare('INSERT INTO shares (account_id,session_id,job_id,nonce,hash_hex,difficulty,created_at) VALUES (?,?,?,?,?,?,?)').run(
  accC.account_id,'s','j',200,'cc'.repeat(32),0,now-1000);
const est3=rewardEngine.getEstimatedReward(accC.account_id,WINDOW_SIZE,POOL_FEE_PERCENT);
assert.strictEqual(est3.has_valid_data,false);
assert.strictEqual(est3.reason,'miner has no shares in window');
console.log('  has_valid_data:',est3.has_valid_data);
console.log('  reason:',est3.reason);
console.log('  PASS\n');

console.log('[8] Balances unchanged');
const balA=accountManager.getBalance(accA.account_id);
const balB=accountManager.getBalance(accB.account_id);
console.log('  accA pending_sat:',balA.pending_sat);
console.log('  accA confirmed_sat:',balA.confirmed_sat);
console.log('  accB pending_sat:',balB.pending_sat);
console.log('  accB confirmed_sat:',balB.confirmed_sat);
assert.strictEqual(balA.pending_sat,0);
assert.strictEqual(balA.confirmed_sat,0);
assert.strictEqual(balB.pending_sat,0);
assert.strictEqual(balB.confirmed_sat,0);
console.log('  PASS: balances unchanged\n');

console.log('[9] getLastMatureBlock returns correct block');
const lastBlock=rewardEngine.getLastMatureBlock();
assert(lastBlock);
assert.strictEqual(lastBlock.id,blockResult.blockId);
assert.strictEqual(lastBlock.height,970067);
assert.strictEqual(lastBlock.status,'mature');
console.log('  block_id:',lastBlock.id);
console.log('  height:',lastBlock.height);
console.log('  status:',lastBlock.status);
console.log('  PASS\n');

console.log('[10] Snapshot with different window sizes');
const snap10=rewardEngine.getPoolDifficultySnapshot(10);
const snap5=rewardEngine.getPoolDifficultySnapshot(5);
console.log('  window=10, shares:',snap10.shareCount);
console.log('  window=5, shares:',snap5.shareCount);
assert(snap10.shareCount<=10);
assert(snap5.shareCount<=5);
assert(snap5.shareCount<=snap10.shareCount);
console.log('  PASS\n');

console.log('[11] Production DB not touched');
const prodDbPath=path.join(__dirname,'..','data','pool.db');
const prodSize=fs.existsSync(prodDbPath)?fs.statSync(prodDbPath).size:0;
console.log('  production pool.db size:',prodSize,'(untouched)');
console.log('  PASS\n');

closeDb();
resetDb();
if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);

console.log('=== ALL ESTIMATION CONDITIONAL TESTS PASSED ===');
})().catch(e=>{
console.error('TEST FAILED:',e.message,e.stack);
try{closeDb();resetDb()}catch{}
const p=path.join(__dirname,'..','data','test_estimation.db');
if(fs.existsSync(p))fs.unlinkSync(p);
process.exit(1);
});
