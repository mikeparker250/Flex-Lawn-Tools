import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const lawn = require('../api/lib/lawn-totals.js');
const handler = require('../api/fieldroutes-lawn-totals.js');

const regions = [
  { regionID: 1, description: 'NWA' },
  { regionID: 2, description: 'River Valley' },
  { regionID: 8, description: 'north FORT SMITH metro' },
  { regionID: 3, description: 'Fayetteville' },
];

const customers = [
  { customerID: 27199, officeID: 1, regionID: 1, specialScheduling: '' },
  { customerID: 26591, officeID: '1', regionID: 3, specialScheduling: 'Bermuda' },
  { customerID: 36155, officeID: 1, regionID: 1, specialScheduling: null },
  { customerID: 37869, officeID: 1, regionID: 1, specialScheduling: '   ' },
  { customerID: 40001, officeID: 1, regionID: 1, specialScheduling: 'Tall Fescue' },
  { customerID: 40002, officeID: 1, regionID: 1, specialScheduling: 'FESCUE' },
  { customerID: 40004, officeID: 1, regionID: 1, specialScheduling: 'seasonal fescue lawn' },
  { customerID: 40003, officeID: 1, regionID: 1, specialScheduling: 'Zoysia' },
  { customerID: 50001, officeID: 1, regionID: 2, specialScheduling: 'Bermuda' },
  { customerID: 50002, officeID: 1, regionID: 8, specialScheduling: 'fescue' },
  { customerID: 50003, officeID: 2, regionID: 1, specialScheduling: 'Bermuda' },
  { customerID: 27199, officeID: 1, regionID: 1, specialScheduling: '' },
];

const diagrams = [
  { diagram: 1, customerID: 27199, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: '11,128' },
  { diagram: 1, customerID: 27199, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 11128 },
  { diagram: 2, customerID: 26591, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 2275 },
  { diagram: 3, customerID: 26591, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 4242 },
  { diagram: 4, customerID: 26591, diagramType: 'WDO', measurementUnit: 'SF', measurement: 99999 },
  { diagram: 5, customerID: 26591, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'LF', measurement: 50 },
  { diagram: 6, customerID: 40001, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 1000 },
  { diagram: 7, customerID: 40002, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 2000 },
  { diagram: 8, customerID: 40003, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 3000 },
  { diagram: 9, customerID: 50001, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 8888 },
  { diagram: 10, customerID: 50003, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 7777 },
];

function totals() {
  return lawn.aggregateLawnTotals({
    customers,
    regions,
    diagrams,
    asOf: '2026-10-22T00:00:00.000Z',
  });
}

test('a base URL that already ends in /api is used as-is', () => {
  assert.equal(
    lawn.endpointUrl('https://flexpestcontrol.fieldroutes.com/api', 'subscription/search'),
    'https://flexpestcontrol.fieldroutes.com/api/subscription/search',
  );
  assert.equal(
    lawn.endpointUrl('https://flexpestcontrol.fieldroutes.com/api/', 'diagram/search'),
    'https://flexpestcontrol.fieldroutes.com/api/diagram/search',
  );
  assert.equal(
    lawn.endpointUrl('https://flexpestcontrol.fieldroutes.com/api', 'customer/get').includes('/api/api/'),
    false,
  );
});

test('fescue in specialScheduling is cool; blank and other turf stay warm', () => {
  assert.equal(lawn.isCoolSeason('Tall Fescue'), true);
  assert.equal(lawn.isCoolSeason('FESCUE'), true);
  assert.equal(lawn.isCoolSeason('seasonal fescue lawn'), true);
  assert.equal(lawn.isCoolSeason(''), false);
  assert.equal(lawn.isCoolSeason(null), false);
  assert.equal(lawn.isCoolSeason('   '), false);
  assert.equal(lawn.isCoolSeason('Bermuda'), false);
  assert.equal(lawn.isCoolSeason('Zoysia'), false);

  const result = totals();
  assert.equal(result.coolProps, 3);
  assert.equal(result.coolSqft, 3000);
  assert.deepEqual(result.missingSfIds.cool, [40004]);
  assert.equal(result.warmProps, 5);
});

