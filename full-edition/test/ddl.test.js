'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { generate, splitStatements, DIALECTS } = require('../main/db/ddl');
const { tables } = require('../main/db/schema');

test('DDL generates for every dialect with all tables and triggers', () => {
  for (const d of DIALECTS) {
    const sql = generate(d);
    for (const t of tables) assert.ok(sql.includes(`CREATE TABLE ${t.name} (`), `${d}: ${t.name}`);
    assert.ok(/TRIGGER/.test(sql));
    assert.ok(splitStatements(sql, d).length > tables.length);
  }
});

test('Oracle identifiers stay within 30 characters and PL/SQL blocks are terminated', () => {
  const sql = generate('oracle');
  const names = [...sql.matchAll(/(?:CONSTRAINT|INDEX|TRIGGER) (\w+)/g)].map((m) => m[1]);
  assert.ok(names.every((n) => n.length <= 30), names.filter((n) => n.length > 30).join(', '));
  const stmts = splitStatements(sql, 'oracle');
  assert.ok(stmts.filter((s) => s.startsWith('CREATE OR REPLACE TRIGGER')).every((s) => /END;$/.test(s)));
});
