'use strict';
/**
 * Personal Edition request router.
 * Single owner on one desktop: no sign-in, no user accounts and no approval
 * chain. Every request runs as the owner record created at first start
 * (see db/bootstrap.js), so the audit trail still says who did what.
 */
const { AppError } = require('./services/util');
const audit = require('./services/audit');
const registry = require('./services/registry');
const commitments = require('./services/commitments');
const incidents = require('./services/incidents');
const finalize = require('./services/finalize');
const evidence = require('./services/evidence');
const settings = require('./services/settings');
const documents = require('./report/documents');
const { generate } = require('./db/ddl');
const { buildMigrationScript } = require('./db/migrate');
const bootstrap = require('./db/bootstrap');

function createApi(ctx) {
  const db = ctx.db;
  bootstrap.ensureOwner(db);
  const me = () => bootstrap.owner(db);

  const withMeta = (id) => {
    const full = incidents.get(db, id);
    const docs = db.all('SELECT * FROM report_document WHERE report_id = ? ORDER BY document_id DESC', [id]);
    const editable = ['DRAFT', 'RETURNED'].includes(full.report.status);
    return { ...full, documents: docs, canEdit: editable, readiness: editable ? finalize.readiness(full) : [] };
  };

  const handlers = {
    'auth.me': () => me(),

    'meta.entities': () => registry.meta(),
    'meta.enums': () => incidents.ENUMS,

    'registry.list': ({ entity, filters }) => registry.list(db, entity, filters),
    'registry.get': ({ entity, id }) => registry.get(db, entity, id),
    'registry.options': ({ ref, filters }) => registry.options(db, ref, filters),
    'registry.save': ({ entity, data }) => registry.save(db, me(), entity, data),
    'registry.remove': ({ entity, id }) => { registry.remove(db, me(), entity, id); return true; },

    'dashboard.summary': () => dashboard(db),

    'commitments.pairs': () => commitments.pairs(db),
    'commitments.build': ({ vendorId, serviceId, asOf }) => commitments.build(db, vendorId, serviceId, asOf || undefined),
    'commitments.issuePdf': ({ vendorId, serviceId, asOf }) => documents.issueCommitmentReport(db, ctx, me(), vendorId, serviceId, asOf || undefined),

    'incidents.list': (f) => incidents.list(db, f || {}),
    'incidents.get': ({ id }) => withMeta(id),
    'incidents.create': (data) => incidents.create(db, me(), data),
    'incidents.update': ({ id, data }) => { incidents.update(db, me(), id, data); return withMeta(id); },
    'incidents.remove': ({ id }) => { incidents.removeDraft(db, me(), id); return true; },
    'incidents.saveChild': ({ reportId, kind, data }) => { incidents.saveChild(db, me(), reportId, kind, data); return withMeta(reportId); },
    'incidents.deleteChild': ({ reportId, kind, id }) => { incidents.deleteChild(db, me(), reportId, kind, id); return withMeta(reportId); },
    'incidents.approvePause': ({ reportId, pauseId, approved }) => { incidents.approvePause(db, me(), reportId, pauseId, approved); return withMeta(reportId); },
    'incidents.verifyAction': ({ reportId, actionId, verified }) => { incidents.verifyVendorAction(db, me(), reportId, actionId, verified); return withMeta(reportId); },
    'incidents.calculateSla': ({ id }) => { incidents.calculateSla(db, me(), id); return withMeta(id); },
    'incidents.previewPdf': async ({ id }) => (await documents.previewIncident(db, ctx, me(), id)).toString('base64'),
    'incidents.finalize': async ({ id }) => {
      const res = await finalize.finalize(db, ctx, me(), id);
      return { ...res, report: withMeta(id) };
    },

    'evidence.add': (args) => evidence.add(db, ctx, me(), args),
    'evidence.read': ({ id }) => evidence.read(db, ctx, me(), id),
    'evidence.verify': ({ id }) => evidence.verify(db, ctx, id),

    'documents.list': () => documents.list(db),
    'documents.read': ({ id }) => documents.read(db, ctx, me(), id),
    'documents.verify': ({ id }) => documents.verify(db, ctx, id),
    'documents.verifyFile': ({ dataBase64 }) => documents.verifyBytes(db, Buffer.from(dataBase64, 'base64')),
    'documents.open': async ({ id }) => {
      if (!ctx.openPath) throw new AppError('Opening files is only available in the desktop app.', 'UNSUPPORTED');
      const d = db.get('SELECT * FROM report_document WHERE document_id = ?', [id]);
      if (!d) throw new AppError('Document not found.', 'NOT_FOUND');
      audit.record(db, me(), 'DOCUMENT_OPENED', 'report_document', id);
      await ctx.openPath(documents.docPath(ctx, d));
      return true;
    },

    'audit.list': (f) => audit.list(db, f || {}),
    'audit.verify': () => audit.verifyChain(db),

    'settings.all': () => settings.all(db),
    'settings.set': ({ key, value }) => {
      const out = settings.set(db, me(), key, value);
      if (key === 'owner_profile') bootstrap.syncOwner(db);
      return out;
    },

    'db.ddl': ({ dialect }) => generate(dialect),
    'db.migrationScript': ({ dialect }) => {
      const sql = buildMigrationScript(db, dialect);
      audit.record(db, me(), 'DATABASE_EXPORTED', 'database', dialect, { details: { bytes: sql.length } });
      return sql;
    },
    'db.info': () => ({ file: ctx.dbFile, dataDir: ctx.paths.data, evidenceDir: ctx.paths.evidence, documentsDir: ctx.paths.documents }),
  };

  async function invoke(channel, args) {
    const h = handlers[channel];
    if (!h) return { ok: false, error: { message: `Unknown request ${channel}`, code: 'NOT_FOUND' } };
    try {
      return { ok: true, data: await h(args || {}) };
    } catch (e) {
      if (e.userFacing) return { ok: false, error: { message: e.message, code: e.code } };
      ctx.log && ctx.log(`[${channel}]`, e);
      const m = String(e.message || e);
      if (/locked: approved records|append-only/.test(m)) return { ok: false, error: { message: 'This record is finalised and locked. It can no longer be changed.', code: 'LOCKED' } };
      return { ok: false, error: { message: `Something went wrong while processing "${channel}". Details were written to the application log.`, code: 'INTERNAL', detail: m } };
    }
  }

  return { invoke, channels: Object.keys(handlers) };
}

