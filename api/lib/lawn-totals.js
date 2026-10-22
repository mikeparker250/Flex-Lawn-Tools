'use strict';

// Active lawn-care service types. FieldRoutes silently ignores `serviceIDs`,
// so callers must query the singular `serviceID` once per id.
const LAWN_SERVICE_IDS = Object.freeze([111, 21, 161, 162, 163, 146, 110, 112, 113, 114, 115, 116, 117]);

const OFFICE_ID = 1;
const FORT_SMITH_REGION_ID = 2;
const CUSTOMER_BATCH = 1000;
const DIAGRAM_INCLUDE_DATA_LIMIT = 1000;
const SEARCH_ID_CAP = 50000;

const FORT_SMITH_NAME = /fort smith/i;
const FESCUE = /fescue/i;

function toId(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return null;
  const n = Number(String(value).trim());
  if (!Number.isInteger(n)) return null;
  return n;
}

function toIdList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const id = toId(item);
    if (id != null) out.push(id);
  }
  return out;
}

function chunks(list, size) {
  const out = [];
  const step = Math.max(1, size);
  for (let i = 0; i < list.length; i += step) out.push(list.slice(i, i + step));
  return out;
}

function isExplicitFailure(success) {
  return success === false || success === 0 || success === '0' || success === 'false';
}

function unwrapObject(body) {
  if (body && body.result && typeof body.result === 'object' && !Array.isArray(body.result)) {
    return body.result;
  }
  return body && typeof body === 'object' ? body : {};
}

function objectRows(arr) {
  if (!Array.isArray(arr)) return null;
  if (arr.length && (typeof arr[0] !== 'object' || arr[0] == null)) return null;
  return arr.filter(row => row && typeof row === 'object');
}

function parseSearch(body, entity) {
  if (body && isExplicitFailure(body.success)) {
    const msg = typeof body.errorMessage === 'string' && body.errorMessage.trim()
      ? body.errorMessage.trim()
      : `FieldRoutes ${entity}/search failed`;
    throw new Error(msg);
  }
  const payload = unwrapObject(body);
  const idName = typeof payload.idName === 'string' ? payload.idName : entity + 'IDs';
  const ids = toIdList(payload[idName]);
  const noData = toIdList(payload[idName + 'NoDataExported']);
  const keys = [payload.propertyNameData, payload.propertyName, entity + 's'];
  let records = [];
  for (const key of keys) {
    if (typeof key !== 'string') continue;
    const rows = objectRows(payload[key]);
    if (rows && rows.length) {
      records = rows;
      break;
    }
  }
  return { ids, noData, records };
}

function parseGetRecords(body, entity) {
  if (body && isExplicitFailure(body.success)) {
    const msg = typeof body.errorMessage === 'string' && body.errorMessage.trim()
      ? body.errorMessage.trim()
      : `FieldRoutes ${entity}/get failed`;
    throw new Error(msg);
  }
  if (body && Array.isArray(body.result)) {
    return body.result.filter(row => row && typeof row === 'object');
  }
  const payload = unwrapObject(body);
  if (Array.isArray(payload)) return payload.filter(row => row && typeof row === 'object');
  const keys = [entity + 's', payload.propertyName, payload.propertyNameData];
  for (const key of keys) {
    if (typeof key !== 'string') continue;
    const rows = objectRows(payload[key]);
    if (rows && rows.length) return rows;
  }
  return [];
}

function recordId(entity, row) {
  if (!row || typeof row !== 'object') return null;
  if (entity === 'diagram') return toId(row.diagramID != null ? row.diagramID : row.diagram);
  if (entity === 'region') return toId(row.regionID != null ? row.regionID : row.regionIDs);
  return toId(row[entity + 'ID']);
}

function endpointUrl(baseUrl, path) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('FieldRoutes base URL is missing');
  // FIELDROUTES_BASE_URL already ends in /api. Do not append another /api.
  return base + '/' + String(path || '').replace(/^\/+/, '');
}

