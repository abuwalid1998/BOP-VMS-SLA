'use strict';
/**
 * Deterministic SLA compliance engine for a single vendor incident.
 *
 * Pure functions: given the incident, the applicable SLA definitions, the
 * approved clock pauses, the business calendar and the month's other
 * outages, it returns one result per SLA. The same inputs always give the
 * same outputs, so every result is reproducible (architecture doc s.1 #3).
 *
 * Clock rules (CALC_VERSION incident-v1):
 *   INCIDENT_RESPONSE     reported_at -> acknowledged_at (pauses not applied)
 *   INCIDENT_RESTORATION  reported_at -> restored_at, minus approved pauses
 *   INCIDENT_RESOLUTION   reported_at -> resolved_at, minus approved pauses
 *   RCA_DELIVERY          restored_at -> rca_received_at
 *   AVAILABILITY          month of outage_start; FULL outages of the service
 *                         in that month (this and other reports) count as
 *                         unavailable minutes over 24x7 eligible minutes.
 * business_hours SLAs count only minutes inside the business calendar.
 */
const CALC_VERSION = 'incident-v1';

const DEFAULT_CALENDAR = { timezone: 'Asia/Hebron', days: [0, 1, 2, 3, 4], start: '08:00', end: '15:00', holidays: [] };

// ------------------------------------------------------------------ time helpers
const offsetCache = new Map();
function tzOffsetMinutes(date, timezone) {
  const hourKey = `${timezone}|${Math.floor(date.getTime() / 3600000)}`;
  if (offsetCache.has(hourKey)) return offsetCache.get(hourKey);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const off = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  offsetCache.set(hourKey, off);
  return off;
}

function localParts(date, timezone) {
  const local = new Date(date.getTime() + tzOffsetMinutes(date, timezone) * 60000);
  return {
    dow: local.getUTCDay(),
    minuteOfDay: local.getUTCHours() * 60 + local.getUTCMinutes(),
    ymd: local.toISOString().slice(0, 10),
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
  };
}

const hm = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };

function isBusinessMinute(date, cal) {
  const p = localParts(date, cal.timezone);
  if (!cal.days.includes(p.dow)) return false;
  if ((cal.holidays || []).includes(p.ymd)) return false;
  return p.minuteOfDay >= hm(cal.start) && p.minuteOfDay < hm(cal.end);
}

/** Minutes between a and b (Date), counting only business minutes when businessOnly. */
function minutesBetween(a, b, cal, businessOnly) {
  if (!a || !b || b <= a) return 0;
  if (!businessOnly) return (b - a) / 60000;
  let count = 0;
  // Walk minute by minute; bounded at 62 days to protect against bad input.
  const limit = Math.min(b.getTime(), a.getTime() + 62 * 86400000);
  for (let t = a.getTime(); t < limit; t += 60000) if (isBusinessMinute(new Date(t), cal)) count += 1;
  return count;
}

function overlapMinutes(start, end, pauses, cal, businessOnly) {
  let total = 0;
  for (const p of pauses) {
    const s = new Date(Math.max(start.getTime(), new Date(p.paused_at).getTime()));
    const e = new Date(Math.min(end.getTime(), new Date(p.resumed_at).getTime()));
    if (e > s) total += minutesBetween(s, e, cal, businessOnly);
  }
  return total;
}

function businessMinutesPerDay(cal) { return Math.max(1, hm(cal.end) - hm(cal.start)); }

function targetMinutes(sla, cal) {
  const v = Number(sla.target_value);
  const business = sla.support_window_code === 'business_hours';
  switch (sla.unit) {
    case 'minutes': return v;
    case 'hours': return v * 60;
    case 'days': return business ? v * businessMinutesPerDay(cal) : v * 1440;
    default: return null;
  }
}

function toUnit(minutes, sla, cal) {
  const business = sla.support_window_code === 'business_hours';
  switch (sla.unit) {
    case 'minutes': return minutes;
    case 'hours': return minutes / 60;
    case 'days': return business ? minutes / businessMinutesPerDay(cal) : minutes / 1440;
    default: return minutes;
  }
}

const round = (n, d = 2) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);
const d = (v) => (v ? new Date(v) : null);
const fmtMin = (m) => {
  const mm = Math.round(m);
  const h = Math.floor(mm / 60);
  return h ? `${h}h ${mm % 60}m` : `${mm}m`;
};

// ------------------------------------------------------------------ applicability
function applicableSlas(report, slas) {
  const at = report.detected_at || report.reported_at || report.created_at;
  const day = at ? String(at).slice(0, 10) : null;
  return slas.filter((s) => s.service_id === report.service_id
    && (!s.vendor_id || s.vendor_id === report.vendor_id)
    && (!s.priority || s.priority === report.priority)
    && s.approval_status === 'APPROVED'
    && (!day || ((!s.effective_from || s.effective_from <= day) && (!s.effective_to || s.effective_to >= day))));
}

