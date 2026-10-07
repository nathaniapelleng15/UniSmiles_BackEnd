'use strict';

const readline = require('readline/promises');
const path = require('node:path');
const { stdin, stdout } = require('process');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const feed = require('../services/gopayMerchantClient');

const readMasked = prompt => new Promise((resolve, reject) => {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    reject(new Error('OTP login requires an interactive terminal.'));
    return;
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let value = '';

  const finish = (error, result) => {
    stdin.removeListener('data', onData);
    stdin.setRawMode(false);
    stdout.write('\n');
    if (error) reject(error);
    else resolve(result);
  };

  const onData = chunk => {
    for (const character of chunk) {
      if (character === '\u0003') return finish(new Error('Login dibatalkan.'));
      if (character === '\r' || character === '\n') return finish(null, value);
      if (character === '\u007f' || character === '\b') {
        if (value.length) {
          value = value.slice(0, -1);
          stdout.write('\b \b');
        }
        continue;
      }
      if (/^\d$/.test(character) && value.length < 8) {
        value += character;
        stdout.write('*');
      }
    }
  };
  stdin.on('data', onData);
});

const askPhone = async () => {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question('Nomor ponsel GoPay Merchant (format nasional): ')).trim();
  } finally {
    rl.close();
  }
};

const main = async () => {
  const sessionPath = feed.resolveSessionPath(
    process.env.GOPAY_MERCHANT_SESSION_PATH || process.env.GOPAY_POC_SESSION_PATH || feed.defaultSessionPath
  );
  const phone = await askPhone();
  if (!phone) throw new Error('Nomor ponsel kosong; tidak ada permintaan OTP yang dikirim.');

  const client = new feed.GoPayMerchantClient();
  const otpData = await client.requestOtp(phone);
  if (typeof otpData.otp_token !== 'string' || !otpData.otp_token) {
    throw new Error('GoPay did not return a usable OTP challenge.');
  }
  stdout.write(`Permintaan OTP dikirim${otpData.otp_length ? ` (${otpData.otp_length} digit)` : ''}.\n`);
  const otp = await readMasked('Masukkan OTP (input disamarkan): ');
  if (!otp) throw new Error('OTP kosong; sesi tidak disimpan.');

  const session = await client.loginWithOtp(otp, otpData.otp_token);
  await feed.saveSession(sessionPath, session);
  stdout.write('Login berhasil; sesi disimpan dengan izin file private di luar repository.\n');
  stdout.write('OTP dan token tidak dicetak atau ditambahkan ke repository.\n');
};

main().catch(error => {
  const message = String(error && error.message || 'unknown_error').slice(0, 180);
  console.error(`Login GoPay gagal: ${message}`);
  process.exitCode = 1;
});
