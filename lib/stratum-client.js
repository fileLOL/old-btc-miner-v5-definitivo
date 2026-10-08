const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const SHA256D = require('../public/sha256d.js');
const MAX_TARGET = Buffer.from('00000000ffff0000000000000000000000000000000000000000000000000000', 'hex');

const LOG_FILE = path.join(__dirname, '..', 'data', 'pool-events.log');
const MAX_RECONNECT_ATTEMPTS = 50;

function logPool(msg, data) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}\n`;
  console.log('[Stratum]', msg, data || '');
  try {
    if (!fs.existsSync(path.dirname(LOG_FILE))) {
      fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    }
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {}
}

class StratumClient {
  constructor(config, jobManager) {
    this.config = config;
    this.jobManager = jobManager;
    this.poolHost = config.STRATUM_POOL_HOST || 'btc.f2pool.com';
    this.poolPort = parseInt(config.STRATUM_POOL_PORT || '3333', 10);
    this.useTLS = config.STRATUM_USE_TLS === 'true' || config.STRATUM_USE_TLS === true;
    this.workerName = config.STRATUM_WORKER_NAME || 'render-worker';
    this.workerPass = config.STRATUM_WORKER_PASSWORD || 'x';
    this.payoutAddress = (config.PAYOUT_ADDRESS || '').trim();

    this.socket = null;
    this.connected = false;
    this.authorized = false;
    this.rpcId = 0;
    this.pendingRpcs = new Map();
    this.buffer = '';
    this.extranonce1 = '';
    this.extranonce1Size = 0;
    this.extranonce2Size = 4;
    this.currentDifficulty = 1;
    this.shareTarget = null;
    this.miners = [];
    this.mining = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.lastExtranonce2 = 0;
    this.stats = {
      sharesSubmitted: 0,
      sharesAccepted: 0,
      sharesRejected: 0,
      blocksFound: 0,
      connectTime: null
    };

    this.onNewJob = null;
    this.onShare = null;
    this.onBlock = null;
    this.onStatus = null;

    this.validateConfig();
  }

  validateConfig() {
    if (!this.payoutAddress || this.payoutAddress.length < 26) {
      logPool('WARNING: PAYOUT_ADDRESS is empty or too short. Pool authorization will likely fail.');
    }
    logPool('Configuration', {
      host: this.poolHost,
      port: this.poolPort,
      tls: this.useTLS,
      worker: this.workerName,
      payout: this.payoutAddress ? this.payoutAddress.substring(0, 10) + '...' : 'EMPTY',
      internalMiners: this.config.STRATUM_INTERNAL_MINERS
    });
  }

  getNextExtranonce2() {
    this.lastExtranonce2 = (this.lastExtranonce2 + 1) >>> 0;
    return this.lastExtranonce2.toString(16).padStart(8, '0');
  }

  connect() {
    if (this.socket && this.socket.readyState === 'open') return;

    if (!this.payoutAddress || this.payoutAddress.length < 26) {
      logPool('Cannot connect: PAYOUT_ADDRESS not configured');
      return;
    }

    this.buffer = '';
    logPool('Connecting...', { host: this.poolHost, port: this.poolPort, tls: this.useTLS });

    if (this.useTLS) {
      this.socket = tls.connect({
        host: this.poolHost,
        port: this.poolPort,
        rejectUnauthorized: false
      });
    } else {
      this.socket = new net.Socket();
      this.socket.connect(this.poolPort, this.poolHost);
    }

    this.socket.on('connect', () => {
      logPool('TCP connected');
      this.connected = true;
      this.reconnectAttempts = 0;
      this.stats.connectTime = Date.now();
      if (this.onStatus) this.onStatus('connected');
      this.subscribe();
    });

    this.socket.on('data', (data) => {
      this.buffer += data.toString();
      let newline;
      while ((newline = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.substring(0, newline).trim();
        this.buffer = this.buffer.substring(newline + 1);
        if (line) this.handleMessage(line);
      }
    });

    this.socket.on('close', () => {
      logPool('Disconnected');
      this.connected = false;
      this.authorized = false;
      this.stopMiners();
      if (this.onStatus) this.onStatus('disconnected');
      this.scheduleReconnect();
    });

    this.socket.on('error', (err) => {
      logPool('Socket error', { message: err.message, code: err.code });
      this.connected = false;
    });
  }

  disconnect() {
    logPool('Manual disconnect');
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopMiners();
    if (this.socket) { try { this.socket.destroy(); } catch (e) {} this.socket = null; }
    this.connected = false;
    this.authorized = false;
  }

  send(line) {
    if (this.socket && this.connected) {
      try {
        this.socket.write(line + '\n');
      } catch (e) {
        logPool('Send error', { message: e.message });
      }
    }
  }

  rpc(method, params, callback) {
    const id = ++this.rpcId;
    if (callback) this.pendingRpcs.set(id, callback);
    this.send(JSON.stringify({ id, method, params }));
  }

  subscribe() {
    this.rpc('mining.subscribe', ['old-btc-miner-v5/5.1.1'], (result) => {
      logPool('Subscribe response', result);
      if (result && result[1]) {
        this.extranonce1 = result[1];
        this.extranonce1Size = result[1].length / 2;
      }
      if (result && result[2]) {
        this.extranonce2Size = result[2];
      }
      logPool('Extranonce', { en1: this.extranonce1, en1Size: this.extranonce1Size, en2Size: this.extranonce2Size });
      this.authorize();
    });
  }

  authorize() {
    const worker = this.payoutAddress + '.' + this.workerName;
    logPool('Authorizing', { worker: worker.substring(0, 15) + '...' });
    this.rpc('mining.authorize', [worker, this.workerPass], (result, error) => {
      this.authorized = result === true || result === 'ok' || (result && result.authorized);
      if (this.authorized) {
        logPool('Authorized successfully', { worker: worker.substring(0, 15) + '...' });
      } else {
        logPool('Authorization FAILED', { result: result, error: error });
      }
    });
  }

  handleMessage(line) {
    let msg;
    try { msg = JSON.parse(line); } catch (e) { return; }

    if (msg.id !== undefined && this.pendingRpcs.has(msg.id)) {
      const cb = this.pendingRpcs.get(msg.id);
      this.pendingRpcs.delete(msg.id);
      if (msg.error) {
        logPool('RPC error', { id: msg.id, error: JSON.stringify(msg.error) });
      }
      if (cb) cb(msg.result, msg.error);
      return;
    }

    if (msg.method === 'mining.notify') {
      this.handleNotify(msg.params);
    } else if (msg.method === 'mining.set_difficulty') {
      if (msg.params && msg.params[0] !== undefined) {
        this.currentDifficulty = msg.params[0];
        this.shareTarget = this.computeShareTarget(this.currentDifficulty);
        logPool('Pool difficulty set', { difficulty: this.currentDifficulty });
        logPool('Share target computed', {
          hex: Buffer.from(this.shareTarget).toString('hex').substring(0, 20) + '...'
        });
      }
    } else if (msg.method === 'client.reconnect') {
      const delay = msg.params && msg.params[2] ? msg.params[2] : 5;
      logPool('Pool requests reconnect', { delay: delay + 's' });
      setTimeout(() => this.disconnect(), 1000);
      setTimeout(() => this.connect(), (delay + 1) * 1000);
    }
  }

  handleNotify(params) {
    if (!params || params.length < 8) {
      logPool('Invalid notify params', { count: params ? params.length : 0 });
      return;
    }
    const [jobId, prevhash, coinb1, coinb2, merkleBranches, version, nbits, ntime, cleanJobs] = params;

    logPool('New job received', {
      jobId: jobId,
      branches: merkleBranches.length,
      coinb1Len: coinb1.length,
      coinb2Len: coinb2.length,
      clean: cleanJobs
    });

    if (cleanJobs) {
      this.jobManager.staleAll();
      this.stopMiners();
    }

    const job = this.assembleJob(jobId, prevhash, coinb1, coinb2, merkleBranches, version, nbits, ntime);
    if (job) {
      this.jobManager.setStratumJob(job);
      if (this.onNewJob) this.onNewJob(job);
      logPool('Job dispatched', {
        jobId: job.jobId,
        height: job.height,
        coinbase: job.coinbasevalue ? (job.coinbasevalue / 1e8).toFixed(8) + ' BTC' : 'N/A'
      });
      if (this.config.STRATUM_INTERNAL_MINERS !== 'false') {
        this.startMiners(job);
      }
    }
  }

  assembleJob(jobId, prevhash, coinb1, coinb2, merkleBranches, version, nbits, ntime) {
    try {
      const extranonce2 = this.getNextExtranonce2();
      const coinbaseHex = coinb1 + this.extranonce1 + extranonce2 + coinb2;
      const coinbaseBuf = Buffer.from(coinbaseHex, 'hex');
      const coinbaseHash = Buffer.from(SHA256D.d(coinbaseBuf));

      let current = Buffer.from(coinbaseHash);
      for (const branchHex of merkleBranches) {
        const branch = Buffer.from(branchHex, 'hex');
        const combined = Buffer.concat([current, branch]);
        current = Buffer.from(SHA256D.d(combined));
      }
      const merkleRoot = current;

      const header = Buffer.alloc(80);
      header.writeUInt32LE(parseInt(version, 16) >>> 0, 0);
      Buffer.from(prevhash, 'hex').reverse().copy(header, 4);
      merkleRoot.copy(header, 36);
      header.writeUInt32LE(parseInt(ntime, 16) >>> 0, 68);
      Buffer.from(nbits, 'hex').reverse().copy(header, 72);

      const midstate = SHA256D.computeMidstate(header);
      const blockTarget = this.computeBlockTarget(nbits);

      if (!this.shareTarget) {
        this.shareTarget = this.computeShareTarget(this.currentDifficulty);
      }

      const height = this.extractBlockHeight(coinb1);
      const coinbaseValue = this.getBlockReward(height);

      const job = {
        jobId: 'stratum_' + jobId,
        stratumJobId: jobId,
        height: height,
        header: Array.from(header),
        midstate: Array.from(midstate),
        shareTarget: Array.from(this.shareTarget),
        blockTarget: Array.from(blockTarget),
        nonceStart: 0,
        nonceEnd: 0xFFFFFFFF,
        extranonce2: extranonce2,
        ntime: ntime,
        version: version,
        prevhash: prevhash,
        nbits: nbits,
        coinbasevalue: coinbaseValue,
        bits: nbits,
        createdAt: Date.now(),
        stale: false
      };

      return job;
    } catch (e) {
      logPool('Job assembly error', { message: e.message, stack: e.stack.split('\n')[0] });
      return null;
    }
  }

  extractBlockHeight(coinb1) {
    try {
      const buf = Buffer.from(coinb1, 'hex');
      if (buf.length < 42) return 0;
      const scriptSigLen = buf[41];
      if (scriptSigLen < 1 || scriptSigLen > 100) return 0;
      const scriptSigStart = 42;
      const pushOpcode = buf[scriptSigStart];
      if (pushOpcode >= 1 && pushOpcode <= 4) {
        let height = 0;
        for (let i = 0; i < pushOpcode; i++) {
          height |= (buf[scriptSigStart + 1 + i] << (i * 8));
        }
        if (height > 100000 && height < 2000000) return height;
      }
    } catch (e) {}
    return 0;
  }

  getBlockReward(height) {
    if (!height || height <= 0) return 312500000;
    const halvings = Math.floor(height / 210000);
    if (halvings >= 64) return 0;
    const reward = Math.floor(5000000000 / Math.pow(2, halvings));
    return reward;
  }

  computeBlockTarget(nbits) {
    const bits = Buffer.from(nbits, 'hex');
    const exp = bits[0];
    const mantissa = (bits[1] << 16) | (bits[2] << 8) | bits[3];
    const target = new Uint8Array(32);
    if (exp <= 3) {
      const v = mantissa >>> ((3 - exp) * 8);
      target[29] = (v >>> 16) & 0xFF;
      target[30] = (v >>> 8) & 0xFF;
      target[31] = v & 0xFF;
    } else {
      const pos = 32 - exp;
      if (pos >= 0 && pos + 3 <= 32) {
        target[pos] = (mantissa >>> 16) & 0xFF;
        target[pos + 1] = (mantissa >>> 8) & 0xFF;
        target[pos + 2] = mantissa & 0xFF;
      }
    }
    return target;
  }

  computeShareTarget(difficulty) {
    if (!difficulty || difficulty <= 0) difficulty = 1;
    const maxTargetBig = BigInt('0x' + MAX_TARGET.toString('hex'));
    let targetBig = maxTargetBig / BigInt(Math.round(difficulty));
    const result = new Uint8Array(32);
    for (let i = 31; i >= 0; i--) {
      result[i] = Number(targetBig & 0xFFn);
      targetBig >>= 8n;
    }
    return result;
  }

  startMiners(job) {
    this.stopMiners();
    const numMiners = Math.max(1, Math.min(parseInt(this.config.STRATUM_MINER_THREADS || '4', 10), 8));
    const U = 0x100000000;
    const span = Math.floor(U / numMiners);
    this.mining = true;

    logPool('Starting internal miners', { count: numMiners, threadsPerMiner: 1 });

    for (let i = 0; i < numMiners; i++) {
      const from = i * span;
      const to = i === numMiners - 1 ? U : (i + 1) * span;
      const miner = { running: true, from: from, to: to, hashes: 0, lastRate: Date.now() };
      this.miners.push(miner);
      this.mineLoop(miner, job, from, to);
    }
  }

  mineLoop(miner, job, nonce, end) {
    if (!miner.running || !this.mining) return;
    const header76 = new Uint8Array(job.header).subarray(0, 76);
    const shareTarget = new Uint8Array(job.shareTarget);
    const start = Date.now();
    let count = 0;

    while (miner.running && this.mining && count < 2048 && nonce !== end) {
      const hash = SHA256D.hash80(header76, nonce);
      count++;
      nonce = (nonce + 1) >>> 0;

      if (SHA256D.meets(hash, shareTarget)) {
        const foundNonce = ((nonce - 1) >>> 0);
        this.submitShare(job, foundNonce, hash);
      }

      if (Date.now() - start >= 20) break;
    }

    miner.hashes += count;
    const now = Date.now();
    if (now - miner.lastRate >= 5000) {
      const rate = Math.round(miner.hashes * 1000 / (now - miner.lastRate));
      if (this.onStatus) this.onStatus('mining', rate);
      miner.hashes = 0;
      miner.lastRate = now;
    }

    if (nonce === end || nonce === 0) {
      logPool('Nonce range exhausted', { jobId: job.stratumJobId });
      return;
    }

    setImmediate(() => this.mineLoop(miner, job, nonce, end));
  }

  submitShare(job, nonce, hash) {
    const hashHex = SHA256D.hex(hash);
    const extranonce2 = job.extranonce2 || this.getNextExtranonce2();
    const params = [
      this.payoutAddress + '.' + this.workerName,
      job.stratumJobId,
      extranonce2,
      job.ntime,
      nonce.toString(16).padStart(8, '0')
    ];

    this.stats.sharesSubmitted++;
    this.rpc('mining.submit', params, (result, error) => {
      if (error) {
        this.stats.sharesRejected++;
        logPool('Share REJECTED', {
          jobId: job.stratumJobId,
          nonce: nonce.toString(16),
          error: JSON.stringify(error),
          totalRejected: this.stats.sharesRejected
        });
        if (this.onShare) this.onShare('rejected', error);
      } else {
        this.stats.sharesAccepted++;
        logPool('Share ACCEPTED', {
          jobId: job.stratumJobId,
          nonce: nonce.toString(16),
          totalAccepted: this.stats.sharesAccepted,
          totalSubmitted: this.stats.sharesSubmitted
        });
        if (this.onShare) this.onShare('accepted');

        const meetsBlock = SHA256D.meets(hash, new Uint8Array(job.blockTarget));
        if (meetsBlock) {
          this.stats.blocksFound++;
          logPool('!!! BLOCK FOUND !!!', {
            hash: hashHex,
            jobId: job.stratumJobId,
            height: job.height
          });
          if (this.onBlock) this.onBlock(job, nonce, hashHex);
        }
      }
    });
  }

  submitBrowserShare(jobId, nonce, hashHex, meetsBlock) {
    const job = this.jobManager.getJob(jobId);
    if (!job || !job.stratumJobId) {
      logPool('Browser share: job not found', { jobId: jobId });
      return;
    }

    const extranonce2 = job.extranonce2 || this.getNextExtranonce2();
    const params = [
      this.payoutAddress + '.' + this.workerName,
      job.stratumJobId,
      extranonce2,
      job.ntime,
      nonce.toString(16).padStart(8, '0')
    ];

    this.stats.sharesSubmitted++;
    logPool('Browser share submitted', {
      jobId: job.stratumJobId,
      nonce: nonce.toString(16),
      meetsBlock: meetsBlock
    });

    this.rpc('mining.submit', params, (result, error) => {
      if (error) {
        this.stats.sharesRejected++;
        logPool('Browser share REJECTED', {
          jobId: job.stratumJobId,
          error: JSON.stringify(error)
        });
      } else {
        this.stats.sharesAccepted++;
        logPool('Browser share ACCEPTED', {
          jobId: job.stratumJobId,
          totalAccepted: this.stats.sharesAccepted
        });
        if (meetsBlock) {
          this.stats.blocksFound++;
          logPool('!!! BLOCK FOUND by browser !!!', {
            hash: hashHex,
            jobId: job.stratumJobId
          });
          if (this.onBlock) this.onBlock(job, nonce, hashHex);
        }
      }
    });
  }

  stopMiners() {
    this.mining = false;
    for (const m of this.miners) { m.running = false; }
    this.miners = [];
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logPool('Max reconnection attempts reached, giving up', { attempts: this.reconnectAttempts });
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(3000 * Math.pow(2, this.reconnectAttempts - 1), 60000);
    logPool('Scheduling reconnect', {
      attempt: this.reconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS,
      delay: (delay / 1000) + 's'
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  getStatus() {
    return {
      connected: this.connected,
      authorized: this.authorized,
      pool: this.poolHost + ':' + this.poolPort + (this.useTLS ? ' (TLS)' : ''),
      difficulty: this.currentDifficulty,
      miners: this.miners.length,
      extranonce1: this.extranonce1,
      stats: { ...this.stats },
      uptime: this.stats.connectTime ? Math.round((Date.now() - this.stats.connectTime) / 1000) : 0
    };
  }
}

module.exports = StratumClient;
