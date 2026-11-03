import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const route = require('../api/lib/lawn-route.js');
const handler = require('../api/fieldroutes-lawn-route.js');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('round service ids map 110 to R1 through 117 to R7, and 163 to RS', () => {
  assert.deepEqual(route.ROUND_BY_SERVICE_ID, {
    110: 'R1',
    112: 'R2',
    113: 'R3',
    114: 'R4',
    115: 'R5',
    116: 'R6',
    117: 'R7',
    163: 'RS',
  });
  assert.equal(route.roundFromServiceId(110), 'R1');
  assert.equal(route.roundFromServiceId('117'), 'R7');
  assert.equal(route.roundFromServiceId(163), 'RS');
  for (const planId of [111, 21, 146, 161, 162]) {
    assert.equal(route.roundFromServiceId(planId), null);
  }
});

test('rock, beds, hose, and tall fescue phrases follow the Lawn Ops lock', () => {
  const flags = text => route.classifyFlagTexts([text]);

  for (const phrase of [
    'Request - ALL ROCK YARD',
    'full rock yard',
    'ALL ROCK',
    'ROCK YARD ONLY',
    'Rock yard',
  ]) {
    const row = flags(phrase);
    assert.equal(row.isRockYard, true, phrase);
    assert.equal(row.hasRockBeds, false, phrase);
    assert.equal(row.needsReview.includes('Ambiguous rock wording'), false, phrase);
  }

  const beds = flags('rock beds are included in lawn care');
  assert.equal(beds.hasRockBeds, true);
  assert.equal(beds.isRockYard, false);

  const paraphrase = flags('The rock beds are included in the lawn care program');
  assert.equal(paraphrase.hasRockBeds, true);
  assert.equal(paraphrase.isRockYard, false);

  const far = flags('rock beds ' + 'x '.repeat(60) + 'included in lawn care');
  assert.equal(far.hasRockBeds, false);

  assert.equal(flags('Hose Drag Required').isHoseDrag, true);
  assert.equal(flags('please hose drag required today').isHoseDrag, true);
  assert.equal(flags('bring a hose').isHoseDrag, false);

  const casual = flags('Thank you, we treated the rock yard today');
  assert.equal(casual.isRockYard, false);
  assert.equal(casual.hasRockBeds, false);
  assert.equal(casual.isHoseDrag, false);
  assert.deepEqual(casual.needsReview, []);

  const ambiguous = flags('watch the rock border along the drive');
  assert.equal(ambiguous.isRockYard, false);
  assert.equal(ambiguous.hasRockBeds, false);
  assert.equal(ambiguous.needsReview.includes('Ambiguous rock wording'), true);

  for (const phrase of [
    'Tall Fescue',
    'Tall Fescue lawn',
    'LAWN: Tall fescue',
    'Tall Fescue / Cool Turf Season',
    'cool season turf',
  ]) {
    const row = flags(phrase);
    assert.equal(row.turf, 'cool', phrase);
    assert.equal(row.needsReview.includes('Mixed turf — not marked cool'), false, phrase);
  }

  assert.equal(route.isExactTallFescue('  Tall   Fescue '), true);
  assert.equal(route.isExactTallFescue('Tall Fescue lawn'), false);
  assert.equal(flags('seasonal fescue lawn').turf, 'warm');
  assert.equal(flags('FESCUE').turf, 'warm');

  const mixed = flags('Fescue back bermuda front');
  assert.equal(mixed.turf, 'mixed');
  assert.equal(mixed.needsReview.includes('Mixed turf — not marked cool'), true);

  const front = flags('Lawncare- front yard only');
  assert.equal(front.turf, 'mixed');
  assert.equal(front.needsReview.includes('Mixed turf — not marked cool'), true);
});

test('a canonical red note still counts when a thank-you note is also present', () => {
  const row = route.classifyFlagTexts([
    'Thank you, treated the rock yard',
    'Request - ALL ROCK YARD',
    'hose drag required',
  ]);
  assert.equal(row.isRockYard, true);
  assert.equal(row.isHoseDrag, true);
  assert.equal(row.needsReview.includes('Ambiguous rock wording'), false);
});

