const $=id=>document.getElementById(id);
const log=msg=>{if($('log'))$('log').textContent=new Date().toLocaleTimeString()+' // '+msg};
function clock(){if($('clock'))$('clock').textContent=new Date().toLocaleTimeString()}setInterval(clock,1000);clock();
async function getJSON(url,opt){const r=await fetch(url,opt);let d={};try{d=await r.json()}catch{}if(!r.ok||d.ok===false)throw Error(d.error||'HTTP '+r.status);return d}
async function refresh(){try{const s=await getJSON('/api/status');$('led').classList.add('on');$('statusText').textContent='ONLINE';$('network').textContent=s.chain.toUpperCase();$('blocks').textContent=s.blocks.toLocaleString();$('difficulty').textContent=Number(s.difficulty).toLocaleString(undefined,{maximumFractionDigits:2});$('hashrate').textContent=Number(s.networkhashps).toLocaleString(undefined,{maximumFractionDigits:0})+' H/s';try{const w=await getJSON('/api/wallet');$('wallet').textContent=w.walletname||'DEFAULT';if(typeof w.balance==='number')$('balance').textContent=w.balance.toFixed(8)+' BTC';else $('balance').textContent='N/A'}catch{$('wallet').textContent='NO WALLET';$('balance').textContent='N/A'}log('NODE OK // '+s.chain+' // HEIGHT '+s.blocks);return s}catch(e){$('led').classList.remove('on');$('statusText').textContent='OFFLINE';log('RPC ERROR // '+e.message);return null}}
async function template(){try{const t=await getJSON('/api/template');for(const[id,v]of Object.entries({templateHeight:t.height,tHeight:t.height,prev:t.previousblockhash,bits:t.bits,target:t.target,txcount:t.transactions,coinbase:(Number(t.coinbasevalue)/1e8).toFixed(8)+' BTC'}))$(id).textContent=v;$('minerStatus').textContent=running?'MINING':'TEMPLATE READY';log('TEMPLATE '+t.height+' READY')}catch(e){log('TEMPLATE ERROR // '+e.message)}}
$('refresh').onclick=refresh;$('template').onclick=template;
let ws=null,minerId=null,workers=[],running=false,jobHeight=0,jobId=null,exhausted=0,total=0,lastRate=performance.now(),hashes=0,validHashes=0,myShares=0;
let shareTarget=null,blockTarget=null,currentJob=null;
let walletRegistered=false,walletAddress=null;
function stopWorkers(){workers.forEach(w=>{try{w.postMessage({type:'stop'})}catch{};w.terminate()});workers=[];$('workerCount').textContent='0'}
function fmtRate(h){if(h>=1e6)return(h/1e6).toFixed(2)+' MH/s';if(h>=1e3)return(h/1e3).toFixed(2)+' KH/s';return Math.round(h)+' H/s'}
function setMiningRate(h){$('minerHashrate').textContent=fmtRate(h)}
async function registerWallet(){
const input=$('walletInput');
const errEl=$('walletError');
const addr=input.value.trim();
errEl.textContent='';
if(!addr){errEl.textContent='Introduce una direccion Bitcoin';return}
try{
const res=await getJSON('/api/register-miner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({btcAddress:addr})});
walletRegistered=true;
walletAddress=res.btcAddress;
$('walletStatus').textContent='REGISTERED';
$('walletAddress').textContent=res.btcAddress;
$('walletType').textContent=res.isNew?'NUEVA CUENTA':'CUENTA EXISTENTE';
input.disabled=true;
$('registerWallet').disabled=true;
$('registerWallet').textContent='[ REGISTRADO ]';
minerId=res.minerId;
log('WALLET REGISTERED: '+res.btcAddress);
if(!ws||ws.readyState!==1){connectWS()}}
catch(e){errEl.textContent='ERROR: '+e.message;log('REGISTER FAILED: '+e.message)}}
$('registerWallet').onclick=registerWallet;
$('walletInput').addEventListener('keydown',e=>{if(e.key==='Enter')registerWallet()});
let wsRetries=0,wsMaxRetries=5,wsReconnectTimer=null;
function scheduleWsReconnect(){
if(wsReconnectTimer)return;
if(wsRetries>=wsMaxRetries){log('WS GAVE UP AFTER '+wsMaxRetries+' ATTEMPTS // CHECK BACKEND');return}
wsRetries++;
const delay=Math.min(5000*wsRetries,30000);
log('WS RECONNECTING ('+wsRetries+'/'+wsMaxRetries+') IN '+(delay/1000)+'s...');
wsReconnectTimer=setTimeout(()=>{wsReconnectTimer=null;connectWS()},delay)}
function connectWS(){
const backendUrl=window.BACKEND_URL||location.origin.replace(/^http/,'ws');
const wsUrl=backendUrl+'/ws';
if(ws&&ws.readyState<=1)return;
try{ws=new WebSocket(wsUrl)}catch(e){log('WS CONNECT FAILED: '+e.message);scheduleWsReconnect();return}
ws.onopen=()=>{log('WEBSOCKET CONNECTED');wsRetries=0};
ws.onmessage=e=>{
const msg=JSON.parse(e.data);
if(msg.type==='welcome'){if(!minerId)minerId=msg.minerId;log('MINER ID: '+minerId);
if(walletRegistered){ws.send(JSON.stringify({type:'register',btcAddress:walletAddress}))}}
else if(msg.type==='registered'){
walletRegistered=true;
walletAddress=msg.btcAddress;
$('walletStatus').textContent='REGISTERED';
$('walletAddress').textContent=msg.btcAddress;
log('WALLET CONFIRMED: '+msg.btcAddress)}
else if(msg.type==='registerFailed'){
walletRegistered=false;
log('REGISTER FAILED: '+msg.error);
$('walletError').textContent='ERROR: '+msg.error}
else if(msg.type==='newJob'){
jobId=msg.jobId;jobHeight=msg.height;shareTarget=msg.shareTarget;blockTarget=msg.blockTarget;
currentJob={jobId:msg.jobId,height:msg.height,header:msg.header,midstate:msg.midstate,target:blockTarget,shareTarget:shareTarget,bodyHex:msg.bodyHex||''};
$('templateHeight').textContent=msg.height;
if(running){stopWorkers();startWorkers()}
log('NEW JOB: '+msg.height)}
else if(msg.type==='shareAccepted'){myShares++;updatePoolUI()}
else if(msg.type==='shareRejected'){log('SHARE REJECTED: '+msg.reason)}
else if(msg.type==='poolStats'){updatePoolUI(msg)}
else if(msg.type==='blockFound'){log('BLOCK FOUND BY '+msg.minerId+' AT HEIGHT '+msg.height);$('minerStatus').textContent='BLOCK FOUND!'}
else if(msg.type==='blockAccepted'){log('BLOCK ACCEPTED AT HEIGHT '+msg.height);$('minerStatus').textContent='BLOCK ACCEPTED!'}
else if(msg.type==='blockRejected'){log('BLOCK REJECTED: '+msg.reason)}
else if(msg.type==='error'){log('SERVER ERROR: '+msg.error)}};
ws.onclose=()=>{log('WEBSOCKET DISCONNECTED');ws=null;scheduleWsReconnect()};
ws.onerror=()=>{}}
function updatePoolUI(stats){
if($('poolShares'))$('poolShares').textContent=myShares.toString();
if($('myShares'))$('myShares').textContent=myShares.toString();
if($('validBlocks'))$('validBlocks').textContent=stats?(stats.validBlocks||0).toString():'0';
if($('lastReward'))$('lastReward').textContent='0 BTC';
if($('minersOnline'))$('minersOnline').textContent=stats?(stats.minersOnline||0).toString():'0';
if($('poolHashrate'))$('poolHashrate').textContent=stats?fmtRate(stats.totalHashrate||0):'0 H/s';
if(minerId&&walletRegistered){
fetch('/api/my-stats?minerId='+minerId).then(r=>r.json()).then(d=>{
if(d.ok){
if($('totalShares'))$('totalShares').textContent=(d.shares||0).toString();
if($('dashTotalShares'))$('dashTotalShares').textContent=(d.shares||0).toString();
if($('dashWindowShares'))$('dashWindowShares').textContent=(d.shares_in_window||0).toString();
if($('dashBlocksFound'))$('dashBlocksFound').textContent=(d.blocks_found||0).toString();
if(d.balance){
if($('dashPendingSat'))$('dashPendingSat').textContent=(d.balance.pending_sat||0).toString()+' sat';
if($('dashConfirmedSat'))$('dashConfirmedSat').textContent=(d.balance.confirmed_sat||0).toString()+' sat';
if($('dashTotalEarned'))$('dashTotalEarned').textContent=(d.balance.total_earned_sat||0).toString()+' sat';
if($('dashPendingBtc'))$('dashPendingBtc').textContent=d.balance.pending_btc||'0.00000000';
if($('dashConfirmedBtc'))$('dashConfirmedBtc').textContent=d.balance.confirmed_btc||'0.00000000'}}}).catch{}}
else{if($('totalShares'))$('totalShares').textContent='0'}}
function startWorkers(){
if(!currentJob||!currentJob.header)return;
const n=Math.max(1,Math.min(navigator.hardwareConcurrency||2,16));
const U=0x100000000,span=Math.floor(U/n);
exhausted=0;total=0;hashes=0;validHashes=0;lastRate=performance.now();
$('workerCount').textContent=String(n);
for(let i=0;i<n;i++){
const w=new Worker('/worker.js'),fromN=i*span,sp=i===n-1?U-fromN:span;
workers.push(w);
w.onmessage=e=>{const m=e.data||{};
if(m.type==='rate'){total+=m.count;hashes+=m.count;const now=performance.now();if(now-lastRate>=1000){setMiningRate(total*1000/(now-lastRate));total=0;lastRate=now;if(ws&&ws.readyState===1&&minerId){try{ws.send(JSON.stringify({type:'hashrate',hashes:hashes}));hashes=0}catch{}}}}
else if(m.type==='share'){if(ws&&ws.readyState===1){try{ws.send(JSON.stringify({type:'share',minerId,jobId:m.jobId,nonce:m.nonce,hashHex:m.hash}))}catch{}}}
else if(m.type==='nonce'){if(!running)return;validHashes++;$('minerStatus').textContent='BLOCK CANDIDATE';log('BLOCK CANDIDATE NONCE '+m.nonce);if(ws&&ws.readyState===1){try{ws.send(JSON.stringify({type:'share',minerId,jobId,nonce:m.nonce,hashHex:m.hash}))}catch{}}}};
w.postMessage({type:'start',job:currentJob,from:fromN,span:sp})}
log('MINING // '+n+' WORKERS // HEIGHT '+jobHeight)}
async function startMining(){
if(running)return;
if(!walletRegistered){log('ERROR: REGISTRA TU WALLET ANTES DE MINAR');$('minerStatus').textContent='WALLET REQUERIDA';return}
running=true;$('minerStatus').textContent='CONNECTING...';
if(!ws||ws.readyState!==1){connectWS();await new Promise(r=>setTimeout(r,2000))}
if(!currentJob){log('WAITING FOR JOB FROM SERVER...');$('minerStatus').textContent='WAITING FOR JOB';return}
$('minerStatus').textContent='MINING';startWorkers()}
function stopMining(){running=false;stopWorkers();$('minerStatus').textContent='STOPPED';setMiningRate(0);log('MINER STOPPED')}
$('start').onclick=startMining;$('stop').onclick=stopMining;
refresh();template();
