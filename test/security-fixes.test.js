const http=require('http');
const crypto=require('crypto');
const path=require('path');
const fs=require('fs');

const TEST_PORT=3847;
const ADMIN_TOKEN=crypto.randomBytes(32).toString('hex');
const TEST_DB=path.join(__dirname,'..','data','test-security.db');

function cleanup(){
try{if(fs.existsSync(TEST_DB))fs.unlinkSync(TEST_DB)}catch(e){}
try{const wal=TEST_DB+'-wal';if(fs.existsSync(wal))fs.unlinkSync(wal)}catch(e){}
try{const shm=TEST_DB+'-shm';if(fs.existsSync(shm))fs.unlinkSync(shm)}catch(e){}
}
cleanup();

process.env.PORT=String(TEST_PORT);
process.env.DB_PATH=TEST_DB;
process.env.ADMIN_TOKEN=ADMIN_TOKEN;
process.env.PAYOUT_DRY_RUN='true';
process.env.ALLOWED_ORIGINS='https://mining-btc.vercel.app';
process.env.BITCOIN_CLI='nonexistent-cli-for-test';

const{app,server}=require('../server.js');

function req(method,urlPath,headers,body){
return new Promise(function(resolve,reject){
const opts={hostname:'127.0.0.1',port:TEST_PORT,path:urlPath,method:method,headers:headers||{}};
if(body){opts.headers['Content-Type']='application/json';opts.headers['Content-Length']=Buffer.byteLength(body)}
const r=http.request(opts,function(res){
let data='';
res.on('data',function(c){data+=c});
res.on('end',function(){
let parsed=null;
try{parsed=JSON.parse(data)}catch(e){}
resolve({status:res.statusCode,headers:res.headers,body:parsed,raw:data})})});
r.on('error',reject);
if(body)r.write(body);
r.end()})}

let testNum=0;
let passed=0;
let failed=0;

function assert(condition,msg){
testNum++;
if(condition){passed++;console.log(`[${testNum}] PASS: ${msg}`)}
else{failed++;console.log(`[${testNum}] FAIL: ${msg}`)}}