test('mixed turf blocks cool even when special scheduling says Tall Fescue', () => {
  const row = route.classifyFlagTexts([
    'Fescue back bermuda front',
    'Tall Fescue',
  ]);
  assert.equal(row.turf, 'mixed');
});

function baseRoute(extra) {
  return route.buildLawnRoute({
    date: '2026-11-03',
    employeeID: 42,
    routes: [
      { routeID: 9, assignedTech: 42, date: '2026-11-03' },
      { routeID: 8, assignedTech: 99, date: '2026-11-03' },
    ],
    appointments: [],
    customers: [],
    notes: [],
    subscriptions: [],
    diagrams: [],
    ...extra,
  });
}

test('pull maps stops to OCR fields and refuses a mixed cool/warm tank', () => {
  const result = baseRoute({
    appointments: [
      { appointmentID: 1, routeID: 9, customerID: 1, status: 0, date: '2026-11-03 08:00:00', serviceID: 110, spotID: 2 },
      { appointmentID: 2, routeID: 9, customerID: 2, status: 0, date: '2026-11-03', serviceID: 112, spotID: 1 },
      { appointmentID: 3, routeID: 9, customerID: 3, status: 0, date: '2026-11-03', serviceID: 113 },
      { appointmentID: 4, routeID: 9, customerID: 4, status: 0, date: '2026-11-03', type: 114 },
      { appointmentID: 5, routeID: 9, customerID: 5, status: 0, date: '2026-11-03', serviceID: 115 },
      { appointmentID: 6, routeID: 9, customerID: 6, status: 0, date: '2026-11-03', serviceID: 116 },
      { appointmentID: 7, routeID: 9, customerID: 7, status: 0, date: '2026-11-03', serviceID: 117 },
      { appointmentID: 8, routeID: 9, customerID: 8, status: 0, date: '2026-11-03', serviceID: 111 },
      { appointmentID: 9, routeID: 9, customerID: 9, status: 0, date: '2026-11-03', serviceID: 110 },
      { appointmentID: 10, routeID: 9, customerID: 10, status: 0, date: '2026-11-03', serviceID: 112 },
      { appointmentID: 11, routeID: 9, customerID: 11, status: 'Pending', date: '11/03/2026', serviceID: 114 },
      { appointmentID: 12, routeID: 9, customerID: 12, status: 1, date: '2026-11-03', serviceID: 110 },
      { appointmentID: 13, routeID: 8, customerID: 13, status: 0, date: '2026-11-03', serviceID: 110 },
      { appointmentID: 14, routeID: 9, customerID: 14, status: 0, date: '2026-11-04', serviceID: 110 },
      { appointmentID: 15, routeID: 9, customerID: 15, status: 0, date: '2026-11-03', serviceID: 163, subscriptionID: 501 },
      { appointmentID: 16, routeID: 9, customerID: 16, status: 0, date: '2026-11-03', serviceID: 113, notes: 'hose drag required' },
    ],
    customers: [
      { customerID: 1, lname: 'Brook', fname: 'K', specialScheduling: '', squareFeet: 1 },
      { customerID: 2, lname: 'Nguyen', fname: 'Ana', squareFeet: 99999 },
      { customerID: 3, lname: 'Lee', fname: 'Sam' },
      { customerID: 4, lname: 'Jarvis', fname: 'Pat', specialScheduling: 'Bermuda' },
      { customerID: 5, lname: 'Carr', fname: 'Jo', specialScheduling: 'Tall Fescue' },
      { customerID: 6, lname: 'Atwood', fname: 'Ren' },
      { customerID: 7, lname: 'No', fname: 'Diagram', squareFeet: 99999 },
      { customerID: 8, lname: 'Plan', fname: 'Type' },
      { customerID: 9, lname: 'Ambiguous', fname: 'Rock' },
      { customerID: 10, lname: 'Thanks', fname: 'Note' },
      { customerID: 11, lname: 'Ledbetter', fname: 'Casey' },
      { customerID: 15, lname: 'Sub', fname: 'Note' },
      { customerID: 16, lname: 'Appt', fname: 'Hose' },
    ],
    notes: [
      { noteID: 1, customerID: 1, showTech: 1, notes: 'Request - ALL ROCK YARD' },
      { noteID: 2, customerID: 1, showTech: '0', notes: 'secret office only rock beds are included in lawn care' },
      { noteID: 3, customerID: 2, showTech: 1, notes: 'rock beds are included in lawn care' },
      { noteID: 4, customerID: 3, showTech: '1', notes: 'hose drag required' },
      { noteID: 5, customerID: 4, showTech: 1, notes: 'LAWN: Tall fescue' },
      { noteID: 6, customerID: 6, showTech: 1, notes: 'Fescue back bermuda front' },
      { noteID: 7, customerID: 9, showTech: 1, notes: 'watch the rock border' },
      { noteID: 8, customerID: 10, showTech: 1, notes: 'Thank you, we treated the rock yard' },
      { noteID: 9, customerID: 11, showTech: 1, notes: 'cool season turf' },
      { noteID: 10, customerID: 16, showTech: 0, notes: 'hidden hose drag required' },
    ],
    subscriptions: [
      { subscriptionID: 501, customerID: 15, notes: 'Fescue back bermuda front' },
    ],
    diagrams: [
      { diagram: 1, customerID: 1, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 1000 },
      { diagram: 2, customerID: 1, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: '5,000' },
      { diagram: 3, customerID: 2, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 8000 },
      { diagram: 4, customerID: 3, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 3000 },
      { diagram: 5, customerID: 4, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 4000 },
      { diagram: 6, customerID: 5, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 2000 },
      { diagram: 7, customerID: 6, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 1500 },
      { diagram: 8, customerID: 8, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 1000 },
      { diagram: 9, customerID: 9, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 1200 },
      { diagram: 10, customerID: 10, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 900 },
      { diagram: 11, customerID: 11, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 600 },
      { diagram: 12, customerID: 15, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 700 },
      { diagram: 13, customerID: 16, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 450 },
      { diagram: 14, customerID: 7, diagramType: 'WDO', measurementUnit: 'SF', measurement: 99999 },
    ],
  });

  const byName = Object.fromEntries(result.properties.map(row => [row.name, row]));
  assert.equal(byName['Brook, K'].isRockYard, true);
  assert.equal(byName['Brook, K'].sqft, 5000);
  assert.equal(byName['Brook, K'].round, 'R1');
  assert.equal(byName['Brook, K'].hasRockBeds, false);
  assert.equal(byName['Brook, K'].confidence, 'high');

  assert.equal(byName['Nguyen, Ana'].hasRockBeds, true);
  assert.equal(byName['Nguyen, Ana'].isRockYard, false);
  assert.equal(byName['Nguyen, Ana'].round, 'R2');
  assert.equal(byName['Nguyen, Ana'].sqft, 8000);

  assert.equal(byName['Lee, Sam'].isHoseDrag, true);
  assert.equal(byName['Lee, Sam'].round, 'R3');

  assert.equal(byName['Jarvis, Pat'].turf, 'cool');
  assert.equal(byName['Jarvis, Pat'].round, 'R4');

  assert.equal(byName['Carr, Jo'].turf, 'cool');
  assert.equal(byName['Carr, Jo'].round, 'R5');
  assert.equal(byName['Carr, Jo'].confidence, 'high');

  assert.equal(byName['Atwood, Ren'].turf, 'mixed');
  assert.equal(byName['Atwood, Ren'].needsReview.includes('Mixed turf — not marked cool'), true);

  assert.equal(byName['No, Diagram'].sqft, 0);
  assert.equal(byName['No, Diagram'].round, 'R7');
  assert.equal(byName['No, Diagram'].needsReview.includes('Missing square footage'), true);
  assert.equal(byName['No, Diagram'].confidence, 'low');

  assert.equal(byName['Plan, Type'].round, null);
  assert.equal(byName['Plan, Type'].needsReview.includes('Round not resolved from service type'), true);
  assert.equal(byName['Plan, Type'].sqft, 1000);

  assert.equal(byName['Ambiguous, Rock'].isRockYard, false);
  assert.equal(byName['Ambiguous, Rock'].needsReview.includes('Ambiguous rock wording'), true);

  assert.equal(byName['Thanks, Note'].isRockYard, false);
  assert.equal(byName['Thanks, Note'].needsReview.includes('Ambiguous rock wording'), false);

  assert.equal(byName['Ledbetter, Casey'].turf, 'cool');

  assert.equal(byName['Sub, Note'].turf, 'mixed');
  assert.equal(byName['Sub, Note'].round, 'RS');

  assert.equal(byName['Appt, Hose'].isHoseDrag, true);
  assert.equal(byName['Appt, Hose'].round, 'R3');

  assert.equal(byName['Customer 12'], undefined);
  assert.equal(byName['Customer 13'], undefined);
  assert.equal(byName['Customer 14'], undefined);

  assert.equal(result.routeIDs.includes(8), false);
  assert.deepEqual(result.routeIDs, [9]);
  assert.equal(result.mixedRoute, true);
  assert.equal(result.routeType, null);
  assert.equal(result.needsReview[0].includes('Mixed cool and warm'), true);

  assert.equal(result.properties[0].name, 'Nguyen, Ana');
  assert.equal(result.properties[1].name, 'Brook, K');
});

