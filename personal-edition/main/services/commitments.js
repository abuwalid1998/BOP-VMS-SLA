'use strict';
/**
 * Service Commitment Report (feature 1).
 *
 * For a selected vendor + service it assembles every contractual commitment
 * from the governed catalogue: SLA targets, support hours, escalation contacts
 * (vendor and bank), responsibilities and other obligations - each linked to
 * the contract clause it comes from. Commitments without a clause link are
 * reported as gaps, because an unlinked commitment cannot be enforced.
 */
const { AppError } = require('./util');

const today = () => new Date().toISOString().slice(0, 10);

function effectiveVersion(db, contractId, asOf) {
  if (!contractId) return null;
  return db.get(
    `SELECT v.*, c.contract_no, c.title AS contract_title, c.start_date, c.end_date, c.notice_period_days, c.status AS contract_status, c.repository_ref
       FROM contract_version v JOIN contract c ON c.contract_id = v.contract_id
      WHERE v.contract_id = ? AND v.status = 'APPROVED' AND v.effective_from <= ? AND (v.effective_to IS NULL OR v.effective_to >= ?)
      ORDER BY v.effective_from DESC LIMIT 1`, [contractId, asOf, asOf],
  ) || db.get(
    `SELECT v.*, c.contract_no, c.title AS contract_title, c.start_date, c.end_date, c.notice_period_days, c.status AS contract_status, c.repository_ref
       FROM contract_version v JOIN contract c ON c.contract_id = v.contract_id
      WHERE v.contract_id = ? ORDER BY v.effective_from DESC LIMIT 1`, [contractId],
  );
}

const clauseCols = (alias, prefix) => `${alias}.clause_id AS ${prefix}_id, ${alias}.clause_ref AS ${prefix}_ref, ${alias}.title AS ${prefix}_title, ${alias}.clause_text AS ${prefix}_text, ${alias}.page_no AS ${prefix}_page`;

function pairs(db) {
  return db.all(
    `SELECT vs.vendor_service_id, vs.vendor_id, vs.service_id, v.legal_name, s.service_code, s.service_name, s.criticality
       FROM vendor_service vs JOIN vendor v ON v.vendor_id = vs.vendor_id JOIN service s ON s.service_id = vs.service_id
      ORDER BY v.legal_name, s.service_code`,
  );
}

