'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const { verifyGoogleIdToken } = require('../lib/google-auth');
const { initSchema } = require('../lib/db');
const apiSessions = require('../lib/api-session');

async function main() {
  const db = new Database(':memory:');
  try {
    initSchema(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
    assert(tables.includes('account_identities'), 'verified account identity table exists');
    assert(tables.includes('api_sessions'), 'revocable API session table exists');
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row => row.name);
    assert(indexes.includes('idx_api_sessions_account'), 'session account index exists');
    db.prepare('INSERT INTO accounts (btc_address,created_at) VALUES (?,?)').run('bc1qtest', 1);
    db.prepare('INSERT INTO account_identities (account_id,google_id,email,verified_at) VALUES (1,?,?,?)')
      .run('google-subject', 'verified@example.test', 1);
    const token = apiSessions.createSession(db, 1, 'google-subject', 1000);
    assert.match(token, /^[a-f0-9]{64}$/, 'session token has 256 bits of hex entropy');
    assert.strictEqual(db.prepare('SELECT token_hash FROM api_sessions').get().token_hash, apiSessions.hashToken(token), 'database stores only token hash');
    assert.strictEqual(apiSessions.authenticate(db, token, { now: 2000, ttlMs: 5000 }).account_id, 1, 'verified session authenticates');
    assert.strictEqual(apiSessions.authenticate(db, token, { now: 7001, ttlMs: 5000 }), null, 'expired session is rejected');
    assert.strictEqual(db.prepare('SELECT count(*) AS n FROM api_sessions').get().n, 0, 'expired session is deleted');
    const revoked = apiSessions.createSession(db, 1, 'google-subject', 8000);
    apiSessions.revoke(db, revoked);
    assert.strictEqual(apiSessions.authenticate(db, revoked, { now: 8001 }), null, 'closed WebSocket session is revoked');
    assert.strictEqual(apiSessions.authenticate(db, 'not-a-token'), null, 'malformed token is rejected');
  } finally {
    db.close();
  }

  const missingConfig = await verifyGoogleIdToken('not-a-token', '');
  assert.strictEqual(missingConfig.valid, false, 'missing client id must fail closed');
  console.log('Wallet auth schema and fail-closed verification tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