test('clear cool-only routes prefer cool, including a rock yard on the same day', () => {
  const result = baseRoute({
    appointments: [
      { appointmentID: 1, routeID: 9, customerID: 4, status: 0, date: '2026-11-03', serviceID: 114 },
      { appointmentID: 2, routeID: 9, customerID: 1, status: 0, date: '2026-11-03', serviceID: 110 },
    ],
    customers: [
      { customerID: 4, lname: 'Jarvis', fname: 'Pat', specialScheduling: 'Tall Fescue' },
      { customerID: 1, lname: 'Brook', fname: 'K' },
    ],
    notes: [
      { noteID: 1, customerID: 1, showTech: 1, notes: 'ALL ROCK YARD' },
    ],
    diagrams: [
      { diagram: 1, customerID: 4, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 4000 },
      { diagram: 2, customerID: 1, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 5000 },
    ],
  });
  assert.equal(result.routeType, 'cool');
  assert.equal(result.mixedRoute, false);
  assert.equal(result.properties.find(row => row.customerID === 1).isRockYard, true);
});

test('a warm route with no fescue stays warm', () => {
  const result = baseRoute({
    appointments: [
      { appointmentID: 2, routeID: 9, customerID: 2, status: 0, date: '2026-11-03', serviceID: 112 },
    ],
    customers: [{ customerID: 2, lname: 'Nguyen', fname: 'Ana', specialScheduling: 'Bermuda' }],
    diagrams: [
      { diagram: 3, customerID: 2, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 8000 },
    ],
  });
  assert.equal(result.routeType, 'warm');
  assert.equal(result.mixedRoute, false);
  assert.equal(result.properties[0].turf, 'warm');
  assert.equal(result.properties[0].confidence, 'high');
});

