var $=function(id){return document.getElementById(id)};
var logLines=[];
var activityLog=[];
var ws=null,minerId=null,workers=[],running=false;
var jobId=null,jobHeight=0,currentJob=null;
var myShares=0,rejectedCount=0;
var exhausted=0,total=0,lastRate=performance.now(),hashes=0;
var refreshTimer=null,statusTimer=null,wsHeartbeatTimer=null;
var wsRetries=0,wsMaxRetries=0,wsReconnectTimer=null,wsBaseDelay=3000,wsMaxDelay=60000;
var sessionToken=null,googleToken=null,walletPollTimer=null,walletModalOpen=false;
var powerLevel=2;
var consentGiven=false;
var backendConnected=false;

function getBackendHttp(){
var u=window.BACKEND_URL||'';
if(u.indexOf('wss://')===0)return 'https://'+u.slice(6);
if(u.indexOf('ws://')===0)return 'http://'+u.slice(5);
return u||''}

function fmtRate(h){if(h>=1e6)return(h/1e6).toFixed(2)+' MH/s';if(h>=1e3)return(h/1e3).toFixed(2)+' KH/s';return Math.round(h)+' H/s'}
function fmtBtc(sat){return(sat/1e8).toFixed(8)+' BTC'}
function truncate(s,n){if(!s)return'';if(s.length<=n)return s;return s.slice(0,n-3)+'...'+s.slice(-4)}
function now(){return new Date().toLocaleTimeString()}
function timeAgo(ts){var d=Date.now()-ts;if(d<60000)return'hace menos de 1 min';if(d<3600000)return'hace '+Math.floor(d/60000)+' min';if(d<86400000)return'hace '+Math.floor(d/3600000)+' h';return new Date(ts).toLocaleDateString()}

function log(msg){
var line='> ['+now()+'] '+msg;
logLines.push(line);
if(logLines.length>200)logLines.shift();
var el=$('log');
if(el)el.textContent=logLines.join('\n');
try{var el2=$('log');el2.scrollTop=el2.scrollHeight}catch(e){}}

function addActivity(type,msg,detail){
activityLog.unshift({type:type,msg:msg,detail:detail||'',ts:Date.now()});
if(activityLog.length>50)activityLog.pop();
renderActivity()}

function renderActivity(){
var el=$('activityList');
if(!el)return;
if(activityLog.length===0){el.innerHTML='<div class="activity-empty">La actividad de mineria aparecera aqui cuando inicies.</div>';return}
var html='';
for(var i=0;i<activityLog.length;i++){
var a=activityLog[i];
var cls='activity-item activity-'+a.type;
html+='<div class="'+cls+'">';
html+='<span class="activity-time">'+timeAgo(a.ts)+'</span>';
html+='<span class="activity-msg">'+a.msg+'</span>';
if(a.detail)html+='<span class="activity-detail">'+a.detail+'</span>';
html+='</div>'}
el.innerHTML=html}

setInterval(function(){if(activityLog.length>0)renderActivity()},60000);

function clock(){if($('clock'))$('clock').textContent=now()}
setInterval(clock,1000);clock();

