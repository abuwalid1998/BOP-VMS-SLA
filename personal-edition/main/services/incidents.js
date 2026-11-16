'use strict';
/**
 * Vendor Incident Report (feature 2): incident details, impact, timeline,
 * before/after service state, vendor actions with evidence, SLA compliance,
 * root cause and corrective actions. Approval and signing live in
 * approvals.js; this module owns the report content.
 */
const { AppError, nowIso, toIso, hashOf } = require('./util');
const audit = require('./audit');
const slaCalc = require('./sla-calc');
const settings = require('./settings');
const { effectiveVersion } = require('./commitments');

const EDITORS = ['ADMIN', 'VM_SECTION_HEAD', 'VENDOR_MANAGER', 'IT_SECTION_HEAD', 'SERVICE_OWNER', 'TECH_OWNER'];
const BANK_VALIDATORS = ['IT_SECTION_HEAD', 'TECH_OWNER', 'SERVICE_OWNER', 'VM_SECTION_HEAD'];
const EDITABLE_STATUS = ['DRAFT', 'RETURNED'];

const HEADER_FIELDS = {
  title: 'str', priority: 'priority', impact_summary: 'str', business_impact: 'str', customers_affected: 'int', channels_affected: 'str',
  financial_impact: 'num', outage_type: 'outage', detected_at: 'ts', reported_at: 'ts', acknowledged_at: 'ts', workaround_at: 'ts',
  restored_at: 'ts', resolved_at: 'ts', outage_start: 'ts', outage_end: 'ts', itsm_ref: 'str', vendor_ticket_ref: 'str',
  root_cause_category: 'str', root_cause: 'str', contributing_factors: 'str', rca_due_at: 'ts', rca_received_at: 'ts', rca_accepted: 'bool',
};

const CHILDREN = {
  timeline: {
    table: 'incident_timeline', pk: 'event_id', order: 'occurred_at, event_id', label: 'Timeline event',
    fields: { occurred_at: 'ts!', event_type: 'str!', actor_party: 'party!', actor_name: 'str', description: 'str!', source: 'str' },
  },
  pause: {
    table: 'incident_clock_pause', pk: 'pause_id', order: 'paused_at', label: 'Clock pause',
    fields: { paused_at: 'ts!', resumed_at: 'ts!', reason: 'str!' },
  },
  state: {
    table: 'incident_service_state', pk: 'state_id', order: 'state_id', label: 'Service state row',
    fields: { component: 'str!', indicator: 'str!', unit: 'str', before_value: 'str', during_value: 'str', after_value: 'str', before_status: 'str', after_status: 'str', evidence_id: 'int', notes: 'str' },
  },
  vendorAction: {
    table: 'vendor_action', pk: 'action_id', order: 'action_at, action_id', label: 'Vendor action',
    fields: { action_at: 'ts!', vendor_actor: 'str', action_type: 'str!', description: 'str!', outcome: 'str', evidence_id: 'int' },
  },
  corrective: {
    table: 'action_issue', pk: 'action_issue_id', order: 'due_date, action_issue_id', label: 'Corrective action',
    fields: { description: 'str!', source_finding: 'str', action_type: 'actiontype', severity: 'tier', owner_party: 'party!', owner_name: 'str', due_date: 'date', status: 'acstatus' },
  },
};

const ENUMS = {
  priority: ['P1', 'P2', 'P3', 'P4'],
  outage: ['FULL', 'PARTIAL', 'DEGRADED', 'NONE'],
  party: ['BANK', 'VENDOR', 'JOINT'],
  tier: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
  actiontype: ['CORRECTIVE', 'PREVENTIVE'],
  acstatus: ['OPEN', 'IN_PROGRESS', 'DONE_PENDING_REVIEW', 'CLOSED', 'CANCELLED'],
};

