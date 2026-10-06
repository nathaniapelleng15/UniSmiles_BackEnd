'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const feed = require('../services/gopayMerchantFeed');
const sessionImport = require('../services/gopayMerchantSessionImport');

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json' },
});

const withEnv = async (values, fn) => {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('GoPay polling config no longer requires a Python interpreter', async () => {
  await withEnv({
    GOPAY_MERCHANT_ENABLED: 'true',
    GOPAY_MERCHANT_ID: 'merchant-test',
    GOPAY_MERCHANT_SESSION_PATH: '/tmp/unismiles-gopay-test/session.json',
    GOPAY_MERCHANT_PYTHON: undefined,
    GOPAY_POC_SESSION_PATH: undefined,
    GOPAY_MERCHANT_POLL_INTERVAL_MS: '10000',
    GOPAY_MERCHANT_POLL_TIMEOUT_MS: '30000',
  }, () => {
    const config = feed.readConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.merchantId, 'merchant-test');
    assert.equal(config.sessionPath, '/tmp/unismiles-gopay-test/session.json');
    assert.equal(config.timeoutMs, 30000);
    assert.equal('python' in config, false);
  });
});

test('GoPay sessions are written with private permissions and can be reloaded', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'unismiles-gopay-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sessionPath = path.join(directory, 'session.json');
  const session = { access_token: 'test-access', refresh_token: 'test-refresh' };

  await feed.saveSession(sessionPath, session);
  assert.deepEqual(await feed.loadSession(sessionPath), session);
  if (process.platform !== 'win32') {
    const mode = (await fs.stat(sessionPath)).mode & 0o777;
    assert.equal(mode, 0o600);
    assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
  }
});

test('production session import is one-time, external, and stores no token in its marker', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'unismiles-gopay-import-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sessionPath = path.join(directory, 'session.json');
  const session = { access_token: 'secret-access-token', refresh_token: 'secret-refresh-token' };

  await withEnv({
    GOPAY_SESSION_IMPORT_ENABLED: 'true',
    GOPAY_MERCHANT_SESSION_PATH: sessionPath,
    GOPAY_POC_SESSION_PATH: undefined,
  }, async () => {
    assert.equal(await sessionImport.importSessionOnce(session), sessionPath);
    assert.deepEqual(await feed.loadSession(sessionPath), session);

    const marker = await fs.readFile(`${sessionPath}.imported-once`, 'utf8');
    assert.equal(marker, 'imported\n');
    assert.equal(marker.includes(session.access_token), false);
    assert.equal(marker.includes(session.refresh_token), false);

    await assert.rejects(sessionImport.importSessionOnce({
      access_token: 'replacement-access', refresh_token: 'replacement-refresh',
    }), error => error.code === 'SESSION_ALREADY_IMPORTED');
    assert.deepEqual(await feed.loadSession(sessionPath), session);
  });
});

test('production session import is closed unless the explicit feature flag is enabled', async () => {
  await withEnv({
    GOPAY_SESSION_IMPORT_ENABLED: undefined,
    GOPAY_MERCHANT_SESSION_PATH: '/tmp/unismiles-gopay-import-disabled/session.json',
  }, async () => {
    await assert.rejects(sessionImport.importSessionOnce({
      access_token: 'test-access-token', refresh_token: 'test-refresh-token',
    }), error => error.code === 'IMPORT_DISABLED');
  });
});

test('GoPay session files inside the repository are rejected', () => {
  assert.throws(() => feed.resolveSessionPath(path.join(__dirname, '..', 'session.json')), /outside the application repository/);
});

test('transaction summaries normalize minor-unit amounts and discard control characters', () => {
  assert.equal(feed.amountToRupiah(1250000), 12500);
  assert.equal(feed.amountToRupiah('1250000'), 12500);
  assert.equal(feed.amountToRupiah('1250001'), null);
  assert.equal(feed.amountToRupiah(Number.MAX_SAFE_INTEGER), null);
  assert.deepEqual(feed.summarizeTransaction({
    id: 'tx-1',
    gross_amount: 1250000,
    transaction_status: ' settlement\n',
    payment_type: 'qris',
    channel_type: '\u001b[31mQRIS\u001b[0m',
    transaction_time: '2026-10-05T00:00:00Z',
    private_payload: 'must-not-be-forwarded',
  }), {
    transaction_id: 'tx-1',
    amount_rupiah: 12500,
    transaction_status: 'settlement',
    payment_type: 'qris',
    channel_type: 'QRIS',
    transaction_time: '2026-10-05T00:00:00Z',
  });
});

test('expired feed token refreshes once and persists rotated session through injected adapter', async () => {
  const calls = [];
  let persistedSession = null;
  let analyticsCalls = 0;
  const client = new feed.GoPayMerchantClient({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    onSession: async session => { persistedSession = session; },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/merchant-analytics/')) {
        analyticsCalls += 1;
        if (analyticsCalls === 1) return jsonResponse({ message: 'expired token' }, 401);
        return jsonResponse({ transactions: [] });
      }
      return jsonResponse({ access_token: 'new-access', refresh_token: 'new-refresh' });
    },
  });

  const result = await client.analytics('merchant-test', { days: 1, limit: 100 });
  assert.deepEqual(result.transactions, []);
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /\/goid\/token$/);
  assert.equal(JSON.parse(calls[1].options.body).grant_type, 'refresh_token');
  assert.deepEqual(persistedSession, { access_token: 'new-access', refresh_token: 'new-refresh' });
  assert.equal(calls[2].options.headers.Authorization, 'Bearer new-access');
});

test('feed calls are testable without contacting the provider and return sanitized rows', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'unismiles-gopay-feed-'));
  try {
    const sessionPath = path.join(directory, 'session.json');
    await feed.saveSession(sessionPath, { access_token: 'test-access', refresh_token: 'test-refresh' });
    const result = await feed.fetchTransactions({
      enabled: true,
      merchantId: 'merchant-test',
      sessionPath,
      timeoutMs: 1000,
    }, {
      fetchImpl: async (url, options) => {
        assert.match(url, /merchant-analytics\/v2\/merchants\/transactions/);
        assert.equal(options.headers.Authorization, 'Bearer test-access');
        return jsonResponse({ transactions: [{
          transaction_id: 'tx-feed',
          gross_amount: 2250000,
          transaction_status: 'SETTLEMENT',
          payment_type: 'QRIS',
          transaction_time: '2026-10-05T00:00:00Z',
          sensitive: 'omitted',
        }] });
      },
    });
    assert.equal(result.merchant_id, 'merchant-test');
    assert.equal(result.transactions[0].amount_rupiah, 22500);
    assert.equal('sensitive' in result.transactions[0], false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
