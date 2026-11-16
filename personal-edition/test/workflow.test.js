'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { freshApp, catalogue, completeIncident } = require('./helpers');
const documents = require('../main/report/documents');
const audit = require('../main/services/audit');

test('a new installation is empty: no sample records, one owner, no sign-in', async () => {
  const { db, call } = await freshApp();
  for (const t of ['vendor', 'service', 'contract', 'bank_section', 'incident_report']) assert.equal(db.value(`SELECT COUNT(*) FROM ${t}`), 0, t);
  assert.equal(db.value('SELECT COUNT(*) FROM app_user'), 1);
  const me = await call('auth.me');
  assert.equal(me.username, 'owner');
});

test('records get automatic codes in their own series', async () => {
  const { call } = await freshApp();
  const k = await catalogue(call);
  assert.equal(k.sec.section_code, 'SEC-0001');
  assert.equal(k.v.vendor_code, 'V-0001');
  assert.equal(k.s.service_code, 'S-0001');
  assert.equal(k.c.contract_no, 'C-0001');
  assert.equal(k.cv.version_no, 'v1');
  assert.equal(k.sla.sla_code, 'SLA-0001');
  const s2 = await call('registry.save', { entity: 'service', data: { service_code: 'TYPED-1', service_name: 'ATM fleet', service_tower: 'ATM / Branch Technology', criticality: 'HIGH', section_id: k.sec.section_id } });
  assert.equal(s2.service_code, 'S-0002', 'a typed code is ignored');
  const v2 = await call('registry.save', { entity: 'contract_version', data: { contract_id: k.c.contract_id, effective_from: '2026-06-01' } });
  assert.equal(v2.version_no, 'v2');
  const edited = await call('registry.save', { entity: 'service', data: { service_id: s2.service_id, service_code: 'X', service_name: 'ATM fleet maintenance' } });
  assert.equal(edited.service_code, 'S-0002', 'codes never change on edit');
  const inc = await completeIncident(call, k);
  assert.equal(inc.report_no, 'INC-0001');
});

test('finalising calculates SLAs, seals the PDF and locks the report', async () => {
  const { db, ctx, call } = await freshApp();
  const k = await catalogue(call);
  const r = await completeIncident(call, k);
  const res = await call('incidents.finalize', { id: r.report_id });
  assert.equal(res.report.report.status, 'LOCKED');
  assert.equal(res.report.slaSummary.breached, 1);
  assert.equal(res.report.slaSummary.criticalBreach, true);
  const doc = res.report.documents[0];
  assert.ok(documents.verify(db, ctx, doc.document_id).ok);
  const bytes = fs.readFileSync(documents.docPath(ctx, doc));
  assert.ok(documents.verifyBytes(db, bytes).ok);
  assert.equal(documents.verifyBytes(db, Buffer.concat([bytes, Buffer.from('x')])).ok, false);
  await assert.rejects(call('incidents.update', { id: r.report_id, data: { title: 'changed' } }), /finalised and locked/);
  assert.throws(() => db.run('UPDATE incident_report SET title = ? WHERE report_id = ?', ['x', r.report_id]), /locked/);
  assert.ok(audit.verifyChain(db).ok);
});

test('an incomplete report cannot be finalised', async () => {
  const { call } = await freshApp();
  const k = await catalogue(call);
  const r = await call('incidents.create', { vendor_id: k.v.vendor_id, service_id: k.s.service_id, title: 'Partial', priority: 'P3' });
  await assert.rejects(call('incidents.finalize', { id: r.report_id }), /not complete/);
  const full = await call('incidents.get', { id: r.report_id });
  assert.ok(full.readiness.length >= 5);
});

test('commitment report links commitments to clauses and lists gaps', async () => {
  const { call } = await freshApp();
  const k = await catalogue(call);
  await call('registry.save', { entity: 'responsibility', data: { vendor_service_id: 1, activity: 'Monthly SLA report', bank_party: 'Vendor Management', vendor_party: 'Service manager' } });
  const rep = await call('commitments.build', { vendorId: k.v.vendor_id, serviceId: k.s.service_id, asOf: '2026-11-15' });
  assert.equal(rep.slas[0].clause_ref, '5.2');
  assert.ok(rep.coverage.gaps.some((g) => g.kind === 'Responsibility'));
});

test('the audit chain detects an edited event', async () => {
  const { db, call } = await freshApp();
  await catalogue(call);
  db.db.run('DROP TRIGGER trg_audit_event_no_upd');
  db.run("UPDATE audit_event SET actor_name = 'someone else' WHERE event_id = 3");
  assert.equal(audit.verifyChain(db).ok, false);
});
