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
shareTarget:j.shareTarget||null,
bodyHex:j.bodyHex||'',
bits:j.bits||null,
previousblockhash:j.previousblockhash||null,
coinbasevalue:j.coinbasevalue||null
};
console.log('[Job] Stored job:',{jobId:j.jobId,height:j.height,hasShareTarget:!!j.shareTarget,shareTarget:j.shareTarget?JSON.stringify(j.shareTarget).slice(0,50):'null'});
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
console.log('[Share] Sending to server:',m.nonce);
try{ws.send(JSON.stringify({type:'share',minerId:minerId,jobId:m.jobId,nonce:m.nonce,hashHex:m.hash}))}catch(e){console.error('[Share] Send error:',e)}}
else{myShares++;console.log('[Share] Counted locally (no WS):',myShares);if($('myShares'))$('myShares').textContent=myShares.toString()}
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
else if(msg.type==='shareAccepted'){myShares++;console.log('[Shares] Accepted:',myShares);if($('myShares'))$('myShares').textContent=myShares.toString()}
else if(msg.type==='shareRejected'){rejectedCount++;console.log('[Shares] Rejected:',rejectedCount);if($('rejectedShares'))$('rejectedShares').textContent=rejectedCount.toString();log('SHARE REJECTED: '+(msg.reason||''))}
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
var deferredPrompt=null;
window.addEventListener('beforeinstallprompt',function(e){deferredPrompt=e});
if($('downloadApp'))$('downloadApp').onclick=function(){
if(deferredPrompt){deferredPrompt.prompt();deferredPrompt.userChoice.then(function(r){deferredPrompt=null});return}
var isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)&&!window.MSStream;
if(isIOS&&!navigator.standalone){log('iOS: Pulsa Compartir > "Añadir a pantalla de inicio"');return}
log('APP NO DISPONIBLE PARA INSTALAR');
};

var GOOGLE_CLIENT_ID='46928798077-vtsu6fln277j6s601n2b4feg1hrsfi72.apps.googleusercontent.com';
var SESSION_KEY='mining_btc_session';
var googleReady=false;
var googleTokenClient=null;

function initGoogle(){
if(typeof google!=='undefined'&&google.accounts){
console.log('[Session] Google library detected, initializing...');
try{
google.accounts.id.initialize({
client_id:GOOGLE_CLIENT_ID,
callback:handleGoogleCredential
});
googleReady=true;
console.log('[Session] Google initialized successfully');
}catch(e){
console.error('[Session] Google init error:',e);
googleReady=false;
}
}else{
console.log('[Session] Google not ready, retrying...');
setTimeout(initGoogle,300);
}
}

function getSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY))}catch(e){return null}}
function saveSession(data){try{localStorage.setItem(SESSION_KEY,JSON.stringify(data))}catch(e){}}
function clearSession(){try{localStorage.removeItem(SESSION_KEY)}catch(e){}}

function showOverlay(){
var el=$('sessionOverlay');
if(el){
el.style.display='flex';
console.log('[Session] Overlay shown');
}else{
console.error('[Session] Overlay element not found');
}
}
function hideOverlay(){
var el=$('sessionOverlay');
if(el)el.style.display='none';
}

function setSessionContent(title,subtitle,buttons,showGoogleBtn){
console.log('[Session] setSessionContent called:',{title,subtitle,buttons:buttons.length,showGoogleBtn});
if($('sessionTitle'))$('sessionTitle').textContent=title;
if($('sessionSubtitle'))$('sessionSubtitle').textContent=subtitle;
if($('sessionButtons')){
$('sessionButtons').innerHTML='';
buttons.forEach(function(b){
var btn=document.createElement('button');
btn.className='btn '+(b.cls||'btn-secondary');
btn.textContent=b.text;
btn.onclick=function(){
console.log('[Session] Button clicked:',b.text);
b.action();
if(b.closeOverlay!==false)hideOverlay();
};
$('sessionButtons').appendChild(btn);
});
}
if(showGoogleBtn){
console.log('[Session] Adding Google button');
var btnArea=document.createElement('div');
btnArea.style.cssText='margin-top:16px;width:100%;display:flex;flex-direction:column;align-items:center;gap:8px;';
var btn=document.createElement('button');
btn.className='btn btn-primary';
btn.style.cssText='width:100%;max-width:300px;padding:14px 24px;font-size:15px;font-weight:600;cursor:pointer;border:none;';
btn.textContent='Iniciar sesión con Google';
btn.onclick=function(){
console.log('[Session] Google sign-in clicked, googleReady:',googleReady);
if(!googleReady){alert('Google no está listo, espera un momento.');return;}
try{
google.accounts.id.prompt(function(n){
console.log('[Session] Prompt callback - notDisplayed:',n.isNotDisplayed(),'skipped:',n.isSkippedMoment(),'dismissed:',n.isDismissedMoment());
if(n.isNotDisplayed()){
google.accounts.id.cancel();
setTimeout(function(){
google.accounts.id.prompt(function(n2){
console.log('[Session] Second prompt - notDisplayed:',n2.isNotDisplayed());
if(n2.isNotDisplayed()){
alert('No se pudo abrir Google. Asegúrate de que las ventanas emergentes están permitidas.');
}
});
},500);
}
});
}catch(e){
console.error('[Session] Google error:',e);
alert('Error al iniciar Google: '+e.message);
}
};
btnArea.appendChild(btn);
$('sessionButtons').appendChild(btnArea);
}
showOverlay();
}

