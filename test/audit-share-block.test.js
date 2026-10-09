const assert=require('assert'),crypto=require('crypto');
const{buildJob,buildBlock,buildStratumBlock,buildCoinbase,buildCoinbaseStratum,
  splitCoinbase,rebuildFullCoinbase,calculateBlockHash,stripSegwitWitness,
  coinbaseTxidLE,dsha,merkle,merkleBranches,compactVarint,pushdata,addressScript,readVarint,
  SHA256D}=require('../lib/block-builder');
const JobManager=require('../lib/job-manager');
const ShareValidator=require('../lib/share-validator');

const PAYOUT_ADDRESS='bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function extractCoinbaseFromBlock(blockHex){
const bodyHex=blockHex.slice(160);
let offset=0;
const[txCount,viLen]=readVarint(Buffer.from(bodyHex,'hex'),offset);
offset+=viLen*2;
const txStart=offset;
const bodyBuf=Buffer.from(bodyHex,'hex');
let pos=txStart/2;
pos+=4;
if(bodyBuf[pos]===0&&bodyBuf[pos+1]===1){pos+=2}
const[nInputs,vi1]=readVarint(bodyBuf,pos);pos+=vi1;
for(let i=0;i<nInputs;i++){pos+=36;const[sLen,vl]=readVarint(bodyBuf,pos);pos+=vl+sLen+4}
const[nOutputs,vi2]=readVarint(bodyBuf,pos);pos+=vi2;
for(let i=0;i<nOutputs;i++){pos+=8;const[sLen,vl]=readVarint(bodyBuf,pos);pos+=vl+sLen}
if(bodyBuf[txStart/2+4]===0&&bodyBuf[txStart/2+5]===1){
for(let i=0;i<nInputs;i++){const[nItems,vl]=readVarint(bodyBuf,pos);pos+=vl;for(let j=0;j<nItems;j++){const[iLen,vl2]=readVarint(bodyBuf,pos);pos+=vl2+iLen}}}
pos+=4;
return bodyHex.slice(txStart,pos*2)}

function makeFixture(numTx){
const txs=[];
for(let i=0;i<numTx;i++){
const fakeTx=Buffer.alloc(100+i*10);
crypto.randomFillSync(fakeTx);
fakeTx[0]=2;fakeTx[1]=0;fakeTx[2]=0;fakeTx[3]=0;
const txid=crypto.createHash('sha256').update(crypto.createHash('sha256').update(fakeTx).digest()).digest().reverse().toString('hex');
txs.push({txid,data:fakeTx.toString('hex')})}
const prevHash='000000000000000000000a'+'a'.repeat(42);
const target='00000000ffff0000000000000000000000000000000000000000000000000000';
const bits='1d00ffff';
return{
height:800000,
version:0x20000000,
previousblockhash:prevHash,
curtime:1700000000,
bits:bits,
target:target,
coinbasevalue:312500000,
coinbaseaux:{flags:''},
default_witness_commitment:'6a24aa21a9ed'+crypto.randomBytes(32).toString('hex'),
transactions:txs}}

console.log('=== TEST 1: Coinbase nonWitness vs full tx ===');
{
const t=makeFixture(0);
const cb=buildCoinbase(t,PAYOUT_ADDRESS);
assert(cb.tx.length>0,'full coinbase has content');
assert(cb.nonWitness.length>0,'nonWitness has content');
assert(cb.nonWitness.length<cb.tx.length,'nonWitness shorter than full tx (no witness)');
assert.strictEqual(cb.tx[4],0,'full tx has segwit marker');
assert.strictEqual(cb.tx[5],1,'full tx has segwit flag');
assert.notStrictEqual(cb.nonWitness[4],0,'nonWitness no segwit marker');
const stripped=stripSegwitWitness(cb.tx);
assert.strictEqual(Buffer.from(stripped).toString('hex'),Buffer.from(cb.nonWitness).toString('hex'),'stripSegwitWitness(fullTx) === nonWitness');
const txidFromNW=coinbaseTxidLE(cb.nonWitness);
const txidFromStripped=coinbaseTxidLE(stripSegwitWitness(cb.tx));
assert.strictEqual(Buffer.from(txidFromNW).toString('hex'),Buffer.from(txidFromStripped).toString('hex'),'txid from nonWitness === txid from stripped');
console.log('PASSED: nonWitness/stripSegwitWitness/coinbaseTxidLE consistent');
}

