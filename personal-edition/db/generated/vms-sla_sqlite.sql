-- =====================================================================
-- Bank of Palestine - Vendor Management & SLA Platform (VMS-SLA)
-- Schema version 1 - generated DDL for SQLite 3.35+
-- Generated from main/db/schema.js. Do not edit by hand; regenerate with
--   node scripts/export-ddl.js --dialect sqlite
-- =====================================================================


-- ---------------------------------------------------------------- tables

CREATE TABLE app_setting (
  setting_id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key TEXT NOT NULL,
  setting_value TEXT,
  updated_at TEXT,
  CONSTRAINT uq_app_setting_1 UNIQUE (setting_key)
);

CREATE TABLE app_user (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  job_title TEXT,
  role_code TEXT NOT NULL,
  section_id INTEGER REFERENCES bank_section(section_id),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  public_key_pem TEXT,
  private_key_enc TEXT,
  key_fingerprint TEXT,
  active INTEGER DEFAULT 1 NOT NULL,
  must_change_password INTEGER DEFAULT 0 NOT NULL,
  failed_attempts INTEGER DEFAULT 0 NOT NULL,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT uq_app_user_1 UNIQUE (username),
  CONSTRAINT ck_app_user_1 CHECK (role_code IN ('ADMIN','VM_SECTION_HEAD','VENDOR_MANAGER','IT_SECTION_HEAD','CIO','SERVICE_OWNER','TECH_OWNER','AUDITOR')),
  CONSTRAINT ck_app_user_active CHECK (active IN (0,1)),
  CONSTRAINT ck_app_user_must_chan_0b30a92e CHECK (must_change_password IN (0,1))
);

CREATE TABLE bank_section (
  section_id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_code TEXT NOT NULL,
  section_name TEXT NOT NULL,
  department TEXT,
  head_user_id INTEGER REFERENCES app_user(user_id),
  active INTEGER DEFAULT 1 NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT uq_bank_section_1 UNIQUE (section_code),
  CONSTRAINT ck_bank_section_active CHECK (active IN (0,1))
);

