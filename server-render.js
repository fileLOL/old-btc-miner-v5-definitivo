const express = require('express'),
  path = require('path'),
  http = require('http'),
  crypto = require('crypto');
const WebSocket = require('ws');

const config = require('./lib/config');
const JobManager = require('./lib/job-manager');
const ShareValidator = require('./lib/share-validator');
const MinerTracker = require('./lib/miner-tracker');
const RateLimiter = require('./lib/rate-limiter');
const { buildJob, buildBlock, SHA256D } = require('./lib/block-builder');
const { getDb, closeDb } = require('./lib/db');
const accountManager = require('./lib/account-manager');
const { validateAddress } = require('./lib/address-validator');
const BlockMonitor = require('./lib/block-monitor');
const rewardEngine = require('./lib/reward-engine');
const PayoutProcessor = require('./lib/payout-processor');
const PayoutMonitor = require('./lib/payout-monitor');
const AuditLog = require('./lib/audit');
const TestPayoutRunner = require('./lib/test-payout-runner');
const MempoolAPI = require('./lib/mempool-api');
const StratumClient = require('./lib/stratum-client');
const { verifyGoogleIdToken } = require('./lib/google-auth');
const apiSessions = require('./lib/api-session');

const app = express();
const server = http.createServer(app);
const PORT = config.PORT;

app.use((req, res, next) => {
  const allowedOrigins = String(config.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next()
});

app.use(express.json({ limit: '16mb' }));

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
function authenticateVerifiedRequest(req) {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
  if (!match) return null;
  const db = getDb();
  return apiSessions.authenticate(db, match[1], { ttlMs: SESSION_TTL_MS });
}

let db;
try { db = getDb() } catch (e) { console.error('Database init error:', e.message) }

const jobManager = new JobManager(config);
const shareValidator = new ShareValidator(jobManager);
const minerTracker = new MinerTracker(config);
minerTracker.setAccountManager(accountManager);
const rateLimiter = new RateLimiter({ maxPerMinute: 60, maxSharesPerMinute: 30 });
async function rpcCli(args) {
  const method = args[0];
  const rawParams = args.slice(1);
  const params = rawParams.map(p => {
    if (typeof p === 'string') { try { return JSON.parse(p) } catch (e) { return p } }
    return p;
  });
  const result = await rpcCall(method, params);
  return typeof result === 'string' ? result : JSON.stringify(result);
}

const blockMonitor = new BlockMonitor(config, rpcCli);
const payoutProcessor = new PayoutProcessor(config, rpcCli);
const payoutMonitor = new PayoutMonitor(config, rpcCli);
const testPayoutRunner = new TestPayoutRunner(config, rpcCli);

function calculateBlockHash(blockHex) {
  const headerBuf = Buffer.from(blockHex.slice(0, 160), 'hex');
  const hash1 = crypto.createHash('sha256').update(headerBuf).digest();
  const hash2 = crypto.createHash('sha256').update(hash1).digest();
  return Buffer.from(hash2).reverse().toString('hex')
}

function getBlockSubsidySat(height) {
  const halvings = Math.floor(height / 210000);
  return halvings >= 64 ? 0 : Number(5000000000n >> BigInt(halvings));
}

// HTTP JSON-RPC call to Bitcoin Core
async function rpcCall(method, params = []) {
  const rpcUrl = process.env.BITCOIN_RPC_URL || config.BITCOIN_RPC_URL || 'http://127.0.0.1:8332';
  const rpcUser = process.env.BITCOIN_RPC_USER || config.BITCOIN_RPC_USER || 'btcpool';
  const rpcPass = process.env.BITCOIN_RPC_PASSWORD || config.BITCOIN_RPC_PASSWORD || '';

  const body = JSON.stringify({
    jsonrpc: '1.0',
    id: Date.now(),
    method,
    params
  });

  const url = new URL(rpcUrl);
  const auth = Buffer.from(`${rpcUser}:${rpcPass}`).toString('base64');

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 8332,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
          else resolve(parsed.result);
        } catch (e) { reject(new Error(`Invalid RPC response: ${data.slice(0, 200)}`)) }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('RPC timeout')) });
    req.write(body);
    req.end();
  });
}

