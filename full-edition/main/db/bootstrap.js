'use strict';
/**
 * First-run configuration. No sample or demonstration records are created:
 * only the default approval policy (configuration) and, through the setup
 * screen, the first administrator account.
 */
const { nowIso, AppError } = require('../services/util');
const auth = require('../services/auth');
const audit = require('../services/audit');

const DEFAULT_STEPS = [
  [1, 'IT_SECTION_HEAD', 'Technical validation', 'Responsible BOP IT Section Head validates incident facts, timeline and evidence'],
  [2, 'VM_SECTION_HEAD', 'Vendor performance and contractual review', 'Vendor Management Section Head reviews SLA results, remedies and vendor performance'],
  [3, 'CIO', 'Executive approval', 'Chief Information Officer gives executive approval according to severity and policy'],
];

/** Default sign-off policy: CIO always for P1/P2, for P3/P4 only after a critical SLA breach. */
function seedPolicy(db) {
  for (const p of ['P1', 'P2', 'P3', 'P4']) {
    for (const [no, role, label, resp] of DEFAULT_STEPS) {
      const when = role !== 'CIO' || ['P1', 'P2'].includes(p) ? 'ALWAYS' : 'CRITICAL_BREACH';
      db.run('INSERT INTO approval_policy (priority, step_no, role_code, step_label, responsibility, required_when, active, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [p, no, role, label, resp, when, 1, nowIso()]);
    }
  }
}

function ensurePolicy(db) {
  if (!db.value('SELECT COUNT(*) FROM approval_policy')) db.tx(() => seedPolicy(db));
}

const needsSetup = (db) => !db.value('SELECT COUNT(*) FROM app_user');

/** Create the first administrator. Only allowed while the database has no users. */
function createFirstAdmin(db, data) {
  return db.tx(() => {
    if (!needsSetup(db)) throw new AppError('Setup is already complete. Sign in instead.', 'FORBIDDEN');
    ensurePolicy(db);
    const admin = auth.createUser(db, null, { ...data, role_code: 'ADMIN', must_change_password: 0 });
    audit.record(db, admin, 'SYSTEM_INITIALISED', 'app_user', admin.user_id);
    return admin;
  });
}

module.exports = { seedPolicy, ensurePolicy, needsSetup, createFirstAdmin };
