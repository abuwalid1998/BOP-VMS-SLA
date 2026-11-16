'use strict';
/**
 * Sign-off workflow for Vendor Incident Reports.
 *
 *   Step 1  Responsible BOP IT Section Head   technical validation
 *   Step 2  Vendor Management Section Head    vendor performance and contractual review
 *   Step 3  CIO                               executive approval, when the approval
 *                                             policy requires it for the severity
 *                                             (or a critical SLA breach)
 *
 * Controls:
 * - Submission freezes the report content and records its SHA-256 content hash.
 * - Each signer re-enters their password; that unlocks their personal Ed25519
 *   key, which signs a payload containing the content hash, decision, time and
 *   the previous signature's hash (a signature chain).
 * - Segregation of duties: one person cannot sign two steps of the same revision;
 *   step 1 must be signed by the head of the section that owns the service.
 * - Rejection returns the report for changes; resubmission starts a new
 *   revision with a fresh approval chain. History is never deleted.
 * - Final approval generates a PDF, seals it (hash + permissions lock) and
 *   locks the report in the database (triggers block later changes).
 */
const crypto = require('crypto');
const { AppError, nowIso, sha256, canonical } = require('./util');
const audit = require('./audit');
const auth = require('./auth');
const incidents = require('./incidents');
const slaCalc = require('./sla-calc');

function policy(db) {
  return db.all('SELECT * FROM approval_policy ORDER BY priority, step_no');
}