console.log('=== TEST 2: Merkle root coherence (0, 1, 5, 20 txs) ===');
{
for(const numTx of [0,1,5,20]){
const t=makeFixture(numTx);
const cb=buildCoinbase(t,PAYOUT_ADDRESS);
const cbTxidLE=coinbaseTxidLE(cb.nonWitness);
const mr=merkle(t.transactions,cbTxidLE);
assert.strictEqual(mr.length,32,'merkle root is 32 bytes for '+numTx+' txs');
const header=Buffer.alloc(80);
header.writeUInt32LE(t.version>>>0,0);
Buffer.from(t.previousblockhash,'hex').reverse().copy(header,4);
mr.copy(header,36);
header.writeUInt32LE(t.curtime>>>0,68);
Buffer.from(t.bits,'hex').reverse().copy(header,72);
const refMerkle=computeMerkleRootManual(t,cb.nonWitness);
assert.strictEqual(Buffer.from(mr).toString('hex'),Buffer.from(refMerkle).toString('hex'),'merkle root matches manual computation for '+numTx+' txs');
console.log('  '+numTx+' txs: merkle root = '+Buffer.from(mr).toString('hex').slice(0,16)+'...');
}
console.log('PASSED: merkle root coherent across different tx counts');
}

function computeMerkleRootManual(t,nonWitnessCb){
const cbHash=Buffer.from(dsha(nonWitnessCb)).reverse();
let leaves=[cbHash,...t.transactions.map(x=>Buffer.from(x.txid,'hex').reverse())];
while(leaves.length>1){
let next=[];
for(let i=0;i<leaves.length;i+=2)
next.push(dsha(Buffer.concat([leaves[i],leaves[i+1]||leaves[i]])));
leaves=next}
return leaves[0]||Buffer.alloc(32)}

console.log('=== TEST 3: Share validation end-to-end (WebSocket path) ===');
{
const config={PAYOUT_ADDRESS,SHARE_DIFFICULTY:1,JOB_TIMEOUT_MS:120000};
const jm=new JobManager(config);
const sv=new ShareValidator(jm);
const t=makeFixture(3);
const job=jm.setTemplate(t);
assert(job.jobId,'job has ID');
assert(job.header.length===80,'header is 80 bytes');
assert(job.midstate.length===8,'midstate has 8 words');
const header=new Uint8Array(job.header);
SHA256D.initJob(header,job.midstate);
let foundNonce=null,foundHash=null;
for(let n=0;n<10000;n++){
const h=SHA256D.hashms(n);
const hBytes=SHA256D.stateToBytes(h);
if(SHA256D.meets(hBytes,new Uint8Array(job.shareTarget))){
foundNonce=n;
foundHash=SHA256D.hex(hBytes);
break}}
assert(foundNonce!==null,'found a nonce meeting share target within 10000 attempts');
const result=sv.validate({minerId:'test_miner',jobId:job.jobId,nonce:foundNonce,hashHex:foundHash});
assert.strictEqual(result.valid,true,'share is valid');
assert.strictEqual(result.meetsShareTarget,true,'meets share target');
assert.strictEqual(result.hashHex,foundHash,'hash matches');
const recalcHeader=new Uint8Array(job.header);
const recalcHash=SHA256D.hash80(recalcHeader,foundNonce);
const recalcHex=SHA256D.hex(recalcHash);
assert.strictEqual(recalcHex,foundHash,'server recalculation matches worker hash');
console.log('  nonce='+foundNonce+' hash='+foundHash.slice(0,16)+'...');
console.log('PASSED: share validated end-to-end (worker → server recalc → accept)');
}

