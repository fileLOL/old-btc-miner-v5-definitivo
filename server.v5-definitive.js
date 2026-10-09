const express=require('express'),path=require('path'),{execFile}=require('child_process'),{promisify}=require('util'),crypto=require('crypto'),http=require('http');
const WebSocket=require('ws');
const run=promisify(execFile),app=express(),PORT=process.env.PORT||3000;
const SHA256D=require('./public/sha256d.js');
const config=require('./lib/config.js');
const JobManager=require('./lib/job-manager.js');
const ShareValidator=require('./lib/share-validator.js');
const MinerTracker=require('./lib/miner-tracker.js');
const RateLimiter=require('./lib/rate-limiter.js');
const{buildJob,buildBlock}=require('./lib/block-builder');

app.use(express.json({limit:'16mb'}));
app.use(express.static(path.join(__dirname,'public')));

const server=http.createServer(app);
const jobManager=new JobManager(config);
const shareValidator=new ShareValidator(jobManager);
const minerTracker=new MinerTracker(config);
const rateLimiter=new RateLimiter({maxPerMinute:60,maxSharesPerMinute:30});

async function btcCli(args){const cli=process.env.BITCOIN_CLI||(require('fs').existsSync('C:\\Program Files\\Bitcoin\\daemon\\bitcoin-cli.exe')?'C:\\Program Files\\Bitcoin\\daemon\\bitcoin-cli.exe':'bitcoin-cli');const{stdout,stderr}=await run(cli,args,{timeout:30000,windowsHide:true,maxBuffer:16*1024*1024});if(stderr&&stderr.trim())throw Error(stderr.trim());return stdout.trim()}

app.get('/api/status',async(_q,r)=>{try{const[a,b]=await Promise.all([btcCli(['getblockchaininfo']),btcCli(['getmininginfo'])]);const i=JSON.parse(a),m=JSON.parse(b);r.json({ok:true,chain:i.chain,blocks:i.blocks,headers:i.headers,verificationprogress:i.verificationprogress,difficulty:i.difficulty,networkhashps:m.networkhashps,warnings:m.warnings||''})}catch(e){r.status(503).json({ok:false,error:e.message})}});
app.get('/api/wallet',async(_q,r)=>{try{const w=JSON.parse(await btcCli(['getwalletinfo']));const bal=typeof w.balance==='number'?w.balance:null;r.json({ok:true,walletname:w.walletname,balance:bal,unconfirmed_balance:w.unconfirmed_balance,txcount:w.txcount})}catch(e){r.status(503).json({ok:false,error:e.message})}});
app.get('/api/template',async(_q,r)=>{try{const t=JSON.parse(await btcCli(['getblocktemplate','{"rules":["segwit"]}']));r.json({ok:true,height:t.height,previousblockhash:t.previousblockhash,bits:t.bits,target:t.target,curtime:t.curtime,mintime:t.mintime,transactions:t.transactions?.length||0,coinbasevalue:t.coinbasevalue,raw:t})}catch(e){r.status(503).json({ok:false,error:e.message})}});

app.get('/api/health',(_q,r)=>{
r.json({ok:true,uptime:process.uptime(),miners:minerTracker.getMinerCount(),version:'5.1.1-definitive'})});

app.get('/api/pool-info',(_q,r)=>{
try{
const poolStats=minerTracker.getPoolStats();
r.json({ok:true,miners_online:poolStats.minersOnline,pool_hashrate:poolStats.totalHashrate,total_shares:poolStats.totalShares,valid_blocks:poolStats.validBlocks,share_difficulty:config.SHARE_DIFFICULTY})}
catch(e){r.status(500).json({ok:false,error:e.message})}});

