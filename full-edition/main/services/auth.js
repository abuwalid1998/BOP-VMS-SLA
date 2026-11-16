'use strict';
/**
 * Users, passwords and signing keys.
 *
 * - Passwords: scrypt (N=16384, r=8, p=1) with a per-user salt.
 * - Every user has an Ed25519 key pair. The private key is encrypted with
 *   AES-256-GCM under a key derived from the user's password, so a signature
 *   can only be produced by someone who knows that password at signing time.
 * - Account lockout after 5 failed attempts for 15 minutes.
 *
 * In production, replace password login with the bank SSO/MFA provider and
 * keep the re-authentication step before signing (architecture doc s.10).
 */
const crypto = require('crypto');
const { AppError, nowIso } = require('./util');
const audit = require('./audit');

const ROLES = {
  ADMIN: 'System administrator',
  VM_SECTION_HEAD: 'Vendor Management Section Head',
  VENDOR_MANAGER: 'Vendor Manager',
  IT_SECTION_HEAD: 'IT Section Head',
  CIO: 'Chief Information Officer',
  SERVICE_OWNER: 'Service Owner',
  TECH_OWNER: 'Technical Owner',
  AUDITOR: 'Auditor (read-only)',
};

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const MIN_PASSWORD = 10;

function scrypt(password, salt) {
  return crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) throw new AppError(`Password must be at least ${MIN_PASSWORD} characters.`, 'VALIDATION');
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 3) throw new AppError('Password must mix at least three of: lower case, upper case, digits, symbols.', 'VALIDATION');
}

function fingerprint(publicKeyPem) {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return 'SHA256:' + crypto.createHash('sha256').update(der).digest('base64').replace(/=+$/, '');
}

function encryptPrivateKey(privatePem, password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(privatePem, 'utf8'), cipher.final()]);
  return JSON.stringify({ v: 1, kdf: 'scrypt', salt: salt.toString('hex'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: enc.toString('base64') });
}

function decryptPrivateKey(blob, password) {
  const o = JSON.parse(blob);
  const key = crypto.scryptSync(String(password), Buffer.from(o.salt, 'hex'), 32, { N: 16384, r: 8, p: 1 });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(o.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(o.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(o.data, 'base64')), decipher.final()]).toString('utf8');
}

function newKeyMaterial(password) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return { public_key_pem: publicPem, private_key_enc: encryptPrivateKey(privatePem, password), key_fingerprint: fingerprint(publicPem) };
}

function publicUser(u) {
  if (!u) return null;
  const { password_hash, password_salt, private_key_enc, ...rest } = u;
  return { ...rest, role_label: ROLES[u.role_code] || u.role_code };
}

