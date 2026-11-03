'use strict';

// Read-only "pull today's route" mapper.
// FieldRoutes reads are POST /search and POST /get — this module never
// calls create, update, or delete.
//
// Round services inside LAWN_SERVICE_IDS, in id order, are
// 110, 112, 113, 114, 115, 116, 117. 111 is a plan type (grouped with
// 21 / 161 / 162 / 146), not a round. Spec: 110=R1 … 117=R7, 163=RS.
// Any other service id leaves round unresolved so the row is reviewed.

const {
  OFFICE_ID,
  CUSTOMER_BATCH,
  toId,
  chunks,
  parseSearch,
  parseGetRecords,
  recordId,
  createPoster,
  searchAll,
  fetchAllDiagrams,
  sqftByCustomer,
} = require('./lawn-totals');

const ROUND_BY_SERVICE_ID = Object.freeze({
  110: 'R1',
  112: 'R2',
  113: 'R3',
  114: 'R4',
  115: 'R5',
  116: 'R6',
  117: 'R7',
  163: 'RS',
});

const NOTE_CHUNK = 50;
const DIAGRAM_CACHE_MS = 10 * 60 * 1000;

let diagramSqftCache = { map: null, expiresAt: 0 };

function resetLawnRouteCache() {
  diagramSqftCache = { map: null, expiresAt: 0 };
}

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function textPieces(value) {
  if (value == null) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(...textPieces(item));
    return out;
  }
  if (typeof value === 'object') {
    return textPieces(value.notes ?? value.note ?? value.noteText ?? value.text);
  }
  return [];
}

function isCompletionOrThanks(text) {
  const t = asText(text);
  if (/\bthank(?:s|\s+you)\b/i.test(t)) return true;
  if (/\btreated\b/i.test(t)) return true;
  if (/\b(?:service|job|route|stop)\s+(?:was\s+)?completed\b/i.test(t)) return true;
  if (/\bcompleted\s+(?:the\s+)?(?:service|job|route|stop)\b/i.test(t)) return true;
  return false;
}

function matchRockYard(text) {
  const t = asText(text);
  if (/\bnot\b[\s\S]{0,24}\brock\s*yard\b/i.test(t)) return false;
  if (/\ball rock yard\b/i.test(t)) return true;
  if (/\bfull rock yard\b/i.test(t)) return true;
  if (/\brock yard only\b/i.test(t)) return true;
  if (/\ball rock\b/i.test(t) && !/\ball rock\s+beds?\b/i.test(t)) return true;
  if (/\brock\s*yard\b/i.test(t) && !/\bbeds?\b/i.test(t)) return true;
  return false;
}

function matchRockBeds(text) {
  const t = asText(text).toLowerCase();
  const at = t.search(/\brock\s*beds?\b/);
  if (at < 0) return false;
  if (!/\bincluded\b/.test(t) || !/\blawn/.test(t)) return false;
  const window = t.slice(Math.max(0, at - 80), at + 80);
  return /\bincluded\b/.test(window) && /\blawn/.test(window);
}

function matchHoseDrag(text) {
  return /\bhose\s+drag\s+required\b/i.test(asText(text));
}

function isMixedTurf(text) {
  const t = asText(text).toLowerCase();
  if (/fescue/.test(t) && /bermuda/.test(t)) return true;
  if (/front[\s-]*only/.test(t)) return true;
  if (/front\s+yard\s+only/.test(t)) return true;
  return false;
}

function isCoolPhrase(text) {
  const t = asText(text);
  if (/\btall\s+fescue\b/i.test(t)) return true;
  if (/\bcool\s+season\s+turf\b/i.test(t)) return true;
  if (/\bcool\s+turf\s+season\b/i.test(t)) return true;
  return false;
}

function isExactTallFescue(text) {
  return asText(text).replace(/\s+/g, ' ').trim().toLowerCase() === 'tall fescue';
}

function mentionsRock(text) {
  return /\brock\b/i.test(asText(text));
}

function showTechOn(note) {
  if (!note || typeof note !== 'object') return false;
  const value = note.showTech ?? note.showOnTech ?? note.techVisible ?? note.visibleToTech;
  return value === 1 || value === '1' || value === true || value === 'true';
}