test('Fort Smith is regionID 2 or any region whose name contains fort smith', () => {
  const ids = lawn.fortSmithRegionIds(regions);
  assert.equal(ids.has(2), true);
  assert.equal(ids.has(8), true);
  assert.equal(ids.has(1), false);

  const namedOnly = lawn.fortSmithRegionIds([
    { regionID: 9, description: 'Fort Smith' },
  ]);
  assert.equal(namedOnly.has(2), true);
  assert.equal(namedOnly.has(9), true);

  const result = totals();
  assert.equal(result.excludedFortSmith, 2);
  assert.equal(result.warmSqft === 8888 || result.coolSqft === 8888, false);
  assert.equal(result.warmSqft === 7777 || result.coolSqft === 7777, false);
});

test('duplicate diagram rows collapse and the largest SF wins', () => {
  const byCustomer = lawn.sqftByCustomer(diagrams);
  assert.equal(byCustomer.get(27199), 11128);
  assert.equal(byCustomer.get(26591), 4242);
  assert.equal(byCustomer.has(36155), false);

  const result = totals();
  assert.equal(result.warmSqft, 11128 + 4242 + 3000);
  assert.deepEqual(result.missingSfIds.warm, [36155, 37869]);
  assert.equal(result.asOf, '2026-10-22T00:00:00.000Z');
});

test('a repeated SF row is not summed', () => {
  const doubled = lawn.sqftByCustomer([
    { diagram: 70, customerID: 10, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 5000 },
    { diagram: 70, customerID: 10, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 5000 },
  ]);
  assert.equal(doubled.get(10), 5000);
});

