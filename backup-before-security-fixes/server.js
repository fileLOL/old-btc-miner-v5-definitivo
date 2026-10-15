const express=require('express'),path=require('path'),{execFile}=require('child_process'),{promisify}=require('util'),http=require('http'),crypto=require('crypto');
const WebSocket=require('ws');
const run=promisify(execFile);
const config=require('./lib/config');
const JobManager=require('./lib/job-manager');
const ShareValidator=require('./lib/share-validator');
const MinerTracker=require('./lib/miner-tracker');
const RateLimiter=require('./lib/rate-limiter');
const{buildJob,buildBlock,SHA256D}=require('./lib/block-builder');
const{getDb,closeDb}=require('./lib/db');
const accountManager=require('./lib/account-manager');
const{validateAddress}=require('./lib/address-validator');
const BlockMonitor=require('./lib/block-monitor');
const rewardEngine=require('./lib/reward-engine');
const PayoutProcessor=require('./lib/payout-processor');
const PayoutMonitor=require('./lib/payout-monitor');
const AuditLog=require('./lib/audit');
const TestPayoutRunner=require('./lib/test-payout-runner');
const StratumServer=require('./lib/stratum-server');
const SessionManager=require('./lib/session-manager');
const{verifyGoogleIdToken}=require('./lib/google-auth');
const GOOGLE_CLIENT_ID=process.env.GOOGLE_CLIENT_ID||'46928798077-vtsu6fln277j6s601n2b4feg1hrsfi72.apps.googleusercontent.com';

const app=express();
const server=http.createServer(app);
const PORT=config.PORT;

app.use((req,res,next)=>{
const origin=config.CORS_ORIGIN;
if(origin==='*'){res.header('Access-Control-Allow-Origin','*')}
else if(origin&&origin.split(',').map(s=>s.trim()).includes(req.headers.origin)){res.header('Access-Control-Allow-Origin',req.headers.origin)}
res.header('Access-Control-Allow-Methods','GET,POST,OPTIONS');
res.header('Access-Control-Allow-Headers','Content-Type,Authorization');
if(req.method==='OPTIONS')return res.sendStatus(200);
next()});

app.use(express.json({limit:'16mb'}));
app.use(express.static(path.join(__dirname,'frontend')));

let db;
try{db=getDb()}catch(e){console.error('Database init error:',e.message)}

const jobManager=new JobManager(config);
const shareValidator=new ShareValidator(jobManager);
const minerTracker=new MinerTracker(config);
minerTracker.setAccountManager(accountManager);
const rateLimiter=new RateLimiter({maxPerMinute:60,maxSharesPerMinute:30});
const blockMonitor=new BlockMonitor(config,btcCli);
const payoutProcessor=new PayoutProcessor(config,btcCli);
const payoutMonitor=new PayoutMonitor(config,btcCli);
const testPayoutRunner=new TestPayoutRunner(config,btcCli);
const stratumServer=new StratumServer(config,jobManager,minerTracker,accountManager);
const sessionManager=new SessionManager();

function authenticateRequest(req){
const auth=req.headers.authorization||'';
if(!auth.startsWith('Bearer '))return null;
const token=auth.slice(7);
if(!token||token.length!==64||!/^[0-9a-f]{64}$/.test(token))return null;
const session=sessionManager.validateSessionFull(token);
if(session){sessionManager.touchSession(token);return session}
return null}

function authenticateVerifiedRequest(req){
const session=authenticateRequest(req);
if(!session)return null;
if(!session.googleId)return null;
return session}

blockMonitor.onRewardsApplied=function(block,rewardsResult){
for(const reward of rewardsResult.rewards){
try{
const balance=accountManager.getBalance(reward.account_id);
broadcastToAccount(reward.account_id,{
type:'rewardDistributed',
block_height:block.height,
block_id:block.id,
reward_sat:reward.reward_sat,
pending_sat:balance?balance.pending_sat:0,
confirmed_sat:balance?balance.confirmed_sat:0,
total_earned_sat:balance?balance.total_earned_sat:0,
timestamp:Date.now()})}
catch(e){console.error('[WS] rewardDistributed error:',e.message)}}}

