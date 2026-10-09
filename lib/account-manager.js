const{getDb}=require('./db');
const{validateAddress}=require('./address-validator');
function normalizeAddress(btcAddress){
const trimmed=btcAddress.trim();
if(trimmed.toLowerCase().startsWith('bc1'))return trimmed.toLowerCase();
return trimmed}
function getOrCreateAccount(btcAddress){
if(!btcAddress||typeof btcAddress!=='string')throw new Error('btcAddress required');
const normalized=normalizeAddress(btcAddress);
const validation=validateAddress(normalized);
if(!validation.valid)throw new Error('Invalid Bitcoin address: '+validation.error);
const db=getDb();
const existing=db.prepare('SELECT account_id, btc_address, created_at FROM accounts WHERE btc_address = ?').get(normalized);
if(existing)return{account_id:existing.account_id,btc_address:existing.btc_address,created_at:existing.created_at,isNew:false};
const now=Date.now();
const insertAccount=db.prepare('INSERT INTO accounts (btc_address, created_at) VALUES (?, ?)');
const insertBalance=db.prepare('INSERT INTO balances (account_id, confirmed_sat, pending_sat, total_earned_sat, updated_at) VALUES (?, 0, 0, 0, ?)');
const tx=db.transaction(()=>{
const info=insertAccount.run(normalized,now);
insertBalance.run(info.lastInsertRowid,now);});
tx();
const created=db.prepare('SELECT account_id, btc_address, created_at FROM accounts WHERE btc_address = ?').get(normalized);
return{account_id:created.account_id,btc_address:created.btc_address,created_at:created.created_at,isNew:true}}
function getAccount(accountId){
if(!accountId||typeof accountId!=='number')return null;
const db=getDb();
return db.prepare('SELECT account_id, btc_address, created_at FROM accounts WHERE account_id = ?').get(accountId)||null}
function getAccountByAddress(btcAddress){
if(!btcAddress||typeof btcAddress!=='string')return null;
const db=getDb();
const normalized=normalizeAddress(btcAddress);
return db.prepare('SELECT account_id, btc_address, created_at FROM accounts WHERE btc_address = ?').get(normalized)||null}
function getBalance(accountId){
if(!accountId||typeof accountId!=='number')return null;
const db=getDb();
return db.prepare('SELECT * FROM balances WHERE account_id = ?').get(accountId)||null}
function createSession(sessionId,accountId,userAgent){
const db=getDb();
const now=Date.now();
db.prepare('INSERT INTO miner_sessions (session_id, account_id, connected_at, last_seen, user_agent) VALUES (?, ?, ?, ?, ?)').run(sessionId,accountId,now,now,userAgent||null)}
function updateSessionLastSeen(sessionId){
const db=getDb();
db.prepare('UPDATE miner_sessions SET last_seen = ? WHERE session_id = ?').run(Date.now(),sessionId)}
function getSession(sessionId){
const db=getDb();
return db.prepare('SELECT * FROM miner_sessions WHERE session_id = ?').get(sessionId)||null}
function deleteSession(sessionId){
const db=getDb();
db.prepare('DELETE FROM miner_sessions WHERE session_id = ?').run(sessionId)}
function insertShare(accountId,sessionId,jobId,nonce,hashHex,difficulty){
const db=getDb();
const now=Date.now();
db.prepare('INSERT INTO shares (account_id, session_id, job_id, nonce, hash_hex, difficulty, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(accountId,sessionId,jobId,nonce,hashHex,difficulty,now)}
function getSharesByAccount(accountId,limit){
const db=getDb();
return db.prepare('SELECT * FROM shares WHERE account_id = ? ORDER BY created_at DESC LIMIT ?').all(accountId,limit||100)}
function getShareCountByAccount(accountId){
const db=getDb();
const row=db.prepare('SELECT COUNT(*) as total FROM shares WHERE account_id = ?').get(accountId);
return row?row.total:0}
function getSharesBySession(sessionId){
const db=getDb();
return db.prepare('SELECT * FROM shares WHERE session_id = ? ORDER BY created_at DESC').all(sessionId)}
function getShareCountBySession(sessionId){
const db=getDb();
const row=db.prepare('SELECT COUNT(*) as total FROM shares WHERE session_id = ?').get(sessionId);
return row?row.total:0}
function insertBlock(accountId,sessionId,height,coinbaseValue,blockHash){
const db=getDb();
const now=Date.now();
const info=db.prepare('INSERT INTO blocks (account_id, session_id, height, coinbase_value, block_hash, status, created_at) VALUES (?, ?, ?, ?, ?, \'submitted\', ?)').run(accountId,sessionId,height,coinbaseValue,blockHash||null,now);
return{blockId:info.lastInsertRowid}}
function setBlockHash(blockId,blockHash){
const db=getDb();
db.prepare('UPDATE blocks SET block_hash = ? WHERE id = ?').run(blockHash,blockId)}
function getBlocksByAccount(accountId){
const db=getDb();
return db.prepare('SELECT * FROM blocks WHERE account_id = ? ORDER BY created_at DESC').all(accountId)}
function getAllBlocks(){
const db=getDb();
return db.prepare('SELECT * FROM blocks ORDER BY created_at DESC').all()}

function createIdentity(accountId, googleId, email, name) {
if (!accountId || typeof accountId !== 'number') throw new Error('accountId required');
if (!googleId || typeof googleId !== 'string') throw new Error('googleId required');
const db = getDb();
const existing = db.prepare('SELECT account_id FROM account_identities WHERE account_id = ?').get(accountId);
if (existing) throw new Error('identity already exists for this account');
const googleExisting = db.prepare('SELECT account_id FROM account_identities WHERE google_id = ?').get(googleId);
if (googleExisting) throw new Error('google_id already linked to another account');
const now = Date.now();
db.prepare('INSERT INTO account_identities (account_id, google_id, email, name, verified_at) VALUES (?, ?, ?, ?, ?)').run(accountId, googleId, email || null, name || null, now);
return { account_id: accountId, google_id: googleId, email: email || null, name: name || null, verified_at: now };
}

function getIdentityByAccountId(accountId) {
if (!accountId || typeof accountId !== 'number') return null;
const db = getDb();
return db.prepare('SELECT * FROM account_identities WHERE account_id = ?').get(accountId) || null;
}

function getIdentityByGoogleId(googleId) {
if (!googleId || typeof googleId !== 'string') return null;
const db = getDb();
return db.prepare('SELECT * FROM account_identities WHERE google_id = ?').get(googleId) || null;
}

function isAccountVerified(accountId) {
const identity = getIdentityByAccountId(accountId);
return identity !== null;
}

module.exports={getOrCreateAccount,getAccount,getAccountByAddress,getBalance,createSession,updateSessionLastSeen,getSession,deleteSession,insertShare,getSharesByAccount,getShareCountByAccount,getSharesBySession,getShareCountBySession,insertBlock,setBlockHash,getBlocksByAccount,getAllBlocks,createIdentity,getIdentityByAccountId,getIdentityByGoogleId,isAccountVerified};
