'use strict';

const { importSessionOnce, isEnabled } = require('../services/gopayMerchantSessionImport');

const importSession = async (req, res) => {
  // Keep the temporary credential-transfer endpoint invisible unless an
  // operator explicitly opens the short import window in production config.
  if (!isEnabled()) return res.status(404).json({ success: false, message: 'Not found.' });
  if (process.env.NODE_ENV === 'production' && !req.secure) {
    return res.status(400).json({ success: false, message: 'HTTPS is required.' });
  }
  if (!req.is('application/json')) {
    return res.status(415).json({ success: false, message: 'Content-Type must be application/json.' });
  }

  const body = req.body;
  const allowedKeys = new Set(['access_token', 'refresh_token']);
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !allowedKeys.has(key))
    || typeof body.access_token !== 'string' || !body.access_token.trim()
    || typeof body.refresh_token !== 'string' || !body.refresh_token.trim()
    || body.access_token.length > 8192 || body.refresh_token.length > 8192) {
    return res.status(400).json({ success: false, message: 'Invalid session payload.' });
  }

  try {
    await importSessionOnce({
      access_token: body.access_token,
      refresh_token: body.refresh_token,
    });
    return res.status(201).json({
      success: true,
      message: 'GoPay Merchant session imported. Disable GOPAY_SESSION_IMPORT_ENABLED and restart the API.',
    });
  } catch (error) {
    if (error.code === 'SESSION_ALREADY_IMPORTED' || error.code === 'SESSION_EXISTS') {
      return res.status(409).json({ success: false, message: 'A GoPay session is already installed.' });
    }
    if (error.code === 'IMPORT_DISABLED') {
      return res.status(404).json({ success: false, message: 'Not found.' });
    }
    // Never log request bodies, session tokens, or storage paths.
    return res.status(500).json({ success: false, message: 'Unable to import GoPay session.' });
  }
};

module.exports = { importSession };
