'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { calculate, minutesBetween, DEFAULT_CALENDAR } = require('../main/services/sla-calc');

const sla = (o) => ({ sla_id: 1, sla_code: 'T', name: 'T', service_id: 1, vendor_id: null, priority: 'P1', approval_status: 'APPROVED', effective_from: '2026-01-01', effective_to: null, is_critical: 0, support_window_code: '24x7', warning_value: null, ...o });
const report = (o) => ({ report_id: 9, service_id: 1, vendor_id: 1, priority: 'P1', detected_at: '2026-10-12T06:00:00Z', ...o });

test('response time breach is measured from report to acknowledgement', () => {
  const [r] = calculate({ report: report({ reported_at: '2026-10-12T06:48:00Z', acknowledged_at: '2026-10-12T07:09:00Z' }), slas: [sla({ metric_code: 'INCIDENT_RESPONSE', target_value: 15, unit: 'minutes' })] });
  assert.equal(r.outcome, 'BREACHED');
  assert.equal(r.actual_value, 21);
  assert.equal(r.variance, 6);
});

test('only bank-approved pauses reduce the restoration clock', () => {
  const s = sla({ metric_code: 'INCIDENT_RESTORATION', target_value: 4, unit: 'hours' });
  const rep = report({ reported_at: '2026-10-12T06:00:00Z', restored_at: '2026-10-12T10:20:00Z' });
  const pause = { paused_at: '2026-10-12T07:00:00Z', resumed_at: '2026-10-12T07:30:00Z' };
  assert.equal(calculate({ report: rep, slas: [s], pauses: [{ ...pause, approved: 0 }] })[0].outcome, 'BREACHED');
  const ok = calculate({ report: rep, slas: [s], pauses: [{ ...pause, approved: 1 }] })[0];
  assert.equal(ok.outcome, 'MET');
  assert.equal(ok.calc_detail.paused_minutes, 30);
});

test('business-hours clock skips nights and the weekend (Asia/Hebron, Sun-Thu 08-15)', () => {
  // Thu 2026-11-12 14:00 local (12:00Z) -> Sun 2026-11-15 09:00 local (07:00Z) = 1h Thu + 1h Sun
  const mins = minutesBetween(new Date('2026-11-12T12:00:00Z'), new Date('2026-11-15T07:00:00Z'), DEFAULT_CALENDAR, true);
  assert.equal(mins, 120);
});

test('availability combines all full outages of the service in the month', () => {
  const s = sla({ metric_code: 'AVAILABILITY', priority: null, target_value: 99.9, unit: 'percent', direction: 'higher_is_better' });
  const rep = report({ outage_type: 'FULL', outage_start: '2026-10-12T06:40:00Z', outage_end: '2026-10-12T07:00:00Z' });
  const other = [{ report_no: 'X', outage_type: 'FULL', outage_start: '2026-10-20T00:00:00Z', outage_end: '2026-10-20T00:30:00Z' }];
  const [r] = calculate({ report: rep, slas: [s], otherOutages: other });
  assert.equal(r.calc_detail.this_incident_minutes, 20);
  assert.equal(r.calc_detail.other_incidents_minutes, 30);
  assert.equal(r.outcome, 'BREACHED'); // 50 min > 44.64 min budget
});

test('missing timestamps are reported as not measurable, not as met', () => {
  const [r] = calculate({ report: report({ reported_at: '2026-10-12T06:48:00Z' }), slas: [sla({ metric_code: 'INCIDENT_RESPONSE', target_value: 15, unit: 'minutes' })] });
  assert.equal(r.outcome, 'NOT_MEASURABLE');
});

test('SLAs for other priorities or unapproved definitions do not apply', () => {
  const out = calculate({ report: report({ reported_at: 'x' }), slas: [sla({ metric_code: 'INCIDENT_RESPONSE', priority: 'P2', target_value: 1, unit: 'minutes' }), sla({ metric_code: 'INCIDENT_RESPONSE', approval_status: 'DRAFT', target_value: 1, unit: 'minutes' })] });
  assert.equal(out.length, 0);
});