app.get('/api/job',async(req,res)=>{try{const t=JSON.parse(await btcCli(['getblocktemplate','{"rules":["segwit"]}']));let job=jobManager.getCurrentJob();if(!job||job.height!==t.height||job.previousblockhash!==t.previousblockhash){job=jobManager.setTemplate(t)}res.json({ok:true,...job})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post('/api/submit',async(req,res)=>{try{const block=String(req.body?.block||'');if(!/^[0-9a-fA-F]+$/.test(block)||block.length<160||block.length%2)throw Error('Invalid block hex');const result=await btcCli(['submitblock',block]);res.json({ok:true,result:result||'accepted'})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post('/api/send',async(req,res)=>{if(process.env.ENABLE_SEND!=='1')return res.status(403).json({ok:false,error:'Wallet send disabled. Set ENABLE_SEND=1 explicitly.'});const{address,amount,subtractFeeFromAmount=false}=req.body||{};const value=Number(amount);if(!address||!Number.isFinite(value)||value<=0)return res.status(400).json({ok:false,error:'Invalid address or amount'});try{const args=['sendtoaddress',address,String(value)];if(subtractFeeFromAmount)args.push('','', 'false','true');res.json({ok:true,txid:await btcCli(args)})}catch(e){res.status(503).json({ok:false,error:e.message})}});

let lastTemplateHeight=null;
async function refreshTemplate(){
try{
const raw=await btcCli(['getblocktemplate','{"rules":["segwit"]}']);
const t=JSON.parse(raw);
if(t.height!==lastTemplateHeight){
lastTemplateHeight=t.height;
const job=jobManager.setTemplate(t);
broadcastJob(job)}
else if(jobManager.currentTemplate&&t.previousblockhash!==jobManager.currentTemplate.previousblockhash){
const job=jobManager.setTemplate(t);
broadcastJob(job)}}
catch(e){console.error('Template refresh error:',e.message)}}

function broadcastJob(job){
if(!job)return;
const msg=JSON.stringify({type:'newJob',jobId:job.jobId,height:job.height,header:job.header,midstate:job.midstate,shareTarget:job.shareTarget,blockTarget:job.blockTarget,nonceStart:0,nonceEnd:4294967295,bodyHex:job.bodyHex,bits:job.bits,coinbasevalue:job.coinbasevalue});
wss.clients.forEach(client=>{
if(client.readyState===WebSocket.OPEN){
try{client.send(msg)}catch{}}})}

function broadcastBlockFound(minerId,height){
const msg=JSON.stringify({type:'blockFound',minerId,height});
wss.clients.forEach(client=>{
if(client.readyState===WebSocket.OPEN){
try{client.send(msg)}catch{}}})}

let broadcastInterval=null;
function startBroadcastLoop(){
if(broadcastInterval)return;
broadcastInterval=setInterval(()=>{
const stats=minerTracker.getPoolStats();
const msg=JSON.stringify({type:'poolStats',...stats});
wss.clients.forEach(client=>{
if(client.readyState===WebSocket.OPEN){
try{client.send(msg)}catch{}}})},5000)}

function calculateBlockHash(blockHex){
const headerBuf=Buffer.from(blockHex.slice(0,160),'hex');
const hash1=crypto.createHash('sha256').update(headerBuf).digest();
const hash2=crypto.createHash('sha256').update(hash1).digest();
return Buffer.from(hash2).reverse().toString('hex')}

const wss=new WebSocket.Server({server,path:'/ws'});

wss.on('connection',(ws,req)=>{
const minerId='miner_'+Date.now()+'_'+Math.random().toString(36).slice(2,10);
const registered=minerTracker.register(minerId,ws);
if(!registered){ws.close(1013,'Max miners reached');return}
ws.minerId=minerId;
ws.registered=false;
ws.accountId=null;
console.log(`Miner connected: ${minerId} (total: ${minerTracker.getMinerCount()})`);

ws.send(JSON.stringify({type:'welcome',minerId,version:'5.1.1-definitive'}));

const job=jobManager.getCurrentJob();
if(job){
ws.send(JSON.stringify({type:'newJob',jobId:job.jobId,height:job.height,header:job.header,midstate:job.midstate,shareTarget:job.shareTarget,blockTarget:job.blockTarget,nonceStart:0,nonceEnd:4294967295,bodyHex:job.bodyHex,bits:job.bits,coinbasevalue:job.coinbasevalue}))}

ws.registrationTimeout=setTimeout(()=>{
if(!ws.registered){
console.log(`Miner ${minerId} did not register wallet, closing connection`);
ws.close(1008,'Wallet registration required');
try{minerTracker.unregister(minerId)}catch{}}},30000);

ws.on('message',(data)=>{
if(!rateLimiter.check(minerId,'message')){ws.close(1008,'Rate limit exceeded');return}
try{
const msg=JSON.parse(data.toString());
handleMessage(ws,minerId,msg)}
catch{}});

ws.on('close',()=>{
if(ws.registrationTimeout)clearTimeout(ws.registrationTimeout);
minerTracker.unregister(minerId);
console.log(`Miner disconnected: ${minerId} (total: ${minerTracker.getMinerCount()})`)});

ws.on('error',(err)=>{console.error(`WebSocket error for ${minerId}:`,err.message)})});

function handleMessage(ws,minerId,msg){
if(!msg||typeof msg!=='object')return;
minerTracker.updateSeen(minerId);

if(msg.type==='register'){
if(ws.registered){
ws.send(JSON.stringify({type:'error',error:'Already registered'}));
return}
const{btcAddress}=msg;
if(!btcAddress||typeof btcAddress!=='string'){
ws.send(JSON.stringify({type:'registerFailed',error:'btcAddress required'}));
return}
ws.registered=true;
ws.btcAddress=btcAddress;
if(ws.registrationTimeout)clearTimeout(ws.registrationTimeout);
ws.send(JSON.stringify({type:'registered',btcAddress}));
console.log(`Miner ${minerId} registered with ${btcAddress}`)}

else if(msg.type==='share'){
if(!ws.registered){
ws.send(JSON.stringify({type:'shareRejected',reason:'wallet registration required'}));
return}
if(!rateLimiter.check(minerId,'share')){ws.send(JSON.stringify({type:'error',error:'Share rate limit'}));return}
const result=shareValidator.validate({minerId,jobId:msg.jobId,nonce:msg.nonce,hashHex:msg.hashHex});
if(!result.valid){
minerTracker.addInvalidShare(minerId);
ws.send(JSON.stringify({type:'shareRejected',reason:result.error,stale:result.stale}));
return}
if(result.stale){
minerTracker.addStaleShare(minerId);
ws.send(JSON.stringify({type:'shareRejected',reason:'stale',stale:true}));
return}
if(!result.meetsShareTarget){
minerTracker.addInvalidShare(minerId);
ws.send(JSON.stringify({type:'shareRejected',reason:'does not meet share target'}));
return}
minerTracker.addShare(minerId,{jobId:result.jobId,nonce:result.nonce,hashHex:result.hashHex,difficulty:config.SHARE_DIFFICULTY||1});
ws.send(JSON.stringify({type:'shareAccepted',jobId:result.jobId,nonce:result.nonce}));
if(result.meetsBlockTarget){
console.log(`BLOCK CANDIDATE from ${minerId}! Nonce: ${result.nonce}`);
handleBlockCandidate(ws,minerId,result.jobId,result.nonce)}}

else if(msg.type==='hashrate'){
if(typeof msg.hashes==='number'&&msg.hashes>0){
minerTracker.updateHashrate(minerId,msg.hashes)}}

else if(msg.type==='ping'){
try{ws.send(JSON.stringify({type:'pong'}))}catch(e){}}
}

async function handleBlockCandidate(ws,minerId,jobId,nonce){
try{
const job=jobManager.getJob(jobId);
if(!job||job.stale){ws.send(JSON.stringify({type:'blockRejected',reason:'stale job'}));return}
const blockHex=buildBlock(job,nonce);
const blockHash=calculateBlockHash(blockHex);
console.log('Submitting block to Bitcoin Core...');
console.log('Block hash:',blockHash);
try{
const result=await btcCli(['submitblock',blockHex]);
console.log('BLOCK ACCEPTED:',result||'accepted');
minerTracker.recordBlock(job.height,null,minerId,job.coinbasevalue||0);
broadcastBlockFound(minerId,job.height);
ws.send(JSON.stringify({type:'blockAccepted',height:job.height,blockHash}))}
catch(e){
console.error('Block rejected by Bitcoin Core:',e.message);
ws.send(JSON.stringify({type:'blockRejected',reason:e.message}))}}
catch(err){
console.error('Block submission error:',err.message);
ws.send(JSON.stringify({type:'blockRejected',reason:err.message}))}}

let templateInterval=null;
function startTemplateRefresh(){
if(templateInterval)return;
templateInterval=setInterval(refreshTemplate,config.TEMPLATE_REFRESH_MS)}

server.listen(PORT,'0.0.0.0',async()=>{
console.log(`OLD BTC MINER V5 DEFINITIVE -> http://0.0.0.0:${PORT}`);
console.log(`WebSocket: ws://0.0.0.0:${PORT}/ws`);
console.log(`Payout address: ${config.PAYOUT_ADDRESS?'[CONFIGURED]':'[NOT SET]'}`);

refreshTemplate();
startTemplateRefresh();
startBroadcastLoop()});

process.on('SIGINT',()=>{
console.log('Shutting down...');
clearInterval(templateInterval);
clearInterval(broadcastInterval);
minerTracker.destroy();
rateLimiter.destroy();
jobManager.activeJobs.clear();
wss.close();
server.close();
process.exit(0)});

module.exports={app,server,jobManager,shareValidator,minerTracker,rateLimiter};