function classifyFlagTexts(texts) {
  const reasons = [];
  let isRockYard = false;
  let hasRockBeds = false;
  let isHoseDrag = false;
  let cool = false;
  let mixed = false;
  let sawRock = false;

  for (const text of texts || []) {
    if (!text || isCompletionOrThanks(text)) continue;
    if (matchRockYard(text)) isRockYard = true;
    if (matchRockBeds(text)) hasRockBeds = true;
    if (matchHoseDrag(text)) isHoseDrag = true;
    if (isMixedTurf(text)) mixed = true;
    if (isCoolPhrase(text) || isExactTallFescue(text)) cool = true;
    if (mentionsRock(text)) sawRock = true;
  }

  if (mixed) cool = false;
  if (sawRock && !isRockYard && !hasRockBeds) reasons.push('Ambiguous rock wording');
  if (isRockYard && hasRockBeds) reasons.push('Rock yard and rock beds both matched');
  if (mixed) reasons.push('Mixed turf — not marked cool');

  let turf = 'warm';
  if (mixed) turf = 'mixed';
  else if (cool) turf = 'cool';

  return { isRockYard, hasRockBeds, isHoseDrag, turf, needsReview: reasons };
}

function roundFromServiceId(serviceId) {
  const id = toId(serviceId);
  if (id == null) return null;
  return ROUND_BY_SERVICE_ID[id] || null;
}

function customerDisplayName(customer, customerID) {
  const last = asText(customer && (customer.lname || customer.lastName)).trim();
  const first = asText(customer && (customer.fname || customer.firstName)).trim();
  if (last && first) return last + ', ' + first;
  const company = asText(customer && customer.companyName).trim();
  if (company) return company;
  if (last || first) return last || first;
  return customerID == null ? 'Unknown' : 'Customer ' + customerID;
}

function sameDay(value, isoDate) {
  const raw = asText(value).trim();
  if (!raw || !isoDate) return false;
  if (raw.slice(0, 10) === isoDate) return true;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
  if (!us) return false;
  const mm = us[1].padStart(2, '0');
  const dd = us[2].padStart(2, '0');
  return us[3] + '-' + mm + '-' + dd === isoDate;
}

function isPendingStatus(status) {
  if (status == null || status === '') return true;
  const s = asText(status).trim().toLowerCase();
  return s === '0' || s === 'pending';
}

function routeEmployeeId(route) {
  if (!route || typeof route !== 'object') return null;
  return toId(route.assignedTech ?? route.assignedTechID ?? route.employeeID ?? route.techID);
}

function appointmentServiceId(appt) {
  if (!appt || typeof appt !== 'object') return null;
  return toId(appt.serviceID ?? appt.type ?? appt.serviceTypeID ?? appt.serviceType);
}

function noteBody(note) {
  return textPieces(note && (note.notes ?? note.note ?? note.noteText)).join('\n');
}

