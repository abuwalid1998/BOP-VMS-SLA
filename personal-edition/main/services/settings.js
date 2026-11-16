'use strict';
const { nowIso, AppError } = require('./util');
const audit = require('./audit');
const { DEFAULT_CALENDAR } = require('./sla-calc');

const DEFAULTS = {
  business_calendar: DEFAULT_CALENDAR,
  organisation: { name: 'Bank of Palestine', name_ar: 'بنك فلسطين', unit: 'Vendor Management Section' },
  rca_due_business_days: 5,
  owner_profile: { full_name: 'Vendor Management Section Head', job_title: 'Vendor Management Section Head', email: '', confirmed: false },
};

function get(db, key) {
  const row = db.get('SELECT setting_value FROM app_setting WHERE setting_key = ?', [key]);
  if (!row) return DEFAULTS[key];
  try { return JSON.parse(row.setting_value); } catch (_) { return row.setting_value; }
}

function set(db, actor, key, value) {
  if (!(key in DEFAULTS)) throw new AppError(`Unknown setting ${key}`, 'VALIDATION');
  if (key === 'business_calendar') {
    const ok = value && /^\d{2}:\d{2}$/.test(value.start) && /^\d{2}:\d{2}$/.test(value.end) && Array.isArray(value.days) && value.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) && value.timezone;
    if (!ok) throw new AppError('Business calendar needs a time zone, working days and start/end times (HH:MM).', 'VALIDATION');
    try { new Intl.DateTimeFormat('en-US', { timeZone: value.timezone }); } catch (_) { throw new AppError(`Unknown time zone ${value.timezone}`, 'VALIDATION'); }
    if (value.start >= value.end) throw new AppError('Business day must end after it starts.', 'VALIDATION');
    value.holidays = (value.holidays || []).filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h));
  }
  if (key === 'owner_profile') {
    const name = String((value && value.full_name) || '').trim();
    if (!name) throw new AppError('Enter your name.', 'VALIDATION');
    value = { full_name: name.slice(0, 200), job_title: String(value.job_title || '').trim().slice(0, 200), email: String(value.email || '').trim().slice(0, 200), confirmed: true };
  }
  const before = get(db, key);
  db.tx(() => {
    const json = JSON.stringify(value);
    if (db.get('SELECT 1 FROM app_setting WHERE setting_key = ?', [key])) db.run('UPDATE app_setting SET setting_value = ?, updated_at = ? WHERE setting_key = ?', [json, nowIso(), key]);
    else db.run('INSERT INTO app_setting (setting_key, setting_value, updated_at) VALUES (?,?,?)', [key, json, nowIso()]);
    audit.record(db, actor, 'SETTING_CHANGED', 'app_setting', key, { before, after: value });
  });
  return value;
}

function all(db) {
  return Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, get(db, k)]));
}

module.exports = { get, set, all, DEFAULTS };