function handleGoogleCredential(response){
console.log('[Session] Google credential received');
try{
var parts=response.credential.split('.');
if(parts.length!==3){
throw new Error('Invalid JWT format');
}
var payload=parts[1];
var base64=payload.replace(/-/g,'+').replace(/_/g,'/');
while(base64.length%4){base64+='=';}
var data=JSON.parse(atob(base64));
console.log('[Session] Google user data:',data);
var session=getSession();
var btcAddress=session&&session.btcAddress?session.btcAddress:($('btcAddress')?$('btcAddress').value.trim():'');
if(!btcAddress){
alert('Por favor, introduce tu dirección BTC antes de guardar la sesión.');
return;
}
saveSession({
googleId:data.sub,
name:data.name,
email:data.email,
btcAddress:btcAddress,
savedAt:Date.now(),
pending:false
});
log('SESSION SAVED as '+data.name);
alert('✓ Sesión guardada como '+data.name+'\n\nLa próxima vez se restaurará automáticamente.');
hideOverlay();
}catch(e){
console.error('[Session] handleGoogleCredential error:',e);
alert('Error al procesar la sesión: '+e.message);
}
}

function askSaveSession(){
var btcAddress=$('btcAddress')?$('btcAddress').value.trim():'';
console.log('[Session] askSaveSession called, btcAddress:',btcAddress);
if(!btcAddress){
console.log('[Session] No BTC address, skipping');
return;
}
  setSessionContent(
    '¿Guardar sesión?',
    '¿Quieres guardar tu sesión para la próxima vez?',
    [{text:'Sí',cls:'btn-primary',closeOverlay:false,action:function(){
      console.log('[Session] User clicked Sí, showing Google login');
      setSessionContent('Inicia sesión con Google','Tu dirección BTC se guardará con tu cuenta de Google',[],true);
    }},{text:'No',cls:'btn-secondary',action:function(){
      console.log('[Session] User clicked No');
    }}],
    false
  );
}

function restoreSavedSession(session){
console.log('[Session] Restoring session for:',session.name);
if($('btcAddress'))$('btcAddress').value=session.btcAddress;
log('SESSION RESTORED: '+session.name+' ('+session.email+')');
updateMinerStatusUI('RESTORED');
connectWS();
}

function checkSavedSession(){
console.log('[Session] Checking saved session...');
var session=getSession();
if(!session){
console.log('[Session] No saved session found');
return;
}
console.log('[Session] Found session:',session);
if(session.pending){
console.log('[Session] Session is pending, asking to save');
setSessionContent('¿Guardar sesión?','Tu dirección BTC: '+session.btcAddress.substring(0,10)+'...'+session.btcAddress.substring(session.btcAddress.length-4),[{text:'Sí',cls:'btn-primary',closeOverlay:false,action:function(){setSessionContent('Inicia sesión con Google','Tu dirección BTC se guardará con tu cuenta de Google',[],true)}},{text:'No',cls:'btn-secondary',action:function(){clearSession()}}],false);
}else if(session.name&&session.email){
console.log('[Session] Complete session found, asking to restore');
setSessionContent('¿Continuar como '+session.name+'?','Tu dirección BTC: '+session.btcAddress.substring(0,10)+'...'+session.btcAddress.substring(session.btcAddress.length-4),[{text:'Sí',cls:'btn-primary',action:function(){restoreSavedSession(session)}},{text:'No',cls:'btn-secondary',action:function(){clearSession()}}],false);
}else{
console.log('[Session] Incomplete session, ignoring');
}
}

var REFERRAL_KEY='mining_btc_referral';
var REFERRAL_BASE=window.location.origin+window.location.pathname;

function getReferralData(){try{return JSON.parse(localStorage.getItem(REFERRAL_KEY))||{}}catch(e){return{}}}
function saveReferralData(d){try{localStorage.setItem(REFERRAL_KEY,JSON.stringify(d))}catch(e){}}