async function runTests(){
await new Promise(function(r){setTimeout(r,1500)});

console.log('=== SECURITY FIXES TEST ===\n');

console.log('--- Public endpoints remain accessible ---');
let res=await req('GET','/api/health',{});
assert(res.status===200,'/api/health public (200 without auth)');

res=await req('GET','/api/pool-info',{});
assert(res.status===200,'/api/pool-info public (200 without auth)');

res=await req('GET','/api/pool-stats',{});
assert(res.status===200,'/api/pool-stats public (200 without auth)');

console.log('\n--- Security headers ---');
assert(res.headers['x-content-type-options']==='nosniff','X-Content-Type-Options: nosniff present');
assert(res.headers['x-frame-options']==='DENY','X-Frame-Options: DENY present');
assert(res.headers['x-xss-protection']==='1; mode=block','X-XSS-Protection present');
assert(res.headers['referrer-policy']==='strict-origin-when-cross-origin','Referrer-Policy present');

console.log('\n--- CORS: Allowed origins ---');
res=await req('GET','/api/health',{'Origin':'https://mining-btc.vercel.app'});
assert(res.headers['access-control-allow-origin']==='https://mining-btc.vercel.app','CORS allows Vercel origin');

res=await req('GET','/api/health',{'Origin':'http://localhost:3000'});
assert(res.headers['access-control-allow-origin']==='http://localhost:3000','CORS allows localhost (development)');

console.log('\n--- CORS: Blocked origins ---');
res=await req('GET','/api/health',{'Origin':'https://evil-site.com'});
assert(!res.headers['access-control-allow-origin']||res.headers['access-control-allow-origin']!=='https://evil-site.com','CORS blocks unauthorized origin');

res=await req('GET','/api/health',{'Origin':'http://attacker.example'});
assert(!res.headers['access-control-allow-origin']||res.headers['access-control-allow-origin']!=='http://attacker.example','CORS blocks non-localhost HTTP origin');

console.log('\n--- Fix 1: /api/send requires admin auth ---');
res=await req('POST','/api/send',{},'{}');
assert(res.status===401,'/api/send without auth returns 401');
assert(res.body&&res.body.error==='admin auth required','/api/send returns correct error');

res=await req('POST','/api/send',{Authorization:'Bearer invalid_token_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'},'{}');
assert(res.status===401,'/api/send with invalid token returns 401');

console.log('\n--- Fix 2: /api/wallet requires admin auth ---');
res=await req('GET','/api/wallet',{});
assert(res.status===401,'/api/wallet without auth returns 401');
assert(res.body&&res.body.error==='admin auth required','/api/wallet returns correct error');

console.log('\n--- Fix 3: /api/admin/* requires admin auth ---');
res=await req('GET','/api/admin/test-payout/status',{});
assert(res.status===401,'/api/admin/test-payout/status without auth returns 401');

res=await req('POST','/api/admin/test-payout/run',{},'{}');
assert(res.status===401,'/api/admin/test-payout/run without auth returns 401');

res=await req('GET','/api/admin/test-payout/state',{});
assert(res.status===401,'/api/admin/test-payout/state without auth returns 401');

res=await req('GET','/api/admin/test-payout/status',{Authorization:'Bearer '+ADMIN_TOKEN});
assert(res.status===200,'/api/admin/test-payout/status with admin auth returns 200');

console.log('\n--- Fix 4: /api/payouts, /api/audit, /api/payout-stats require admin auth ---');
res=await req('GET','/api/payouts',{});
assert(res.status===401,'/api/payouts without auth returns 401');

res=await req('GET','/api/payout-stats',{});
assert(res.status===401,'/api/payout-stats without auth returns 401');

res=await req('GET','/api/audit',{});
assert(res.status===401,'/api/audit without auth returns 401');

res=await req('GET','/api/audit/summary',{});
assert(res.status===401,'/api/audit/summary without auth returns 401');

res=await req('GET','/api/payouts',{Authorization:'Bearer '+ADMIN_TOKEN});
assert(res.status===200,'/api/payouts with admin auth returns 200');

res=await req('GET','/api/payout-stats',{Authorization:'Bearer '+ADMIN_TOKEN});
assert(res.status===200,'/api/payout-stats with admin auth returns 200');

res=await req('GET','/api/audit',{Authorization:'Bearer '+ADMIN_TOKEN});
assert(res.status===200,'/api/audit with admin auth returns 200');

res=await req('GET','/api/audit/summary',{Authorization:'Bearer '+ADMIN_TOKEN});
assert(res.status===200,'/api/audit/summary with admin auth returns 200');

console.log('\n--- Balance info protected in miner stats ---');
res=await req('GET','/api/my-stats',{});
assert(res.status===401,'/api/my-stats without auth returns 401');

console.log('\n--- Admin token timing-safe comparison ---');
const wrongToken='0000000000000000000000000000000000000000000000000000000000000000';
res=await req('GET','/api/admin/test-payout/status',{Authorization:'Bearer '+wrongToken});
assert(res.status===401,'Wrong admin token rejected (401)');

const almostRight=ADMIN_TOKEN.slice(0,-2)+'00';
res=await req('GET','/api/admin/test-payout/status',{Authorization:'Bearer '+almostRight});
assert(res.status===401,'Almost-right admin token rejected (401)');

console.log('\n--- Fix 6: HTTP rate limiting ---');
res=await req('GET','/api/health',{});
assert(res.status===200,'First request succeeds (under rate limit)');

let rateLimited=false;
for(let i=0;i<130;i++){
res=await req('GET','/api/health',{});
if(res.status===429){rateLimited=true;break}}
assert(rateLimited,'Rate limit triggers after 120 requests (429)');

// --- Rate limiting con X-Tailscale-Client-IP ---
console.log('\n--- Rate limiting con proxy headers ---');
res=await req('GET','/api/health',{'X-Tailscale-Client-IP':'203.0.113.1'});
assert(res.status===200,'Rate limit uses X-Tailscale-Client-IP header');

// --- WebSocket sin Origin ---
console.log('\n--- WebSocket sin Origin ---');
const WebSocket=require('ws');
const ws=new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`);
await new Promise((resolve)=>{
ws.on('open',()=>{
assert(true,'WebSocket sin Origin se conecta (comportamiento esperado)');
ws.close();
resolve();
});
ws.on('error',(err)=>{
assert(false,'WebSocket sin Origin falla: '+err.message);
resolve();
});
});

// --- WebSocket con Origin no autorizado ---
console.log('\n--- WebSocket con Origin no autorizado ---');
const ws2=new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`,{
headers:{'Origin':'https://evil.example'}
});
await new Promise((resolve)=>{
ws2.on('open',()=>{
assert(false,'WebSocket con Origin no autorizado NO debería conectarse');
ws2.close();
resolve();
});
ws2.on('error',()=>{
assert(true,'WebSocket con Origin no autorizado rechazado');
resolve();
});
ws2.on('close',()=>{
assert(true,'WebSocket con Origin no autorizado cerrado');
resolve();
});
});

console.log('\n========================================');
console.log(`SECURITY TESTS: ${passed} passed, ${failed} failed`);
console.log('========================================');

if(failed>0)process.exitCode=1;

cleanup();
process.exit(failed>0?1:0)}

setTimeout(runTests,500);
