import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const inventory = require('../api/lib/inventory.js');
const handler = require('../api/inventory.js');

const fixture = JSON.parse(readFileSync(new URL('./fixtures/inventory-dashboard.json', import.meta.url), 'utf8'));

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('the dashboard fixture is Bentonville-filterable and keeps Lawn Products only', () => {
  assert.equal(fixture.fetched_at, '2026-10-22T23:52:38.933Z');
  assert.equal(fixture.collection, 'inventory');
  assert.equal(fixture.project_id, 'premium-inventory-app');
  const lawn = inventory.bentonvilleLawnProducts(fixture);
  assert.equal(lawn.length, 39);
  assert.equal(lawn.every(item => item.warehouseId === 'J29nPerDyPRDoVqg1Wsf'), true);
  assert.equal(lawn.every(item => item.category === 'Lawn Products'), true);
  const names = new Set(lawn.map(item => item.name.trim()));
  assert.equal(names.has('Specticle FLO'), true);
  assert.equal(names.has('Triad Select'), true);
  assert.equal(names.has('Artavia SC (Azoxystrobin)'), true);
  assert.equal(names.has('Simazine 4L'), true);
  assert.equal(names.has('Sulfentrazone'), true);
  const specticle = lawn.find(item => item.name.trim() === 'Specticle FLO');
  assert.equal(specticle.onHand, 0);
  assert.equal(specticle.unit.trim(), 'Bottles');
});

test('quantity from the edge function is used when the dashboard onHand field is absent', () => {
  const products = inventory.bentonvilleLawnProducts({
    items: [
      {
        id: 'raw-1',
        name: 'Specticle FLO',
        category: 'Lawn Products',
        unit: 'Bottles',
        quantity: 4,
        warehouseId: 'J29nPerDyPRDoVqg1Wsf',
        _updated_at: '2026-04-30T20:43:23.634319Z',
      },
      {
        id: 'path-only',
        name: 'Triad Select',
        category: ' lawn products ',
        unit: 'Jugs',
        quantity: 0,
        _path: 'companies/940AB322-F85A-4883-8EBA-C151A88F3AD9/warehouses/J29nPerDyPRDoVqg1Wsf/inventory/path-only',
      },
      {
        id: 'pest',
        name: 'Bora Care',
        category: 'Pest Products',
        quantity: 11,
        warehouseId: 'J29nPerDyPRDoVqg1Wsf',
      },
      {
        id: 'other-wh',
        name: 'Specticle FLO',
        category: 'Lawn Products',
        quantity: 9,
        warehouseId: 'ImsYYDCLRoAgF4u3HtEe',
      },
    ],
  });
  assert.deepEqual(products.map(item => [item.name.trim(), item.onHand, item.unit]), [
    ['Specticle FLO', 4, 'Bottles'],
    ['Triad Select', 0, 'Jugs'],
  ]);
  assert.equal(products[0].updatedAt, '2026-04-30T20:43:23.634319Z');
});

test('unset env falls back to the public CRM client key and URL', async () => {
  const prevKey = process.env.FLEXQUOTE_SUPABASE_PUBLISHABLE_KEY;
  const prevUrl = process.env.FLEXQUOTE_INVENTORY_URL;
  delete process.env.FLEXQUOTE_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.FLEXQUOTE_INVENTORY_URL;
  handler.resetInventoryCache();
  assert.equal(inventory.readConfig({}), null);
  assert.equal(handler.PUBLIC_INVENTORY_URL, inventory.DEFAULT_INVENTORY_URL);
  assert.match(handler.PUBLIC_SUPABASE_PUBLISHABLE_KEY, /^sb_publishable_[A-Za-z0-9_-]+$/);
  const source = readFileSync(new URL('../api/inventory.js', import.meta.url), 'utf8');
  assert.match(source, /public client key/i);
  assert.match(source, /not a secret/i);
  let calls = 0;
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    calls += 1;
    assert.equal(url, handler.PUBLIC_INVENTORY_URL);
    assert.equal(opts.headers.apikey, handler.PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    assert.equal(opts.headers.Authorization, 'Bearer ' + handler.PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true, fetched_at: fixture.fetched_at, items: fixture.items };
      },
    };
  };
  try {
    const res = mockRes();
    await handler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.count, 39);
    assert.equal(JSON.stringify(res.body).includes(handler.PUBLIC_SUPABASE_PUBLISHABLE_KEY), false);
    assert.match(res.headers['cache-control'], /s-maxage=300/);
    const cached = mockRes();
    await handler({ method: 'GET' }, cached);
    assert.equal(calls, 1);
    assert.equal(cached.body.count, 39);
  } finally {
    global.fetch = original;
    if (prevKey == null) delete process.env.FLEXQUOTE_SUPABASE_PUBLISHABLE_KEY;
    else process.env.FLEXQUOTE_SUPABASE_PUBLISHABLE_KEY = prevKey;
    if (prevUrl == null) delete process.env.FLEXQUOTE_INVENTORY_URL;
    else process.env.FLEXQUOTE_INVENTORY_URL = prevUrl;
    handler.resetInventoryCache();
  }
});