let lastTemplateHeight = null;
let bitcoinCoreOnline = false;
let stratumClient = null;
let stratumConnected = false;
let localJobTimer = null;
let lastJobReceivedAt = 0;

function bitsToTargetHex(bitsInt) {
  const exponent = (bitsInt >>> 24) & 0xFF;
  const mantissa = bitsInt & 0x007FFFFF;
  let target = 0n;
  if (exponent <= 3) {
    target = BigInt(mantissa >> (8 * (3 - exponent)));
  } else {
    target = BigInt(mantissa) << BigInt(8 * (exponent - 3));
  }
  let hex = target.toString(16).padStart(64, '0');
  if (hex.length > 64) hex = hex.slice(0, 64);
  return hex;
}

async function generateLocalJob() {
  try {
    const blocks = await MempoolAPI.getLatestBlocks(1);
    if (!blocks || blocks.length === 0) return;
    const lastBlock = blocks[0];
    const block = await MempoolAPI.getBlock(lastBlock.id);

    const bitsInt = block.bits;
    const bitsHex = (bitsInt >>> 0).toString(16).padStart(8, '0');
    const targetHex = bitsToTargetHex(bitsInt);
    const height = block.height + 1;
    const coinbasevalue = getBlockSubsidySat(height);

    const template = {
      version: block.version >>> 0,
      previousblockhash: block.previousblockhash,
      target: targetHex,
      bits: bitsHex,
      curtime: Math.floor(Date.now() / 1000),
      height,
      coinbasevalue,
      transactions: [],
      default_witness_commitment: null
    };
    const job = jobManager.setTemplate(template);
    job.isLocal = true;
    console.log(`[LocalJob] Generated job for height ${job.height}, jobId: ${job.jobId}, bits: ${bitsHex}`);
    broadcastJob(job);
  } catch (e) {
    console.error('[LocalJob] Error generating job:', e.message);
  }
}

function initStratum() {
  stratumClient = new StratumClient(config, jobManager);
  stratumClient.onNewJob = (job) => {
    lastJobReceivedAt = Date.now();
    if (localJobTimer) { clearInterval(localJobTimer); localJobTimer = null; console.log('[LocalJob] Stopped (Stratum jobs arriving)'); }
    MempoolAPI.getLatestBlocks(1).then((blocks) => {
      if (!job.height && blocks && blocks.length) job.height = blocks[0].height + 1;
      if (!job.coinbasevalue) job.coinbasevalue = getBlockSubsidySat(job.height);
      broadcastJob(job);
    }).catch((e) => {
      console.error('[Stratum] Could not load block height for job metadata:', e.message);
      broadcastJob(job);
    });
  };
  stratumClient.onShare = (status, info) => {
    if (status === 'accepted') {
      console.log('[Stratum] Share accepted by pool');
    } else {
      console.log('[Stratum] Share rejected:', info);
    }
  };
  stratumClient.onBlock = (job, nonce, hashHex) => {
    console.log('[Stratum] BLOCK FOUND! Hash:', hashHex);
    broadcastBlockFound('internal-miner', job.height || 0);
  };
  stratumClient.onStatus = (status, hashrate) => {
    if (status === 'connected') {
      stratumConnected = true;
      console.log('[Stratum] Pool connected');
    } else if (status === 'disconnected') {
      stratumConnected = false;
      console.log('[Stratum] Pool disconnected');
    }
  };
  stratumClient.connect();

  // Fallback: generate local jobs if no Stratum jobs arrive
  setInterval(() => {
    const hasJob = jobManager.getCurrentJob() !== null;
    const jobsStale = !hasJob || (Date.now() - lastJobReceivedAt > 60000);
    if (jobsStale && !localJobTimer) {
      localJobTimer = setInterval(generateLocalJob, 30000);
      generateLocalJob();
      console.log('[LocalJob] Started fallback (no jobs for 60s or no job exists)');
    }
  }, 15000);
}