// ------------------------------------------------------------------ evaluation
function evaluateClock(sla, report, pauses, cal, { from, to, usePauses, label }) {
  const business = sla.support_window_code === 'business_hours';
  const start = d(report[from]);
  const end = d(report[to]);
  const target = targetMinutes(sla, cal);
  const base = { target_value: sla.target_value, unit: sla.unit, direction: 'lower_is_better' };
  if (!start || !end) {
    const missing = [!start && from, !end && to].filter(Boolean).join(' and ');
    return { ...base, actual_value: null, outcome: 'NOT_MEASURABLE', variance: null,
      detail: { explanation: `${label}: cannot be measured because ${missing.replace(/_/g, ' ')} is not recorded.` } };
  }
  if (end < start) {
    return { ...base, actual_value: null, outcome: 'NOT_MEASURABLE', variance: null,
      detail: { explanation: `${label}: ${to.replace(/_/g, ' ')} is earlier than ${from.replace(/_/g, ' ')}. Correct the timeline.` } };
  }
  const gross = minutesBetween(start, end, cal, business);
  const paused = usePauses ? overlapMinutes(start, end, pauses, cal, business) : 0;
  const net = Math.max(0, gross - paused);
  const actual = round(toUnit(net, sla, cal));
  const met = net <= target;
  const nearLimit = sla.warning_value !== null && sla.warning_value !== undefined && actual > Number(sla.warning_value);
  return {
    ...base,
    actual_value: actual,
    outcome: met ? (nearLimit ? 'AT_RISK' : 'MET') : 'BREACHED',
    variance: round(actual - Number(sla.target_value)),
    detail: {
      clock_start: start.toISOString(), clock_stop: end.toISOString(),
      window: business ? 'business_hours' : '24x7',
      gross_minutes: round(gross), paused_minutes: round(paused), net_minutes: round(net), target_minutes: round(target),
      explanation: `${label}: ${fmtMin(net)}${business ? ' (business hours)' : ''}${paused ? `, after ${fmtMin(paused)} of approved clock pauses` : ''} against a target of ${fmtMin(target)}. ${met ? 'Within target.' : `Exceeded by ${fmtMin(net - target)}.`}`,
    },
  };
}

function evaluateRca(sla, report, cal, now) {
  const business = sla.support_window_code === 'business_hours';
  const start = d(report.restored_at) || d(report.resolved_at);
  const base = { target_value: sla.target_value, unit: sla.unit, direction: 'lower_is_better' };
  if (!start) return { ...base, actual_value: null, outcome: 'NOT_MEASURABLE', variance: null, detail: { explanation: 'RCA delivery: service restoration time is not recorded.' } };
  const target = targetMinutes(sla, cal);
  const received = d(report.rca_received_at);
  const end = received || now;
  const elapsed = minutesBetween(start, end, cal, business);
  const actual = round(toUnit(elapsed, sla, cal));
  if (!received) {
    return { ...base, actual_value: actual, variance: round(actual - Number(sla.target_value)),
      outcome: elapsed > target ? 'BREACHED' : 'AT_RISK',
      detail: { clock_start: start.toISOString(), window: business ? 'business_hours' : '24x7', net_minutes: round(elapsed), target_minutes: round(target),
        explanation: elapsed > target ? `RCA delivery: not received and overdue by ${fmtMin(elapsed - target)}.` : `RCA delivery: not yet received; ${fmtMin(target - elapsed)} remaining.` } };
  }
  const met = elapsed <= target;
  return { ...base, actual_value: actual, variance: round(actual - Number(sla.target_value)), outcome: met ? 'MET' : 'BREACHED',
    detail: { clock_start: start.toISOString(), clock_stop: received.toISOString(), window: business ? 'business_hours' : '24x7', net_minutes: round(elapsed), target_minutes: round(target),
      explanation: `RCA delivery: received after ${fmtMin(elapsed)}${business ? ' (business hours)' : ''} against ${fmtMin(target)}.${report.rca_accepted ? ' RCA accepted by the bank.' : ' RCA not yet accepted by the bank.'}` } };
}

