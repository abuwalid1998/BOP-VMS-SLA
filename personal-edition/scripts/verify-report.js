#!/usr/bin/env node
'use strict';
/**
 * Check whether a PDF is an authentic sealed VMS-SLA document.
 *   node scripts/verify-report.js INC-2026-0001_rev1_FINAL.pdf [--data folder]
 * Hashes the file, looks it up in the document register and checks that the
 * report record still matches the content that was finalised.
 */
const fs = require('fs');
const path = require('path');
const { Database } = require('../main/db/database');
const documents = require('../main/report/documents');
const { defaultDataDir, parseArgs } = require('./_common');

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const file = args._[0];
  if (!file) { console.error('Usage: node scripts/verify-report.js <file.pdf> [--data folder]'); process.exit(2); }
  const db = await Database.open(path.join(path.resolve(args.data || defaultDataDir()), 'vms-sla.sqlite'), { create: false });
  const r = documents.verifyBytes(db, fs.readFileSync(file));
  console.log(`SHA-256: ${r.sha256}`);
  if (!r.ok) { console.log(`NOT AUTHENTIC: ${r.reason}`); process.exit(1); }
  console.log(`Registered as: ${r.document.title} (sealed ${r.document.generated_at})`);
  const v = documents.verify(db, { paths: { documents: path.join(path.resolve(args.data || defaultDataDir()), 'documents') } }, r.document.document_id);
  if (!v.ok) { console.log(`FAILED: ${v.reason}`); process.exit(1); }
  console.log('AUTHENTIC.');
})().catch((e) => { console.error(e.message || e); process.exit(1); });