function broadcastToAccount(accountId,msg){
const data=JSON.stringify(msg);
wss.clients.forEach(ws=>{
if(ws.accountId===accountId&&ws.readyState===WebSocket.OPEN){
try{ws.send(data)}catch{}}})}

function calculateBlockHash(blockHex){
const headerBuf=Buffer.from(blockHex.slice(0,160),'hex');
const hash1=crypto.createHash('sha256').update(headerBuf).digest();
const hash2=crypto.createHash('sha256').update(hash1).digest();
return Buffer.from(hash2).reverse().toString('hex')}

async function btcCli(args){
const extra=config.RPC_EXTRA?config.RPC_EXTRA.split(' ').filter(Boolean):[];
const{stdout,stderr}=await run(config.BITCOIN_CLI,[...extra,...args],{timeout:30000,windowsHide:true,maxBuffer:16*1024*1024});
if(stderr&&stderr.trim())throw Error(stderr.trim());
return stdout.trim()}

let lastTemplateHeight=null;
let ibdError=null;
async function refreshTemplate(){
try{
const raw=await btcCli(['getblocktemplate','{"rules":["segwit"]}']);
const t=JSON.parse(raw);
if(ibdError){console.log('[Template] Bitcoin Core sync complete, resuming job distribution');ibdError=null}
if(t.height!==lastTemplateHeight){
lastTemplateHeight=t.height;
const job=jobManager.setTemplate(t);
broadcastJob(job)}
else if(jobManager.currentTemplate&&t.previousblockhash!==jobManager.currentTemplate.previousblockhash){
const job=jobManager.setTemplate(t);
broadcastJob(job)}}
catch(e){
const msg=e.message||'';
if(msg.indexOf('-10')>=0||msg.indexOf('Initial block download')>=0||msg.indexOf('Verifying blocks')>=0){
if(!ibdError){console.warn('[Template] Bitcoin Core is syncing blocks (IBD). Mining unavailable until sync completes.');ibdError='Bitcoin Core is syncing blocks (IBD). Mining unavailable.';
wss.clients.forEach(client=>{if(client.readyState===WebSocket.OPEN){try{client.send(JSON.stringify({type:'ibdStatus',ibd:true,message:ibdError}))}catch{}}})}}
else{ibdError=null;console.error('Template refresh error:',e.message)}}}

function broadcastJob(job){
const msg=JSON.stringify({type:'newJob',jobId:job.jobId,height:job.height,header:job.header,midstate:job.midstate,shareTarget:job.shareTarget,blockTarget:job.blockTarget,nonceStart:0,nonceEnd:4294967295});
wss.clients.forEach(client=>{
if(client.readyState===WebSocket.OPEN){
try{client.send(msg)}catch{}}})}

let broadcastInterval=null;
function startBroadcastLoop(){
if(broadcastInterval)return;
broadcastInterval=setInterval(()=>{
const stats=minerTracker.getPoolStats();
const msg=JSON.stringify({type:'poolStats',...stats,ibd:!!ibdError,ibdMessage:ibdError||''});
wss.clients.forEach(client=>{
if(client.readyState===WebSocket.OPEN){
try{client.send(msg)}catch{}}})},5000)}

app.get('/api/status',async(_q,r)=>{
try{
const[a,b]=await Promise.all([btcCli(['getblockchaininfo']),btcCli(['getmininginfo'])]);
const i=JSON.parse(a),m=JSON.parse(b);
r.json({ok:true,chain:i.chain,blocks:i.blocks,headers:i.headers,verificationprogress:i.verificationprogress,difficulty:i.difficulty,networkhashps:m.networkhashps,warnings:m.warnings||''})}
catch(e){r.status(503).json({ok:false,error:e.message})}});

