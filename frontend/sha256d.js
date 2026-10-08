(function(g,f){ if(typeof module==='object'&&module.exports) module.exports=f(); else g.SHA256D=f(); })(typeof self!=='undefined'?self:this,function(){
'use strict';
const K=new Uint32Array([
0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
]);
const IV=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
const W=new Uint32Array(64),S=new Uint32Array(8),T=new Uint32Array(8),B=new Uint8Array(2048);
const MID=new Uint32Array(8),B2=new Uint8Array(64),B3=new Uint8Array(64);
function rotr(x,n){return(x>>>n)|(x<<(32-n));}
function ch(x,y,z){return(x&y)^(~x&z);}
function maj(x,y,z){return(x&y)^(x&z)^(y&z);}
function s0(x){return rotr(x,7)^rotr(x,18)^(x>>>3);}
function s1(x){return rotr(x,17)^rotr(x,19)^(x>>>10);}
function S0(x){return rotr(x,2)^rotr(x,13)^rotr(x,22);}
function S1(x){return rotr(x,6)^rotr(x,11)^rotr(x,25);}
function compress(buf,off,h){
for(let i=0;i<16;i++){let p=off+(i<<2);W[i]=((buf[p]<<24)|(buf[p+1]<<16)|(buf[p+2]<<8)|buf[p+3])>>>0;}
for(let i=16;i<64;i++)W[i]=(s1(W[i-2])+W[i-7]+s0(W[i-15])+W[i-16])>>>0;
let a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
for(let i=0;i<64;i++){let q=(hh+S1(e)+ch(e,f,g)+K[i]+W[i])>>>0;let r=(S0(a)+maj(a,b,c))>>>0;hh=g;g=f;f=e;e=(d+q)>>>0;d=c;c=b;b=a;a=(q+r)>>>0;}
h[0]=(h[0]+a)>>>0;h[1]=(h[1]+b)>>>0;h[2]=(h[2]+c)>>>0;h[3]=(h[3]+d)>>>0;h[4]=(h[4]+e)>>>0;h[5]=(h[5]+f)>>>0;h[6]=(h[6]+g)>>>0;h[7]=(h[7]+hh)>>>0;
}
function sha256(msg){let n=msg.length,L=((n+9+63)>>6)<<6;B.fill(0,0,L);B.set(msg);B[n]=0x80;let bits=n*8;B[L-4]=(bits>>>24)&255;B[L-3]=(bits>>>16)&255;B[L-2]=(bits>>>8)&255;B[L-1]=bits&255;S.set(IV);for(let o=0;o<L;o+=64)compress(B,o,S);let out=new Uint8Array(32);for(let i=0;i<8;i++){let x=S[i],p=i*4;out[p]=x>>>24;out[p+1]=x>>>16;out[p+2]=x>>>8;out[p+3]=x;}return out;}
function d(msg){let n=msg.length,L=((n+9+63)>>6)<<6;B.fill(0,0,L);B.set(msg);B[n]=0x80;let bits=n*8;B[L-4]=(bits>>>24)&255;B[L-3]=(bits>>>16)&255;B[L-2]=(bits>>>8)&255;B[L-1]=bits&255;S.set(IV);for(let o=0;o<L;o+=64)compress(B,o,S);let first=new Uint8Array(32);for(let i=0;i<8;i++){let x=S[i],p=i*4;first[p]=x>>>24;first[p+1]=x>>>16;first[p+2]=x>>>8;first[p+3]=x;}B.fill(0,0,64);B.set(first);B[32]=0x80;B[62]=1;B[63]=0;S.set(IV);compress(B,0,S);let out=new Uint8Array(32);for(let i=0;i<8;i++){let x=S[i],p=i*4;out[p]=x>>>24;out[p+1]=x>>>16;out[p+2]=x>>>8;out[p+3]=x;}return out;}
function hex(bytes){let s='';for(let i=0;i<bytes.length;i++)s+=(bytes[i]>>>4).toString(16)+(bytes[i]&15).toString(16);return s;}
function fromHex(h){let a=new Uint8Array(h.length/2);for(let i=0;i<a.length;i++)a[i]=parseInt(h.slice(i*2,i*2+2),16);return a;}
function hash80(header,nonce){
B.fill(0,0,128);B.set(header,0);
B[76]=nonce&255;B[77]=(nonce>>>8)&255;B[78]=(nonce>>>16)&255;B[79]=(nonce>>>24)&255;
B[80]=0x80;B[126]=2;B[127]=0x80;
S.set(IV);compress(B,0,S);
for(let i=0;i<8;i++)T[i]=S[i];
compress(B,64,T);
let first=new Uint8Array(32);
for(let i=0;i<8;i++){let x=T[i],p=i*4;first[p]=x>>>24;first[p+1]=x>>>16;first[p+2]=x>>>8;first[p+3]=x;}
B.fill(0,0,64);B.set(first);B[32]=0x80;B[62]=1;B[63]=0;
S.set(IV);compress(B,0,S);
let out=new Uint8Array(32);
for(let i=0;i<8;i++){let x=S[i],p=i*4;out[p]=x>>>24;out[p+1]=x>>>16;out[p+2]=x>>>8;out[p+3]=x;}
return out;
}
function computeMidstate(header){
const h=new Uint32Array(8);h.set(IV);
const buf=header instanceof Uint8Array?header:new Uint8Array(header);
compress(buf,0,h);
return h;
}
function initJob(header,mid){
for(let i=0;i<12;i++)B2[i]=header[64+i];
B2[16]=0x80;B2[62]=2;B2[63]=0x80;
B3[32]=0x80;B3[62]=1;B3[63]=0;
for(let i=0;i<8;i++)MID[i]=mid[i];
}
function hashms(nonce){
B2[12]=nonce&255;B2[13]=(nonce>>>8)&255;B2[14]=(nonce>>>16)&255;B2[15]=(nonce>>>24)&255;
S[0]=MID[0];S[1]=MID[1];S[2]=MID[2];S[3]=MID[3];
S[4]=MID[4];S[5]=MID[5];S[6]=MID[6];S[7]=MID[7];
compress(B2,0,S);
for(let i=0;i<8;i++){let x=S[i],p=i*4;B3[p]=x>>>24;B3[p+1]=x>>>16;B3[p+2]=x>>>8;B3[p+3]=x;}
S[0]=IV[0];S[1]=IV[1];S[2]=IV[2];S[3]=IV[3];
S[4]=IV[4];S[5]=IV[5];S[6]=IV[6];S[7]=IV[7];
compress(B3,0,S);
return S;
}
function meets32(h32,targetBytes){
for(let i=0;i<8;i++){
let p=i*4;
let t=((targetBytes[p]<<24)|(targetBytes[p+1]<<16)|(targetBytes[p+2]<<8)|targetBytes[p+3])>>>0;
if(h32[i]<t)return true;
if(h32[i]>t)return false;
}
return true;
}
function stateToBytes(st){
let out=new Uint8Array(32);
for(let i=0;i<8;i++){let x=st[i],p=i*4;out[p]=x>>>24;out[p+1]=x>>>16;out[p+2]=x>>>8;out[p+3]=x;}
return out;
}
function le32(n){return new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);}
function targetFromBits(bits){let b=fromHex(bits),e=b[0],m=(b[1]<<16)|(b[2]<<8)|b[3],t=new Uint8Array(32);if(e<=3){let v=m>>>((3-e)*8);t[29]=v>>>16;t[30]=v>>>8;t[31]=v;}else{let p=32-e;if(p+3<=32){t[p]=m>>>16;t[p+1]=m>>>8;t[p+2]=m;}}return t;}
function meets(hash,target){for(let i=0;i<32;i++){if(hash[i]<target[i])return true;if(hash[i]>target[i])return false;}return true;}
function verifyK(){
const primes=[];for(let n=2;primes.length<64;n++){let ok=true;for(let d=2;d*d<=n;d++)if(n%d===0){ok=false;break;}if(ok)primes.push(n);}
for(let i=0;i<64;i++){const p=primes[i];const cbrt=Math.cbrt(p);const frac=cbrt-Math.floor(cbrt);const expected=Math.floor(frac*4294967296)>>>0;if(K[i]!==expected)return{ok:false,idx:i,expected:expected,actual:K[i]};}
return{ok:true};
}
function verifyIV(){
const primes=[];for(let n=2;primes.length<8;n++){let ok=true;for(let d=2;d*d<=n;d++)if(n%d===0){ok=false;break;}if(ok)primes.push(n);}
for(let i=0;i<8;i++){const p=primes[i];const sqrt=Math.sqrt(p);const frac=sqrt-Math.floor(sqrt);const expected=Math.floor(frac*4294967296)>>>0;if(IV[i]!==expected)return{ok:false,idx:i,expected:expected,actual:IV[i]};}
return{ok:true};
}
return{K,IV,W,S,T,B,W64:W,sha256,d,hash80,hex,fromHex,le32,targetFromBits,meets,compress,computeMidstate,initJob,hashms,meets32,stateToBytes,verifyK,verifyIV};
});