function createPoster(config) {
  const doFetch = config.fetchImpl || fetch;
  return async function post(path, params) {
    const url = endpointUrl(config.baseUrl, path);
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        ...params,
        authenticationKey: config.authenticationKey,
        authenticationToken: config.authenticationToken,
      }),
    });
    let json = null;
    try {
      json = await res.json();
    } catch (err) {
      json = null;
    }
    if (!res.ok) {
      throw new Error(`FieldRoutes ${path} failed (HTTP ${res.status})`);
    }
    if (json && isExplicitFailure(json.success)) {
      const msg = typeof json.errorMessage === 'string' && json.errorMessage.trim()
        ? json.errorMessage.trim()
        : `FieldRoutes ${path} failed`;
      throw new Error(msg);
    }
    return json || {};
  };
}

async function searchAll(post, entity, params) {
  const body = await post(entity + '/search', { ...params, includeData: 1 });
  const parsed = parseSearch(body, entity);
  const records = parsed.records.slice();
  const known = new Set();
  for (const row of records) {
    const id = recordId(entity, row);
    if (id != null) known.add(String(id));
  }
  const pool = records.length ? parsed.noData : (parsed.noData.length ? parsed.noData : parsed.ids);
  const rest = [];
  for (const id of pool) {
    if (!known.has(String(id))) rest.push(id);
  }
  for (const chunk of chunks(rest, CUSTOMER_BATCH)) {
    const got = await post(entity + '/get', { [entity + 'IDs']: chunk });
    records.push(...parseGetRecords(got, entity));
  }
  return records;
}

function diagramDedupeKey(row) {
  const id = toId(row.diagramID != null ? row.diagramID : row.diagram);
  if (id != null) return 'id:' + id;
  const customerID = toId(row.customerID);
  return [
    'row',
    customerID,
    row.diagramType,
    row.measurementUnit,
    row.measurement,
  ].join(':');
}

function maxDiagramId(rows) {
  let max = null;
  for (const row of rows) {
    const id = toId(row.diagramID != null ? row.diagramID : row.diagram);
    if (id == null) continue;
    if (max == null || id > max) max = id;
  }
  return max;
}

// diagram/search ignores customerIDs and returns every diagram. Page the
// search (includeData is capped at 1,000 rows) and map by customer afterward.
async function fetchAllDiagrams(post, pageSize) {
  const limit = pageSize || DIAGRAM_INCLUDE_DATA_LIMIT;
  const records = [];
  const seenSig = new Set();
  let afterId = null;
  for (let page = 0; page < 200; page++) {
    const params = { includeData: 1 };
    if (afterId != null) params.diagramIDs = { operator: '>', value: afterId };
    const body = await post('diagram/search', params);
    const parsed = parseSearch(body, 'diagram');
    const pageRecords = parsed.records.slice();
    if (parsed.noData.length) {
      for (const chunk of chunks(parsed.noData, CUSTOMER_BATCH)) {
        const got = await post('diagram/get', { diagramIDs: chunk });
        pageRecords.push(...parseGetRecords(got, 'diagram'));
      }
    }
    if (!pageRecords.length) break;
    const sig = pageRecords.map(diagramDedupeKey).join('|');
    if (seenSig.has(sig)) break;
    seenSig.add(sig);
    records.push(...pageRecords);

    const hitIdCap = parsed.ids.length >= SEARCH_ID_CAP;
    if (parsed.noData.length && !hitIdCap) break;
    if (parsed.records.length < limit && !hitIdCap) break;
    const maxId = maxDiagramId(pageRecords);
    if (maxId == null || (afterId != null && maxId <= afterId)) break;
    afterId = maxId;
  }
  return records;
}

function isCoolSeason(specialScheduling) {
  return FESCUE.test(String(specialScheduling == null ? '' : specialScheduling));
}

function regionLabel(region) {
  if (!region || typeof region !== 'object') return '';
  return [region.description, region.name, region.regionName].filter(Boolean).join(' ');
}

function fortSmithRegionIds(regions) {
  const ids = new Set([FORT_SMITH_REGION_ID]);
  for (const region of regions || []) {
    const id = recordId('region', region);
    if (id == null) continue;
    if (FORT_SMITH_NAME.test(regionLabel(region))) ids.add(id);
  }
  return ids;
}

