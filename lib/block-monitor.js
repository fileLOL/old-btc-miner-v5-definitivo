const{getDb}=require('./db');
const{applyRewards}=require('./reward-engine');
const AuditLog=require('./audit');
class BlockMonitor{
constructor(config,btcCliFn){
this.config=config;
this.btcCli=btcCliFn;
this.interval=null;
this.running=false;
this.onRewardsApplied=null}
start(){
if(this.interval)return;
console.log('[BlockMonitor] Starting block monitor (interval:',this.config.BLOCK_MONITOR_MS+'ms)');
this.checkAll();
this.interval=setInterval(()=>this.checkAll(),this.config.BLOCK_MONITOR_MS)}
stop(){
if(this.interval){
clearInterval(this.interval);
this.interval=null}
console.log('[BlockMonitor] Stopped')}
async checkAll(){
if(this.running)return;
this.running=true;
try{
const db=getDb();
const pendingBlocks=db.prepare("SELECT * FROM blocks WHERE status IN ('submitted','confirmed')").all();
for(const block of pendingBlocks){
await this.checkBlock(block)}}
catch(e){console.error('[BlockMonitor] Error:',e.message)}
finally{this.running=false}}
async checkBlock(block){
const db=getDb();
try{
if(!block.block_hash){
console.log('[BlockMonitor] Block',block.id,'has no hash, cannot monitor');
return}
const result=await this.btcCli(['getblock',block.block_hash]);
const info=JSON.parse(result);
const confirmations=info.confirmations||0;
if(confirmations<0){
console.log('[BlockMonitor] Block',block.id,'at height',block.height,'is orphaned (negative confirmations)');
db.prepare("UPDATE blocks SET status='orphaned' WHERE id=?").run(block.id);
return}
if(confirmations>=1&&block.status==='submitted'){
console.log('[BlockMonitor] Block',block.id,'at height',block.height,'confirmed (',confirmations,'confirmations)');
db.prepare("UPDATE blocks SET status='confirmed' WHERE id=?").run(block.id);
block.status='confirmed'}
if(confirmations>=this.config.COINBASE_MATURITY&&block.status==='confirmed'){
console.log('[BlockMonitor] Block',block.id,'at height',block.height,'mature (',confirmations,'confirmations). Distributing rewards...');
const maturityResult=this.matureBlockAtomically(block.id);
if(maturityResult.alreadyProcessed){
console.log('[BlockMonitor] Block',block.id,'already processed (skipped, status:',maturityResult.reason||'?'+')');
return}
if(maturityResult.error){
console.error('[BlockMonitor] Block',block.id,'maturity transaction failed:',maturityResult.error);
return}
const rewardsResult=maturityResult.rewards;
for(const reward of rewardsResult.rewards){
AuditLog.logBlockReward(reward.account_id,block.id,block.height,reward.reward_sat)}
if(rewardsResult.poolFee>0){
AuditLog.logPoolFee(block.id,rewardsResult.poolFee)}
console.log('[BlockMonitor] Distributed',rewardsResult.distributable,'sat to',rewardsResult.rewards.length,'accounts');
if(typeof this.onRewardsApplied==='function'){
try{this.onRewardsApplied(block,rewardsResult)}catch(cbErr){console.error('[BlockMonitor] onRewardsApplied callback error:',cbErr.message)}}
return}
if(confirmations===0&&block.status==='submitted'){
const chainInfo=await this.btcCli(['getblockchaininfo']);
const chain=JSON.parse(chainInfo);
const blocksSince=chain.blocks-block.height;
if(blocksSince>this.config.COINBASE_MATURITY){
console.log('[BlockMonitor] Block',block.id,'at height',block.height,'likely orphaned (',blocksSince,'blocks deep, 0 confirmations)');
db.prepare("UPDATE blocks SET status='orphaned' WHERE id=?").run(block.id)}}}
catch(e){
if(e.message&&e.message.includes('Block not found')){
console.log('[BlockMonitor] Block',block.id,'at height',block.height,'not found in chain, marking orphaned');
db.prepare("UPDATE blocks SET status='orphaned' WHERE id=?").run(block.id)}
else{console.error('[BlockMonitor] Error checking block',block.id,':',e.message)}}}
matureBlockAtomically(blockId){
const db=getDb();
const maturityTx=db.transaction(()=>{
const current=db.prepare("SELECT status FROM blocks WHERE id=?").get(blockId);
if(!current)return{alreadyProcessed:true,reason:'not found'};
if(current.status==='mature'||current.status==='orphaned')return{alreadyProcessed:true,reason:current.status};
if(current.status!=='confirmed')return{alreadyProcessed:true,reason:current.status};
const rewards=applyRewards(blockId,this.config.PPLNS_WINDOW_SIZE,this.config.POOL_FEE_PERCENT);
db.prepare("UPDATE blocks SET status='mature' WHERE id=? AND status='confirmed'").run(blockId);
return{alreadyProcessed:false,rewards}});
try{
return maturityTx()
}catch(err){
return{alreadyProcessed:true,error:err.message}}}
}
module.exports=BlockMonitor;