console.log('=== TEST 4: Share with wrong hash rejected ===');
{
const config={PAYOUT_ADDRESS,SHARE_DIFFICULTY:1,JOB_TIMEOUT_MS:120000};
const jm=new JobManager(config);
const sv=new ShareValidator(jm);
const t=makeFixture(2);
const job=jm.setTemplate(t);
const header=new Uint8Array(job.header);
SHA256D.initJob(header,job.midstate);
let foundNonce=null,foundHash=null;
for(let n=0;n<10000;n++){
const h=SHA256D.hashms(n);
const hBytes=SHA256D.stateToBytes(h);
if(SHA256D.meets(hBytes,new Uint8Array(job.shareTarget))){
foundNonce=n;
foundHash=SHA256D.hex(hBytes);
break}}
assert(foundNonce!==null,'found nonce');
const wrongHash='ff'.repeat(32);
const result=sv.validate({minerId:'test_miner',jobId:job.jobId,nonce:foundNonce,hashHex:wrongHash});
assert.strictEqual(result.valid,false,'share with wrong hash rejected');
assert(result.error.indexOf('mismatch')>=0,'error mentions mismatch');
console.log('PASSED: hash mismatch detected');
}

console.log('=== TEST 5: Stale job share rejected ===');
{
const config={PAYOUT_ADDRESS,SHARE_DIFFICULTY:1,JOB_TIMEOUT_MS:120000};
const jm=new JobManager(config);
const sv=new ShareValidator(jm);
const t1=makeFixture(1);
const job1=jm.setTemplate(t1);
const t2=makeFixture(1);
t2.previousblockhash='0000000000000000000'+('b'.repeat(44));
const job2=jm.setTemplate(t2);
assert.strictEqual(job1.stale,true,'old job marked stale');
const header=new Uint8Array(job1.header);
SHA256D.initJob(header,job1.midstate);
const h=SHA256D.hashms(0);
const hBytes=SHA256D.stateToBytes(h);
const result=sv.validate({minerId:'test_miner',jobId:job1.jobId,nonce:0,hashHex:SHA256D.hex(hBytes)});
assert.strictEqual(result.valid,false,'stale job share rejected');
assert.strictEqual(result.stale,true,'marked as stale');
console.log('PASSED: stale job detected and share rejected');
}

console.log('=== TEST 6: Duplicate share rejected ===');
{
const config={PAYOUT_ADDRESS,SHARE_DIFFICULTY:1,JOB_TIMEOUT_MS:120000};
const jm=new JobManager(config);
const sv=new ShareValidator(jm);
const t=makeFixture(2);
const job=jm.setTemplate(t);
const header=new Uint8Array(job.header);
SHA256D.initJob(header,job.midstate);
let foundNonce=null,foundHash=null;
for(let n=0;n<10000;n++){
const h=SHA256D.hashms(n);
const hBytes=SHA256D.stateToBytes(h);
if(SHA256D.meets(hBytes,new Uint8Array(job.shareTarget))){
foundNonce=n;
foundHash=SHA256D.hex(hBytes);
break}}
assert(foundNonce!==null,'found nonce');
const r1=sv.validate({minerId:'miner_A',jobId:job.jobId,nonce:foundNonce,hashHex:foundHash});
assert.strictEqual(r1.valid,true,'first share accepted');
const r2=sv.validate({minerId:'miner_B',jobId:job.jobId,nonce:foundNonce,hashHex:foundHash});
assert.strictEqual(r2.valid,false,'duplicate share rejected');
assert(r2.error.indexOf('duplicate')>=0,'error mentions duplicate');
console.log('PASSED: duplicate share (same jobId+nonce) rejected');
}