function createUser(db, actor, data, { skipStrength = false } = {}) {
  const username = String(data.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,60}$/.test(username)) throw new AppError('Username: 3-60 characters, letters, digits, dot, dash or underscore.', 'VALIDATION');
  if (!ROLES[data.role_code]) throw new AppError('Choose a valid role.', 'VALIDATION');
  if (!data.full_name) throw new AppError('Full name is required.', 'VALIDATION');
  if (!skipStrength) checkPasswordStrength(data.password);
  if (db.get('SELECT 1 FROM app_user WHERE username = ?', [username])) throw new AppError('That username is already taken.', 'VALIDATION');
  const salt = crypto.randomBytes(16).toString('hex');
  const keys = newKeyMaterial(data.password);
  const { lastId } = db.run(
    `INSERT INTO app_user (username, full_name, email, job_title, role_code, section_id, password_hash, password_salt,
       public_key_pem, private_key_enc, key_fingerprint, active, must_change_password, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    [username, data.full_name, data.email || null, data.job_title || null, data.role_code, data.section_id || null,
      scrypt(data.password, salt), salt, keys.public_key_pem, keys.private_key_enc, keys.key_fingerprint,
      data.must_change_password ? 1 : 0, nowIso()],
  );
  audit.record(db, actor, 'USER_CREATED', 'app_user', lastId, { after: { username, role_code: data.role_code } });
  return publicUser(db.get('SELECT * FROM app_user WHERE user_id = ?', [lastId]));
}

/** Verify username + password. Returns the full user row (internal use) or throws. */
function verifyCredentials(db, username, password, { purpose = 'LOGIN' } = {}) {
  const u = db.get('SELECT * FROM app_user WHERE username = ?', [String(username || '').trim().toLowerCase()]);
  const generic = new AppError('Username or password is incorrect.', 'AUTH');
  if (!u || !u.active) {
    scrypt(password || 'x', '00'); // equalise timing
    throw generic;
  }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    throw new AppError(`Account locked after repeated failed attempts. Try again after ${new Date(u.locked_until).toLocaleTimeString()}.`, 'AUTH_LOCKED');
  }
  const ok = crypto.timingSafeEqual(Buffer.from(scrypt(password, u.password_salt), 'hex'), Buffer.from(u.password_hash, 'hex'));
  if (!ok) {
    const attempts = u.failed_attempts + 1;
    const lock = attempts >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
    db.run('UPDATE app_user SET failed_attempts = ?, locked_until = ? WHERE user_id = ?', [lock ? 0 : attempts, lock, u.user_id]);
    audit.record(db, publicUser(u), `${purpose}_FAILED`, 'app_user', u.user_id, { details: lock ? 'Account locked' : `Attempt ${attempts}` });
    throw generic;
  }
  if (u.failed_attempts || u.locked_until) db.run('UPDATE app_user SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?', [u.user_id]);
  return u;
}

function login(db, username, password) {
  const u = verifyCredentials(db, username, password);
  db.run('UPDATE app_user SET last_login_at = ? WHERE user_id = ?', [nowIso(), u.user_id]);
  audit.record(db, publicUser(u), 'LOGIN', 'app_user', u.user_id);
  return publicUser(db.get('SELECT * FROM app_user WHERE user_id = ?', [u.user_id]));
}

/** Re-authenticate the signed-in user and unlock their signing key. */
function unlockSigningKey(db, sessionUser, password) {
  const u = verifyCredentials(db, sessionUser.username, password, { purpose: 'SIGNING_AUTH' });
  if (u.user_id !== sessionUser.user_id) throw new AppError('Re-authentication does not match the signed-in user.', 'AUTH');
  let privatePem;
  try {
    privatePem = decryptPrivateKey(u.private_key_enc, password);
  } catch (e) {
    throw new AppError('Signing key could not be unlocked. Ask an administrator to reissue your signing key.', 'AUTH');
  }
  return { user: u, privateKey: crypto.createPrivateKey(privatePem) };
}

function changePassword(db, sessionUser, currentPassword, newPassword) {
  const u = verifyCredentials(db, sessionUser.username, currentPassword, { purpose: 'PASSWORD_CHANGE' });
  checkPasswordStrength(newPassword);
  if (currentPassword === newPassword) throw new AppError('Choose a password different from the current one.', 'VALIDATION');
  const privatePem = decryptPrivateKey(u.private_key_enc, currentPassword);
  const salt = crypto.randomBytes(16).toString('hex');
  db.run('UPDATE app_user SET password_hash = ?, password_salt = ?, private_key_enc = ?, must_change_password = 0, updated_at = ? WHERE user_id = ?',
    [scrypt(newPassword, salt), salt, encryptPrivateKey(privatePem, newPassword), nowIso(), u.user_id]);
  audit.record(db, sessionUser, 'PASSWORD_CHANGED', 'app_user', u.user_id);
}

/**
 * Administrator reset. The old private key cannot be recovered without the old
 * password, so a new key pair is issued. Existing signatures stay verifiable
 * because each signature stores the public key that produced it.
 */
function adminResetPassword(db, actor, userId, newPassword) {
  checkPasswordStrength(newPassword);
  const u = db.get('SELECT * FROM app_user WHERE user_id = ?', [userId]);
  if (!u) throw new AppError('User not found.', 'NOT_FOUND');
  const salt = crypto.randomBytes(16).toString('hex');
  const keys = newKeyMaterial(newPassword);
  db.run(`UPDATE app_user SET password_hash = ?, password_salt = ?, public_key_pem = ?, private_key_enc = ?, key_fingerprint = ?,
            must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?`,
  [scrypt(newPassword, salt), salt, keys.public_key_pem, keys.private_key_enc, keys.key_fingerprint, nowIso(), userId]);
  audit.record(db, actor, 'USER_PASSWORD_RESET', 'app_user', userId, { details: { new_key_fingerprint: keys.key_fingerprint, previous_key_fingerprint: u.key_fingerprint } });
}

function updateUser(db, actor, userId, data) {
  const before = db.get('SELECT * FROM app_user WHERE user_id = ?', [userId]);
  if (!before) throw new AppError('User not found.', 'NOT_FOUND');
  if (data.role_code && !ROLES[data.role_code]) throw new AppError('Choose a valid role.', 'VALIDATION');
  if (actor.user_id === Number(userId) && data.active === 0) throw new AppError('You cannot deactivate your own account.', 'VALIDATION');
  const next = {
    full_name: data.full_name ?? before.full_name,
    email: data.email ?? before.email,
    job_title: data.job_title ?? before.job_title,
    role_code: data.role_code ?? before.role_code,
    section_id: data.section_id === '' ? null : data.section_id ?? before.section_id,
    active: data.active ?? before.active,
  };
  db.run('UPDATE app_user SET full_name=?, email=?, job_title=?, role_code=?, section_id=?, active=?, updated_at=? WHERE user_id=?',
    [next.full_name, next.email, next.job_title, next.role_code, next.section_id, next.active, nowIso(), userId]);
  audit.record(db, actor, 'USER_UPDATED', 'app_user', userId, { before: publicUser(before), after: next });
}

function listUsers(db) {
  return db.all(`SELECT u.*, s.section_name FROM app_user u LEFT JOIN bank_section s ON s.section_id = u.section_id ORDER BY u.full_name`).map(publicUser);
}

module.exports = {
  ROLES, createUser, login, verifyCredentials, unlockSigningKey, changePassword, adminResetPassword,
  updateUser, listUsers, publicUser, fingerprint, checkPasswordStrength,
};
