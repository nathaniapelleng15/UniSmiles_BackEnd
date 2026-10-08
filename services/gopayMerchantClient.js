'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '..');
const DEFAULT_SESSION_PATH = path.join(
  os.homedir(), '.local', 'share', 'unismiles-gopay-merchant-poc', 'session.json'
);
const API_BASE_URL = 'https://api.gobiz.co.id';
const ANALYTICS_BASE_URL = 'https://api.gojekapi.com';
const CLIENT_ID = 'go-biz-web-new';
const APP_ID = 'go-biz-web-dashboard';
const APP_VERSION = 'platform-v3.122.0-72edb090';
const PORTAL_ORIGIN = 'https://portal.gofoodmerchant.co.id';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const DEFAULT_STATUSES = 'SETTLEMENT,CAPTURE,REFUND,PARTIAL_REFUND';
const DEFAULT_PAYMENT_TYPES = 'QRIS,GOPAY,OFFLINE_CREDIT_CARD,OFFLINE_DEBIT_CARD,CREDIT_CARD';

const expandHome = value => value === '~' || value.startsWith(`~${path.sep}`)
  ? path.join(os.homedir(), value.slice(1))
  : value;

const resolveSessionPath = rawPath => {
  const sessionPath = path.resolve(expandHome(String(rawPath || DEFAULT_SESSION_PATH).trim()));
  const relativeToBackend = path.relative(BACKEND_DIR, sessionPath);
  if (relativeToBackend === '' || (!relativeToBackend.startsWith(`..${path.sep}`) && relativeToBackend !== '..' && !path.isAbsolute(relativeToBackend))) {
    throw new Error('GoPay session file must be outside the application repository.');
  }
  return sessionPath;
};

const readConfig = () => {
  const enabled = String(process.env.GOPAY_MERCHANT_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) return { enabled: false };

  const merchantId = String(process.env.GOPAY_MERCHANT_ID || '').trim();
  const configuredSessionPath = String(
    process.env.GOPAY_MERCHANT_SESSION_PATH || process.env.GOPAY_POC_SESSION_PATH || DEFAULT_SESSION_PATH
  ).trim();
  if (!merchantId || !configuredSessionPath) {
    throw new Error('GoPay Merchant is enabled but merchant ID or external session path is missing.');
  }

  return {
    enabled: true,
    merchantId,
    sessionPath: resolveSessionPath(configuredSessionPath),
    timeoutMs: Number(process.env.GOPAY_MERCHANT_POLL_TIMEOUT_MS) || 30000,
  };
};

const assertSessionShape = session => {
  if (!session || typeof session !== 'object'
    || typeof session.access_token !== 'string' || !session.access_token.trim()
    || typeof session.refresh_token !== 'string' || !session.refresh_token.trim()) {
    throw new Error('GoPay session file is missing a valid access or refresh token.');
  }
  return { access_token: session.access_token, refresh_token: session.refresh_token };
};

