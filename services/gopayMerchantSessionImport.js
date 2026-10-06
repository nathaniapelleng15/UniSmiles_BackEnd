'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const feed = require('./gopayMerchantFeed');

const isEnabled = () => String(process.env.GOPAY_SESSION_IMPORT_ENABLED || '').toLowerCase() === 'true';

const makeError = (code, message) => Object.assign(new Error(message), { code });

/**
 * Install a GoPay session exactly once, using the external path already used by
 * the poller. A persistent sibling marker prevents a later process restart from
 * silently re-opening the import endpoint.
 */
const importSessionOnce = async (session, { sessionPath } = {}) => {
  if (!isEnabled()) throw makeError('IMPORT_DISABLED', 'Session import is disabled.');

  const configuredPath = String(
    sessionPath || process.env.GOPAY_MERCHANT_SESSION_PATH || process.env.GOPAY_POC_SESSION_PATH || ''
  ).trim();
  if (!configuredPath) throw makeError('SESSION_PATH_MISSING', 'Session path is not configured.');

  const resolvedPath = feed.resolveSessionPath(configuredPath);
  const directory = path.dirname(resolvedPath);
  const markerPath = `${resolvedPath}.imported-once`;

  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await fs.chmod(directory, 0o700);

  let marker;
  try {
    marker = await fs.open(markerPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw makeError('SESSION_ALREADY_IMPORTED', 'A session has already been imported.');
    }
    throw error;
  }

  let imported = false;
  try {
    try {
      await fs.lstat(resolvedPath);
      throw makeError('SESSION_EXISTS', 'A session file already exists.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    await feed.saveSession(resolvedPath, session);
    await marker.writeFile('imported\n', 'utf8');
    await marker.sync();
    imported = true;
    return resolvedPath;
  } finally {
    await marker.close().catch(() => {});
    if (!imported) await fs.unlink(markerPath).catch(() => {});
  }
};

module.exports = { importSessionOnce, isEnabled };