app.get('/api/wallet',async(_q,r)=>{
try{
const w=JSON.parse(await btcCli(['getwalletinfo']));
const bal=typeof w.balance==='number'?w.balance:null;
r.json({ok:true,walletname:w.walletname,balance:bal,unconfirmed_balance:w.unconfirmed_balance,txcount:w.txcount})}
catch(e){r.status(503).json({ok:false,error:e.message})}});

app.get('/api/template',async(_q,r)=>{
try{
const t=JSON.parse(await btcCli(['getblocktemplate','{"rules":["segwit"]}']));
if(ibdError)ibdError=null;
r.json({ok:true,height:t.height,previousblockhash:t.previousblockhash,bits:t.bits,target:t.target,curtime:t.curtime,mintime:t.mintime,transactions:t.transactions?.length||0,coinbasevalue:t.coinbasevalue,raw:t})}
catch(e){
const msg=e.message||'';
const isIbd=msg.indexOf('-10')>=0||msg.indexOf('Initial block download')>=0||msg.indexOf('Verifying blocks')>=0;
r.status(503).json({ok:false,error:e.message,ibd:isIbd,ibdMessage:isIbd?'Bitcoin Core is syncing blocks (IBD). Mining unavailable.':undefined})}});

app.get('/api/job',async(_req,res)=>{
try{
const address=config.PAYOUT_ADDRESS;
if(!address)throw Error('Payout address not configured');
if(ibdError)throw Error(ibdError);

const t=JSON.parse(await btcCli(['getblocktemplate','{"rules":["segwit"]}']));

let job=jobManager.getCurrentJob();

if(
  !job ||
  job.height!==t.height ||
  job.previousblockhash!==t.previousblockhash
){
  job=jobManager.setTemplate(t);
}

res.json({ok:true,...job});
}catch(e){
const msg=e.message||'';
const isIbd=msg.indexOf('-10')>=0||msg.indexOf('IBD')>=0||msg.indexOf('syncing')>=0;
res.status(400).json({ok:false,error:e.message,ibd:isIbd});
}});

app.post('/api/submit',async(req,res)=>{
try{
const block=String(req.body?.block||'');
if(!/^[0-9a-fA-F]+$/.test(block)||block.length<160||block.length%2)throw Error('Invalid block hex');
const result=await btcCli(['submitblock',block]);
res.json({ok:true,result:result||'accepted'})}
catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/send',async(req,res)=>{
if(process.env.ENABLE_SEND!=='1')return res.status(403).json({ok:false,error:'Wallet send disabled. Set ENABLE_SEND=1 explicitly.'});
const{address,amount,subtractFeeFromAmount=false}=req.body||{};
const value=Number(amount);
if(!address||!Number.isFinite(value)||value<=0)return res.status(400).json({ok:false,error:'Invalid address or amount'});
try{
const args=['sendtoaddress',address,String(value)];
if(subtractFeeFromAmount)args.push('','', 'false','true');
res.json({ok:true,txid:await btcCli(args)})}
catch(e){res.status(503).json({ok:false,error:e.message})}});

app.post('/api/register-miner',(req,res)=>{
try{
const{btcAddress}=req.body||{};
if(!btcAddress||typeof btcAddress!=='string'){
return res.status(400).json({ok:false,error:'btcAddress required'})}
const validation=validateAddress(btcAddress);
if(!validation.valid){
return res.status(400).json({ok:false,error:'Invalid Bitcoin address: '+validation.error})}
const account=accountManager.getOrCreateAccount(btcAddress);
const minerId='miner_'+Date.now()+'_'+Math.random().toString(36).slice(2,10);
const wsConn=null;
const registered=minerTracker.register(minerId,wsConn,account.account_id);
if(!registered){
return res.status(503).json({ok:false,error:'Pool full, max miners reached'})}
const session=accountManager.getSession(minerId);
res.json({ok:true,minerId,accountId:account.account_id,btcAddress:account.btc_address,isNew:account.isNew})}
catch(e){
console.error('Register miner error:',e.message);
res.status(500).json({ok:false,error:e.message})}});

