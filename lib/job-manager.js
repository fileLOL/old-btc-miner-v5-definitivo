const crypto=require('crypto'),SHA256D=require('../public/sha256d.js'),{buildJob,buildStratumJob}=require('./block-builder');
class JobManager{
constructor(config){this.config=config;this.currentTemplate=null;this.currentJob=null;this.activeJobs=new Map();this.jobCounter=0;this.blockTarget=null;this.stratumJobData=null}
setTemplate(t){
this.currentTemplate=t;
this.blockTarget=[...Buffer.from(t.target,'hex')];
const prevJobId=this.currentJob?this.currentJob.jobId:null;
for(const[id,job]of this.activeJobs){if(id!==null)job.stale=true}
const jobId='job_'+(++this.jobCounter)+'_'+crypto.randomBytes(4).toString('hex');
const job=buildJob(t,this.config.PAYOUT_ADDRESS);
job.jobId=jobId;
job.stale=false;
job.createdAt=Date.now();
job.previousblockhash=t.previousblockhash;
job.shareTarget=this.calculateShareTarget(this.blockTarget);
job.blockTarget=this.blockTarget;
this.stratumJobData={
template:t,
version:t.version.toString(16).padStart(8,'0'),
prevhash:t.previousblockhash,
nbits:t.bits,
ntime:t.curtime.toString(16).padStart(8,'0'),
height:t.height,
coinbasevalue:t.coinbasevalue
};
this.currentJob=job;
this.activeJobs.set(jobId,job);
this.cleanupOldJobs();
return job}
getStratumJob(extranonce1,extranonce1Size,extranonce2Size){
if(!this.stratumJobData||!this.currentJob)return null;
const sj=buildStratumJob(this.stratumJobData.template,this.config.PAYOUT_ADDRESS,extranonce1,extranonce1Size,extranonce2Size);
return{
jobId:this.currentJob.jobId,
coinb1:sj.coinb1,
coinb2:sj.coinb2,
merkleBranches:sj.merkleBranches,
version:sj.version,
prevhash:sj.prevhash,
nbits:sj.nbits,
ntime:sj.ntime,
cleanJobs:true,
height:sj.height,
coinbasevalue:sj.coinbasevalue,
bits:sj.bits}}
calculateShareTarget(blockTargetBytes){
const diff=Number(this.config.SHARE_DIFFICULTY);
if(!Number.isFinite(diff)||diff<=0)throw Error('Invalid SHARE_DIFFICULTY');

const maxTarget=(1n<<256n)-1n;
let target=maxTarget/BigInt(Math.round(diff));

const result=new Uint8Array(32);
for(let i=31;i>=0;i--){
result[i]=Number(target&0xFFn);
target>>=8n;
}
return[...result];
}
getJob(jobId){return this.activeJobs.get(jobId)||null}
isStale(jobId){const j=this.activeJobs.get(jobId);return!j||j.stale}
getCurrentJob(){return this.currentJob}
cleanupOldJobs(){
const now=Date.now();
const timeout=this.config.JOB_TIMEOUT_MS;
for(const[id,job]of this.activeJobs){
if(now-job.createdAt>timeout&&id!==this.currentJob.jobId){
this.activeJobs.delete(id)}}
if(this.activeJobs.size>20){
const sorted=[...this.activeJobs.entries()].sort((a,b)=>b[1].createdAt-a[1].createdAt);
const toDelete=sorted.slice(10);
for(const[id]of toDelete){if(id!==this.currentJob.jobId)this.activeJobs.delete(id)}}}
getStats(){return{
currentJobId:this.currentJob?this.currentJob.jobId:null,
height:this.currentTemplate?this.currentTemplate.height:null,
activeJobs:this.activeJobs.size,
staleJobs:[...this.activeJobs.values()].filter(j=>j.stale).length}}
validateStratumShare(job,extranonce1,extranonce2Hex,ntimeHex,nonceHex,extranonce1Size,extranonce2Size){
const{buildCoinbaseStratum,splitCoinbase,dsha,merkle}=require('./block-builder');
const t=this.stratumJobData.template;
const cb=buildCoinbaseStratum(t,this.config.PAYOUT_ADDRESS,extranonce1Size,extranonce2Size);
const scriptSplit=splitCoinbase(cb.script,cb.extranonceOffset,extranonce1Size,extranonce2Size);
const fullScript=Buffer.concat([
Buffer.from(scriptSplit.coinb1,'hex'),
Buffer.from(extranonce1,'hex'),
Buffer.from(extranonce2Hex,'hex'),
Buffer.from(scriptSplit.coinb2,'hex')
]);
const fullCoinbase=this.rebuildCoinbaseTx(t,fullScript);
const coinbaseTxid=dsha(fullCoinbase);
let merkleInput=[coinbaseTxid,...(t.transactions||[]).map(x=>Buffer.from(x.txid,'hex').reverse())];
while(merkleInput.length>1){let n=[];for(let i=0;i<merkleInput.length;i+=2)n.push(dsha(Buffer.concat([merkleInput[i],merkleInput[i+1]||merkleInput[i]])));merkleInput=n}
const merkleRoot=merkleInput[0]||Buffer.alloc(32);
const header=Buffer.alloc(80);
header.writeUInt32LE(parseInt(job.version||this.stratumJobData.version,16)>>>0,0);
Buffer.from(job.prevhash||this.stratumJobData.prevhash,'hex').reverse().copy(header,4);
merkleRoot.copy(header,36);
const ntimeVal=ntimeHex?parseInt(ntimeHex,16):this.stratumJobData.template.curtime;
header.writeUInt32LE(ntimeVal>>>0,68);
Buffer.from(job.nbits||this.stratumJobData.nbits,'hex').reverse().copy(header,72);
const nonceVal=parseInt(nonceHex,16)>>>0;
header.writeUInt32LE(nonceVal,76);
const hash1=crypto.createHash('sha256').update(header).digest();
const hash2=crypto.createHash('sha256').update(hash1).digest();
const hashReversed=Buffer.from(hash2).reverse();
const hashHex=hashReversed.toString('hex');
const shareTarget=Buffer.from(job.shareTarget||this.currentJob.shareTarget);
const blockTarget=Buffer.from(job.blockTarget||this.currentJob.blockTarget);
let meetsShare=false,meetsBlock=false;
for(let i=0;i<32;i++){
if(hashReversed[i]<shareTarget[i]){meetsShare=true;break}
if(hashReversed[i]>shareTarget[i])break}
for(let i=0;i<32;i++){
if(hashReversed[i]<blockTarget[i]){meetsBlock=true;break}
if(hashReversed[i]>blockTarget[i])break}
return{valid:true,meetsShareTarget:meetsShare,meetsBlockTarget:meetsBlock,hashHex,nonce:nonceVal}}
rebuildCoinbaseTx(t,script){
const crypto2=require('crypto');
const payout=require('./block-builder').addressScript(this.config.PAYOUT_ADDRESS);
const value=Buffer.alloc(8);value.writeBigUInt64LE(BigInt(t.coinbasevalue));
const outs=[Buffer.concat([value,require('./block-builder').pushdata(payout)])];
if(t.default_witness_commitment){
const commitment=Buffer.from(t.default_witness_commitment,'hex');
const cv=Buffer.alloc(8);
outs.push(Buffer.concat([cv,require('./block-builder').pushdata(commitment)]))}
return Buffer.concat([
Buffer.from([2,0,0,0]),
Buffer.from([0,1]),
Buffer.from([1]),
Buffer.alloc(32,0),
Buffer.alloc(4,255),
require('./block-builder').compactVarint(script.length),
script,
Buffer.alloc(4,255),
require('./block-builder').compactVarint(outs.length),
...outs,
Buffer.from([1]),
Buffer.from([32]),
Buffer.alloc(32),
Buffer.alloc(4,0)])}
}
module.exports=JobManager;
