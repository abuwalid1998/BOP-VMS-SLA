'use strict';
/**
 * Builds the application context: data folders, database, PDF renderer.
 * Shared by the Electron main process, the browser dev server and scripts.
 * A new installation starts empty; the first-run setup screen creates the
 * administrator (see db/bootstrap.js).
 */
const fs = require('fs');
const path = require('path');
const { Database } = require('./db/database');
const { ensurePolicy } = require('./db/bootstrap');

async function createContext({ dataDir, renderPdf, openPath, log = console.log }) {
  const paths = {
    data: dataDir,
    evidence: path.join(dataDir, 'evidence'),
    documents: path.join(dataDir, 'documents'),
  };
  Object.values(paths).forEach((p) => fs.mkdirSync(p, { recursive: true }));
  const dbFile = path.join(dataDir, 'vms-sla.sqlite');
  const db = await Database.open(dbFile);
  ensurePolicy(db);
  return { db, dbFile, paths, renderPdf, openPath, log: (...a) => log(...a) };
}

module.exports = { createContext };
