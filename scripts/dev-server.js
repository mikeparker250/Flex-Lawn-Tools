#!/usr/bin/env node
// Local development server for Flex Lawn Tools.
//
// Production runs on Vercel: static files are served from the repo root and
// files in `api/` become serverless functions. This zero-dependency server
// reproduces that behavior locally so the whole app (static PWA + the
// `/api/parse` Anthropic proxy) can be exercised without the Vercel CLI or a
// linked Vercel project.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API_DIR = path.join(ROOT, 'api');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const filePath = path.join(ROOT, path.normalize(urlPath));
  // Prevent path traversal outside the repo root.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Never cache during development so edits show up immediately.
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

async function serveApi(req, res) {
  // Buffer and JSON-parse the body so handlers receive `req.body`, matching
  // Vercel's Node.js request shape.
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    req.body = raw ? JSON.parse(raw) : {};
  } catch {
    req.body = raw;
  }

  // Minimal Express-like response helpers used by the handlers.
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };

  const route = req.url.split('?')[0].replace(/^\/api\//, '').replace(/\/+$/, '');
  const handlerPath = path.join(API_DIR, route + '.js');

  if (!handlerPath.startsWith(API_DIR + path.sep) || !fs.existsSync(handlerPath)) {
    res.status(404).json({ error: { message: `No API route for /api/${route}` } });
    return;
  }

  try {
    const handler = require(handlerPath);
    await handler(req, res);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    serveApi(req, res).catch((err) => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    });
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Flex Lawn Tools dev server running at http://${HOST}:${PORT}`);
  console.log(`  Static PWA:  http://localhost:${PORT}/`);
  console.log(`  API proxy:   POST http://localhost:${PORT}/api/parse`);
  if (!process.env.PARSE_SHARED_SECRET) {
    console.log('  NOTE: PARSE_SHARED_SECRET is unset — /api/parse will return 401.');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('  NOTE: ANTHROPIC_API_KEY is unset — AI screenshot parsing is disabled.');
  }
});
