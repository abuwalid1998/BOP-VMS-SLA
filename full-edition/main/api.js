'use strict';
/**
 * Single entry point for every request from the user interface.
 * The Electron preload exposes only `invoke(channel, args)`; this router
 * enforces authentication and roles, and maps channels to services.
 */
const { AppError } = require('./services/util');
const auth = require('./services/auth');
const audit = require('./services/audit');
const registry = require('./services/registry');
const commitments = require('./services/commitments');
const incidents = require('./services/incidents');
const approvals = require('./services/approvals');
const evidence = require('./services/evidence');
const settings = require('./services/settings');
const documents = require('./report/documents');
const { generate } = require('./db/ddl');
const { buildMigrationScript } = require('./db/migrate');
const bootstrap = require('./db/bootstrap');

function createApi(ctx) {
  const session = { user: null };
  const db = ctx.db;

  const me = () => {
    if (!session.user) throw new AppError('Your session has ended. Sign in again.', 'AUTH');
    // refresh from DB so role/active changes apply immediately
    const u = db.get('SELECT * FROM app_user WHERE user_id = ?', [session.user.user_id]);
    if (!u || !u.active) { session.user = null; throw new AppError('Your account is no longer active.', 'AUTH'); }
    session.user = auth.publicUser(u);
    return session.user;
  };
  const requireRole = (roles) => {
    const u = me();
    if (!roles.includes(u.role_code)) throw new AppError('Your role does not allow this action.', 'FORBIDDEN');
    return u;
  };

  const withApproval = (id) => ({ ...incidents.get(db, id), approval: approvals.forReport(db, me(), id) });

  const handlers = {
    // ---------------------------------------------------------------- first run
    'setup.status': () => ({ needsSetup: bootstrap.needsSetup(db) }),
    'setup.createAdmin': (data) => {
      const admin = bootstrap.createFirstAdmin(db, {
        username: data.username, full_name: data.full_name, job_title: data.job_title, email: data.email, password: data.password,
      });
      session.user = auth.login(db, admin.username, data.password);
      return session.user;
    },

    // ---------------------------------------------------------------- session
    'auth.login': ({ username, password }) => { session.user = auth.login(db, username, password); return session.user; },
    'auth.logout': () => { if (session.user) audit.record(db, session.user, 'LOGOUT', 'app_user', session.user.user_id); session.user = null; return true; },
    'auth.me': () => (session.user ? me() : null),
    'auth.changePassword': ({ current, next }) => { auth.changePassword(db, me(), current, next); return true; },

    // ---------------------------------------------------------------- metadata
    'meta.entities': () => { me(); return registry.meta(); },
    'meta.roles': () => auth.ROLES,
    'meta.enums': () => incidents.ENUMS,

    // ---------------------------------------------------------------- registry
    'registry.list': ({ entity, filters }) => { me(); return registry.list(db, entity, filters); },
    'registry.get': ({ entity, id }) => { me(); return registry.get(db, entity, id); },
    'registry.options': ({ ref, filters }) => { me(); return registry.options(db, ref, filters); },
    'registry.save': ({ entity, data }) => registry.save(db, me(), entity, data),
    'registry.remove': ({ entity, id }) => { registry.remove(db, me(), entity, id); return true; },

    // ---------------------------------------------------------------- dashboard
    'dashboard.summary': () => dashboard(db, me()),

    // ---------------------------------------------------------------- feature 1
    'commitments.pairs': () => { me(); return commitments.pairs(db); },
    'commitments.build': ({ vendorId, serviceId, asOf }) => { me(); return commitments.build(db, vendorId, serviceId, asOf || undefined); },
    'commitments.issuePdf': ({ vendorId, serviceId, asOf }) => documents.issueCommitmentReport(db, ctx, me(), vendorId, serviceId, asOf || undefined),

    // ---------------------------------------------------------------- feature 2
    'incidents.list': (f) => { me(); return incidents.list(db, f || {}); },
    'incidents.get': ({ id }) => withApproval(id),
    'incidents.create': (data) => incidents.create(db, me(), data),
    'incidents.update': ({ id, data }) => { incidents.update(db, me(), id, data); return withApproval(id); },
    'incidents.remove': ({ id }) => { incidents.removeDraft(db, me(), id); return true; },
    'incidents.saveChild': ({ reportId, kind, data }) => { incidents.saveChild(db, me(), reportId, kind, data); return withApproval(reportId); },
    'incidents.deleteChild': ({ reportId, kind, id }) => { incidents.deleteChild(db, me(), reportId, kind, id); return withApproval(reportId); },
    'incidents.approvePause': ({ reportId, pauseId, approved }) => { incidents.approvePause(db, me(), reportId, pauseId, approved); return withApproval(reportId); },
    'incidents.verifyAction': ({ reportId, actionId, verified }) => { incidents.verifyVendorAction(db, me(), reportId, actionId, verified); return withApproval(reportId); },
    'incidents.calculateSla': ({ id }) => { incidents.calculateSla(db, me(), id); return withApproval(id); },
    'incidents.previewPdf': async ({ id }) => (await documents.previewIncident(db, ctx, me(), id)).toString('base64'),

    'approvals.submit': ({ id }) => { approvals.submit(db, me(), id); return withApproval(id); },
    'approvals.withdraw': ({ id, reason }) => { approvals.withdraw(db, me(), id, reason); return withApproval(id); },
    'approvals.sign': async (args) => {
      const user = me();
      const res = approvals.sign(db, user, args);
      if (res.outcome === 'FULLY_APPROVED') {
        try {
          res.document = await documents.finalizeIncident(db, ctx, user, args.reportId);
        } catch (e) {
          res.finalizeError = e.userFacing ? e.message : 'The final PDF could not be produced. Use "Generate locked PDF" to retry.';
          ctx.log && ctx.log('finalize failed', e);
        }
      }
      return { ...res, report: withApproval(args.reportId) };
    },
    'approvals.finalize': async ({ id }) => {
      const u = requireRole(['VM_SECTION_HEAD', 'ADMIN', 'CIO', 'VENDOR_MANAGER']);
      await documents.finalizeIncident(db, ctx, u, id);
      return withApproval(id);
    },
    'approvals.verify': ({ id }) => { me(); return approvals.verifySignatures(db, id); },
    'approvals.inbox': () => approvals.inbox(db, me()),
    'approvals.policy': () => { me(); return approvals.policy(db); },
    'approvals.savePolicy': ({ rows }) => approvals.savePolicy(db, me(), rows),

    'evidence.add': (args) => evidence.add(db, ctx, me(), args),
    'evidence.read': ({ id }) => evidence.read(db, ctx, me(), id),
    'evidence.verify': ({ id }) => { me(); return evidence.verify(db, ctx, id); },

    'documents.list': () => { me(); return documents.list(db); },
    'documents.read': ({ id }) => documents.read(db, ctx, me(), id),
    'documents.verify': ({ id }) => { me(); return documents.verify(db, ctx, id); },
    'documents.verifyFile': ({ dataBase64 }) => { me(); return documents.verifyBytes(db, Buffer.from(dataBase64, 'base64')); },
    'documents.open': async ({ id }) => {
      const u = me();
      if (!ctx.openPath) throw new AppError('Opening files is only available in the desktop app.', 'UNSUPPORTED');
      const d = db.get('SELECT * FROM report_document WHERE document_id = ?', [id]);
      if (!d) throw new AppError('Document not found.', 'NOT_FOUND');
      audit.record(db, u, 'DOCUMENT_OPENED', 'report_document', id);
      await ctx.openPath(documents.docPath(ctx, d));
      return true;
    },

    // ---------------------------------------------------------------- governance
    'audit.list': (f) => { requireRole(['ADMIN', 'VM_SECTION_HEAD', 'AUDITOR', 'CIO']); return audit.list(db, f || {}); },
    'audit.verify': () => { requireRole(['ADMIN', 'VM_SECTION_HEAD', 'AUDITOR', 'CIO']); return audit.verifyChain(db); },

    'admin.users': () => { me(); return auth.listUsers(db); },
    'admin.createUser': (data) => auth.createUser(db, requireRole(['ADMIN']), data),
    'admin.updateUser': ({ id, data }) => { auth.updateUser(db, requireRole(['ADMIN']), id, data); return true; },
    'admin.resetPassword': ({ id, password }) => { auth.adminResetPassword(db, requireRole(['ADMIN']), id, password); return true; },
    'settings.all': () => { me(); return settings.all(db); },
    'settings.set': ({ key, value }) => settings.set(db, requireRole(['ADMIN', 'VM_SECTION_HEAD']), key, value),

    'db.ddl': ({ dialect }) => { requireRole(['ADMIN']); return generate(dialect); },
    'db.migrationScript': ({ dialect }) => {
      const u = requireRole(['ADMIN']);
      const sql = buildMigrationScript(db, dialect);
      audit.record(db, u, 'DATABASE_EXPORTED', 'database', dialect, { details: { bytes: sql.length } });
      return sql;
    },
    'db.info': () => { requireRole(['ADMIN']); return { file: ctx.dbFile, dataDir: ctx.paths.data, evidenceDir: ctx.paths.evidence, documentsDir: ctx.paths.documents }; },
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
      if (/locked: approved records|append-only/.test(m)) return { ok: false, error: { message: m.replace(/^.*?:\s*/, ''), code: 'LOCKED' } };
      return { ok: false, error: { message: `Something went wrong while processing "${channel}". Details were written to the application log.`, code: 'INTERNAL', detail: m } };
    }
  }

  return { invoke, session, channels: Object.keys(handlers) };
}