function indexByCustomer(rows, pickId) {
  const map = new Map();
  for (const row of rows || []) {
    const id = pickId(row);
    if (id == null) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}

function decideRouteType(properties) {
  let hasCool = false;
  let hasWarm = false;
  let hasMixed = false;
  for (const property of properties || []) {
    const turf = property && property.turf;
    const rockOnly = property && property.isRockYard && turf !== 'cool' && turf !== 'mixed';
    if (rockOnly) continue;
    if (turf === 'cool') hasCool = true;
    else if (turf === 'mixed') hasMixed = true;
    else if (turf === 'warm') hasWarm = true;
  }
  if (hasCool && (hasWarm || hasMixed)) {
    return {
      routeType: null,
      mixedRoute: true,
      needsReview: ['Mixed cool and warm on this route — split before calculating'],
    };
  }
  if (hasCool) return { routeType: 'cool', mixedRoute: false, needsReview: [] };
  return { routeType: 'warm', mixedRoute: false, needsReview: [] };
}

function compareStops(a, b) {
  const ar = toId(a.routeID) || 0;
  const br = toId(b.routeID) || 0;
  if (ar !== br) return ar - br;
  const as = toId(a.spotID ?? a.sequence ?? a.routeOrder);
  const bs = toId(b.spotID ?? b.sequence ?? b.routeOrder);
  const aSpot = as == null ? 999999 : as;
  const bSpot = bs == null ? 999999 : bs;
  if (aSpot !== bSpot) return aSpot - bSpot;
  return (toId(a.appointmentID) || 0) - (toId(b.appointmentID) || 0);
}

function buildLawnRoute({ date, employeeID, routes, appointments, customers, notes, subscriptions, diagrams, sqftByCustomerMap }) {
  const techId = toId(employeeID);
  const routeRows = [];
  const routeIds = [];
  const seenRoutes = new Set();
  for (const route of routes || []) {
    const id = recordId('route', route);
    if (id == null || seenRoutes.has(id)) continue;
    const assigned = routeEmployeeId(route);
    if (assigned != null && techId != null && assigned !== techId) continue;
    const routeDate = route && (route.date ?? route.routeDate);
    if (routeDate && !sameDay(routeDate, date)) continue;
    seenRoutes.add(id);
    routeIds.push(id);
    routeRows.push(route);
  }
  const routeIdSet = new Set(routeIds);

  const stops = [];
  const seenStops = new Set();
  for (const appt of appointments || []) {
    const appointmentID = recordId('appointment', appt);
    if (appointmentID != null && seenStops.has(appointmentID)) continue;
    if (!isPendingStatus(appt && appt.status)) continue;
    const apptDate = appt && (appt.date ?? appt.start ?? appt.appointmentDate);
    if (apptDate && !sameDay(apptDate, date)) continue;
    const routeID = toId(appt && appt.routeID);
    if (routeID != null && !routeIdSet.has(routeID)) continue;
    if (routeID == null && routeIdSet.size === 0) continue;
    if (appointmentID != null) seenStops.add(appointmentID);
    stops.push(appt);
  }
  stops.sort(compareStops);

  const customerById = new Map();
  for (const customer of customers || []) {
    const id = toId(customer && customer.customerID);
    if (id == null || customerById.has(id)) continue;
    customerById.set(id, customer);
  }
  const sqft = sqftByCustomerMap instanceof Map ? sqftByCustomerMap : sqftByCustomer(diagrams);

  const redByCustomer = new Map();
  for (const note of notes || []) {
    if (!showTechOn(note)) continue;
    const id = toId(note.customerID);
    const body = noteBody(note);
    if (id == null || !body) continue;
    if (!redByCustomer.has(id)) redByCustomer.set(id, []);
    redByCustomer.get(id).push(body);
  }

  const subsByCustomer = indexByCustomer(subscriptions, row => toId(row && row.customerID));

  const properties = [];
  for (const appt of stops) {
    const customerID = toId(appt && appt.customerID);
    const customer = customerID == null ? null : customerById.get(customerID) || null;
    const redNotes = customerID == null ? [] : (redByCustomer.get(customerID) || []);
    const texts = [];
    for (const note of redNotes) texts.push(note);
    const scheduling = customer ? customer.specialScheduling : '';
    if (asText(scheduling).trim()) texts.push(asText(scheduling));
    if (!redNotes.length) {
      texts.push(...textPieces(appt && (appt.notes ?? appt.appointmentNotes ?? appt.officeNotes)));
      const subs = customerID == null ? [] : (subsByCustomer.get(customerID) || []);
      for (const sub of subs) {
        texts.push(...textPieces(sub.notes ?? sub.subscriptionNotes ?? sub.officeNotes));
      }
    }

    const flags = classifyFlagTexts(texts);
    const reasons = flags.needsReview.slice();
    const measurement = customerID != null && sqft.has(customerID) ? sqft.get(customerID) : null;
    if (measurement == null) reasons.push('Missing square footage');
    const round = roundFromServiceId(appointmentServiceId(appt));
    if (!round) reasons.push('Round not resolved from service type');

    properties.push({
      name: customerDisplayName(customer, customerID),
      sqft: measurement == null ? 0 : measurement,
      round,
      isRockYard: flags.isRockYard,
      hasRockBeds: flags.hasRockBeds,
      isHoseDrag: flags.isHoseDrag,
      customerID,
      appointmentID: recordId('appointment', appt),
      turf: flags.turf,
      confidence: reasons.length ? 'low' : 'high',
      needsReview: reasons,
    });
  }

  const decision = decideRouteType(properties);
  return {
    date: date || null,
    employeeID: techId,
    routeIDs: routeIds,
    routeType: decision.routeType,
    mixedRoute: decision.mixedRoute,
    needsReview: decision.needsReview,
    properties,
  };
}

function notesForAllowed(rows, allowedIds) {
  const allowed = new Set(allowedIds.map(id => String(id)));
  const out = [];
  for (const row of rows || []) {
    const customerID = toId(row && row.customerID);
    if (customerID == null || !allowed.has(String(customerID))) continue;
    out.push(row);
  }
  return out;
}

// note/search is supposed to honor customerIDs. If a page contains some
// other customer, the filter was ignored — do not follow that id dump.
// Re-query one customer at a time and keep only their rows.
async function fetchNotesForCustomers(post, customerIds) {
  const body = await post('note/search', {
    officeIDs: OFFICE_ID,
    customerIDs: customerIds,
    includeData: 1,
  });
  const parsed = parseSearch(body, 'note');
  const page = parsed.records.slice();
  const allowed = new Set(customerIds.map(id => String(id)));
  const foreign = page.some(row => {
    const id = toId(row && row.customerID);
    return id != null && !allowed.has(String(id));
  });
  if (foreign) return { foreign: true, rows: page };

  const known = new Set();
  for (const row of page) {
    const id = recordId('note', row);
    if (id != null) known.add(String(id));
  }
  const pool = page.length ? parsed.noData : (parsed.noData.length ? parsed.noData : parsed.ids);
  const rest = [];
  for (const id of pool) {
    if (!known.has(String(id))) rest.push(id);
  }
  for (const idChunk of chunks(rest, CUSTOMER_BATCH)) {
    const got = await post('note/get', { noteIDs: idChunk });
    page.push(...parseGetRecords(got, 'note'));
  }
  return { foreign: false, rows: page };
}

async function searchNotes(post, customerIds) {
  const records = [];
  for (const chunk of chunks(customerIds, NOTE_CHUNK)) {
    const first = await fetchNotesForCustomers(post, chunk);
    if (!first.foreign) {
      records.push(...notesForAllowed(first.rows, chunk));
      continue;
    }
    for (const id of chunk) {
      const one = await fetchNotesForCustomers(post, [id]);
      records.push(...notesForAllowed(one.rows, [id]));
    }
  }
  return records;
}

async function cachedSqftByCustomer(post) {
  const now = Date.now();
  if (diagramSqftCache.map && diagramSqftCache.expiresAt > now) return diagramSqftCache.map;
  const diagrams = await fetchAllDiagrams(post);
  const map = sqftByCustomer(diagrams);
  diagramSqftCache = { map, expiresAt: now + DIAGRAM_CACHE_MS };
  return map;
}

async function loadSubscriptions(post, subscriptionIds) {
  const records = [];
  const unique = [];
  const seen = new Set();
  for (const id of subscriptionIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  for (const chunk of chunks(unique, CUSTOMER_BATCH)) {
    const got = await post('subscription/get', { subscriptionIDs: chunk });
    records.push(...parseGetRecords(got, 'subscription'));
  }
  return records;
}

async function loadLawnRoute(config, options) {
  const date = options && options.date;
  const employeeID = toId(options && options.employeeID);
  if (!date || employeeID == null) throw new Error('date and employeeID are required');
  const post = createPoster(config);

  const routes = await searchAll(post, 'route', {
    officeIDs: OFFICE_ID,
    date: { operator: '=', value: date },
    assignedTech: employeeID,
  });

  const routeIDs = [];
  const seenRoutes = new Set();
  for (const route of routes) {
    const id = recordId('route', route);
    if (id == null || seenRoutes.has(id)) continue;
    const assigned = routeEmployeeId(route);
    if (assigned != null && assigned !== employeeID) continue;
    seenRoutes.add(id);
    routeIDs.push(id);
  }

  let appointments = [];
  if (routeIDs.length) {
    appointments = await searchAll(post, 'appointment', {
      officeIDs: OFFICE_ID,
      routeIDs,
      date: { operator: '=', value: date },
      status: 0,
    });
  }

  const customerIds = [];
  const seenCustomers = new Set();
  const fallbackSubIds = [];
  for (const appt of appointments) {
    if (!isPendingStatus(appt && appt.status)) continue;
    const id = toId(appt && appt.customerID);
    if (id == null || seenCustomers.has(id)) continue;
    seenCustomers.add(id);
    customerIds.push(id);
  }

  const customers = [];
  for (const chunk of chunks(customerIds, CUSTOMER_BATCH)) {
    const got = await post('customer/get', { customerIDs: chunk });
    customers.push(...parseGetRecords(got, 'customer'));
  }

  const notes = await searchNotes(post, customerIds);
  const redCustomers = new Set();
  for (const note of notes) {
    if (!showTechOn(note)) continue;
    const id = toId(note.customerID);
    if (id != null) redCustomers.add(id);
  }
  for (const appt of appointments) {
    if (!isPendingStatus(appt && appt.status)) continue;
    const customerID = toId(appt && appt.customerID);
    if (customerID == null || redCustomers.has(customerID)) continue;
    const subscriptionID = toId(appt && appt.subscriptionID);
    if (subscriptionID != null) fallbackSubIds.push(subscriptionID);
  }
  const subscriptions = fallbackSubIds.length ? await loadSubscriptions(post, fallbackSubIds) : [];
  const sqftByCustomerMap = customerIds.length ? await cachedSqftByCustomer(post) : new Map();

  return buildLawnRoute({
    date,
    employeeID,
    routes,
    appointments,
    customers,
    notes,
    subscriptions,
    diagrams: [],
    sqftByCustomerMap,
  });
}

module.exports = {
  ROUND_BY_SERVICE_ID,
  OFFICE_ID,
  matchRockYard,
  matchRockBeds,
  matchHoseDrag,
  isMixedTurf,
  isCoolPhrase,
  isExactTallFescue,
  isCompletionOrThanks,
  classifyFlagTexts,
  roundFromServiceId,
  decideRouteType,
  buildLawnRoute,
  loadLawnRoute,
  resetLawnRouteCache,
  DIAGRAM_CACHE_MS,
  customerDisplayName,
  showTechOn,
};
