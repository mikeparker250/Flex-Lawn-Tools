'use strict';

const {
  readConfig,
  bentonvilleLawnProducts,
  BENTONVILLE_WAREHOUSE_ID,
} = require('./lib/inventory');

// Public client key from the Flex CRM bundle
// https://flexpestcontrolquote.vercel.app/assets/App-DRiUxnON.js
// (createClient url GFe, key KFe). This is the CRM's public client key
// and not a secret. A logged-out browser sends it as the apikey header.
// process.env.FLEXQUOTE_SUPABASE_PUBLISHABLE_KEY overrides it when set.
const PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_7glZuC62QDH5bTl0ZiY18g_WVF1vKeh';

// Same public fetch-inventory URL the CRM calls: the bundle's Supabase host
// plus functions/v1/fetch-inventory?collection=inventory. Not a secret.
// process.env.FLEXQUOTE_INVENTORY_URL overrides it when set.
const PUBLIC_INVENTORY_URL = 'https://nsfdndlxrcionqqsydzy.supabase.co/functions/v1/fetch-inventory?collection=inventory';

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

  const config = readConfig(process.env, {
    key: PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    url: PUBLIC_INVENTORY_URL,
  });
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
module.exports.PUBLIC_SUPABASE_PUBLISHABLE_KEY = PUBLIC_SUPABASE_PUBLISHABLE_KEY;
module.exports.PUBLIC_INVENTORY_URL = PUBLIC_INVENTORY_URL;
