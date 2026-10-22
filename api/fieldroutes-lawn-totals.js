'use strict';

const { loadLawnTotals } = require('./lib/lawn-totals');

const CACHE_TTL_MS = 10 * 60 * 1000;
const NOT_CONFIGURED = 'FieldRoutes not configured';

let memoryCache = { body: null, expiresAt: 0 };

function resetLawnTotalsCache() {
  memoryCache = { body: null, expiresAt: 0 };
}

function nonempty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function readConfig() {
  const baseUrl = process.env.FIELDROUTES_BASE_URL;
  const authenticationKey = process.env.FIELDROUTES_AUTH_KEY;
  const authenticationToken = process.env.FIELDROUTES_AUTH_TOKEN;
  if (!nonempty(baseUrl) || !nonempty(authenticationKey) || !nonempty(authenticationToken)) {
    return null;
  }
  return {
    baseUrl: baseUrl.trim(),
    authenticationKey: authenticationKey.trim(),
    authenticationToken: authenticationToken.trim(),
  };
}

function safeError(err, secrets) {
  let message = err && err.message ? String(err.message) : 'FieldRoutes request failed';
  for (const secret of secrets) {
    if (secret && message.includes(secret)) return 'FieldRoutes request failed';
  }
  return message.slice(0, 300);
}

async function handler(req, res) {
  if (!req || req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const config = readConfig();
  if (!config) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: NOT_CONFIGURED });
    return;
  }

  const now = Date.now();
  if (memoryCache.body && memoryCache.expiresAt > now) {
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=60');
    res.status(200).json(memoryCache.body);
    return;
  }

  try {
    const body = await loadLawnTotals(config);
    memoryCache = { body, expiresAt: now + CACHE_TTL_MS };
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=60');
    res.status(200).json(body);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({
      error: safeError(err, [config.authenticationKey, config.authenticationToken]),
    });
  }
}

module.exports = handler;
module.exports.resetLawnTotalsCache = resetLawnTotalsCache;
module.exports.NOT_CONFIGURED = NOT_CONFIGURED;
module.exports.CACHE_TTL_MS = CACHE_TTL_MS;