// ------------------------------------------------------------------ dashboard
function dashboard(db) {
  const today = new Date().toISOString().slice(0, 10);
  const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const counts = {
    vendors: db.value("SELECT COUNT(*) FROM vendor WHERE status = 'ACTIVE'"),
    criticalVendors: db.value("SELECT COUNT(*) FROM vendor WHERE status = 'ACTIVE' AND risk_tier IN ('CRITICAL','HIGH')"),
    services: db.value('SELECT COUNT(*) FROM service'),
    openReports: db.value("SELECT COUNT(*) FROM incident_report WHERE status IN ('DRAFT','RETURNED')"),
    finalisedThisMonth: db.value("SELECT COUNT(*) FROM incident_report WHERE status = 'LOCKED' AND locked_at >= ?", [monthStart]),
    breachesThisMonth: db.value("SELECT COUNT(*) FROM incident_sla_result x JOIN incident_report r ON r.report_id = x.report_id WHERE x.outcome = 'BREACHED' AND r.detected_at >= ?", [monthStart]),
    criticalBreachesThisMonth: db.value("SELECT COUNT(*) FROM incident_sla_result x JOIN incident_report r ON r.report_id = x.report_id WHERE x.outcome = 'BREACHED' AND x.is_critical = 1 AND r.detected_at >= ?", [monthStart]),
    overdueActions: db.value("SELECT COUNT(*) FROM action_issue WHERE status NOT IN ('CLOSED','CANCELLED') AND due_date < ?", [today]),
    unlinkedSlas: db.value("SELECT COUNT(*) FROM sla_definition d WHERE d.approval_status = 'APPROVED' AND NOT EXISTS (SELECT 1 FROM sla_contract_mapping m WHERE m.sla_id = d.sla_id)"),
    servicesWithoutOwner: db.value('SELECT COUNT(*) FROM service WHERE service_owner_id IS NULL OR technical_owner_id IS NULL'),
  };
  const expiring = db.all(
    `SELECT c.contract_id, c.contract_no, c.title, c.end_date, c.notice_period_days, v.legal_name FROM contract c JOIN vendor v ON v.vendor_id = c.vendor_id
      WHERE c.status = 'ACTIVE' AND c.end_date IS NOT NULL AND c.end_date <= ? ORDER BY c.end_date`, [in90]);
  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const trend = months.map((m) => ({
    month: m,
    incidents: db.value('SELECT COUNT(*) FROM incident_report WHERE substr(detected_at, 1, 7) = ?', [m]),
    breaches: db.value("SELECT COUNT(*) FROM incident_sla_result x JOIN incident_report r ON r.report_id = x.report_id WHERE x.outcome = 'BREACHED' AND substr(r.detected_at, 1, 7) = ?", [m]),
  }));
  const vendorHealth = db.all(
    `SELECT v.vendor_id, v.legal_name, v.risk_tier,
            (SELECT COUNT(*) FROM incident_report r WHERE r.vendor_id = v.vendor_id AND r.detected_at >= date('now', '-90 days')) AS incidents_90d,
            (SELECT COUNT(*) FROM incident_sla_result x JOIN incident_report r ON r.report_id = x.report_id WHERE r.vendor_id = v.vendor_id AND x.outcome = 'BREACHED' AND r.detected_at >= date('now', '-90 days')) AS breaches_90d,
            (SELECT COUNT(*) FROM incident_sla_result x JOIN incident_report r ON r.report_id = x.report_id WHERE r.vendor_id = v.vendor_id AND x.outcome = 'BREACHED' AND x.is_critical = 1 AND r.detected_at >= date('now', '-90 days')) AS critical_90d,
            (SELECT COUNT(*) FROM action_issue a WHERE a.vendor_id = v.vendor_id AND a.status NOT IN ('CLOSED','CANCELLED')) AS open_actions
       FROM vendor v WHERE v.status = 'ACTIVE' ORDER BY critical_90d DESC, breaches_90d DESC, v.legal_name`);
  const v = (sql) => db.value(sql);
  const setup = [
    { key: 'sections', label: 'Add the bank sections (IT sections and Vendor Management)', done: v('SELECT COUNT(*) FROM bank_section') > 0, href: '#/r/bank_section' },
    { key: 'profile', label: 'Enter your name and job title (printed on reports)', done: !!(settings.get(db, 'owner_profile') || {}).confirmed, href: '#/settings' },
    { key: 'vendors', label: 'Register vendors and their escalation contacts', done: v('SELECT COUNT(*) FROM vendor') > 0, href: '#/r/vendor' },
    { key: 'services', label: 'Register services with their IT section and owners', done: v('SELECT COUNT(*) FROM service') > 0, href: '#/r/service' },
    { key: 'contracts', label: 'Add contracts, an approved version and its clauses', done: v('SELECT COUNT(*) FROM contract_clause') > 0, href: '#/r/contract' },
    { key: 'links', label: 'Link each vendor to the services it provides (open the vendor, then "Services provided")', done: v('SELECT COUNT(*) FROM vendor_service') > 0, href: '#/r/vendor' },
    { key: 'slas', label: 'Define approved SLAs and map them to contract clauses', done: v("SELECT COUNT(*) FROM sla_contract_mapping m JOIN sla_definition d ON d.sla_id = m.sla_id WHERE d.approval_status = 'APPROVED'") > 0, href: '#/r/sla_definition' },
  ];
  return { counts, expiring, trend, vendorHealth, recent: incidents.list(db, {}).slice(0, 6), setup };
}

module.exports = { createApi };
