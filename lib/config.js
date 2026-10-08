const fs=require('fs'),path=require('path');
const envPath=path.join(__dirname,'..','.env');
let env={};
if(fs.existsSync(envPath)){
const content=fs.readFileSync(envPath,'utf8');
content.split('\n').forEach(line=>{
const trimmed=line.trim();
if(trimmed&&!trimmed.startsWith('#')){
const idx=trimmed.indexOf('=');
if(idx>0){
const key=trimmed.slice(0,idx).trim();
const val=trimmed.slice(idx+1).trim();
env[key]=val}}})}

const defaultCli='bitcoin-cli';
const rpcArgs=[];
if(process.env.BITCOIN_DATADIR||env.BITCOIN_DATADIR)rpcArgs.push('-datadir='+(process.env.BITCOIN_DATADIR||env.BITCOIN_DATADIR));
if(process.env.BITCOIN_RPC_HOST||env.BITCOIN_RPC_HOST)rpcArgs.push('-rpcconnect='+(process.env.BITCOIN_RPC_HOST||env.BITCOIN_RPC_HOST));
if(process.env.BITCOIN_RPC_PORT||env.BITCOIN_RPC_PORT)rpcArgs.push('-rpcport='+(process.env.BITCOIN_RPC_PORT||env.BITCOIN_RPC_PORT));
if(process.env.BITCOIN_RPC_USER||env.BITCOIN_RPC_USER)rpcArgs.push('-rpcuser='+(process.env.BITCOIN_RPC_USER||env.BITCOIN_RPC_USER));
if(process.env.BITCOIN_RPC_PASSWORD||env.BITCOIN_RPC_PASSWORD)rpcArgs.push('-rpcpassword='+(process.env.BITCOIN_RPC_PASSWORD||env.BITCOIN_RPC_PASSWORD));
if(process.env.BITCOIN_RPC_WALLET||env.BITCOIN_RPC_WALLET)rpcArgs.push('-rpcwallet='+(process.env.BITCOIN_RPC_WALLET||env.BITCOIN_RPC_WALLET));
if(process.env.BITCOIN_COOKIE_FILE||env.BITCOIN_COOKIE_FILE)rpcArgs.push('-rpccookiefile='+(process.env.BITCOIN_COOKIE_FILE||env.BITCOIN_COOKIE_FILE));
const RPC_EXTRA=rpcArgs.join(' ');

// HTTP RPC config for server-render.js (direct HTTP to Bitcoin Core)
const BITCOIN_RPC_URL=process.env.BITCOIN_RPC_URL||env.BITCOIN_RPC_URL||'http://127.0.0.1:8332';
const BITCOIN_RPC_USER=process.env.BITCOIN_RPC_USER||env.BITCOIN_RPC_USER||'btcpool';
const BITCOIN_RPC_PASSWORD=process.env.BITCOIN_RPC_PASSWORD||env.BITCOIN_RPC_PASSWORD||'';