test('loadLawnTotals queries each serviceID, batches customers, and pages diagrams', async () => {
  const calls = [];
  const customersById = new Map();
  for (let i = 1; i <= 1001; i++) {
    customersById.set(i, {
      customerID: i,
      officeID: 1,
      regionID: 1,
      specialScheduling: i === 5 ? 'Tall Fescue' : '',
    });
  }

  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const path = String(url).split('/api/')[1];
    calls.push({ path, body });
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'customerIDs') && path === 'diagram/search', false);
    assert.equal(body.serviceIDs, undefined);

    if (path === 'subscription/search') {
      assert.equal(body.active, 1);
      assert.equal(body.officeIDs, 1);
      assert.equal(body.includeData, 1);
      assert.ok(lawn.LAWN_SERVICE_IDS.includes(body.serviceID));
      const customerID = body.serviceID === 111 ? 27199 : body.serviceID === 21 ? 27199 : null;
      const extra = body.serviceID === 21 ? [{ subscriptionID: 2, customerID: 26591, serviceID: 21 }] : [];
      const rows = customerID
        ? [{ subscriptionID: 1, customerID, serviceID: body.serviceID }, ...extra]
        : [];
      if (body.serviceID === 111) {
        rows.push(
          ...Array.from({ length: 1001 }, (_, n) => ({
            subscriptionID: 1000 + n,
            customerID: n + 1,
            serviceID: 111,
          })),
        );
      }
      return json({
        success: true,
        idName: 'subscriptionIDs',
        propertyName: 'subscriptions',
        subscriptionIDs: rows.map(row => row.subscriptionID),
        subscriptions: rows.slice(0, 1000),
        subscriptionIDsNoDataExported: rows.slice(1000).map(row => row.subscriptionID),
      });
    }

    if (path === 'subscription/get') {
      assert.ok(body.subscriptionIDs.length <= 1000);
      const rows = body.subscriptionIDs.map(id => ({
        subscriptionID: id,
        customerID: id >= 1000 ? (id - 1000 + 1) : id,
        serviceID: 111,
      }));
      return json({ success: true, subscriptions: rows });
    }

    if (path === 'customer/get') {
      assert.ok(Array.isArray(body.customerIDs));
      assert.ok(body.customerIDs.length <= 1000);
      return json({
        success: true,
        customers: body.customerIDs.map(id => customersById.get(id) || {
          customerID: id,
          officeID: 1,
          regionID: 1,
          specialScheduling: id === 26591 ? 'Bermuda' : '',
        }),
      });
    }

    if (path === 'region/search') {
      return json({
        success: true,
        idName: 'regionIDs',
        propertyName: 'regions',
        regionIDs: [1, 2],
        regions: [
          { regionID: 1, description: 'NWA' },
          { regionID: 2, description: 'Fort Smith' },
        ],
      });
    }

    if (path === 'diagram/search') {
      assert.equal(body.includeData, 1);
      assert.equal(body.customerIDs, undefined);
      if (!body.diagramIDs) {
        return json({
          success: true,
          idName: 'diagramIDs',
          propertyName: 'diagrams',
          diagramIDs: [1, 2],
          diagrams: [
            { diagram: 1, customerID: 27199, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 100 },
            { diagram: 2, customerID: 26591, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 50 },
          ],
          diagramIDsNoDataExported: [],
        });
      }
      assert.deepEqual(body.diagramIDs, { operator: '>', value: 2 });
      return json({
        success: true,
        idName: 'diagramIDs',
        propertyName: 'diagrams',
        diagramIDs: [3],
        diagrams: [
          { diagram: 3, customerID: 27199, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 11128 },
        ],
      });
    }

    if (path === 'diagram/get') {
      return json({ success: true, diagrams: [] });
    }

    throw new Error('unexpected ' + path);
  };

  const result = await lawn.loadLawnTotals({
    baseUrl: 'https://flexpestcontrol.fieldroutes.com/api',
    authenticationKey: 'test-key',
    authenticationToken: 'test-token',
    fetchImpl,
  }, { diagramPageSize: 2 });

  const serviceIds = calls
    .filter(call => call.path === 'subscription/search')
    .map(call => call.body.serviceID);
  assert.deepEqual(serviceIds, [...lawn.LAWN_SERVICE_IDS]);

  const customerBatches = calls.filter(call => call.path === 'customer/get');
  assert.ok(customerBatches.length >= 2);
  for (const batch of customerBatches) assert.ok(batch.body.customerIDs.length <= 1000);

  const diagramSearches = calls.filter(call => call.path === 'diagram/search');
  assert.equal(diagramSearches.length, 2);
  assert.equal(diagramSearches[0].body.customerIDs, undefined);
  assert.equal(result.missingSfIds.warm.includes(36155), false);
  assert.equal(lawn.sqftByCustomer([
    { diagram: 1, customerID: 27199, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 100 },
    { diagram: 3, customerID: 27199, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 11128 },
  ]).get(27199), 11128);
  const warm27199 = result.warmSqft;
  assert.ok(warm27199 >= 11128);
});