function updateNodePanel(status){
var url=window.BACKEND_URL||'';
var host=url.replace(/wss?:\/\//,'').replace(/\/.*$/,'');
if($('statusText'))$('statusText').textContent=status==='CONNECTED'?'CONECTADO':'DESCONECTADO';
if(status==='CONNECTED'){
wsRetries=0;
if($('reconnectBtn'))$('reconnectBtn').style.display='none'}
else{
if($('reconnectBtn')&&backendConnected)$('reconnectBtn').style.display='inline-block'}}

function updateMinerStatusUI(text){
var el=$('minerStatus');if(!el)return;
el.textContent=text;
el.classList.remove('s-mining','s-ok','s-err','s-warn');
if(text==='MINANDO'||text==='CANDIDATO DE BLOQUE'||text==='CONECTANDO...')el.classList.add('s-mining');
else if(text==='BLOQUE ENCONTRADO!'||text==='BLOQUE ACEPTADO!')el.classList.add('s-ok');
else if(text==='DETENIDO'||text==='INACTIVO')el.classList.add('s-warn');
else if(text.indexOf('ERROR')>=0||text.indexOf('DESCONECTADO')>=0)el.classList.add('s-err');
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
log('BACKEND_URL NO CONFIGURADO');
return false}
try{
var d=await getJSON(base+'/api/health');
if($('led'))$('led').classList.add('on');
if($('statusText'))$('statusText').textContent='CONECTADO';
updateNodePanel('CONNECTED');
backendConnected=true;
log('BACKEND CONECTADO // v'+(d.version||'?'));
return true}catch(e){
if($('led'))$('led').classList.remove('on');
if($('statusText'))$('statusText').textContent='DESCONECTADO';
updateNodePanel('DISCONNECTED');
backendConnected=false;
log('BACKEND NO DISPONIBLE // '+e.message);
return false}}

async function fetchBlockchainData(){
var base=getBackendHttp();
if(!base)return null;
try{
var s=await getJSON(base+'/api/status');
if($('led'))$('led').classList.add('on');
if($('statusText'))$('statusText').textContent='CONECTADO';
if($('network'))$('network').textContent=(s.chain||'mainnet').toUpperCase();
if($('networkLabel'))$('networkLabel').textContent=(s.chain||'mainnet').toUpperCase();
if($('blocks'))$('blocks').textContent=(s.blocks||0).toLocaleString();
if($('difficulty'))$('difficulty').textContent=Number(s.difficulty||0).toLocaleString(undefined,{maximumFractionDigits:2});
if($('hashrate'))$('hashrate').textContent=Number(s.networkhashps||0).toLocaleString(undefined,{maximumFractionDigits:0})+' H/s';
if(s.verificationprogress&&s.verificationprogress<0.9999){
log('NODO OK // '+s.chain.toUpperCase()+' // ALTURA '+s.blocks)}
return s}catch(e){
log('ERROR NODO: '+e.message);
return null}}

async function fetchTemplateData(){
var base=getBackendHttp();
if(!base)return null;
try{
var t=await getJSON(base+'/api/template');
if($('templateHeight'))$('templateHeight').textContent=t.height;
if($('coinbase'))$('coinbase').textContent=(Number(t.coinbasevalue)/1e8).toFixed(8)+' BTC';
return t}catch(e){
log('ERROR PLANTILLA: '+e.message);
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
coinbasevalue:j.coinbasevalue||null};
if($('templateHeight'))$('templateHeight').textContent=j.height}

function stopWorkers(){
workers.forEach(function(w){try{w.postMessage({type:'stop'})}catch(e){};w.terminate()});
workers=[];
if($('workerCount'))$('workerCount').textContent='0'}

function startWorkers(){
if(!currentJob||!currentJob.header)return;
stopWorkers();
var maxCores=navigator.hardwareConcurrency||2;
var divisor=Math.max(1,Math.min(powerLevel,maxCores));
var n=Math.max(1,Math.ceil(maxCores/divisor));
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
updateMinerStatusUI('CANDIDATO DE BLOQUE');
addActivity('block','Candidato de bloque encontrado','Nonce: '+m.nonce);
log('CANDIDATO DE BLOQUE: nonce '+m.nonce);
if(ws&&ws.readyState===1){try{ws.send(JSON.stringify({type:'share',minerId:minerId,jobId:m.jobId,nonce:m.nonce,hashHex:m.hash}))}catch(e){}}
}}})(i);
w.postMessage({type:'start',job:currentJob,from:fromN,span:sp})}
log('MINANDO // '+n+' WORKERS // ALTURA '+jobHeight);
addActivity('mining','Mineria iniciada',n+' workers, intensidad '+(powerLevel===1?'baja':powerLevel===2?'media':'alta'))}