function build(db, vendorId, serviceId, asOf = today()) {
  const vs = db.get(
    `SELECT vs.*, c.contract_no FROM vendor_service vs LEFT JOIN contract c ON c.contract_id = vs.contract_id
      WHERE vs.vendor_id = ? AND vs.service_id = ?`, [vendorId, serviceId],
  );
  if (!vs) throw new AppError('This vendor is not registered as a provider of the selected service. Link them under Vendors > Services first.', 'NOT_FOUND');

  const vendor = db.get(`SELECT v.*, u.full_name AS relationship_manager FROM vendor v LEFT JOIN app_user u ON u.user_id = v.relationship_manager_id WHERE v.vendor_id = ?`, [vendorId]);
  const service = db.get(
    `SELECT s.*, b.section_name, b.section_code, h.full_name AS section_head, h.job_title AS section_head_title,
            o.full_name AS service_owner, o.job_title AS service_owner_title, t.full_name AS technical_owner, t.job_title AS technical_owner_title
       FROM service s JOIN bank_section b ON b.section_id = s.section_id
       LEFT JOIN app_user h ON h.user_id = b.head_user_id
       LEFT JOIN app_user o ON o.user_id = s.service_owner_id
       LEFT JOIN app_user t ON t.user_id = s.technical_owner_id
      WHERE s.service_id = ?`, [serviceId],
  );
  const version = effectiveVersion(db, vs.contract_id, asOf);
  const versionId = version ? version.version_id : -1;

  const slas = db.all(
    `SELECT d.*, m.contractual_target, m.remedy_text, ${clauseCols('cl', 'clause')}, ${clauseCols('rc', 'remedy_clause')}
       FROM sla_definition d
       LEFT JOIN sla_contract_mapping m ON m.sla_id = d.sla_id AND m.version_id = ?
       LEFT JOIN contract_clause cl ON cl.clause_id = m.clause_id
       LEFT JOIN contract_clause rc ON rc.clause_id = m.remedy_clause_id
      WHERE d.service_id = ? AND (d.vendor_id IS NULL OR d.vendor_id = ?)
        AND d.approval_status = 'APPROVED' AND d.effective_from <= ? AND (d.effective_to IS NULL OR d.effective_to >= ?)
      ORDER BY CASE d.metric_code WHEN 'AVAILABILITY' THEN 0 ELSE 1 END, COALESCE(d.priority, 'P0'), d.metric_code`,
    [versionId, serviceId, vendorId, asOf, asOf],
  );

  const supportHours = db.all(`SELECT w.*, ${clauseCols('cl', 'clause')} FROM support_window w LEFT JOIN contract_clause cl ON cl.clause_id = w.clause_id WHERE w.vendor_service_id = ? ORDER BY w.support_window_id`, [vs.vendor_service_id]);
  const vendorContacts = db.all('SELECT * FROM vendor_contact WHERE vendor_id = ? AND active = 1 ORDER BY escalation_level, is_primary DESC, full_name', [vendorId]);
  const vmHead = db.get("SELECT full_name, job_title, email FROM app_user WHERE role_code = 'VM_SECTION_HEAD' AND active = 1 ORDER BY user_id LIMIT 1");
  const cio = db.get("SELECT full_name, job_title, email FROM app_user WHERE role_code = 'CIO' AND active = 1 ORDER BY user_id LIMIT 1");
  const bankEscalation = [
    { level: 1, scope: 'Operational', name: service.technical_owner, title: service.technical_owner_title || 'Technical owner' },
    { level: 2, scope: 'Service management', name: service.section_head, title: service.section_head_title || `Head of ${service.section_name}` },
    { level: 3, scope: 'Relationship', name: [service.service_owner, vendor.relationship_manager].filter(Boolean).join(' / '), title: 'Service owner / Vendor relationship manager' },
    { level: 4, scope: 'Executive / control', name: [vmHead && vmHead.full_name, cio && cio.full_name].filter(Boolean).join(' / '), title: 'Vendor Management Section Head / CIO' },
  ];
  const responsibilities = db.all(`SELECT r.*, ${clauseCols('cl', 'clause')} FROM responsibility r LEFT JOIN contract_clause cl ON cl.clause_id = r.clause_id WHERE r.vendor_service_id = ? ORDER BY r.responsibility_id`, [vs.vendor_service_id]);
  const obligations = db.all(
    `SELECT o.*, ${clauseCols('cl', 'clause')} FROM contract_obligation o LEFT JOIN contract_clause cl ON cl.clause_id = o.clause_id
      WHERE o.version_id = ? AND (o.vendor_service_id IS NULL OR o.vendor_service_id = ?) ORDER BY o.category, o.obligation_id`,
    [versionId, vs.vendor_service_id],
  );

  const recentIncidents = db.all(
    `SELECT r.report_id, r.report_no, r.title, r.priority, r.status, r.detected_at,
            (SELECT COUNT(*) FROM incident_sla_result x WHERE x.report_id = r.report_id AND x.outcome = 'BREACHED') AS breaches
       FROM incident_report r WHERE r.vendor_id = ? AND r.service_id = ? ORDER BY r.detected_at DESC LIMIT 8`, [vendorId, serviceId],
  );

  const items = [
    ...slas.map((x) => ({ kind: 'SLA target', name: x.name, linked: !!x.clause_id })),
    ...supportHours.map((x) => ({ kind: 'Support hours', name: x.label, linked: !!x.clause_id })),
    ...responsibilities.map((x) => ({ kind: 'Responsibility', name: x.activity, linked: !!x.clause_id })),
    ...obligations.map((x) => ({ kind: 'Obligation', name: x.description, linked: !!x.clause_id })),
  ];
  const gaps = items.filter((i) => !i.linked);
  if (!version) gaps.unshift({ kind: 'Contract', name: 'No approved contract version is linked to this vendor service', linked: false });

  return {
    asOf, generatedAt: new Date().toISOString(),
    vendor, service, vendorService: vs, contractVersion: version,
    slas, supportHours, vendorContacts, bankEscalation, responsibilities, obligations, recentIncidents,
    coverage: { total: items.length, linked: items.length - gaps.filter((g) => g.kind !== 'Contract').length, gaps },
  };
}

module.exports = { build, pairs, effectiveVersion };
