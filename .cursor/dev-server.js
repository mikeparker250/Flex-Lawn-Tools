#!/usr/bin/env node
'use strict';

// Zero-dependency local dev server for Flex-Lawn-Tools.
//
// Production serves the repo root as a static site (index.html, sw.js, icons,
// manifest, version.json) and exposes api/parse.js as a Vercel-style Node
// serverless function at POST /api/parse. This server reproduces both so the
// PWA and its screenshot-parse endpoint can be exercised end to end locally.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// The client hardcodes this shared secret (see index.html). Default to it so
// /api/parse authorizes locally without configuring a secret; a real secret in
// the environment still takes precedence.
if (!process.env.PARSE_SHARED_SECRET) {
  process.env.PARSE_SHARED_SECRET =
    'c1ee34f79637d613b78a061299970ca1e109cfbdb7388c95';
}

const parseHandler = require(path.join(ROOT, 'api', 'parse.js'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      // Route screenshots are sent as base64; allow a generous cap.
      if (size > 25 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Wrap the Node response with the Vercel-style helpers api/parse.js expects.
function decorateRes(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    const payload = JSON.stringify(obj);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(payload);
    return res;
  };
  return res;
}

async function handleApiParse(req, res) {
  decorateRes(res);
  try {
    const raw = await readBody(req);
    try {
      req.body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    } catch (e) {
      res.status(400).json({ error: { message: 'Invalid JSON body' } });
      return;
    }
    await parseHandler(req, res);
  } catch (err) {
    if (!res.writableEnded) {
      res.status(500).json({ error: { message: err.message } });
    }
  }
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const resolved = path.normalize(path.join(ROOT, urlPath));
  if (!resolved.startsWith(ROOT)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA-style fallback: unknown routes load the app shell.
      const fallback = path.join(ROOT, 'index.html');
      fs.readFile(fallback, (e2, data) => {
        if (e2) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME['.html']);
        res.end(data);
      });
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(resolved).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/api/parse') {
    if (req.method !== 'POST') {
      decorateRes(res)
        .status(405)
        .json({ error: { message: 'Method not allowed' } });
      return;
    }
    handleApiParse(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  console.log(`Flex-Lawn-Tools dev server running at http://${HOST}:${PORT}`);
  console.log(`  Static root: ${ROOT}`);
  console.log(
    `  /api/parse: ${
      hasKey
        ? 'ANTHROPIC_API_KEY set — screenshot parsing enabled'
        : 'ANTHROPIC_API_KEY not set — screenshot parsing will return an upstream error (core app unaffected)'
    }`
  );
});
