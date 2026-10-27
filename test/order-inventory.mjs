// Order Planner stock subtraction. Need math is not under test here except
// a guard that the ounces and pounds going in are unchanged.
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

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  if (!ok) console.error('FAIL', name, detail);
}

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = loadApp(html, 'index.html');

function stock(quantity, unit, extra) {
  return Object.assign({ quantity, unit }, extra || {});
}

function one(name, needed, unit, inv) {
  app.setOrderInventory(inv ? { [name]: inv } : {});
  const rows = app.withOrderInventory([{ name, needed, unit }]);
  if (rows.length !== 1) throw new Error(name + ' expected 1 row, got ' + rows.length);
  return rows[0];
}

function near(a, b) {
  return Math.abs(a - b) < 1e-6;
}

// --- need math is unchanged (guard, not a rate change) ---
{
  const gal = (95000 / 1000) * 0.34;
  app.setOrderInventory({});
  const plan = app.calcOrderPlan(7, 95000, 42000);
  const warm = (name) => plan.warm.find(p => p.name === name);
  const cool = (name) => plan.cool.find(p => p.name === name);
  const both = (name) => plan.combined.find(p => p.name === name);
  check('R7 Simazine need is 2.15 oz/gal Toro', near(warm('Simazine').needed, gal * 2.15), warm('Simazine').needed);
  check('R7 warm products are Simazine, Triad, NIS, and Artavia', plan.warm.map(p => p.name).join('|') === 'Simazine|Triad Select|90/10 NIS|Artavia SC (Azoxystrobin)', plan.warm.map(p => p.name).join('|'));
  const r2 = app.calcOrderPlan(2, 95000, 0);
  check('R2 warm products are Prodiamine, Triad, Quin-Way, MSO, then the B&G list', r2.warm.map(p => p.name).join('|') === 'Prodiamine 65 WDG|Triad Select|Quin-Way 1.5L|MSO|Albaugh Sulfentrazone 4SC Select|90/10 NIS|Special Sauce', r2.warm.map(p => p.name).join('|'));
  check('R7 Triad need is unchanged', near(warm('Triad Select').needed, gal * 3.24), warm('Triad Select').needed);
  check('R7 90/10 need is unchanged', near(warm('90/10 NIS').needed, gal * 0.28), warm('90/10 NIS').needed);
  check('R7 Artavia need is unchanged', near(warm('Artavia SC (Azoxystrobin)').needed, gal * 2.26), warm('Artavia SC (Azoxystrobin)').needed);
  check('R7 OPTI need is unchanged', near(cool('LESCO Poly Plus OPTI 28-0-3').needed, (42000 / 1000) * 3.57), cool('LESCO Poly Plus OPTI 28-0-3').needed);
  check('R7 combined Triad adds the 1.4 oz B&G once', near(both('Triad Select').needed, gal * 3.24 + 1.4), both('Triad Select').needed);
  check('R7 combined 90/10 adds the 0.25 oz B&G once', near(both('90/10 NIS').needed, gal * 0.28 + 0.25), both('90/10 NIS').needed);
}

// --- subtraction in each unit, both sides in the need's base unit ---
{
  const oz = one('Stonewall 4L (Prodiamine)', 10, 'oz', stock(3, 'oz'));
  check('oz minus oz', oz.stockStatus === 'ok' && near(oz.onHandBase, 3) && near(oz.toOrder, 7), oz.toOrder);

  const floz = one('Quin-Way 1.5L', 10, 'fl oz', stock(4, 'fl oz'));
  check('fl oz minus fl oz', floz.stockStatus === 'ok' && near(floz.onHandBase, 4) && near(floz.toOrder, 6), floz.toOrder);

  const ozFromFl = one('Triad Select', 10, 'oz', stock(4, 'fl oz'));
  check('oz need accepts fl oz stock', ozFromFl.stockStatus === 'ok' && near(ozFromFl.toOrder, 6), ozFromFl.toOrder);

  const gal = one('Terra Ally TA 22-0-0', 200, 'fl oz', stock(1, 'gal'));
  check('1 gallon is 128 fl oz', gal.stockStatus === 'ok' && near(gal.onHandBase, 128) && near(gal.toOrder, 72), gal.onHandBase);
  check('1 gallon does not subtract as 1 oz', !near(gal.toOrder, 199), gal.toOrder);

  const galSpace = one('Terra Ally TA 22-0-0', 200, 'fl oz', stock(1, 'Gallons '));
  check('Gallons with a trailing space still converts', near(galSpace.onHandBase, 128) && near(galSpace.toOrder, 72), galSpace.onHandBase);

  const twoAndHalf = one('Triad Select', 100, 'oz', stock(2.5, 'gal'));
  check('2.5 gal subtracts 320 oz, not 2.5 oz', near(twoAndHalf.onHandBase, 320) && twoAndHalf.toOrder === 0, twoAndHalf.toOrder);

  const lbs = one('LESCO 24-0-11 w/ 2% Fe + PolyPlus', 80, 'lbs', stock(10, 'lb'));
  check('pounds minus pounds', lbs.stockStatus === 'ok' && near(lbs.onHandBase, 10) && near(lbs.toOrder, 70), lbs.toOrder);

  const bags = one('LESCO Poly Plus OPTI 28-0-3', 80, 'lbs', stock(1, 'Bags'));
  check('1 bag is 50 lb on hand', bags.stockStatus === 'ok' && near(bags.onHandBase, 50) && near(bags.toOrder, 30), bags.onHandBase);
  check('a bag is not subtracted as 1 lb', !near(bags.toOrder, 79), bags.toOrder);

  const dry = one('Prodiamine 65 WDG', 40, 'oz dry', stock(1, 'Lbs'));
  check('1 lb is 16 oz dry', dry.stockStatus === 'ok' && near(dry.onHandBase, 16) && near(dry.toOrder, 24), dry.onHandBase);
  check('dry ounces are not a 50 lb fertilizer bag', dry.orderContainers == null && dry.containerSize == null, dry.containerSize);
}