app.get('/api/miner/:minerId/stats',(req,res)=>{
try{
const{minerId}=req.params;
const miner=minerTracker.getMiner(minerId);
if(!miner){
return res.status(404).json({ok:false,error:'Miner not found or not connected'})}
const stats=minerTracker.getMinerStats(minerId);
if(!stats.accountId){
return res.json({ok:true,registered:false,minerId,shares:stats.shares,hashrate:stats.hashrate,lastSeen:stats.lastSeen})}
const account=accountManager.getAccount(stats.accountId);
const balance=accountManager.getBalance(stats.accountId);
const totalShares=accountManager.getShareCountByAccount(stats.accountId);
res.json({ok:true,registered:true,minerId,accountId:stats.accountId,btcAddress:account?account.btc_address:null,shares:stats.shares,totalShares,hashrate:stats.hashrate,lastSeen:stats.lastSeen,balance:balance?{confirmed_sat:balance.confirmed_sat,pending_sat:balance.pending_sat,total_earned_sat:balance.total_earned_sat}:null})}
catch(e){
console.error('Get miner stats error:',e.message);
res.status(500).json({ok:false,error:e.message})}});

app.get('/api/my-stats',(req,res)=>{
try{
const{minerId}=req.query;
if(!minerId){return res.status(400).json({ok:false,error:'minerId required'})}
const miner=minerTracker.getMiner(minerId);
if(!miner||!miner.accountId){
return res.status(404).json({ok:false,error:'Miner not found or not registered'})}
const stats=rewardEngine.getAccountStats(miner.accountId);
if(!stats){return res.status(404).json({ok:false,error:'Account not found'})}
const windowStats=rewardEngine.getSharesInWindow(miner.accountId,config.PPLNS_WINDOW_SIZE);
res.json({ok:true,account_id:stats.account_id,btc_address:stats.btc_address,shares:stats.shares,shares_in_window:windowStats.count,shares_in_window_difficulty:windowStats.totalDifficulty,blocks_found:stats.blocks_found,balance:{pending_sat:stats.balance.pending_sat,confirmed_sat:stats.balance.confirmed_sat,total_earned_sat:stats.balance.total_earned_sat,pending_btc:(stats.balance.pending_sat/1e8).toFixed(8),confirmed_btc:(stats.balance.confirmed_sat/1e8).toFixed(8),total_earned_btc:(stats.balance.total_earned_sat/1e8).toFixed(8)},hashrate:miner.hashrate,lastSeen:miner.lastSeen})}
catch(e){
console.error('Get my-stats error:',e.message);
res.status(500).json({ok:false,error:e.message})}});

app.get('/api/my-balance',(req,res)=>{
  const session=authenticateVerifiedRequest(req);
  if(!session){return res.status(401).json({ok:false,error:'unauthorized: verified account required'})}
  const accountId=session.accountId;
  try{
    const stats=rewardEngine.getAccountStats(accountId);
    if(!stats){return res.status(404).json({ok:false,error:'account not found'})}
    const windowStats=rewardEngine.getSharesInWindow(accountId,config.PPLNS_WINDOW_SIZE);
    const shareCount=accountManager.getShareCountByAccount(accountId);
    const estimation=rewardEngine.getEstimatedReward(accountId,config.PPLNS_WINDOW_SIZE,config.POOL_FEE_PERCENT);
    res.json({ok:true,
      verified:true,
      pending_sat:stats.balance?stats.balance.pending_sat:0,
      confirmed_sat:stats.balance?stats.balance.confirmed_sat:0,
      total_earned_sat:stats.balance?stats.balance.total_earned_sat:0,
      shares_accepted:shareCount,
      shares_in_window:windowStats.count,
      blocks_found:stats.blocks_found,
      pool_fee_percent:config.POOL_FEE_PERCENT,
      payout_dry_run:config.PAYOUT_DRY_RUN,
      min_payout_sat:config.MIN_PAYOUT_SAT,
      estimated_sat:estimation.estimated_sat,
      estimated_has_data:estimation.has_valid_data,
      estimated_reason:estimation.reason,
      estimated_reference_block:estimation.reference_block_id,
      estimated_reference_height:estimation.reference_block_height,
      estimated_reference_coinbase_sat:estimation.reference_coinbase_sat,
      estimated_proportion:estimation.miner_proportion})}
  catch(e){
    console.error('Get my-balance error:',e.message);
    res.status(500).json({ok:false,error:e.message})}});