function coerce(type, raw, label) {
  const required = type.endsWith('!');
  const t = type.replace('!', '');
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') {
    if (required) throw new AppError(`${label} is required.`, 'VALIDATION');
    return null;
  }
  switch (t) {
    case 'ts': return toIso(raw);
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) throw new AppError(`${label} must be a date.`, 'VALIDATION');
      return String(raw);
    case 'int': case 'num': {
      const n = Number(raw);
      if (Number.isNaN(n)) throw new AppError(`${label} must be a number.`, 'VALIDATION');
      return t === 'int' ? Math.round(n) : n;
    }
    case 'bool': return raw === true || raw === 1 || raw === '1' || raw === 'true' ? 1 : 0;
    case 'str': return String(raw).trim();
    default:
      if (ENUMS[t]) {
        if (!ENUMS[t].includes(String(raw))) throw new AppError(`${label}: "${raw}" is not an allowed value.`, 'VALIDATION');
        return String(raw);
      }
      return String(raw);
  }
}

const human = (f) => f.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function assertEditor(actor) {
  if (!EDITORS.includes(actor.role_code)) throw new AppError('Your role cannot edit incident reports.', 'FORBIDDEN');
}

function loadReport(db, id) {
  const r = db.get('SELECT * FROM incident_report WHERE report_id = ?', [id]);
  if (!r) throw new AppError('Incident report not found.', 'NOT_FOUND');
  return r;
}

function assertEditable(report) {
  if (!EDITABLE_STATUS.includes(report.status)) {
    throw new AppError('This report is finalised and locked. It can no longer be changed.', 'LOCKED');
  }
}