function broadcastJob(job) {
  const msg = JSON.stringify({ type: 'newJob', jobId: job.jobId, height: job.height, header: job.header, midstate: job.midstate, shareTarget: job.shareTarget, blockTarget: job.blockTarget, nonceStart: 0, nonceEnd: 4294967295, bits: job.nbits || job.bits, previousblockhash: job.previousblockhash, coinbasevalue: job.coinbasevalue || 0 });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(msg) } catch {}
    }
  })
}

let broadcastInterval = null;
function startBroadcastLoop() {
  if (broadcastInterval) return;
  broadcastInterval = setInterval(() => {
    const stats = minerTracker.getPoolStats();
    const msg = JSON.stringify({ type: 'poolStats', ...stats });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(msg) } catch {}
      }
    })
  }, 5000)
}

app.get('/api/status', async (_q, r) => {
  try {
    const [chainInfo, miningInfo] = await Promise.all([
      MempoolAPI.getBlockchainInfo(),
      MempoolAPI.getMiningInfo()
    ]);
    r.json({
      ok: true,
      chain: chainInfo.chain,
      blocks: chainInfo.blocks,
      headers: chainInfo.headers,
      verificationProgress: chainInfo.verificationprogress,
      difficulty: miningInfo.difficulty,
      networkhashps: miningInfo.networkhashps,
      warnings: miningInfo.warnings || '',
      bitcoin_core: (stratumConnected || jobManager.getCurrentJob()) ? 'online' : 'offline',
      source: stratumConnected ? 'stratum-pool' : 'local-mining',
      pool: stratumClient ? stratumClient.getStatus() : null
    })
  } catch (e) {
    r.json({ ok: false, bitcoin_core: 'offline', error: 'Mempool API unreachable', blocks: 0, headers: 0, chain: 'unknown', difficulty: 0, networkhashps: 0, verificationProgress: 0 })
  }
});

app.get('/api/wallet', async (_q, r) => {
  try {
    const w = await rpcCall('getwalletinfo');
    const bal = typeof w.balance === 'number' ? w.balance : null;
    r.json({ ok: true, walletname: w.walletname, balance: bal, unconfirmed_balance: w.unconfirmed_balance, txcount: w.txcount })
  } catch (e) { r.status(503).json({ ok: false, error: e.message }) }
});

app.get('/api/template', async (_q, r) => {
  const job = jobManager.getCurrentJob();
  if (!job) {
    try {
      const chainInfo = await MempoolAPI.getBlockchainInfo();
      r.json({ ok: true, height: chainInfo.blocks, source: 'mempool-pending' });
    } catch (e) {
      r.status(503).json({ ok: false, error: 'No job available' });
    }
    return;
  }
  r.json({
    ok: true,
    height: job.height || 0,
    bits: job.nbits || job.bits || '---',
    target: job.blockTarget ? Buffer.from(job.blockTarget).toString('hex') : '---',
    coinbasevalue: job.coinbasevalue || 0,
    tx_count: 0,
    source: 'stratum-pool',
    jobId: job.jobId
  });
});

app.get('/api/job', async (_req, res) => {
  const job = jobManager.getCurrentJob();
  if (!job) {
    return res.status(400).json({ ok: false, error: 'No job available. Waiting for pool...' });
  }
  res.json({ ok: true, ...job });
});

app.post('/api/submit', async (req, res) => {
  try {
    const block = String(req.body?.block || '');
    if (!/^[0-9a-fA-F]+$/.test(block) || block.length < 160 || block.length % 2) throw Error('Invalid block hex');
    const result = await rpcCall('submitblock', [block]);
    res.json({ ok: true, result: result || 'accepted' })
  } catch (e) { res.status(400).json({ ok: false, error: e.message }) }
});

app.post('/api/send', async (req, res) => {
  if (process.env.ENABLE_SEND !== '1') return res.status(403).json({ ok: false, error: 'Wallet send disabled. Set ENABLE_SEND=1 explicitly.' });
  const { address, amount, subtractFeeFromAmount = false } = req.body || {};
  const value = Number(amount);
  if (!address || !Number.isFinite(value) || value <= 0) return res.status(400).json({ ok: false, error: 'Invalid address or amount' });
  try {
    const args = [address, String(value)];
    if (subtractFeeFromAmount) args.push('', '', 'false', 'true');
    res.json({ ok: true, txid: await rpcCall('sendtoaddress', args) })
  } catch (e) { res.status(503).json({ ok: false, error: e.message }) }
});

