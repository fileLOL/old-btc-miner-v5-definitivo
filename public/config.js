(function(){
var host=window.location.hostname;
if(host==='localhost'||host==='127.0.0.1'||host===''){
window.BACKEND_URL=window.BACKEND_URL||'ws://'+host+':'+window.location.port;
}else{
window.BACKEND_URL=window.BACKEND_URL||'wss://btc-miner-pool.onrender.com';
}})();
