'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('@cantoo/pdf-lib');
const { Database } = require('../main/db/database');
const { seedDemo } = require('./fixtures/demo-seed');

/** Minimal PDF renderer for tests (no browser needed). */
async function fakeRenderPdf(html) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawText(String(html.length), { x: 50, y: 800, size: 12 });
  return Buffer.from(await doc.save());
}

async function demoContext() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vms-test-'));
  const paths = { data: dir, evidence: path.join(dir, 'evidence'), documents: path.join(dir, 'documents') };
  Object.values(paths).forEach((p) => fs.mkdirSync(p, { recursive: true }));
  const db = await Database.open(null);
  const ctx = { db, paths, renderPdf: fakeRenderPdf, dbFile: null };
  await seedDemo(ctx);
  const user = (username) => require('../main/services/auth').publicUser(db.get('SELECT * FROM app_user WHERE username = ?', [username]));
  return { ctx, db, user, dir };
}

module.exports = { demoContext, fakeRenderPdf };