// --- every jug is 2.5 gal = 320 fl oz ---
{
  const jug = one('Triad Select', 10, 'oz', stock(2, 'Jugs'));
  check('2 jugs are 640 fl oz on hand', jug.stockStatus === 'ok' && near(jug.onHandBase, 640) && jug.toOrder === 0, jug.onHandBase);
  check('2 jugs is not 10 - 2', jug.toOrder !== 8, jug.toOrder);
  check('a covered jug order has no container-size flag', !/container size unknown/i.test(jug.containerFlag || '') && !/container size unknown/i.test(jug.stockFlag || ''), jug.containerFlag || jug.stockFlag);

  const oneJug = one('Stonewall 4L (Prodiamine)', 400, 'oz', stock(1, 'Jug'));
  check('1 jug leaves 80 oz and rounds up to 1 jug', oneJug.stockStatus === 'ok' && near(oneJug.onHandBase, 320) && near(oneJug.toOrder, 80) && oneJug.orderContainers === 1 && oneJug.containerSize === 320, orderText(oneJug));
  check('jug order names 320 fl oz', oneJug.containerSizeLabel === '320 fl oz' && orderText(oneJug).includes('1 jug @ 320 fl oz'), orderText(oneJug));

  const zeroJug = one('Triad Select', 10, 'oz', stock(0, 'Jugs'));
  check('0 jugs is 0 on hand', zeroJug.stockStatus === 'ok' && zeroJug.onHandBase === 0 && near(zeroJug.toOrder, 10), zeroJug.toOrder);
  check('0 jugs rounds up to 1 whole jug', zeroJug.orderContainers === 1 && zeroJug.containerSize === 320, zeroJug.orderContainers);
  check('0 jugs drops the container-size-unknown flag', !/container size unknown/i.test(zeroJug.containerFlag || ''), zeroJug.containerFlag);

  const twoJugs = one('Artavia SC (Azoxystrobin)', 321, 'fl oz', stock(0, 'jugs'));
  check('321 fl oz rounds up to 2 jugs', near(twoJugs.toOrder, 321) && twoJugs.orderContainers === 2, twoJugs.orderContainers);

  const exactJug = one('Propiconazole 14.3', 320, 'fl oz', stock(0, 'Jugs'));
  check('320 fl oz is exactly 1 jug', exactJug.toOrder === 320 && exactJug.orderContainers === 1, exactJug.orderContainers);

  const threeWay = one('Three-Way', 100, 'oz', stock(1, 'Jugs'));
  check('Three-Way jug is 320 fl oz', near(threeWay.onHandBase, 320) && threeWay.toOrder === 0 && threeWay.containerSize === 320, threeWay.onHandBase);

  const quinJug = one('Quin-Way 1.5L', 100, 'fl oz', stock(1, 'Jugs'));
  check('a Quin-Way jug is 320 fl oz, not the 64 fl oz bottle', near(quinJug.onHandBase, 320) && quinJug.toOrder === 0, quinJug.onHandBase);
}