app.post('/api/register-miner', (req, res) => {
  res.status(410).json({ ok: false, error: 'Register through the authenticated WebSocket connection.' });
});

app.get('/api/miner/:minerId/stats', (req, res) => {
  try {
    const { minerId } = req.params;
    const miner = minerTracker.getMiner(minerId);
    if (!miner) {
      return res.status(404).json({ ok: false, error: 'Miner not found or not connected' })
    }
    const stats = minerTracker.getMinerStats(minerId);
    if (!stats.accountId) {
      return res.json({ ok: true, registered: false, minerId, shares: stats.shares, hashrate: stats.hashrate, lastSeen: stats.lastSeen })
    }
    res.json({
      ok: true,
      registered: true,
      minerId,
      shares: stats.shares,
      hashrate: stats.hashrate,
      lastSeen: stats.lastSeen,
    })
  } catch (e) {
    console.error('Get miner stats error:', e.message);
    res.status(500).json({ ok: false, error: e.message })
  }
});

app.get('/api/my-stats', (req, res) => {
  try {
    const session = authenticateVerifiedRequest(req);
    if (!session) return res.status(401).json({ ok: false, error: 'Verified Google session required' });
    const stats = rewardEngine.getAccountStats(session.account_id);
    if (!stats) { return res.status(404).json({ ok: false, error: 'Account not found' }) }
    const windowStats = rewardEngine.getSharesInWindow(session.account_id, config.PPLNS_WINDOW_SIZE);
    res.json({
      ok: true,
      account_id: stats.account_id,
      btc_address: stats.btc_address,
      shares: stats.shares,
      shares_in_window: windowStats.count,
      shares_in_window_difficulty: windowStats.totalDifficulty,
      blocks_found: stats.blocks_found,
      balance: {
        pending_sat: stats.balance.pending_sat,
        confirmed_sat: stats.balance.confirmed_sat,
        total_earned_sat: stats.balance.total_earned_sat,
        pending_btc: (stats.balance.pending_sat / 1e8).toFixed(8),
        confirmed_btc: (stats.balance.confirmed_sat / 1e8).toFixed(8),
        total_earned_btc: (stats.balance.total_earned_sat / 1e8).toFixed(8)
      },
      hashrate: 0,
      lastSeen: null
    })
  } catch (e) {
    console.error('Get my-stats error:', e.message);
    res.status(500).json({ ok: false, error: e.message })
  }
});

app.get('/api/auth-config', (_q, r) => r.json({ googleClientId: config.GOOGLE_CLIENT_ID || null }));

