#!/usr/bin/env node
'use strict';
/**
 * Start again with an empty database.
 *   node scripts/reset-db.js [--data <folder>]
 * The existing database, evidence and sealed documents are moved to a
 * timestamped backup folder (never deleted). The next launch of the app shows
 * the first-run setup screen to create the administrator.
 */
const fs = require('fs');
const path = require('path');
const { defaultDataDir, parseArgs } = require('./_common');

const args = parseArgs(process.argv.slice(2));
const dir = path.resolve(args.data || defaultDataDir());
const present = ['vms-sla.sqlite', 'evidence', 'documents'].filter((n) => fs.existsSync(path.join(dir, n)));
if (!present.length) { console.log(`Nothing to reset in ${dir}`); process.exit(0); }
const backup = path.join(dir, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(backup, { recursive: true });
for (const n of present) fs.renameSync(path.join(dir, n), path.join(backup, n));
console.log(`Previous data moved to ${backup}`);
console.log('Start the application to run first-time setup.');
