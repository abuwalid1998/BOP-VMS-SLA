'use strict';
/**
 * Dialect-neutral logical schema for the VMS-SLA platform.
 *
 * This file is the single source of truth. The DDL for SQLite (runtime),
 * PostgreSQL and Oracle is generated from it by ./ddl.js, so the same
 * logical model can be recreated on any approved enterprise database
 * (architecture doc section 1, "Database decision").
 *
 * Column types (logical):
 *   id      surrogate primary key (identity)
 *   ref     foreign key to another table's id
 *   str:N   short text, max N characters
 *   text    long text (CLOB)
 *   int     integer
 *   num     decimal number
 *   bool    0 / 1 flag
 *   ts      timestamp with time zone (stored as ISO-8601 UTC text in SQLite)
 *   date    calendar date (YYYY-MM-DD)
 */

const T = (name, label, columns, extra = {}) => ({ name, label, columns, indexes: [], unique: [], checks: [], ...extra });
const c = (name, type, opts = {}) => ({ name, type, ...opts });
const id = (name) => c(name, 'id');
const ref = (name, table, opts = {}) => c(name, 'ref', { references: table, ...opts });
const created = () => [c('created_at', 'ts', { notNull: true }), c('updated_at', 'ts')];

const tables = [
  // ---------------------------------------------------------------- settings
  T('app_setting', 'Application setting', [
    id('setting_id'),
    c('setting_key', 'str:100', { notNull: true }),
    c('setting_value', 'text'),
    c('updated_at', 'ts'),
  ], { unique: [['setting_key']] }),

  // ---------------------------------------------------------------- org / identity
  T('bank_section', 'Bank section', [
    id('section_id'),
    c('section_code', 'str:30', { notNull: true }),
    c('section_name', 'str:200', { notNull: true }),
    c('department', 'str:200'),
    ref('head_user_id', 'app_user'),
    c('active', 'bool', { notNull: true, default: 1 }),
    ...created(),
  ], { unique: [['section_code']] }),

  T('app_user', 'User', [
    id('user_id'),
    c('username', 'str:60', { notNull: true }),
    c('full_name', 'str:200', { notNull: true }),
    c('email', 'str:200'),
    c('job_title', 'str:200'),
    c('role_code', 'str:40', { notNull: true }),
    ref('section_id', 'bank_section'),
    c('password_hash', 'str:200', { notNull: true }),
    c('password_salt', 'str:64', { notNull: true }),
    c('public_key_pem', 'text'),
    c('private_key_enc', 'text'),
    c('key_fingerprint', 'str:80'),
    c('active', 'bool', { notNull: true, default: 1 }),
    c('must_change_password', 'bool', { notNull: true, default: 0 }),
    c('failed_attempts', 'int', { notNull: true, default: 0 }),
    c('locked_until', 'ts'),
    c('last_login_at', 'ts'),
    ...created(),
  ], {
    unique: [['username']],
    checks: [["role_code IN ('ADMIN','VM_SECTION_HEAD','VENDOR_MANAGER','IT_SECTION_HEAD','CIO','SERVICE_OWNER','TECH_OWNER','AUDITOR')"]],
  }),

  // ---------------------------------------------------------------- vendor
  T('vendor', 'Vendor', [
    id('vendor_id'),
    c('vendor_code', 'str:30', { notNull: true }),
    c('legal_name', 'str:250', { notNull: true }),
    c('legal_name_ar', 'str:250'),
    c('registration_no', 'str:80'),
    c('country', 'str:80'),
    c('status', 'str:20', { notNull: true, default: 'ACTIVE' }),
    c('risk_tier', 'str:20', { notNull: true, default: 'MEDIUM' }),
    ref('parent_vendor_id', 'vendor'),
    ref('relationship_manager_id', 'app_user'),
    c('website', 'str:250'),
    c('notes', 'text'),
    ...created(),
  ], {
    unique: [['vendor_code']],
    checks: [["risk_tier IN ('CRITICAL','HIGH','MEDIUM','LOW')"], ["status IN ('PROSPECT','ACTIVE','SUSPENDED','EXITING','EXITED')"]],
  }),

  T('vendor_contact', 'Vendor contact', [
    id('contact_id'),
    ref('vendor_id', 'vendor', { notNull: true }),
    c('full_name', 'str:200', { notNull: true }),
    c('role_title', 'str:200'),
    c('escalation_level', 'int', { notNull: true, default: 1 }),
    c('email', 'str:200'),
    c('phone', 'str:60'),
    c('is_primary', 'bool', { notNull: true, default: 0 }),
    c('is_backup', 'bool', { notNull: true, default: 0 }),
    c('active', 'bool', { notNull: true, default: 1 }),
    ...created(),
  ], { indexes: [['vendor_id']] }),

  T('risk_assessment', 'Risk assessment', [
    id('assessment_id'),
    ref('vendor_id', 'vendor', { notNull: true }),
    ref('service_id', 'service'),
    c('risk_domain', 'str:60', { notNull: true }),
    c('rating', 'str:20', { notNull: true }),
    c('finding', 'text'),
    c('treatment', 'text'),
    c('assessed_on', 'date'),
    c('due_date', 'date'),
    ...created(),
  ], { indexes: [['vendor_id']] }),

  // ---------------------------------------------------------------- service
  T('service', 'Service', [
    id('service_id'),
    c('service_code', 'str:40', { notNull: true }),
    c('service_name', 'str:250', { notNull: true }),
    c('service_tower', 'str:60', { notNull: true }),
    c('criticality', 'str:20', { notNull: true, default: 'MEDIUM' }),
    c('data_classification', 'str:40'),
    ref('section_id', 'bank_section', { notNull: true }),
    ref('service_owner_id', 'app_user'),
    ref('technical_owner_id', 'app_user'),
    c('description', 'text'),
    ...created(),
  ], {
    unique: [['service_code']],
    checks: [["criticality IN ('CRITICAL','HIGH','MEDIUM','LOW')"]],
  }),

  // ---------------------------------------------------------------- contract
  T('contract', 'Contract', [
    id('contract_id'),
    ref('vendor_id', 'vendor', { notNull: true }),
    c('contract_no', 'str:60', { notNull: true }),
    c('title', 'str:300', { notNull: true }),
    c('start_date', 'date', { notNull: true }),
    c('end_date', 'date'),
    c('notice_period_days', 'int'),
    c('contract_value', 'num'),
    c('currency', 'str:3'),
    c('status', 'str:20', { notNull: true, default: 'ACTIVE' }),
    c('repository_ref', 'str:300'),
    ref('owner_user_id', 'app_user'),
    ...created(),
  ], { unique: [['contract_no']], indexes: [['vendor_id']] }),

  T('contract_version', 'Contract version', [
    id('version_id'),
    ref('contract_id', 'contract', { notNull: true }),
    c('version_no', 'str:20', { notNull: true }),
    c('effective_from', 'date', { notNull: true }),
    c('effective_to', 'date'),
    c('approval_ref', 'str:120'),
    c('file_hash', 'str:80'),
    c('status', 'str:20', { notNull: true, default: 'APPROVED' }),
    ...created(),
  ], { unique: [['contract_id', 'version_no']] }),

  T('contract_clause', 'Contract clause', [
    id('clause_id'),
    ref('version_id', 'contract_version', { notNull: true }),
    c('clause_ref', 'str:60', { notNull: true }),
    c('title', 'str:250'),
    c('clause_type', 'str:40', { notNull: true }),
    c('clause_text', 'text'),
    c('page_no', 'int'),
    ...created(),
  ], { unique: [['version_id', 'clause_ref']] }),

  T('vendor_service', 'Vendor service', [
    id('vendor_service_id'),
    ref('vendor_id', 'vendor', { notNull: true }),
    ref('service_id', 'service', { notNull: true }),
    ref('contract_id', 'contract'),
    c('scope', 'text'),
    c('start_date', 'date'),
    c('end_date', 'date'),
    c('status', 'str:20', { notNull: true, default: 'ACTIVE' }),
    ...created(),
  ], { unique: [['vendor_id', 'service_id']] }),

  T('support_window', 'Support window', [
    id('support_window_id'),
    ref('vendor_service_id', 'vendor_service', { notNull: true }),
    c('label', 'str:120', { notNull: true }),
    c('applies_to', 'str:60'),
    c('days_of_week', 'str:60', { notNull: true }),
    c('start_time', 'str:5', { notNull: true }),
    c('end_time', 'str:5', { notNull: true }),
    c('timezone', 'str:60', { notNull: true, default: 'Asia/Hebron' }),
    c('channels', 'str:250'),
    ref('clause_id', 'contract_clause'),
    c('notes', 'text'),
    ...created(),
  ], { indexes: [['vendor_service_id']] }),

  // ---------------------------------------------------------------- SLA
  T('sla_definition', 'SLA definition', [
    id('sla_id'),
    c('sla_code', 'str:60', { notNull: true }),
    ref('service_id', 'service', { notNull: true }),
    ref('vendor_id', 'vendor'),
    c('name', 'str:250', { notNull: true }),
    c('metric_code', 'str:40', { notNull: true }),
    c('priority', 'str:4'),
    c('direction', 'str:20', { notNull: true }),
    c('target_value', 'num', { notNull: true }),
    c('warning_value', 'num'),
    c('unit', 'str:20', { notNull: true }),
    c('measurement_window', 'str:60', { notNull: true }),
    c('support_window_code', 'str:20', { notNull: true, default: '24x7' }),
    c('exclusions', 'text'),
    c('evidence_source', 'str:200'),
    c('is_critical', 'bool', { notNull: true, default: 0 }),
    c('weight', 'num'),
    c('formula_version', 'str:20', { notNull: true, default: 'v1' }),
    c('effective_from', 'date', { notNull: true }),
    c('effective_to', 'date'),
    c('approval_status', 'str:20', { notNull: true, default: 'APPROVED' }),
    ...created(),
  ], {
    unique: [['sla_code']],
    indexes: [['service_id']],
    checks: [
      ["direction IN ('higher_is_better','lower_is_better')"],
      ["metric_code IN ('AVAILABILITY','INCIDENT_RESPONSE','INCIDENT_RESTORATION','INCIDENT_RESOLUTION','RCA_DELIVERY','BACKUP_SUCCESS','CHANGE_SUCCESS','PATCH_COMPLIANCE','REQUEST_FULFILMENT','OTHER')"],
    ],
  }),

  T('sla_contract_mapping', 'SLA to contract clause', [
    id('mapping_id'),
    ref('version_id', 'contract_version', { notNull: true }),
    ref('sla_id', 'sla_definition', { notNull: true }),
    ref('clause_id', 'contract_clause', { notNull: true }),
    c('contractual_target', 'str:120'),
    ref('remedy_clause_id', 'contract_clause'),
    c('remedy_text', 'text'),
    ...created(),
  ], { unique: [['version_id', 'sla_id']] }),

  T('contract_obligation', 'Contract obligation', [
    id('obligation_id'),
    ref('version_id', 'contract_version', { notNull: true }),
    ref('vendor_service_id', 'vendor_service'),
    ref('clause_id', 'contract_clause'),
    c('category', 'str:40', { notNull: true }),
    c('description', 'text', { notNull: true }),
    c('bank_owner_role', 'str:120'),
    c('vendor_owner_role', 'str:120'),
    c('frequency', 'str:60'),
    ...created(),
  ], { indexes: [['vendor_service_id']] }),

  T('responsibility', 'Responsibility (RACI)', [
    id('responsibility_id'),
    ref('vendor_service_id', 'vendor_service', { notNull: true }),
    c('activity', 'str:250', { notNull: true }),
    c('bank_party', 'str:200'),
    c('bank_raci', 'str:4'),
    c('vendor_party', 'str:200'),
    c('vendor_raci', 'str:4'),
    ref('clause_id', 'contract_clause'),
    ...created(),
  ], { indexes: [['vendor_service_id']] }),

  T('sla_measurement', 'Monthly SLA measurement', [
    id('measurement_id'),
    ref('sla_id', 'sla_definition', { notNull: true }),
    c('period', 'str:7', { notNull: true }),
    c('actual_value', 'num'),
    c('result', 'str:20'),
    c('score', 'num'),
    c('source_ref', 'str:250'),
    c('calc_version', 'str:20'),
    ...created(),
  ], { unique: [['sla_id', 'period']] }),

  // ---------------------------------------------------------------- evidence
  T('evidence', 'Evidence', [
    id('evidence_id'),
    c('object_ref', 'str:400', { notNull: true }),
    c('original_name', 'str:300', { notNull: true }),
    c('mime_type', 'str:120'),
    c('size_bytes', 'int'),
    c('sha256', 'str:64', { notNull: true }),
    c('source', 'str:120'),
    c('captured_at', 'ts'),
    c('classification', 'str:40', { default: 'INTERNAL' }),
    c('description', 'text'),
    ref('report_id', 'incident_report'),
    c('related_type', 'str:40'),
    c('related_id', 'int'),
    ref('uploaded_by', 'app_user', { notNull: true }),
    c('uploaded_at', 'ts', { notNull: true }),
  ], { indexes: [['report_id'], ['related_type', 'related_id']] }),

  // ---------------------------------------------------------------- incident report
  T('incident_report', 'Vendor incident report', [
    id('report_id'),
    c('report_no', 'str:40', { notNull: true }),
    ref('vendor_id', 'vendor', { notNull: true }),
    ref('service_id', 'service', { notNull: true }),
    ref('vendor_service_id', 'vendor_service'),
    ref('contract_version_id', 'contract_version'),
    c('title', 'str:300', { notNull: true }),
    c('priority', 'str:4', { notNull: true }),
    c('status', 'str:20', { notNull: true, default: 'DRAFT' }),
    c('revision', 'int', { notNull: true, default: 1 }),
    c('impact_summary', 'text'),
    c('business_impact', 'text'),
    c('customers_affected', 'int'),
    c('channels_affected', 'str:300'),
    c('financial_impact', 'num'),
    c('outage_type', 'str:20', { default: 'FULL' }),
    c('detected_at', 'ts'),
    c('reported_at', 'ts'),
    c('acknowledged_at', 'ts'),
    c('workaround_at', 'ts'),
    c('restored_at', 'ts'),
    c('resolved_at', 'ts'),
    c('outage_start', 'ts'),
    c('outage_end', 'ts'),
    c('itsm_ref', 'str:60'),
    c('vendor_ticket_ref', 'str:60'),
    c('root_cause_category', 'str:60'),
    c('root_cause', 'text'),
    c('contributing_factors', 'text'),
    c('rca_due_at', 'ts'),
    c('rca_received_at', 'ts'),
    c('rca_accepted', 'bool', { notNull: true, default: 0 }),
    c('sla_calc_version', 'str:20'),
    c('sla_calculated_at', 'ts'),
    c('content_hash', 'str:64'),
    ref('created_by', 'app_user', { notNull: true }),
    c('submitted_at', 'ts'),
    c('approved_at', 'ts'),
    c('locked_at', 'ts'),
    ...created(),
  ], {
    unique: [['report_no']],
    indexes: [['vendor_id'], ['service_id'], ['status']],
    checks: [
      ["priority IN ('P1','P2','P3','P4')"],
      ["status IN ('DRAFT','IN_APPROVAL','RETURNED','APPROVED','LOCKED')"],
      ["outage_type IN ('FULL','PARTIAL','DEGRADED','NONE')"],
    ],
    lockGuard: 'self',
  }),

  T('incident_timeline', 'Incident timeline event', [
    id('event_id'),
    ref('report_id', 'incident_report', { notNull: true }),
    c('occurred_at', 'ts', { notNull: true }),
    c('event_type', 'str:40', { notNull: true }),
    c('actor_party', 'str:10', { notNull: true }),
    c('actor_name', 'str:200'),
    c('description', 'text', { notNull: true }),
    c('source', 'str:120'),
    ...created(),
  ], { indexes: [['report_id']], lockGuard: 'child' }),

  T('incident_clock_pause', 'SLA clock pause', [
    id('pause_id'),
    ref('report_id', 'incident_report', { notNull: true }),
    c('paused_at', 'ts', { notNull: true }),
    c('resumed_at', 'ts', { notNull: true }),
    c('reason', 'text', { notNull: true }),
    c('approved', 'bool', { notNull: true, default: 0 }),
    ref('approved_by', 'app_user'),
    ...created(),
  ], { indexes: [['report_id']], lockGuard: 'child' }),

  T('incident_service_state', 'Service state before/after', [
    id('state_id'),
    ref('report_id', 'incident_report', { notNull: true }),
    c('component', 'str:200', { notNull: true }),
    c('indicator', 'str:200', { notNull: true }),
    c('unit', 'str:30'),
    c('before_value', 'str:120'),
    c('during_value', 'str:120'),
    c('after_value', 'str:120'),
    c('before_status', 'str:20'),
    c('after_status', 'str:20'),
    ref('evidence_id', 'evidence'),
    c('notes', 'text'),
    ...created(),
  ], { indexes: [['report_id']], lockGuard: 'child' }),

  T('vendor_action', 'Vendor action', [
    id('action_id'),
    ref('report_id', 'incident_report', { notNull: true }),
    c('action_at', 'ts', { notNull: true }),
    c('vendor_actor', 'str:200'),
    c('action_type', 'str:40', { notNull: true }),
    c('description', 'text', { notNull: true }),
    c('outcome', 'text'),
    ref('evidence_id', 'evidence'),
    c('bank_verified', 'bool', { notNull: true, default: 0 }),
    ref('verified_by', 'app_user'),
    c('verified_at', 'ts'),
    ...created(),
  ], { indexes: [['report_id']], lockGuard: 'child' }),

  T('incident_sla_result', 'Incident SLA result', [
    id('result_id'),
    ref('report_id', 'incident_report', { notNull: true }),
    ref('sla_id', 'sla_definition'),
    c('sla_code', 'str:60'),
    c('sla_name', 'str:250'),
    c('metric_code', 'str:40', { notNull: true }),
    c('target_value', 'num'),
    c('actual_value', 'num'),
    c('unit', 'str:20'),
    c('direction', 'str:20'),
    c('outcome', 'str:20', { notNull: true }),
    c('variance', 'num'),
    c('is_critical', 'bool', { notNull: true, default: 0 }),
    c('clause_ref', 'str:120'),
    c('remedy_text', 'text'),
    c('calc_detail', 'text'),
    c('calc_version', 'str:20', { notNull: true }),
    c('calculated_at', 'ts', { notNull: true }),
  ], {
    indexes: [['report_id']],
    lockGuard: 'child',
    checks: [["outcome IN ('MET','BREACHED','AT_RISK','NOT_MEASURABLE')"]],
  }),

  T('action_issue', 'Corrective action', [
    id('action_issue_id'),
    ref('vendor_id', 'vendor', { notNull: true }),
    ref('service_id', 'service'),
    ref('report_id', 'incident_report'),
    c('source_finding', 'str:250'),
    c('description', 'text', { notNull: true }),
    c('action_type', 'str:20', { notNull: true, default: 'CORRECTIVE' }),
    c('severity', 'str:20', { notNull: true, default: 'MEDIUM' }),
    c('owner_party', 'str:10', { notNull: true }),
    c('owner_name', 'str:200'),
    c('due_date', 'date'),
    c('status', 'str:20', { notNull: true, default: 'OPEN' }),
    ref('closure_evidence_id', 'evidence'),
    c('closed_at', 'ts'),
    ...created(),
  ], { indexes: [['report_id'], ['vendor_id']] }),

  // ---------------------------------------------------------------- approval / signature
  T('approval_policy', 'Approval policy step', [
    id('policy_id'),
    c('priority', 'str:4', { notNull: true }),
    c('step_no', 'int', { notNull: true }),
    c('role_code', 'str:40', { notNull: true }),
    c('step_label', 'str:200', { notNull: true }),
    c('responsibility', 'str:250'),
    c('required_when', 'str:20', { notNull: true, default: 'ALWAYS' }),
    c('active', 'bool', { notNull: true, default: 1 }),
    ...created(),
  ], {
    unique: [['priority', 'step_no']],
    checks: [["required_when IN ('ALWAYS','CRITICAL_BREACH','ANY_BREACH')"]],
  }),

  T('approval_step', 'Approval step', [
    id('step_id'),
    ref('report_id', 'incident_report', { notNull: true }),
    c('revision', 'int', { notNull: true }),
    c('step_no', 'int', { notNull: true }),
    c('role_code', 'str:40', { notNull: true }),
    c('step_label', 'str:200', { notNull: true }),
    c('responsibility', 'str:250'),
    ref('required_user_id', 'app_user'),
    c('status', 'str:20', { notNull: true, default: 'PENDING' }),
    ref('decided_by', 'app_user'),
    c('decided_at', 'ts'),
    c('decision_comment', 'text'),
    ...created(),
  ], {
    unique: [['report_id', 'revision', 'step_no']],
    checks: [["status IN ('WAITING','PENDING','APPROVED','REJECTED','SUPERSEDED')"]],
  }),

  T('e_signature', 'Electronic signature', [
    id('signature_id'),
    ref('report_id', 'incident_report', { notNull: true }),
    ref('step_id', 'approval_step', { notNull: true }),
    c('revision', 'int', { notNull: true }),
    ref('signer_user_id', 'app_user', { notNull: true }),
    c('signer_name', 'str:200', { notNull: true }),
    c('signer_title', 'str:200'),
    c('role_code', 'str:40', { notNull: true }),
    c('decision', 'str:20', { notNull: true }),
    c('reason', 'text'),
    c('signed_at', 'ts', { notNull: true }),
    c('auth_method', 'str:60', { notNull: true }),
    c('content_hash', 'str:64', { notNull: true }),
    c('prev_signature_hash', 'str:64'),
    c('payload_json', 'text', { notNull: true }),
    c('signature_b64', 'text', { notNull: true }),
    c('public_key_pem', 'text', { notNull: true }),
    c('key_fingerprint', 'str:80', { notNull: true }),
    c('signature_hash', 'str:64', { notNull: true }),
  ], {
    indexes: [['report_id']],
    appendOnly: true,
    checks: [["decision IN ('APPROVED','REJECTED')"]],
  }),

  T('report_document', 'Report document', [
    id('document_id'),
    ref('report_id', 'incident_report'),
    c('doc_type', 'str:30', { notNull: true }),
    c('revision', 'int'),
    c('title', 'str:300', { notNull: true }),
    c('file_ref', 'str:400', { notNull: true }),
    c('sha256', 'str:64', { notNull: true }),
    c('size_bytes', 'int'),
    c('is_locked', 'bool', { notNull: true, default: 0 }),
    c('encrypted', 'bool', { notNull: true, default: 0 }),
    ref('generated_by', 'app_user', { notNull: true }),
    c('generated_at', 'ts', { notNull: true }),
  ], { indexes: [['report_id']], appendOnly: true }),

  T('audit_event', 'Audit event', [
    id('event_id'),
    c('occurred_at', 'ts', { notNull: true }),
    ref('actor_user_id', 'app_user'),
    c('actor_name', 'str:200'),
    c('action', 'str:60', { notNull: true }),
    c('object_type', 'str:60', { notNull: true }),
    c('object_id', 'str:60'),
    c('before_hash', 'str:64'),
    c('after_hash', 'str:64'),
    c('details', 'text'),
    c('prev_event_hash', 'str:64'),
    c('event_hash', 'str:64', { notNull: true }),
  ], { indexes: [['object_type', 'object_id'], ['occurred_at']], appendOnly: true }),
];

const byName = Object.fromEntries(tables.map((t) => [t.name, t]));

/** Tables ordered so that every referenced table precedes its referrers (self/cyclic refs ignored). */
function dependencyOrder() {
  const out = [];
  const seen = new Set();
  const visiting = new Set();
  const visit = (t) => {
    if (seen.has(t.name)) return;
    if (visiting.has(t.name)) return; // cycle (bank_section <-> app_user): resolved by nullable FK
    visiting.add(t.name);
    for (const col of t.columns) {
      if (col.type === 'ref' && col.references !== t.name) visit(byName[col.references]);
    }
    visiting.delete(t.name);
    seen.add(t.name);
    out.push(t);
  };
  tables.forEach(visit);
  return out;
}

module.exports = { tables, byName, dependencyOrder, SCHEMA_VERSION: 1 };
