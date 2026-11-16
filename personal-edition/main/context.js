'use strict';
/**
 * Builds the application context: data folders, database, PDF renderer.
 * Shared by the Electron main process, the browser dev server and scripts.
 * A new installation starts empty (Personal Edition: one owner, no sign-in).
 */
const fs = require('fs');
const path = require('path');
const { Database } = require('./db/database');
const { ensureOwner } = require('./db/bootstrap');

async function createContext({ dataDir, renderPdf, openPath, log = console.log }) {
  const paths = {
    data: dataDir,
    evidence: path.join(dataDir, 'evidence'),
    documents: path.join(dataDir, 'documents'),
  };
  Object.values(paths).forEach((p) => fs.mkdirSync(p, { recursive: true }));
  const dbFile = path.join(dataDir, 'vms-sla.sqlite');
  const db = await Database.open(dbFile);
  ensureOwner(db);
  return { db, dbFile, paths, renderPdf, openPath, log: (...a) => log(...a) };
}

module.exports = { createContext };