test('a configured route returns Bentonville lawn products and caches for about 5 minutes', async () => {
  const prevKey = process.env.FLEXQUOTE_SUPABASE_PUBLISHABLE_KEY;
  const prevUrl = process.env.FLEXQUOTE_INVENTORY_URL;
  process.env.FLEXQUOTE_SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
  process.env.FLEXQUOTE_INVENTORY_URL = 'https://inventory.example/fetch-inventory?collection=inventory';
  handler.resetInventoryCache();
  let calls = 0;
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    calls += 1;
    assert.equal(url, 'https://inventory.example/fetch-inventory?collection=inventory');
    assert.equal(opts.headers.apikey, 'publishable-test-key');
    assert.equal(opts.headers.Authorization, 'Bearer publishable-test-key');
    assert.equal(opts.method, 'GET');
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          fetched_at: '2026-10-22T23:52:38.933Z',
          items: fixture.items,
        };
      },
    };
  };
  try {
    const first = mockRes();
    await handler({ method: 'GET' }, first);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.warehouseId, 'J29nPerDyPRDoVqg1Wsf');
    assert.equal(first.body.count, 39);
    assert.equal(JSON.stringify(first.body).includes('publishable-test-key'), false);
    assert.match(first.headers['cache-control'], /s-maxage=300/);
    const second = mockRes();
    await handler({ method: 'GET' }, second);
    assert.equal(calls, 1);
    assert.equal(second.body.count, 39);
    const denied = mockRes();
    await handler({ method: 'POST' }, denied);
    assert.equal(denied.statusCode, 405);
  } finally {
    global.fetch = original;
    if (prevKey == null) delete process.env.FLEXQUOTE_SUPABASE_PUBLISHABLE_KEY;
    else process.env.FLEXQUOTE_SUPABASE_PUBLISHABLE_KEY = prevKey;
    if (prevUrl == null) delete process.env.FLEXQUOTE_INVENTORY_URL;
    else process.env.FLEXQUOTE_INVENTORY_URL = prevUrl;
    handler.resetInventoryCache();
  }
});

test('an upstream failure is a 502 and is not served from cache', async () => {
  const prev = process.env.FLEXQUOTE_SUPABASE_PUBLISHABLE_KEY;
  process.env.FLEXQUOTE_SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
  handler.resetInventoryCache();
  let mode = 'fail';
  const original = global.fetch;
  global.fetch = async () => {
    if (mode === 'fail') throw new Error('boom publishable-test-key');
    return { ok: false, status: 401, async json() { return { message: 'no' }; } };
  };
  try {
    const failed = mockRes();
    await handler({ method: 'GET' }, failed);
    assert.equal(failed.statusCode, 502);
    assert.equal(failed.body.error, 'Inventory request failed');
    assert.equal(JSON.stringify(failed.body).includes('publishable-test-key'), false);
    mode = 'denied';
    const denied = mockRes();
    await handler({ method: 'GET' }, denied);
    assert.equal(denied.statusCode, 502);
    assert.match(denied.body.error, /401/);
  } finally {
    global.fetch = original;
    if (prev == null) delete process.env.FLEXQUOTE_SUPABASE_PUBLISHABLE_KEY;
    else process.env.FLEXQUOTE_SUPABASE_PUBLISHABLE_KEY = prev;
    handler.resetInventoryCache();
  }
});

