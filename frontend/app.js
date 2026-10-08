var $=function(id){return document.getElementById(id)};
var logLines=[];
var ws=null,minerId=null,workers=[],running=false;
var jobId=null,jobHeight=0,currentJob=null;
var myShares=0,rejectedCount=0;
var exhausted=0,total=0,lastRate=performance.now(),hashes=0;
var refreshTimer=null,statusTimer=null,wsHeartbeatTimer=null;
var wsRetries=0,wsMaxRetries=0,wsReconnectTimer=null,wsBaseDelay=3000,wsMaxDelay=60000;

function getBackendHttp(){
var u=window.BACKEND_URL||'';
if(u.indexOf('wss://')===0)return 'https://'+u.slice(6);
if(u.indexOf('ws://')===0)return 'http://'+u.slice(5);
return u||''}

function fmtRate(h){if(h>=1e6)return(h/1e6).toFixed(2)+' MH/s';if(h>=1e3)return(h/1e3).toFixed(2)+' KH/s';return Math.round(h)+' H/s'}
function fmtBtc(sat){return(sat/1e8).toFixed(8)+' BTC'}
function truncate(s,n){if(!s)return'';if(s.length<=n)return s;return s.slice(0,n-3)+'...'+s.slice(-4)}
function now(){return new Date().toLocaleTimeString()}

function log(msg){
var line='> ['+now()+'] '+msg;
logLines.push(line);
if(logLines.length>200)logLines.shift();
var el=$('log');
if(el)el.textContent=logLines.join('\n');
try{var el2=$('log');el2.scrollTop=el2.scrollHeight}catch(e){}}

function clock(){if($('clock'))$('clock').textContent=now()}
setInterval(clock,1000);clock();

