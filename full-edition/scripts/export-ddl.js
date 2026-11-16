#!/usr/bin/env node
'use strict';
/**
 * Export the empty VMS-SLA schema for a target database.
 *   node scripts/export-ddl.js --dialect postgres            (prints to stdout)
 *   node scripts/export-ddl.js --dialect oracle --out schema.sql
 *   node scripts/export-ddl.js --all --out db/generated      (sqlite, postgres, oracle)
 */
const fs = require('fs');
const path = require('path');
const { generate, DIALECTS } = require('../main/db/ddl');
const { parseArgs } = require('./_common');

const args = parseArgs(process.argv.slice(2));
if (args.all) {
  const dir = path.resolve(args.out || 'db/generated');
  fs.mkdirSync(dir, { recursive: true });
  for (const d of DIALECTS) {
    fs.writeFileSync(path.join(dir, `vms-sla_${d}.sql`), generate(d));
    console.log(`wrote ${path.join(dir, `vms-sla_${d}.sql`)}`);
  }
} else {
  const dialect = args.dialect || 'postgres';
  const sql = generate(dialect);
  if (args.out) { fs.writeFileSync(path.resolve(args.out), sql); console.log(`wrote ${args.out}`); } else process.stdout.write(sql);
}