app.get('/api/my-balance', (req, res) => {
  const session = authenticateVerifiedRequest(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Verified Google session required' });
  try {
    const stats = rewardEngine.getAccountStats(session.account_id);
    if (!stats || !stats.balance) return res.status(404).json({ ok: false, error: 'Account not found' });
    const estimate = typeof rewardEngine.getEstimatedReward === 'function'
      ? rewardEngine.getEstimatedReward(session.account_id, config.PPLNS_WINDOW_SIZE, config.POOL_FEE_PERCENT)
      : { estimated_sat: 0, has_valid_data: false };
    return res.json({ ok: true, verified: true,
      pending_sat: stats.balance.pending_sat, confirmed_sat: stats.balance.confirmed_sat,
      total_earned_sat: stats.balance.total_earned_sat,
      pool_fee_percent: config.POOL_FEE_PERCENT, payout_dry_run: config.PAYOUT_DRY_RUN,
      min_payout_sat: config.MIN_PAYOUT_SAT, estimated_sat: estimate.estimated_sat || 0,
      estimated_has_data: !!estimate.has_valid_data,
      estimated_reference_height: estimate.reference_block_height || null });
  } catch (error) {
    console.error('Wallet balance query failed:', error.message);
    return res.status(500).json({ ok: false, error: 'Unable to load wallet balance' });
  }
});

app.post('/api/request-payout', (_req, res) => res.status(503).json({
  ok: false,
  error: 'Manual withdrawals are disabled until payout destination, reservation, and duplicate handling are implemented safely.'
}));

app.get('/api/pool-info', (_q, r) => {
  try {
    const poolStats = minerTracker.getPoolStats();
    const blocks = accountManager.getAllBlocks();
    const confirmedBlocks = blocks.filter(b => b.status === 'confirmed' || b.status === 'mature');
    const totalRewards = confirmedBlocks.reduce((sum, b) => sum + b.coinbase_value, 0);
    r.json({
      ok: true,
      miners_online: poolStats.minersOnline,
      pool_hashrate: poolStats.totalHashrate,
      total_shares: poolStats.totalShares,
      valid_blocks: poolStats.validBlocks,
      blocks_found: blocks.length,
      confirmed_blocks: confirmedBlocks.length,
      pool_fee_percent: config.POOL_FEE_PERCENT,
      pplns_window_size: config.PPLNS_WINDOW_SIZE,
      min_payout_sat: config.MIN_PAYOUT_SAT,
      share_difficulty: config.SHARE_DIFFICULTY,
      total_rewards_sat: totalRewards
    })
  } catch (e) {
    console.error('Get pool-info error:', e.message);
    r.status(500).json({ ok: false, error: e.message })
  }
});

app.get('/api/pool-stats', (_q, r) => {
  r.json({ ok: true, ...minerTracker.getPoolStats(), jobManager: jobManager.getStats() })
});

app.get('/api/health', (_q, r) => {
  r.json({ ok: true, uptime: process.uptime(), miners: minerTracker.getMinerCount(), version: '5.1.0-pool', bitcoin_core: bitcoinCoreOnline ? 'online' : 'offline' })
});

app.get('/api/payouts', (req, res) => {
  try {
    const status = req.query.status || 'all';
    const limit = parseInt(req.query.limit || '100', 10);
    const db = getDb();
    let query = `SELECT p.*, a.btc_address FROM payouts p JOIN accounts a ON p.account_id=a.account_id`;
    let params = [];
    if (status !== 'all') { query += ' WHERE p.status=?'; params.push(status) }
    query += ' ORDER BY p.created_at DESC LIMIT ?';
    params.push(limit);
    const payouts = db.prepare(query).all(...params);
    res.json({ ok: true, payouts })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
});

app.get('/api/payout-stats', (_q, res) => {
  try {
    const stats = payoutProcessor.getPayoutStats();
    res.json({ ok: true, stats })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
});

app.get('/api/audit', (req, res) => {
  try {
    const accountId = req.query.accountId ? parseInt(req.query.accountId, 10) : null;
    const limit = parseInt(req.query.limit || '100', 10);
    const trail = AuditLog.getAuditTrail(accountId, limit);
    res.json({ ok: true, audit: trail })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
});

app.get('/api/audit/summary', (req, res) => {
  try {
    const accountId = req.query.accountId ? parseInt(req.query.accountId, 10) : null;
    let summary;
    if (accountId) { summary = AuditLog.getAccountSummary(accountId) }
    else { summary = AuditLog.getPoolSummary() }
    res.json({ ok: true, summary })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
});

app.get('/api/admin/test-payout/status', (_q, res) => {
  try {
    res.json({
      ok: true,
      enabled: config.ENABLE_REAL_PAYOUT_TEST,
      dryRun: config.PAYOUT_DRY_RUN,
      destination: testPayoutRunner.getTestAddress() || '(not configured)',
      amountSat: testPayoutRunner.getTestAmountSat(),
      minPayoutSat: config.MIN_PAYOUT_SAT,
      maxPayoutSat: config.MAX_PAYOUT_SAT,
      testDbPath: testPayoutRunner.getTestDbPath()
    })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
});

app.post('/api/admin/test-payout/run', async (req, res) => {
  try {
    const result = await testPayoutRunner.run();
    res.json({ ok: result.success !== false, result })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
});

app.get('/api/admin/test-payout/state', (_q, res) => {
  try {
    const state = testPayoutRunner.getState();
    if (!state) return res.json({ ok: true, state: null, message: 'test DB not initialised yet' })
    res.json({ ok: true, state })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
});

const wss = new WebSocket.Server({ server, path: '/ws' });

setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'ping' })) } catch {}
    }
  })
}, 25000);