app.get('/api/pool-info',(_q,r)=>{
try{
const poolStats=minerTracker.getPoolStats();
const blocks=accountManager.getAllBlocks();
const confirmedBlocks=blocks.filter(b=>b.status==='confirmed'||b.status==='mature');
const totalRewards=confirmedBlocks.reduce((sum,b)=>sum+b.coinbase_value,0);
r.json({ok:true,miners_online:poolStats.minersOnline,pool_hashrate:poolStats.totalHashrate,total_shares:poolStats.totalShares,valid_blocks:poolStats.validBlocks,blocks_found:blocks.length,confirmed_blocks:confirmedBlocks.length,pool_fee_percent:config.POOL_FEE_PERCENT,pplns_window_size:config.PPLNS_WINDOW_SIZE,min_payout_sat:config.MIN_PAYOUT_SAT,total_rewards_sat:totalRewards,share_difficulty:config.SHARE_DIFFICULTY})}
catch(e){
console.error('Get pool-info error:',e.message);
r.status(500).json({ok:false,error:e.message})}});

app.get('/api/pool-stats',(_q,r)=>{
r.json({ok:true,...minerTracker.getPoolStats(),jobManager:jobManager.getStats()})});

app.get('/api/health',(_q,r)=>{
r.json({ok:true,uptime:process.uptime(),miners:minerTracker.getMinerCount(),version:'5.1.0-pool'})});

app.get('/api/payouts',(req,res)=>{
try{
const status=req.query.status||'all';
const limit=parseInt(req.query.limit||'100',10);
const db=getDb();
let query=`SELECT p.*, a.btc_address FROM payouts p JOIN accounts a ON p.account_id=a.account_id`;
let params=[];
if(status!=='all'){query+=' WHERE p.status=?';params.push(status)}
query+=' ORDER BY p.created_at DESC LIMIT ?';
params.push(limit);
const payouts=db.prepare(query).all(...params);
res.json({ok:true,payouts})}
catch(e){res.status(500).json({ok:false,error:e.message})}});

app.get('/api/payout-stats',(_q,res)=>{
try{
const stats=payoutProcessor.getPayoutStats();
res.json({ok:true,stats})}
catch(e){res.status(500).json({ok:false,error:e.message})}});

app.get('/api/audit',(req,res)=>{
try{
const accountId=req.query.accountId?parseInt(req.query.accountId,10):null;
const limit=parseInt(req.query.limit||'100',10);
const trail=AuditLog.getAuditTrail(accountId,limit);
res.json({ok:true,audit:trail})}
catch(e){res.status(500).json({ok:false,error:e.message})}});

app.get('/api/audit/summary',(req,res)=>{
try{
const accountId=req.query.accountId?parseInt(req.query.accountId,10):null;
let summary;
if(accountId){summary=AuditLog.getAccountSummary(accountId)}
else{summary=AuditLog.getPoolSummary()}
res.json({ok:true,summary})}
catch(e){res.status(500).json({ok:false,error:e.message})}});

app.get('/api/admin/test-payout/status',(_q,res)=>{
try{
res.json({ok:true,
enabled:config.ENABLE_REAL_PAYOUT_TEST,
dryRun:config.PAYOUT_DRY_RUN,
destination:testPayoutRunner.getTestAddress()||'(not configured)',
amountSat:testPayoutRunner.getTestAmountSat(),
minPayoutSat:config.MIN_PAYOUT_SAT,
maxPayoutSat:config.MAX_PAYOUT_SAT,
testDbPath:testPayoutRunner.getTestDbPath()})}
catch(e){res.status(500).json({ok:false,error:e.message})}});