const loadSession = async sessionPath => {
  const resolvedPath = resolveSessionPath(sessionPath);
  let stat;
  try {
    stat = await fs.lstat(resolvedPath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('No GoPay Merchant session found. Run the Node login command first.');
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('GoPay session path must be a regular file, not a symbolic link.');
  if (process.platform !== 'win32') await fs.chmod(resolvedPath, 0o600);

  let session;
  try {
    session = JSON.parse(await fs.readFile(resolvedPath, 'utf8'));
  } catch (_) {
    throw new Error('GoPay session file is invalid JSON. Log in again to create a new session.');
  }
  return assertSessionShape(session);
};

const saveSession = async (sessionPath, session) => {
  const clean = assertSessionShape(session);
  const resolvedPath = resolveSessionPath(sessionPath);
  const directory = path.dirname(resolvedPath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await fs.chmod(directory, 0o700);
  try {
    const existing = await fs.lstat(resolvedPath);
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Error('Refusing to replace a non-regular GoPay session file.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const temporaryPath = path.join(directory, `.session-${process.pid}-${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(clean), 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, resolvedPath);
    if (process.platform !== 'win32') await fs.chmod(resolvedPath, 0o600);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporaryPath).catch(() => {});
  }
  return resolvedPath;
};

class GoPayMerchantClient {
  constructor({ accessToken = null, refreshToken = null, fetchImpl = globalThis.fetch, timeoutMs = 15000, onSession = null } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Node.js fetch is unavailable. Use Node.js 18 or newer.');
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.onSession = onSession;
    this.uniqueId = crypto.randomUUID();
  }

  setSession(session) {
    const clean = assertSessionShape(session);
    this.accessToken = clean.access_token;
    this.refreshToken = clean.refresh_token;
    return clean;
  }

  headers(authCall = false) {
    const headers = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Authentication-Type': 'go-id',
      Authorization: this.accessToken ? `Bearer ${this.accessToken}` : 'Bearer',
      'Content-Type': 'application/json',
      Origin: PORTAL_ORIGIN,
      Referer: `${PORTAL_ORIGIN}/`,
      'User-Agent': USER_AGENT,
    };
    if (authCall) Object.assign(headers, {
      'Accept-Language': 'id',
      'Gojek-Country-Code': 'ID',
      'Gojek-Timezone': 'Asia/Jakarta',
      'X-AppVersion': APP_VERSION,
      'X-PhoneMake': 'Windows 10 64-bit',
      'X-PhoneModel': 'Chrome 149.0.0.0 on Windows 10 64-bit',
      'X-Platform': 'Web',
      'X-User-Locale': 'en-US',
      'X-User-Type': 'merchant',
      'x-DeviceOS': 'Web',
      'x-appId': APP_ID,
      'x-uniqueid': this.uniqueId,
    });
    return headers;
  }

  async request(method, url, body, { authCall = false, retryAuth = true } = {}) {
    let response;
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: this.headers(authCall),
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        break;
      } catch (error) {
        const retryable = ['AbortError', 'TimeoutError', 'TypeError'].includes(error.name);
        if (attempt === 0 && retryable) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        const safe = new Error(`GoPay Merchant request failed (${String(error.code || error.name || 'network_error').slice(0, 40)}).`);
        safe.code = error.code || error.name || 'network_error';
        throw safe;
      }
    }

    let data;
    try {
      data = await response.json();
    } catch (_) {
      throw new Error(`GoPay Merchant returned invalid JSON (HTTP ${response.status}).`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`GoPay Merchant returned an unexpected response (HTTP ${response.status}).`);
    }
    const tokenExpired = data.success === false && String(data.error || '').toLowerCase().includes('expired token');
    if (!response.ok || tokenExpired) {
      const status = tokenExpired ? 401 : response.status;
      const error = new Error(`GoPay Merchant rejected the request (HTTP ${status}).`);
      error.status = status;
      if (!authCall && retryAuth && [401, 403].includes(status) && this.refreshToken) {
        await this.refresh();
        return this.request(method, url, body, { authCall, retryAuth: false });
      }
      throw error;
    }
    return data;
  }

  async postAuth(pathname, body) {
    return this.request('POST', `${API_BASE_URL}${pathname}`, body, { authCall: true });
  }

  async requestOtp(phoneNumber, countryCode = '62') {
    const phone = String(phoneNumber || '').trim().replace(/[\s\-().]/g, '').replace(/^\+/, '');
    const nationalNumber = (phone.startsWith(countryCode) && phone.length > countryCode.length + 5
      ? phone.slice(countryCode.length)
      : phone).replace(/^0/, '');
    if (!/^\d{7,}$/.test(nationalNumber)) throw new Error('Phone number must contain at least seven dialable digits.');
    const response = await this.postAuth('/goid/login/request', {
      client_id: CLIENT_ID,
      phone_number: nationalNumber,
      country_code: countryCode,
    });
    return response.data && typeof response.data === 'object' ? response.data : response;
  }

  async loginWithOtp(otp, otpToken) {
    const code = String(otp || '').trim();
    if (!/^\d{4,8}$/.test(code) || typeof otpToken !== 'string' || !otpToken.trim()) {
      throw new Error('OTP or temporary login token is invalid.');
    }
    const session = await this.postAuth('/goid/token', {
      client_id: CLIENT_ID,
      grant_type: 'otp',
      data: { otp: code, otp_token: otpToken },
    });
    return this.setSession(session);
  }

  async refresh() {
    if (!this.refreshToken) throw new Error('No GoPay refresh token is available. Log in again.');
    const previousUniqueId = this.uniqueId;
    this.uniqueId = crypto.randomUUID();
    try {
      const session = await this.postAuth('/goid/token', {
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        data: { refresh_token: this.refreshToken },
      });
      const updated = this.setSession(session);
      if (this.onSession) await this.onSession(updated);
      return updated;
    } finally {
      if (!this.accessToken) this.uniqueId = previousUniqueId;
    }
  }

  async analytics(merchantId, { days = 1, limit = 100 } = {}) {
    const now = new Date();
    const start = new Date(now.getTime() - days * 86400000);
    const zulu = date => `${date.toISOString().slice(0, 19)}.000Z`;
    const params = new URLSearchParams({
      from: '0',
      size: String(limit),
      statuses: DEFAULT_STATUSES,
      payment_types: DEFAULT_PAYMENT_TYPES,
      start_time: zulu(start),
      end_time: zulu(now),
      merchant_ids: merchantId,
    });
    return this.request('GET', `${ANALYTICS_BASE_URL}/merchant-analytics/v2/merchants/transactions?${params}`);
  }
}

