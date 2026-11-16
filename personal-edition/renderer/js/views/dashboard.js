import { call } from '../api.js';
import { esc, table, pill, fmtDT, fmtDay, daysUntil, state } from '../ui.js';

export async function render(root, _params, nav) {
  const d = await call('dashboard.summary');
  if (!nav.isCurrent()) return;
  const c = d.counts;
  const max = Math.max(1, ...d.trend.map((t) => Math.max(t.incidents, t.breaches)));
  const monthName = (m) => new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
  root.innerHTML = `
  <div class="page-head"><div class="titles"><h1>Vendor management overview</h1>
    <div class="sub">Vendor service health, SLA breaches, contracts ending soon and open actions.</div></div>
    <div class="actions"><a class="btn primary" href="#/incidents">Incident reports</a><a class="btn" href="#/commitments">Service commitments</a></div></div>

  ${d.setup.some((x) => !x.done) ? `<section class="panel"><div class="panel-head"><h2>Getting started</h2><span class="muted">${d.setup.filter((x) => x.done).length} of ${d.setup.length} done</span></div>
    <p class="small muted">Complete these once so commitment reports and incident sign-off have the data they need.</p>
    <ol class="checklist">${d.setup.map((x) => `<li class="${x.done ? 'done' : ''}"><span class="tick" aria-hidden="true">${x.done ? '✓' : ''}</span>${x.done ? esc(x.label) : `<a href="${x.href}">${esc(x.label)}</a>`}${x.done ? '<span class="sr-only"> (done)</span>' : ''}</li>`).join('')}</ol></section>` : ''}
  ${c.criticalBreachesThisMonth ? `<div class="notice bad"><b>Critical override:</b> ${c.criticalBreachesThisMonth} critical SLA breach${c.criticalBreachesThisMonth > 1 ? 'es' : ''} this month. These are escalated regardless of aggregate scores.</div>` : ''}

  <div class="figures">
    <div class="figure"><div class="n">${c.vendors}</div><div class="l">Active vendors · ${c.criticalVendors} critical/high</div></div>
    <div class="figure"><div class="n">${c.openReports}</div><div class="l">Draft incident reports · ${c.finalisedThisMonth} finalised this month</div></div>
    <div class="figure ${c.breachesThisMonth ? 'alert' : ''}"><div class="n">${c.breachesThisMonth}</div><div class="l">SLA breaches this month</div></div>
    <div class="figure ${c.overdueActions ? 'alert' : ''}"><div class="n"><a href="#/r/action_issue">${c.overdueActions}</a></div><div class="l">Overdue corrective actions</div></div>
    <div class="figure ${c.unlinkedSlas ? 'alert' : ''}"><div class="n"><a href="#/r/sla_definition">${c.unlinkedSlas}</a></div><div class="l">Approved SLAs without a contract clause</div></div>
  </div>

  <div class="grid cols-2">
    <section class="panel"><div class="panel-head"><h2>Incidents and breaches, last 6 months</h2></div>
      <div class="bars" role="img" aria-label="Incident reports and SLA breaches per month">${d.trend.map((t) => `<div class="bar-col">
        <div class="val">${t.incidents} · <b style="color:var(--magenta)">${t.breaches}</b></div>
        <div class="bar-pair"><div class="bar inc" style="height:${(t.incidents / max) * 100}%"></div><div class="bar br" style="height:${(t.breaches / max) * 100}%"></div></div>
        <div class="lbl">${monthName(t.month)}</div></div>`).join('')}</div>
      <div class="legend"><span><i style="background:var(--magenta-100)"></i>Incident reports</span><span><i style="background:var(--magenta)"></i>SLA breaches</span></div>
    </section>
    <section class="panel"><div class="panel-head"><h2>Contracts ending within 90 days</h2></div>
      ${table([
    { label: 'Contract', render: (r) => `<a href="#/r/contract/${r.contract_id}">${esc(r.contract_no)}</a><div class="small muted">${esc(r.legal_name)}</div>` },
    { label: 'Ends', render: (r) => `${fmtDay(r.end_date)}<div class="small ${daysUntil(r.end_date) < (r.notice_period_days || 0) ? 'crit-mark' : 'muted'}">${daysUntil(r.end_date)} days${daysUntil(r.end_date) < (r.notice_period_days || 0) ? ' · inside notice period' : ''}</div>` },
    { label: 'Notice', render: (r) => `${r.notice_period_days || '—'} days` },
  ], d.expiring, { empty: 'No active contract ends in the next 90 days.' })}
    </section>
  </div>

  <section class="panel"><div class="panel-head"><h2>Vendor health, last 90 days</h2><span class="muted">Critical breaches are listed first</span></div>
    ${table([
    { label: 'Vendor', render: (r) => `<a href="#/r/vendor/${r.vendor_id}">${esc(r.legal_name)}</a>` },
    { label: 'Tier', render: (r) => pill(r.risk_tier) },
    { label: 'Incidents', cls: 'num', render: (r) => r.incidents_90d },
    { label: 'SLA breaches', cls: 'num', render: (r) => (r.breaches_90d ? `<b>${r.breaches_90d}</b>` : '0') },
    { label: 'Critical breaches', cls: 'num', render: (r) => (r.critical_90d ? `<span class="crit-mark">${r.critical_90d}</span>` : '0') },
    { label: 'Open actions', cls: 'num', render: (r) => r.open_actions },
  ], d.vendorHealth)}
  </section>

  <section class="panel"><div class="panel-head"><h2>Recent incident reports</h2><a href="#/incidents">All reports</a></div>
    ${table([
    { label: 'Report', render: (r) => `<a href="#/incidents/${r.report_id}">${esc(r.report_no)}</a>` },
    { label: 'Title', render: (r) => `${esc(r.title)}<div class="small muted">${esc(r.vendor_name)} · ${esc(r.service_name)}</div>` },
    { label: 'Priority', render: (r) => pill(r.priority) },
    { label: 'Detected', render: (r) => fmtDT(r.detected_at) },
    { label: 'Breaches', cls: 'num', render: (r) => (r.critical_breaches ? `<span class="crit-mark">${r.breaches} ◆</span>` : r.breaches) },
    { label: 'Status', render: (r) => `${pill(r.status)}` },
  ], d.recent)}
  </section>`;
}