function updateNodePanel(status){
var url=window.BACKEND_URL||'';
var host=url.replace(/wss?:\/\//,'').replace(/\/.*$/,'');
if($('backendUrl'))$('backendUrl').textContent=host;
if($('nodeConnection'))$('nodeConnection').textContent='WebSocket: '+status;
if(status==='CONNECTED'){
wsRetries=0;
if($('bitcoinCore')){$('bitcoinCore').textContent='CONNECTED';$('bitcoinCore').style.color='var(--green)'}
}else{
if($('bitcoinCore')){$('bitcoinCore').textContent='DISCONNECTED';$('bitcoinCore').style.color='var(--red)'}
}}

function updateMinerStatusUI(text){
var el=$('minerStatus');if(!el)return;
el.textContent=text;
el.classList.remove('s-mining','s-ok','s-err','s-warn');
if(text==='MINING'||text==='BLOCK CANDIDATE'||text==='CONNECTING...')el.classList.add('s-mining');
else if(text==='BLOCK FOUND!'||text==='BLOCK ACCEPTED!')el.classList.add('s-ok');
else if(text==='STOPPED'||text==='IDLE')el.classList.add('s-warn');
else if(text.indexOf('ERROR')>=0||text.indexOf('OFFLINE')>=0)el.classList.add('s-err');
}

function setMiningRate(h){if($('minerHashrate'))$('minerHashrate').textContent=fmtRate(h)}

async function getJSON(url,opt){
var r=await fetch(url,Object.assign({mode:'cors',signal:AbortSignal.timeout(60000)},opt||{}));
var d={};try{d=await r.json()}catch(e){}
if(!r.ok||d.ok===false)throw Error(d.error||'HTTP '+r.status);
return d}

async function checkBackend(){
var base=getBackendHttp();
if(!base){
updateNodePanel('DISCONNECTED');
log('BACKEND_URL NOT CONFIGURED');
return false}
try{
var d=await getJSON(base+'/api/health');
if($('led'))$('led').classList.add('on');
if($('statusText'))$('statusText').textContent='CONNECTED';
updateNodePanel('CONNECTED');
log('BACKEND CONNECTED // v'+(d.version||'?'));
return true}catch(e){
if($('led'))$('led').classList.remove('on');
if($('statusText'))$('statusText').textContent='OFFLINE';
updateNodePanel('DISCONNECTED');
log('BACKEND UNREACHABLE // '+e.message);
return false}}

async function fetchBlockchainData(){
var base=getBackendHttp();
if(!base){log('BACKEND_URL NOT CONFIGURED');return null}
try{
var s=await getJSON(base+'/api/status');
if($('led'))$('led').classList.add('on');
if($('statusText'))$('statusText').textContent='CONNECTED';
if(s.bitcoin_core==='offline'){
if($('bitcoinCore')){$('bitcoinCore').textContent='OFFLINE';$('bitcoinCore').style.color='var(--red)'}
if($('network'))$('network').textContent='WAITING';
if($('blocks'))$('blocks').textContent='---';
if($('difficulty'))$('difficulty').textContent='---';
if($('hashrate'))$('hashrate').textContent='---';
log('BACKEND OK // BITCOIN CORE OFFLINE // MINING UNAVAILABLE');
return s}
if($('network'))$('network').textContent=(s.chain||'mainnet').toUpperCase();
if($('networkLabel'))$('networkLabel').textContent=(s.chain||'mainnet').toUpperCase();
if($('bitcoinNetwork'))$('bitcoinNetwork').textContent=(s.chain||'mainnet').toUpperCase();
if($('blocks'))$('blocks').textContent=(s.blocks||0).toLocaleString();
if($('blocks2'))$('blocks2').textContent=(s.blocks||0).toLocaleString();
if($('difficulty'))$('difficulty').textContent=Number(s.difficulty||0).toLocaleString(undefined,{maximumFractionDigits:2});
if($('difficulty2'))$('difficulty2').textContent=Number(s.difficulty||0).toLocaleString(undefined,{maximumFractionDigits:2});
if($('hashrate'))$('hashrate').textContent=Number(s.networkhashps||0).toLocaleString(undefined,{maximumFractionDigits:0})+' H/s';
if($('hashrate2'))$('hashrate2').textContent=Number(s.networkhashps||0).toLocaleString(undefined,{maximumFractionDigits:0})+' H/s';
if($('bitcoinCore')){$('bitcoinCore').textContent='CONNECTED';$('bitcoinCore').style.color='var(--green)'}
if(s.verificationprogress&&s.verificationprogress<0.9999){
log('NODE OK // '+s.chain.toUpperCase()+' // HEIGHT '+s.blocks+' // SYNC '+(s.verificationprogress*100).toFixed(2)+'%')}
else{log('NODE OK // '+s.chain.toUpperCase()+' // HEIGHT '+s.blocks)}
if(s.warnings)log('WARNING: '+s.warnings);
return s}catch(e){
if($('bitcoinCore')){$('bitcoinCore').textContent='DISCONNECTED';$('bitcoinCore').style.color='var(--red)'}
log('RPC ERROR // '+e.message);
return null}}

async function fetchTemplateData(){
var base=getBackendHttp();
if(!base)return null;
try{
var t=await getJSON(base+'/api/template');
if($('tHeight'))$('tHeight').textContent=t.height;
if($('tHeight2'))$('tHeight2').textContent=t.height;
if($('templateHeight'))$('templateHeight').textContent=t.height;
if($('prev'))$('prev').textContent=truncate(t.previousblockhash,16);
if($('prev2'))$('prev2').textContent=truncate(t.previousblockhash,16);
if($('bits'))$('bits').textContent=t.bits;
if($('target'))$('target').textContent=truncate(t.target,16);
if($('target2'))$('target2').textContent=truncate(t.target,16);
if($('txcount'))$('txcount').textContent=t.transactions;
if($('txcount2'))$('txcount2').textContent=t.transactions;
if($('coinbase'))$('coinbase').textContent=(Number(t.coinbasevalue)/1e8).toFixed(8)+' BTC';
log('TEMPLATE '+t.height+' LOADED // '+t.transactions+' TX // '+truncate(t.previousblockhash,16));
return t}catch(e){
log('TEMPLATE ERROR // '+e.message);
return null}}

function storeJob(j){
jobId=j.jobId;
jobHeight=j.height;
currentJob={
jobId:j.jobId,
height:j.height,
header:j.header,
midstate:j.midstate,
target:j.blockTarget||j.target,
shareTarget:j.shareTarget,
bodyHex:j.bodyHex||'',
bits:j.bits||null,
previousblockhash:j.previousblockhash||null,
coinbasevalue:j.coinbasevalue||null
};
if($('templateHeight'))$('templateHeight').textContent=j.height;
if($('tHeight'))$('tHeight').textContent=j.height;
if($('tHeight2'))$('tHeight2').textContent=j.height;
if(j.bits&&$('bits'))$('bits').textContent=j.bits;
if(j.previousblockhash&&$('prev'))$('prev').textContent=truncate(j.previousblockhash,16);
if(j.previousblockhash&&$('prev2'))$('prev2').textContent=truncate(j.previousblockhash,16);
if(j.blockTarget&&$('target'))$('target').textContent=truncate(j.blockTarget.map(function(b){return(b<16?'0':'')+b.toString(16)}).join(''),16);
if(j.blockTarget&&$('target2'))$('target2').textContent=truncate(j.blockTarget.map(function(b){return(b<16?'0':'')+b.toString(16)}).join(''),16);
if(j.coinbasevalue&&$('coinbase'))$('coinbase').textContent=fmtBtc(j.coinbasevalue)}

function stopWorkers(){
workers.forEach(function(w){try{w.postMessage({type:'stop'})}catch(e){};w.terminate()});
workers=[];
if($('workerCount'))$('workerCount').textContent='0'}

function startWorkers(){
if(!currentJob||!currentJob.header)return;
stopWorkers();
var n=Math.max(1,Math.min(navigator.hardwareConcurrency||2,16));
var U=0x100000000,span=Math.floor(U/n);
exhausted=0;total=0;hashes=0;lastRate=performance.now();
if($('workerCount'))$('workerCount').textContent=String(n);
for(var i=0;i<n;i++){
var w=new Worker('/worker.js');
var fromN=i*span,sp=i===n-1?U-fromN:span;
workers.push(w);
w.onmessage=(function(workerIdx){return function(e){
var m=e.data||{};
if(m.type==='rate'){
total+=m.count;hashes+=m.count;
var n2=performance.now();
if(n2-lastRate>=1000){
setMiningRate(total*1000/(n2-lastRate));
total=0;lastRate=n2;
if(ws&&ws.readyState===1&&minerId){try{ws.send(JSON.stringify({type:'hashrate',hashes:hashes}));hashes=0}catch(e){}}
}}
else if(m.type==='share'){
if(ws&&ws.readyState===1){
try{ws.send(JSON.stringify({type:'share',minerId:minerId,jobId:m.jobId,nonce:m.nonce,hashHex:m.hash}))}catch(e){}}
else{myShares++;if($('myShares'))$('myShares').textContent=myShares.toString()}
}
else if(m.type==='nonce'){
if(!running)return;
updateMinerStatusUI('BLOCK CANDIDATE');
log('BLOCK CANDIDATE NONCE '+m.nonce);
if(ws&&ws.readyState===1){try{ws.send(JSON.stringify({type:'share',minerId:minerId,jobId:m.jobId,nonce:m.nonce,hashHex:m.hash}))}catch(e){}}
}}})(i);
w.postMessage({type:'start',job:currentJob,from:fromN,span:sp})}
log('MINING // '+n+' WORKERS // HEIGHT '+jobHeight)}

function scheduleWsReconnect(){
if(wsReconnectTimer)return;
wsRetries++;
var delay=Math.min(wsBaseDelay*Math.pow(2,wsRetries-1),wsMaxDelay);
delay+=Math.random()*1000;
log('WS RECONNECTING (attempt '+wsRetries+') IN '+(delay/1000).toFixed(1)+'s...');
wsReconnectTimer=setTimeout(function(){
wsReconnectTimer=null;
connectWS()},delay)}

window.addEventListener('visibilitychange',function(){
if(!document.hidden&&(!ws||ws.readyState!==1)){
log('PAGE VISIBLE - RECONNECTING...');
wsRetries=0;
if(wsReconnectTimer){clearTimeout(wsReconnectTimer);wsReconnectTimer=null}
connectWS()}});

window.addEventListener('online',function(){
log('NETWORK ONLINE - RECONNECTING...');
wsRetries=0;
if(wsReconnectTimer){clearTimeout(wsReconnectTimer);wsReconnectTimer=null}
connectWS()});

window.addEventListener('offline',function(){
log('NETWORK OFFLINE');
if(wsReconnectTimer){clearTimeout(wsReconnectTimer);wsReconnectTimer=null}});

function connectWS(){
var wsUrl=window.BACKEND_URL||'';
if(!wsUrl){log('BACKEND_URL NOT CONFIGURED');return}
if(ws&&ws.readyState<=1){return}
if(wsHeartbeatTimer){clearInterval(wsHeartbeatTimer);wsHeartbeatTimer=null}
try{ws=new WebSocket(wsUrl+'/ws')}catch(e){log('WS FAILED: '+e.message);scheduleWsReconnect();return}
ws.onopen=function(){
log('WEBSOCKET CONNECTED');
updateNodePanel('CONNECTED');
wsRetries=0;
wsHeartbeatTimer=setInterval(function(){
if(ws&&ws.readyState===1){try{ws.send(JSON.stringify({type:'ping'}))}catch(e){}}
},30000);
var btcAddress=$('btcAddress')?$('btcAddress').value.trim():'';
if(!btcAddress){log('BTC ADDRESS REQUIRED FOR MINING');return}
try{ws.send(JSON.stringify({type:'register',btcAddress:btcAddress}));log('REGISTERING...')}catch(e){log('REGISTER FAILED: '+e.message)}};
ws.onmessage=function(e){
var msg=JSON.parse(e.data);
if(msg.type==='welcome'){minerId=msg.minerId;log('MINER ID: '+minerId)}
else if(msg.type==='registered'){log('REGISTERED // '+msg.btcAddress)}
else if(msg.type==='newJob'){
storeJob(msg);
if(running){stopWorkers();startWorkers()}
log('NEW JOB: '+msg.height)}
else if(msg.type==='shareAccepted'){myShares++;if($('myShares'))$('myShares').textContent=myShares.toString()}
else if(msg.type==='shareRejected'){rejectedCount++;if($('rejectedShares'))$('rejectedShares').textContent=rejectedCount.toString();log('SHARE REJECTED: '+(msg.reason||''))}
else if(msg.type==='poolStats'){updatePoolUI(msg)}
else if(msg.type==='blockFound'){log('BLOCK FOUND BY '+msg.minerId+' AT HEIGHT '+msg.height);updateMinerStatusUI('BLOCK FOUND!')}
else if(msg.type==='blockAccepted'){log('BLOCK ACCEPTED AT HEIGHT '+msg.height);updateMinerStatusUI('BLOCK ACCEPTED!')}
else if(msg.type==='blockRejected'){log('BLOCK REJECTED: '+msg.reason)}
else if(msg.type==='pong'){}
else if(msg.type==='error'){log('ERROR: '+msg.error)}};
ws.onclose=function(){
if(wsHeartbeatTimer){clearInterval(wsHeartbeatTimer);wsHeartbeatTimer=null}
log('WS DISCONNECTED');
ws=null;
updateNodePanel('DISCONNECTED');
scheduleWsReconnect()};
ws.onerror=function(){}}

function updatePoolUI(stats){
if($('myShares'))$('myShares').textContent=myShares.toString();
if($('validBlocks'))$('validBlocks').textContent=stats?(stats.validBlocks||0).toString():'0';
if($('minersOnline'))$('minersOnline').textContent=stats?(stats.minersOnline||0).toString():'0';
if($('poolHashrate'))$('poolHashrate').textContent=stats?fmtRate(stats.totalHashrate||0):'0 H/s'}

async function startMining(){
if(running)return;
running=true;
updateMinerStatusUI('CONNECTING...');
var base=getBackendHttp();
if(base){
try{
var d=await getJSON(base+'/api/job');
if(d&&!d.error){storeJob(d);log('JOB FROM BACKEND')}
}catch(e){log('JOB FETCH FAILED: '+e.message)}}
if(!ws||ws.readyState!==1){connectWS()}
await new Promise(function(r){setTimeout(r,2000)});
if(!currentJob){
log('WAITING FOR JOB FROM SERVER...');
updateMinerStatusUI('WAITING FOR JOB');
var waitCount=0;
var waitInterval=setInterval(function(){waitCount++;if(currentJob||waitCount>15){clearInterval(waitInterval);if(currentJob){updateMinerStatusUI('MINING');startWorkers()}else{updateMinerStatusUI('NO JOB AVAILABLE');running=false}}},2000);
return}
updateMinerStatusUI('MINING');
startWorkers()}

function stopMining(){
running=false;
stopWorkers();
updateMinerStatusUI('STOPPED');
setMiningRate(0);
log('MINING STOPPED')}

if($('start'))$('start').onclick=startMining;
if($('stop'))$('stop').onclick=function(){stopMining();askSaveSession()};

var GOOGLE_CLIENT_ID='46928798077-vtsu6fln277j6s601n2b4feg1hrsfi72.apps.googleusercontent.com';
var SESSION_KEY='mining_btc_session';

function getSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY))}catch(e){return null}}
function saveSession(data){try{localStorage.setItem(SESSION_KEY,JSON.stringify(data))}catch(e){}}
function clearSession(){try{localStorage.removeItem(SESSION_KEY)}catch(e){}}