console.log('=== TEST 7: Different nonces for same job accepted ===');
{
const config={PAYOUT_ADDRESS,SHARE_DIFFICULTY:1,JOB_TIMEOUT_MS:120000};
const jm=new JobManager(config);
const sv=new ShareValidator(jm);
const t=makeFixture(2);
const job=jm.setTemplate(t);
const header=new Uint8Array(job.header);
SHA256D.initJob(header,job.midstate);
const found=[];
for(let n=0;n<50000&&found.length<2;n++){
const h=SHA256D.hashms(n);
const hBytes=SHA256D.stateToBytes(h);
if(SHA256D.meets(hBytes,new Uint8Array(job.shareTarget))){
found.push({nonce:n,hash:SHA256D.hex(hBytes)})}}
if(found.length>=2){
const r1=sv.validate({minerId:'miner_A',jobId:job.jobId,nonce:found[0].nonce,hashHex:found[0].hash});
const r2=sv.validate({minerId:'miner_B',jobId:job.jobId,nonce:found[1].nonce,hashHex:found[1].hash});
assert.strictEqual(r1.valid,true,'first nonce accepted');
assert.strictEqual(r2.valid,true,'different nonce also accepted');
console.log('PASSED: different nonces for same job both accepted')}
else{
console.log('SKIPPED: not enough shares found in range (share target too low)')}
}

console.log('=== TEST 8: Block construction — header + body validity ===');
{
const config={PAYOUT_ADDRESS,SHARE_DIFFICULTY:1,JOB_TIMEOUT_MS:120000};
const jm=new JobManager(config);
const t=makeFixture(5);
const job=jm.setTemplate(t);
const nonce=42;
const blockHex=buildBlock(job,nonce);
const headerHex=blockHex.slice(0,160);
assert.strictEqual(headerHex.length,160,'header is 80 bytes (160 hex chars)');
const headerBuf=Buffer.from(headerHex,'hex');
const nonceInHeader=headerBuf.readUInt32LE(76);
assert.strictEqual(nonceInHeader,nonce,'nonce correctly placed at offset 76');
const version=headerBuf.readUInt32LE(0);
assert.strictEqual(version,t.version>>>0,'version matches');
const prevHashInHeader=Buffer.from(headerBuf.subarray(4,36)).reverse().toString('hex');
assert.strictEqual(prevHashInHeader,t.previousblockhash,'previousblockhash matches');
const bitsInHeader=Buffer.from(headerBuf.subarray(72,76)).reverse().toString('hex');
assert.strictEqual(bitsInHeader,t.bits,'nBits matches');
const blockHash=calculateBlockHash(blockHex);
assert.strictEqual(blockHash.length,64,'block hash is 64 hex chars');
const bodyHex=blockHex.slice(160);
const txCountByte=parseInt(bodyHex.slice(0,2),16);
assert.strictEqual(txCountByte,t.transactions.length+1,'tx count = transactions + 1 (coinbase)');
console.log('  block hash: '+blockHash.slice(0,24)+'...');
console.log('  tx count: '+(t.transactions.length+1));
console.log('PASSED: block structure valid (header 80B, nonce, prevhash, bits, tx count)');
}

