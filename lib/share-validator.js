const SHA256D=require('../public/sha256d.js');
class ShareValidator{
constructor(jobManager){this.jobManager=jobManager;this.seenShares=new Set();this.maxSeen=10000}
validate(share){
const{minerId,jobId,nonce,hashHex}=share;
if(!minerId||typeof minerId!=='string'||minerId.length>64)return{valid:false,error:'invalid minerId'}
if(!jobId||typeof jobId!=='string')return{valid:false,error:'invalid jobId'}
if(typeof nonce!=='number'||nonce<0||nonce>0xFFFFFFFF||!Number.isInteger(nonce))return{valid:false,error:'invalid nonce'}
if(!hashHex||typeof hashHex!=='string'||!/^[0-9a-f]{64}$/.test(hashHex))return{valid:false,error:'invalid hashHex'}
const dedupKey=jobId+':'+nonce;
if(this.seenShares.has(dedupKey))return{valid:false,error:'duplicate share',stale:false}
const job=this.jobManager.getJob(jobId);
if(!job)return{valid:false,error:'job not found',stale:false}
if(job.stale)return{valid:false,error:'stale job',stale:true}
const header=new Uint8Array(job.header);
const recalcHash=SHA256D.hash80(header,nonce);
const recalcHex=SHA256D.hex(recalcHash);
if(recalcHex!==hashHex)return{valid:false,error:'hash mismatch (server recalc differs from claim)',stale:false}
const meetsShare=SHA256D.meets(recalcHash,new Uint8Array(job.shareTarget));
const meetsBlock=SHA256D.meets(recalcHash,new Uint8Array(job.blockTarget));
this.seenShares.add(dedupKey);
this.cleanupSeen();
return{valid:true,meetsShareTarget:meetsShare,meetsBlockTarget:meetsBlock,hashHex:recalcHex,jobId,nonce,minerId,stale:false}}
cleanupSeen(){
if(this.seenShares.size<=this.maxSeen)return;
const staleKeys=[];
for(const key of this.seenShares){
const jobId=key.substring(0,key.lastIndexOf(':'));
const job=this.jobManager.getJob(jobId);
if(!job||job.stale)staleKeys.push(key)}
for(const k of staleKeys)this.seenShares.delete(k);
if(this.seenShares.size>this.maxSeen){
const arr=[...this.seenShares];
const toDelete=arr.slice(0,arr.length-this.maxSeen);
for(const k of toDelete)this.seenShares.delete(k)}}
clearSeenForJob(jobId){
for(const key of this.seenShares){
if(key.startsWith(jobId+':'))this.seenShares.delete(key)}}
validateBlock(blockHex,jobId){
if(!blockHex||typeof blockHex!=='string')return{valid:false,error:'invalid block hex'}
if(!/^[0-9a-fA-F]+$/.test(blockHex)||blockHex.length<160||blockHex.length%2)return{valid:false,error:'invalid block format'}
const job=this.jobManager.getJob(jobId);
if(!job)return{valid:false,error:'job not found'}
if(job.stale)return{valid:false,error:'stale job'}
return{valid:true,blockHex,jobId}}
}
module.exports=ShareValidator;
