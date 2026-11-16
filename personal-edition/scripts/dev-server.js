#!/usr/bin/env node
'use strict';
/**
 * Development / test bridge: serves the renderer in a normal browser and
 * forwards API calls over HTTP to the same backend Electron uses. PDFs are
 * rendered with Playwright's Chromium. Listens on 127.0.0.1 only.
 *
 *   node scripts/dev-server.js [--data ./dev-data] [--port 5180]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createContext } = require('../main/context');
const { createApi } = require('../main/api');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const PORT = Number(opt('port', 5180));
const DATA = path.resolve(opt('data', path.join(__dirname, '..', 'dev-data')));
const ROOT = path.join(__dirname, '..', 'renderer');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

let browser = null;
async function renderPdf(html) {
  if (!browser || !browser.isConnected()) browser = await require('playwright').chromium.launch();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: '<div style="font-family:Arial,sans-serif;font-size:7px;width:100%;padding:0 14mm;display:flex;justify-content:space-between;color:#7b6370"><span>Bank of Palestine · VMS-SLA · <span class="title"></span></span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
      margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
    });
  } finally {
    await page.close();
  }
}

(async () => {
  const ctx = await createContext({ dataDir: DATA, renderPdf, log: (...a) => console.log(...a) });
  const api = createApi(ctx);
  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 40e6) req.destroy(); });
      req.on('end', async () => {
        let parsed = {};
        try { parsed = body ? JSON.parse(body) : {}; } catch (_) { /* empty */ }
        const out = await api.invoke(url.pathname.slice(5), parsed);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out));
      });
      return;
    }
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(ROOT, `.${rel}`);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(PORT, '127.0.0.1', () => console.log(`VMS-SLA dev server on http://127.0.0.1:${PORT}  (data: ${DATA})`));
  const stop = async () => { try { ctx.db.close(); if (browser) await browser.close(); } finally { process.exit(0); } };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})();
