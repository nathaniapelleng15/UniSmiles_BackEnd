'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const backendRoot = path.resolve(__dirname, '..');
const { parseSessionCode, runCheck } = require('../scripts/gopay-merchant-check');
const feedAdapter = require('../services/gopayMerchantFeed');

test('GoPay check is an explicit repo command, not a server-start poller', () => {
  const packageJson = require('../package.json');
  const server = fs.readFileSync(path.join(backendRoot, 'server.js'), 'utf8');

  assert.equal(packageJson.scripts['gopay:check'], 'node scripts/gopay-merchant-check.js');
  assert.doesNotMatch(server, /gopayMerchantPoller\.start\(\)/);
});

test('manual check accepts one session code and invokes the checker exactly once', async () => {
  const calls = [];
  const result = await runCheck(['AE5A04B4'], async sessionCode => {
    calls.push(sessionCode);
    return { sessionCode, paymentStatus: 'pending', observed: 3, matched: 0 };
  });

  assert.deepEqual(calls, ['AE5A04B4']);
  assert.equal(result.paymentStatus, 'pending');
});

test('manual check rejects missing, multiple, or unsafe session codes', () => {
  for (const args of [[], ['one', 'two'], ['../../other']]) {
    assert.throws(() => parseSessionCode(args), error => error.code === 'USAGE');
  }
});

test('one-shot feed config does not require an automatic polling interval', t => {
  const keys = [
    'GOPAY_MERCHANT_ENABLED', 'GOPAY_MERCHANT_ID', 'GOPAY_MERCHANT_PYTHON',
    'GOPAY_MERCHANT_SESSION_PATH', 'GOPAY_POC_SESSION_PATH', 'GOPAY_MERCHANT_POLL_INTERVAL_MS',
  ];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  process.env.GOPAY_MERCHANT_ENABLED = 'true';
  process.env.GOPAY_MERCHANT_ID = 'test-merchant';
  process.env.GOPAY_MERCHANT_PYTHON = 'python';
  process.env.GOPAY_MERCHANT_SESSION_PATH = 'private-session.json';
  process.env.GOPAY_MERCHANT_POLL_INTERVAL_MS = '1';

  assert.equal(feedAdapter.readConfig().enabled, true);
});
