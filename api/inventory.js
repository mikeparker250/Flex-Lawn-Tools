'use strict';

const {
  readConfig,
  bentonvilleLawnProducts,
  BENTONVILLE_WAREHOUSE_ID,
} = require('./lib/inventory');

const CACHE_TTL_MS = 5 * 60 * 1000;
const NOT_CONFIGURED = 'Inventory not configured';

let memoryCache = { body: null, expiresAt: 0 };

function resetInventoryCache() {
  memoryCache = { body: null, expiresAt: 0 };
}

function safeError(err, secret) {
  let message = err && err.message ? String(err.message) : 'Inventory request failed';
  if (secret && message.includes(secret)) message = 'Inventory request failed';
  return message.slice(0, 300);
}

async function fetchInventory(config, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  const res = await doFetch(config.url, {
    method: 'GET',
    headers: {
      apikey: config.key,
      Authorization: 'Bearer ' + config.key,
      Accept: 'application/json',
    },
  });
  if (!res || !res.ok) {
    const status = res && res.status ? res.status : 0;
    throw new Error('Inventory request failed (' + status + ')');
  }
  const payload = await res.json();
  if (!payload || payload.ok === false || !Array.isArray(payload.items)) {
    throw new Error('Inventory request failed');
  }
  const items = bentonvilleLawnProducts(payload);
  return {
    ok: true,
    source: 'fetch-inventory',
    warehouseId: BENTONVILLE_WAREHOUSE_ID,
    warehouseName: 'Bentonville',
    category: 'Lawn Products',
    fetched_at: payload.fetched_at || null,
    count: items.length,
    items,
  };
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
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    res.status(200).json(memoryCache.body);
    return;
  }

  try {
    const body = await fetchInventory(config);
    memoryCache = { body, expiresAt: now + CACHE_TTL_MS };
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    res.status(200).json(body);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: safeError(err, config.key) });
  }
}

module.exports = handler;
module.exports.resetInventoryCache = resetInventoryCache;
module.exports.fetchInventory = fetchInventory;
module.exports.NOT_CONFIGURED = NOT_CONFIGURED;
module.exports.CACHE_TTL_MS = CACHE_TTL_MS;