function scheduleWsReconnect(){
if(wsReconnectTimer)return;
wsRetries++;
var delay=Math.min(wsBaseDelay*Math.pow(2,wsRetries-1),wsMaxDelay);
delay+=Math.random()*1000;
log('RECONECTANDO (intento '+wsRetries+') en '+(delay/1000).toFixed(1)+'s...');
wsReconnectTimer=setTimeout(function(){
wsReconnectTimer=null;
connectWS()},delay)}

window.addEventListener('visibilitychange',function(){
if(!document.hidden&&(!ws||ws.readyState!==1)){
log('PAGINA VISIBLE - RECONECTANDO...');
wsRetries=0;
if(wsReconnectTimer){clearTimeout(wsReconnectTimer);wsReconnectTimer=null}
connectWS()}});

window.addEventListener('online',function(){
log('RED DISPONIBLE - RECONECTANDO...');
wsRetries=0;
if(wsReconnectTimer){clearTimeout(wsReconnectTimer);wsReconnectTimer=null}
connectWS()});

window.addEventListener('offline',function(){
log('RED NO DISPONIBLE');
addActivity('connection','Conexion perdida','Red no disponible');
if(wsReconnectTimer){clearTimeout(wsReconnectTimer);wsReconnectTimer=null}});

function connectWS(){
var wsUrl=window.BACKEND_URL||'';
if(!wsUrl){log('BACKEND_URL NO CONFIGURADO');return}
if(ws&&ws.readyState<=1){return}
if(wsHeartbeatTimer){clearInterval(wsHeartbeatTimer);wsHeartbeatTimer=null}
try{ws=new WebSocket(wsUrl+'/ws')}catch(e){log('WS FALLIDO: '+e.message);scheduleWsReconnect();return}
ws.onopen=function(){
log('WEBSOCKET CONECTADO');
updateNodePanel('CONNECTED');
addActivity('connection','Conectado al servidor');
wsRetries=0;
if($('reconnectBtn'))$('reconnectBtn').style.display='none';
wsHeartbeatTimer=setInterval(function(){
if(ws&&ws.readyState===1){try{ws.send(JSON.stringify({type:'ping'}))}catch(e){}}
},30000);
var btcAddress=$('btcAddress')?$('btcAddress').value.trim():'';
if(!btcAddress){log('DIRECCION BTC REQUERIDA PARA MINAR');return}
try{ws.send(JSON.stringify({type:'register',btcAddress:btcAddress,googleToken:googleToken}));log('REGISTRANDO...'+(googleToken?' (verificado)':''))}catch(e){log('ERROR REGISTRO: '+e.message)}};
ws.onmessage=function(e){
var msg=JSON.parse(e.data);
if(msg.type==='welcome'){minerId=msg.minerId;log('ID MINERO: '+minerId)}
else if(msg.type==='registered'){log('REGISTRADO // '+msg.btcAddress+(msg.verified?' // VERIFICADO':''));addActivity('account','Direccion registrada',msg.btcAddress.substring(0,12)+'...')}
else if(msg.type==='newJob'){
storeJob(msg);
if(running){stopWorkers();startWorkers()}
addActivity('job','Nuevo trabajo recibido','Bloque '+msg.height)}
else if(msg.type==='shareAccepted'){myShares++;if($('myShares'))$('myShares').textContent=myShares.toString()}
else if(msg.type==='shareRejected'){rejectedCount++;if($('rejectedShares'))$('rejectedShares').textContent=rejectedCount.toString();addActivity('share','Share rechazada',msg.reason||'')}
else if(msg.type==='poolStats'){updatePoolUI(msg)}
else if(msg.type==='blockFound'){log('BLOQUE ENCONTRADO POR '+msg.minerId+' EN ALTURA '+msg.height);updateMinerStatusUI('BLOQUE ENCONTRADO!');addActivity('block','Bloque encontrado en altura '+msg.height)}
else if(msg.type==='blockAccepted'){log('BLOQUE ACEPTADO EN ALTURA '+msg.height);updateMinerStatusUI('BLOQUE ACEPTADO!');addActivity('block','Bloque aceptado por Bitcoin Core','Altura '+msg.height)}
else if(msg.type==='blockRejected'){log('BLOQUE RECHAZADO: '+msg.reason);addActivity('error','Bloque rechazado',msg.reason)}
else if(msg.type==='sessionToken'){sessionToken=msg.token;log('SESION AUTENTICADA');if(walletModalOpen)fetchWalletBalance();startWalletPolling()}
else if(msg.type==='balanceUpdate'){if(walletModalOpen)updateWalletUI(msg);addActivity('balance','Saldo actualizado')}
else if(msg.type==='rewardDistributed'){showToast('+'+fmtBtc(msg.reward_sat)+' acreditado (bloque '+msg.block_height+')','reward');if(walletModalOpen)updateWalletUI(msg);addActivity('reward','Recompensa distribuida',fmtBtc(msg.reward_sat)+' en bloque '+msg.block_height)}
else if(msg.type==='error'){log('ERROR: '+msg.error)}
else if(msg.type==='pong'){}
};
ws.onclose=function(){
if(wsHeartbeatTimer){clearInterval(wsHeartbeatTimer);wsHeartbeatTimer=null}
sessionToken=null;
log('WS DESCONECTADO');
ws=null;
updateNodePanel('DISCONNECTED');
addActivity('connection','Desconectado del servidor');
if($('reconnectBtn'))$('reconnectBtn').style.display='inline-block';
scheduleWsReconnect()};
ws.onerror=function(){}}

