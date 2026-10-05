const { execFile } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const BACKEND_DIR = path.resolve(__dirname, '..');

const readConfig = () => {
  const enabled = String(process.env.GOPAY_MERCHANT_ENABLED || '').toLowerCase() === 'true';
  const merchantId = String(process.env.GOPAY_MERCHANT_ID || '').trim();
  const python = String(process.env.GOPAY_MERCHANT_PYTHON || '').trim();
  const sessionPath = String(
    process.env.GOPAY_MERCHANT_SESSION_PATH || process.env.GOPAY_POC_SESSION_PATH || ''
  ).trim();

  if (!enabled) return { enabled: false };
  if (!merchantId || !python || !sessionPath) {
    throw new Error('GoPay Merchant is enabled but its merchant ID, Python path, or external session path is missing.');
  }

  const intervalMs = Number(process.env.GOPAY_MERCHANT_POLL_INTERVAL_MS) || 10000;
  if (intervalMs < 10000) {
    throw new Error('GoPay Merchant polling interval must be at least 10000 ms.');
  }

  return { enabled, merchantId, python, sessionPath, intervalMs };
};

const fetchTransactions = async (config = readConfig()) => {
  if (!config.enabled) return null;

  const args = [
    '-m', 'gopay_merchant_poc.cli', 'feed',
    '--merchant-id', config.merchantId,
    '--days', '1',
    '--limit', '100',
  ];

  try {
    const { stdout } = await execFileAsync(config.python, args, {
      cwd: BACKEND_DIR,
      timeout: Number(process.env.GOPAY_MERCHANT_POLL_TIMEOUT_MS) || 30000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        GOPAY_POC_SESSION_PATH: config.sessionPath,
      },
    });
    const feed = JSON.parse(String(stdout || '').trim());
    if (feed.merchant_id !== config.merchantId || !Array.isArray(feed.transactions)) {
      throw new Error('GoPay Merchant feed returned an unexpected shape.');
    }
    return feed;
  } catch (error) {
    const code = error.code || error.name || 'provider_error';
    const safeError = new Error(`GoPay Merchant feed failed (${String(code).slice(0, 40)}).`);
    safeError.code = code;
    throw safeError;
  }
};

module.exports = { readConfig, fetchTransactions };
