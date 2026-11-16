'use strict';
const crypto = require('crypto');

/** Error whose message is safe to show to the user. */
class AppError extends Error {
  constructor(message, code = 'APP_ERROR') {
    super(message);
    this.code = code;
    this.userFacing = true;
  }
}

const nowIso = () => new Date().toISOString();

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** Deterministic JSON: object keys sorted recursively, so hashes are reproducible. */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

const hashOf = (value) => sha256(canonical(value));

function requireFields(obj, fields) {
  const missing = fields.filter((f) => obj[f] === undefined || obj[f] === null || String(obj[f]).trim() === '');
  if (missing.length) throw new AppError(`Required: ${missing.join(', ')}`, 'VALIDATION');
}

/** Normalize a datetime-local / ISO input to ISO UTC, or null. */
function toIso(v) {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new AppError(`Invalid date/time: ${v}`, 'VALIDATION');
  return d.toISOString();
}

module.exports = { AppError, nowIso, sha256, canonical, hashOf, requireFields, toIso };