wss.on('connection', (ws, req) => {
  const minerId = 'miner_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  const registered = minerTracker.register(minerId, ws);
  if (!registered) { ws.close(1013, 'Max miners reached'); return }
  ws.minerId = minerId;
  ws.registered = false;
  ws.accountId = null;
  console.log(`Miner connected: ${minerId} (total: ${minerTracker.getMinerCount()})`);

  ws.send(JSON.stringify({ type: 'welcome', minerId, version: '5.1.0-pool' }));

  const job = jobManager.getCurrentJob();
  if (job) {
    ws.send(JSON.stringify({ type: 'newJob', jobId: job.jobId, height: job.height, header: job.header, midstate: job.midstate, shareTarget: job.shareTarget, blockTarget: job.blockTarget, nonceStart: 0, nonceEnd: 4294967295 }))
  }

  ws.registrationTimeout = setTimeout(() => {
    if (!ws.registered) {
      console.log(`Miner ${minerId} did not register wallet, closing connection`);
      ws.close(1008, 'Wallet registration required');
      try { minerTracker.unregister(minerId) } catch {}
    }
  }, 30000);

  ws.on('message', (data) => {
    if (!rateLimiter.check(minerId, 'message')) { ws.close(1008, 'Rate limit exceeded'); return }
    try {
      const msg = JSON.parse(data.toString());
      handleMessage(ws, minerId, msg).catch(() => {})
    } catch {}
  });

  ws.on('close', () => {
    if (ws.registrationTimeout) clearTimeout(ws.registrationTimeout);
    if (ws.sessionToken) {
      try { apiSessions.revoke(getDb(), ws.sessionToken); } catch {}
      ws.sessionToken = null;
    }
    minerTracker.unregister(minerId);
    console.log(`Miner disconnected: ${minerId} (total: ${minerTracker.getMinerCount()})`)
  });

  ws.on('error', (err) => { console.error(`WebSocket error for ${minerId}:`, err.message) })
});

