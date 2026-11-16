'use strict';
/**
 * Personal Edition: finalising a Vendor Incident Report replaces the
 * multi-person sign-off. Finalising
 *   1. recalculates SLA compliance,
 *   2. checks the report is complete,
 *   3. freezes the content and records its SHA-256,
 *   4. produces the sealed PDF and registers its hash,
 *   5. locks the report (database triggers block later changes).
 */
const { AppError, nowIso } = require('./util');
const audit = require('./audit');
const incidents = require('./incidents');
const documents = require('../report/documents');

function readiness(full) {
  const r = full.report;
  const issues = [];
  const need = [['impact_summary', 'Impact summary'], ['detected_at', 'Detected time'], ['reported_at', 'Reported-to-vendor time'], ['restored_at', 'Service restored time'], ['root_cause', 'Root cause']];
  for (const [k, label] of need) if (!r[k]) issues.push(`${label} is missing.`);
  if (!full.timeline.length) issues.push('Add at least one timeline event.');
  if (!full.vendorActions.length) issues.push('Record at least one vendor action.');
  if (!full.serviceState.length) issues.push('Record the service state before and after the incident.');
  if (full.slaResults.some((x) => x.outcome === 'BREACHED') && !full.corrective.length) issues.push('SLA breaches need at least one corrective action.');
  return issues;
}

async function finalize(db, ctx, actor, id) {
  const current = incidents.loadReport(db, id);
  if (current.status === 'APPROVED') {
    // A previous attempt froze the report but the PDF was not produced: retry the PDF only.
    return documents.finalizeIncident(db, ctx, actor, id);
  }
  incidents.calculateSla(db, actor, id);
  db.tx(() => {
    const r = incidents.loadReport(db, id);
    incidents.assertEditable(r);
    const issues = readiness(incidents.get(db, id));
    if (issues.length) throw new AppError(`The report is not complete yet:\n- ${issues.join('\n- ')}`, 'NOT_READY');
    const hash = incidents.contentHash(db, id);
    const now = nowIso();
    db.run("UPDATE incident_report SET status = 'APPROVED', content_hash = ?, submitted_at = ?, approved_at = ?, updated_at = ? WHERE report_id = ?", [hash, now, now, now, id]);
    audit.record(db, actor, 'INCIDENT_REPORT_FINALISED', 'incident_report', id, { details: { content_hash: hash } });
  });
  return documents.finalizeIncident(db, ctx, actor, id);
}

module.exports = { finalize, readiness };
