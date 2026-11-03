'use strict';

const { loadLawnRoute } = require('./lib/lawn-route');

const NOT_CONFIGURED = 'FieldRoutes not configured';
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function nonempty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function readConfig() {
  const baseUrl = process.env.FIELDROUTES_BASE_URL;
  const authenticationKey = process.env.FIELDROUTES_AUTH_KEY;
  const authenticationToken = process.env.FIELDROUTES_AUTH_TOKEN;
  if (!nonempty(baseUrl) || !nonempty(authenticationKey) || !nonempty(authenticationToken)) {
    return null;
  }
  return {
    baseUrl: baseUrl.trim(),
    authenticationKey: authenticationKey.trim(),
    authenticationToken: authenticationToken.trim(),
  };
}

function safeError(err, secrets) {
  let message = err && err.message ? String(err.message) : 'FieldRoutes request failed';
  for (const secret of secrets) {
    if (secret && message.includes(secret)) return 'FieldRoutes request failed';
  }
  return message.slice(0, 300);
}

function readQuery(req) {
  if (req && req.query && typeof req.query === 'object') return req.query;
  const raw = req && typeof req.url === 'string' ? req.url : '';
  const q = raw.indexOf('?');
  const params = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : '');
  return {
    date: params.get('date'),
    employeeID: params.get('employeeID'),
  };
}

function validDate(value) {
  const match = DATE_RE.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return match[1] + '-' + match[2] + '-' + match[3];
}

function validEmployeeId(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!req || req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const query = readQuery(req);
  const date = validDate(query.date);
  const employeeID = validEmployeeId(query.employeeID);
  if (!date || employeeID == null) {
    res.status(400).json({ error: 'date (YYYY-MM-DD) and employeeID are required' });
    return;
  }

  const config = readConfig();
  if (!config) {
    res.status(503).json({ error: NOT_CONFIGURED });
    return;
  }

  try {
    const body = await loadLawnRoute(config, { date, employeeID });
    res.status(200).json(body);
  } catch (err) {
    res.status(502).json({
      error: safeError(err, [config.authenticationKey, config.authenticationToken]),
    });
  }
}

module.exports = handler;
module.exports.NOT_CONFIGURED = NOT_CONFIGURED;