test('the page reads Have from /api/inventory and does not embed the CRM key', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /fetch\('\/api\/inventory'/);
  assert.equal(html.includes('sb_publishable_'), false);
  assert.equal(html.includes('functions/v1/fetch-inventory'), false);
  assert.equal(html.includes('FLEXQUOTE_SUPABASE_PUBLISHABLE_KEY'), false);
});

test('R7 against the 23:52 UTC dashboard fixture', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = loadApp(html);
  const map = {};
  for (const item of inventory.bentonvilleLawnProducts(fixture)) {
    const key = app.orderProductKey(item.name);
    map[key] = { quantity: item.onHand, unit: item.unit, updatedAt: item.updatedAt };
  }
  app.setOrderInventory(map);
  const plan = app.calcOrderPlan(7, 538261, 20939);
  const rows = plan.combined.map(p => ({
    name: p.name,
    need: app.fmtNeeded(p.needed, p.unit, p.name),
    have: app.fmtHaveText(p),
    toOrder: p.stockStatus === 'ok' && p.toOrder != null ? app.orderAmountText(p) : null,
    flag: p.stockStatus === 'ok' ? (p.containerFlag || '') : p.stockFlag,
    status: p.stockStatus,
  }));
  const byName = Object.fromEntries(rows.map(row => [row.name, row]));
  assert.equal(byName['Specticle FLO'].have, '0 Bottles = 0.0 oz');
  assert.equal(byName['Specticle FLO'].flag, 'Container size unknown — not rounded up to bottles');
  assert.equal(byName['Simazine'].have, '1 Bottles = 320.0 oz');
  assert.equal(byName['Simazine'].toOrder, 'stocked');
  assert.equal(byName['Triad Select'].toOrder, '594.3 oz · 2 jugs @ 320 fl oz');
  assert.equal(byName['90/10 NIS'].have, '2 Bottles = 640.0 oz');
  assert.equal(byName['90/10 NIS'].toOrder, 'stocked');
  assert.equal(byName['Artavia SC (Azoxystrobin)'].toOrder, '413.6 fl oz · 2 jugs @ 320 fl oz');
  assert.equal(byName['LESCO Poly Plus OPTI 28-0-3'].need, '74.8 lb, 1.5 bags, 2 bags to load');
  assert.equal(byName['LESCO Poly Plus OPTI 28-0-3'].have, '12 Bags = 600 lb');
  assert.equal(byName['LESCO Poly Plus OPTI 28-0-3'].toOrder, 'stocked');
  assert.equal(byName['LESCO Poly Plus OPTI 28-0-3'].status, 'ok');
  assert.equal(byName['Albaugh Sulfentrazone 4SC Select'].have, '5 Jugs = 1600.0 oz');
  assert.equal(byName['Albaugh Sulfentrazone 4SC Select'].toOrder, 'stocked');
});

function loadApp(html) {
  const match = html.match(/<script>\n([\s\S]*)<\/script>\s*<\/body>/);
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Number,
    String,
    parseInt,
    parseFloat,
    JSON,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    firebase: {
      apps: [],
      initializeApp() {},
      firestore() {
        const chain = {
          collection() { return chain; },
          doc() { return chain; },
          get() { return Promise.resolve({ forEach() {}, exists: false, data() { return {}; } }); },
        };
        return chain;
      },
    },
    navigator: { userAgent: 'node-test' },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
    addEventListener() {},
    removeEventListener() {},
    scrollTo() {},
    setInterval() { return 0; },
    clearInterval() {},
    fetch() { return Promise.reject(new Error('no fetch in test')); },
    history: { pushState() {}, replaceState() {}, back() {} },
    location: { reload() {} },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const el = () => ({
    innerHTML: '',
    style: {},
    textContent: '',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
  });
  sandbox.document = {
    getElementById: el,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(match[1], sandbox, { filename: 'index.html' });
  return sandbox;
}
