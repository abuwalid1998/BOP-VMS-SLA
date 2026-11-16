'use strict';
/**
 * SQLite access layer (sql.js / WebAssembly - no native build required, so the
 * desktop app installs cleanly on locked-down bank workstations).
 *
 * The whole database lives in memory and is written to disk atomically
 * (temp file + rename) after every committed write. All statements use bound
 * parameters; no user input is ever concatenated into SQL.
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { generate, splitStatements } = require('./ddl');
const { SCHEMA_VERSION } = require('./schema');

let SQL = null;
async function loadEngine() {
  if (SQL) return SQL;
  const dir = path.dirname(require.resolve('sql.js'));
  SQL = await initSqlJs({ locateFile: (f) => path.join(dir, f) });
  return SQL;
}

class Database {
  constructor(sqlDb, file) {
    this.db = sqlDb;
    this.file = file; // null = in-memory only (tests)
    this.depth = 0;
    this.dirty = false;
    this.db.run('PRAGMA foreign_keys = ON');
  }

  static async open(file, { create = true } = {}) {
    await loadEngine();
    let sqlDb;
    let fresh = false;
    if (file && fs.existsSync(file)) {
      sqlDb = new SQL.Database(fs.readFileSync(file));
    } else {
      if (file && !create) throw new Error(`Database not found: ${file}`);
      sqlDb = new SQL.Database();
      fresh = true;
    }
    const db = new Database(sqlDb, file);
    if (fresh) db.createSchema();
    db.checkVersion();
    return db;
  }

  createSchema() {
    const stmts = splitStatements(generate('sqlite', { withHeader: false }), 'sqlite');
    this.tx(() => {
      for (const s of stmts) this.db.run(s);
      this.db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  }

  checkVersion() {
    const v = this.get('PRAGMA user_version').user_version;
    if (v !== SCHEMA_VERSION) {
      throw new Error(`Database schema version ${v} does not match application schema ${SCHEMA_VERSION}. Run the migration scripts.`);
    }
  }

  _norm(params) {
    if (params === undefined) return [];
    return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
  }

  all(sql, params) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(this._norm(params));
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(sql, params) {
    return this.all(sql, params)[0];
  }

  value(sql, params) {
    const row = this.get(sql, params);
    return row ? Object.values(row)[0] : undefined;
  }

  run(sql, params) {
    this.db.run(sql, this._norm(params));
    const changes = this.db.getRowsModified();
    const lastId = this.db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
    this.dirty = true;
    if (this.depth === 0) this.persist();
    return { changes, lastId };
  }

  /** Run fn inside a transaction (nested calls use savepoints). */
  tx(fn) {
    const sp = `sp_${this.depth}`;
    this.db.run(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    this.depth += 1;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') throw new Error('tx() callbacks must be synchronous');
      this.depth -= 1;
      this.db.run(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
      if (this.depth === 0) this.persist();
      return result;
    } catch (err) {
      this.depth -= 1;
      try { this.db.run(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}`); } catch (_) { /* already rolled back */ }
      throw err;
    }
  }

  persist() {
    if (!this.file || !this.dirty) return;
    const data = this.db.export();
    this.db.run('PRAGMA foreign_keys = ON'); // export() resets connection pragmas
    const tmp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, this.file);
    this.dirty = false;
  }

  close() {
    this.persist();
    this.db.close();
  }
}

module.exports = { Database, loadEngine };