module.exports={
BITCOIN_CLI:process.env.BITCOIN_CLI||env.BITCOIN_CLI||(fs.existsSync('C:\\Program Files\\Bitcoin\\daemon\\bitcoin-cli.exe')?'C:\\Program Files\\Bitcoin\\daemon\\bitcoin-cli.exe':defaultCli),
RPC_EXTRA,
BITCOIN_RPC_URL,
BITCOIN_RPC_USER,
BITCOIN_RPC_PASSWORD,
PAYOUT_ADDRESS:process.env.PAYOUT_ADDRESS||env.PAYOUT_ADDRESS||'',
SHARE_DIFFICULTY:parseFloat(process.env.SHARE_DIFFICULTY||env.SHARE_DIFFICULTY||'268435456'),
PORT:parseInt(process.env.PORT||env.PORT||'3000',10),
CORS_ORIGIN:process.env.CORS_ORIGIN||env.CORS_ORIGIN||'*',
MAX_MINERS:parseInt(process.env.MAX_MINERS||env.MAX_MINERS||'100',10),
TEMPLATE_REFRESH_MS:parseInt(process.env.TEMPLATE_REFRESH_MS||env.TEMPLATE_REFRESH_MS||'30000',10),
JOB_TIMEOUT_MS:parseInt(process.env.JOB_TIMEOUT_MS||env.JOB_TIMEOUT_MS||'120000',10),
POOL_FEE_PERCENT:parseFloat(process.env.POOL_FEE_PERCENT||env.POOL_FEE_PERCENT||'2'),
PPLNS_WINDOW_SIZE:parseInt(process.env.PPLNS_WINDOW_SIZE||env.PPLNS_WINDOW_SIZE||'10000',10),
MIN_PAYOUT_SAT:parseInt(process.env.MIN_PAYOUT_SAT||env.MIN_PAYOUT_SAT||'50000',10),
MAX_PAYOUT_SAT:parseInt(process.env.MAX_PAYOUT_SAT||env.MAX_PAYOUT_SAT||'100000000',10),
PAYOUT_INTERVAL_MS:parseInt(process.env.PAYOUT_INTERVAL_MS||env.PAYOUT_INTERVAL_MS||'3600000',10),
PAYOUT_MONITOR_INTERVAL_MS:parseInt(process.env.PAYOUT_MONITOR_INTERVAL_MS||env.PAYOUT_MONITOR_INTERVAL_MS||'300000',10),
PAYOUT_PENDING_TIMEOUT_MS:parseInt(process.env.PAYOUT_PENDING_TIMEOUT_MS||env.PAYOUT_PENDING_TIMEOUT_MS||'3600000',10),
PAYOUT_DRY_RUN:process.env.PAYOUT_DRY_RUN===undefined?(env.PAYOUT_DRY_RUN===undefined?true:env.PAYOUT_DRY_RUN==='true'):process.env.PAYOUT_DRY_RUN==='true',
ENABLE_REAL_PAYOUT_TEST:process.env.ENABLE_REAL_PAYOUT_TEST===undefined?(env.ENABLE_REAL_PAYOUT_TEST===undefined?false:env.ENABLE_REAL_PAYOUT_TEST==='true'):process.env.ENABLE_REAL_PAYOUT_TEST==='true',
TEST_PAYOUT_ADDRESS:process.env.TEST_PAYOUT_ADDRESS||env.TEST_PAYOUT_ADDRESS||'',
TEST_PAYOUT_SAT:parseInt(process.env.TEST_PAYOUT_SAT||env.TEST_PAYOUT_SAT||'50000',10),
TEST_PAYOUT_DB_PATH:process.env.TEST_PAYOUT_DB_PATH||env.TEST_PAYOUT_DB_PATH||path.join(__dirname,'..','data','test-payout.db'),
BLOCK_MONITOR_MS:parseInt(process.env.BLOCK_MONITOR_MS||env.BLOCK_MONITOR_MS||'30000',10),
COINBASE_MATURITY:parseInt(process.env.COINBASE_MATURITY||env.COINBASE_MATURITY||'100',10),
STRATUM_PORT:parseInt(process.env.STRATUM_PORT||env.STRATUM_PORT||'3333',10),
STRATUM_MIN_DIFFICULTY:parseFloat(process.env.STRATUM_MIN_DIFFICULTY||env.STRATUM_MIN_DIFFICULTY||'1000'),
STRATUM_EXTRANONCE1_SIZE:parseInt(process.env.STRATUM_EXTRANONCE1_SIZE||env.STRATUM_EXTRANONCE1_SIZE||'4',10),
STRATUM_EXTRANONCE2_SIZE:parseInt(process.env.STRATUM_EXTRANONCE2_SIZE||env.STRATUM_EXTRANONCE2_SIZE||'4',10),
STRATUM_BROADCAST_MS:parseInt(process.env.STRATUM_BROADCAST_MS||env.STRATUM_BROADCAST_MS||'5000',10),
POOL_PUBLIC_HOST:process.env.POOL_PUBLIC_HOST||env.POOL_PUBLIC_HOST||'',
STRATUM_POOL_HOST:process.env.STRATUM_POOL_HOST||env.STRATUM_POOL_HOST||'btc.f2pool.com',
STRATUM_POOL_PORT:process.env.STRATUM_POOL_PORT||env.STRATUM_POOL_PORT||'3333',
STRATUM_USE_TLS:process.env.STRATUM_USE_TLS||env.STRATUM_USE_TLS||'false',
STRATUM_WORKER_NAME:process.env.STRATUM_WORKER_NAME||env.STRATUM_WORKER_NAME||'render-worker',
STRATUM_WORKER_PASSWORD:process.env.STRATUM_WORKER_PASSWORD||env.STRATUM_WORKER_PASSWORD||'x',
STRATUM_INTERNAL_MINERS:process.env.STRATUM_INTERNAL_MINERS||env.STRATUM_INTERNAL_MINERS||'true',
STRATUM_MINER_THREADS:process.env.STRATUM_MINER_THREADS||env.STRATUM_MINER_THREADS||'4'
};