// --- invoice bottle sizes; every other bottle stays unknown ---
{
  const other = one('Atrazine', 10, 'oz', stock(1, 'Bottle'));
  check('an unlisted bottle stays container size unknown', other.stockStatus === 'unknown_container' && other.toOrder == null && /container size unknown/i.test(other.stockFlag), other.stockFlag);

  const zeroBottle = one('Atrazine', 18.3, 'oz', stock(0, 'Bottles'));
  check('0 unknown bottles still order the base amount', zeroBottle.stockStatus === 'ok' && near(zeroBottle.toOrder, 18.3) && zeroBottle.orderContainers == null, zeroBottle.toOrder);
  check('0 unknown bottles are not rounded', /container size unknown/i.test(zeroBottle.containerFlag) && /not rounded up to bottles/.test(zeroBottle.containerFlag), zeroBottle.containerFlag);

  const quin = one('Quin-Way 1.5L', 100, 'fl oz', stock(1, 'Bottle'));
  check('Quin-Way bottle is 64 fl oz', quin.stockStatus === 'ok' && near(quin.onHandBase, 64) && near(quin.toOrder, 36) && quin.orderContainers === 1 && quin.containerSize === 64, orderText(quin));
  check('Quin-Way bottle line names 64 fl oz', orderText(quin).includes('1 bottle @ 64 fl oz'), orderText(quin));

  const quinShort = one('Quin-Way', 64, 'fl oz', stock(1, 'Bottles'));
  check('Quin-Way short name bottle is 64 fl oz', near(quinShort.onHandBase, 64) && quinShort.toOrder === 0, quinShort.onHandBase);

  const albaughBottle = one('Albaugh Sulfentrazone 4SC Select', 100, 'oz', stock(1, 'Bottle'));
  check('Albaugh bottle is 64 fl oz', near(albaughBottle.onHandBase, 64) && near(albaughBottle.toOrder, 36) && albaughBottle.containerSize === 64, orderText(albaughBottle));

  const nis = one('90/10 NIS', 51.49, 'oz', stock(2, 'Bottles'));
  check('90/10 bottle is 320 fl oz', nis.stockStatus === 'ok' && near(nis.onHandBase, 640) && nis.toOrder === 0, nis.onHandBase);
  check('90/10 known size drops the container-size-unknown flag', !/container size unknown/i.test(nis.containerFlag || '') && !/container size unknown/i.test(nis.stockFlag || ''), nis.stockFlag || nis.containerFlag);

  const nisZero = one('90/10 NIS', 51.49, 'oz', stock(0, 'Bottles'));
  check('0 NIS bottles round up to 1 jug of 320 fl oz', near(nisZero.onHandBase, 0) && near(nisZero.toOrder, 51.49) && nisZero.orderContainers === 1 && nisZero.containerSize === 320, orderText(nisZero));

  const simBottle = one('Simazine 4L', 400, 'oz', stock(1, 'Bottle'));
  check('Simazine 4L bottle is 320 fl oz', near(simBottle.onHandBase, 320) && near(simBottle.toOrder, 80) && simBottle.orderContainers === 1 && simBottle.containerSize === 320, orderText(simBottle));
  check('Simazine Have says jug', app.fmtHaveText(simBottle) === '1 jug = 320.0 oz', app.fmtHaveText(simBottle));
  check('90/10 Have keeps the warehouse bottle unit', app.fmtHaveText(nis) === '2 Bottles = 640.0 oz', app.fmtHaveText(nis));
}

// --- other unit failures ---
{
  const blank = one('MSO', 10, 'oz', stock(5, ''));
  check('blank unit is not subtracted', blank.stockStatus === 'missing_unit' && blank.toOrder == null, blank.stockStatus);
  check('blank unit does not subtract the raw 5', blank.toOrder !== 5, blank.toOrder);

  const units = one('MSO', 10, 'oz', stock(3, 'Units'));
  check('unknown unit is not subtracted', units.stockStatus === 'unknown_unit' && units.toOrder == null, units.stockFlag);

  const zeroUnits = one('MSO', 10, 'oz', stock(0, 'Units'));
  check('0 of an unknown unit is still 0', zeroUnits.stockStatus === 'ok' && zeroUnits.onHandBase === 0 && near(zeroUnits.toOrder, 10), zeroUnits.toOrder);

  const fluidOnDry = one('Prodiamine 65 WDG', 20, 'oz dry', stock(4, 'fl oz'));
  check('fluid ounces are not converted into dry ounces', fluidOnDry.stockStatus === 'unknown_unit' && fluidOnDry.toOrder == null, fluidOnDry.stockFlag);

  const liquidBag = one('Triad Select', 10, 'oz', stock(2, 'Bags'));
  check('a bag of a liquid has no known size', liquidBag.stockStatus === 'unknown_container' && liquidBag.toOrder == null, liquidBag.stockStatus);
}

// --- clamp at 0, including a negative count ---
{
  const over = one('Triad Select', 5, 'oz', stock(9, 'oz'));
  check('stock above the need clamps at 0', over.toOrder === 0 && over.orderContainers == null, over.toOrder);

  const overGal = one('Terra Ally TA 22-0-0', 10, 'fl oz', stock(1, 'gal'));
  check('a gallon against 10 fl oz clamps at 0', overGal.toOrder === 0 && overGal.orderContainers === 0, overGal.toOrder);

  const neg = one('Triad Select', 10, 'oz', stock(-3, 'oz'));
  check('negative stock does not increase the order', neg.stockStatus === 'ok' && neg.onHandBase === 0 && near(neg.toOrder, 10), neg.toOrder);
  check('negative stock is flagged', /treated as 0/.test(neg.containerFlag), neg.containerFlag);

  const zero = one('Triad Select', 0, 'oz', stock(0, 'oz'));
  check('zero need stays zero', zero.toOrder === 0, zero.toOrder);
}