test('diagram/search pages leftover ids through diagram/get', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const path = String(url).split('/api/')[1];
    calls.push(path);
    if (path === 'subscription/search') {
      if (body.serviceID !== 111) {
        return json({ success: true, subscriptionIDs: [], subscriptions: [] });
      }
      return json({
        success: true,
        subscriptions: [
          { subscriptionID: 1, customerID: 27199 },
          { subscriptionID: 2, customerID: 36155 },
          { subscriptionID: 3, customerID: 37869 },
        ],
      });
    }
    if (path === 'customer/get') {
      return json({
        success: true,
        customers: [
          { customerID: 27199, officeID: 1, regionID: 1, specialScheduling: '' },
          { customerID: 36155, officeID: 1, regionID: 1, specialScheduling: '' },
          { customerID: 37869, officeID: 1, regionID: 1, specialScheduling: 'Bermuda' },
        ],
      });
    }
    if (path === 'region/search') {
      return json({ success: true, regions: [{ regionID: 2, description: 'Fort Smith' }] });
    }
    if (path === 'diagram/search') {
      assert.equal(body.customerIDs, undefined);
      return json({
        success: true,
        idName: 'diagramIDs',
        propertyName: 'diagrams',
        diagramIDs: [1, 9],
        diagrams: [
          { diagram: 1, customerID: 27199, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 4000 },
        ],
        diagramIDsNoDataExported: [9],
      });
    }
    if (path === 'diagram/get') {
      assert.deepEqual(body.diagramIDs, [9]);
      return json({
        success: true,
        diagrams: [
          { diagram: 9, customerID: 27199, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 11128 },
        ],
      });
    }
    throw new Error('unexpected ' + path);
  };

  const result = await lawn.loadLawnTotals({
    baseUrl: 'https://flexpestcontrol.fieldroutes.com/api/',
    authenticationKey: 'k',
    authenticationToken: 't',
    fetchImpl,
  });
  assert.ok(calls.includes('diagram/get'));
  assert.equal(result.warmSqft, 11128);
  assert.equal(result.warmProps, 3);
  assert.deepEqual(result.missingSfIds.warm, [36155, 37869]);
  assert.equal(result.coolProps, 0);
});

test('missing FieldRoutes env returns 503 and does not call FieldRoutes', async () => {
  const prev = saveEnv();
  delete process.env.FIELDROUTES_BASE_URL;
  delete process.env.FIELDROUTES_AUTH_KEY;
  delete process.env.FIELDROUTES_AUTH_TOKEN;
  handler.resetLawnTotalsCache();
  let called = false;
  const original = global.fetch;
  global.fetch = async () => { called = true; throw new Error('should not fetch'); };
  try {
    const res = mockRes();
    await handler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'FieldRoutes not configured');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(called, false);
  } finally {
    global.fetch = original;
    restoreEnv(prev);
    handler.resetLawnTotalsCache();
  }
});

test('successful totals are cached for about 10 minutes and omit credentials', async () => {
  const prev = saveEnv();
  process.env.FIELDROUTES_BASE_URL = 'https://flexpestcontrol.fieldroutes.com/api';
  process.env.FIELDROUTES_AUTH_KEY = 'super-secret-key';
  process.env.FIELDROUTES_AUTH_TOKEN = 'super-secret-token';
  handler.resetLawnTotalsCache();
  let fetches = 0;
  const original = global.fetch;
  global.fetch = async (url, init) => {
    fetches += 1;
    const body = JSON.parse(init.body);
    assert.equal(body.authenticationKey, 'super-secret-key');
    assert.equal(body.authenticationToken, 'super-secret-token');
    const path = String(url).split('/api/')[1];
    if (path === 'subscription/search' && body.serviceID === 111) {
      return json({
        success: true,
        subscriptions: [{ subscriptionID: 1, customerID: 27199 }],
      });
    }
    if (path === 'subscription/search') return json({ success: true, subscriptions: [] });
    if (path === 'customer/get') {
      return json({
        success: true,
        customers: [{ customerID: 27199, officeID: 1, regionID: 1, specialScheduling: '' }],
      });
    }
    if (path === 'region/search') return json({ success: true, regions: [] });
    if (path === 'diagram/search') {
      return json({
        success: true,
        diagrams: [
          { diagram: 1, customerID: 27199, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 11128 },
        ],
      });
    }
    throw new Error('unexpected ' + path);
  };
  try {
    const first = mockRes();
    await handler({ method: 'GET' }, first);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.warmSqft, 11128);
    assert.equal(first.body.warmProps, 1);
    assert.equal(JSON.stringify(first.body).includes('super-secret'), false);
    assert.match(first.headers['cache-control'], /s-maxage=600/);
    const afterFirst = fetches;
    const second = mockRes();
    await handler({ method: 'GET' }, second);
    assert.equal(fetches, afterFirst);
    assert.equal(second.body.asOf, first.body.asOf);
    assert.equal(second.body.warmSqft, 11128);
  } finally {
    global.fetch = original;
    restoreEnv(prev);
    handler.resetLawnTotalsCache();
  }
});