async function handleMessage(ws, minerId, msg) {
  if (!msg || typeof msg !== 'object') return;
  minerTracker.updateSeen(minerId);

  if (msg.type === 'register') {
    if (ws.registered) {
      ws.send(JSON.stringify({ type: 'error', error: 'Already registered' }));
      return
    }
    const { btcAddress, googleToken } = msg;
    if (!btcAddress || typeof btcAddress !== 'string') {
      ws.send(JSON.stringify({ type: 'registerFailed', error: 'btcAddress required' }));
      return
    }
    const validation = validateAddress(btcAddress);
    if (!validation.valid) {
      ws.send(JSON.stringify({ type: 'registerFailed', error: 'Invalid Bitcoin address: ' + validation.error }));
      return
    }
    try {
      const google = await verifyGoogleIdToken(googleToken, config.GOOGLE_CLIENT_ID);
      if (!google.valid) {
        ws.send(JSON.stringify({ type: 'registerFailed', error: google.error || 'Verified Google sign-in required for wallet access' }));
        return;
      }
      const account = accountManager.getOrCreateAccount(btcAddress);
      const db = getDb();
      const existingIdentity = db.prepare('SELECT google_id FROM account_identities WHERE account_id=?').get(account.account_id);
      if (!existingIdentity && !account.isNew) {
        ws.send(JSON.stringify({ type: 'registerFailed', error: 'This existing miner account has no verified Google identity and cannot be claimed.' }));
        return;
      }
      if (existingIdentity && existingIdentity.google_id !== google.googleId) {
        ws.send(JSON.stringify({ type: 'registerFailed', error: 'This miner account is linked to a different Google account' }));
        return;
      }
      const identityForGoogle = db.prepare('SELECT account_id FROM account_identities WHERE google_id=?').get(google.googleId);
      if (identityForGoogle && identityForGoogle.account_id !== account.account_id) {
        ws.send(JSON.stringify({ type: 'registerFailed', error: 'This Google account is already linked to another miner account' }));
        return;
      }
      if (!existingIdentity) {
        db.prepare('INSERT INTO account_identities (account_id,google_id,email,display_name,verified_at) VALUES (?,?,?,?,?)')
          .run(account.account_id, google.googleId, google.email, google.name, Date.now());
      }
      const token = apiSessions.createSession(db, account.account_id, google.googleId);
      ws.sessionToken = token;
      const userAgent = ws.upgradeReq?.headers?.['user-agent'] || null;
      minerTracker.linkAccount(minerId, account.account_id, userAgent);
      ws.registered = true;
      ws.accountId = account.account_id;
      if (ws.registrationTimeout) clearTimeout(ws.registrationTimeout);
      ws.send(JSON.stringify({ type: 'registered', btcAddress: account.btc_address, isNew: account.isNew, verified: true }));
      ws.send(JSON.stringify({ type: 'sessionToken', token }));
      console.log(`Miner ${minerId} registered with a verified account`)
    } catch (e) {
      console.error('Registration error:', e.message);
      ws.send(JSON.stringify({ type: 'registerFailed', error: e.message }))
    }
  }

  else if (msg.type === 'share') {
    if (!ws.registered) {
      ws.send(JSON.stringify({ type: 'shareRejected', reason: 'wallet registration required' }));
      return
    }
    if (!rateLimiter.check(minerId, 'share')) { ws.send(JSON.stringify({ type: 'error', error: 'Share rate limit' })); return }
    const result = shareValidator.validate({ minerId, jobId: msg.jobId, nonce: msg.nonce, hashHex: msg.hashHex });
    if (!result.valid) {
      minerTracker.addInvalidShare(minerId);
      ws.send(JSON.stringify({ type: 'shareRejected', reason: result.error, stale: result.stale }));
      return
    }
    if (result.stale) {
      minerTracker.addStaleShare(minerId);
      ws.send(JSON.stringify({ type: 'shareRejected', reason: 'stale', stale: true }));
      return
    }
    if (!result.meetsShareTarget) {
      minerTracker.addInvalidShare(minerId);
      ws.send(JSON.stringify({ type: 'shareRejected', reason: 'does not meet share target' }));
      return
    }
    minerTracker.addShare(minerId, { jobId: result.jobId, nonce: result.nonce, hashHex: result.hashHex, difficulty: config.SHARE_DIFFICULTY || 1 });
    const miner = minerTracker.getMiner(minerId);
    if (miner && miner.accountId) { AuditLog.logShare(miner.accountId, result.jobId, config.SHARE_DIFFICULTY || 1) }
    ws.send(JSON.stringify({ type: 'shareAccepted', jobId: result.jobId, nonce: result.nonce }));
    const job = jobManager.getJob(result.jobId);
    if (stratumClient && stratumClient.connected && job && !job.isLocal) {
      stratumClient.submitBrowserShare(result.jobId, result.nonce, result.hashHex, result.meetsBlockTarget);
    }
    if (result.meetsBlockTarget) {
      console.log(`BLOCK CANDIDATE from ${minerId}! Nonce: ${result.nonce}`);
      handleBlockCandidate(ws, minerId, result.jobId, result.nonce)
    }
  }

  else if (msg.type === 'hashrate') {
    if (typeof msg.hashes === 'number' && msg.hashes > 0) {
      minerTracker.updateHashrate(minerId, msg.hashes)
    }
  }

  else if (msg.type === 'ping') {
    try { ws.send(JSON.stringify({ type: 'pong' })) } catch (e) {}
  }
}