// --- round up to whole containers ---
{
  const exact = one('LESCO 24-0-11 w/ 2% Fe + PolyPlus', 50, 'lbs', stock(0, 'Bags'));
  check('50 lb rounds up to 1 bag', exact.toOrder === 50 && exact.orderContainers === 1 && exact.containerSize === 50, exact.orderContainers);

  const overBag = one('LESCO 24-0-11 w/ 2% Fe + PolyPlus', 50.1, 'lbs', stock(0, 'Bags'));
  check('50.1 lb rounds up to 2 bags', near(overBag.toOrder, 50.1) && overBag.orderContainers === 2, overBag.orderContainers);

  const none = one('LESCO 24-0-11 w/ 2% Fe + PolyPlus', 40, 'lbs', stock(1, 'Bags'));
  check('need covered by a bag rounds to 0 bags', none.toOrder === 0 && none.orderContainers === 0, none.orderContainers);

  const partial = one('LESCO Poly Plus OPTI 28-0-3', 80, 'lbs', stock(1, 'bag'));
  check('30 lb left rounds up to 1 bag', near(partial.toOrder, 30) && partial.orderContainers === 1, partial.orderContainers);
  check('bag line names the 50 lb size', partial.containerSizeLabel === '50 lb' && orderText(partial).includes('1 bag @ 50 lb'), orderText(partial));

  const galOrder = one('Terra Ally TA 22-0-0', 200, 'fl oz', stock(1, 'gal'));
  check('72 fl oz rounds up to 1 gal', near(galOrder.toOrder, 72) && galOrder.orderContainers === 1 && galOrder.containerSize === 128, galOrder.orderContainers);

  const twoGal = one('Terra Ally TA 22-0-0', 128.1, 'fl oz', stock(0, 'gal'));
  check('128.1 fl oz rounds up to 2 gal', near(twoGal.toOrder, 128.1) && twoGal.orderContainers === 2, twoGal.orderContainers);

  const oneGal = one('Terra Ally TA 22-0-0', 128, 'fl oz', stock(0, 'gal'));
  check('128 fl oz is exactly 1 gal', oneGal.toOrder === 128 && oneGal.orderContainers === 1, oneGal.orderContainers);

  const ozOnly = one('Triad Select', 10, 'oz', stock(3, 'oz'));
  check('ounces are not guessed into jugs', ozOnly.orderContainers == null && /Container size unknown/.test(ozOnly.containerFlag), ozOnly.containerFlag);
}

function orderText(p) {
  return app.orderAmountText(p);
}

// --- one subtraction for a product that shows up twice ---
{
  app.setOrderInventory({ 'Triad Select': stock(3, 'oz') });
  const rows = app.withOrderInventory([
    { name: 'Triad Select', needed: 10, unit: 'oz' },
    { name: 'Triad Select', needed: 5, unit: 'oz' },
  ]);
  check('shared product subtracts stock once', rows.length === 1 && near(rows[0].needed, 15) && near(rows[0].toOrder, 12), rows[0].toOrder);
}

