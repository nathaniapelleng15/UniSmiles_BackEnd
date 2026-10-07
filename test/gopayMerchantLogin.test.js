'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const backendRoot = path.resolve(__dirname, '..');
const merchant = require('../services/gopayMerchantClient');

test('npm run gopay:login reaches the interactive CLI without requesting OTP for blank input', () => {
  const packageJson = require('../package.json');
  assert.equal(packageJson.scripts['gopay:login'], 'node scripts/gopay-merchant-login.js');

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', 'gopay:login'], {
    cwd: backendRoot,
    input: '\n',
    encoding: 'utf8',
    timeout: 15000,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;

  assert.equal(result.error, undefined, result.error && result.error.message);
  assert.equal(result.status, 1, output);
  assert.match(output, /> node scripts\/gopay-merchant-login\.js/);
  assert.match(output, /Nomor ponsel GoPay Merchant/);
  assert.match(output, /Nomor ponsel kosong; tidak ada permintaan OTP yang dikirim/);
  assert.doesNotMatch(output, /Permintaan OTP dikirim/);
});

test('OTP login client requests a challenge and accepts a token response', async () => {
  const requests = [];
  const responses = [
    { success: true, data: { otp_token: 'test-challenge', otp_length: 6 } },
    { access_token: 'test-access', refresh_token: 'test-refresh' },
  ];
  const client = new merchant.GoPayMerchantClient({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => responses.shift() };
    },
  });

  const challenge = await client.requestOtp('+62 812-3456-7890');
  assert.equal(challenge.otp_token, 'test-challenge');
  assert.equal(requests[0].url, 'https://api.gobiz.co.id/goid/login/request');
  assert.equal(JSON.parse(requests[0].options.body).phone_number, '81234567890');

  const session = await client.loginWithOtp('123456', challenge.otp_token);
  assert.deepEqual(session, { access_token: 'test-access', refresh_token: 'test-refresh' });
  assert.equal(requests[1].url, 'https://api.gobiz.co.id/goid/token');
});

test('saved login session matches the Python poller format and has private permissions', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gopay-login-test-'));
  const sessionPath = path.join(directory, 'session.json');
  try {
    const expected = { access_token: 'test-access', refresh_token: 'test-refresh' };
    await merchant.saveSession(sessionPath, expected);
    assert.deepEqual(JSON.parse(await fs.readFile(sessionPath, 'utf8')), expected);
    const stat = await fs.stat(sessionPath);
    if (process.platform !== 'win32') assert.equal(stat.mode & 0o777, 0o600);
    assert.deepEqual(await merchant.loadSession(sessionPath), expected);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
