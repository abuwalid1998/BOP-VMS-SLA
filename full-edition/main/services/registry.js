'use strict';
/**
 * Master-data registry: vendors, services, contracts, clauses, SLA catalogue,
 * obligations, responsibilities. One metadata-driven CRUD engine serves all of
 * them, so every write goes through the same validation, role check and
 * audit trail. Only columns declared here can be written (whitelist).
 */
const { AppError, nowIso } = require('./util');
const audit = require('./audit');
const { byName } = require('../db/schema');

const MASTER = ['ADMIN', 'VM_SECTION_HEAD', 'VENDOR_MANAGER'];
const ACTION_WRITERS = [...MASTER, 'IT_SECTION_HEAD', 'SERVICE_OWNER', 'TECH_OWNER'];

const opt = (...vals) => vals.map((v) => (Array.isArray(v) ? { value: v[0], label: v[1] } : { value: v, label: v }));
const TIERS = opt('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
const TOWERS = opt('Infrastructure & Data Centre', 'Network & Telecom', 'Core Banking / Applications', 'Database', 'Cybersecurity', 'Service Desk / End User', 'Software / Managed Services', 'ATM / Branch Technology');
const CLAUSE_TYPES = opt('SLA', 'SUPPORT', 'AVAILABILITY', 'INCIDENT', 'ESCALATION', 'SECURITY', 'AUDIT', 'PRIVACY', 'BCP', 'REMEDY', 'SERVICE_CREDIT', 'SUBCONTRACTING', 'CHANGE', 'TERMINATION', 'EXIT', 'RESPONSIBILITY', 'GENERAL');
const PRIORITIES = opt(['', 'All priorities'], 'P1', 'P2', 'P3', 'P4');

/** Label sub-queries used to show human names for foreign keys. {id} is replaced by the FK column expression. */
const LABEL_SQL = {
  app_user: 'SELECT x.full_name FROM app_user x WHERE x.user_id = {id}',
  bank_section: 'SELECT x.section_name FROM bank_section x WHERE x.section_id = {id}',
  vendor: 'SELECT x.legal_name FROM vendor x WHERE x.vendor_id = {id}',
  service: "SELECT x.service_code || ' - ' || x.service_name FROM service x WHERE x.service_id = {id}",
  contract: "SELECT x.contract_no || ' - ' || x.title FROM contract x WHERE x.contract_id = {id}",
  contract_version: "SELECT c.contract_no || ' ' || x.version_no FROM contract_version x JOIN contract c ON c.contract_id = x.contract_id WHERE x.version_id = {id}",
  contract_clause: "SELECT c.contract_no || ' ' || x.clause_ref || COALESCE(' - ' || x.title, '') FROM contract_clause x JOIN contract_version v ON v.version_id = x.version_id JOIN contract c ON c.contract_id = v.contract_id WHERE x.clause_id = {id}",
  vendor_service: "SELECT v.legal_name || ' / ' || s.service_name FROM vendor_service x JOIN vendor v ON v.vendor_id = x.vendor_id JOIN service s ON s.service_id = x.service_id WHERE x.vendor_service_id = {id}",
  sla_definition: "SELECT x.sla_code || ' - ' || x.name FROM sla_definition x WHERE x.sla_id = {id}",
  incident_report: 'SELECT x.report_no FROM incident_report x WHERE x.report_id = {id}',
  evidence: 'SELECT x.original_name FROM evidence x WHERE x.evidence_id = {id}',
};

const ENTITIES = {
  bank_section: {
    label: 'Bank section', plural: 'Bank sections', order: 'section_name',
    list: ['section_code', 'section_name', 'department', 'head_user_id', 'active'],
    fields: [
      { name: 'section_code', label: 'Code', required: true },
      { name: 'section_name', label: 'Section name', required: true },
      { name: 'department', label: 'Department' },
      { name: 'head_user_id', label: 'Section head', type: 'ref', ref: 'app_user', help: 'Signs incident reports as technical validator for services in this section.' },
      { name: 'active', label: 'Active', type: 'bool', default: 1 },
    ],
  },
  vendor: {
    label: 'Vendor', plural: 'Vendors', order: 'legal_name',
    list: ['vendor_code', 'legal_name', 'risk_tier', 'status', 'country', 'relationship_manager_id'],
    fields: [
      { name: 'vendor_code', label: 'Vendor code', required: true },
      { name: 'legal_name', label: 'Legal name', required: true },
      { name: 'legal_name_ar', label: 'Legal name (Arabic)', dir: 'rtl' },
      { name: 'registration_no', label: 'Registration no.' },
      { name: 'country', label: 'Country' },
      { name: 'status', label: 'Status', type: 'select', options: opt('PROSPECT', 'ACTIVE', 'SUSPENDED', 'EXITING', 'EXITED'), required: true, default: 'ACTIVE' },
      { name: 'risk_tier', label: 'Risk tier', type: 'select', options: TIERS, required: true, default: 'MEDIUM' },
      { name: 'parent_vendor_id', label: 'Parent vendor', type: 'ref', ref: 'vendor' },
      { name: 'relationship_manager_id', label: 'Relationship manager', type: 'ref', ref: 'app_user' },
      { name: 'website', label: 'Website' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  vendor_contact: {
    label: 'Vendor contact', plural: 'Vendor contacts', order: 'escalation_level, full_name', parent: 'vendor_id',
    list: ['vendor_id', 'full_name', 'role_title', 'escalation_level', 'email', 'phone', 'is_primary'],
    fields: [
      { name: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendor', required: true },
      { name: 'full_name', label: 'Full name', required: true },
      { name: 'role_title', label: 'Role / title' },
      { name: 'escalation_level', label: 'Escalation level', type: 'select', options: opt(['1', '1 - Operational'], ['2', '2 - Service management'], ['3', '3 - Relationship'], ['4', '4 - Executive']), required: true, default: '1' },
      { name: 'email', label: 'Email' },
      { name: 'phone', label: 'Phone' },
      { name: 'is_primary', label: 'Primary contact', type: 'bool', default: 0 },
      { name: 'is_backup', label: 'Backup contact', type: 'bool', default: 0 },
      { name: 'active', label: 'Active', type: 'bool', default: 1 },
    ],
  },
  service: {
    label: 'Service', plural: 'Services', order: 'service_code',
    list: ['service_code', 'service_name', 'service_tower', 'criticality', 'section_id', 'service_owner_id'],
    fields: [
      { name: 'service_code', label: 'Service code', required: true },
      { name: 'service_name', label: 'Service name', required: true },
      { name: 'service_tower', label: 'Service tower', type: 'select', options: TOWERS, required: true },
      { name: 'criticality', label: 'Criticality', type: 'select', options: TIERS, required: true, default: 'MEDIUM' },
      { name: 'data_classification', label: 'Data classification', type: 'select', options: opt('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED') },
      { name: 'section_id', label: 'Responsible IT section', type: 'ref', ref: 'bank_section', required: true },
      { name: 'service_owner_id', label: 'Service owner', type: 'ref', ref: 'app_user' },
      { name: 'technical_owner_id', label: 'Technical owner', type: 'ref', ref: 'app_user' },
      { name: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  contract: {
    label: 'Contract', plural: 'Contracts', order: 'contract_no',
    list: ['contract_no', 'title', 'vendor_id', 'start_date', 'end_date', 'status'],
    fields: [
      { name: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendor', required: true },
      { name: 'contract_no', label: 'Contract no.', required: true },
      { name: 'title', label: 'Title', required: true },
      { name: 'start_date', label: 'Start date', type: 'date', required: true },
      { name: 'end_date', label: 'End date', type: 'date' },
      { name: 'notice_period_days', label: 'Notice period (days)', type: 'number' },
      { name: 'contract_value', label: 'Contract value', type: 'number' },
      { name: 'currency', label: 'Currency', type: 'select', options: opt('USD', 'ILS', 'JOD', 'EUR') },
      { name: 'status', label: 'Status', type: 'select', options: opt('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED'), required: true, default: 'ACTIVE' },
      { name: 'repository_ref', label: 'DMS reference' },
      { name: 'owner_user_id', label: 'Contract owner', type: 'ref', ref: 'app_user' },
    ],
  },
  contract_version: {
    label: 'Contract version', plural: 'Contract versions', order: 'contract_id, version_no', parent: 'contract_id',
    list: ['contract_id', 'version_no', 'effective_from', 'effective_to', 'status', 'approval_ref'],
    fields: [
      { name: 'contract_id', label: 'Contract', type: 'ref', ref: 'contract', required: true },
      { name: 'version_no', label: 'Version', required: true },
      { name: 'effective_from', label: 'Effective from', type: 'date', required: true },
      { name: 'effective_to', label: 'Effective to', type: 'date' },
      { name: 'approval_ref', label: 'Approval reference' },
      { name: 'file_hash', label: 'Signed file SHA-256' },
      { name: 'status', label: 'Status', type: 'select', options: opt('DRAFT', 'APPROVED', 'SUPERSEDED'), required: true, default: 'APPROVED' },
    ],
  },
  contract_clause: {
    label: 'Contract clause', plural: 'Contract clauses', order: 'version_id, clause_ref', parent: 'version_id',
    list: ['version_id', 'clause_ref', 'title', 'clause_type', 'page_no'],
    fields: [
      { name: 'version_id', label: 'Contract version', type: 'ref', ref: 'contract_version', required: true },
      { name: 'clause_ref', label: 'Clause reference', required: true, help: 'For example "Schedule B, 5.1".' },
      { name: 'title', label: 'Title' },
      { name: 'clause_type', label: 'Clause type', type: 'select', options: CLAUSE_TYPES, required: true },
      { name: 'clause_text', label: 'Clause text', type: 'textarea' },
      { name: 'page_no', label: 'Page', type: 'number' },
    ],
  },
  vendor_service: {
    label: 'Vendor service', plural: 'Vendor services', order: 'vendor_id', parent: 'vendor_id',
    list: ['vendor_id', 'service_id', 'contract_id', 'start_date', 'end_date', 'status'],
    fields: [
      { name: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendor', required: true },
      { name: 'service_id', label: 'Service', type: 'ref', ref: 'service', required: true },
      { name: 'contract_id', label: 'Governing contract', type: 'ref', ref: 'contract' },
      { name: 'scope', label: 'Scope', type: 'textarea' },
      { name: 'start_date', label: 'Start date', type: 'date' },
      { name: 'end_date', label: 'End date', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: opt('ACTIVE', 'TRANSITION', 'ENDED'), required: true, default: 'ACTIVE' },
    ],
  },
  support_window: {
    label: 'Support window', plural: 'Support hours', order: 'vendor_service_id, label', parent: 'vendor_service_id',
    list: ['vendor_service_id', 'label', 'applies_to', 'days_of_week', 'start_time', 'end_time', 'clause_id'],
    fields: [
      { name: 'vendor_service_id', label: 'Vendor service', type: 'ref', ref: 'vendor_service', required: true },
      { name: 'label', label: 'Label', required: true, help: 'For example "Critical support".' },
      { name: 'applies_to', label: 'Applies to', help: 'For example "P1, P2".' },
      { name: 'days_of_week', label: 'Days', required: true, help: 'For example "Sun-Thu" or "Mon-Sun".' },
      { name: 'start_time', label: 'From', type: 'time', required: true },
      { name: 'end_time', label: 'To', type: 'time', required: true, help: 'Use 00:00 to 23:59 for round-the-clock cover.' },
      { name: 'timezone', label: 'Time zone', default: 'Asia/Hebron', required: true },
      { name: 'channels', label: 'Channels', help: 'Phone, portal, email...' },
      { name: 'clause_id', label: 'Contract clause', type: 'ref', ref: 'contract_clause' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  sla_definition: {
    label: 'SLA definition', plural: 'SLA catalogue', order: 'sla_code',
    list: ['sla_code', 'name', 'service_id', 'priority', 'target_value', 'unit', 'support_window_code', 'is_critical'],
    fields: [
      { name: 'sla_code', label: 'SLA ID', required: true, help: 'For example SLA-CORE-AVAIL-001.' },
      { name: 'name', label: 'Name', required: true },
      { name: 'service_id', label: 'Service', type: 'ref', ref: 'service', required: true },
      { name: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendor', help: 'Leave empty if the SLA applies to any provider of the service.' },
      { name: 'metric_code', label: 'Metric', type: 'select', required: true,
        options: opt(['AVAILABILITY', 'Availability (%)'], ['INCIDENT_RESPONSE', 'Incident response time'], ['INCIDENT_RESTORATION', 'Service restoration time'], ['INCIDENT_RESOLUTION', 'Incident resolution time'], ['RCA_DELIVERY', 'RCA delivery'], ['BACKUP_SUCCESS', 'Backup success'], ['CHANGE_SUCCESS', 'Change success'], ['PATCH_COMPLIANCE', 'Patch compliance'], ['REQUEST_FULFILMENT', 'Request fulfilment'], ['OTHER', 'Other']) },
      { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES },
      { name: 'direction', label: 'Direction', type: 'select', required: true, options: opt(['lower_is_better', 'Lower is better'], ['higher_is_better', 'Higher is better']), default: 'lower_is_better' },
      { name: 'target_value', label: 'Target', type: 'number', required: true },
      { name: 'warning_value', label: 'Warning threshold', type: 'number' },
      { name: 'unit', label: 'Unit', type: 'select', required: true, options: opt('minutes', 'hours', 'days', 'percent', 'count') },
      { name: 'measurement_window', label: 'Measurement window', type: 'select', required: true, options: opt(['per_incident', 'Per eligible incident'], ['calendar_month', 'Calendar month'], ['rolling_30_days', 'Rolling 30 days'], ['quarter', 'Quarter']) },
      { name: 'support_window_code', label: 'Clock', type: 'select', required: true, options: opt(['24x7', '24x7'], ['business_hours', 'Business hours']), default: '24x7' },
      { name: 'exclusions', label: 'Exclusions', type: 'textarea' },
      { name: 'evidence_source', label: 'Evidence source' },
      { name: 'is_critical', label: 'Critical SLA (override)', type: 'bool', default: 0, help: 'A breach of a critical SLA is flagged regardless of the aggregate score and can require CIO approval.' },
      { name: 'weight', label: 'Scorecard weight (%)', type: 'number' },
      { name: 'formula_version', label: 'Formula version', default: 'v1', required: true },
      { name: 'effective_from', label: 'Effective from', type: 'date', required: true },
      { name: 'effective_to', label: 'Effective to', type: 'date' },
      { name: 'approval_status', label: 'Approval status', type: 'select', required: true, options: opt('DRAFT', 'APPROVED', 'RETIRED'), default: 'DRAFT' },
    ],
  },
  sla_contract_mapping: {
    label: 'SLA clause mapping', plural: 'SLA clause mappings', order: 'version_id', parent: 'sla_id',
    list: ['sla_id', 'version_id', 'clause_id', 'contractual_target', 'remedy_clause_id'],
    fields: [
      { name: 'sla_id', label: 'SLA', type: 'ref', ref: 'sla_definition', required: true },
      { name: 'version_id', label: 'Contract version', type: 'ref', ref: 'contract_version', required: true },
      { name: 'clause_id', label: 'Commitment clause', type: 'ref', ref: 'contract_clause', required: true },
      { name: 'contractual_target', label: 'Contractual wording of target' },
      { name: 'remedy_clause_id', label: 'Remedy / service-credit clause', type: 'ref', ref: 'contract_clause' },
      { name: 'remedy_text', label: 'Remedy summary', type: 'textarea' },
    ],
  },
  contract_obligation: {
    label: 'Contract obligation', plural: 'Contract obligations', order: 'category', parent: 'vendor_service_id',
    list: ['vendor_service_id', 'category', 'description', 'clause_id', 'frequency'],
    fields: [
      { name: 'version_id', label: 'Contract version', type: 'ref', ref: 'contract_version', required: true },
      { name: 'vendor_service_id', label: 'Vendor service', type: 'ref', ref: 'vendor_service' },
      { name: 'clause_id', label: 'Contract clause', type: 'ref', ref: 'contract_clause' },
      { name: 'category', label: 'Category', type: 'select', required: true, options: opt('REPORTING', 'SECURITY', 'BCP', 'AUDIT', 'PRIVACY', 'STAFFING', 'CHANGE', 'EXIT', 'OTHER') },
      { name: 'description', label: 'Obligation', type: 'textarea', required: true },
      { name: 'bank_owner_role', label: 'Bank owner' },
      { name: 'vendor_owner_role', label: 'Vendor owner' },
      { name: 'frequency', label: 'Frequency' },
    ],
  },
  responsibility: {
    label: 'Responsibility', plural: 'Responsibilities (RACI)', order: 'activity', parent: 'vendor_service_id',
    list: ['vendor_service_id', 'activity', 'bank_party', 'bank_raci', 'vendor_party', 'vendor_raci', 'clause_id'],
    fields: [
      { name: 'vendor_service_id', label: 'Vendor service', type: 'ref', ref: 'vendor_service', required: true },
      { name: 'activity', label: 'Activity', required: true },
      { name: 'bank_party', label: 'Bank party' },
      { name: 'bank_raci', label: 'Bank RACI', type: 'select', options: opt('', 'R', 'A', 'A/R', 'C', 'I') },
      { name: 'vendor_party', label: 'Vendor party' },
      { name: 'vendor_raci', label: 'Vendor RACI', type: 'select', options: opt('', 'R', 'A', 'A/R', 'C', 'I') },
      { name: 'clause_id', label: 'Contract clause', type: 'ref', ref: 'contract_clause' },
    ],
  },
  risk_assessment: {
    label: 'Risk assessment', plural: 'Risk assessments', order: 'assessed_on DESC', parent: 'vendor_id',
    list: ['vendor_id', 'service_id', 'risk_domain', 'rating', 'assessed_on', 'due_date'],
    fields: [
      { name: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendor', required: true },
      { name: 'service_id', label: 'Service', type: 'ref', ref: 'service' },
      { name: 'risk_domain', label: 'Risk domain', type: 'select', required: true, options: opt('CYBER', 'FINANCIAL', 'OPERATIONAL', 'CONCENTRATION', 'BCP', 'PRIVACY', 'COMPLIANCE', 'SUBCONTRACTOR') },
      { name: 'rating', label: 'Rating', type: 'select', required: true, options: TIERS },
      { name: 'finding', label: 'Finding', type: 'textarea' },
      { name: 'treatment', label: 'Treatment', type: 'textarea' },
      { name: 'assessed_on', label: 'Assessed on', type: 'date' },
      { name: 'due_date', label: 'Next review', type: 'date' },
    ],
  },
  action_issue: {
    label: 'Corrective action', plural: 'Corrective actions', order: 'due_date', writeRoles: ACTION_WRITERS,
    list: ['vendor_id', 'report_id', 'description', 'owner_party', 'owner_name', 'due_date', 'status'],
    fields: [
      { name: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendor', required: true },
      { name: 'service_id', label: 'Service', type: 'ref', ref: 'service' },
      { name: 'report_id', label: 'Incident report', type: 'ref', ref: 'incident_report', readOnly: true },
      { name: 'source_finding', label: 'Source finding' },
      { name: 'description', label: 'Action', type: 'textarea', required: true },
      { name: 'action_type', label: 'Type', type: 'select', options: opt('CORRECTIVE', 'PREVENTIVE'), required: true, default: 'CORRECTIVE' },
      { name: 'severity', label: 'Severity', type: 'select', options: TIERS, required: true, default: 'MEDIUM' },
      { name: 'owner_party', label: 'Owner party', type: 'select', options: opt('VENDOR', 'BANK', 'JOINT'), required: true, default: 'VENDOR' },
      { name: 'owner_name', label: 'Owner' },
      { name: 'due_date', label: 'Due date', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: opt('OPEN', 'IN_PROGRESS', 'DONE_PENDING_REVIEW', 'CLOSED', 'CANCELLED'), required: true, default: 'OPEN' },
      { name: 'closure_evidence_id', label: 'Closure evidence', type: 'ref', ref: 'evidence' },
      { name: 'closed_at', label: 'Closed at', type: 'date' },
    ],
  },
};

function entityDef(name) {
  const def = ENTITIES[name];
  if (!def) throw new AppError(`Unknown record type: ${name}`, 'VALIDATION');
  const table = byName[name];
  return { ...def, name, pk: table.columns.find((c) => c.type === 'id').name, table };
}

function meta() {
  return Object.fromEntries(Object.entries(ENTITIES).map(([k, v]) => [k, { label: v.label, plural: v.plural, list: v.list, fields: v.fields, parent: v.parent || null, pk: entityDef(k).pk, writeRoles: v.writeRoles || MASTER }]));
}

function labelColumns(def) {
  return def.fields
    .filter((f) => f.type === 'ref')
    .map((f) => `(${LABEL_SQL[f.ref].replace('{id}', `t.${f.name}`)}) AS ${f.name}__label`)
    .join(', ');
}

function list(db, name, filters = {}) {
  const def = entityDef(name);
  const where = [];
  const params = [];
  for (const [k, v] of Object.entries(filters || {})) {
    if (v === undefined || v === null || v === '') continue;
    if (!def.fields.some((f) => f.name === k) && k !== def.pk) throw new AppError(`Cannot filter ${name} by ${k}`, 'VALIDATION');
    where.push(`t.${k} = ?`);
    params.push(v);
  }
  const labels = labelColumns(def);
  const order = def.order.split(',').map((s) => `t.${s.trim()}`).join(', ');
  return db.all(`SELECT t.*${labels ? ', ' + labels : ''} FROM ${name} t ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`, params);
}

function get(db, name, id) {
  const def = entityDef(name);
  const labels = labelColumns(def);
  const row = db.get(`SELECT t.*${labels ? ', ' + labels : ''} FROM ${name} t WHERE t.${def.pk} = ?`, [id]);
  if (!row) throw new AppError(`${def.label} not found.`, 'NOT_FOUND');
  return row;
}

/** Options for a reference dropdown. */
function options(db, refName, filters = {}) {
  if (!LABEL_SQL[refName]) throw new AppError(`No options for ${refName}`, 'VALIDATION');
  const pk = byName[refName].columns.find((c) => c.type === 'id').name;
  const where = [];
  const params = [];
  for (const [k, v] of Object.entries(filters || {})) {
    if (v === undefined || v === null || v === '') continue;
    if (!byName[refName].columns.some((col) => col.name === k)) throw new AppError(`Cannot filter ${refName} by ${k}`, 'VALIDATION');
    where.push(`t.${k} = ?`);
    params.push(v);
  }
  if (refName === 'app_user') where.push('t.active = 1');
  return db.all(`SELECT t.${pk} AS value, (${LABEL_SQL[refName].replace('{id}', `t.${pk}`)}) AS label FROM ${refName} t ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY label`, params);
}

function coerce(field, raw) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  switch (field.type) {
    case 'number': case 'ref': {
      const n = Number(raw);
      if (Number.isNaN(n)) throw new AppError(`${field.label} must be a number.`, 'VALIDATION');
      return n;
    }
    case 'bool': return raw === true || raw === 1 || raw === '1' || raw === 'true' ? 1 : 0;
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) throw new AppError(`${field.label} must be a date (YYYY-MM-DD).`, 'VALIDATION');
      return String(raw);
    case 'time':
      if (!/^\d{2}:\d{2}$/.test(String(raw))) throw new AppError(`${field.label} must be a time (HH:MM).`, 'VALIDATION');
      return String(raw);
    case 'select': {
      const s = String(raw);
      if (!field.options.some((o) => String(o.value) === s)) throw new AppError(`${field.label}: "${s}" is not an allowed value.`, 'VALIDATION');
      return s;
    }
    default: return String(raw).trim();
  }
}

function assertWrite(def, actor) {
  const roles = def.writeRoles || MASTER;
  if (!roles.includes(actor.role_code)) throw new AppError(`Your role cannot change ${def.plural.toLowerCase()}.`, 'FORBIDDEN');
}

function friendlyDbError(err, def) {
  const m = String(err.message || err);
  if (/UNIQUE constraint/.test(m)) return new AppError(`A ${def.label.toLowerCase()} with the same identifying value already exists.`, 'VALIDATION');
  if (/FOREIGN KEY constraint/.test(m)) return new AppError(`This ${def.label.toLowerCase()} is referenced by other records, or refers to a record that does not exist.`, 'VALIDATION');
  if (/CHECK constraint/.test(m)) return new AppError(`One of the values is not allowed for ${def.label.toLowerCase()}.`, 'VALIDATION');
  return err;
}

function save(db, actor, name, data) {
  const def = entityDef(name);
  assertWrite(def, actor);
  const id = data[def.pk];
  const values = {};
  for (const f of def.fields) {
    if (f.readOnly && id) continue;
    let v = coerce(f, data[f.name]);
    if (v === undefined && !id && f.default !== undefined) v = coerce(f, f.default);
    if (v === undefined) continue;
    // integers stored for numeric selects on int columns
    const col = def.table.columns.find((c) => c.name === f.name);
    if (col && (col.type === 'int') && v !== null) v = Number(v);
    values[f.name] = v;
  }
  for (const f of def.fields.filter((x) => x.required)) {
    const v = values[f.name] !== undefined ? values[f.name] : undefined;
    if ((!id && (v === undefined || v === null || v === '')) || (id && v === null)) throw new AppError(`${f.label} is required.`, 'VALIDATION');
  }
  if (name === 'sla_definition' && values.metric_code === 'AVAILABILITY') values.direction = 'higher_is_better';
  const hasUpdated = def.table.columns.some((c) => c.name === 'updated_at');
  try {
    return db.tx(() => {
      if (id) {
        const before = db.get(`SELECT * FROM ${name} WHERE ${def.pk} = ?`, [id]);
        if (!before) throw new AppError(`${def.label} not found.`, 'NOT_FOUND');
        const cols = Object.keys(values);
        if (hasUpdated) { cols.push('updated_at'); values.updated_at = nowIso(); }
        if (cols.length) db.run(`UPDATE ${name} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${def.pk} = ?`, [...cols.map((c) => values[c]), id]);
        audit.record(db, actor, 'UPDATED', name, id, { before, after: values });
        return get(db, name, id);
      }
      values.created_at = nowIso();
      const cols = Object.keys(values);
      const { lastId } = db.run(`INSERT INTO ${name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => values[c]));
      audit.record(db, actor, 'CREATED', name, lastId, { after: values });
      return get(db, name, lastId);
    });
  } catch (err) {
    throw friendlyDbError(err, def);
  }
}

function remove(db, actor, name, id) {
  const def = entityDef(name);
  assertWrite(def, actor);
  try {
    db.tx(() => {
      const before = db.get(`SELECT * FROM ${name} WHERE ${def.pk} = ?`, [id]);
      if (!before) throw new AppError(`${def.label} not found.`, 'NOT_FOUND');
      db.run(`DELETE FROM ${name} WHERE ${def.pk} = ?`, [id]);
      audit.record(db, actor, 'DELETED', name, id, { before });
    });
  } catch (err) {
    throw friendlyDbError(err, def);
  }
}

module.exports = { ENTITIES, meta, list, get, options, save, remove, MASTER, LABEL_SQL };