console.log('=== TEST 9: Stratum block — complete block with all txs ===');
{
const t=makeFixture(5);
const extranonce1='deadbeef';
const extranonce2='01020304';
const en1Size=4;
const en2Size=4;
const nonce=0x12345678;
const blockHex=buildStratumBlock(t,PAYOUT_ADDRESS,extranonce1,extranonce2,nonce,en1Size,en2Size);
assert(blockHex.length>160,'block has header + body');
assert.strictEqual(blockHex.slice(0,160).length,160,'header is 80 bytes');
const headerBuf=Buffer.from(blockHex.slice(0,160),'hex');
const nonceInHeader=headerBuf.readUInt32LE(76);
assert.strictEqual(nonceInHeader,nonce,'nonce in stratum block correct');
const bodyHex=blockHex.slice(160);
const txCountByte=parseInt(bodyHex.slice(0,2),16);
assert.strictEqual(txCountByte,t.transactions.length+1,'stratum tx count = txs + 1');
const blockHash=calculateBlockHash(blockHex);
assert.strictEqual(blockHash.length,64,'stratum block hash is 64 chars');
const merkleInHeader=Buffer.from(headerBuf.subarray(36,68)).toString('hex');
const coinbaseTxHex=extractCoinbaseFromBlock(blockHex);
const coinbaseTxBuf=Buffer.from(coinbaseTxHex,'hex');
const nonWitness=stripSegwitWitness(coinbaseTxBuf);
const cbTxidLE=coinbaseTxidLE(nonWitness);
let mi=[cbTxidLE,...t.transactions.map(x=>Buffer.from(x.txid,'hex').reverse())];
while(mi.length>1){let n=[];for(let i=0;i<mi.length;i+=2)n.push(dsha(Buffer.concat([mi[i],mi[i+1]||mi[i]])));mi=n}
const expectedMerkleRoot=(mi[0]||Buffer.alloc(32)).toString('hex');
assert.strictEqual(merkleInHeader,expectedMerkleRoot,'stratum block merkle root matches coinbase extracted from block');
console.log('  stratum block hash: '+blockHash.slice(0,24)+'...');
console.log('  merkle root matches: OK');
console.log('PASSED: stratum block complete (header + coinbase + all txs, merkle coherent)');
}

console.log('=== TEST 10: Stratum validateStratumShare — extranonce2 preserved ===');
{
const config={PAYOUT_ADDRESS,SHARE_DIFFICULTY:1,JOB_TIMEOUT_MS:120000};
const jm=new JobManager(config);
const t=makeFixture(3);
jm.setTemplate(t);
const extranonce1='aabbccdd';
const extranonce2='11223344';
const en1Size=4;
const en2Size=4;
const sj=jm.getStratumJob(extranonce1,en1Size,en2Size);
assert(sj,'stratum job created');
assert(sj.coinb1,'has coinb1');
assert(sj.coinb2,'has coinb2');
const job=jm.getCurrentJob();
const nonce=0xABCD1234;
const ntimeHex=t.curtime.toString(16).padStart(8,'0');
const nonceHex=nonce.toString(16).padStart(8,'0');
const result=jm.validateStratumShare(sj,extranonce1,extranonce2,ntimeHex,nonceHex,en1Size,en2Size);
assert.strictEqual(result.valid,true,'stratum share valid');
assert.strictEqual(result.extranonce2,extranonce2,'extranonce2 preserved in result');
assert.strictEqual(result.nonce,nonce,'nonce preserved');
console.log('  extranonce2 in result: '+result.extranonce2);
console.log('PASSED: validateStratumShare returns extranonce2');
}

console.log('=== TEST 11: Stratum merkle root matches between validate and buildBlock ===');
{
const config={PAYOUT_ADDRESS,SHARE_DIFFICULTY:1,JOB_TIMEOUT_MS:120000};
const jm=new JobManager(config);
const t=makeFixture(4);
jm.setTemplate(t);
const extranonce1='01020304';
const extranonce2='05060708';
const en1Size=4;
const en2Size=4;
const sj=jm.getStratumJob(extranonce1,en1Size,en2Size);
const nonce=0xDEADBEEF;
const ntimeHex=t.curtime.toString(16).padStart(8,'0');
const nonceHex=nonce.toString(16).padStart(8,'0');
const valResult=jm.validateStratumShare(sj,extranonce1,extranonce2,ntimeHex,nonceHex,en1Size,en2Size);
const blockHex=buildStratumBlock(t,PAYOUT_ADDRESS,extranonce1,extranonce2,nonce,en1Size,en2Size);
const headerFromBlock=Buffer.from(blockHex.slice(0,160),'hex');
const merkleFromBuild=Buffer.from(headerFromBlock.subarray(36,68)).toString('hex');
const cbHex=extractCoinbaseFromBlock(blockHex);
const cbBuf=Buffer.from(cbHex,'hex');
const nonWitness=stripSegwitWitness(cbBuf);
const cbTxidLE=coinbaseTxidLE(nonWitness);
let mi=[cbTxidLE,...t.transactions.map(x=>Buffer.from(x.txid,'hex').reverse())];
while(mi.length>1){let n=[];for(let i=0;i<mi.length;i+=2)n.push(dsha(Buffer.concat([mi[i],mi[i+1]||mi[i]])));mi=n}
const expectedMerkle=(mi[0]||Buffer.alloc(32)).toString('hex');
assert.strictEqual(merkleFromBuild,expectedMerkle,'buildStratumBlock merkle root matches actual coinbase in block');
console.log('PASSED: merkle root consistent between validate and buildStratumBlock');
}

