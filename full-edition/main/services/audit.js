'use strict';
/**
 * Tamper-evident audit trail. Every event stores the hash of the previous
 * event, so any edit or deletion outside the application breaks the chain
 * and is detected by verifyChain(). The table is also append-only at the
 * database layer (triggers generated in ddl.js).
 */
const { nowIso, sha256, canonical, hashOf } = require('./util');

function record(db, actor, action, objectType, objectId, { before, after, details } = {}) {
  const prev = db.get('SELECT event_hash FROM audit_event ORDER BY event_id DESC LIMIT 1');
  const ev = {
    occurred_at: nowIso(),
    actor_user_id: actor ? actor.user_id : null,
    actor_name: actor ? actor.full_name : 'system',
    action,
    object_type: objectType,
    object_id: objectId === undefined || objectId === null ? null : String(objectId),
    before_hash: before === undefined ? null : hashOf(before),
    after_hash: after === undefined ? null : hashOf(after),
    details: details === undefined ? null : typeof details === 'string' ? details : JSON.stringify(details),
    prev_event_hash: prev ? prev.event_hash : null,
  };
  ev.event_hash = sha256(canonical(ev));
  db.run(
    `INSERT INTO audit_event (occurred_at, actor_user_id, actor_name, action, object_type, object_id, before_hash, after_hash, details, prev_event_hash, event_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [ev.occurred_at, ev.actor_user_id, ev.actor_name, ev.action, ev.object_type, ev.object_id, ev.before_hash, ev.after_hash, ev.details, ev.prev_event_hash, ev.event_hash],
  );
  return ev;
}

function verifyChain(db) {
  const rows = db.all('SELECT * FROM audit_event ORDER BY event_id');
  let prevHash = null;
  for (const r of rows) {
    const { event_id, event_hash, ...rest } = r;
    if (rest.prev_event_hash !== prevHash) return { ok: false, count: rows.length, brokenAt: event_id, reason: 'Previous-event link does not match' };
    if (sha256(canonical(rest)) !== event_hash) return { ok: false, count: rows.length, brokenAt: event_id, reason: 'Event content does not match its hash' };
    prevHash = event_hash;
  }
  return { ok: true, count: rows.length };
}

function list(db, { objectType, objectId, limit = 300 } = {}) {
  const where = [];
  const params = [];
  if (objectType) { where.push('object_type = ?'); params.push(objectType); }
  if (objectId) { where.push('object_id = ?'); params.push(String(objectId)); }
  params.push(Math.min(Number(limit) || 300, 2000));
  return db.all(`SELECT * FROM audit_event ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY event_id DESC LIMIT ?`, params);
}

module.exports = { record, verifyChain, list };