function updatePoolUI(stats){
if($('myShares'))$('myShares').textContent=myShares.toString();
if($('validBlocks'))$('validBlocks').textContent=stats?(stats.validBlocks||0).toString():'0';
if($('minersOnline'))$('minersOnline').textContent=stats?(stats.minersOnline||0).toString():'0';
if($('poolHashrate'))$('poolHashrate').textContent=stats?fmtRate(stats.totalHashrate||0):'0 H/s'}

async function startMining(){
if(running)return;
if(!consentGiven){showConsent();return}
var btcAddress=$('btcAddress')?$('btcAddress').value.trim():'';
if(!btcAddress){
log('INTRODUCE TU DIRECCION BTC ANTES DE MINAR');
updateMinerStatusUI('DIRECCION REQUERIDA');
if($('btcAddress'))$('btcAddress').focus();
return}
running=true;
updateMinerStatusUI('CONECTANDO...');
addActivity('mining','Iniciando mineria...');
var base=getBackendHttp();
if(base){
try{
var d=await getJSON(base+'/api/job');
if(d&&!d.error){storeJob(d);log('TRABAJO OBTENIDO DEL BACKEND')}
}catch(e){log('ERROR AL OBTENER TRABAJO: '+e.message)}}
if(!ws||ws.readyState!==1){connectWS()}
await new Promise(function(r){setTimeout(r,2000)});
if(!currentJob){
log('ESPERANDO TRABAJO DEL SERVIDOR...');
updateMinerStatusUI('ESPERANDO TRABAJO');
var waitCount=0;
var waitInterval=setInterval(function(){waitCount++;if(currentJob||waitCount>15){clearInterval(waitInterval);if(currentJob){updateMinerStatusUI('MINANDO');startWorkers()}else{updateMinerStatusUI('TRABAJO NO DISPONIBLE');running=false}}},2000);
return}
updateMinerStatusUI('MINANDO');
startWorkers()}

function stopMining(){
running=false;
stopWorkers();
updateMinerStatusUI('DETENIDO');
setMiningRate(0);
stopWalletPolling();
addActivity('mining','Mineria detenida');
log('MINERIA DETENIDA')}

if($('start'))$('start').onclick=startMining;
if($('stop'))$('stop').onclick=function(){stopMining()};

function showConsent(){
var m=$('consentModal');
if(m)m.style.display='flex'}
function hideConsent(){
var m=$('consentModal');
if(m)m.style.display='none'}