function evaluateAvailability(sla, report, otherOutages, cal) {
  const base = { target_value: sla.target_value, unit: 'percent', direction: 'higher_is_better' };
  const start = d(report.outage_start);
  const end = d(report.outage_end) || d(report.restored_at);
  if (!start || !end || end <= start) {
    return { ...base, actual_value: null, outcome: 'NOT_MEASURABLE', variance: null, detail: { explanation: 'Availability: outage start and end are not both recorded.' } };
  }
  const p = localParts(start, cal.timezone);
  const daysInMonth = new Date(Date.UTC(p.year, p.month + 1, 0)).getUTCDate();
  const eligible = daysInMonth * 1440;
  const countsAsDown = report.outage_type === 'FULL';
  const thisDown = countsAsDown ? (end - start) / 60000 : 0;
  const monthKey = `${p.year}-${String(p.month + 1).padStart(2, '0')}`;
  const others = otherOutages.filter((o) => {
    const os = d(o.outage_start);
    if (!os || o.outage_type !== 'FULL') return false;
    const op = localParts(os, cal.timezone);
    return op.year === p.year && op.month === p.month;
  });
  const otherDown = others.reduce((sum, o) => {
    const oe = d(o.outage_end) || d(o.restored_at);
    return sum + (oe && oe > d(o.outage_start) ? (oe - d(o.outage_start)) / 60000 : 0);
  }, 0);
  const totalDown = thisDown + otherDown;
  const actual = round(((eligible - totalDown) / eligible) * 100, 4);
  const budget = eligible * (1 - Number(sla.target_value) / 100);
  const met = actual >= Number(sla.target_value);
  const warn = sla.warning_value !== null && sla.warning_value !== undefined && actual < Number(sla.warning_value);
  return {
    ...base, actual_value: actual, variance: round(actual - Number(sla.target_value), 4),
    outcome: met ? (warn ? 'AT_RISK' : 'MET') : 'BREACHED',
    detail: {
      month: monthKey, eligible_minutes: eligible, this_incident_minutes: round(thisDown), other_incidents_minutes: round(otherDown),
      other_reports: others.map((o) => o.report_no), downtime_budget_minutes: round(budget), budget_used_pct: round((totalDown / budget) * 100, 1),
      explanation: `Availability ${monthKey}: ${fmtMin(totalDown)} unplanned downtime (${countsAsDown ? fmtMin(thisDown) + ' from this incident' : 'this incident was ' + String(report.outage_type).toLowerCase() + ' and is not counted as unavailable'}${others.length ? `, ${fmtMin(otherDown)} from ${others.length} other report(s)` : ''}) of ${fmtMin(budget)} allowed. Month-to-date ${actual}% against ${sla.target_value}%.`,
    },
  };
}

/**
 * @returns {Array} results ready for incident_sla_result
 */
function calculate({ report, slas, pauses = [], calendar = DEFAULT_CALENDAR, otherOutages = [], now = new Date() }) {
  const cal = { ...DEFAULT_CALENDAR, ...calendar };
  const approvedPauses = pauses.filter((p) => p.approved);
  const results = [];
  for (const sla of applicableSlas(report, slas)) {
    let r;
    switch (sla.metric_code) {
      case 'INCIDENT_RESPONSE':
        r = evaluateClock(sla, report, approvedPauses, cal, { from: 'reported_at', to: 'acknowledged_at', usePauses: false, label: 'Response' }); break;
      case 'INCIDENT_RESTORATION':
        r = evaluateClock(sla, report, approvedPauses, cal, { from: 'reported_at', to: 'restored_at', usePauses: true, label: 'Restoration' }); break;
      case 'INCIDENT_RESOLUTION':
        r = evaluateClock(sla, report, approvedPauses, cal, { from: 'reported_at', to: 'resolved_at', usePauses: true, label: 'Resolution' }); break;
      case 'RCA_DELIVERY':
        r = evaluateRca(sla, report, cal, now); break;
      case 'AVAILABILITY':
        r = evaluateAvailability(sla, report, otherOutages, cal); break;
      default:
        continue; // periodic metrics (backup, patching...) are measured monthly, not per incident
    }
    results.push({
      sla_id: sla.sla_id, sla_code: sla.sla_code, sla_name: sla.name, metric_code: sla.metric_code,
      is_critical: sla.is_critical ? 1 : 0, clause_ref: sla.clause_ref || null, remedy_text: sla.remedy_text || null,
      ...r, calc_detail: r.detail, calc_version: CALC_VERSION,
    });
  }
  return results;
}

function summarize(results) {
  const breached = results.filter((r) => r.outcome === 'BREACHED');
  return {
    total: results.length,
    met: results.filter((r) => r.outcome === 'MET').length,
    atRisk: results.filter((r) => r.outcome === 'AT_RISK').length,
    breached: breached.length,
    notMeasurable: results.filter((r) => r.outcome === 'NOT_MEASURABLE').length,
    criticalBreach: breached.some((r) => r.is_critical),
  };
}

module.exports = { calculate, summarize, minutesBetween, isBusinessMinute, CALC_VERSION, DEFAULT_CALENDAR };