app.post('/api/admin/test-payout/run',async(req,res)=>{
try{
const result=await testPayoutRunner.run();
res.json({ok:result.success!==false,result})}
catch(e){res.status(500).json({ok:false,error:e.message})}});

app.get('/api/admin/test-payout/state',(_q,res)=>{
try{
const state=testPayoutRunner.getState();
if(!state)return res.json({ok:true,state:null,message:'test DB not initialised yet'})
res.json({ok:true,state})}
catch(e){res.status(500).json({ok:false,error:e.message})}});

const wss=new WebSocket.Server({server,path:'/ws'});

wss.on('connection',(ws,req)=>{
const minerId='miner_'+Date.now()+'_'+Math.random().toString(36).slice(2,10);
const registered=minerTracker.register(minerId,ws);
if(!registered){ws.close(1013,'Max miners reached');return}
ws.minerId=minerId;
ws.registered=false;
ws.accountId=null;
ws.sessionToken=null;
console.log(`Miner connected: ${minerId} (total: ${minerTracker.getMinerCount()})`);

ws.send(JSON.stringify({type:'welcome',minerId,version:'5.1.0-pool'}));

const job=jobManager.getCurrentJob();
if(job){
ws.send(JSON.stringify({type:'newJob',jobId:job.jobId,height:job.height,header:job.header,midstate:job.midstate,shareTarget:job.shareTarget,blockTarget:job.blockTarget,nonceStart:0,nonceEnd:4294967295}))}

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
if(ws.sessionToken){sessionManager.destroySession(ws.sessionToken);ws.sessionToken=null}
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
const{btcAddress,googleToken}=msg;
if(!btcAddress||typeof btcAddress!=='string'){
ws.send(JSON.stringify({type:'registerFailed',error:'btcAddress required'}));
return}
const validation=validateAddress(btcAddress);
if(!validation.valid){
ws.send(JSON.stringify({type:'registerFailed',error:'Invalid Bitcoin address: '+validation.error}));
return}
(async()=>{
try{
let googleData=null;
if(googleToken){
googleData=await verifyGoogleIdToken(googleToken,GOOGLE_CLIENT_ID);
if(!googleData.valid){
ws.send(JSON.stringify({type:'registerFailed',error:'invalid Google token: '+googleData.error}));
console.log(`Registration rejected: invalid Google token (${googleData.error})`);
return}
}
const existingAccount=accountManager.getAccountByAddress(btcAddress);
if(existingAccount){
const activeCount=sessionManager.getAccountTokenCount(existingAccount.account_id);
if(activeCount>0){
ws.send(JSON.stringify({type:'registerFailed',error:'account has active session'}));
console.log(`Registration rejected for ${existingAccount.account_id}: active session exists`);
return}
const existingIdentity=accountManager.getIdentityByAccountId(existingAccount.account_id);
if(googleData){
if(!existingIdentity){
ws.send(JSON.stringify({type:'registerFailed',error:'account exists but not verified with Google; cannot claim with Google Sign-In'}));
console.log(`Registration rejected: account ${existingAccount.account_id} not verified, Google claim denied`);
return}
if(existingIdentity.google_id!==googleData.googleId){
ws.send(JSON.stringify({type:'registerFailed',error:'account already verified with different Google account'}));
console.log(`Registration rejected: account ${existingAccount.account_id} linked to different Google account`);
return}
const token=sessionManager.createSession(existingAccount.account_id,googleData.googleId);
const userAgent=ws.upgradeReq?.headers?.['user-agent']||null;
minerTracker.linkAccount(minerId,existingAccount.account_id,userAgent);
ws.registered=true;
ws.accountId=existingAccount.account_id;
ws.sessionToken=token;
ws.googleId=googleData.googleId;
if(ws.registrationTimeout)clearTimeout(ws.registrationTimeout);
ws.send(JSON.stringify({type:'registered',accountId:existingAccount.account_id,btcAddress:existingAccount.btc_address,isNew:false,verified:true}));
ws.send(JSON.stringify({type:'sessionToken',token:token}));
console.log(`Miner ${minerId} registered (verified) with account ${existingAccount.account_id}`);
return}
const token=sessionManager.createSession(existingAccount.account_id,null);
const userAgent=ws.upgradeReq?.headers?.['user-agent']||null;
minerTracker.linkAccount(minerId,existingAccount.account_id,userAgent);
ws.registered=true;
ws.accountId=existingAccount.account_id;
ws.sessionToken=token;
ws.googleId=null;
if(ws.registrationTimeout)clearTimeout(ws.registrationTimeout);
ws.send(JSON.stringify({type:'registered',accountId:existingAccount.account_id,btcAddress:existingAccount.btc_address,isNew:false,verified:false}));
ws.send(JSON.stringify({type:'sessionToken',token:token}));
console.log(`Miner ${minerId} registered (legacy) with account ${existingAccount.account_id}`);
return}
if(googleData){
const account=accountManager.getOrCreateAccount(btcAddress);
accountManager.createIdentity(account.account_id,googleData.googleId,googleData.email,googleData.name);
const token=sessionManager.createSession(account.account_id,googleData.googleId);
const userAgent=ws.upgradeReq?.headers?.['user-agent']||null;
minerTracker.linkAccount(minerId,account.account_id,userAgent);
ws.registered=true;
ws.accountId=account.account_id;
ws.sessionToken=token;
ws.googleId=googleData.googleId;
if(ws.registrationTimeout)clearTimeout(ws.registrationTimeout);
ws.send(JSON.stringify({type:'registered',accountId:account.account_id,btcAddress:account.btc_address,isNew:account.isNew,verified:true}));
ws.send(JSON.stringify({type:'sessionToken',token:token}));
console.log(`Miner ${minerId} registered (verified) with NEW account ${account.account_id}`);
return}
const account=accountManager.getOrCreateAccount(btcAddress);
const token=sessionManager.createSession(account.account_id,null);
const userAgent=ws.upgradeReq?.headers?.['user-agent']||null;
minerTracker.linkAccount(minerId,account.account_id,userAgent);
ws.registered=true;
ws.accountId=account.account_id;
ws.sessionToken=token;
ws.googleId=null;
if(ws.registrationTimeout)clearTimeout(ws.registrationTimeout);
ws.send(JSON.stringify({type:'registered',accountId:account.account_id,btcAddress:account.btc_address,isNew:account.isNew,verified:false}));
ws.send(JSON.stringify({type:'sessionToken',token:token}));
console.log(`Miner ${minerId} registered (legacy) with NEW account ${account.account_id}`)}
catch(e){
console.error('Registration error:',e.message);
ws.send(JSON.stringify({type:'registerFailed',error:e.message}))}})()}

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
const miner=minerTracker.getMiner(minerId);
if(miner&&miner.accountId){AuditLog.logShare(miner.accountId,result.jobId,config.SHARE_DIFFICULTY||1)}
ws.send(JSON.stringify({type:'shareAccepted',jobId:result.jobId,nonce:result.nonce}));
if(ws.accountId){
try{
const bal=accountManager.getBalance(ws.accountId);
const totalShares=accountManager.getShareCountByAccount(ws.accountId);
broadcastToAccount(ws.accountId,{
type:'balanceUpdate',
pending_sat:bal?bal.pending_sat:0,
confirmed_sat:bal?bal.confirmed_sat:0,
total_earned_sat:bal?bal.total_earned_sat:0,
shares_accepted:totalShares,
timestamp:Date.now()})}
catch(e){}}
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
const miner=minerTracker.getMiner(minerId);
const blockResult=accountManager.insertBlock(miner?miner.accountId:null,minerId,job.height,job.coinbasevalue||0,blockHash);
minerTracker.recordBlock(job.height,miner?miner.accountId:null,minerId,job.coinbasevalue||0);
broadcastBlockFound(minerId,job.height);
ws.send(JSON.stringify({type:'blockAccepted',height:job.height,blockHash}))}
catch(e){
console.error('Block rejected by Bitcoin Core:',e.message);
ws.send(JSON.stringify({type:'blockRejected',reason:e.message}))}}
catch(err){
console.error('Block submission error:',err.message);
ws.send(JSON.stringify({type:'blockRejected',reason:err.message}))}}