function showOverlay(){if($('sessionOverlay'))$('sessionOverlay').style.display='flex'}
function hideOverlay(){if($('sessionOverlay'))$('sessionOverlay').style.display='none';if($('googleBtnContainer'))$('googleBtnContainer').style.display='none'}

function setSessionContent(title,subtitle,buttons,showGoogleBtn){
if($('sessionTitle'))$('sessionTitle').textContent=title;
if($('sessionSubtitle'))$('sessionSubtitle').textContent=subtitle;
if($('sessionButtons')){
$('sessionButtons').innerHTML='';
buttons.forEach(function(b){
var btn=document.createElement('button');
btn.className='btn '+(b.cls||'btn-secondary');
btn.textContent=b.text;
btn.onclick=function(){b.action();hideOverlay()};
$('sessionButtons').appendChild(btn)})}
if($('googleBtnContainer')){
if(showGoogleBtn){
$('googleBtnContainer').style.display='flex';
$('googleBtnContainer').innerHTML='';
if(typeof google!=='undefined'&&google.accounts){
google.accounts.id.initialize({client_id:GOOGLE_CLIENT_ID,callback:handleGoogleCredential});
google.accounts.id.renderButton($('googleBtnContainer'),{theme:'filled_black',size:'medium',type:'standard',text:'signin_with',shape:'pill'})}
}else{$('googleBtnContainer').style.display='none'}}
showOverlay()}

