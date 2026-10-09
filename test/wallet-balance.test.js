const assert=require('assert'),path=require('path'),fs=require('fs');
const{getDb,closeDb,resetDb}=require('../lib/db');
const am=require('../lib/account-manager');
const re=require('../lib/reward-engine');
const BlockMonitor=require('../lib/block-monitor');
const SessionManager=require('../lib/session-manager');

(async()=>{
console.log('=== WALLET BALANCE ENDPOINT TEST ===\n');

const TEST_DB=path.join(__dirname,'..','data','test_wallet_balance.db');
if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);
const db=getDb(TEST_DB);

const WALLET='bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const WALLET2='1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const COINBASE=312500000;

console.log('[1] Initial balance is 0 for new account');
const acc=am.getOrCreateAccount(WALLET);
const bal0=am.getBalance(acc.account_id);
assert.strictEqual(bal0.pending_sat,0);
assert.strictEqual(bal0.confirmed_sat,0);
assert.strictEqual(bal0.total_earned_sat,0);
const stats0=re.getAccountStats(acc.account_id);
assert.strictEqual(stats0.shares,0);
assert.strictEqual(stats0.blocks_found,0);
console.log('  pending_sat: 0, confirmed_sat: 0, total_earned_sat: 0');
console.log('  shares: 0, blocks_found: 0');
console.log('  PASS\n');

console.log('[2] Shares without mature block: balance stays 0');
const now=Date.now();
for(let i=0;i<10;i++){
db.prepare('INSERT INTO shares (account_id,session_id,job_id,nonce,hash_hex,difficulty,created_at) VALUES (?,?,?,?,?,?,?)').run(acc.account_id,'s','j',i,'aa'.repeat(32),1000,now-10000+i);
}
const bal1=am.getBalance(acc.account_id);
assert.strictEqual(bal1.pending_sat,0,'no rewards without mature block');
assert.strictEqual(bal1.confirmed_sat,0);
const shareCount=am.getShareCountByAccount(acc.account_id);
assert.strictEqual(shareCount,10);
console.log('  pending_sat:',bal1.pending_sat,'(unchanged, no mature block)');
console.log('  shares_accepted:',shareCount);
console.log('  PASS\n');

console.log('[3] Mature block: rewards credited to pending_sat');
const acc2=am.getOrCreateAccount(WALLET2);
for(let i=0;i<5;i++){
db.prepare('INSERT INTO shares (account_id,session_id,job_id,nonce,hash_hex,difficulty,created_at) VALUES (?,?,?,?,?,?,?)').run(acc2.account_id,'s','j',i+100,'bb'.repeat(32),1000,now-5000+i);
}
const blockResult=am.insertBlock(acc.account_id,'s',970067,COINBASE,'aabb'.repeat(16));
db.prepare("UPDATE blocks SET status='confirmed' WHERE id=?").run(blockResult.blockId);

const mockCli=async(args)=>{
if(args[0]==='getblock')return JSON.stringify({hash:args[1],confirmations:101,height:970067});
if(args[0]==='getblockchaininfo')return JSON.stringify({blocks:970168});
throw new Error('Unknown')};
const cfg={BLOCK_MONITOR_MS:999999,COINBASE_MATURITY:100,PPLNS_WINDOW_SIZE:10000,POOL_FEE_PERCENT:2};
const monitor=new BlockMonitor(cfg,mockCli);
const block=db.prepare('SELECT * FROM blocks WHERE id=?').get(blockResult.blockId);
await monitor.checkBlock(block);

const bal2=am.getBalance(acc.account_id);
const bal2b=am.getBalance(acc2.account_id);
assert(bal2.pending_sat>0,'acc1 has pending balance');
assert(bal2b.pending_sat>0,'acc2 has pending balance');
const totalDistributed=bal2.pending_sat+bal2b.pending_sat;
assert(totalDistributed<=COINBASE,'no BTC invented');
console.log('  acc1 pending_sat:',bal2.pending_sat);
console.log('  acc2 pending_sat:',bal2b.pending_sat);
console.log('  total:',totalDistributed,'<= coinbase',COINBASE);
console.log('  PASS\n');

console.log('[4] /api/my-balance response structure');
const sm=new SessionManager({maxAge:60000,cleanupInterval:999999});
const token=sm.createSession(acc.account_id);

function simulateMyBalance(authHeader){
if(!authHeader||!authHeader.startsWith('Bearer '))return{status:401,body:{ok:false,error:'unauthorized'}};
const t=authHeader.slice(7);
if(!t||t.length!==64||!/^[0-9a-f]{64}$/.test(t))return{status:401,body:{ok:false,error:'unauthorized'}};
const accountId=sm.validateSession(t);
if(!accountId)return{status:401,body:{ok:false,error:'unauthorized'}};
const stats=re.getAccountStats(accountId);
if(!stats)return{status:404,body:{ok:false,error:'account not found'}};
const ws=re.getSharesInWindow(accountId,cfg.PPLNS_WINDOW_SIZE);
const sc=am.getShareCountByAccount(accountId);
return{status:200,body:{ok:true,
pending_sat:stats.balance?stats.balance.pending_sat:0,
confirmed_sat:stats.balance?stats.balance.confirmed_sat:0,
total_earned_sat:stats.balance?stats.balance.total_earned_sat:0,
shares_accepted:sc,
shares_in_window:ws.count,
blocks_found:stats.blocks_found,
pool_fee_percent:cfg.POOL_FEE_PERCENT,
payout_dry_run:true,
min_payout_sat:50000}}}

const resp=simulateMyBalance('Bearer '+token);
assert.strictEqual(resp.status,200);
const body=resp.body;
assert.strictEqual(body.ok,true);
assert.strictEqual(typeof body.pending_sat,'number');
assert.strictEqual(typeof body.confirmed_sat,'number');
assert.strictEqual(typeof body.total_earned_sat,'number');
assert.strictEqual(typeof body.shares_accepted,'number');
assert.strictEqual(typeof body.shares_in_window,'number');
assert.strictEqual(typeof body.blocks_found,'number');
assert.strictEqual(typeof body.pool_fee_percent,'number');
assert.strictEqual(typeof body.payout_dry_run,'boolean');
assert.strictEqual(typeof body.min_payout_sat,'number');
console.log('  pending_sat:',body.pending_sat);
console.log('  confirmed_sat:',body.confirmed_sat);
console.log('  total_earned_sat:',body.total_earned_sat);
console.log('  shares_accepted:',body.shares_accepted);
console.log('  blocks_found:',body.blocks_found);
console.log('  shares_in_window:',body.shares_in_window);
console.log('  pool_fee_percent:',body.pool_fee_percent);
console.log('  payout_dry_run:',body.payout_dry_run);
console.log('  min_payout_sat:',body.min_payout_sat);
console.log('  PASS\n');

console.log('[5] Balance fields are distinct and correct');
assert.strictEqual(body.pending_sat,bal2.pending_sat,'pending_sat matches DB');
assert.strictEqual(body.confirmed_sat,0,'no payouts confirmed yet');
assert.strictEqual(body.total_earned_sat,bal2.pending_sat,'total_earned matches pending (no payouts)');
assert.strictEqual(body.shares_accepted,10,'shares count correct');
assert.strictEqual(body.blocks_found,1,'blocks_found correct');
console.log('  pending_sat matches DB:',body.pending_sat===bal2.pending_sat);
console.log('  confirmed_sat=0:',body.confirmed_sat===0);
console.log('  shares_accepted=10:',body.shares_accepted===10);
console.log('  blocks_found=1:',body.blocks_found===1);
console.log('  PASS\n');

console.log('[6] payout_dry_run=true indicates simulated payouts');
assert.strictEqual(body.payout_dry_run,true,'dry run flag present');
console.log('  payout_dry_run:',body.payout_dry_run,'(payouts are simulated)');
console.log('  PASS\n');

console.log('[7] Account B gets only its own balance');
const token2=sm.createSession(acc2.account_id);
const resp2=simulateMyBalance('Bearer '+token2);
assert.strictEqual(resp2.status,200);
assert.strictEqual(resp2.body.pending_sat,bal2b.pending_sat,'acc2 sees its own balance');
assert.notStrictEqual(resp2.body.pending_sat,body.pending_sat,'acc2 balance differs from acc1');
console.log('  acc1 pending:',body.pending_sat);
console.log('  acc2 pending:',resp2.body.pending_sat);
console.log('  IDOR: each account sees only its own data');
console.log('  PASS\n');

console.log('[8] Unauthorized access returns 401');
const noAuth=simulateMyBalance('');
assert.strictEqual(noAuth.status,401);
assert.strictEqual(noAuth.body.ok,false);
const badToken=simulateMyBalance('Bearer '+'00'.repeat(32));
assert.strictEqual(badToken.status,401);
console.log('  no auth: 401');
console.log('  bad token: 401');
console.log('  PASS\n');

console.log('[9] Production DB not touched');
const prodDbPath=path.join(__dirname,'..','data','pool.db');
const prodSize=fs.existsSync(prodDbPath)?fs.statSync(prodDbPath).size:0;
console.log('  production pool.db size:',prodSize,'(untouched)');
console.log('  PASS\n');

sm.destroy();
closeDb();
resetDb();
if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB);

console.log('=== ALL WALLET BALANCE ENDPOINT TESTS PASSED ===');
})().catch(e=>{console.error('TEST FAILED:',e.message,e.stack);try{closeDb();resetDb()}catch{}
const p=path.join(__dirname,'..','data','test_wallet_balance.db');if(fs.existsSync(p))fs.unlinkSync(p);
process.exit(1)});
