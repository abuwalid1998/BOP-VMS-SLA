'use strict';
/**
 * Personal Edition start-up. No sample records are created. A single owner
 * record is created on first start so the audit trail and the sealed PDFs
 * can name who recorded and finalised each item. There is no password: the
 * application is used by one person on their own Windows account.
 */
const crypto = require('crypto');
const auth = require('../services/auth');
const settings = require('../services/settings');
const { nowIso } = require('../services/util');

const OWNER = 'owner';

function ensureOwner(db) {
  if (db.get('SELECT 1 FROM app_user WHERE username = ?', [OWNER])) return;
  const p = settings.get(db, 'owner_profile');
  // Random secret that nobody needs: it only protects the unused signing key.
  const secret = `Aa1!${crypto.randomBytes(24).toString('base64')}`;
  auth.createUser(db, null, { username: OWNER, full_name: p.full_name, job_title: p.job_title, role_code: 'VM_SECTION_HEAD', password: secret });
}

function owner(db) {
  return auth.publicUser(db.get('SELECT * FROM app_user WHERE username = ?', [OWNER]));
}

/** Copy the profile (name, job title, e-mail) onto the owner record. */
function syncOwner(db) {
  const p = settings.get(db, 'owner_profile');
  db.run('UPDATE app_user SET full_name = ?, job_title = ?, email = ?, updated_at = ? WHERE username = ?', [p.full_name, p.job_title || null, p.email || null, nowIso(), OWNER]);
}

module.exports = { ensureOwner, owner, syncOwner };