async function handleBlockCandidate(ws, minerId, jobId, nonce) {
  try {
    const job = jobManager.getJob(jobId);
    if (!job || job.stale) { ws.send(JSON.stringify({ type: 'blockRejected', reason: 'stale job' })); return }
    if (stratumClient && stratumClient.connected) {
      console.log('[Stratum] Block candidate submitted via pool');
      const miner = minerTracker.getMiner(minerId);
      const blockHash = calculateBlockHash(buildBlock(job, nonce));
      minerTracker.recordBlock(job.height || 0, miner ? miner.accountId : null, minerId, 0);
      broadcastBlockFound(minerId, job.height || 0);
      ws.send(JSON.stringify({ type: 'blockAccepted', height: job.height || 0, blockHash }));
    } else {
      const blockHex = buildBlock(job, nonce);
      const blockHash = calculateBlockHash(blockHex);
      try {
        const result = await rpcCall('submitblock', [blockHex]);
        console.log('BLOCK ACCEPTED:', result || 'accepted');
        const miner = minerTracker.getMiner(minerId);
        accountManager.insertBlock(miner ? miner.accountId : null, minerId, job.height, job.coinbasevalue || 0, blockHash);
        minerTracker.recordBlock(job.height, miner ? miner.accountId : null, minerId, job.coinbasevalue || 0);
        broadcastBlockFound(minerId, job.height);
        ws.send(JSON.stringify({ type: 'blockAccepted', height: job.height, blockHash }))
      } catch (e) {
        console.error('Block rejected:', e.message);
        ws.send(JSON.stringify({ type: 'blockRejected', reason: e.message }))
      }
    }
  } catch (err) {
    console.error('Block submission error:', err.message);
    ws.send(JSON.stringify({ type: 'blockRejected', reason: err.message }))
  }
}

function broadcastBlockFound(minerId, height) {
  const msg = JSON.stringify({ type: 'blockFound', minerId, height });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(msg) } catch {}
    }
  })
}

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`OLD BTC MINER V5 HYBRID POOL -> http://0.0.0.0:${PORT}`);
  console.log(`WebSocket: ws://0.0.0.0:${PORT}/ws`);
  console.log(`Stratum Pool: ${config.STRATUM_POOL_HOST}:${config.STRATUM_POOL_PORT}`);
  console.log(`Worker: ${config.STRATUM_WORKER_NAME} | Internal miners: ${config.STRATUM_INTERNAL_MINERS} (${config.STRATUM_MINER_THREADS} threads)`);
  console.log(`Payout address: ${config.PAYOUT_ADDRESS ? '[CONFIGURED]' : '[NOT SET]'}`);
  console.log(`Pool fee: ${config.POOL_FEE_PERCENT}% | PPLNS window: ${config.PPLNS_WINDOW_SIZE} | Min payout: ${config.MIN_PAYOUT_SAT} sat`);
  console.log(`Payout mode: ${config.PAYOUT_DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  try {
    console.log('[Startup] Checking for stale pending payouts...');
    const recovery = await payoutProcessor.recoverStalePendingPayouts();
    if (recovery.recovered > 0) {
      console.log(`[Startup] Recovery complete: ${recovery.recovered} processed, ${recovery.reverted} reverted, ${recovery.broadcast} to broadcast`)
    } else { console.log('[Startup] No stale pending payouts found') }
  } catch (e) { console.error('[Startup] Recovery error:', e.message) }

  initStratum();
  startBroadcastLoop();
  blockMonitor.start();
  payoutMonitor.start();

  const payoutInterval = setInterval(async () => {
    try {
      console.log('[PayoutScheduler] Running periodic payout check...');
      const results = await payoutProcessor.processAllPayouts();
      if (results.length > 0) {
        console.log(`[PayoutScheduler] Processed ${results.length} payouts`);
        results.forEach(r => console.log(`  Account ${r.account_id}: ${r.success ? 'SUCCESS' : 'FAILED'} - ${r.amount_sat || 0} sat`))
      } else { console.log('[PayoutScheduler] No eligible accounts for payout') }
    } catch (e) { console.error('[PayoutScheduler] Error:', e.message) }
  }, config.PAYOUT_INTERVAL_MS)
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  if (stratumClient) stratumClient.disconnect();
  clearInterval(broadcastInterval);
  minerTracker.destroy();
  rateLimiter.destroy();
  blockMonitor.stop();
  payoutMonitor.stop();
  try { testPayoutRunner.close() } catch {}
  jobManager.activeJobs.clear();
  wss.close();
  server.close();
  try { closeDb() } catch {}
  process.exit(0)
});

module.exports = { app, server, jobManager, shareValidator, minerTracker, rateLimiter, rpcCall, config };