function broadcastBlockFound(minerId,height){
const msg=JSON.stringify({type:'blockFound',minerId,height});
wss.clients.forEach(client=>{
if(client.readyState===WebSocket.OPEN){
try{client.send(msg)}catch{}}})}

let templateInterval=null;
function startTemplateRefresh(){
if(templateInterval)return;
templateInterval=setInterval(refreshTemplate,config.TEMPLATE_REFRESH_MS)}

server.listen(PORT,'0.0.0.0',async()=>{
console.log(`OLD BTC MINER V5 POOL -> http://0.0.0.0:${PORT}`);
console.log(`WebSocket: ws://0.0.0.0:${PORT}/ws`);
console.log(`Stratum: stratum+tcp://0.0.0.0:${config.STRATUM_PORT}`);
console.log(`Payout address: ${config.PAYOUT_ADDRESS?'[CONFIGURED]':'[NOT SET - edit .env]'}`);
console.log(`Pool fee: ${config.POOL_FEE_PERCENT}% | PPLNS window: ${config.PPLNS_WINDOW_SIZE} | Min payout: ${config.MIN_PAYOUT_SAT} sat`);
console.log(`Payout mode: ${config.PAYOUT_DRY_RUN?'DRY RUN (no real payments)':'LIVE (real payments enabled)'}`);
if(config.POOL_PUBLIC_HOST){console.log(`Public: stratum+tcp://${config.POOL_PUBLIC_HOST}:${config.STRATUM_PORT}`)}

try{
console.log('[Startup] Checking for stale pending payouts...');
const recovery=await payoutProcessor.recoverStalePendingPayouts();
if(recovery.recovered>0){
console.log(`[Startup] Recovery complete: ${recovery.recovered} processed, ${recovery.reverted} reverted, ${recovery.broadcast} to broadcast`)}
else{console.log('[Startup] No stale pending payouts found')}}
catch(e){console.error('[Startup] Recovery error:',e.message)}

refreshTemplate();
startTemplateRefresh();
startBroadcastLoop();
blockMonitor.start();
payoutMonitor.start();
stratumServer.start();

const payoutInterval=setInterval(async()=>{
try{
console.log('[PayoutScheduler] Running periodic payout check...');
const results=await payoutProcessor.processAllPayouts();
if(results.length>0){
console.log(`[PayoutScheduler] Processed ${results.length} payouts`);
results.forEach(r=>console.log(`  Account ${r.account_id}: ${r.success?'SUCCESS':'FAILED'} - ${r.amount_sat||0} sat`))}
else{console.log('[PayoutScheduler] No eligible accounts for payout')}}
catch(e){console.error('[PayoutScheduler] Error:',e.message)}
},config.PAYOUT_INTERVAL_MS)});

process.on('SIGINT',()=>{
console.log('Shutting down...');
clearInterval(templateInterval);
clearInterval(broadcastInterval);
clearInterval(payoutInterval);
stratumServer.stop();
minerTracker.destroy();
rateLimiter.destroy();
blockMonitor.stop();
payoutMonitor.stop();
sessionManager.destroy();
try{testPayoutRunner.close()}catch{}
jobManager.activeJobs.clear();
wss.close();
server.close();
try{closeDb()}catch{}
process.exit(0)});

module.exports={app,server,jobManager,shareValidator,minerTracker,rateLimiter,btcCli,config,stratumServer,sessionManager};
