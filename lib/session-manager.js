const crypto = require('crypto');

class SessionManager {
  constructor(opts) {
    opts = opts || {};
    this.sessions = new Map();
    this.maxAge = opts.maxAge || 24 * 60 * 60 * 1000;
    this.cleanupInterval = setInterval(() => this.cleanup(), opts.cleanupInterval || 5 * 60 * 1000);
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  createSession(accountId, googleId) {
    if (!accountId || typeof accountId !== 'number') {
      throw new Error('accountId required');
    }
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    this.sessions.set(token, { accountId, googleId: googleId || null, createdAt: now, lastSeen: now });
    return token;
  }

  validateSession(token) {
    if (!token || typeof token !== 'string' || token.length !== 64) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() - session.lastSeen > this.maxAge) {
      this.sessions.delete(token);
      return null;
    }
    return session.accountId;
  }

  validateSessionFull(token) {
    if (!token || typeof token !== 'string' || token.length !== 64) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() - session.lastSeen > this.maxAge) {
      this.sessions.delete(token);
      return null;
    }
    return { accountId: session.accountId, googleId: session.googleId };
  }

  touchSession(token) {
    if (!token || typeof token !== 'string') return;
    const session = this.sessions.get(token);
    if (session) session.lastSeen = Date.now();
  }

  destroySession(token) {
    if (!token || typeof token !== 'string') return;
    this.sessions.delete(token);
  }

  destroyAccountSessions(accountId) {
    if (!accountId || typeof accountId !== 'number') return;
    for (const [token, session] of this.sessions) {
      if (session.accountId === accountId) this.sessions.delete(token);
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (now - session.lastSeen > this.maxAge) {
        this.sessions.delete(token);
      }
    }
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.sessions.clear();
  }

  getSessionCount() {
    return this.sessions.size;
  }

  getAccountTokenCount(accountId) {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.accountId === accountId) count++;
    }
    return count;
  }
}

module.exports = SessionManager;