if($('consentAccept'))$('consentAccept').onclick=function(){
consentGiven=true;
hideConsent();
var btcAddress=$('btcAddress')?$('btcAddress').value.trim():'';
if(!btcAddress){
log('INTRODUCE TU DIRECCION BTC ANTES DE MINAR');
if($('btcAddress'))$('btcAddress').focus();
return}
startMining()};
if($('consentCancel'))$('consentCancel').onclick=hideConsent;
if(document.querySelector('.consent-backdrop'))document.querySelector('.consent-backdrop').onclick=hideConsent;

document.querySelectorAll('.power-btn').forEach(function(btn){
btn.onclick=function(){
document.querySelectorAll('.power-btn').forEach(function(b){b.classList.remove('active')});
btn.classList.add('active');
powerLevel=parseInt(btn.dataset.power);
var labels={1:'Baja - usa pocos nucleos, menor consumo',2:'Media - usa la mitad de los nucleos',4:'Alta - usa todos los nucleos'};
if($('powerHint'))$('powerHint').textContent=labels[powerLevel]||'';
if(running&&currentJob){stopWorkers();startWorkers();addActivity('settings','Intensidad cambiada',labels[powerLevel])}
}});

if($('reconnectBtn'))$('reconnectBtn').onclick=function(){
wsRetries=0;
if(wsReconnectTimer){clearTimeout(wsReconnectTimer);wsReconnectTimer=null}
if(ws){try{ws.close()}catch(e){}}
log('RECONECTANDO MANUALMENTE...');
addActivity('connection','Reconexion manual');
connectWS()};

var GOOGLE_CLIENT_ID='46928798077-vtsu6fln277j6s601n2b4feg1hrsfi72.apps.googleusercontent.com';
var SESSION_KEY='mining_btc_session';
var googleReady=false;
var googleTokenClient=null;

function initGoogle(){
if(typeof google!=='undefined'&&google.accounts){
try{
google.accounts.id.initialize({
client_id:GOOGLE_CLIENT_ID,
callback:handleGoogleCredential
});
googleReady=true;
}catch(e){googleReady=false}
}else{
setTimeout(initGoogle,300)
}
}

function getSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY))}catch(e){return null}}
function saveSession(data){try{localStorage.setItem(SESSION_KEY,JSON.stringify(data))}catch(e){}}
function clearSession(){try{localStorage.removeItem(SESSION_KEY)}catch(e){}}

function showOverlay(){
var el=$('sessionOverlay');
if(el)el.style.display='flex'}
function hideOverlay(){
var el=$('sessionOverlay');
if(el)el.style.display='none'}

function setSessionContent(title,subtitle,buttons,showGoogleBtn){
if($('sessionTitle'))$('sessionTitle').textContent=title;
if($('sessionSubtitle'))$('sessionSubtitle').textContent=subtitle;
if($('sessionButtons')){
$('sessionButtons').innerHTML='';
buttons.forEach(function(b){
var btn=document.createElement('button');
btn.className='btn '+(b.cls||'btn-secondary');
btn.textContent=b.text;
btn.onclick=function(){
b.action();
if(b.closeOverlay!==false)hideOverlay();
};
$('sessionButtons').appendChild(btn);
});
}
if(showGoogleBtn){
var btnArea=document.createElement('div');
btnArea.style.cssText='margin-top:16px;width:100%;display:flex;flex-direction:column;align-items:center;gap:8px;';
var btn=document.createElement('button');
btn.className='btn btn-primary';
btn.style.cssText='width:100%;max-width:300px;padding:14px 24px;font-size:15px;font-weight:600;cursor:pointer;border:none;';
btn.textContent='Iniciar sesion con Google';
btn.onclick=function(){
if(!googleReady){alert('Google no esta listo, espera un momento.');return;}
try{
google.accounts.id.prompt(function(n){
if(n.isNotDisplayed()){
google.accounts.id.cancel();
setTimeout(function(){
google.accounts.id.prompt(function(n2){
if(n2.isNotDisplayed()){
alert('No se pudo abrir Google. Asegurate de que las ventanas emergentes estan permitidas.');
}
});
},500);
}
});
}catch(e){alert('Error al iniciar Google: '+e.message)}
};
btnArea.appendChild(btn);
$('sessionButtons').appendChild(btnArea);
}
showOverlay();
}