// --- case, whitespace, and the two confirmed aliases ---
{
  app.setOrderInventory({ 'Three-way': stock(3, 'Jugs') });
  const three = app.withOrderInventory([{ name: 'Three-Way', needed: 10, unit: 'oz' }])[0];
  check('Three-Way matches Three-way', three.stockStatus === 'ok' && near(three.onHandBase, 960) && three.toOrder === 0, three.onHandBase);

  app.setOrderInventory({ '  triad select  ': stock(4, 'oz') });
  const spaced = app.withOrderInventory([{ name: 'Triad Select', needed: 10, unit: 'oz' }])[0];
  check('trimmed whitespace matches', spaced.stockStatus === 'ok' && near(spaced.onHandBase, 4) && near(spaced.toOrder, 6), spaced.toOrder);

  app.setOrderInventory({ 'Triad   Select': stock(4, 'oz') });
  const collapsed = app.withOrderInventory([{ name: 'Triad Select', needed: 10, unit: 'oz' }])[0];
  check('collapsed internal whitespace matches', collapsed.stockStatus === 'ok' && near(collapsed.toOrder, 6), collapsed.toOrder);

  app.setOrderInventory({ 'Simazine 4L': stock(1, 'Bottle') });
  const sim = app.withOrderInventory([{ name: 'Simazine', needed: 400, unit: 'oz' }])[0];
  check('Simazine aliases to Simazine 4L', sim.stockStatus === 'ok' && near(sim.onHandBase, 320) && near(sim.toOrder, 80), sim.onHandBase);
  check('aliased Simazine uses the 320 fl oz bottle', sim.orderContainers === 1 && sim.containerSize === 320, orderText(sim));

  app.setOrderInventory({ 'Sulfentrazone': stock(5, 'Jugs') });
  const sulf = app.withOrderInventory([{ name: 'Albaugh Sulfentrazone 4SC Select', needed: 0.18, unit: 'oz' }])[0];
  check('Albaugh aliases to Sulfentrazone jugs', sulf.stockStatus === 'ok' && near(sulf.onHandBase, 1600) && sulf.toOrder === 0, sulf.onHandBase);

  app.setOrderInventory({
    'Simazine': stock(2, 'oz'),
    'Simazine 4L': stock(1, 'Bottle'),
  });
  const exactSim = app.withOrderInventory([{ name: 'Simazine', needed: 10, unit: 'oz' }])[0];
  check('exact Simazine wins over the Simazine 4L alias', near(exactSim.onHandBase, 2) && near(exactSim.toOrder, 8), exactSim.onHandBase);

  app.setOrderInventory({ 'MSO Adigor': stock(4, 'Jugs') });
  const mso = app.withOrderInventory([{ name: 'MSO', needed: 10, unit: 'oz' }])[0];
  check('MSO does not alias to MSO Adigor', mso.stockStatus === 'unmatched' && mso.toOrder == null, mso.stockStatus);
  check('unmatched flag is explicit', mso.stockFlag === 'No warehouse match — stock not subtracted', mso.stockFlag);

  app.setOrderInventory({ 'Artavia SC (Azoxystrobin)': stock(2, 'Jugs') });
  const azoxy = app.withOrderInventory([{ name: 'Artavia SC (Azoxy)', needed: 10, unit: 'fl oz' }])[0];
  check('Artavia does not alias to Azoxy', azoxy.stockStatus === 'unmatched' && azoxy.toOrder == null, azoxy.stockFlag);

  app.setOrderInventory({ 'Lesco 28-0-3 ': stock(12, 'Bags') });
  const opti = app.withOrderInventory([{ name: 'LESCO Poly Plus OPTI 28-0-3', needed: 80, unit: 'lbs' }])[0];
  check('OPTI aliases to Lesco 28-0-3 after trim and case fold', opti.stockStatus === 'ok' && near(opti.onHandBase, 600) && opti.toOrder === 0, opti.onHandBase);
  check('trailing space on Lesco 28-0-3 still matches', app.inventoryMatchKey('Lesco 28-0-3 ') === 'lesco 28-0-3' && app.inventoryMatchKey('LESCO POLY PLUS OPTI 28-0-3') === 'lesco poly plus opti 28-0-3', app.inventoryMatchKey('Lesco 28-0-3 '));

  app.setOrderInventory({
    'LESCO Poly Plus OPTI 28-0-3': stock(1, 'Bags'),
    'Lesco 28-0-3 ': stock(12, 'Bags'),
  });
  const exactOpti = app.withOrderInventory([{ name: 'LESCO Poly Plus OPTI 28-0-3', needed: 80, unit: 'lbs' }])[0];
  check('exact OPTI name wins over the Lesco 28-0-3 alias', near(exactOpti.onHandBase, 50) && near(exactOpti.toOrder, 30), exactOpti.onHandBase);

  app.setOrderInventory({});
  const miss = app.withOrderInventory([{ name: 'Special Sauce', needed: 10, unit: 'oz' }])[0];
  check('a missing name stays unmatched', miss.stockStatus === 'unmatched' && miss.toOrder == null, miss.stockFlag);
}

