#!/usr/bin/env node
'use strict';
/**
 * Check whether a PDF is an authentic sealed VMS-SLA document.
 *   node scripts/verify-report.js INC-2026-0001_rev1_FINAL.pdf [--data folder]
 * Hashes the file, looks it up in the document register and re-verifies
 * every electronic signature of the report.
 */
const fs = require('fs');
const path = require('path');
const { Database } = require('../main/db/database');
const documents = require('../main/report/documents');
const approvals = require('../main/services/approvals');
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
  if (r.document.report_id) {
    const v = approvals.verifySignatures(db, r.document.report_id);
    for (const s of v.signatures) console.log(`  ${s.valid ? 'VALID  ' : 'INVALID'} rev ${s.revision} ${s.decision.padEnd(8)} ${s.signer_name} (${s.role_code}) ${s.signed_at}${s.checks.length ? ' - ' + s.checks.join('; ') : ''}`);
    if (!v.ok) { console.log('Signature verification FAILED.'); process.exit(1); }
  }
  console.log('AUTHENTIC.');
})().catch((e) => { console.error(e.message || e); process.exit(1); });