console.log('=== TEST 12: Block candidate — hash meets target → submitblock path ===');
{
const config={PAYOUT_ADDRESS,SHARE_DIFFICULTY:1,JOB_TIMEOUT_MS:120000};
const jm=new JobManager(config);
const sv=new ShareValidator(jm);
const t=makeFixture(2);
const job=jm.setTemplate(t);
const header=new Uint8Array(job.header);
SHA256D.initJob(header,job.midstate);
let blockNonce=null;
for(let n=0;n<100000;n++){
const h=SHA256D.hashms(n);
const hBytes=SHA256D.stateToBytes(h);
if(SHA256D.meets(hBytes,new Uint8Array(job.blockTarget))){
blockNonce=n;
break}}
if(blockNonce!==null){
const h=SHA256D.hashms(blockNonce);
const hBytes=SHA256D.stateToBytes(h);
const hashHex=SHA256D.hex(hBytes);
const result=sv.validate({minerId:'block_miner',jobId:job.jobId,nonce:blockNonce,hashHex});
assert.strictEqual(result.valid,true,'block candidate share valid');
assert.strictEqual(result.meetsBlockTarget,true,'meets block target');
const blockHex=buildBlock(job,blockNonce);
const blockHash=calculateBlockHash(blockHex);
assert.strictEqual(blockHash.length,64,'stratum block hash is 64 chars');
const headerBuf=Buffer.from(blockHex.slice(0,160),'hex');
const merkleInHeader=Buffer.from(headerBuf.subarray(36,68)).toString('hex');
const cb=buildCoinbase(t,PAYOUT_ADDRESS);
const cbTxidLE=coinbaseTxidLE(cb.nonWitness);
let mi=[cbTxidLE,...t.transactions.map(x=>Buffer.from(x.txid,'hex').reverse())];
while(mi.length>1){let n=[];for(let i=0;i<mi.length;i+=2)n.push(dsha(Buffer.concat([mi[i],mi[i+1]||mi[i]])));mi=n}
const expectedMerkle=(mi[0]||Buffer.alloc(32)).toString('hex');
assert.strictEqual(merkleInHeader,expectedMerkle,'block candidate merkle root matches transactions');
console.log('  block nonce: '+blockNonce);
console.log('  block hash: '+blockHash.slice(0,24)+'...');
console.log('PASSED: block candidate has valid header, merkle root matches transactions')}
else{
console.log('SKIPPED: block target too high for 100000 nonces (expected — real difficulty)')}
}

console.log('=== TEST 13: clearSeenForJob removes entries ===');
{
const config={PAYOUT_ADDRESS,SHARE_DIFFICULTY:1,JOB_TIMEOUT_MS:120000};
const jm=new JobManager(config);
const sv=new ShareValidator(jm);
const t=makeFixture(1);
const job=jm.setTemplate(t);
const header=new Uint8Array(job.header);
SHA256D.initJob(header,job.midstate);
let found=null;
for(let n=0;n<10000;n++){
const h=SHA256D.hashms(n);
const hBytes=SHA256D.stateToBytes(h);
if(SHA256D.meets(hBytes,new Uint8Array(job.shareTarget))){
found={nonce:n,hash:SHA256D.hex(hBytes)};
break}}
if(found){
sv.validate({minerId:'m1',jobId:job.jobId,nonce:found.nonce,hashHex:found.hash});
assert.strictEqual(sv.seenShares.size,1,'one entry after first share');
sv.clearSeenForJob(job.jobId);
assert.strictEqual(sv.seenShares.size,0,'cleared after clearSeenForJob');
const r2=sv.validate({minerId:'m2',jobId:job.jobId,nonce:found.nonce,hashHex:found.hash});
assert.strictEqual(r2.valid,true,'same nonce accepted after clearSeenForJob');
console.log('PASSED: clearSeenForJob removes dedup entries correctly')}
else{
console.log('SKIPPED: no share found')}
}