// --- a failed load is never a silent full order ---
{
  app.setOrderInventory({}, { error: 'inventory failed to load' });
  const down = app.withOrderInventory([{ name: 'Triad Select', needed: 10, unit: 'oz' }])[0];
  check('failed load does not order the full need', down.stockStatus === 'inventory_unavailable' && down.toOrder == null, down.toOrder);
  check('failed load says inventory failed to load', down.stockFlag === 'inventory failed to load' && app.fmtHaveText(down) === 'inventory failed to load', app.fmtHaveText(down));
  check('failed load is never a no-match', down.stockStatus !== 'unmatched' && !/no match/i.test(app.fmtHaveText(down)) && !/no warehouse match/i.test(down.stockFlag), down.stockFlag);
  const banner = app.renderRoundInventoryBanner('warm', 7, 'R7');
  check('failed load is not an all-in-stock banner', /inventory failed to load/.test(banner) && !/ALL PRODUCTS IN STOCK/.test(banner) && !/no match/i.test(banner), banner.slice(0, 180));
  const notice = app.orderInventoryNotices(app.calcOrderPlan(7, 1000, 0));
  check('order planner shows the load failure', /id="op-inv-flag"/.test(notice) && /inventory failed to load/.test(notice) && !/no match/i.test(notice), notice.slice(0, 220));
  const failedRows = app.renderOrderRows(app.withOrderInventory([{ name: 'Triad Select', needed: 18.3, unit: 'oz' }]));
  check('failed load row is not no match', /inventory failed to load/.test(failedRows) && !/no match/i.test(failedRows), failedRows.slice(0, 240));
  check('quantity wins over onHand', app.inventoryDocQuantity({ quantity: 1, onHand: 9 }) === 1, app.inventoryDocQuantity({ quantity: 1, onHand: 9 }));
  check('onHand is the quantity when quantity is absent', app.inventoryDocQuantity({ onHand: 3 }) === 3, app.inventoryDocQuantity({ onHand: 3 }));
  check('a blank quantity falls through to onHand', app.inventoryDocQuantity({ quantity: '', onHand: 4 }) === 4, app.inventoryDocQuantity({ quantity: '', onHand: 4 }));
  check('missing quantity and onHand is 0', app.inventoryDocQuantity({}) === 0, app.inventoryDocQuantity({}));

  app.setOrderInventory({}, { ready: false });
  const loading = app.withOrderInventory([{ name: 'Triad Select', needed: 10, unit: 'oz' }])[0];
  check('loading inventory does not order the full need', loading.stockStatus === 'loading' && loading.toOrder == null, loading.stockStatus);
}

// --- Have shows the unit and a stamp when the doc has one ---
{
  const stamp = '2026-10-01T15:04:00Z';
  app.setOrderInventory({
    'Terra Ally TA 22-0-0': stock(150, 'Gallons ', { updatedAt: stamp }),
  });
  const row = app.withOrderInventory([{ name: 'Terra Ally TA 22-0-0', needed: 100, unit: 'fl oz' }])[0];
  const have = app.fmtHaveText(row);
  check('Have keeps the inventory unit', /150 Gallons/.test(have) && /= 19200\.0 fl oz/.test(have), have);
  check('Have includes the doc timestamp', /updated /.test(have) && /2026/.test(have), have);
  check('150 gallons covers 100 fl oz', row.toOrder === 0, row.toOrder);

  const seconds = { seconds: 1761168000 };
  const fromSeconds = app.formatInventoryStamp(seconds);
  check('Firestore seconds stamp formats', /2025|2026/.test(fromSeconds), fromSeconds);

  app.setOrderInventory({ 'Triad Select': stock(2, 'Jugs', { updatedAt: stamp }) });
  const htmlRows = app.renderOrderRows(app.withOrderInventory([{ name: 'Triad Select', needed: 10, unit: 'oz' }]));
  check('jug row converts and stocks the order', /data-stock-status="ok"/.test(htmlRows) && /data-to-order="0"/.test(htmlRows), htmlRows);
  check('jug row shows Have in jugs and fl oz', /2 Jugs = 640.0 oz/.test(htmlRows) && /updated /.test(htmlRows), htmlRows);
  check('jug row does not show the old 8 oz order', !/data-to-order="8"/.test(htmlRows) && !/container size unknown/i.test(htmlRows), htmlRows);

  app.setOrderInventory({ 'Triad Select': stock(0, 'Jugs') });
  const jugOrder = app.renderOrderRows(app.withOrderInventory([{ name: 'Triad Select', needed: 400, unit: 'oz' }]));
  check('jug shortfall rounds up in the row', /400.0 oz · 2 jugs @ 320 fl oz/.test(jugOrder) && !/container size unknown/i.test(jugOrder), jugOrder);

  app.setOrderInventory({ 'LESCO 24-0-11 w/ 2% Fe + PolyPlus': stock(0, 'Bags') });
  const bagHtml = app.renderOrderRows(app.withOrderInventory([{ name: 'LESCO 24-0-11 w/ 2% Fe + PolyPlus', needed: 80, unit: 'lbs' }]));
  check('bag order shows base pounds and whole bags', /80 lb · 2 bags @ 50 lb/.test(bagHtml) && /0 Bags = 0 lb/.test(bagHtml), bagHtml);

  app.setOrderInventory({});
  const plan = app.calcOrderPlan(2, 1000, 0);
  const share = app.buildPlanShareText(2, 1000, 0, 1, 0, plan);
  check('unmatched round share text is the stocked message', share === '📦 Flex Lawn — R2 Order List\n✅ Stocked — nothing to buy', share);
  check('share text has no Need/Have dump', !/Need |Have |→|WARM|COOL|COMBINED|No products/.test(share), share);
}

