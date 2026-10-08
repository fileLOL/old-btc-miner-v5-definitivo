const crypto=require('crypto'),SHA256D=require('../public/sha256d.js');
function compactVarint(n){if(n<0xfd)return Buffer.from([n]);if(n<=0xffff)return Buffer.from([0xfd,n&255,n>>>8]);if(n<=0xffffffff)return Buffer.from([0xfe,n&255,n>>>8,(n>>>16)&255,(n>>>24)&255]);let b=Buffer.alloc(9);b[0]=0xff;b.writeBigUInt64LE(BigInt(n),1);return b}
function pushdata(buf){if(buf.length<76)return Buffer.concat([Buffer.from([buf.length]),buf]);if(buf.length<256)return Buffer.concat([Buffer.from([0x4c,buf.length]),buf]);throw Error('coinbase data too long')}
function encodeScriptNum(n){let x=BigInt(n),a=[];while(x){a.push(Number(x&255n));x>>=8n}if(a.length===0)a=[0];if(a[a.length-1]&0x80)a.push(0);return Buffer.from(a)}
const ALPH='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(s){let n=0n;for(const c of s){const i=ALPH.indexOf(c);if(i<0)throw Error('invalid base58');n=n*58n+BigInt(i)}let h=n.toString(16);if(h.length%2)h='0'+h;let b=Buffer.from(h,'hex');let z=0;for(const c of s){if(c==='1')z++;else break}return Buffer.concat([Buffer.alloc(z),b])}
function checksumOk(b){return crypto.createHash('sha256').update(crypto.createHash('sha256').update(b.subarray(0,-4)).digest()).digest().subarray(0,4).equals(b.subarray(-4))}
function addressScript(addr){
if(addr.toLowerCase().startsWith('bc1')){
const s=addr.toLowerCase(),pos=s.indexOf('1'),data=s.slice(pos+1);
const map='qpzry9x8gf2tvdw0s3jn54khce6mua7l';let vals=[];
for(const c of data.slice(0,-6)){const v=map.indexOf(c);if(v<0)throw Error('invalid bech32');vals.push(v)}
let witver=vals.shift();if(witver>16)throw Error('invalid witness version');
let acc=0,bits=0,out=[];
for(const v of vals){acc=(acc<<5)|v;bits+=5;while(bits>=8){bits-=8;out.push((acc>>bits)&255)}}
if(bits>=5||((acc<<(8-bits))&255))throw Error('invalid bech32 padding');
const prog=Buffer.from(out);
if((witver===0&&(prog.length!==20&&prog.length!==32))||(witver>0&&(prog.length<2||prog.length>40)))throw Error('invalid witness program');
return Buffer.concat([Buffer.from([witver===0?0:0x50+witver,prog.length]),prog])}
const b=b58(addr);if(b.length<5||!checksumOk(b))throw Error('invalid base58 checksum');
const ver=b[0],p=b.subarray(1,-4);
if(ver===0x00&&p.length===20)return Buffer.concat([Buffer.from([0x76,0xa9,0x14]),p,Buffer.from([0x88,0xac])]);
if(ver===0x05&&p.length===20)return Buffer.concat([Buffer.from([0xa9,0x14]),p,Buffer.from([0x87])]);
throw Error('unsupported address')}
function buildCoinbase(t,address){
const payout=addressScript(address);
const height=pushdata(encodeScriptNum(t.height));
const extra=crypto.randomBytes(8);
const prefix=Buffer.from((t.coinbaseaux&&t.coinbaseaux.flags)||'','hex');
let script=Buffer.concat([height,pushdata(prefix),pushdata(extra)]);
if(script.length<2)script=Buffer.concat([script,Buffer.from([0])]);
if(script.length>100)throw Error('coinbase scriptSig >100');
const reserved=Buffer.alloc(32);
const outs=[];
const value=Buffer.alloc(8);value.writeBigUInt64LE(BigInt(t.coinbasevalue));
outs.push(Buffer.concat([value,pushdata(payout)]));
if(t.default_witness_commitment){
const commitment=Buffer.from(t.default_witness_commitment,'hex');
const cv=Buffer.alloc(8);
outs.push(Buffer.concat([cv,pushdata(commitment)]))}
const tx=Buffer.concat([
Buffer.from([2,0,0,0]),
Buffer.from([0,1]),
Buffer.from([1]),
Buffer.alloc(32,0),
Buffer.alloc(4,255),
compactVarint(script.length),
script,
Buffer.alloc(4,255),
compactVarint(outs.length),
...outs,
Buffer.from([1]),
Buffer.from([32]),
reserved,
Buffer.alloc(4,0)]);
return{tx,script}}
function dsha(b){return crypto.createHash('sha256').update(crypto.createHash('sha256').update(b).digest()).digest()}
function txidLE(hex){return Buffer.from(dsha(Buffer.from(hex,'hex'))).reverse()}
function merkle(txs,coinbase){let a=[txidLE(coinbase.toString('hex')),...txs.map(x=>Buffer.from(x.txid,'hex').reverse())];while(a.length>1){let n=[];for(let i=0;i<a.length;i+=2)n.push(Buffer.from(dsha(Buffer.concat([a[i],a[i+1]||a[i]])).reverse()));a=n}return a[0]||Buffer.alloc(32)}
function merkleBranches(txs,coinbase){
let a=[txidLE(coinbase.toString('hex')),...txs.map(x=>Buffer.from(x.txid,'hex').reverse())];
let branches=[];
while(a.length>1){
let n=[];
for(let i=0;i<a.length;i+=2){
if(i+1<a.length){branches.push(a[i+1].toString('hex'))}
n.push(Buffer.from(dsha(Buffer.concat([a[i],a[i+1]||a[i]])).reverse()))}
a=n}
return branches}
function buildCoinbaseStratum(t,address,extranonce1Size,extranonce2Size){
const payout=addressScript(address);
const height=pushdata(encodeScriptNum(t.height));
const prefix=Buffer.from((t.coinbaseaux&&t.coinbaseaux.flags)||'','hex');
const extranonceSpace=Buffer.alloc(extranonce1Size+extranonce2Size);
const extra=crypto.randomBytes(2);
const prefixPushed=pushdata(prefix);
const enPushed=pushdata(extranonceSpace);
const extraPushed=pushdata(extra);
let script=Buffer.concat([height,prefixPushed,enPushed,extraPushed]);
if(script.length<2)script=Buffer.concat([script,Buffer.from([0])]);
if(script.length>100)throw Error('coinbase scriptSig >100');
const extranonceOffset=height.length+prefixPushed.length;
const reserved=Buffer.alloc(32);
const outs=[];
const value=Buffer.alloc(8);value.writeBigUInt64LE(BigInt(t.coinbasevalue));
outs.push(Buffer.concat([value,pushdata(payout)]));
if(t.default_witness_commitment){
const commitment=Buffer.from(t.default_witness_commitment,'hex');
const cv=Buffer.alloc(8);
outs.push(Buffer.concat([cv,pushdata(commitment)]))}
const tx=Buffer.concat([
Buffer.from([2,0,0,0]),
Buffer.from([0,1]),
Buffer.from([1]),
Buffer.alloc(32,0),
Buffer.alloc(4,255),
compactVarint(script.length),
script,
Buffer.alloc(4,255),
compactVarint(outs.length),
...outs,
Buffer.from([1]),
Buffer.from([32]),
reserved,
Buffer.alloc(4,0)]);
return{tx,script,extranonceOffset}}
function splitCoinbase(script,extranonceOffset,extranonce1Size,extranonce2Size){
const enStart=extranonceOffset;
const enEnd=extranonceOffset+extranonce1Size+extranonce2Size;
const coinb1=script.subarray(0,enStart);
const coinb2=script.subarray(enEnd);
return{coinb1:coinb1.toString('hex'),coinb2:coinb2.toString('hex')}}
function buildJob(t,address){
const cb=buildCoinbase(t,address).tx;
const mr=merkle(t.transactions||[],cb);
const header=Buffer.alloc(80);
header.writeUInt32LE(t.version>>>0,0);
Buffer.from(t.previousblockhash,'hex').reverse().copy(header,4);
mr.copy(header,36);
header.writeUInt32LE(t.curtime>>>0,68);
Buffer.from(t.bits,'hex').reverse().copy(header,72);
const mid=SHA256D.computeMidstate(header);
const body=Buffer.concat([compactVarint((t.transactions||[]).length+1),cb,...(t.transactions||[]).map(x=>Buffer.from(x.data,'hex'))]);
return{height:t.height,header:[...header],target:[...Buffer.from(t.target,'hex')],midstate:Array.from(mid),bodyHex:body.toString('hex'),bits:t.bits,coinbasevalue:t.coinbasevalue}}
function buildBlock(job,nonce){
const h=new Uint8Array(job.header);
h[76]=nonce&255;h[77]=(nonce>>>8)&255;h[78]=(nonce>>>16)&255;h[79]=(nonce>>>24)&255;
return SHA256D.hex(h)+job.bodyHex}
function buildStratumJob(t,address,extranonce1,extranonce1Size,extranonce2Size){
const cb=buildCoinbaseStratum(t,address,extranonce1Size,extranonce2Size);
const branches=merkleBranches(t.transactions||[],cb.tx);
const scriptSplit=splitCoinbase(cb.script,cb.extranonceOffset,extranonce1Size,extranonce2Size);
const coinb1WithEn1=scriptSplit.coinb1+extranonce1;
const coinb2=scriptSplit.coinb2;
return{
coinb1:coinb1WithEn1,
coinb2:coinb2,
merkleBranches:branches,
version:t.version.toString(16).padStart(8,'0'),
prevhash:t.previousblockhash,
nbits:t.bits,
ntime:t.curtime.toString(16).padStart(8,'0'),
height:t.height,
coinbasevalue:t.coinbasevalue,
bits:t.bits}}
module.exports={compactVarint,pushdata,encodeScriptNum,addressScript,buildCoinbase,buildCoinbaseStratum,splitCoinbase,dsha,txidLE,merkle,merkleBranches,buildJob,buildBlock,buildStratumJob,SHA256D};