function handleGoogleCredential(response){
try{
googleToken=response.credential;
var parts=response.credential.split('.');
if(parts.length!==3)return;
var payload=parts[1];
var base64=payload.replace(/-/g,'+').replace(/_/g,'/');
while(base64.length%4){base64+='=';}
var data=JSON.parse(atob(base64));
var session=getSession();
var btcAddress=session&&session.btcAddress?session.btcAddress:($('btcAddress')?$('btcAddress').value.trim():'');
if(!btcAddress){alert('Introduce tu direccion BTC antes de guardar la sesion.');return}
saveSession({
googleId:data.sub,
name:data.name,
email:data.email,
btcAddress:btcAddress,
savedAt:Date.now(),
pending:false
});
log('SESION GUARDADA como '+data.name);
hideOverlay();
}catch(e){alert('Error al procesar la sesion: '+e.message)}
}

function askSaveSession(){
var btcAddress=$('btcAddress')?$('btcAddress').value.trim():'';
if(!btcAddress)return;
setSessionContent(
'Guardar sesion?',
'Quieres guardar tu sesion para la proxima vez?',
[{text:'Si',cls:'btn-primary',closeOverlay:false,action:function(){
setSessionContent('Inicia sesion con Google','Tu direccion BTC se guardara con tu cuenta de Google',[],true);
}},{text:'No',cls:'btn-secondary',action:function(){}}],
false
);
}

function restoreSavedSession(session){
if($('btcAddress'))$('btcAddress').value=session.btcAddress;
log('SESION RESTAURADA: '+session.name);
connectWS();
}

function checkSavedSession(){
var session=getSession();
if(!session)return;
if(session.pending){
setSessionContent('Guardar sesion?','Tu direccion BTC: '+session.btcAddress.substring(0,10)+'...'+session.btcAddress.substring(session.btcAddress.length-4),[{text:'Si',cls:'btn-primary',closeOverlay:false,action:function(){setSessionContent('Inicia sesion con Google','Tu direccion BTC se guardara con tu cuenta de Google',[],true)}},{text:'No',cls:'btn-secondary',action:function(){clearSession()}}],false);
}else if(session.name&&session.email){
setSessionContent('Continuar como '+session.name+'?','Tu direccion BTC: '+session.btcAddress.substring(0,10)+'...'+session.btcAddress.substring(session.btcAddress.length-4),[{text:'Si',cls:'btn-primary',action:function(){restoreSavedSession(session)}},{text:'No',cls:'btn-secondary',action:function(){clearSession()}}],false);
}
}

if($('btcAddress')){
$('btcAddress').addEventListener('input',function(){
var btcAddress=$('btcAddress').value.trim();
var existingSession=getSession();
if(btcAddress.length>20&&(!existingSession||existingSession.pending)){
saveSession({pending:true,btcAddress:btcAddress,savedAt:Date.now()})}
});
}

if(typeof google!=='undefined'&&google.accounts){initGoogle()}
else{window.addEventListener('load',function(){initGoogle()})}

(function initUI(){})();