test('loadLawnRoute reads routes, pending stops, customers, notes, and diagrams', async () => {
  route.resetLawnRouteCache();
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const path = String(url).split('/api/')[1];
    calls.push({ path, body });
    assert.equal(body.authenticationKey, 'test-key');
    assert.equal(body.authenticationToken, 'test-token');
    assert.equal(/update|create|delete|cancel/i.test(path), false);

    if (path === 'route/search') {
      assert.equal(body.officeIDs, 1);
      assert.equal(body.assignedTech, 42);
      assert.deepEqual(body.date, { operator: '=', value: '2026-11-03' });
      return json({
        success: true,
        routes: [
          { routeID: 9, assignedTech: '42', date: '2026-11-03' },
          { routeID: 8, assignedTech: 99, date: '2026-11-03' },
        ],
      });
    }
    if (path === 'appointment/search') {
      assert.deepEqual(body.routeIDs, [9]);
      assert.equal(body.status, 0);
      return json({
        success: true,
        appointments: [
          { appointmentID: 1, routeID: 9, customerID: 1, status: 0, date: '2026-11-03', serviceID: 110, spotID: 1 },
          { appointmentID: 2, routeID: 9, customerID: 2, status: 0, date: '2026-11-03', serviceID: 112, spotID: 2, subscriptionID: 77 },
          { appointmentID: 3, routeID: 9, customerID: 99, status: 1, date: '2026-11-03', serviceID: 110 },
        ],
      });
    }
    if (path === 'customer/get') {
      assert.deepEqual(body.customerIDs, [1, 2]);
      return json({
        success: true,
        customers: [
          { customerID: 1, lname: 'Brook', fname: 'K', specialScheduling: '', squareFeet: 42 },
          { customerID: 2, lname: 'Nguyen', fname: 'Ana', specialScheduling: 'Tall Fescue' },
        ],
      });
    }
    if (path === 'note/search') {
      assert.deepEqual(body.customerIDs, [1, 2]);
      return json({
        success: true,
        notes: [
          { noteID: 5, customerID: 1, showTech: 1, notes: 'ALL ROCK YARD' },
        ],
      });
    }
    if (path === 'subscription/get') {
      assert.deepEqual(body.subscriptionIDs, [77]);
      return json({
        success: true,
        subscriptions: [
          { subscriptionID: 77, customerID: 2, notes: '' },
        ],
      });
    }
    if (path === 'diagram/search') {
      return json({
        success: true,
        diagrams: [
          { diagram: 2, customerID: 1, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 5000 },
          { diagram: 3, customerID: 2, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 2000 },
        ],
      });
    }
    throw new Error('unexpected ' + path);
  };

  const result = await route.loadLawnRoute({
    baseUrl: 'https://flexpestcontrol.fieldroutes.com/api',
    authenticationKey: 'test-key',
    authenticationToken: 'test-token',
    fetchImpl,
  }, { date: '2026-11-03', employeeID: '42' });

  const paths = calls.map(call => call.path);
  assert.equal(paths.includes('route/search'), true);
  assert.equal(paths.includes('appointment/search'), true);
  assert.equal(paths.includes('customer/get'), true);
  assert.equal(paths.includes('note/search'), true);
  assert.equal(paths.includes('subscription/get'), true);
  assert.equal(paths.includes('diagram/search'), true);
  assert.equal(paths.some(path => /update|create|delete|cancel/i.test(path)), false);

  assert.equal(result.mixedRoute, false);
  assert.equal(result.routeType, 'cool');
  const brook = result.properties.find(row => row.customerID === 1);
  const nguyen = result.properties.find(row => row.customerID === 2);
  assert.equal(brook.isRockYard, true);
  assert.equal(brook.turf, 'warm');
  assert.equal(brook.sqft, 5000);
  assert.equal(brook.round, 'R1');
  assert.equal(nguyen.turf, 'cool');
  assert.equal(nguyen.sqft, 2000);
  assert.equal(result.properties.some(row => row.customerID === 99), false);
});

