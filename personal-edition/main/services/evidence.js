'use strict';
/**
 * Evidence store. Files are copied into the bank-controlled evidence folder,
 * named by SHA-256, made read-only and registered with their hash, source,
 * capture time and uploader (architecture doc s.7.3 / s.10 provenance).
 * Integrity can be re-checked at any time with verify().
 */
const fs = require('fs');
const path = require('path');
const { AppError, nowIso, sha256 } = require('./util');
const audit = require('./audit');

const MAX_BYTES = 25 * 1024 * 1024;
const BLOCKED_EXT = /\.(exe|bat|cmd|com|msi|ps1|vbs|js|jar|scr|dll|sh)$/i;

function safeName(name) {
  return String(name || 'file').replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, '_').slice(-120);
}

function add(db, ctx, actor, { reportId, name, mimeType, dataBase64, description, source, capturedAt, relatedType, relatedId, classification }) {
  if (!dataBase64) throw new AppError('Choose a file to upload.', 'VALIDATION');
  if (BLOCKED_EXT.test(name || '')) throw new AppError('Executable and script files cannot be stored as evidence.', 'VALIDATION');
  const buf = Buffer.from(dataBase64, 'base64');
  if (buf.length === 0) throw new AppError('The file is empty.', 'VALIDATION');
  if (buf.length > MAX_BYTES) throw new AppError('Evidence files are limited to 25 MB. Store larger files in the DMS and attach a reference.', 'VALIDATION');
  if (reportId) {
    const r = db.get('SELECT status, locked_at FROM incident_report WHERE report_id = ?', [reportId]);
    if (!r) throw new AppError('Incident report not found.', 'NOT_FOUND');
    if (!['DRAFT', 'RETURNED'].includes(r.status)) throw new AppError('Evidence can only be added while the report is a draft or returned for changes.', 'VALIDATION');
  }
  const hash = sha256(buf);
  const rel = path.join(new Date().getUTCFullYear().toString(), hash.slice(0, 2), `${hash}_${safeName(name)}`);
  const abs = path.join(ctx.paths.evidence, rel);
  if (!fs.existsSync(abs)) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf, { mode: 0o444 });
  }
  const { lastId } = db.run(
    `INSERT INTO evidence (object_ref, original_name, mime_type, size_bytes, sha256, source, captured_at, classification, description, report_id, related_type, related_id, uploaded_by, uploaded_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [rel.split(path.sep).join('/'), String(name).slice(0, 300), mimeType || null, buf.length, hash, source || 'Manual upload', capturedAt || null,
      classification || 'INTERNAL', description || null, reportId || null, relatedType || null, relatedId || null, actor.user_id, nowIso()],
  );
  audit.record(db, actor, 'EVIDENCE_ADDED', 'evidence', lastId, { details: { sha256: hash, name, reportId } });
  return db.get('SELECT * FROM evidence WHERE evidence_id = ?', [lastId]);
}

function filePath(ctx, row) {
  const abs = path.resolve(ctx.paths.evidence, row.object_ref);
  if (!abs.startsWith(path.resolve(ctx.paths.evidence))) throw new AppError('Invalid evidence path.', 'VALIDATION');
  return abs;
}

function read(db, ctx, actor, id) {
  const row = db.get('SELECT * FROM evidence WHERE evidence_id = ?', [id]);
  if (!row) throw new AppError('Evidence not found.', 'NOT_FOUND');
  const buf = fs.readFileSync(filePath(ctx, row));
  const intact = sha256(buf) === row.sha256;
  audit.record(db, actor, 'EVIDENCE_VIEWED', 'evidence', id, { details: { intact } });
  return { ...row, intact, dataBase64: buf.toString('base64') };
}

function verify(db, ctx, id) {
  const row = db.get('SELECT * FROM evidence WHERE evidence_id = ?', [id]);
  if (!row) throw new AppError('Evidence not found.', 'NOT_FOUND');
  const p = filePath(ctx, row);
  if (!fs.existsSync(p)) return { ok: false, reason: 'File is missing from the evidence store.' };
  const actual = sha256(fs.readFileSync(p));
  return actual === row.sha256 ? { ok: true, sha256: actual } : { ok: false, reason: 'File content does not match the registered SHA-256.', expected: row.sha256, actual };
}

module.exports = { add, read, verify, filePath };
