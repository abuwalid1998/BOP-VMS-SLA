#!/usr/bin/env node
'use strict';
/**
 * Recreate the VMS-SLA database on PostgreSQL or Oracle.
 *
 * 1) Generate a script to run with psql / SQL*Plus / SQLcl:
 *    node scripts/migrate-db.js --target postgres --out vms-sla_pg.sql
 *    node scripts/migrate-db.js --target oracle   --out vms-sla_ora.sql
 *      psql -d vms_sla -f vms-sla_pg.sql
 *      sql vms_owner@//dbhost:1521/VMSPDB @vms-sla_ora.sql
 *
 * 2) Load directly and verify row counts (needs the optional driver):
 *    npm install pg        then  PGPASSWORD=... node scripts/migrate-db.js --target postgres --connect "postgres://vms@dbhost:5432/vms_sla"
 *    npm install oracledb  then  ORACLE_PASSWORD=... node scripts/migrate-db.js --target oracle --user vms_owner --connect-string dbhost:1521/VMSPDB
 *
 * Source: --source <file.sqlite> or --data <folder>; defaults to the desktop app's data folder.
 * Copy the "evidence" and "documents" folders to the new server as well; the
 * database stores their SHA-256 hashes, not the files.
 */
const fs = require('fs');
const path = require('path');
const { Database } = require('../main/db/database');
const { buildMigrationScript, loadDirect } = require('../main/db/migrate');
const { defaultDataDir, parseArgs } = require('./_common');

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const target = args.target;
  if (!['postgres', 'oracle', 'sqlite'].includes(target)) {
    console.error('Usage: node scripts/migrate-db.js --target postgres|oracle [--source file.sqlite | --data folder] (--out file.sql | --connect ...)');
    process.exit(2);
  }
  const source = path.resolve(args.source || path.join(args.data || defaultDataDir(), 'vms-sla.sqlite'));
  if (!fs.existsSync(source)) { console.error(`Source database not found: ${source}`); process.exit(2); }
  const db = await Database.open(source, { create: false });
  console.error(`Source: ${source}`);

  if (args.connect || args['connect-string']) {
    let conn;
    if (target === 'postgres') conn = { connectionString: args.connect };
    else conn = { user: args.user, password: process.env.ORACLE_PASSWORD, connectString: args['connect-string'] || args.connect };
    console.error(`Loading into ${target}...`);
    const report = await loadDirect(db, target, conn, { log: (m) => console.error(m) });
    const bad = report.filter((r) => !r.ok);
    console.table(report.filter((r) => r.source > 0 || !r.ok));
    if (bad.length) { console.error(`Row counts differ for: ${bad.map((b) => b.table).join(', ')}`); process.exit(1); }
    console.error('Migration complete; all row counts match.');
    return;
  }
  const sql = buildMigrationScript(db, target);
  if (args.out) {
    fs.writeFileSync(path.resolve(args.out), sql);
    console.error(`Wrote ${args.out} (${(sql.length / 1024).toFixed(0)} KB)`);
  } else process.stdout.write(sql);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