test('a note search that ignores customerIDs is retried per customer', async () => {
  route.resetLawnRouteCache();
  const noteSearches = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const path = String(url).split('/api/')[1];
    if (path === 'route/search') {
      return json({ success: true, routes: [{ routeID: 9, assignedTech: 42, date: '2026-11-03' }] });
    }
    if (path === 'appointment/search') {
      return json({
        success: true,
        appointments: [
          { appointmentID: 1, routeID: 9, customerID: 1, status: 0, date: '2026-11-03', serviceID: 110 },
          { appointmentID: 2, routeID: 9, customerID: 2, status: 0, date: '2026-11-03', serviceID: 112 },
        ],
      });
    }
    if (path === 'customer/get') {
      return json({
        success: true,
        customers: [
          { customerID: 1, lname: 'Brook', fname: 'K' },
          { customerID: 2, lname: 'Nguyen', fname: 'Ana' },
        ],
      });
    }
    if (path === 'note/search') {
      noteSearches.push(body.customerIDs.slice());
      if (body.customerIDs.length > 1) {
        return json({
          success: true,
          notes: [{ noteID: 9, customerID: 999, showTech: 1, notes: 'ALL ROCK YARD' }],
        });
      }
      const customerID = body.customerIDs[0];
      return json({
        success: true,
        notes: customerID === 1
          ? [{ noteID: 1, customerID: 1, showTech: 1, notes: 'ALL ROCK YARD' }]
          : [],
      });
    }
    if (path === 'diagram/search') {
      return json({
        success: true,
        diagrams: [
          { diagram: 1, customerID: 1, diagramType: 'PROPERTY ESTIMATION', measurementUnit: 'SF', measurement: 5000 },
        ],
      });
    }
    throw new Error('unexpected ' + path);
  };

  const result = await route.loadLawnRoute({
    baseUrl: 'https://flexpestcontrol.fieldroutes.com/api',
    authenticationKey: 'k',
    authenticationToken: 't',
    fetchImpl,
  }, { date: '2026-11-03', employeeID: 42 });

  assert.deepEqual(noteSearches[0], [1, 2]);
  assert.equal(noteSearches.length, 3);
  const brook = result.properties.find(row => row.customerID === 1);
  assert.equal(brook.isRockYard, true);
  assert.equal(brook.sqft, 5000);
  assert.equal(result.properties.some(row => row.customerID === 999), false);
});