// --- R7 against the v73 warehouse snapshot (fixture, not a live read) ---
{
  const WARM = 538261;
  const COOL = 20939;
  const gal = (WARM / 1000) * 0.34;
  app.setOrderInventory({
    'Simazine 4L': stock(1, 'Bottle'),
    'Triad Select': stock(0, 'Jugs'),
    '90/10 NIS': stock(2, 'Bottles'),
    'Artavia SC (Azoxystrobin)': stock(0, 'Jugs'),
    'Lesco 28-0-3': stock(12, 'Bags'),
    'Sulfentrazone': stock(5, 'Jugs'),
    'Three-way': stock(3, 'Jugs'),
    'MSO Adigor': stock(0, 'Jugs'),
  });
  const plan = app.calcOrderPlan(7, WARM, COOL);
  const row = (name) => plan.combined.find(p => p.name === name);
  const sim = row('Simazine');
  const triad = row('Triad Select');
  const nis = row('90/10 NIS');
  const art = row('Artavia SC (Azoxystrobin)');
  const opti = row('LESCO Poly Plus OPTI 28-0-3');
  const sulf = row('Albaugh Sulfentrazone 4SC Select');
  check('R7 Simazine need is 2.15 oz/gal', near(sim.needed, gal * 2.15), sim.needed);
  check('R7 Simazine 1 bottle leaves one jug to order', sim.stockStatus === 'ok' && near(sim.onHandBase, 320) && sim.orderContainers === 1 && sim.containerSize === 320 && sim.toOrder > 0, sim.toOrder);
  check('R7 Simazine Have displays the 320 fl oz container as a jug', app.fmtHaveText(sim) === '1 jug = 320.0 oz', app.fmtHaveText(sim));
  const simRow = app.renderOrderRows([sim]);
  check('R7 Simazine row has the Drexel Buy line', /Buy: Drexel Simazine 4L \(EPA 19713-60\), 2.5 gal jug/.test(simRow) && /1 jug = 320\.0 oz/.test(simRow), simRow);
  const nisRow = app.renderOrderRows([nis]);
  check('R7 90/10 row has the LESCO Buy line', /Buy: LESCO 90\/10 Nonionic Surfactant, 2\.5 gal/.test(nisRow), nisRow);
  const optiRow = app.renderOrderRows([opti]);
  check('R7 OPTI row has the 50 lb bag Buy line', /Buy: LESCO Poly Plus OPTI 28-0-3, 50 lb bag/.test(optiRow), optiRow);
  const sulfRow = app.renderOrderRows([sulf]);
  check('R7 Albaugh row has the 64 fl oz Buy line', /Buy: Albaugh Sulfentrazone 4SC Select, 64 fl oz/.test(sulfRow), sulfRow);
  const triadRow = app.renderOrderRows([triad]);
  const artRow = app.renderOrderRows([art]);
  check('unsourced R7 rows have no Buy line', !/Buy:/.test(triadRow) && !/Buy:/.test(artRow), triadRow.slice(0, 80));
  check('R7 Triad need unchanged', near(triad.needed, gal * 3.24 + 1.4), triad.needed);
  check('R7 Triad 0 jugs rounds up to 2 jugs', triad.onHandBase === 0 && triad.orderContainers === 2 && triad.containerSize === 320 && !/container size unknown/i.test(triad.containerFlag || ''), triad.orderContainers);
  check('R7 90/10 need unchanged', near(nis.needed, gal * 0.28 + 0.25), nis.needed);
  check('R7 90/10 2 bottles cover the need', near(nis.onHandBase, 640) && nis.toOrder === 0, nis.onHandBase);
  check('R7 Artavia need unchanged', near(art.needed, gal * 2.26), art.needed);
  check('R7 Artavia 0 jugs rounds up to 2 jugs', art.onHandBase === 0 && art.orderContainers === 2 && art.containerSize === 320, art.orderContainers);
  check('R7 OPTI need unchanged', near(opti.needed, (COOL / 1000) * 3.57), opti.needed);
  check('R7 OPTI aliases to 12 Lesco 28-0-3 bags', opti.stockStatus === 'ok' && near(opti.onHandBase, 600) && opti.toOrder === 0, opti.onHandBase);
  check('R7 Albaugh need unchanged', near(sulf.needed, 0.18), sulf.needed);
  check('R7 Albaugh 5 jugs cover the need', near(sulf.onHandBase, 1600) && sulf.toOrder === 0, sulf.onHandBase);
  const share = app.buildPlanShareText(7, WARM, COOL, 12, 4, plan);
  const expectedBuy = [
    '📦 Flex Lawn — R7 Order List',
    '🛒 Buy:',
    '• Simazine — 1 jug',
    '• Triad Select — 2 jugs',
    '• Artavia SC (Azoxystrobin) — 2 jugs',
  ].join('\n');
  check('R7 share text lists only buys in store units', share === expectedBuy, share);
  check('R7 share text omits stocked rows and the old dump', !/OPTI|90\/10|Albaugh|Need |Have |sq ft|EPA|Buy: |updated |No products|WARM|COOL|COMBINED/.test(share), share);
  app.state.opRound = 7;
  app.state.opSqftWarm = WARM;
  app.state.opSqftCool = COOL;
  app.state.opCountWarm = 12;
  app.state.opCountCool = 4;
  const view = app.renderOrderPlanner();
  check('on-screen order list matches the share text', view.includes(share) && view.includes('id="op-order-list"'), share);
  check('on-screen order list drops the Need/Have trio and turf dumps', !/id="op-warm"|id="op-cool"|id="op-combined"|NEED |HAVE |ORDER /.test(view), 'order list card');
}

