const net=require('net'),crypto=require('crypto');
const{validateAddress}=require('./address-validator');
class StratumServer{
constructor(config,jobManager,minerTracker,accountManager){
this.config=config;
this.jobManager=jobManager;
this.minerTracker=minerTracker;
this.accountManager=accountManager;
this.server=null;
this.miners=new Map();
this.extranonceCounter=0;
this.extranonce1Size=config.STRATUM_EXTRANONCE1_SIZE||4;
this.extranonce2Size=config.STRATUM_EXTRANONCE2_SIZE||4;
this.broadcastInterval=null}
start(){
this.server=net.createServer((socket)=>this.handleConnection(socket));
this.server.listen(this.config.STRATUM_PORT,'0.0.0.0',()=>{
console.log(`[Stratum] Listening on 0.0.0.0:${this.config.STRATUM_PORT}`)});
this.server.on('error',(e)=>{console.error('[Stratum] Server error:',e.message)});
this.broadcastInterval=setInterval(()=>this.broadcastNewJob(),this.config.STRATUM_BROADCAST_MS||5000)}
stop(){
if(this.broadcastInterval)clearInterval(this.broadcastInterval);
if(this.server){this.server.close();console.log('[Stratum] Server stopped')}}
handleConnection(socket){
const minerId='stratum_'+Date.now()+'_'+crypto.randomBytes(4).toString('hex');
const extranonce1=this.assignExtranonce();
const miner={
minerId,socket,extranonce1,
extranonce1Size:this.extranonce1Size,
extranonce2Size:this.extranonce2Size,
subscribed:false,authorized:false,
btcAddress:null,workerName:null,
difficulty:this.config.STRATUM_MIN_DIFFICULTY||1000,
buffer:'',lastSeen:Date.now(),
hashesReported:0,shares:0,
accountId:null};
this.miners.set(socket,miner);
socket.setKeepAlive(true,60000);
socket.on('data',(data)=>this.handleData(socket,miner,data));
socket.on('close',()=>this.handleDisconnect(socket,miner));
socket.on('error',(err)=>{console.error(`[Stratum] Error for ${minerId}:`,err.message)})}
assignExtranonce(){
this.extranonceCounter++;
return this.extranonceCounter.toString(16).padStart(this.extranonce1Size*2,'0')}
handleData(socket,miner,data){
miner.buffer+=data.toString();
miner.lastSeen=Date.now();
const lines=miner.buffer.split('\n');
miner.buffer=lines.pop();
for(const line of lines){
const trimmed=line.trim();
if(!trimmed)continue;
try{
const msg=JSON.parse(trimmed);
this.handleMessage(socket,miner,msg)}
catch(e){}}
if(Date.now()-miner.lastSeen>300000){
try{socket.destroy()}catch(e){}}}
handleMessage(socket,miner,msg){
const{id,method,params}=msg;
if(!method){
if(id!==null&&id!==undefined)this.send(socket,{id,result:null,error:[20,'Missing method',null]});
return}
switch(method){
case'mining.subscribe':this.handleSubscribe(socket,miner,id,params);break;
case'mining.authorize':this.handleAuthorize(socket,miner,id,params);break;
case'mining.submit':this.handleSubmit(socket,miner,id,params);break;
case'mining.extranonce.subscribe':
this.send(socket,{id,result:false,error:null});break;
default:
if(id!==null&&id!==undefined)this.send(socket,{id,result:null,error:[20,'Unknown method: '+method,null]})}}
handleSubscribe(socket,miner,id,params){
miner.subscribed=true;
this.send(socket,{id,
result:[
[['mining.set_difficulty','1'],['mining.notify','2']],
miner.extranonce1,
miner.extranonce2Size],
error:null});
this.send(socket,{id:null,method:'mining.set_difficulty',params:[miner.difficulty]});
this.sendJob(socket,miner);
console.log(`[Stratum] Subscribed: ${miner.minerId} (extranonce1=${miner.extranonce1})`)}
handleAuthorize(socket,miner,id,params){
const workerParam=params&&params[0]?params[0]:'';
const password=params&&params[1]?params[1]:'x';
const parts=workerParam.split('.');
const btcAddress=parts[0].trim();
const workerName=parts.length>1?parts[1]:'default';
if(!btcAddress){
this.send(socket,{id,result:false,error:[20,'No address provided',null]});return}
const validation=validateAddress(btcAddress);
if(!validation.valid){
this.send(socket,{id,result:false,error:[20,'Invalid Bitcoin address: '+validation.error,null]});return}
if(this.miners.size>=this.config.MAX_MINERS){
this.send(socket,{id,result:false,error:[20,'Pool full',null]});return}
try{
const account=this.accountManager.getOrCreateAccount(btcAddress);
miner.btcAddress=account.btc_address;
miner.workerName=workerName;
miner.authorized=true;
miner.accountId=account.account_id;
this.minerTracker.register(miner.minerId,socket,account.account_id);
this.minerTracker.linkAccount(miner.minerId,account.account_id,null);
this.send(socket,{id,result:true,error:null});
console.log(`[Stratum] Authorized: ${miner.minerId} -> ${btcAddress}.${workerName} (account ${account.account_id})`)}
catch(e){
console.error(`[Stratum] Auth error for ${miner.minerId}:`,e.message);
this.send(socket,{id,result:false,error:[20,e.message,null]})}}
handleSubmit(socket,miner,id,params){
if(!miner.authorized){
this.send(socket,{id,result:false,error:[24,'Not authorized',null]});return}
const workerName=params&&params[0]?params[0]:'';
const jobId=params&&params[1]?params[1]:'';
const extranonce2=params&&params[2]?params[2]:'';
const ntime=params&&params[3]?params[3]:'';
const nonce=params&&params[4]?params[4]:'';
if(!jobId||!extranonce2||!ntime||!nonce){
this.send(socket,{id,result:false,error:[20,'Invalid parameters',null]});return}
if(!/^[0-9a-fA-F]+$/.test(extranonce2)||extranonce2.length!==this.extranonce2Size*2){
this.send(socket,{id,result:false,error:[20,'Invalid extranonce2',null]});return}
if(!/^[0-9a-fA-F]{8}$/.test(nonce)){
this.send(socket,{id,result:false,error:[20,'Invalid nonce',null]});return}
const job=this.jobManager.getJob(jobId);
if(!job){
this.send(socket,{id,result:false,error:[21,'Job not found',null]});return}
if(job.stale){
this.send(socket,{id,result:false,error:[21,'Job stale',null]});return}
try{
const result=this.jobManager.validateStratumShare(
job,miner.extranonce1,extranonce2.toLowerCase(),ntime,nonce,
this.extranonce1Size,this.extranonce2Size);
if(!result.valid){
this.send(socket,{id,result:false,error:[20,result.error||'Invalid share',null]});return}
if(result.meetsShareTarget){
miner.shares++;
miner.hashesReported+=this.config.SHARE_DIFFICULTY||1;
if(miner.accountId){
this.minerTracker.addShare(miner.minerId,{
jobId:job.jobId,nonce:result.nonce,hashHex:result.hashHex,
difficulty:this.config.SHARE_DIFFICULTY||1})}
if(result.meetsBlockTarget){
console.log(`[Stratum] BLOCK CANDIDATE from ${miner.minerId}! Nonce: ${result.nonce}`);
this.handleBlockFound(socket,miner,job,result)}
this.send(socket,{id,result:true,error:null})}
else{
this.send(socket,{id,result:false,error:[20,'Low difficulty share',null]})}}
catch(e){
console.error(`[Stratum] Share validation error for ${miner.minerId}:`,e.message);
this.send(socket,{id,result:false,error:[20,e.message,null]})}}
async handleBlockFound(socket,miner,job,result){
try{
const t=this.jobManager.currentTemplate;
if(!t)return;
const{buildCoinbaseStratum,splitCoinbase,dsha,compactVarint,pushdata,addressScript}=require('./block-builder');
const cb=buildCoinbaseStratum(t,this.config.PAYOUT_ADDRESS,this.extranonce1Size,this.extranonce2Size);
const scriptSplit=splitCoinbase(cb.script,cb.extranonceOffset,this.extranonce1Size,this.extranonce2Size);
const fullScript=Buffer.concat([
Buffer.from(scriptSplit.coinb1,'hex'),
Buffer.from(miner.extranonce1,'hex'),
Buffer.from(result.extranonce2||'00000000','hex'),
Buffer.from(scriptSplit.coinb2,'hex')]);
const fullCoinbase=this.jobManager.rebuildCoinbaseTx(t,fullScript);
const blockHex=fullCoinbase.toString('hex');
const rpcResult=await this.submitBlock(blockHex);
console.log(`[Stratum] Block submitted: ${rpcResult||'accepted'}`);
if(miner.accountId){
const blockResult=this.accountManager.insertBlock(miner.accountId,miner.minerId,job.height,t.coinbasevalue||0,result.hashHex);
this.minerTracker.recordBlock(job.height,miner.accountId,miner.minerId,t.coinbasevalue||0)}
socket.write(JSON.stringify({id:null,method:'mining.set_difficulty',params:[miner.difficulty]})+'\n')}
catch(e){
console.error('[Stratum] Block submission error:',e.message)}}
async submitBlock(blockHex){
const config=this.config;
const http=require('http');
const rpcUrl=config.BITCOIN_RPC_URL||'http://127.0.0.1:8332';
const rpcUser=config.BITCOIN_RPC_USER||'btcpool';
const rpcPass=config.BITCOIN_RPC_PASSWORD||'';
const body=JSON.stringify({jsonrpc:'1.0',id:Date.now(),method:'submitblock',params:[blockHex]});
const url=new URL(rpcUrl);
const auth=Buffer.from(`${rpcUser}:${rpcPass}`).toString('base64');
return new Promise((resolve,reject)=>{
const req=http.request({
hostname:url.hostname,port:url.port||8332,path:url.pathname,
method:'POST',
headers:{'Authorization':`Basic ${auth}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},
timeout:30000},(res)=>{
let data='';
res.on('data',chunk=>data+=chunk);
res.on('end',()=>{
try{const parsed=JSON.parse(data);if(parsed.error)reject(new Error(parsed.error.message));else resolve(parsed.result)}
catch(e){reject(new Error('Invalid RPC response'))}})});
req.on('error',reject);
req.on('timeout',()=>{req.destroy();reject(new Error('RPC timeout'))});
req.write(body);req.end()})}
sendJob(socket,miner){
const job=this.jobManager.getStratumJob(miner.extranonce1,this.extranonce1Size,this.extranonce2Size);
if(!job)return;
this.send(socket,{
id:null,method:'mining.notify',
params:[
job.jobId,job.prevhash,job.coinb1,job.coinb2,
job.merkleBranches,job.version,job.nbits,job.ntime,
true]})}
broadcastNewJob(){
const job=this.jobManager.getCurrentJob();
if(!job)return;
for(const[socket,miner]of this.miners){
if(miner.authorized&&miner.subscribed){
try{this.sendJob(socket,miner)}catch(e){}}}}
send(socket,msg){
try{socket.write(JSON.stringify(msg)+'\n')}catch(e){}}
handleDisconnect(socket,miner){
this.miners.delete(socket);
if(miner.accountId){
try{this.minerTracker.unregister(miner.minerId)}catch(e){}}
console.log(`[Stratum] Disconnected: ${miner.minerId} (${miner.btcAddress||'unauthorized'}, ${miner.shares} shares)`)}}
module.exports=StratumServer;