function generateReferralId(){
var btcAddress=$('btcAddress')?$('btcAddress').value.trim():'';
var seed=btcAddress.length>=10?btcAddress:(navigator.userAgent+(window.screen?window.screen.width+'x'+window.screen.height:'')+(localStorage.getItem('ref_seed')||(function(){var s=Math.random().toString(36).slice(2,10);localStorage.setItem('ref_seed',s);return s})()));
var hash=0;
for(var i=0;i<seed.length;i++){hash=((hash<<5)-hash)+seed.charCodeAt(i);hash|=0}
return Math.abs(hash).toString(36)+Date.now().toString(36).slice(-4)}

function initReferralSystem(){
console.log('[Referral] Initializing referral system...');
var rid=generateReferralId();
var refLink=REFERRAL_BASE+'?ref='+rid;
console.log('[Referral] Generated link:',refLink);
if($('referralLink')){$('referralLink').value=refLink;console.log('[Referral] Link set in input')}
else{console.warn('[Referral] referralLink element not found')}
var urlParams=new URLSearchParams(window.location.search);
var incomingRef=urlParams.get('ref');
if(incomingRef){
var data=getReferralData();
if(!data.referredBy){
data.referredBy=incomingRef;
data.referredAt=Date.now();
saveReferralData(data);
log('REFERRAL TRACKED: '+incomingRef)}}
var data=getReferralData();
if($('referralCount'))$('referralCount').textContent=String(data.referrals||0);
if($('referralActive'))$('referralActive').textContent=String(data.activeReferrals||0)}

if($('copyReferral'))$('copyReferral').onclick=function(){
var input=$('referralLink');
if(!input)return;
input.select();
try{
navigator.clipboard.writeText(input.value);
$('copyReferral').textContent='Copiado!';
$('copyReferral').classList.add('copied');
setTimeout(function(){$('copyReferral').textContent='Copiar';$('copyReferral').classList.remove('copied')},2000)
}catch(e){document.execCommand('copy')}}

function initDonateSystem(){
var DONATE_ADDRESS='bc1qd2fu79gkkn8juju67t066jhwpw6r4t3plxsamn';
if($('donateAddress'))$('donateAddress').value=DONATE_ADDRESS;
generateQR(DONATE_ADDRESS);
if($('copyDonate'))$('copyDonate').onclick=function(){
var input=$('donateAddress');
if(!input)return;
input.select();
try{
navigator.clipboard.writeText(input.value);
$('copyDonate').textContent='Copiado!';
$('copyDonate').classList.add('copied');
setTimeout(function(){$('copyDonate').textContent='Copiar';$('copyDonate').classList.remove('copied')},2000)
}catch(e){document.execCommand('copy')}}}

function generateQR(text){
var canvas=$('donateQr');
if(!canvas)return;
var ctx=canvas.getContext('2d');
var size=120;
var modules=25;
var cellSize=size/modules;
ctx.fillStyle='#ffffff';
ctx.fillRect(0,0,size,size);
ctx.fillStyle='#000000';
var data=text.split('');
var seed=0;
for(var i=0;i<text.length;i++){seed=((seed<<5)-seed)+text.charCodeAt(i);seed|=0}
for(var row=0;row<modules;row++){
for(var col=0;col<modules;col++){
var isFinderPattern=(row<7&&col<7)||(row<7&&col>=modules-7)||(row>=modules-7&&col<7);
if(isFinderPattern){
var isOuter=row===0||row===6||col===0||col===6||row===modules-1||row===modules-7||col===modules-1||col===modules-7;
var isInner=row>=2&&row<=4&&col>=2&&col<=4||row>=2&&row<=4&&col>=modules-5&&col<=modules-3||row>=modules-5&&row<=modules-3&&col>=2&&col<=4;
if(isOuter||isInner){ctx.fillRect(col*cellSize,row*cellSize,cellSize,cellSize)}
}else{
seed=(seed*1103515245+12345)&0x7fffffff;
if(seed%3!==0){ctx.fillRect(col*cellSize,row*cellSize,cellSize,cellSize)}}}}}

function initAdBanner(){
var banner=$('adBanner');
if(!banner)return;
banner.innerHTML='<div class="ad-placeholder"><span class="ad-label">Publicidad</span><span class="ad-text">Espacio publicitario disponible</span></div>'}

if($('btcAddress')){
$('btcAddress').addEventListener('input',function(){
var btcAddress=$('btcAddress').value.trim();
var existingSession=getSession();
if(btcAddress.length>20&&(!existingSession||existingSession.pending)){
saveSession({pending:true,btcAddress:btcAddress,savedAt:Date.now()});
console.log('[Session] BTC address auto-saved:',btcAddress.substring(0,10)+'...');
}
initReferralSystem()});
}

console.log('[Session] Initializing Google...');
if(typeof google!=='undefined'&&google.accounts){
initGoogle();
}else{
window.addEventListener('load',function(){
console.log('[Session] Window loaded, initializing Google...');
initGoogle();
});
}

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
initReferralSystem();
initDonateSystem();
initAdBanner();
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