{
  const stocked = app.buildPlanShareText(4, 1000, 1000, 3, 2, {
    warm: [{ name: 'Simazine', toOrder: 80, orderContainers: 1, containerLabel: 'jug', currentStock: 0, unit: 'oz' }],
    cool: [{ name: 'Triad Select', toOrder: 400, orderContainers: 2, containerLabel: 'jug', currentStock: 0, unit: 'oz' }],
    combined: [
      { name: 'Simazine', toOrder: 0, orderContainers: 0, containerLabel: 'jug', currentStock: 2, unit: 'oz' },
      { name: 'Triad Select', toOrder: 0.5, orderContainers: 1, containerLabel: 'jug', currentStock: 0, unit: 'oz' },
    ],
  });
  check('fully stocked share text ignores warm and cool blocks', stocked === '📦 Flex Lawn — R4 Order List\n✅ Stocked — nothing to buy', stocked);

  const buy = app.buildPlanShareText(3, 0, 0, 0, 0, {
    combined: [
      { name: 'Simazine', toOrder: 80, orderContainers: 1, containerLabel: 'jug', currentStock: 1, unit: 'oz', cond: 'Dormant turf ONLY. Warm-season ONLY — NEVER on fescue.' },
      { name: 'LESCO Poly Plus OPTI 28-0-3', toOrder: 180, orderContainers: 4, containerLabel: 'bag', currentStock: 0, unit: 'lbs', cond: 'highest turf rate used' },
      { name: '90/10 NIS', toOrder: 0, currentStock: 2, unit: 'oz' },
      { name: 'Quin-Way 1.5L', toOrder: 36, orderContainers: 1, containerLabel: 'bottle', currentStock: null, unit: 'fl oz', cond: 'ester' },
    ],
  });
  const buyText = [
    '📦 Flex Lawn — R3 Order List',
    '🛒 Buy:',
    '• Simazine — 1 jug',
    '• LESCO Poly Plus OPTI 28-0-3 — 4 bags (50 lb)',
    '• Quin-Way 1.5L (ester) — 1 bottle',
    '⚠️ Check stock: Quin-Way 1.5L',
  ].join('\n');
  check('buy share text is combined-only store units', buy === buyText, buy);
  check('buy share text has no Need/Have or EPA catalog line', !/Need |Have |→|EPA|Buy: |updated /.test(buy), buy);
}

{
  app.setOrderInventory({ 'Three-way': stock(0, 'Jugs') });
  const cool = app.renderRoundInventoryBanner('cool', 1, 'R1');
  check('banner matches Three-way to Three-Way', /Three-Way/.test(cool) && /OUT/.test(cool) && !/ALL PRODUCTS IN STOCK/.test(cool), cool.slice(0, 240));

  app.setOrderInventory({ 'Simazine 4L': stock(0, 'Bottle') });
  const warm = app.renderRoundInventoryBanner('warm', 7, 'R7');
  check('banner aliases Simazine 4L onto Simazine', /Simazine/.test(warm) && /OUT/.test(warm) && !/Simazine 4L/.test(warm), warm.slice(0, 240));

  app.setOrderInventory({ 'Lesco 28-0-3 ': stock(0, 'Bags') });
  const optiBanner = app.renderRoundInventoryBanner('cool', 7, 'R7');
  check('banner aliases Lesco 28-0-3 onto OPTI', /LESCO Poly Plus OPTI 28-0-3/.test(optiBanner) && /OUT/.test(optiBanner) && !/ALL PRODUCTS IN STOCK/.test(optiBanner), optiBanner.slice(0, 240));
}

{
  const version = JSON.parse(fs.readFileSync(new URL('../version.json', import.meta.url), 'utf8'));
  check('version.json is 79', version.v === 79, version.v);
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  check('service worker cache is v79', sw.includes('flex-mix-v79') && !sw.includes('flex-mix-v78'), sw.slice(0, 30));
}

const failed = results.filter(r => !r.ok);
console.log('\n| Check | Result | Detail |');
console.log('| --- | --- | --- |');
for (const r of results) {
  const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '/').replace(/\n/g, ' ');
  console.log(`| ${cell(r.name)} | ${r.ok ? 'PASS' : 'FAIL'} | ${cell(r.detail)} |`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
