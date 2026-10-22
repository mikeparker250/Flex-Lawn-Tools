// Headless checks for the Bag on hand calculator, plus a before/after
// comparison of the existing round calculator and Order Planner against main.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';

function loadApp(html, filename) {
  const m = html.match(/<script>\n([\s\S]*)<\/script>\s*<\/body>/);
  if (!m) throw new Error('inline script not found in ' + filename);
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
    localStorage: {
      _m: new Map(),
      getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
      setItem(k, v) { this._m.set(k, String(v)); },
      removeItem(k) { this._m.delete(k); },
    },
    firebase: {
      apps: [],
      initializeApp() {},
      firestore() {
        const chain = {
          collection() { return chain; },
          doc() { return chain; },
          get() { return Promise.resolve({ forEach() {} }); },
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
  vm.runInContext(m[1], sandbox, { filename });
  return sandbox;
}

function pick(app, name) {
  const q = app.BAG_QUICK_PICKS.find(p => p.name === name);
  if (!q) throw new Error('missing quick pick ' + name);
  return q;
}

function fromPick(app, name, extra) {
  const q = pick(app, name);
  const labelMax = Object.prototype.hasOwnProperty.call(extra, 'labelMax') ? extra.labelMax : q.labelMax;
  return app.calcBagOnHand({
    routeType: extra.routeType,
    roundNum: extra.roundNum,
    name: q.name,
    n: q.n, p: q.p, k: q.k,
    bagLbs: extra.bagLbs || app.granuleBagLbs(q.name),
    srPercent: q.srPercent,
    srMostly: !!q.srMostly,
    labelMax,
    labelSpreader: extra.labelSpreader || q.labelSpreader,
    yourSpreader: extra.yourSpreader == null ? 'rotary' : extra.yourSpreader,
    over85: Object.prototype.hasOwnProperty.call(extra, 'over85') ? extra.over85 : false,
    fe: q.fe,
    stopSqft: extra.stopSqft || 0,
    routeSqft: extra.routeSqft || 0,
    today: extra.today || new Date(2026, 3, 20),
  });
}

function custom(app, extra) {
  return app.calcBagOnHand({
    name: extra.name || 'Custom',
    n: extra.n, p: extra.p, k: extra.k,
    bagLbs: extra.bagLbs == null ? 50 : extra.bagLbs,
    srPercent: extra.srPercent == null ? null : extra.srPercent,
    srMostly: !!extra.srMostly,
    labelMax: Object.prototype.hasOwnProperty.call(extra, 'labelMax') ? extra.labelMax : null,
    labelSpreader: extra.labelSpreader || 'any',
    yourSpreader: extra.yourSpreader || 'rotary',
    over85: Object.prototype.hasOwnProperty.call(extra, 'over85') ? extra.over85 : false,
    fe: !!extra.fe,
    stopSqft: extra.stopSqft || 0,
    routeSqft: extra.routeSqft || 0,
    routeType: extra.routeType,
    roundNum: extra.roundNum,
    today: extra.today || new Date(2026, 3, 20),
  });
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  if (!ok) console.error('FAIL', name, detail);
}

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = loadApp(html, 'index.html');
const apr20 = new Date(2026, 3, 20);
const sep29 = new Date(2026, 8, 29);

// Verified label max is Andersons 3.0 only.
for (const q of app.BAG_QUICK_PICKS) {
  const verified = q.name === 'The Andersons 5-0-31 w/ 10% Fe';
  check(
    verified ? 'Andersons label max prefilled 3.0' : `label max blank: ${q.name}`,
    verified ? q.labelMax === 3 : q.labelMax == null,
    `labelMax=${q.labelMax}`
  );
}
check('no Mike-approved override in the app', !/Mike-approved/i.test(html), 'absent');

const passCases = [
  ['24-0-11 warm R3', 'LESCO 24-0-11 w/ 2% Fe + PolyPlus', { routeType:'warm', roundNum:3, labelMax:10, today:apr20 }],
  ['24-0-11 cool R3 before May 1', 'LESCO 24-0-11 w/ 2% Fe + PolyPlus', { routeType:'cool', roundNum:3, labelMax:10, today:apr20 }],
  ['28-0-0 warm R5 (20% SR)', 'LESCO 28-0-0 w/ 20% PolyPlus + 1.2% Fe', { routeType:'warm', roundNum:5, labelMax:10, today:apr20 }],
  ['18-0-9 cool R6', 'LESCO 18-0-9 w/ 2% Fe', { routeType:'cool', roundNum:6, labelMax:10, today:apr20 }],
  ['28-0-3 cool R6', 'LESCO Poly Plus OPTI 28-0-3', { routeType:'cool', roundNum:6, labelMax:10, today:apr20 }],
  ['28-0-3 cool R7', 'LESCO Poly Plus OPTI 28-0-3', { routeType:'cool', roundNum:7, labelMax:10, today:apr20 }],
  ['Andersons 5-0-31 warm R6', 'The Andersons 5-0-31 w/ 10% Fe', { routeType:'warm', roundNum:6, today:apr20 }],
];

for (const [label, name, extra] of passCases) {
  const res = fromPick(app, name, extra);
  const reds = res.reds.join(' | ') || '(none)';
  check(`no red: ${label}`, res.status === 'ok' && res.reds.length === 0, `status=${res.status} reds=${reds}`);
}

{
  const r5 = fromPick(app, 'LESCO 28-0-0 w/ 20% PolyPlus + 1.2% Fe', { routeType:'warm', roundNum:5, labelMax:10, today:apr20 });
  const rates = (r5.rows || []).map(r => `${r.label} ${r.lbPer1KText}`).join(', ');
  check('warm R5 shows Bermuda 3.57 and Zoysia 2.75', rates === 'Bermuda 3.57, Zoysia 2.75', rates);
}

// Blank label max on an otherwise legal quick pick is not a red hard stop.
{
  const res = fromPick(app, 'LESCO Poly Plus OPTI 28-0-3', { routeType:'cool', roundNum:6, labelMax:null, today:apr20 });
  check('blank label max is incomplete, not red', res.status === 'incomplete' && res.missing.includes('label max') && res.rows.length === 0, `status=${res.status} missing=${res.missing.join(',')}`);
}

function hardStop(label, res, message) {
  const body = app.renderBagResultBody(res, false);
  const showsRate = /data-bag-status="ok"/.test(body) || /to load/.test(body) || /class="big"/.test(body);
  check(
    `RED: ${label}`,
    res.status === 'red' && res.rows.length === 0 && res.reds.includes(message) && !showsRate && /disabled[^>]*>Can't finish/.test(body) && /data-bag-status="red"/.test(body),
    `status=${res.status} reds=${res.reds.join(' | ')} showsRate=${showsRate}`
  );
}

hardStop('5-0-31 on cool R7', fromPick(app, 'The Andersons 5-0-31 w/ 10% Fe', { routeType:'cool', roundNum:7, today:apr20 }), app.FERT_LIMITS.msgWrong);
hardStop('46-0-0 unknown SR on warm R5', custom(app, { routeType:'warm', roundNum:5, name:'46-0-0 urea', n:46, p:0, k:0, labelMax:10, today:apr20 }), app.FERT_LIMITS.msgWrong);
for (const [routeType, roundNum] of [['warm',3],['warm',5],['cool',3],['cool',6],['cool',7]]) {
  hardStop(`10-10-10 on ${routeType} R${roundNum}`, custom(app, { routeType, roundNum, name:'10-10-10', n:10, p:10, k:10, labelMax:10, today:apr20 }), app.FERT_LIMITS.msgWrong);
}
hardStop('28-0-3 on warm R6', fromPick(app, 'LESCO Poly Plus OPTI 28-0-3', { routeType:'warm', roundNum:6, labelMax:40, today:apr20 }), app.FERT_LIMITS.msgPotash);
hardStop('5-10-30 on warm R6', custom(app, { routeType:'warm', roundNum:6, name:'5-10-30', n:5, p:10, k:30, labelMax:10, stopSqft:14000, today:apr20 }), app.FERT_LIMITS.msgPotash);
hardStop('0-20-20 on warm R6', custom(app, { routeType:'warm', roundNum:6, name:'0-20-20', n:0, p:20, k:20, labelMax:10, stopSqft:14000, today:apr20 }), app.FERT_LIMITS.msgPotash);
hardStop('cool R3 after May 1', fromPick(app, 'LESCO 24-0-11 w/ 2% Fe + PolyPlus', { routeType:'cool', roundNum:3, labelMax:10, today:sep29 }), app.FERT_LIMITS.msgMay1);
hardStop('warm R4 not a fertilizer round', custom(app, { routeType:'warm', roundNum:4, n:24, p:0, k:11, labelMax:10, today:apr20 }), app.FERT_LIMITS.msgNoFert);
hardStop('32-0-0 cool R7 over 85°F unknown SR', custom(app, { routeType:'cool', roundNum:7, name:'32-0-0', n:32, p:0, k:0, labelMax:10, over85:true, stopSqft:14000, today:apr20 }), app.FERT_LIMITS.msgHot);
hardStop('rate over label max', fromPick(app, 'LESCO 24-0-11 w/ 2% Fe + PolyPlus', { routeType:'warm', roundNum:3, labelMax:3, today:apr20 }), app.FERT_LIMITS.msgLabel);

// Numeric checks from the spec.
{
  const res = fromPick(app, 'The Andersons 5-0-31 w/ 10% Fe', { routeType:'warm', roundNum:6, today:apr20 });
  const row = res.rows[0];
  check('5-0-31 warm R6 is 2.9 lb/1K', res.status === 'ok' && row && row.lbPer1KText === '2.9', row && row.lbPer1KText);
  check('5-0-31 warm R6 delivers 0.145 N', row && row.deliveredNText === '0.145', row && row.deliveredNText);
  check('5-0-31 warm R6 hits 0.9 K2O', row && Math.abs(row.delivered.k - 0.9) < 1e-9, row && row.deliveredKText);
  check('5-0-31 stays under label max 3.0', row && row.lbPer1K < 3 && row.lbPer1K > 2.9, row && String(row.lbPer1K));
}

{
  const res = fromPick(app, 'LESCO Poly Plus OPTI 28-0-3', { routeType:'cool', roundNum:6, labelMax:10, today:apr20 });
  const row = res.rows[0];
  const note = res.yellows.includes(app.FERT_LIMITS.msgTwoPass);
  check('28-0-3 cool R6 is 1.79 lb/1K', res.status === 'ok' && row && row.lbPer1KText === '1.79', row && row.lbPer1KText);
  check('28-0-3 cool R6 two-pass note', note && row && row.twoPass, res.yellows.join(' | '));
}

{
  const res = custom(app, { routeType:'cool', roundNum:7, name:'32-0-0', n:32, p:0, k:0, bagLbs:50, labelMax:5, stopSqft:14000, routeSqft:14000, today:apr20 });
  const row = res.rows[0];
  const helperLine = app.granBagLine(row ? row.stop.lbs : 0, '32-0-0');
  check('32-0-0 cool R7 14,000 is 3.13 lb/1K', res.status === 'ok' && row && row.lbPer1KText === '3.13', row && row.lbPer1KText);
  check('32-0-0 stop is 43.8 lb', row && row.stop && row.stop.lbsText === '43.8', row && row.stop && row.stop.lbsText);
  check('32-0-0 is 0.88 bags', row && row.stop && row.stop.exactText === '0.88', row && row.stop && row.stop.exactText);
  check('32-0-0 loads 1 bag', row && row.stop && row.stop.load === 1, row && row.stop && row.stop.load);
  check('32-0-0 bag line matches granBagLine', row && row.stop && row.stop.line === helperLine, `${row && row.stop && row.stop.line} vs ${helperLine}`);
}

{
  const res = custom(app, { routeType:'cool', roundNum:7, name:'46-0-0 urea', n:46, p:0, k:0, labelMax:5, today:apr20 });
  const row = res.rows[0];
  check('46-0-0 cool R7 is 2.17 lb/1K and not red', res.status === 'ok' && row && row.lbPer1KText === '2.17', `status=${res.status} rate=${row && row.lbPer1KText} reds=${res.reds.join('|')}`);
}

// Existing calculator + Order Planner must match main.
// Warm R7 Pass 1 Triad/Simazine (and the order-7 totals they drive) are the
// cleared rates: Triad 3.24/0.96 oz/gal, Simazine 1.44/0.43 oz/gal. Those two
// snapshots are checked against that baseline; everything else stays on main.
function snap(ctx) {
  const baseProps = (round) => ([
    { name:'Small', sqft:8000, round, isRockYard:false, hasRockBeds:false, isHoseDrag:false, equipmentOverride:null },
    { name:'Large', sqft:14000, round, isRockYard:false, hasRockBeds:false, isHoseDrag:false, equipmentOverride:null },
  ]);
  const out = { gran: {}, liquid: {}, alt: {}, order: {} };
  for (const type of ['warm', 'cool']) {
    for (let r = 1; r <= 7; r++) {
      const props = baseProps('R' + r);
      const sec = ctx.calcRoundSection(type, r, props, {});
      const key = `${type}-R${r}`;
      out.gran[key] = ctx.renderGranCard(sec.granData);
      out.liquid[key] = JSON.stringify({
        toro: sec.toroMix, ps: sec.psMix, fung: sec.fungSepMix, mode: sec.mode,
      });
      const alt = ctx.calcRoundSection(type, r, props, { [`${type}_${r}`]: 'liquid' });
      out.alt[key] = JSON.stringify({ gran: ctx.renderGranCard(alt.granData), alt: alt.liquidAltData, mode: alt.mode });
    }
  }
  for (let r = 1; r <= 7; r++) {
    out.order[r] = JSON.stringify(ctx.calcOrderPlan(r, 95000, 42000));
  }
  return out;
}

const mainHtml = execSync('git show origin/main:index.html', { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
const main = loadApp(mainHtml, 'main-index.html');
const nowSnap = snap(app);
const mainSnap = snap(main);

// Lawn Ops cleared warm R7 Pass 1. Power Sprayer rates are explicit, not the
// 0.34/1.14 derivation. Order Planner round 7 uses the Toro rates at 95,000 sq ft.
const CLEARED_WARM_R7 = {
  'Simazine': { toro: 1.44, ps: 0.43 },
  'Triad Select': { toro: 3.24, ps: 0.96 },
};
const ORDER_SAMPLE_SQFT = 95000;
const ORDER_TORO_OUT = 0.34;

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a == null || b == null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

function setLiquidRate(mix, name, rate, psRate) {
  const row = mix && mix.products && mix.products.find(p => p.name === name);
  if (!row) return false;
  row.rate = rate;
  row.psRate = psRate;
  row.amt = mix.gal * rate;
  return true;
}

// Main snapshot with Triad and Simazine replaced by the cleared rates.
// Specticle, 90/10 NIS, and the Artavia pass stay as main recorded them.
function expectedWarmR7Liquid(mainJson) {
  const snap = JSON.parse(mainJson);
  for (const [name, rates] of Object.entries(CLEARED_WARM_R7)) {
    if (!setLiquidRate(snap.toro, name, rates.toro, rates.ps)) return null;
    if (!setLiquidRate(snap.ps, name, rates.ps, rates.ps)) return null;
  }
  return snap;
}

function setOrderTotal(list, name, needed) {
  const row = list && list.find(p => p.name === name);
  if (!row) return false;
  row.needed = needed;
  row.toOrder = row.currentStock != null ? Math.max(0, needed - row.currentStock) : needed;
  return true;
}

// Same sample as snap(): 95,000 warm sq ft at the Toro output. Combined Triad
// keeps whatever cool R7 adds on top of the warm broadcast (the 1.4 oz B&G).
function expectedOrder7(mainJson) {
  const snap = JSON.parse(mainJson);
  const gal = (ORDER_SAMPLE_SQFT / 1000) * ORDER_TORO_OUT;
  const sim = gal * CLEARED_WARM_R7['Simazine'].toro;
  const triad = gal * CLEARED_WARM_R7['Triad Select'].toro;
  const warmTriad = snap.warm.find(p => p.name === 'Triad Select');
  const combinedTriad = snap.combined.find(p => p.name === 'Triad Select');
  if (!warmTriad || !combinedTriad) return null;
  const coolExtra = combinedTriad.needed - warmTriad.needed;
  if (!setOrderTotal(snap.warm, 'Simazine', sim)) return null;
  if (!setOrderTotal(snap.warm, 'Triad Select', triad)) return null;
  if (!setOrderTotal(snap.combined, 'Simazine', sim)) return null;
  if (!setOrderTotal(snap.combined, 'Triad Select', triad + coolExtra)) return null;
  return snap;
}

function snapshotMatches(bucket, key) {
  const nowJson = nowSnap[bucket][key];
  const mainJson = mainSnap[bucket][key];
  if (bucket === 'liquid' && key === 'warm-R7') {
    const expected = expectedWarmR7Liquid(mainJson);
    return expected != null && deepEqual(JSON.parse(nowJson), expected);
  }
  if (bucket === 'order' && key === '7') {
    const expected = expectedOrder7(mainJson);
    return expected != null && deepEqual(JSON.parse(nowJson), expected);
  }
  return nowJson === mainJson;
}

let regressions = 0;
for (const bucket of ['gran', 'liquid', 'alt', 'order']) {
  const keys = Object.keys(mainSnap[bucket]);
  for (const key of keys) {
    if (snapshotMatches(bucket, key)) continue;
    regressions += 1;
    console.error('REGRESSION', bucket, key);
    console.error('--- main ---');
    console.error(String(mainSnap[bucket][key]).slice(0, 500));
    console.error('--- now ---');
    console.error(String(nowSnap[bucket][key]).slice(0, 500));
  }
}
check(`existing rounds + Order Planner match main (${Object.keys(mainSnap.gran).length * 3 + Object.keys(mainSnap.order).length} snapshots)`, regressions === 0, `${regressions} mismatches`);

// Mike-approved limits, reported at 14,000 sq ft. Unverified quick picks ship with a
// blank label max; the rate below is after the tech enters a max that does not block.
const STOP = 14000;
function caseLine(label, expect, res) {
  const rate = res.status === 'ok'
    ? res.rows.map(r => `${r.label} ${r.lbPer1KText} lb/1K`).join('; ')
    : 'none';
  const bags = res.status === 'ok'
    ? res.rows.map(r => `${r.label} ${r.stop.lbsText} lb, ${r.stop.line}`).join('; ')
    : 'none';
  const red = res.reds.length ? res.reds.join('; ') : 'none';
  const yellow = res.yellows.length ? res.yellows.join('; ') : 'none';
  const ok = expect === 'pass' ? res.status === 'ok' && res.reds.length === 0 : res.status === 'red' && res.rows.length === 0;
  check(`case table: ${label}`, ok, `${expect} status=${res.status}`);
  return { label, expect, rate, bags, red, yellow };
}
const caseRows = [
  caseLine('24-0-11 warm R3', 'pass', fromPick(app, 'LESCO 24-0-11 w/ 2% Fe + PolyPlus', { routeType:'warm', roundNum:3, labelMax:10, stopSqft:STOP, today:apr20 })),
  caseLine('24-0-11 cool R3', 'pass', fromPick(app, 'LESCO 24-0-11 w/ 2% Fe + PolyPlus', { routeType:'cool', roundNum:3, labelMax:10, stopSqft:STOP, today:apr20 })),
  caseLine('28-0-0 warm R5 (20% SR)', 'pass', fromPick(app, 'LESCO 28-0-0 w/ 20% PolyPlus + 1.2% Fe', { routeType:'warm', roundNum:5, labelMax:10, stopSqft:STOP, today:apr20 })),
  caseLine('18-0-9 cool R6', 'pass', fromPick(app, 'LESCO 18-0-9 w/ 2% Fe', { routeType:'cool', roundNum:6, labelMax:10, stopSqft:STOP, today:apr20 })),
  caseLine('28-0-3 cool R6', 'pass', fromPick(app, 'LESCO Poly Plus OPTI 28-0-3', { routeType:'cool', roundNum:6, labelMax:10, stopSqft:STOP, today:apr20 })),
  caseLine('28-0-3 cool R7', 'pass', fromPick(app, 'LESCO Poly Plus OPTI 28-0-3', { routeType:'cool', roundNum:7, labelMax:10, stopSqft:STOP, today:apr20 })),
  caseLine('Andersons 5-0-31 warm R6', 'pass', fromPick(app, 'The Andersons 5-0-31 w/ 10% Fe', { routeType:'warm', roundNum:6, stopSqft:STOP, today:apr20 })),
  caseLine('5-0-31 cool R7', 'red', fromPick(app, 'The Andersons 5-0-31 w/ 10% Fe', { routeType:'cool', roundNum:7, stopSqft:STOP, today:apr20 })),
  caseLine('46-0-0 unknown SR warm R5', 'red', custom(app, { routeType:'warm', roundNum:5, name:'46-0-0 urea', n:46, p:0, k:0, labelMax:10, stopSqft:STOP, today:apr20 })),
  caseLine('10-10-10 warm R3 (N round)', 'red', custom(app, { routeType:'warm', roundNum:3, name:'10-10-10', n:10, p:10, k:10, labelMax:10, stopSqft:STOP, today:apr20 })),
  caseLine('28-0-3 warm R6', 'red', fromPick(app, 'LESCO Poly Plus OPTI 28-0-3', { routeType:'warm', roundNum:6, labelMax:40, stopSqft:STOP, today:apr20 })),
  caseLine('5-10-30 warm R6', 'red', custom(app, { routeType:'warm', roundNum:6, name:'5-10-30', n:5, p:10, k:30, labelMax:10, stopSqft:STOP, today:apr20 })),
  caseLine('0-20-20 warm R6', 'red', custom(app, { routeType:'warm', roundNum:6, name:'0-20-20', n:0, p:20, k:20, labelMax:10, stopSqft:STOP, today:apr20 })),
];
console.log('\n## Approved-limit case results at 14,000 sq ft\n');
console.log('| Case | Expect | Rate | Bags | Red | Yellow |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const row of caseRows) {
  const cell = (s) => String(s).replace(/\|/g, '/');
  console.log(`| ${cell(row.label)} | ${row.expect} | ${cell(row.rate)} | ${cell(row.bags)} | ${cell(row.red)} | ${cell(row.yellow)} |`);
}

const warmCard = app.renderBagOnHandCard('warm', 6, 14000);
const coolCard = app.renderBagOnHandCard('cool', 7, 14000);
check('bag card renders on warm R6 and cool R7', /Bag on hand/.test(warmCard) && /andersons-5-0-31/.test(warmCard) && /Bag on hand/.test(coolCard), 'rendered');
check('no your-spreader question and no drop red', app.FERT_LIMITS.msgDrop == null && app.BAG_TECH_SPREADER === 'rotary' && !/YOUR SPREADER/.test(warmCard) && !/>Drop</.test(warmCard) && /Spreader on the truck: rotary/.test(warmCard), 'spreader ui');
{
  const opti = fromPick(app, 'LESCO Poly Plus OPTI 28-0-3', { routeType:'cool', roundNum:6, labelMax:10, yourSpreader:'drop', today:apr20 });
  check('28-0-3 cool R6 is not red when the old drop input is ignored', opti.status === 'ok' && opti.reds.length === 0, `status=${opti.status} reds=${opti.reds.join('|')}`);
  app.bagApplyPick(app.ensureBagForm('cool', 6), 'lesco-28-0-3');
  const optiCard = app.renderBagOnHandCard('cool', 6, 14000);
  check('28-0-3 label spreader is display only', /Label spreader type: Rotary only/.test(optiCard) && !/data-bag-field="labelSpreader"/.test(optiCard) && !/data-bag-field="yourSpreader"/.test(optiCard), 'label display');
}

const failed = results.filter(r => !r.ok);
console.log('\n| Check | Result | Detail |');
console.log('| --- | --- | --- |');
for (const r of results) {
  console.log(`| ${r.name.replace(/\|/g, '/')} | ${r.ok ? 'PASS' : 'FAIL'} | ${String(r.detail ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')} |`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
