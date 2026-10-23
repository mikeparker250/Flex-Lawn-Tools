'use strict';

// Flex CRM (https://flexpestcontrolquote.vercel.app) loads Dashboards → Inventory
// with supabase.functions.invoke('fetch-inventory?collection=inventory', { method: 'GET' }).
// The function reads Firestore project premium-inventory-app, collection inventory.
// A logged-out client sends the project's publishable key as the apikey header.
const DEFAULT_INVENTORY_URL = 'https://nsfdndlxrcionqqsydzy.supabase.co/functions/v1/fetch-inventory?collection=inventory';
const BENTONVILLE_WAREHOUSE_ID = 'J29nPerDyPRDoVqg1Wsf';
const LAWN_CATEGORY = 'lawn products';

function nonempty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function readConfig(env, defaults) {
  const source = env || process.env;
  const fallback = defaults || {};
  const key = nonempty(source.FLEXQUOTE_SUPABASE_PUBLISHABLE_KEY)
    ? source.FLEXQUOTE_SUPABASE_PUBLISHABLE_KEY.trim()
    : (nonempty(fallback.key) ? fallback.key.trim() : '');
  if (!key) return null;
  const url = nonempty(source.FLEXQUOTE_INVENTORY_URL)
    ? source.FLEXQUOTE_INVENTORY_URL.trim()
    : (nonempty(fallback.url) ? fallback.url.trim() : DEFAULT_INVENTORY_URL);
  return { url, key };
}

function readQuantity(item) {
  if (!item) return 0;
  if (item.quantity != null && item.quantity !== '') return item.quantity;
  if (item.onHand != null && item.onHand !== '') return item.onHand;
  return 0;
}

function isBentonville(item) {
  const id = item.warehouseId || item.warehouse_id || '';
  if (id === BENTONVILLE_WAREHOUSE_ID) return true;
  const path = String(item._path || '');
  return path.includes('/warehouses/' + BENTONVILLE_WAREHOUSE_ID + '/');
}

function isLawn(item) {
  return String(item.category == null ? '' : item.category).trim().toLowerCase() === LAWN_CATEGORY;
}

function toLawnProduct(item) {
  return {
    id: item.id == null ? null : String(item.id),
    name: item.name || item.productName || '',
    category: String(item.category || '').trim(),
    unit: item.unit == null ? '' : String(item.unit),
    onHand: readQuantity(item),
    warehouseId: BENTONVILLE_WAREHOUSE_ID,
    warehouseName: item.warehouseName || 'Bentonville',
    updatedAt: item.updatedAt || item._updated_at || null,
  };
}

function bentonvilleLawnProducts(payload) {
  const items = payload && Array.isArray(payload.items) ? payload.items : [];
  const out = [];
  for (const item of items) {
    if (!item || !isBentonville(item) || !isLawn(item)) continue;
    const product = toLawnProduct(item);
    if (product.name) out.push(product);
  }
  return out;
}

module.exports = {
  DEFAULT_INVENTORY_URL,
  BENTONVILLE_WAREHOUSE_ID,
  readConfig,
  readQuantity,
  bentonvilleLawnProducts,
};