function handleGoogleCredential(response){
try{
var data=JSON.parse(atob(response.credential.split('.')[1]));
var btcAddress=$('btcAddress')?$('btcAddress').value.trim():'';
if(!btcAddress){alert('Introduce tu BTC address antes de guardar la sesión');return}
saveSession({googleId:data.sub,name:data.name,email:data.email,btcAddress:btcAddress,savedAt:Date.now()});
log('SESSION SAVED as '+data.name);
alert('Sesión guardada como '+data.name+'. La próxima vez se restaurará automáticamente.');
hideOverlay()
}catch(e){alert('Error al guardar sesión: '+e.message)}}

function askSaveSession(){
var btcAddress=$('btcAddress')?$('btcAddress').value.trim():'';
if(!btcAddress)return;
setSessionContent('¿Guardar sesión?','¿Quieres guardar tu sesión para la próxima vez?',[{text:'Sí',cls:'btn-primary',action:function(){setSessionContent('Inicia sesión con Google','Tu BTC address se guardará con tu cuenta Google',[],true)}},{text:'No',cls:'btn-secondary',action:function(){}}],false)}

function restoreSavedSession(session){
if($('btcAddress'))$('btcAddress').value=session.btcAddress;
log('SESSION RESTORED: '+session.name+' ('+session.email+')');
updateMinerStatusUI('RESTORED');
connectWS()}