test('the route handler validates input, hides secrets, and does not cache', async () => {
  const prev = saveEnv();
  delete process.env.FIELDROUTES_BASE_URL;
  delete process.env.FIELDROUTES_AUTH_KEY;
  delete process.env.FIELDROUTES_AUTH_TOKEN;
  const original = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error('should not fetch'); };
  try {
    const missing = mockRes();
    await handler({ method: 'GET', query: { date: '2026-11-03', employeeID: '42' } }, missing);
    assert.equal(missing.statusCode, 503);
    assert.equal(missing.body.error, 'FieldRoutes not configured');
    assert.equal(missing.headers['cache-control'], 'no-store');
    assert.equal(called, false);

    const fromUrl = mockRes();
    await handler({ method: 'GET', url: '/api/fieldroutes-lawn-route?date=2026-11-03&employeeID=42' }, fromUrl);
    assert.equal(fromUrl.statusCode, 503);

    const bad = mockRes();
    await handler({ method: 'GET', query: { date: '11/03/2026', employeeID: '42' } }, bad);
    assert.equal(bad.statusCode, 400);

    const post = mockRes();
    await handler({ method: 'POST', query: { date: '2026-11-03', employeeID: '42' } }, post);
    assert.equal(post.statusCode, 405);
  } finally {
    global.fetch = original;
    restoreEnv(prev);
  }
});

test('a FieldRoutes failure does not echo credentials', async () => {
  const prev = saveEnv();
  process.env.FIELDROUTES_BASE_URL = 'https://flexpestcontrol.fieldroutes.com/api';
  process.env.FIELDROUTES_AUTH_KEY = 'super-secret-key';
  process.env.FIELDROUTES_AUTH_TOKEN = 'super-secret-token';
  const original = global.fetch;
  global.fetch = async () => { throw new Error('boom super-secret-token'); };
  try {
    const res = mockRes();
    await handler({ method: 'GET', query: { date: '2026-11-03', employeeID: '42' } }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error, 'FieldRoutes request failed');
    assert.equal(JSON.stringify(res.body).includes('super-secret'), false);
    assert.equal(res.headers['cache-control'], 'no-store');
  } finally {
    global.fetch = original;
    restoreEnv(prev);
  }
});