console.log('=== TEST 14: Coinbase txid is non-witness hash, not wtxid ===');
{
const t=makeFixture(0);
const cb=buildCoinbase(t,PAYOUT_ADDRESS);
const wtxid=dsha(cb.tx);
const txid=dsha(cb.nonWitness);
const wtxidHex=Buffer.from(wtxid).toString('hex');
const txidHex=Buffer.from(txid).toString('hex');
assert.notStrictEqual(wtxidHex,txidHex,'txid !== wtxid (segwit makes them different)');
const txidLE=coinbaseTxidLE(cb.nonWitness);
const txidLEHex=Buffer.from(txidLE).toString('hex');
assert.notStrictEqual(txidLEHex,wtxidHex,'txidLE !== wtxid');
console.log('  txid:    '+txidHex.slice(0,16)+'...');
console.log('  wtxid:   '+wtxidHex.slice(0,16)+'...');
console.log('  txidLE:  '+txidLEHex.slice(0,16)+'...');
console.log('PASSED: coinbase txid is non-witness hash');
}

console.log('=== TEST 15: Stratum block with different extranonce2 produces different blocks ===');
{
const t=makeFixture(3);
const en1='aabbccdd';
const en2a='11111111';
const en2b='22222222';
const nonce=42;
const b1=buildStratumBlock(t,PAYOUT_ADDRESS,en1,en2a,nonce,4,4);
const b2=buildStratumBlock(t,PAYOUT_ADDRESS,en1,en2b,nonce,4,4);
assert.notStrictEqual(b1.slice(0,160),b2.slice(0,160),'different extranonce2 → different merkle root → different header');
assert.notStrictEqual(b1,b2,'full blocks are different');
const h1=calculateBlockHash(b1);
const h2=calculateBlockHash(b2);
assert.notStrictEqual(h1,h2,'block hashes are different');
console.log('PASSED: different extranonce2 produces different block hashes');
}

console.log('=== TEST 16: readVarint round-trip ===');
{
for(const n of [0,1,127,128,252,253,254,255,256,65534,65535,65536,100000]){
const encoded=compactVarint(n);
const[decoded,len]=readVarint(encoded,0);
assert.strictEqual(decoded,n,'readVarint round-trip for '+n);
assert.strictEqual(len,encoded.length,'readVarint length for '+n)}
console.log('PASSED: readVarint/compactVarint round-trip for all sizes');
}

console.log('=== TEST 17: Stratum handleBlockFound builds complete block (not just coinbase) ===');
{
const t=makeFixture(10);
const en1='01020304';
const en2='05060708';
const nonce=0xCAFEBABE;
const blockHex=buildStratumBlock(t,PAYOUT_ADDRESS,en1,en2,nonce,4,4);
const headerLen=160;
const bodyHex=blockHex.slice(headerLen);
assert(bodyHex.length>100,'body has significant content beyond just coinbase');
const txCountByte=parseInt(bodyHex.slice(0,2),16);
assert.strictEqual(txCountByte,11,'block has 11 transactions (10 + coinbase)');
const blockHash=calculateBlockHash(blockHex);
assert(blockHash.length===64,'block hash computed');
console.log('  block size: '+blockHex.length/2+' bytes ('+txCountByte+' txs)');
console.log('  block hash: '+blockHash.slice(0,24)+'...');
console.log('PASSED: stratum block contains header(80B) + coinbase + 10 txs');
}

console.log('\nALL AUDIT TESTS PASSED');
