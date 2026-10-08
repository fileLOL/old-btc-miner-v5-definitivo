const http = require('http');
const https = require('https');

const MEMPOOL_BASE = 'https://mempool.space/api';

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from ' + url)); }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout: ' + url)); });
  });
}

async function getBlockchainInfo() {
  const [tip, difficulty, hashrate] = await Promise.all([
    fetchJSON(MEMPOOL_BASE + '/blocks/tip'),
    fetchJSON(MEMPOOL_BASE + '/v1/mining/hashrate/3d'),
    fetchJSON(MEMPOOL_BASE + '/mempool')
  ]);
  const tipBlock = Array.isArray(tip) ? tip[0] : tip;
  return {
    chain: 'main',
    blocks: tipBlock.height,
    headers: tipBlock.height,
    bestblockhash: tipBlock.hash || tipBlock.id,
    verificationprogress: 1,
    difficulty: difficulty.currentHashrate ? (difficulty.currentHashrate / 1e9) : 0,
    initialblockdownload: false,
    warnings: ''
  };
}

async function getMiningInfo() {
  const hashrate = await fetchJSON(MEMPOOL_BASE + '/v1/mining/hashrate/3d');
  return {
    networkhashps: hashrate.currentHashrate || 0,
    difficulty: hashrate.currentDifficulty || 0,
    warnings: ''
  };
}

async function getMempoolInfo() {
  return fetchJSON(MEMPOOL_BASE + '/mempool');
}

async function getLatestBlocks(count = 10) {
  return fetchJSON(MEMPOOL_BASE + '/blocks');
}

async function getTransactionCount() {
  const mempool = await fetchJSON(MEMPOOL_BASE + '/mempool');
  return mempool.count || 0;
}

module.exports = {
  getBlockchainInfo,
  getMiningInfo,
  getMempoolInfo,
  getLatestBlocks,
  getTransactionCount,
  MEMPOOL_BASE
};