(async function init(){
log('SISTEMA INICIANDO');
checkSavedSession();
var url=window.BACKEND_URL||'';
if(url.indexOf('YOUR-RENDER')>=0||url.indexOf('REPLACE')>=0){
log('BACKEND NO CONFIGURADO - EDITA frontend/config.js');
updateNodePanel('DISCONNECTED');
updateMinerStatusUI('NO CONFIGURADO');
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

async function fetchWalletBalance(){
if(!sessionToken)return;
var base=getBackendHttp();
if(!base)return;
try{
var r=await fetch(base+'/api/my-balance',{
method:'GET',
mode:'cors',
signal:AbortSignal.timeout(30000),
headers:{'Authorization':'Bearer '+sessionToken}
});
var d={};try{d=await r.json()}catch(e){}
if(!r.ok||d.ok===false){
if(r.status===401){showWalletNotVerified();return}
return}
updateWalletUI(d);
}catch(e){}}

function showWalletNotVerified(){
if($('walletPending'))$('walletPending').textContent='---';
if($('walletConfirmed'))$('walletConfirmed').textContent='---';
if($('walletTotal'))$('walletTotal').textContent='---';
if($('walletShares'))$('walletShares').textContent='---';
if($('walletBlocks'))$('walletBlocks').textContent='---';
if($('walletWindowShares'))$('walletWindowShares').textContent='---';
var notice=$('walletNotVerified');
if(notice){notice.style.display='block';notice.textContent='Cuenta no verificada. Inicia sesion con Google para ver tu saldo.'}}

function updateWalletUI(d){
if($('walletPending'))$('walletPending').textContent=fmtBtc(d.pending_sat||0);
if($('walletConfirmed'))$('walletConfirmed').textContent=fmtBtc(d.confirmed_sat||0);
if($('walletTotal'))$('walletTotal').textContent=fmtBtc(d.total_earned_sat||0);
if($('walletShares'))$('walletShares').textContent=String(d.shares_accepted||0);
if($('walletBlocks'))$('walletBlocks').textContent=String(d.blocks_found||0);
if($('walletWindowShares'))$('walletWindowShares').textContent=String(d.shares_in_window||0);
if($('walletMinPayout'))$('walletMinPayout').textContent=(d.min_payout_sat||0).toLocaleString()+' sat';
if($('walletPoolFee'))$('walletPoolFee').textContent=(d.pool_fee_percent||0)+'%';
if($('walletDryRun'))$('walletDryRun').style.display=d.payout_dry_run?'block':'none';
var notice=$('walletNotVerified');
if(notice)notice.style.display='none';
if($('walletEstimated')){
if(d.estimated_has_data){
$('walletEstimated').textContent=fmtBtc(d.estimated_sat||0);
$('walletEstimated').classList.remove('wallet-value-na');
}else{
$('walletEstimated').textContent='N/D';
$('walletEstimated').classList.add('wallet-value-na');
}}
if($('walletEstimatedReference')){
if(d.estimated_has_data&&d.estimated_reference_height){
$('walletEstimatedReference').textContent='Ref: Bloque #'+d.estimated_reference_height;
$('walletEstimatedReference').style.display='block';
}else{
$('walletEstimatedReference').style.display='none';
}}}

function openWalletModal(){
var m=$('walletModal');
if(m)m.style.display='flex';
walletModalOpen=true;
fetchWalletBalance();
startWalletPolling()}

function closeWalletModal(){
var m=$('walletModal');
if(m)m.style.display='none';
walletModalOpen=false;
stopWalletPolling()}

function startWalletPolling(){
stopWalletPolling();
walletPollTimer=setInterval(function(){
if(walletModalOpen&&sessionToken)fetchWalletBalance()
},10000)}

function stopWalletPolling(){
if(walletPollTimer){clearInterval(walletPollTimer);walletPollTimer=null}}

function showToast(msg,type){
var container=$('toastContainer');
if(!container)return;
var toast=document.createElement('div');
toast.className='toast toast-'+(type||'info');
toast.innerHTML='<span class="toast-msg">'+msg+'</span>';
container.appendChild(toast);
setTimeout(function(){
toast.classList.add('toast-out');
setTimeout(function(){if(toast.parentNode)toast.parentNode.removeChild(toast)},300)
},4000)}

if($('viewWallet'))$('viewWallet').onclick=openWalletModal;
if($('closeWallet'))$('closeWallet').onclick=closeWalletModal;
var backdrop=document.querySelector('.wallet-modal-backdrop');
if(backdrop)backdrop.onclick=closeWalletModal;

if($('downloadApp'))$('downloadApp').onclick=function(){
var isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)&&!window.MSStream;
if(isIOS&&!navigator.standalone){log('iOS: Pulsa Compartir > Anadir a pantalla de inicio');return}
log('APP NO DISPONIBLE PARA INSTALAR');
};