const cleanText = (value, limit) => String(value || '')
  .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
  .replace(/[\x00-\x1f\x7f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, limit);

const amountToRupiah = rawAmount => {
  if ((typeof rawAmount !== 'number' && typeof rawAmount !== 'string') || String(rawAmount).trim() === '') return null;
  const minorUnits = Number(rawAmount);
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0 || minorUnits % 100 !== 0) return null;
  const rupiah = minorUnits / 100;
  return Number.isSafeInteger(rupiah) ? rupiah : null;
};

const summarizeTransaction = transaction => {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) return null;
  let transactionId = null;
  for (const field of ['transaction_id', 'id', 'order_id']) {
    const value = transaction[field];
    if (value !== null && value !== undefined && String(value).trim()) {
      transactionId = String(value).trim();
      break;
    }
  }
  return {
    transaction_id: transactionId,
    amount_rupiah: amountToRupiah(transaction.gross_amount),
    transaction_status: cleanText(transaction.transaction_status, 40),
    payment_type: cleanText(transaction.payment_type, 40),
    channel_type: cleanText(transaction.channel_type, 40),
    transaction_time: cleanText(transaction.transaction_time, 80),
  };
};

const fetchTransactions = async (config = readConfig(), dependencies = {}) => {
  if (!config.enabled) return null;
  const sessionPath = resolveSessionPath(config.sessionPath);
  const session = await loadSession(sessionPath);
  const client = new GoPayMerchantClient({
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    fetchImpl: dependencies.fetchImpl,
    timeoutMs: config.timeoutMs || 30000,
    onSession: refreshed => saveSession(sessionPath, refreshed),
  });

  const result = await client.analytics(config.merchantId, { days: 1, limit: 100 });

  if (!Array.isArray(result.transactions)) throw new Error('GoPay Merchant feed returned an unexpected shape.');
  return {
    merchant_id: config.merchantId,
    observed_at: new Date().toISOString(),
    transactions: result.transactions.map(summarizeTransaction).filter(Boolean),
  };
};

module.exports = {
  GoPayMerchantClient,
  amountToRupiah,
  defaultSessionPath: DEFAULT_SESSION_PATH,
  fetchTransactions,
  loadSession,
  readConfig,
  resolveSessionPath,
  saveSession,
  summarizeTransaction,
};
