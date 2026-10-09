const assert=require('assert'),crypto=require('crypto'),SHA256D=require('../public/sha256d.js');
const{buildCoinbase,addressScript,buildJob,buildBlock,merkle,txidLE,dsha,compactVarint,pushdata,encodeScriptNum,stripSegwitWitness,coinbaseTxidLE,readVarint}=require('../lib/block-builder');
const JobManager=require('../lib/job-manager');
const ShareValidator=require('../lib/share-validator');
const MinerTracker=require('../lib/miner-tracker');
const RateLimiter=require('../lib/rate-limiter');

console.log('=== POOL MODULES TEST ===\n');

const ADDR='bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

const mockTemplate={
height:800000,
version:536870912,
previousblockhash:'00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
curtime:1700000000,
bits:'1d00ffff',
target:'00000000ffff0000000000000000000000000000000000000000000000000000',
coinbasevalue:312500000,
coinbaseaux:{flags:''},
default_witness_commitment:'6a24aa21a9ed'+crypto.randomBytes(32).toString('hex'),
transactions:[]};

console.log('[1] block-builder: addressScript');
const script=addressScript(ADDR);
assert.strictEqual(script[0],0x00,'bech32 v0');
assert.strictEqual(script[1],0x14,'20 byte program');
assert.strictEqual(script.length,22,'p2wpkh length');
console.log('  PASS\n');

console.log('[2] block-builder: buildCoinbase');
const cb=buildCoinbase(mockTemplate,ADDR);
assert(cb.tx.length>100,'coinbase tx size');
assert.strictEqual(cb.tx[0],2,'version 2');
assert.strictEqual(cb.tx[4],0,'segwit marker');
assert.strictEqual(cb.tx[5],1,'segwit flag');
const wcIdx=cb.tx.toString('hex').indexOf(mockTemplate.default_witness_commitment);
assert(wcIdx>0,'witness commitment in coinbase');
console.log('  PASS\n');

console.log('[3] block-builder: buildJob');
const job=buildJob(mockTemplate,ADDR);
assert.strictEqual(job.height,800000,'job height');
assert.strictEqual(job.header.length,80,'header 80 bytes');
assert(job.midstate.length===8,'midstate 8 words');
assert(job.target.length===32,'target 32 bytes');
assert(job.bodyHex.length>0,'body has content');
assert.strictEqual(job.bits,'1d00ffff','bits preserved');
console.log('  PASS\n');

console.log('[4] block-builder: header fields');
const header=Buffer.from(job.header);
assert.strictEqual(header.readUInt32LE(0),536870912,'version at offset 0');
const prevHashInHeader=Buffer.from(header.subarray(4,36)).reverse().toString('hex');
assert.strictEqual(prevHashInHeader,mockTemplate.previousblockhash,'prevhash at offset 4');
assert.strictEqual(header.readUInt32LE(68),1700000000,'curtime at offset 68');
const bitsInHeader=Buffer.from(header.subarray(72,76)).reverse().toString('hex');
assert.strictEqual(bitsInHeader,'1d00ffff','bits at offset 72');
console.log('  PASS\n');

console.log('[5] block-builder: buildBlock');
const blockHex=buildBlock(job,0);
assert(blockHex.length>=160,'block hex has content');
assert.strictEqual(blockHex.slice(0,160),header.toString('hex'),'block starts with header');
console.log('  PASS\n');

console.log('[6] JobManager: template and job generation');
const jm=new JobManager({PAYOUT_ADDRESS:ADDR,SHARE_DIFFICULTY:16,JOB_TIMEOUT_MS:120000});
const j=jm.setTemplate(mockTemplate);
assert(j.jobId,'job has id');
assert.strictEqual(j.height,800000,'job height');
assert(j.shareTarget.length===32,'share target 32 bytes');
assert(j.blockTarget.length===32,'block target 32 bytes');
assert(!j.stale,'job not stale');
console.log('  PASS\n');

console.log('[7] JobManager: stale detection');
const oldJobId=j.jobId;
const newTemplate={...mockTemplate,previousblockhash:'00000000000000000002a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3'};
jm.setTemplate(newTemplate);
assert(jm.isStale(oldJobId),'old job is stale');
assert(!jm.isStale(jm.getCurrentJob().jobId),'new job not stale');
console.log('  PASS\n');

console.log('[8] ShareValidator: valid share');
const sv=new ShareValidator(jm);
const currentJob=jm.getCurrentJob();
const testHeader=new Uint8Array(currentJob.header);
const testHash=SHA256D.hash80(testHeader,42);
const testHashHex=SHA256D.hex(testHash);
const result=sv.validate({minerId:'miner_test',jobId:currentJob.jobId,nonce:42,hashHex:testHashHex});
assert.strictEqual(result.valid,true,'valid share');
assert.strictEqual(result.error,undefined,'no error');
assert.strictEqual(result.stale,false,'not stale');
console.log('  PASS\n');

console.log('[9] ShareValidator: hash mismatch (fake share)');
const fakeResult=sv.validate({minerId:'miner_test',jobId:currentJob.jobId,nonce:99,hashHex:'00'.repeat(32)});
assert.strictEqual(fakeResult.valid,false,'invalid share');
assert(fakeResult.error.includes('mismatch'),'hash mismatch error');
console.log('  PASS\n');