function parseMeasurement(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function isPropertyEstimationSf(row) {
  if (!row || typeof row !== 'object') return false;
  if (String(row.diagramType == null ? '' : row.diagramType).trim() !== 'PROPERTY ESTIMATION') return false;
  return String(row.measurementUnit == null ? '' : row.measurementUnit).trim() === 'SF';
}

// Collapse repeated diagram rows, then keep the largest SF per customer.
// Customer 26591 has both 4,242 and 2,275; the larger row wins.
function sqftByCustomer(diagrams) {
  const byKey = new Map();
  for (const row of diagrams || []) {
    if (!isPropertyEstimationSf(row)) continue;
    const customerID = toId(row.customerID);
    const measurement = parseMeasurement(row.measurement);
    if (customerID == null || measurement == null) continue;
    const key = diagramDedupeKey(row);
    const prev = byKey.get(key);
    if (!prev || measurement > prev.measurement) {
      byKey.set(key, { customerID, measurement });
    }
  }
  const best = new Map();
  for (const row of byKey.values()) {
    const prev = best.get(row.customerID);
    if (prev == null || row.measurement > prev) best.set(row.customerID, row.measurement);
  }
  return best;
}

function indexCustomers(customers) {
  const byId = new Map();
  for (const customer of customers || []) {
    const id = toId(customer && customer.customerID);
    if (id == null) continue;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, customer);
      continue;
    }
    if (!isCoolSeason(prev.specialScheduling) && isCoolSeason(customer.specialScheduling)) {
      byId.set(id, { ...prev, specialScheduling: customer.specialScheduling });
    }
  }
  return byId;
}

function aggregateLawnTotals({ customers, regions, diagrams, asOf }) {
  const fortSmith = fortSmithRegionIds(regions);
  const sqft = sqftByCustomer(diagrams);
  const warmIds = [];
  const coolIds = [];
  let excludedFortSmith = 0;

  for (const [id, customer] of indexCustomers(customers)) {
    if (toId(customer.officeID) !== OFFICE_ID) continue;
    const regionID = toId(customer.regionID);
    if (regionID != null && fortSmith.has(regionID)) {
      excludedFortSmith += 1;
      continue;
    }
    if (isCoolSeason(customer.specialScheduling)) coolIds.push(id);
    else warmIds.push(id);
  }

  function sumSqft(ids) {
    let total = 0;
    for (const id of ids) {
      if (sqft.has(id)) total += sqft.get(id);
    }
    return total;
  }

  function missing(ids) {
    return ids.filter(id => !sqft.has(id)).sort((a, b) => a - b);
  }

  return {
    warmSqft: sumSqft(warmIds),
    warmProps: warmIds.length,
    coolSqft: sumSqft(coolIds),
    coolProps: coolIds.length,
    missingSfIds: {
      warm: missing(warmIds),
      cool: missing(coolIds),
    },
    excludedFortSmith,
    asOf: asOf || new Date().toISOString(),
  };
}

function uniqueCustomerIds(subscriptions) {
  const ids = [];
  const seen = new Set();
  for (const sub of subscriptions) {
    const id = toId(sub && sub.customerID);
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

async function loadLawnTotals(config, options) {
  const post = createPoster(config);
  const pageSize = options && options.diagramPageSize;
  const subscriptions = [];
  for (const serviceID of LAWN_SERVICE_IDS) {
    const rows = await searchAll(post, 'subscription', {
      active: 1,
      officeIDs: OFFICE_ID,
      serviceID,
    });
    subscriptions.push(...rows);
  }
  const customerIds = uniqueCustomerIds(subscriptions);
  const customers = [];
  for (const chunk of chunks(customerIds, CUSTOMER_BATCH)) {
    if (chunk.length > CUSTOMER_BATCH) {
      throw new Error('customer batch exceeded 1000');
    }
    const got = await post('customer/get', { customerIDs: chunk });
    customers.push(...parseGetRecords(got, 'customer'));
  }
  const regions = await searchAll(post, 'region', { officeIDs: OFFICE_ID });
  const diagrams = await fetchAllDiagrams(post, pageSize);
  return aggregateLawnTotals({
    customers,
    regions,
    diagrams,
    asOf: new Date().toISOString(),
  });
}

module.exports = {
  LAWN_SERVICE_IDS,
  OFFICE_ID,
  FORT_SMITH_REGION_ID,
  CUSTOMER_BATCH,
  DIAGRAM_INCLUDE_DATA_LIMIT,
  isCoolSeason,
  fortSmithRegionIds,
  parseMeasurement,
  sqftByCustomer,
  aggregateLawnTotals,
  parseSearch,
  parseGetRecords,
  loadLawnTotals,
  endpointUrl,
  chunks,
};