test('a FieldRoutes error is not cached and secrets are stripped', async () => {
  const prev = saveEnv();
  process.env.FIELDROUTES_BASE_URL = 'https://flexpestcontrol.fieldroutes.com/api';
  process.env.FIELDROUTES_AUTH_KEY = 'super-secret-key';
  process.env.FIELDROUTES_AUTH_TOKEN = 'super-secret-token';
  handler.resetLawnTotalsCache();
  let mode = 'fail';
  const original = global.fetch;
  global.fetch = async () => {
    if (mode === 'fail') throw new Error('boom super-secret-token');
    return json({ success: true, subscriptions: [] });
  };
  try {
    const failed = mockRes();
    await handler({ method: 'GET' }, failed);
    assert.equal(failed.statusCode, 502);
    assert.equal(failed.body.error, 'FieldRoutes request failed');
    assert.equal(JSON.stringify(failed.body).includes('super-secret'), false);
    mode = 'ok';
    const next = mockRes();
    await handler({ method: 'GET' }, next);
    assert.equal(next.statusCode, 200);
  } finally {
    global.fetch = original;
    restoreEnv(prev);
    handler.resetLawnTotalsCache();
  }
});

test('the order planner button is on every round and keeps the boxes editable', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(html.includes('FIELDROUTES_AUTH'), false);
  assert.equal(html.includes('authenticationKey'), false);
  assert.equal(html.includes('authenticationToken'), false);
  const app = loadApp(html);
  for (const round of [1, 2, 3, 4, 5, 6, 7]) {
    app.state.opRound = round;
    app.state.opSqftWarm = 0;
    app.state.opSqftCool = 0;
    app.state.opCountWarm = 0;
    app.state.opCountCool = 0;
    app.state.opLoading = false;
    app.state.opError = null;
    app.state.opFRData = null;
    const view = app.renderOrderPlanner();
    assert.match(view, /id="op-fr-btn"/);
    assert.match(view, /Pull live FieldRoutes totals/);
    assert.match(view, /id="op-sqft-warm"/);
    assert.match(view, /id="op-count-warm"/);
    assert.match(view, /id="op-sqft-cool"/);
    assert.match(view, /id="op-count-cool"/);
    assert.match(view, /opUpdateSqft\(\)/);
    if (round === 7) assert.match(view, /Oct 4 – Nov 14/);
  }
  app.state.opRound = 7;
  app.state.opFRData = { missingSfIds: { warm: [36155, 37869], cool: [] } };
  app.state.opError = 'FieldRoutes not configured';
  const noted = app.renderOrderPlanner();
  assert.match(noted, /2 properties missing SF: 36155, 37869/);
  assert.match(noted, /FieldRoutes not configured/);
  assert.equal(app.opMissingSfText([36155, 37869]), '2 properties missing SF: 36155, 37869');
  assert.equal(app.opMissingSfText([42]), '1 property missing SF: 42');
});

function json(body) {
  return {
    ok: true,
    status: 200,
    async json() { return body; },
  };
}

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

function saveEnv() {
  return {
    FIELDROUTES_BASE_URL: process.env.FIELDROUTES_BASE_URL,
    FIELDROUTES_AUTH_KEY: process.env.FIELDROUTES_AUTH_KEY,
    FIELDROUTES_AUTH_TOKEN: process.env.FIELDROUTES_AUTH_TOKEN,
  };
}

function restoreEnv(prev) {
  for (const [key, value] of Object.entries(prev)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

function loadApp(html) {
  const match = html.match(/<script>\n([\s\S]*)<\/script>\s*<\/body>/);
  if (!match) throw new Error('inline script not found');
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
    location: { reload() {}, search: '' },
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