test('confirm gate blocks Calculate until the tech confirms, and screenshots still parse', () => {
  assert.equal(html.includes('FIELDROUTES_AUTH'), false);
  assert.equal(html.includes('authenticationKey'), false);
  assert.equal(html.includes('authenticationToken'), false);
  assert.match(html, /\/api\/parse/);
  assert.match(html, /function parseImages/);
  assert.match(html, /id="file-input"/);
  assert.match(html, /id="pull-route-btn"/);
  assert.match(html, /Pull today's route/);

  const app = loadApp(html);
  app.state.routeType = 'warm';
  const step2 = app.renderStep2();
  assert.match(step2, /id="pull-route-btn"/);
  assert.match(step2, /id="file-input"/);
  assert.match(step2, /id="skip-to-manual"/);

  app.state.images = [{ name: 'shot.png', dataUrl: 'data:image/png;base64,xx' }];
  assert.match(app.renderStep2(), /id="parse-btn"/);

  app.applyPulledRoute({
    routeType: 'warm',
    mixedRoute: false,
    needsReview: [],
    properties: [
      {
        name: 'Brook, K',
        sqft: 5000,
        round: 'R1',
        isRockYard: true,
        hasRockBeds: false,
        isHoseDrag: false,
        customerID: 1,
        turf: 'warm',
        confidence: 'high',
        needsReview: [],
      },
      {
        name: 'No, Diagram',
        sqft: 0,
        round: null,
        isRockYard: false,
        hasRockBeds: true,
        isHoseDrag: true,
        customerID: 7,
        turf: 'warm',
        confidence: 'low',
        needsReview: ['Missing square footage'],
      },
    ],
  });
  assert.equal(app.state.screen, 'step3');
  assert.equal(app.state.routeSource, 'pull');
  assert.equal(app.state.routeConfirmed, false);
  assert.equal(app.state.properties[0].isRockYard, true);
  assert.equal(app.state.properties[1].hasRockBeds, true);
  assert.equal(app.state.properties[1].isHoseDrag, true);

  let view = app.renderStep3();
  assert.match(view, /id="confirm-route-btn"/);
  assert.match(view, /Confirm route/);
  assert.match(view, /id="calc-btn"[^>]*disabled/);
  assert.match(view, /needs-review/);
  assert.match(view, /Missing square footage/);
  assert.match(view, /ROCK YARD/);
  assert.match(view, /HOSE DRAG/);
  assert.match(view, /\+BEDS/);
  assert.match(view, /Calculate stays off until you confirm/);

  app.confirmPulledRoute();
  assert.equal(app.state.routeConfirmed, true);
  view = app.renderStep3();
  assert.equal(/id="calc-btn"[^>]*disabled/.test(view), false);

  app.markPullEdited();
  assert.equal(app.state.routeConfirmed, false);
  view = app.renderStep3();
  assert.match(view, /id="calc-btn"[^>]*disabled/);

  app.state.routeType = 'warm';
  app.applyPulledRoute({
    routeType: null,
    mixedRoute: true,
    needsReview: ['Mixed cool and warm on this route — split before calculating'],
    properties: [
      { name: 'Cool', sqft: 1000, round: 'R4', isRockYard: false, hasRockBeds: false, isHoseDrag: false, turf: 'cool', needsReview: [], customerID: 4 },
      { name: 'Warm', sqft: 1000, round: 'R2', isRockYard: false, hasRockBeds: false, isHoseDrag: false, turf: 'warm', needsReview: [], customerID: 2 },
      { name: 'Rocks', sqft: 500, round: 'R1', isRockYard: true, hasRockBeds: false, isHoseDrag: false, turf: 'warm', needsReview: [], customerID: 1 },
    ],
  });
  assert.equal(app.state.routeMixed, true);
  assert.equal(app.state.routeType, 'warm');
  view = app.renderStep3();
  assert.match(view, /id="mixed-route-banner"/);
  assert.match(view, /id="keep-cool-btn"/);
  assert.match(view, /id="calc-btn"[^>]*disabled/);
  assert.match(view, /id="confirm-route-btn"[^>]*disabled/);

  app.keepPulledTurf('cool');
  assert.deepEqual(app.state.properties.map(row => row.name), ['Cool', 'Rocks']);
  assert.equal(app.state.routeMixed, false);
  assert.equal(app.state.routeType, 'cool');
  assert.equal(app.state.routeConfirmed, false);
  assert.match(app.renderStep3(), /id="calc-btn"[^>]*disabled/);
  app.confirmPulledRoute();
  assert.equal(/id="calc-btn"[^>]*disabled/.test(app.renderStep3()), false);

  app.state.routeSource = 'screenshot';
  app.state.routeConfirmed = true;
  app.state.routeMixed = false;
  app.state.routeReviewReasons = [];
  app.state.routeType = 'warm';
  app.state.properties = [{ name: 'Shot', sqft: 2000, round: 'R2', isRockYard: false, hasRockBeds: false, isHoseDrag: false }];
  view = app.renderStep3();
  assert.equal(view.includes('id="confirm-route-btn"'), false);
  assert.equal(/id="calc-btn"[^>]*disabled/.test(view), false);
  assert.match(view, /Shot/);
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

function loadApp(source) {
  const match = source.match(/<script>\n([\s\S]*)<\/script>\s*<\/body>/);
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
    encodeURIComponent,
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
    navigator: { userAgent: 'node-test', share() { return Promise.resolve(); } },
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
    createElement() { return el(); },
  };
  vm.createContext(sandbox);
  vm.runInContext(match[1], sandbox, { filename: 'index.html' });
  return sandbox;
}
