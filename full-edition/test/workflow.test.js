'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { demoContext } = require('./helpers');
const incidents = require('../main/services/incidents');
const approvals = require('../main/services/approvals');
const audit = require('../main/services/audit');
const documents = require('../main/report/documents');
const commitments = require('../main/services/commitments');
const { DEMO_PASSWORD } = require('./fixtures/demo-seed');

test('demo seed runs the full workflow: P1 report signed by three approvers, sealed and locked', async () => {
  const { db, ctx } = await demoContext();
  const r1 = db.get("SELECT * FROM incident_report WHERE report_no = 'INC-2026-0001'");
  assert.equal(r1.status, 'LOCKED');
  const v = approvals.verifySignatures(db, r1.report_id);
  assert.ok(v.ok);
  assert.deepEqual(v.signatures.map((s) => s.role_code), ['IT_SECTION_HEAD', 'VM_SECTION_HEAD', 'CIO']);
  const doc = db.get("SELECT * FROM report_document WHERE doc_type = 'INCIDENT_FINAL' AND report_id = ?", [r1.report_id]);
  assert.ok(documents.verify(db, ctx, doc.document_id).ok);
  assert.ok(audit.verifyChain(db).ok);
});

test('locked reports and their children cannot be changed, even with direct SQL', async () => {
  const { db, user } = await demoContext();
  assert.throws(() => db.run("UPDATE incident_report SET title = 'x' WHERE report_id = 1"), /locked/);
  assert.throws(() => db.run("INSERT INTO incident_timeline (report_id, occurred_at, event_type, actor_party, description, created_at) VALUES (1, '2026-01-01', 'x', 'BANK', 'y', '2026-01-01')"), /locked/);
  assert.throws(() => db.run('DELETE FROM e_signature'), /append-only/);
  assert.throws(() => db.run('UPDATE audit_event SET actor_name = 1'), /append-only/);
  assert.throws(() => incidents.update(db, user('net.tech'), 1, { title: 'changed' }), /locked/);
});

test('only the head of the service section can sign technical validation; wrong password is refused', async () => {
  const { db, user } = await demoContext();
  // INC-2026-0004 was returned; resubmit as revision 2
  const id = db.get("SELECT report_id FROM incident_report WHERE report_no = 'INC-2026-0004'").report_id;
  approvals.submit(db, user('vm.manager'), id);
  const step = db.get("SELECT * FROM approval_step WHERE report_id = ? AND status = 'PENDING'", [id]);
  assert.equal(step.revision, 2);
  assert.throws(() => approvals.sign(db, user('net.head'), { reportId: id, stepId: step.step_id, decision: 'APPROVED', password: DEMO_PASSWORD }), /head of the section/);
  assert.throws(() => approvals.sign(db, user('infra.head'), { reportId: id, stepId: step.step_id, decision: 'APPROVED', password: 'nope' }), /incorrect/);
  assert.throws(() => approvals.sign(db, user('vm.head'), { reportId: id, stepId: step.step_id, decision: 'APPROVED', password: DEMO_PASSWORD }), /must be signed by/);
  const ok = approvals.sign(db, user('infra.head'), { reportId: id, stepId: step.step_id, decision: 'APPROVED', password: DEMO_PASSWORD });
  assert.equal(ok.outcome, 'NEXT_STEP');
});

test('a change to submitted content outside the application blocks signing', async () => {
  const { db, user } = await demoContext();
  const id = db.get("SELECT report_id FROM incident_report WHERE report_no = 'INC-2026-0002'").report_id;
  db.run("UPDATE incident_timeline SET description = 'tampered' WHERE report_id = ?", [id]);
  const step = db.get("SELECT * FROM approval_step WHERE report_id = ? AND status = 'PENDING'", [id]);
  assert.throws(() => approvals.sign(db, user('vm.head'), { reportId: id, stepId: step.step_id, decision: 'APPROVED', password: DEMO_PASSWORD }), /no longer matches/);
  assert.equal(approvals.verifySignatures(db, id).contentIntact, false);
});

test('final approval seals the PDF and locks the report; the file is tamper-evident', async () => {
  const { db, ctx, user } = await demoContext();
  const id = db.get("SELECT report_id FROM incident_report WHERE report_no = 'INC-2026-0002'").report_id;
  for (const who of ['vm.head', 'cio']) {
    const step = db.get("SELECT * FROM approval_step WHERE report_id = ? AND status = 'PENDING'", [id]);
    approvals.sign(db, user(who), { reportId: id, stepId: step.step_id, decision: 'APPROVED', password: DEMO_PASSWORD });
  }
  assert.equal(incidents.loadReport(db, id).status, 'APPROVED');
  const out = await documents.finalizeIncident(db, ctx, user('cio'), id);
  assert.equal(incidents.loadReport(db, id).status, 'LOCKED');
  const file = documents.docPath(ctx, { file_ref: out.file_ref });
  assert.ok(documents.verifyBytes(db, fs.readFileSync(file)).ok);
  const altered = Buffer.concat([fs.readFileSync(file), Buffer.from('%tamper')]);
  assert.equal(documents.verifyBytes(db, altered).ok, false);
});

test('a report with missing content cannot be submitted', async () => {
  const { db, user } = await demoContext();
  const id = db.get("SELECT report_id FROM incident_report WHERE report_no = 'INC-2026-0003'").report_id;
  assert.throws(() => approvals.submit(db, user('infra.head'), id), /not ready/);
});

test('rejection returns the report; resubmission starts a new revision and chain', async () => {
  const { db, user } = await demoContext();
  const id = db.get("SELECT report_id FROM incident_report WHERE report_no = 'INC-2026-0002'").report_id;
  const step = db.get("SELECT * FROM approval_step WHERE report_id = ? AND status = 'PENDING'", [id]);
  assert.throws(() => approvals.sign(db, user('vm.head'), { reportId: id, stepId: step.step_id, decision: 'REJECTED', password: DEMO_PASSWORD }), /Explain/);
  approvals.sign(db, user('vm.head'), { reportId: id, stepId: step.step_id, decision: 'REJECTED', reason: 'Add credit calculation', password: DEMO_PASSWORD });
  assert.equal(incidents.loadReport(db, id).status, 'RETURNED');
  incidents.update(db, user('app.owner'), id, { business_impact: 'Updated with credit calculation' });
  approvals.submit(db, user('app.owner'), id);
  const r = incidents.loadReport(db, id);
  assert.equal(r.revision, 2);
  assert.equal(db.value("SELECT COUNT(*) FROM approval_step WHERE report_id = ? AND revision = 2 AND status = 'PENDING'", [id]), 1);
  assert.ok(approvals.verifySignatures(db, id).ok);
});

test('commitment report links each commitment to its clause and lists gaps', async () => {
  const { db } = await demoContext();
  const rep = commitments.build(db, 1, 1, '2026-11-15');
  assert.ok(rep.slas.length >= 6);
  assert.ok(rep.slas.every((s) => s.clause_ref));
  assert.ok(rep.coverage.gaps.some((g) => g.kind === 'Responsibility'));
  const cbs = commitments.build(db, 2, 2, '2026-11-15');
  assert.ok(cbs.coverage.gaps.some((g) => /Severity 3 response/.test(g.name)));
});

test('the audit chain detects an edited event', async () => {
  const { db } = await demoContext();
  db.db.run('DROP TRIGGER trg_audit_event_no_upd');
  db.run("UPDATE audit_event SET actor_name = 'someone else' WHERE event_id = 5");
  const v = audit.verifyChain(db);
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 5);
});