function savePolicy(db, actor, rows) {
  if (!['ADMIN', 'VM_SECTION_HEAD'].includes(actor.role_code)) throw new AppError('Only the Vendor Management Section Head or an administrator can change the approval policy.', 'FORBIDDEN');
  const valid = ['IT_SECTION_HEAD', 'VM_SECTION_HEAD', 'CIO', 'SERVICE_OWNER'];
  for (const p of ['P1', 'P2', 'P3', 'P4']) {
    const steps = rows.filter((r) => r.priority === p && Number(r.active));
    if (!steps.length) throw new AppError(`${p} needs at least one approval step.`, 'VALIDATION');
    if (!steps.some((s) => s.role_code === 'IT_SECTION_HEAD' && s.required_when === 'ALWAYS')) throw new AppError(`${p}: technical validation by the IT Section Head must always be required.`, 'VALIDATION');
    if (!steps.some((s) => s.role_code === 'VM_SECTION_HEAD' && s.required_when === 'ALWAYS')) throw new AppError(`${p}: Vendor Management review must always be required.`, 'VALIDATION');
  }
  for (const r of rows) {
    if (!valid.includes(r.role_code)) throw new AppError(`Role ${r.role_code} cannot be an approval step.`, 'VALIDATION');
    if (!['ALWAYS', 'CRITICAL_BREACH', 'ANY_BREACH'].includes(r.required_when)) throw new AppError('Invalid condition.', 'VALIDATION');
  }
  db.tx(() => {
    const before = policy(db);
    db.run('DELETE FROM approval_policy');
    for (const r of rows) {
      db.run('INSERT INTO approval_policy (priority, step_no, role_code, step_label, responsibility, required_when, active, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [r.priority, Number(r.step_no), r.role_code, r.step_label, r.responsibility || null, r.required_when, Number(r.active) ? 1 : 0, nowIso()]);
    }
    audit.record(db, actor, 'APPROVAL_POLICY_CHANGED', 'approval_policy', null, { before, after: rows });
  });
  return policy(db);
}

// ------------------------------------------------------------------ submit
function readinessChecks(full) {
  const r = full.report;
  const issues = [];
  const need = [['impact_summary', 'Impact summary'], ['detected_at', 'Detected time'], ['reported_at', 'Reported-to-vendor time'], ['restored_at', 'Service restored time'], ['root_cause', 'Root cause']];
  for (const [k, label] of need) if (!r[k]) issues.push(`${label} is missing.`);
  if (!full.timeline.length) issues.push('Add at least one timeline event.');
  if (!full.vendorActions.length) issues.push('Record at least one vendor action.');
  if (!full.serviceState.length) issues.push('Record the service state before and after the incident.');
  if (full.slaResults.some((x) => x.outcome === 'BREACHED') && !full.corrective.length) issues.push('SLA breaches need at least one corrective action.');
  if (!r.section_head) issues.push(`No section head is assigned to ${r.section_name}. Set one under Bank sections.`);
  return issues;
}

function buildSteps(db, report, summary) {
  const rows = db.all('SELECT * FROM approval_policy WHERE priority = ? AND active = 1 ORDER BY step_no', [report.priority]);
  return rows.filter((p) => p.required_when === 'ALWAYS' || (p.required_when === 'CRITICAL_BREACH' && summary.criticalBreach) || (p.required_when === 'ANY_BREACH' && summary.breached > 0));
}

function submit(db, actor, id) {
  if (!incidents.EDITORS.includes(actor.role_code)) throw new AppError('Your role cannot submit incident reports.', 'FORBIDDEN');
  incidents.calculateSla(db, actor, id); // always recalculate on submission
  return db.tx(() => {
    const report = incidents.loadReport(db, id);
    incidents.assertEditable(report);
    const full = incidents.get(db, id);
    const issues = readinessChecks(full);
    if (issues.length) throw new AppError(`The report is not ready for approval:\n- ${issues.join('\n- ')}`, 'NOT_READY');
    const revision = report.status === 'RETURNED' ? report.revision + 1 : report.revision;
    if (revision !== report.revision) db.run('UPDATE incident_report SET revision = ? WHERE report_id = ?', [revision, id]);
    const hash = incidents.contentHash(db, id);
    const steps = buildSteps(db, report, full.slaSummary);
    const section = db.get('SELECT s.section_id, b.head_user_id FROM service s JOIN bank_section b ON b.section_id = s.section_id WHERE s.service_id = ?', [report.service_id]);
    steps.forEach((p, i) => {
      db.run(`INSERT INTO approval_step (report_id, revision, step_no, role_code, step_label, responsibility, required_user_id, status, created_at)
              VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, revision, i + 1, p.role_code, p.step_label, p.responsibility, p.role_code === 'IT_SECTION_HEAD' ? section.head_user_id : null, i === 0 ? 'PENDING' : 'WAITING', nowIso()]);
    });
    const now = nowIso();
    db.run("UPDATE incident_report SET status = 'IN_APPROVAL', content_hash = ?, submitted_at = ?, updated_at = ? WHERE report_id = ?", [hash, now, now, id]);
    audit.record(db, actor, 'INCIDENT_REPORT_SUBMITTED', 'incident_report', id, { details: { revision, content_hash: hash, steps: steps.map((s) => s.role_code) } });
    return { revision, contentHash: hash, steps: steps.length };
  });
}

/** Author / Vendor Management can withdraw a report that nobody has signed yet in this revision. */
function withdraw(db, actor, id, reason) {
  return db.tx(() => {
    const r = incidents.loadReport(db, id);
    if (r.status !== 'IN_APPROVAL') throw new AppError('Only a report in approval can be withdrawn.', 'VALIDATION');
    if (r.created_by !== actor.user_id && !['VM_SECTION_HEAD', 'ADMIN'].includes(actor.role_code)) throw new AppError('Only the author or the Vendor Management Section Head can withdraw this report.', 'FORBIDDEN');
    if (db.get("SELECT 1 FROM approval_step WHERE report_id = ? AND revision = ? AND status = 'APPROVED'", [id, r.revision])) throw new AppError('An approver has already signed this revision. Ask the current approver to return it instead.', 'VALIDATION');
    db.run("UPDATE approval_step SET status = 'SUPERSEDED', decision_comment = ?, updated_at = ? WHERE report_id = ? AND revision = ? AND status IN ('PENDING','WAITING')", [`Withdrawn: ${reason || 'no reason given'}`, nowIso(), id, r.revision]);
    db.run("UPDATE incident_report SET status = 'RETURNED', updated_at = ? WHERE report_id = ?", [nowIso(), id]);
    audit.record(db, actor, 'INCIDENT_REPORT_WITHDRAWN', 'incident_report', id, { details: { reason } });
  });
}

// ------------------------------------------------------------------ signing
function eligibility(db, actor, step, report) {
  if (!step || step.status !== 'PENDING') return 'This step is not waiting for a decision.';
  if (report.status !== 'IN_APPROVAL') return 'The report is not in approval.';
  if (step.revision !== report.revision) return 'This step belongs to an earlier revision.';
  if (actor.role_code !== step.role_code) return `This step must be signed by the ${auth.ROLES[step.role_code]}.`;
  if (step.required_user_id && step.required_user_id !== actor.user_id) return 'This step must be signed by the head of the section responsible for the service.';
  const already = db.get("SELECT 1 FROM approval_step WHERE report_id = ? AND revision = ? AND decided_by = ? AND status = 'APPROVED'", [report.report_id, report.revision, actor.user_id]);
  if (already) return 'Segregation of duties: you already signed another step of this revision.';
  return null;
}

function sign(db, actor, { reportId, stepId, decision, reason, password }) {
  if (!['APPROVED', 'REJECTED'].includes(decision)) throw new AppError('Choose approve or return.', 'VALIDATION');
  if (decision === 'REJECTED' && !String(reason || '').trim()) throw new AppError('Explain what must change before the report is returned.', 'VALIDATION');
  if (!password) throw new AppError('Enter your password to sign.', 'VALIDATION');
  // Re-authentication happens outside the transaction so failed attempts are recorded.
  const { user, privateKey } = auth.unlockSigningKey(db, actor, password);
  return db.tx(() => {
    const report = incidents.loadReport(db, reportId);
    const step = db.get('SELECT * FROM approval_step WHERE step_id = ? AND report_id = ?', [stepId, reportId]);
    const problem = eligibility(db, actor, step, report);
    if (problem) throw new AppError(problem, 'FORBIDDEN');
    const currentHash = incidents.contentHash(db, reportId);
    if (currentHash !== report.content_hash) {
      audit.record(db, actor, 'CONTENT_HASH_MISMATCH', 'incident_report', reportId, { details: { expected: report.content_hash, actual: currentHash } });
      throw new AppError('The report content no longer matches what was submitted. Signing is blocked; return the report and resubmit.', 'INTEGRITY');
    }
    const prev = db.get('SELECT signature_hash FROM e_signature WHERE report_id = ? ORDER BY signature_id DESC LIMIT 1', [reportId]);
    const signedAt = nowIso();
    const payload = {
      type: 'BOP-VMS-SLA/incident-report-approval', version: 1,
      report_id: report.report_id, report_no: report.report_no, revision: report.revision,
      step_no: step.step_no, step_label: step.step_label, role_code: step.role_code,
      decision, reason: reason ? String(reason).trim() : null,
      signer: { user_id: user.user_id, username: user.username, full_name: user.full_name, job_title: user.job_title },
      signed_at: signedAt, content_hash: report.content_hash,
      prev_signature_hash: prev ? prev.signature_hash : null, key_fingerprint: user.key_fingerprint,
    };
    const payloadJson = canonical(payload);
    const signatureB64 = crypto.sign(null, Buffer.from(payloadJson), privateKey).toString('base64');
    const signatureHash = sha256(payloadJson + '.' + signatureB64);
    const { lastId } = db.run(
      `INSERT INTO e_signature (report_id, step_id, revision, signer_user_id, signer_name, signer_title, role_code, decision, reason, signed_at, auth_method,
         content_hash, prev_signature_hash, payload_json, signature_b64, public_key_pem, key_fingerprint, signature_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [reportId, stepId, report.revision, user.user_id, user.full_name, user.job_title, step.role_code, decision, payload.reason, signedAt,
        'password re-authentication + Ed25519', report.content_hash, payload.prev_signature_hash, payloadJson, signatureB64, user.public_key_pem, user.key_fingerprint, signatureHash],
    );
    db.run('UPDATE approval_step SET status = ?, decided_by = ?, decided_at = ?, decision_comment = ?, updated_at = ? WHERE step_id = ?',
      [decision, user.user_id, signedAt, payload.reason, signedAt, stepId]);

    let outcome;
    if (decision === 'REJECTED') {
      db.run("UPDATE approval_step SET status = 'SUPERSEDED', updated_at = ? WHERE report_id = ? AND revision = ? AND status = 'WAITING'", [signedAt, reportId, report.revision]);
      db.run("UPDATE incident_report SET status = 'RETURNED', updated_at = ? WHERE report_id = ?", [signedAt, reportId]);
      outcome = 'RETURNED';
    } else {
      const next = db.get("SELECT step_id FROM approval_step WHERE report_id = ? AND revision = ? AND status = 'WAITING' ORDER BY step_no LIMIT 1", [reportId, report.revision]);
      if (next) {
        db.run("UPDATE approval_step SET status = 'PENDING', updated_at = ? WHERE step_id = ?", [signedAt, next.step_id]);
        outcome = 'NEXT_STEP';
      } else {
        db.run("UPDATE incident_report SET status = 'APPROVED', approved_at = ?, updated_at = ? WHERE report_id = ?", [signedAt, signedAt, reportId]);
        outcome = 'FULLY_APPROVED';
      }
    }
    audit.record(db, actor, decision === 'APPROVED' ? 'REPORT_SIGNED_APPROVED' : 'REPORT_SIGNED_RETURNED', 'incident_report', reportId,
      { details: { signature_id: lastId, step: step.step_label, revision: report.revision, signature_hash: signatureHash } });
    return { outcome, signatureId: lastId };
  });
}

/** Verify every signature: cryptographic validity, payload consistency and chain links. */
function verifySignatures(db, reportId) {
  const report = incidents.loadReport(db, reportId);
  const sigs = db.all('SELECT * FROM e_signature WHERE report_id = ? ORDER BY signature_id', [reportId]);
  let prevHash = null;
  const currentHash = incidents.contentHash(db, reportId);
  const results = sigs.map((s) => {
    const checks = [];
    let payload = null;
    try { payload = JSON.parse(s.payload_json); } catch (_) { checks.push('Payload is not valid JSON'); }
    let cryptoOk = false;
    try { cryptoOk = crypto.verify(null, Buffer.from(s.payload_json), crypto.createPublicKey(s.public_key_pem), Buffer.from(s.signature_b64, 'base64')); } catch (_) { cryptoOk = false; }
    if (!cryptoOk) checks.push('Cryptographic signature does not verify');
    if (auth.fingerprint(s.public_key_pem) !== s.key_fingerprint) checks.push('Public key fingerprint mismatch');
    if (payload) {
      if (payload.content_hash !== s.content_hash) checks.push('Signed content hash differs from stored hash');
      if (payload.decision !== s.decision || payload.signed_at !== s.signed_at || payload.signer.user_id !== s.signer_user_id) checks.push('Stored signature fields differ from the signed payload');
      if (payload.prev_signature_hash !== prevHash) checks.push('Signature chain is broken');
    }
    if (sha256(s.payload_json + '.' + s.signature_b64) !== s.signature_hash) checks.push('Signature hash mismatch');
    const currentRevision = s.revision === report.revision;
    if (currentRevision && report.content_hash && s.content_hash !== report.content_hash) checks.push('Signed a different version of the content than the current submission');
    prevHash = s.signature_hash;
    return { signature_id: s.signature_id, signer_name: s.signer_name, role_code: s.role_code, decision: s.decision, signed_at: s.signed_at, revision: s.revision, valid: checks.length === 0, checks };
  });
  const contentIntact = !report.content_hash || report.status === 'DRAFT' || report.status === 'RETURNED' || currentHash === report.content_hash;
  return { ok: results.every((r) => r.valid) && contentIntact, contentIntact, contentHash: report.content_hash, currentHash, signatures: results };
}

function forReport(db, actor, reportId) {
  const report = incidents.loadReport(db, reportId);
  const steps = db.all(
    `SELECT a.*, u.full_name AS decided_by_name, u.job_title AS decided_by_title, ru.full_name AS required_user_name
       FROM approval_step a LEFT JOIN app_user u ON u.user_id = a.decided_by LEFT JOIN app_user ru ON ru.user_id = a.required_user_id
      WHERE a.report_id = ? ORDER BY a.revision DESC, a.step_no`, [reportId],
  );
  const signatures = db.all('SELECT signature_id, step_id, revision, signer_name, signer_title, role_code, decision, reason, signed_at, auth_method, content_hash, key_fingerprint, signature_hash, signature_b64 FROM e_signature WHERE report_id = ? ORDER BY signature_id', [reportId]);
  const documents = db.all('SELECT d.*, u.full_name AS generated_by_name FROM report_document d LEFT JOIN app_user u ON u.user_id = d.generated_by WHERE d.report_id = ? ORDER BY document_id DESC', [reportId]);
  const current = steps.filter((s) => s.revision === report.revision);
  const pending = current.find((s) => s.status === 'PENDING');
  const signBlock = pending ? eligibility(db, actor, pending, report) : 'No step is waiting for a decision.';
  const preview = report.status === 'DRAFT' || report.status === 'RETURNED'
    ? buildSteps(db, report, slaCalc.summarize(db.all('SELECT outcome, is_critical FROM incident_sla_result WHERE report_id = ?', [reportId]))).map((p) => ({ role_code: p.role_code, step_label: p.step_label, responsibility: p.responsibility }))
    : null;
  return {
    steps, current, signatures, documents, preview,
    canSign: !!pending && !signBlock, signBlock: pending ? signBlock : null, pendingStepId: pending ? pending.step_id : null,
    canEdit: incidents.EDITORS.includes(actor.role_code) && ['DRAFT', 'RETURNED'].includes(report.status),
    canWithdraw: report.status === 'IN_APPROVAL' && (report.created_by === actor.user_id || ['VM_SECTION_HEAD', 'ADMIN'].includes(actor.role_code)) && !current.some((s) => s.status === 'APPROVED'),
  };
}

function inbox(db, actor) {
  const rows = db.all(
    `SELECT a.step_id, a.step_label, a.role_code, a.required_user_id, a.created_at AS step_created_at, a.updated_at AS step_updated_at,
            r.report_id, r.report_no, r.title, r.priority, r.revision, r.submitted_at, v.legal_name AS vendor_name, s.service_name,
            (SELECT COUNT(*) FROM incident_sla_result x WHERE x.report_id = r.report_id AND x.outcome = 'BREACHED') AS breaches,
            (SELECT COUNT(*) FROM incident_sla_result x WHERE x.report_id = r.report_id AND x.outcome = 'BREACHED' AND x.is_critical = 1) AS critical_breaches
       FROM approval_step a JOIN incident_report r ON r.report_id = a.report_id AND r.revision = a.revision
       JOIN vendor v ON v.vendor_id = r.vendor_id JOIN service s ON s.service_id = r.service_id
      WHERE a.status = 'PENDING' AND r.status = 'IN_APPROVAL' AND a.role_code = ?
      ORDER BY r.priority, r.submitted_at`, [actor.role_code],
  );
  return rows.filter((row) => !eligibility(db, actor, db.get('SELECT * FROM approval_step WHERE step_id = ?', [row.step_id]), incidents.loadReport(db, row.report_id)));
}

/** Lock the report after the sealed PDF has been stored. */
function lockReport(db, actor, reportId, documentRow) {
  return db.tx(() => {
    const r = incidents.loadReport(db, reportId);
    if (r.status !== 'APPROVED') throw new AppError('Only a fully approved report can be locked.', 'VALIDATION');
    const now = nowIso();
    const { lastId } = db.run(
      `INSERT INTO report_document (report_id, doc_type, revision, title, file_ref, sha256, size_bytes, is_locked, encrypted, generated_by, generated_at)
       VALUES (?,?,?,?,?,?,?,1,?,?,?)`,
      [reportId, 'INCIDENT_FINAL', r.revision, documentRow.title, documentRow.file_ref, documentRow.sha256, documentRow.size_bytes, documentRow.encrypted ? 1 : 0, actor.user_id, now],
    );
    db.run("UPDATE incident_report SET status = 'LOCKED', locked_at = ?, updated_at = ? WHERE report_id = ?", [now, now, reportId]);
    audit.record(db, actor, 'INCIDENT_REPORT_LOCKED', 'incident_report', reportId, { details: { document_id: lastId, pdf_sha256: documentRow.sha256 } });
    return lastId;
  });
}

module.exports = { policy, savePolicy, submit, withdraw, sign, verifySignatures, forReport, inbox, lockReport, readinessChecks };
