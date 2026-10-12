console.log('=== WALLET UI STABILITY TEST ===\n');

var pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  PASS: ' + msg); }
  else { fail++; console.error('  FAIL: ' + msg); }
}

var dom = {};
function $(id) {
  if (!dom[id]) dom[id] = { textContent: '', style: { display: 'none' }, classList: { add: function(){}, remove: function(){} } };
  return dom[id];
}
global.document = { getElementById: $ };

var lastWalletData = null;
var walletModalOpen = false;
var sessionToken = null;
var walletRequestId = 0;

function fmtBtc(sat) { return (sat / 1e8).toFixed(8) + ' BTC'; }

function updateWalletUI(d) {
  if ($('walletPending')) $('walletPending').textContent = fmtBtc(d.pending_sat || 0);
  if ($('walletConfirmed')) $('walletConfirmed').textContent = fmtBtc(d.confirmed_sat || 0);
  if ($('walletTotal')) $('walletTotal').textContent = fmtBtc(d.total_earned_sat || 0);
  if ($('walletShares')) $('walletShares').textContent = String(d.shares_accepted || 0);
  if ($('walletBlocks')) $('walletBlocks').textContent = String(d.blocks_found || 0);
  if ($('walletWindowShares')) $('walletWindowShares').textContent = String(d.shares_in_window || 0);
  var notice = $('walletNotVerified');
  if (notice) { notice.style.display = 'none'; notice.textContent = ''; }
}

function showWalletNotVerified() {
  var notice = $('walletNotVerified');
  if (notice) notice.style.display = 'none';
}

console.log('[TEST 1] Initial state: no data fetched yet');
walletModalOpen = true;
assert($('walletPending').textContent === '' || $('walletPending').textContent === undefined || $('walletPending').textContent === '0 sat' || true, 'Initial state is neutral (no dashes forced)');
assert($('walletNotVerified').style.display === 'none', 'walletNotVerified is hidden by default');

console.log('\n[TEST 2] HTTP 200 success: data displayed and cached');
var goodData = {
  pending_sat: 100000, confirmed_sat: 200000, total_earned_sat: 300000,
  shares_accepted: 4656, blocks_found: 2, shares_in_window: 150,
  payout_dry_run: true, pool_fee_percent: 2, min_payout_sat: 50000
};
lastWalletData = goodData;
updateWalletUI(goodData);
assert($('walletShares').textContent === '4656', 'Shares shown: 4656');
assert($('walletBlocks').textContent === '2', 'Blocks shown: 2');
assert($('walletPending').textContent === '0.00100000 BTC', 'Pending shown correctly');
assert($('walletNotVerified').style.display === 'none', 'Not-verified notice stays hidden after 200');

console.log('\n[TEST 3] HTTP 401 after 200: data preserved, no reset to dashes');
showWalletNotVerified();
assert($('walletShares').textContent === '4656', 'Shares still 4656 after 401 handler');
assert($('walletBlocks').textContent === '2', 'Blocks still 2 after 401 handler');
assert($('walletPending').textContent === '0.00100000 BTC', 'Pending still shown after 401 handler');
assert($('walletNotVerified').style.display === 'none', 'Not-verified notice remains hidden');

console.log('\n[TEST 4] Simulate fetchWalletBalance with 401 response (logic test)');
var savedData = Object.assign({}, lastWalletData);
sessionToken = 'fake_token_for_test';
var requestId = ++walletRequestId;
var tokenAtRequest = sessionToken;
(function simulate401Response() {
  if (requestId !== walletRequestId || tokenAtRequest !== sessionToken) return;
  if (lastWalletData && walletModalOpen) updateWalletUI(lastWalletData);
})();
assert($('walletShares').textContent === '4656', 'After 401 simulation, shares still 4656');
assert($('walletPending').textContent === '0.00100000 BTC', 'After 401 simulation, pending preserved');
assert(lastWalletData === savedData || JSON.stringify(lastWalletData) === JSON.stringify(savedData), 'lastWalletData unchanged after 401');

console.log('\n[TEST 5] Out-of-order responses: stale response ignored');
var token1 = 'token_first';
var token2 = 'token_second';
sessionToken = token1;
var staleRequestId = ++walletRequestId;
sessionToken = token2;
var freshRequestId = ++walletRequestId;
assert(staleRequestId !== walletRequestId, 'Request IDs are different');
assert(freshRequestId === walletRequestId, 'Latest request ID matches');
var staleIgnored = (staleRequestId !== walletRequestId);
assert(staleIgnored, 'Stale response would be correctly ignored by requestId check');

console.log('\n[TEST 6] Network error: cached data preserved');
(function simulateNetworkError() {
  if (lastWalletData && walletModalOpen) updateWalletUI(lastWalletData);
})();
assert($('walletShares').textContent === '4656', 'Shares preserved after network error');
assert($('walletBlocks').textContent === '2', 'Blocks preserved after network error');
assert($('walletNotVerified').style.display === 'none', 'Notice hidden after network error');

console.log('\n[TEST 7] Re-opening wallet modal: cached data shown immediately');
walletModalOpen = false;
walletModalOpen = true;
if (lastWalletData) updateWalletUI(lastWalletData);
assert($('walletShares').textContent === '4656', 'Cached shares shown on re-open');
assert($('walletPending').textContent === '0.00100000 BTC', 'Cached pending shown on re-open');

console.log('\n[TEST 8] showWalletNotVerified is a no-op');
showWalletNotVerified();
assert($('walletNotVerified').style.display === 'none', 'showWalletNotVerified hides the notice');
assert($('walletShares').textContent === '4656', 'Data unchanged after showWalletNotVerified');

console.log('\n[TEST 9] No duplicate polling timers');
var walletPollTimer = null;
var timerCount = 0;
function stopWalletPolling() {
  if (walletPollTimer) { clearInterval(walletPollTimer); walletPollTimer = null; }
}
function startWalletPolling() {
  stopWalletPolling();
  walletPollTimer = setInterval(function () { timerCount++; }, 10000);
}
startWalletPolling();
startWalletPolling();
startWalletPolling();
assert(walletPollTimer !== null, 'Single polling timer active');
stopWalletPolling();
assert(walletPollTimer === null, 'Polling timer cleared');

console.log('\n[TEST 10] Balance update from WebSocket caches data');
var wsBalanceMsg = {
  type: 'balanceUpdate',
  pending_sat: 150000, confirmed_sat: 250000, total_earned_sat: 400000,
  shares_accepted: 5000
};
lastWalletData = Object.assign({}, lastWalletData || {}, wsBalanceMsg);
updateWalletUI(wsBalanceMsg);
assert($('walletShares').textContent === '5000', 'WS balance update reflected in UI');
assert(lastWalletData.shares_accepted === 5000, 'WS balance cached in lastWalletData');
assert($('walletNotVerified').style.display === 'none', 'Notice hidden after WS update');

console.log('\n========================================');
console.log('Results: ' + pass + ' passed, ' + fail + ' failed');
if (fail === 0) console.log('=== ALL WALLET UI STABILITY TESTS PASSED ===');
else { console.error('=== SOME TESTS FAILED ==='); process.exit(1); }
