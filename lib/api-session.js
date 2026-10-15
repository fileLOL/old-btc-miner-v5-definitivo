'use strict';

const crypto = require('crypto');

function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

function createSession(db, accountId, googleId, now = Date.now()) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO api_sessions (token_hash,account_id,google_id,created_at,last_seen) VALUES (?,?,?,?,?)')
    .run(hashToken(token), accountId, googleId, now, now);
  return token;
}

function authenticate(db, token, { now = Date.now(), ttlMs = 24 * 60 * 60 * 1000 } = {}) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = hashToken(token);
  const session = db.prepare(`SELECT s.account_id, s.google_id, s.last_seen FROM api_sessions s
    JOIN account_identities i ON i.account_id=s.account_id AND i.google_id=s.google_id
    WHERE s.token_hash=?`).get(tokenHash);
  if (!session || now - session.last_seen > ttlMs) {
    db.prepare('DELETE FROM api_sessions WHERE token_hash=?').run(tokenHash);
    return null;
  }
  db.prepare('UPDATE api_sessions SET last_seen=? WHERE token_hash=?').run(now, tokenHash);
  return session;
}

function revoke(db, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return;
  db.prepare('DELETE FROM api_sessions WHERE token_hash=?').run(hashToken(token));
}

module.exports = { createSession, authenticate, revoke, hashToken };
