const path=require('path'),fs=require('fs'),Database=require('better-sqlite3');
const DATA_DIR=path.join(__dirname,'..','data');
const DB_PATH=path.join(DATA_DIR,'pool.db');
let _db=null;
function getDb(dbPath){
if(_db)return _db;
const p=dbPath||DB_PATH;
if(!fs.existsSync(path.dirname(p)))fs.mkdirSync(path.dirname(p),{recursive:true});
_db=new Database(p);
_db.pragma('journal_mode = WAL');
_db.pragma('foreign_keys = ON');
_db.pragma('busy_timeout = 5000');
initSchema(_db);
return _db}
function initSchema(db){
db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  account_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  btc_address   TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS miner_sessions (
  session_id    TEXT PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES accounts(account_id),
  connected_at  INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL,
  user_agent    TEXT
);
CREATE TABLE IF NOT EXISTS shares (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts(account_id),
  session_id    TEXT NOT NULL,
  job_id        TEXT NOT NULL,
  nonce         INTEGER NOT NULL,
  hash_hex      TEXT NOT NULL,
  difficulty    REAL NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shares_account ON shares(account_id);
CREATE INDEX IF NOT EXISTS idx_shares_created ON shares(created_at);
CREATE INDEX IF NOT EXISTS idx_shares_session ON shares(session_id);
CREATE TABLE IF NOT EXISTS blocks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts(account_id),
  session_id    TEXT NOT NULL,
  height        INTEGER NOT NULL,
  block_hash    TEXT,
  coinbase_value INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'submitted',
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS balances (
  account_id      INTEGER PRIMARY KEY REFERENCES accounts(account_id),
  confirmed_sat   INTEGER NOT NULL DEFAULT 0,
  pending_sat     INTEGER NOT NULL DEFAULT 0,
  total_earned_sat INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payouts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts(account_id),
  amount_sat    INTEGER NOT NULL,
  fee_sat       INTEGER NOT NULL DEFAULT 0,
  txid          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  error         TEXT,
  created_at    INTEGER NOT NULL,
  broadcast_at  INTEGER,
  confirmed_at  INTEGER,
  updated_at    INTEGER,
  completed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_payouts_account ON payouts(account_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL,
  account_id    INTEGER,
  amount_sat    INTEGER NOT NULL DEFAULT 0,
  details       TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_account ON audit_log(account_id);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_log(type);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE TABLE IF NOT EXISTS pool_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_identities (
  account_id      INTEGER PRIMARY KEY REFERENCES accounts(account_id),
  google_id       TEXT NOT NULL UNIQUE,
  email           TEXT,
  name            TEXT,
  verified_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_identity_google ON account_identities(google_id);
`);
try {
db.exec("ALTER TABLE payouts ADD COLUMN error TEXT");
} catch(e) {}
try {
db.exec("ALTER TABLE payouts ADD COLUMN broadcast_at INTEGER");
} catch(e) {}
try {
db.exec("ALTER TABLE payouts ADD COLUMN confirmed_at INTEGER");
} catch(e) {}
try {
db.exec("ALTER TABLE payouts ADD COLUMN updated_at INTEGER");
} catch(e) {}
}
function closeDb(){if(_db){_db.close();_db=null}}
function resetDb(){closeDb();_db=null}
module.exports={getDb,closeDb,resetDb,DB_PATH};