function nextReportNo(db) {
  const last = db.all("SELECT report_no FROM incident_report WHERE report_no LIKE 'INC-%'").reduce((m, r) => {
    const n = Number(String(r.report_no).slice(4));
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `INC-${String(last + 1).padStart(4, '0')}`;
}

function list(db, f = {}) {
  const where = [];
  const p = [];
  if (f.status) { where.push('r.status = ?'); p.push(f.status); }
  if (f.vendor_id) { where.push('r.vendor_id = ?'); p.push(f.vendor_id); }
  if (f.service_id) { where.push('r.service_id = ?'); p.push(f.service_id); }
  if (f.priority) { where.push('r.priority = ?'); p.push(f.priority); }
  if (f.q) { where.push("(r.report_no LIKE ? OR r.title LIKE ? OR r.itsm_ref LIKE ?)"); p.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
  return db.all(
    `SELECT r.report_id, r.report_no, r.title, r.priority, r.status, r.revision, r.detected_at, r.restored_at, r.created_at, r.locked_at,
            v.legal_name AS vendor_name, s.service_name, s.service_code, s.criticality,
            (SELECT COUNT(*) FROM incident_sla_result x WHERE x.report_id = r.report_id AND x.outcome = 'BREACHED') AS breaches,
            (SELECT COUNT(*) FROM incident_sla_result x WHERE x.report_id = r.report_id AND x.outcome = 'BREACHED' AND x.is_critical = 1) AS critical_breaches,
            (SELECT a.step_label FROM approval_step a WHERE a.report_id = r.report_id AND a.revision = r.revision AND a.status = 'PENDING') AS pending_step
       FROM incident_report r JOIN vendor v ON v.vendor_id = r.vendor_id JOIN service s ON s.service_id = r.service_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY r.created_at DESC`, p,
  );
}

function create(db, actor, data) {
  assertEditor(actor);
  const vendorId = Number(data.vendor_id);
  const serviceId = Number(data.service_id);
  if (!vendorId || !serviceId) throw new AppError('Select the vendor and the affected service.', 'VALIDATION');
  const title = coerce('str!', data.title, 'Title');
  const priority = coerce('priority', data.priority || 'P2', 'Priority');
  const vs = db.get('SELECT * FROM vendor_service WHERE vendor_id = ? AND service_id = ?', [vendorId, serviceId]);
  if (!vs) throw new AppError('This vendor is not registered as a provider of the selected service.', 'VALIDATION');
  const version = effectiveVersion(db, vs.contract_id, new Date().toISOString().slice(0, 10));
  return db.tx(() => {
    const reportNo = nextReportNo(db);
    const now = nowIso();
    const { lastId } = db.run(
      `INSERT INTO incident_report (report_no, vendor_id, service_id, vendor_service_id, contract_version_id, title, priority, status, revision, detected_at, created_by, created_at)
       VALUES (?,?,?,?,?,?,?, 'DRAFT', 1, ?, ?, ?)`,
      [reportNo, vendorId, serviceId, vs.vendor_service_id, version ? version.version_id : null, title, priority, toIso(data.detected_at) || null, actor.user_id, now],
    );
    audit.record(db, actor, 'INCIDENT_REPORT_CREATED', 'incident_report', lastId, { after: { reportNo, vendorId, serviceId, priority, title } });
    return loadReport(db, lastId);
  });
}

function update(db, actor, id, data) {
  assertEditor(actor);
  return db.tx(() => {
    const before = loadReport(db, id);
    assertEditable(before);
    const vals = {};
    for (const [k, type] of Object.entries(HEADER_FIELDS)) {
      const v = coerce(type, data[k], human(k));
      if (v !== undefined) vals[k] = v;
    }
    if (vals.title === null) throw new AppError('Title is required.', 'VALIDATION');
    if (vals.priority === null) throw new AppError('Priority is required.', 'VALIDATION');
    const cols = Object.keys(vals);
    if (!cols.length) return before;
    cols.push('updated_at');
    vals.updated_at = nowIso();
    db.run(`UPDATE incident_report SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE report_id = ?`, [...cols.map((c) => vals[c]), id]);
    audit.record(db, actor, 'INCIDENT_REPORT_UPDATED', 'incident_report', id, { before, after: vals });
    return loadReport(db, id);
  });
}

function removeDraft(db, actor, id) {
  assertEditor(actor);
  db.tx(() => {
    const r = loadReport(db, id);
    if (r.status !== 'DRAFT' || r.revision !== 1) throw new AppError('Only a draft that has never been submitted can be deleted.', 'VALIDATION');
    for (const t of ['incident_timeline', 'incident_clock_pause', 'incident_service_state', 'vendor_action', 'incident_sla_result', 'action_issue']) {
      db.run(`DELETE FROM ${t} WHERE report_id = ?`, [id]);
    }
    db.run('UPDATE evidence SET report_id = NULL WHERE report_id = ?', [id]);
    db.run('DELETE FROM incident_report WHERE report_id = ?', [id]);
    audit.record(db, actor, 'INCIDENT_REPORT_DELETED', 'incident_report', id, { before: r });
  });
}

// ------------------------------------------------------------------ children
function childDef(kind) {
  const def = CHILDREN[kind];
  if (!def) throw new AppError(`Unknown section ${kind}`, 'VALIDATION');
  return def;
}

function saveChild(db, actor, reportId, kind, data) {
  assertEditor(actor);
  const def = childDef(kind);
  return db.tx(() => {
    const report = loadReport(db, reportId);
    const statusOnly = kind === 'corrective' && data[def.pk] && Object.keys(data).every((k) => [def.pk, 'status'].includes(k));
    if (!statusOnly) assertEditable(report);
    const vals = {};
    for (const [k, type] of Object.entries(def.fields)) {
      const v = coerce(type, data[k], human(k));
      if (v !== undefined) vals[k] = v;
    }
    if (kind === 'pause' && vals.paused_at && vals.resumed_at && vals.resumed_at <= vals.paused_at) throw new AppError('The clock must resume after it pauses.', 'VALIDATION');
    if (vals.evidence_id) {
      const ev = db.get('SELECT report_id FROM evidence WHERE evidence_id = ?', [vals.evidence_id]);
      if (!ev || ev.report_id !== Number(reportId)) throw new AppError('Choose evidence uploaded to this report.', 'VALIDATION');
    }
    if (data[def.pk]) {
      const before = db.get(`SELECT * FROM ${def.table} WHERE ${def.pk} = ? AND report_id = ?`, [data[def.pk], reportId]);
      if (!before) throw new AppError(`${def.label} not found.`, 'NOT_FOUND');
      if (kind === 'pause' && before.approved && Object.keys(vals).some((k) => String(vals[k]) !== String(before[k]))) {
        vals.approved = 0; vals.approved_by = null; // any change needs fresh approval
      }
      if (kind === 'vendorAction' && before.bank_verified) { vals.bank_verified = 0; vals.verified_by = null; vals.verified_at = null; }
      if (kind === 'corrective' && vals.status === 'CLOSED' && !before.closed_at) vals.closed_at = nowIso();
      const cols = Object.keys(vals);
      if (db.get(`SELECT 1 FROM pragma_table_info('${def.table}') WHERE name = 'updated_at'`)) { cols.push('updated_at'); vals.updated_at = nowIso(); }
      db.run(`UPDATE ${def.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${def.pk} = ?`, [...cols.map((c) => vals[c]), data[def.pk]]);
      audit.record(db, actor, `${def.table.toUpperCase()}_UPDATED`, def.table, data[def.pk], { before, after: vals, details: { report_id: reportId } });
      return db.get(`SELECT * FROM ${def.table} WHERE ${def.pk} = ?`, [data[def.pk]]);
    }
    for (const [k, type] of Object.entries(def.fields)) {
      if (type.endsWith('!') && (vals[k] === undefined || vals[k] === null)) throw new AppError(`${human(k)} is required.`, 'VALIDATION');
    }
    if (kind === 'corrective') {
      vals.vendor_id = report.vendor_id;
      vals.service_id = report.service_id;
      vals.action_type = vals.action_type || 'CORRECTIVE';
      vals.severity = vals.severity || 'MEDIUM';
      vals.status = vals.status || 'OPEN';
    }
    vals.report_id = Number(reportId);
    vals.created_at = nowIso();
    const cols = Object.keys(vals);
    const { lastId } = db.run(`INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => vals[c]));
    audit.record(db, actor, `${def.table.toUpperCase()}_CREATED`, def.table, lastId, { after: vals, details: { report_id: reportId } });
    return db.get(`SELECT * FROM ${def.table} WHERE ${def.pk} = ?`, [lastId]);
  });
}

function deleteChild(db, actor, reportId, kind, childId) {
  assertEditor(actor);
  const def = childDef(kind);
  db.tx(() => {
    assertEditable(loadReport(db, reportId));
    const before = db.get(`SELECT * FROM ${def.table} WHERE ${def.pk} = ? AND report_id = ?`, [childId, reportId]);
    if (!before) throw new AppError(`${def.label} not found.`, 'NOT_FOUND');
    db.run(`DELETE FROM ${def.table} WHERE ${def.pk} = ?`, [childId]);
    audit.record(db, actor, `${def.table.toUpperCase()}_DELETED`, def.table, childId, { before, details: { report_id: reportId } });
  });
}

/** Bank-side approval of a clock pause (e.g. waiting on bank access). The vendor cannot approve its own pause. */
function approvePause(db, actor, reportId, pauseId, approved) {
  if (!BANK_VALIDATORS.includes(actor.role_code)) throw new AppError('Only a bank section head, service owner or technical owner can approve SLA clock pauses.', 'FORBIDDEN');
  db.tx(() => {
    assertEditable(loadReport(db, reportId));
    const p = db.get('SELECT * FROM incident_clock_pause WHERE pause_id = ? AND report_id = ?', [pauseId, reportId]);
    if (!p) throw new AppError('Clock pause not found.', 'NOT_FOUND');
    db.run('UPDATE incident_clock_pause SET approved = ?, approved_by = ?, updated_at = ? WHERE pause_id = ?', [approved ? 1 : 0, approved ? actor.user_id : null, nowIso(), pauseId]);
    audit.record(db, actor, approved ? 'CLOCK_PAUSE_APPROVED' : 'CLOCK_PAUSE_UNAPPROVED', 'incident_clock_pause', pauseId, { details: { report_id: reportId } });
  });
}

/** Bank technical owner confirms a vendor action against bank-side evidence. */
function verifyVendorAction(db, actor, reportId, actionId, verified) {
  if (!BANK_VALIDATORS.includes(actor.role_code)) throw new AppError('Only bank technical validators can verify vendor actions.', 'FORBIDDEN');
  db.tx(() => {
    assertEditable(loadReport(db, reportId));
    const a = db.get('SELECT * FROM vendor_action WHERE action_id = ? AND report_id = ?', [actionId, reportId]);
    if (!a) throw new AppError('Vendor action not found.', 'NOT_FOUND');
    db.run('UPDATE vendor_action SET bank_verified = ?, verified_by = ?, verified_at = ?, updated_at = ? WHERE action_id = ?',
      [verified ? 1 : 0, verified ? actor.user_id : null, verified ? nowIso() : null, nowIso(), actionId]);
    audit.record(db, actor, verified ? 'VENDOR_ACTION_VERIFIED' : 'VENDOR_ACTION_UNVERIFIED', 'vendor_action', actionId, { details: { report_id: reportId } });
  });
}

// ------------------------------------------------------------------ SLA
function slaInputs(db, report) {
  const slas = db.all(
    `SELECT d.*, cl.clause_ref || COALESCE(' (' || c.contract_no || ' ' || v.version_no || ')', '') AS clause_ref, m.remedy_text,
            rc.clause_ref AS remedy_clause_ref
       FROM sla_definition d
       LEFT JOIN sla_contract_mapping m ON m.sla_id = d.sla_id AND m.version_id = ?
       LEFT JOIN contract_clause cl ON cl.clause_id = m.clause_id
       LEFT JOIN contract_version v ON v.version_id = m.version_id
       LEFT JOIN contract c ON c.contract_id = v.contract_id
       LEFT JOIN contract_clause rc ON rc.clause_id = m.remedy_clause_id
      WHERE d.service_id = ?`, [report.contract_version_id || -1, report.service_id],
  ).map((s) => ({ ...s, remedy_text: [s.remedy_text, s.remedy_clause_ref && `See ${s.remedy_clause_ref}`].filter(Boolean).join(' ') || null }));
  const pauses = db.all('SELECT * FROM incident_clock_pause WHERE report_id = ?', [report.report_id]);
  const otherOutages = db.all(
    "SELECT report_no, outage_start, outage_end, restored_at, outage_type FROM incident_report WHERE service_id = ? AND report_id <> ? AND outage_start IS NOT NULL",
    [report.service_id, report.report_id],
  );
  return { slas, pauses, otherOutages, calendar: settings.get(db, 'business_calendar') };
}

function calculateSla(db, actor, id, { now = new Date() } = {}) {
  return db.tx(() => {
    const report = loadReport(db, id);
    assertEditable(report);
    const results = slaCalc.calculate({ report, ...slaInputs(db, report), now });
    db.run('DELETE FROM incident_sla_result WHERE report_id = ?', [id]);
    const at = nowIso();
    for (const r of results) {
      db.run(
        `INSERT INTO incident_sla_result (report_id, sla_id, sla_code, sla_name, metric_code, target_value, actual_value, unit, direction, outcome, variance, is_critical, clause_ref, remedy_text, calc_detail, calc_version, calculated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, r.sla_id, r.sla_code, r.sla_name, r.metric_code, r.target_value, r.actual_value, r.unit, r.direction, r.outcome, r.variance, r.is_critical, r.clause_ref, r.remedy_text, JSON.stringify(r.calc_detail), r.calc_version, at],
      );
    }
    db.run('UPDATE incident_report SET sla_calc_version = ?, sla_calculated_at = ? WHERE report_id = ?', [slaCalc.CALC_VERSION, at, id]);
    audit.record(db, actor, 'SLA_CALCULATED', 'incident_report', id, { after: results.map((r) => [r.sla_code, r.outcome, r.actual_value]), details: slaCalc.summarize(results) });
    return { results, summary: slaCalc.summarize(results) };
  });
}

// ------------------------------------------------------------------ read model
function warnings(r, children) {
  const w = [];
  const seq = [['detected_at', 'Detected'], ['reported_at', 'Reported to vendor'], ['acknowledged_at', 'Vendor acknowledged'], ['restored_at', 'Service restored'], ['resolved_at', 'Resolved']];
  let prev = null;
  for (const [k, label] of seq) {
    if (!r[k]) continue;
    if (prev && r[k] < r[prev[0]]) w.push(`${label} time is earlier than ${prev[1].toLowerCase()} time.`);
    prev = [k, label];
  }
  if (r.outage_start && r.outage_end && r.outage_end <= r.outage_start) w.push('Outage end must be after outage start.');
  if (children.pauses.some((p) => !p.approved)) w.push('Some SLA clock pauses are not approved by the bank and are ignored in the SLA calculation.');
  if (children.vendorActions.some((a) => !a.evidence_id)) w.push('Some vendor actions have no evidence attached.');
  if (r.sla_calculated_at && r.updated_at && r.updated_at > r.sla_calculated_at) w.push('The report changed after the SLA was last calculated. Recalculate before submitting.');
  return w;
}

function get(db, id) {
  const r = db.get(
    `SELECT r.*, v.legal_name AS vendor_name, v.vendor_code, v.risk_tier, s.service_code, s.service_name, s.criticality, s.service_tower,
            b.section_id, b.section_name, h.full_name AS section_head, c.contract_no, cv.version_no AS contract_version_no,
            u.full_name AS created_by_name
       FROM incident_report r JOIN vendor v ON v.vendor_id = r.vendor_id JOIN service s ON s.service_id = r.service_id
       JOIN bank_section b ON b.section_id = s.section_id LEFT JOIN app_user h ON h.user_id = b.head_user_id
       LEFT JOIN contract_version cv ON cv.version_id = r.contract_version_id LEFT JOIN contract c ON c.contract_id = cv.contract_id
       LEFT JOIN app_user u ON u.user_id = r.created_by
      WHERE r.report_id = ?`, [id],
  );
  if (!r) throw new AppError('Incident report not found.', 'NOT_FOUND');
  const children = {
    timeline: db.all('SELECT * FROM incident_timeline WHERE report_id = ? ORDER BY occurred_at, event_id', [id]),
    pauses: db.all('SELECT p.*, u.full_name AS approved_by_name FROM incident_clock_pause p LEFT JOIN app_user u ON u.user_id = p.approved_by WHERE report_id = ? ORDER BY paused_at', [id]),
    serviceState: db.all('SELECT * FROM incident_service_state WHERE report_id = ? ORDER BY state_id', [id]),
    vendorActions: db.all('SELECT a.*, u.full_name AS verified_by_name, e.original_name AS evidence_name, e.sha256 AS evidence_sha256 FROM vendor_action a LEFT JOIN app_user u ON u.user_id = a.verified_by LEFT JOIN evidence e ON e.evidence_id = a.evidence_id WHERE a.report_id = ? ORDER BY action_at, action_id', [id]),
    slaResults: db.all('SELECT * FROM incident_sla_result WHERE report_id = ? ORDER BY is_critical DESC, result_id', [id]).map((x) => ({ ...x, calc_detail: x.calc_detail ? JSON.parse(x.calc_detail) : null })),
    corrective: db.all('SELECT * FROM action_issue WHERE report_id = ? ORDER BY due_date, action_issue_id', [id]),
    evidence: db.all('SELECT e.*, u.full_name AS uploaded_by_name FROM evidence e LEFT JOIN app_user u ON u.user_id = e.uploaded_by WHERE e.report_id = ? ORDER BY evidence_id', [id]),
  };
  return { report: r, ...children, slaSummary: slaCalc.summarize(children.slaResults), warnings: warnings(r, children) };
}

/**
 * Canonical content of the report that approvers sign. Workflow fields
 * (status, timestamps of approval, lock) and corrective-action progress are
 * excluded so the hash only changes when signed content changes.
 */
function snapshot(db, id) {
  const full = get(db, id);
  const r = full.report;
  const header = {};
  for (const k of ['report_no', 'revision', 'vendor_id', 'vendor_name', 'service_id', 'service_code', 'service_name', 'contract_no', 'contract_version_no', ...Object.keys(HEADER_FIELDS)]) header[k] = r[k] ?? null;
  const strip = (rows, drop = []) => rows.map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !['created_at', 'updated_at', ...drop].includes(k))));
  return {
    header,
    timeline: strip(full.timeline),
    pauses: strip(full.pauses, ['approved_by_name']),
    serviceState: strip(full.serviceState),
    vendorActions: strip(full.vendorActions, ['verified_by_name']),
    slaResults: strip(full.slaResults, ['calculated_at']),
    corrective: strip(full.corrective, ['status', 'closed_at', 'closure_evidence_id']),
    evidence: full.evidence.map((e) => ({ evidence_id: e.evidence_id, name: e.original_name, sha256: e.sha256 })),
  };
}

const contentHash = (db, id) => hashOf(snapshot(db, id));

module.exports = {
  list, create, update, removeDraft, saveChild, deleteChild, approvePause, verifyVendorAction, calculateSla, get, snapshot, contentHash,
  loadReport, assertEditable, EDITORS, ENUMS,
};