console.log('[10] ShareValidator: stale job');
const staleResult=sv.validate({minerId:'miner_test',jobId:oldJobId,nonce:42,hashHex:testHashHex});
assert.strictEqual(staleResult.valid,false,'stale share rejected');
assert.strictEqual(staleResult.stale,true,'marked as stale');
console.log('  PASS\n');

console.log('[11] ShareValidator: invalid nonce');
const badNonce=sv.validate({minerId:'miner_test',jobId:currentJob.jobId,nonce:-1,hashHex:testHashHex});
assert.strictEqual(badNonce.valid,false,'negative nonce rejected');
const bigNonce=sv.validate({minerId:'miner_test',jobId:currentJob.jobId,nonce:0x100000000,hashHex:testHashHex});
assert.strictEqual(bigNonce.valid,false,'overflow nonce rejected');
console.log('  PASS\n');

console.log('[12] ShareValidator: invalid hash format');
const badHash=sv.validate({minerId:'miner_test',jobId:currentJob.jobId,nonce:42,hashHex:'ZZZZ'});
assert.strictEqual(badHash.valid,false,'bad hash format rejected');
console.log('  PASS\n');

console.log('[13] ShareValidator: payout not modifiable by client');
const clientNonce=777;
const clientHeader=new Uint8Array(currentJob.header);
const clientHash=SHA256D.hash80(clientHeader,clientNonce);
const clientHashHex=SHA256D.hex(clientHash);
const clientShare={minerId:'miner_test',jobId:currentJob.jobId,nonce:clientNonce,hashHex:clientHashHex,payoutAddress:'attacker_address'};
const clientResult=sv.validate(clientShare);
assert.strictEqual(clientResult.valid,true,'payout in share ignored (server uses own)');
console.log('  PASS\n');

console.log('[14] MinerTracker: register and track');
const mt=new MinerTracker({MAX_MINERS:100});
assert(mt.register('m1',null),'register m1');
assert(mt.register('m2',null),'register m2');
assert.strictEqual(mt.getMinerCount(),2,'2 miners');
mt.addShare('m1');
mt.addShare('m1');
mt.addShare('m2');
assert.strictEqual(mt.getMinerStats('m1').shares,2,'m1 has 2 shares');
assert.strictEqual(mt.getMinerStats('m2').shares,1,'m2 has 1 share');
assert.strictEqual(mt.getPoolStats().totalShares,3,'3 total shares');
console.log('  PASS\n');

console.log('[15] MinerTracker: invalid share tracking');
mt.addInvalidShare('m1');
assert.strictEqual(mt.getMinerStats('m1').invalidShares,1,'m1 has 1 invalid');
mt.addStaleShare('m2');
assert.strictEqual(mt.getMinerStats('m2').staleShares,1,'m2 has 1 stale');
console.log('  PASS\n');

console.log('[16] MinerTracker: max miners');
const mt2=new MinerTracker({MAX_MINERS:2});
assert(mt2.register('a',null),'register a');
assert(mt2.register('b',null),'register b');
assert.strictEqual(mt2.register('c',null),false,'c rejected (max reached)');
console.log('  PASS\n');

console.log('[17] MinerTracker: block recording');
mt.recordBlock(800000);
assert.strictEqual(mt.getPoolStats().validBlocks,1,'1 valid block');
assert.strictEqual(mt.getPoolStats().lastBlockHeight,800000,'last block height');
assert(mt.getPoolStats().lastBlockTime>0,'last block time set');
console.log('  PASS\n');

console.log('[18] RateLimiter: basic rate limiting');
const rl=new RateLimiter({maxPerMinute:5,maxSharesPerMinute:3});
assert(rl.check('m1','message'),'1st message OK');
assert(rl.check('m1','message'),'2nd message OK');
for(let i=0;i<3;i++)rl.check('m1','message');
assert(!rl.check('m1','message'),'6th message rejected');
assert(rl.check('m1','share'),'share has separate limit');
for(let i=0;i<2;i++)rl.check('m1','share');
assert(!rl.check('m1','share'),'4th share rejected');
console.log('  PASS\n');

console.log('[19] RateLimiter: per-miner isolation');
assert(rl.check('m2','message'),'m2 not affected by m1 limits');
console.log('  PASS\n');

console.log('[20] JobManager: share target calculation');
const jm2=new JobManager({PAYOUT_ADDRESS:ADDR,SHARE_DIFFICULTY:4,JOB_TIMEOUT_MS:120000});
jm2.setTemplate(mockTemplate);
const sj=jm2.getCurrentJob();
const shareTargetBuf=Buffer.from(sj.shareTarget);
const blockTargetBuf=Buffer.from(sj.blockTarget);
let shareBigInt=0n,blockBigInt=0n;
for(let i=0;i<32;i++){shareBigInt=(shareBigInt<<8n)|BigInt(shareTargetBuf[i]);blockBigInt=(blockBigInt<<8n)|BigInt(blockTargetBuf[i])}
assert(shareBigInt>blockBigInt,'share target > block target (easier)');
const maxTarget=(1n<<256n)-1n;
assert.strictEqual(shareBigInt,maxTarget/4n,'share target = maxTarget / difficulty');
console.log('  PASS\n');

mt.destroy();mt2.destroy();rl.destroy();

console.log('=== ALL POOL MODULE TESTS PASSED ===');