function checkSavedSession(){
var session=getSession();
if(!session)return;
setSessionContent('¿Continuar como '+session.name+'?','Tu BTC address guardada: '+session.btcAddress.substring(0,10)+'...'+session.btcAddress.substring(session.btcAddress.length-4),[{text:'Sí',cls:'btn-primary',action:function(){restoreSavedSession(session)}},{text:'No',cls:'btn-secondary',action:function(){clearSession()}}],false)}

window.addEventListener('beforeunload',function(e){
var btcAddress=$('btcAddress')?$('btcAddress').value.trim():'';
if(btcAddress&&running){askSaveSession()}});

(function initUI(){
var url=window.BACKEND_URL||'';
var host=url.replace(/wss?:\/\//,'').replace(/\/.*$/,'');
if($('backendUrl'))$('backendUrl').textContent=host;
if(host.indexOf('YOUR-RENDER')>=0||host.indexOf('REPLACE')>=0){
console.warn('BACKEND_URL not configured. Edit frontend/config.js with your Render URL.');
}})();

(async function init(){
log('SYSTEM INIT');
checkSavedSession();
var url=window.BACKEND_URL||'';
if(url.indexOf('YOUR-RENDER')>=0||url.indexOf('REPLACE')>=0){
log('BACKEND NOT CONFIGURED — EDIT frontend/config.js');
updateNodePanel('DISCONNECTED');
updateMinerStatusUI('NOT CONFIGURED');
return}
var backendOk=await checkBackend();
if(backendOk){
await fetchBlockchainData();
await fetchTemplateData();
if(statusTimer)clearInterval(statusTimer);
statusTimer=setInterval(fetchBlockchainData,30000);
if(refreshTimer)clearInterval(refreshTimer);
refreshTimer=setInterval(fetchTemplateData,30000)}
connectWS()})();