// ------------------------------------------------------------------ dashboard
function dashboard(db, user) {
  const today = new Date().toISOString().slice(0, 10);
  const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const counts = {
    vendors: db.value("SELECT COUNT(*) FROM vendor WHERE status = 'ACTIVE'"),
    criticalVendors: db.value("SELECT COUNT(*) FROM vendor WHERE status = 'ACTIVE' AND risk_tier IN ('CRITICAL','HIGH')"),
    services: db.value('SELECT COUNT(*) FROM service'),
    openReports: db.value("SELECT COUNT(*) FROM incident_report WHERE status IN ('DRAFT','RETURNED','IN_APPROVAL')"),
    inApproval: db.value("SELECT COUNT(*) FROM incident_report WHERE status = 'IN_APPROVAL'"),
    breachesThisMonth: db.value("SELECT COUNT(*) FROM incident_sla_result x JOIN incident_report r ON r.report_id = x.report_id WHERE x.outcome = 'BREACHED' AND r.detected_at >= ?", [monthStart]),
    criticalBreachesThisMonth: db.value("SELECT COUNT(*) FROM incident_sla_result x JOIN incident_report r ON r.report_id = x.report_id WHERE x.outcome = 'BREACHED' AND x.is_critical = 1 AND r.detected_at >= ?", [monthStart]),
    overdueActions: db.value("SELECT COUNT(*) FROM action_issue WHERE status NOT IN ('CLOSED','CANCELLED') AND due_date < ?", [today]),
    unlinkedSlas: db.value("SELECT COUNT(*) FROM sla_definition d WHERE d.approval_status = 'APPROVED' AND NOT EXISTS (SELECT 1 FROM sla_contract_mapping m WHERE m.sla_id = d.sla_id)"),
    servicesWithoutOwner: db.value('SELECT COUNT(*) FROM service WHERE service_owner_id IS NULL OR technical_owner_id IS NULL'),
    myApprovals: approvals.inbox(db, user).length,
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
    { key: 'people', label: 'Add people with their roles: IT Section Heads, Vendor Management Section Head, CIO, owners', done: v("SELECT COUNT(*) FROM app_user WHERE role_code <> 'ADMIN'") > 0, href: '#/admin' },
    { key: 'heads', label: 'Assign a head to every section (they sign technical validation)', done: v('SELECT COUNT(*) FROM bank_section') > 0 && v('SELECT COUNT(*) FROM bank_section WHERE head_user_id IS NULL AND active = 1') === 0, href: '#/r/bank_section' },
    { key: 'vendors', label: 'Register vendors and their escalation contacts', done: v('SELECT COUNT(*) FROM vendor') > 0, href: '#/r/vendor' },
    { key: 'services', label: 'Register services with their IT section and owners', done: v('SELECT COUNT(*) FROM service') > 0, href: '#/r/service' },
    { key: 'contracts', label: 'Add contracts, an approved version and its clauses', done: v('SELECT COUNT(*) FROM contract_clause') > 0, href: '#/r/contract' },
    { key: 'links', label: 'Link each vendor to the services it provides (open the vendor, then "Services provided")', done: v('SELECT COUNT(*) FROM vendor_service') > 0, href: '#/r/vendor' },
    { key: 'slas', label: 'Define approved SLAs and map them to contract clauses', done: v("SELECT COUNT(*) FROM sla_contract_mapping m JOIN sla_definition d ON d.sla_id = m.sla_id WHERE d.approval_status = 'APPROVED'") > 0, href: '#/r/sla_definition' },
  ];
  return { counts, expiring, trend, vendorHealth, recent: incidents.list(db, {}).slice(0, 6), setup };
}

module.exports = { createApi };
