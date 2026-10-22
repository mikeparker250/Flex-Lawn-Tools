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
  check('R7 Specticle need is unchanged', near(warm('Specticle FLO').needed, gal * 0.10), warm('Specticle FLO').needed);
  check('R7 Simazine need is unchanged', near(warm('Simazine').needed, gal * 1.44), warm('Simazine').needed);
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

// --- jugs and bottles have no size in the product data ---
{
  const jug = one('Triad Select', 10, 'oz', stock(2, 'Jugs'));
  check('non-zero jugs are not subtracted', jug.stockStatus === 'unknown_container' && jug.toOrder == null && jug.onHandBase == null, jug.stockStatus);
  check('jug flag names the missing size', /Jug size is not in the product data/.test(jug.stockFlag), jug.stockFlag);
  check('2 jugs is not 10 - 2', jug.toOrder !== 8, jug.toOrder);

  const bottle = one('Specticle FLO', 10, 'oz', stock(2, 'Bottles'));
  check('non-zero bottles are not subtracted', bottle.stockStatus === 'unknown_container' && bottle.toOrder == null, bottle.toOrder);
  check('bottle flag names the missing size', /Bottle size is not in the product data/.test(bottle.stockFlag), bottle.stockFlag);

  const zeroJug = one('Triad Select', 10, 'oz', stock(0, 'Jugs'));
  check('0 jugs is 0 on hand', zeroJug.stockStatus === 'ok' && zeroJug.onHandBase === 0 && near(zeroJug.toOrder, 10), zeroJug.toOrder);
  check('0 jugs is not rounded up to a guessed jug', zeroJug.orderContainers == null && /not rounded up to jugs/.test(zeroJug.containerFlag), zeroJug.containerFlag);

  const zeroBottle = one('90/10 NIS', 0.25, 'oz', stock(0, 'Bottles'));
  check('0 bottles still orders the base amount', zeroBottle.stockStatus === 'ok' && near(zeroBottle.toOrder, 0.25) && zeroBottle.orderContainers == null, zeroBottle.toOrder);
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

// --- unmatched name and a failed load are never a silent full order ---
{
  app.setOrderInventory({ 'Three-way': stock(3, 'Jugs') });
  const miss = app.withOrderInventory([{ name: 'Three-Way', needed: 10, unit: 'oz' }])[0];
  check('exact name miss is unmatched', miss.stockStatus === 'unmatched' && miss.toOrder == null, miss.stockStatus);
  check('unmatched flag is explicit', miss.stockFlag === 'No warehouse match — stock not subtracted', miss.stockFlag);

  app.setOrderInventory({}, { error: 'Inventory did not load' });
  const down = app.withOrderInventory([{ name: 'Triad Select', needed: 10, unit: 'oz' }])[0];
  check('failed load does not order the full need', down.stockStatus === 'inventory_unavailable' && down.toOrder == null, down.toOrder);
  const banner = app.renderRoundInventoryBanner('warm', 7, 'R7');
  check('failed load is not an all-in-stock banner', /did not load/.test(banner) && !/ALL PRODUCTS IN STOCK/.test(banner), banner.slice(0, 180));
  const notice = app.orderInventoryNotices(app.calcOrderPlan(7, 1000, 0));
  check('order planner shows the load failure', /id="op-inv-flag"/.test(notice) && /did not load/.test(notice), notice.slice(0, 180));

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
  check('jug row flags instead of an order number', /data-stock-status="unknown_container"/.test(htmlRows) && /data-to-order=""/.test(htmlRows), htmlRows);
  check('jug row shows Have in jugs', /2 Jugs/.test(htmlRows) && /updated /.test(htmlRows), htmlRows);
  check('jug row does not show the old 8 oz order', !/data-to-order="8"/.test(htmlRows) && /Jug size is not in the product data/.test(htmlRows), htmlRows);

  app.setOrderInventory({ 'LESCO 24-0-11 w/ 2% Fe + PolyPlus': stock(0, 'Bags') });
  const bagHtml = app.renderOrderRows(app.withOrderInventory([{ name: 'LESCO 24-0-11 w/ 2% Fe + PolyPlus', needed: 80, unit: 'lbs' }]));
  check('bag order shows base pounds and whole bags', /80 lb · 2 bags @ 50 lb/.test(bagHtml) && /0 Bags = 0 lb/.test(bagHtml), bagHtml);

  app.setOrderInventory({});
  const plan = app.calcOrderPlan(2, 1000, 0);
  const share = app.buildPlanShareText(2, 1000, 0, 1, 0, plan);
  check('share text flags an unmatched product', /No warehouse match — stock not subtracted/.test(share), share.split('\n').slice(0, 12).join(' | '));
  check('share text does not put a bare amount after the arrow', !/→\s+\d/.test(share), 'arrow stayed flagged');
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
