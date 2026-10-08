'use strict';

const path = require('path');
const dotenv = require('dotenv');

const USAGE = 'Usage: npm run gopay:check -- <session_code>';

const parseSessionCode = argv => {
  if (!Array.isArray(argv) || argv.length !== 1) throw Object.assign(new Error(USAGE), { code: 'USAGE' });
  const sessionCode = String(argv[0] || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(sessionCode)) {
    throw Object.assign(new Error(USAGE), { code: 'USAGE' });
  }
  return sessionCode;
};

const runCheck = async (argv, checkSessionOnce) => {
  const sessionCode = parseSessionCode(argv);
  const check = checkSessionOnce || require('../services/gopayMerchantPoller').checkSessionOnce;
  return check(sessionCode);
};

const main = async (argv = process.argv.slice(2)) => {
  let pool;
  try {
    parseSessionCode(argv);
    dotenv.config({ path: path.resolve(__dirname, '../../.env') });
    dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

    const poller = require('../services/gopayMerchantPoller');
    pool = require('../config/db');
    const result = await runCheck(argv, poller.checkSessionOnce);
    console.log(
      `Sesi ${result.sessionCode}: ${result.paymentStatus}; ` +
      `feed diperiksa ${result.observed}, cocok ${result.matched}.`
    );
    if (result.paymentStatus !== 'verified') {
      console.log('Pembayaran belum terverifikasi. Jangan transfer ulang sebelum status transaksi dipastikan.');
    }
  } catch (error) {
    const code = String(error.code || error.name || 'CHECK_FAILED').slice(0, 40);
    console.error(`Pengecekan GoPay gagal (${code}).`);
    if (error.code === 'USAGE') console.error(error.message);
    process.exitCode = error.code === 'USAGE' ? 2 : 1;
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
};

if (require.main === module) void main();

module.exports = { parseSessionCode, runCheck };