CREATE TABLE vendor (
  vendor_id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_code TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  legal_name_ar TEXT,
  registration_no TEXT,
  country TEXT,
  status TEXT DEFAULT 'ACTIVE' NOT NULL,
  risk_tier TEXT DEFAULT 'MEDIUM' NOT NULL,
  parent_vendor_id INTEGER REFERENCES vendor(vendor_id),
  relationship_manager_id INTEGER REFERENCES app_user(user_id),
  website TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT uq_vendor_1 UNIQUE (vendor_code),
  CONSTRAINT ck_vendor_1 CHECK (risk_tier IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  CONSTRAINT ck_vendor_2 CHECK (status IN ('PROSPECT','ACTIVE','SUSPENDED','EXITING','EXITED'))
);

CREATE TABLE vendor_contact (
  contact_id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendor(vendor_id),
  full_name TEXT NOT NULL,
  role_title TEXT,
  escalation_level INTEGER DEFAULT 1 NOT NULL,
  email TEXT,
  phone TEXT,
  is_primary INTEGER DEFAULT 0 NOT NULL,
  is_backup INTEGER DEFAULT 0 NOT NULL,
  active INTEGER DEFAULT 1 NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT ck_vendor_contact_is_primary CHECK (is_primary IN (0,1)),
  CONSTRAINT ck_vendor_contact_is_backup CHECK (is_backup IN (0,1)),
  CONSTRAINT ck_vendor_contact_active CHECK (active IN (0,1))
);

CREATE TABLE service (
  service_id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_code TEXT NOT NULL,
  service_name TEXT NOT NULL,
  service_tower TEXT NOT NULL,
  criticality TEXT DEFAULT 'MEDIUM' NOT NULL,
  data_classification TEXT,
  section_id INTEGER NOT NULL REFERENCES bank_section(section_id),
  service_owner_id INTEGER REFERENCES app_user(user_id),
  technical_owner_id INTEGER REFERENCES app_user(user_id),
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT uq_service_1 UNIQUE (service_code),
  CONSTRAINT ck_service_1 CHECK (criticality IN ('CRITICAL','HIGH','MEDIUM','LOW'))
);

CREATE TABLE risk_assessment (
  assessment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendor(vendor_id),
  service_id INTEGER REFERENCES service(service_id),
  risk_domain TEXT NOT NULL,
  rating TEXT NOT NULL,
  finding TEXT,
  treatment TEXT,
  assessed_on TEXT,
  due_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE contract (
  contract_id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendor(vendor_id),
  contract_no TEXT NOT NULL,
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  notice_period_days INTEGER,
  contract_value REAL,
  currency TEXT,
  status TEXT DEFAULT 'ACTIVE' NOT NULL,
  repository_ref TEXT,
  owner_user_id INTEGER REFERENCES app_user(user_id),
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT uq_contract_1 UNIQUE (contract_no)
);

CREATE TABLE contract_version (
  version_id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL REFERENCES contract(contract_id),
  version_no TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  approval_ref TEXT,
  file_hash TEXT,
  status TEXT DEFAULT 'APPROVED' NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT uq_contract_version_1 UNIQUE (contract_id, version_no)
);

CREATE TABLE contract_clause (
  clause_id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES contract_version(version_id),
  clause_ref TEXT NOT NULL,
  title TEXT,
  clause_type TEXT NOT NULL,
  clause_text TEXT,
  page_no INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT uq_contract_clause_1 UNIQUE (version_id, clause_ref)
);

CREATE TABLE vendor_service (
  vendor_service_id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendor(vendor_id),
  service_id INTEGER NOT NULL REFERENCES service(service_id),
  contract_id INTEGER REFERENCES contract(contract_id),
  scope TEXT,
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'ACTIVE' NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT uq_vendor_service_1 UNIQUE (vendor_id, service_id)
);

CREATE TABLE support_window (
  support_window_id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_service_id INTEGER NOT NULL REFERENCES vendor_service(vendor_service_id),
  label TEXT NOT NULL,
  applies_to TEXT,
  days_of_week TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  timezone TEXT DEFAULT 'Asia/Hebron' NOT NULL,
  channels TEXT,
  clause_id INTEGER REFERENCES contract_clause(clause_id),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE sla_definition (
  sla_id INTEGER PRIMARY KEY AUTOINCREMENT,
  sla_code TEXT NOT NULL,
  service_id INTEGER NOT NULL REFERENCES service(service_id),
  vendor_id INTEGER REFERENCES vendor(vendor_id),
  name TEXT NOT NULL,
  metric_code TEXT NOT NULL,
  priority TEXT,
  direction TEXT NOT NULL,
  target_value REAL NOT NULL,
  warning_value REAL,
  unit TEXT NOT NULL,
  measurement_window TEXT NOT NULL,
  support_window_code TEXT DEFAULT '24x7' NOT NULL,
  exclusions TEXT,
  evidence_source TEXT,
  is_critical INTEGER DEFAULT 0 NOT NULL,
  weight REAL,
  formula_version TEXT DEFAULT 'v1' NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  approval_status TEXT DEFAULT 'APPROVED' NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT uq_sla_definition_1 UNIQUE (sla_code),
  CONSTRAINT ck_sla_definition_1 CHECK (direction IN ('higher_is_better','lower_is_better')),
  CONSTRAINT ck_sla_definition_2 CHECK (metric_code IN ('AVAILABILITY','INCIDENT_RESPONSE','INCIDENT_RESTORATION','INCIDENT_RESOLUTION','RCA_DELIVERY','BACKUP_SUCCESS','CHANGE_SUCCESS','PATCH_COMPLIANCE','REQUEST_FULFILMENT','OTHER')),
  CONSTRAINT ck_sla_definition_is_critical CHECK (is_critical IN (0,1))
);

CREATE TABLE sla_contract_mapping (
  mapping_id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES contract_version(version_id),
  sla_id INTEGER NOT NULL REFERENCES sla_definition(sla_id),
  clause_id INTEGER NOT NULL REFERENCES contract_clause(clause_id),
  contractual_target TEXT,
  remedy_clause_id INTEGER REFERENCES contract_clause(clause_id),
  remedy_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT uq_sla_contract_mapping_1 UNIQUE (version_id, sla_id)
);

CREATE TABLE contract_obligation (
  obligation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES contract_version(version_id),
  vendor_service_id INTEGER REFERENCES vendor_service(vendor_service_id),
  clause_id INTEGER REFERENCES contract_clause(clause_id),
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  bank_owner_role TEXT,
  vendor_owner_role TEXT,
  frequency TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE responsibility (
  responsibility_id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_service_id INTEGER NOT NULL REFERENCES vendor_service(vendor_service_id),
  activity TEXT NOT NULL,
  bank_party TEXT,
  bank_raci TEXT,
  vendor_party TEXT,
  vendor_raci TEXT,
  clause_id INTEGER REFERENCES contract_clause(clause_id),
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE sla_measurement (
  measurement_id INTEGER PRIMARY KEY AUTOINCREMENT,
  sla_id INTEGER NOT NULL REFERENCES sla_definition(sla_id),
  period TEXT NOT NULL,
  actual_value REAL,
  result TEXT,
  score REAL,
  source_ref TEXT,
  calc_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT uq_sla_measurement_1 UNIQUE (sla_id, period)
);

CREATE TABLE incident_report (
  report_id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_no TEXT NOT NULL,
  vendor_id INTEGER NOT NULL REFERENCES vendor(vendor_id),
  service_id INTEGER NOT NULL REFERENCES service(service_id),
  vendor_service_id INTEGER REFERENCES vendor_service(vendor_service_id),
  contract_version_id INTEGER REFERENCES contract_version(version_id),
  title TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT DEFAULT 'DRAFT' NOT NULL,
  revision INTEGER DEFAULT 1 NOT NULL,
  impact_summary TEXT,
  business_impact TEXT,
  customers_affected INTEGER,
  channels_affected TEXT,
  financial_impact REAL,
  outage_type TEXT DEFAULT 'FULL',
  detected_at TEXT,
  reported_at TEXT,
  acknowledged_at TEXT,
  workaround_at TEXT,
  restored_at TEXT,
  resolved_at TEXT,
  outage_start TEXT,
  outage_end TEXT,
  itsm_ref TEXT,
  vendor_ticket_ref TEXT,
  root_cause_category TEXT,
  root_cause TEXT,
  contributing_factors TEXT,
  rca_due_at TEXT,
  rca_received_at TEXT,
  rca_accepted INTEGER DEFAULT 0 NOT NULL,
  sla_calc_version TEXT,
  sla_calculated_at TEXT,
  content_hash TEXT,
  created_by INTEGER NOT NULL REFERENCES app_user(user_id),
  submitted_at TEXT,
  approved_at TEXT,
  locked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT uq_incident_report_1 UNIQUE (report_no),
  CONSTRAINT ck_incident_report_1 CHECK (priority IN ('P1','P2','P3','P4')),
  CONSTRAINT ck_incident_report_2 CHECK (status IN ('DRAFT','IN_APPROVAL','RETURNED','APPROVED','LOCKED')),
  CONSTRAINT ck_incident_report_3 CHECK (outage_type IN ('FULL','PARTIAL','DEGRADED','NONE')),
  CONSTRAINT ck_incident_report_rc_c36648a0 CHECK (rca_accepted IN (0,1))
);

CREATE TABLE evidence (
  evidence_id INTEGER PRIMARY KEY AUTOINCREMENT,
  object_ref TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT NOT NULL,
  source TEXT,
  captured_at TEXT,
  classification TEXT DEFAULT 'INTERNAL',
  description TEXT,
  report_id INTEGER REFERENCES incident_report(report_id),
  related_type TEXT,
  related_id INTEGER,
  uploaded_by INTEGER NOT NULL REFERENCES app_user(user_id),
  uploaded_at TEXT NOT NULL
);

CREATE TABLE incident_timeline (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES incident_report(report_id),
  occurred_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_party TEXT NOT NULL,
  actor_name TEXT,
  description TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE incident_clock_pause (
  pause_id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES incident_report(report_id),
  paused_at TEXT NOT NULL,
  resumed_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  approved INTEGER DEFAULT 0 NOT NULL,
  approved_by INTEGER REFERENCES app_user(user_id),
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT ck_incident_clock_pau_91071e64 CHECK (approved IN (0,1))
);

CREATE TABLE incident_service_state (
  state_id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES incident_report(report_id),
  component TEXT NOT NULL,
  indicator TEXT NOT NULL,
  unit TEXT,
  before_value TEXT,
  during_value TEXT,
  after_value TEXT,
  before_status TEXT,
  after_status TEXT,
  evidence_id INTEGER REFERENCES evidence(evidence_id),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE vendor_action (
  action_id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES incident_report(report_id),
  action_at TEXT NOT NULL,
  vendor_actor TEXT,
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  outcome TEXT,
  evidence_id INTEGER REFERENCES evidence(evidence_id),
  bank_verified INTEGER DEFAULT 0 NOT NULL,
  verified_by INTEGER REFERENCES app_user(user_id),
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT ck_vendor_action_bank_verified CHECK (bank_verified IN (0,1))
);

CREATE TABLE incident_sla_result (
  result_id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES incident_report(report_id),
  sla_id INTEGER REFERENCES sla_definition(sla_id),
  sla_code TEXT,
  sla_name TEXT,
  metric_code TEXT NOT NULL,
  target_value REAL,
  actual_value REAL,
  unit TEXT,
  direction TEXT,
  outcome TEXT NOT NULL,
  variance REAL,
  is_critical INTEGER DEFAULT 0 NOT NULL,
  clause_ref TEXT,
  remedy_text TEXT,
  calc_detail TEXT,
  calc_version TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  CONSTRAINT ck_incident_sla_result_1 CHECK (outcome IN ('MET','BREACHED','AT_RISK','NOT_MEASURABLE')),
  CONSTRAINT ck_incident_sla_resul_f7b0212e CHECK (is_critical IN (0,1))
);

CREATE TABLE action_issue (
  action_issue_id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendor(vendor_id),
  service_id INTEGER REFERENCES service(service_id),
  report_id INTEGER REFERENCES incident_report(report_id),
  source_finding TEXT,
  description TEXT NOT NULL,
  action_type TEXT DEFAULT 'CORRECTIVE' NOT NULL,
  severity TEXT DEFAULT 'MEDIUM' NOT NULL,
  owner_party TEXT NOT NULL,
  owner_name TEXT,
  due_date TEXT,
  status TEXT DEFAULT 'OPEN' NOT NULL,
  closure_evidence_id INTEGER REFERENCES evidence(evidence_id),
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE approval_policy (
  policy_id INTEGER PRIMARY KEY AUTOINCREMENT,
  priority TEXT NOT NULL,
  step_no INTEGER NOT NULL,
  role_code TEXT NOT NULL,
  step_label TEXT NOT NULL,
  responsibility TEXT,
  required_when TEXT DEFAULT 'ALWAYS' NOT NULL,
  active INTEGER DEFAULT 1 NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT uq_approval_policy_1 UNIQUE (priority, step_no),
  CONSTRAINT ck_approval_policy_1 CHECK (required_when IN ('ALWAYS','CRITICAL_BREACH','ANY_BREACH')),
  CONSTRAINT ck_approval_policy_active CHECK (active IN (0,1))
);

CREATE TABLE approval_step (
  step_id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES incident_report(report_id),
  revision INTEGER NOT NULL,
  step_no INTEGER NOT NULL,
  role_code TEXT NOT NULL,
  step_label TEXT NOT NULL,
  responsibility TEXT,
  required_user_id INTEGER REFERENCES app_user(user_id),
  status TEXT DEFAULT 'PENDING' NOT NULL,
  decided_by INTEGER REFERENCES app_user(user_id),
  decided_at TEXT,
  decision_comment TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CONSTRAINT uq_approval_step_1 UNIQUE (report_id, revision, step_no),
  CONSTRAINT ck_approval_step_1 CHECK (status IN ('WAITING','PENDING','APPROVED','REJECTED','SUPERSEDED'))
);

CREATE TABLE e_signature (
  signature_id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES incident_report(report_id),
  step_id INTEGER NOT NULL REFERENCES approval_step(step_id),
  revision INTEGER NOT NULL,
  signer_user_id INTEGER NOT NULL REFERENCES app_user(user_id),
  signer_name TEXT NOT NULL,
  signer_title TEXT,
  role_code TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT,
  signed_at TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  prev_signature_hash TEXT,
  payload_json TEXT NOT NULL,
  signature_b64 TEXT NOT NULL,
  public_key_pem TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL,
  signature_hash TEXT NOT NULL,
  CONSTRAINT ck_e_signature_1 CHECK (decision IN ('APPROVED','REJECTED'))
);

CREATE TABLE report_document (
  document_id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER REFERENCES incident_report(report_id),
  doc_type TEXT NOT NULL,
  revision INTEGER,
  title TEXT NOT NULL,
  file_ref TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER,
  is_locked INTEGER DEFAULT 0 NOT NULL,
  encrypted INTEGER DEFAULT 0 NOT NULL,
  generated_by INTEGER NOT NULL REFERENCES app_user(user_id),
  generated_at TEXT NOT NULL,
  CONSTRAINT ck_report_document_is_locked CHECK (is_locked IN (0,1)),
  CONSTRAINT ck_report_document_encrypted CHECK (encrypted IN (0,1))
);

CREATE TABLE audit_event (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES app_user(user_id),
  actor_name TEXT,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT,
  before_hash TEXT,
  after_hash TEXT,
  details TEXT,
  prev_event_hash TEXT,
  event_hash TEXT NOT NULL
);

-- ---------------------------------------------------------------- indexes

CREATE INDEX ix_vendor_contact_1 ON vendor_contact (vendor_id);

CREATE INDEX ix_risk_assessment_1 ON risk_assessment (vendor_id);

CREATE INDEX ix_contract_1 ON contract (vendor_id);

CREATE INDEX ix_support_window_1 ON support_window (vendor_service_id);

CREATE INDEX ix_sla_definition_1 ON sla_definition (service_id);

CREATE INDEX ix_contract_obligation_1 ON contract_obligation (vendor_service_id);

CREATE INDEX ix_responsibility_1 ON responsibility (vendor_service_id);

CREATE INDEX ix_incident_report_1 ON incident_report (vendor_id);

CREATE INDEX ix_incident_report_2 ON incident_report (service_id);

CREATE INDEX ix_incident_report_3 ON incident_report (status);

CREATE INDEX ix_evidence_1 ON evidence (report_id);

CREATE INDEX ix_evidence_2 ON evidence (related_type, related_id);

CREATE INDEX ix_incident_timeline_1 ON incident_timeline (report_id);

CREATE INDEX ix_incident_clock_pause_1 ON incident_clock_pause (report_id);

CREATE INDEX ix_incident_service_state_1 ON incident_service_state (report_id);

CREATE INDEX ix_vendor_action_1 ON vendor_action (report_id);

CREATE INDEX ix_incident_sla_result_1 ON incident_sla_result (report_id);

CREATE INDEX ix_action_issue_1 ON action_issue (report_id);

CREATE INDEX ix_action_issue_2 ON action_issue (vendor_id);

CREATE INDEX ix_e_signature_1 ON e_signature (report_id);

CREATE INDEX ix_report_document_1 ON report_document (report_id);

CREATE INDEX ix_audit_event_1 ON audit_event (object_type, object_id);

CREATE INDEX ix_audit_event_2 ON audit_event (occurred_at);

-- ---------------------------------------------------------------- integrity triggers

CREATE TRIGGER trg_incident_report_lock_upd BEFORE UPDATE ON incident_report
WHEN OLD.locked_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Incident report is locked: approved records cannot be modified'); END;

CREATE TRIGGER trg_incident_report_lock_del BEFORE DELETE ON incident_report
WHEN OLD.status <> 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'Only draft incident reports can be deleted'); END;

CREATE TRIGGER trg_incident_timeline_lock_ins BEFORE INSERT ON incident_timeline
WHEN (SELECT locked_at FROM incident_report WHERE report_id = NEW.report_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Incident report is locked: approved records cannot be modified'); END;

CREATE TRIGGER trg_incident_timeline_lock_upd BEFORE UPDATE ON incident_timeline
WHEN (SELECT locked_at FROM incident_report WHERE report_id = OLD.report_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Incident report is locked: approved records cannot be modified'); END;

CREATE TRIGGER trg_incident_timeline_lock_del BEFORE DELETE ON incident_timeline
WHEN (SELECT locked_at FROM incident_report WHERE report_id = OLD.report_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Incident report is locked: approved records cannot be modified'); END;

CREATE TRIGGER trg_incident_clock_pause_lock_ins BEFORE INSERT ON incident_clock_pause
WHEN (SELECT locked_at FROM incident_report WHERE report_id = NEW.report_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Incident report is locked: approved records cannot be modified'); END;

CREATE TRIGGER trg_incident_clock_pause_lock_upd BEFORE UPDATE ON incident_clock_pause
WHEN (SELECT locked_at FROM incident_report WHERE report_id = OLD.report_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Incident report is locked: approved records cannot be modified'); END;

CREATE TRIGGER trg_incident_clock_pause_lock_del BEFORE DELETE ON incident_clock_pause
WHEN (SELECT locked_at FROM incident_report WHERE report_id = OLD.report_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Incident report is locked: approved records cannot be modified'); END;

CREATE TRIGGER trg_incident_service_state_lock_ins BEFORE INSERT ON incident_service_state
WHEN (SELECT locked_at FROM incident_report WHERE report_id = NEW.report_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Incident report is locked: approved records cannot be modified'); END;

CREATE TRIGGER trg_incident_service_state_lock_upd BEFORE UPDATE ON incident_service_state
WHEN (SELECT locked_at FROM incident_report WHERE report_id = OLD.report_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Incident report is locked: approved records cannot be modified'); END;

CREATE TRIGGER trg_incident_service_state_lock_del BEFORE DELETE ON incident_service_state
WHEN (SELECT locked_at FROM incident_report WHERE report_id = OLD.report_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Incident report is locked: approved records cannot be modified'); END;

CREATE TRIGGER trg_vendor_action_lock_ins BEFORE INSERT ON vendor_action
WHEN (SELECT locked_at FROM incident_report WHERE report_id = NEW.report_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Incident report is locked: approved records cannot be modified'); END;

CREATE TRIGGER trg_vendor_action_lock_upd BEFORE UPDATE ON vendor_action
WHEN (SELECT locked_at FROM incident_report WHERE report_id = OLD.report_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Incident report is locked: approved records cannot be modified'); END;

CREATE TRIGGER trg_vendor_action_lock_del BEFORE DELETE ON vendor_action
WHEN (SELECT locked_at FROM incident_report WHERE report_id = OLD.report_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Incident report is locked: approved records cannot be modified'); END;

CREATE TRIGGER trg_incident_sla_result_lock_ins BEFORE INSERT ON incident_sla_result
WHEN (SELECT locked_at FROM incident_report WHERE report_id = NEW.report_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Incident report is locked: approved records cannot be modified'); END;

CREATE TRIGGER trg_incident_sla_result_lock_upd BEFORE UPDATE ON incident_sla_result
WHEN (SELECT locked_at FROM incident_report WHERE report_id = OLD.report_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Incident report is locked: approved records cannot be modified'); END;

CREATE TRIGGER trg_incident_sla_result_lock_del BEFORE DELETE ON incident_sla_result
WHEN (SELECT locked_at FROM incident_report WHERE report_id = OLD.report_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Incident report is locked: approved records cannot be modified'); END;

CREATE TRIGGER trg_e_signature_no_upd BEFORE UPDATE ON e_signature
BEGIN SELECT RAISE(ABORT, 'e_signature is append-only: records cannot be modified or deleted'); END;

CREATE TRIGGER trg_e_signature_no_del BEFORE DELETE ON e_signature
BEGIN SELECT RAISE(ABORT, 'e_signature is append-only: records cannot be modified or deleted'); END;

CREATE TRIGGER trg_report_document_no_upd BEFORE UPDATE ON report_document
BEGIN SELECT RAISE(ABORT, 'report_document is append-only: records cannot be modified or deleted'); END;

CREATE TRIGGER trg_report_document_no_del BEFORE DELETE ON report_document
BEGIN SELECT RAISE(ABORT, 'report_document is append-only: records cannot be modified or deleted'); END;

CREATE TRIGGER trg_audit_event_no_upd BEFORE UPDATE ON audit_event
BEGIN SELECT RAISE(ABORT, 'audit_event is append-only: records cannot be modified or deleted'); END;

CREATE TRIGGER trg_audit_event_no_del BEFORE DELETE ON audit_event
BEGIN SELECT RAISE(ABORT, 'audit_event is append-only: records cannot be modified or deleted'); END;
