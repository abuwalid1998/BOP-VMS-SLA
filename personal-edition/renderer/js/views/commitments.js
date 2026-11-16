// Feature 1: Service Commitment Report.
import { call } from '../api.js';
import { esc, nl2br, table, pill, fmtDay, fmtDT, fmtUnit, guard, icon, today, toast, showPdf } from '../ui.js';

const clause = (x, p = 'clause') => (x[`${p}_ref`]
  ? `<span class="clause-ref">${esc(x[`${p}_ref`])}</span>${x[`${p}_title`] ? ` ${esc(x[`${p}_title`])}` : ''}${x[`${p}_page`] ? ` <span class="muted small">p.${x[`${p}_page`]}</span>` : ''}${x[`${p}_text`] ? `<span class="clause-quote">“${esc(x[`${p}_text`])}”</span>` : ''}`
  : '<span class="gap-flag">No clause linked</span>');

export async function render(root, [vendorId, serviceId], nav) {
  const pairs = await call('commitments.pairs');
  if (!nav.isCurrent()) return;
  const sel = vendorId && serviceId ? `${vendorId}:${serviceId}` : '';
  const asOf = sessionStorage.getItem('commitAsOf') || today();
  root.innerHTML = `<div class="page-head"><div class="titles"><h1>Service commitment report</h1>
    <div class="sub">Everything a vendor has committed to for one service: SLA targets, support hours, escalation contacts and responsibilities, each linked to the contract clause it comes from.</div></div></div>
    <form class="toolbar" id="pick">
      <label class="field" style="min-width:420px">Vendor and service<select name="pair" required><option value="">Choose a vendor and service</option>
        ${pairs.map((p) => `<option value="${p.vendor_id}:${p.service_id}" ${sel === `${p.vendor_id}:${p.service_id}` ? 'selected' : ''}>${esc(p.legal_name)} — ${esc(p.service_code)} ${esc(p.service_name)}</option>`).join('')}</select></label>
      <label class="field">As of<input type="date" name="asOf" value="${esc(asOf)}"></label>
    </form><div id="report">${sel ? '' : pairs.length ? '<div class="empty">Choose a vendor and service to see their commitments.</div>' : '<div class="empty">No vendor is linked to a service yet. Open a <a href="#/r/vendor">vendor</a> and add the services it provides.</div>'}</div>`;
  const form = root.querySelector('#pick');
  form.addEventListener('change', () => {
    sessionStorage.setItem('commitAsOf', form.asOf.value || today());
    const [v, s] = form.pair.value.split(':');
    if (v && s) { if (location.hash === `#/commitments/${v}/${s}`) nav.rerender(); else location.hash = `#/commitments/${v}/${s}`; }
  });
  if (!sel) return;

  const rep = await call('commitments.build', { vendorId: Number(vendorId), serviceId: Number(serviceId), asOf });
  if (!nav.isCurrent()) return;
  const v = rep.vendor;
  const s = rep.service;
  const cv = rep.contractVersion;
  const pct = rep.coverage.total ? Math.round((rep.coverage.linked / rep.coverage.total) * 100) : 0;

  root.querySelector('#report').innerHTML = `
  <div class="actions" style="justify-content:flex-end;margin-bottom:12px">
    <a class="btn" href="#/r/vendor_service/${rep.vendorService.vendor_service_id}">Edit commitments</a>
    <button class="btn primary" id="issue">${icon('pdf')} Issue sealed PDF</button></div>
  ${rep.coverage.gaps.length ? `<div class="notice bad"><b>${rep.coverage.gaps.length} commitment${rep.coverage.gaps.length > 1 ? 's are' : ' is'} not linked to a contract clause.</b> An unlinked commitment cannot be enforced. <ul>${rep.coverage.gaps.map((g) => `<li>${esc(g.kind)}: ${esc(g.name)}</li>`).join('')}</ul></div>` : '<div class="notice ok">Every commitment is linked to a clause of the approved contract version.</div>'}

  <div class="grid cols-3">
    <section class="panel"><div class="panel-head"><h2>Vendor</h2></div><dl class="kv">
      <dt>Legal name</dt><dd><a href="#/r/vendor/${v.vendor_id}">${esc(v.legal_name)}</a>${v.legal_name_ar ? `<div dir="rtl" lang="ar">${esc(v.legal_name_ar)}</div>` : ''}</dd>
      <dt>Risk tier</dt><dd>${pill(v.risk_tier)}</dd><dt>Country</dt><dd>${esc(v.country) || '—'}</dd></dl></section>
    <section class="panel"><div class="panel-head"><h2>Service</h2></div><dl class="kv">
      <dt>Service</dt><dd><a href="#/r/service/${s.service_id}">${esc(s.service_code)}</a> ${esc(s.service_name)}</dd>
      <dt>Criticality</dt><dd>${pill(s.criticality)} ${esc(s.service_tower)}</dd>
      <dt>IT section</dt><dd>${esc(s.section_name)}</dd></dl></section>
    <section class="panel"><div class="panel-head"><h2>Contract</h2></div>${cv ? `<dl class="kv">
      <dt>Contract</dt><dd><a href="#/r/contract/${cv.contract_id}">${esc(cv.contract_no)}</a> ${esc(cv.contract_title)}</dd>
      <dt>Version</dt><dd><a href="#/r/contract_version/${cv.version_id}">${esc(cv.version_no)}</a> from ${fmtDay(cv.effective_from)}${cv.effective_to ? ` to ${fmtDay(cv.effective_to)}` : ''}</dd>
      <dt>Term</dt><dd>${fmtDay(cv.start_date)} to ${fmtDay(cv.end_date)}<div class="small muted">${cv.notice_period_days || '—'} days notice</div></dd>
      <dt>Clause coverage</dt><dd><b>${pct}%</b> <span class="muted small">${rep.coverage.linked} of ${rep.coverage.total} commitments</span></dd></dl>` : '<div class="gap-flag">No approved contract version is linked to this vendor service.</div>'}</section>
  </div>
  ${rep.vendorService.scope ? `<section class="panel"><div class="panel-head"><h2>Scope</h2></div><p>${nl2br(rep.vendorService.scope)}</p></section>` : ''}

  <section class="panel"><div class="panel-head"><h2>SLA targets</h2><span class="muted">◆ critical: a breach overrides any aggregate score</span></div>
  ${table([
    { label: 'SLA', render: (x) => `${x.is_critical ? '<span class="crit-mark">◆</span> ' : ''}<a href="#/r/sla_definition/${x.sla_id}" class="nowrap"><b>${esc(x.sla_code)}</b></a><div>${esc(x.name)}</div>${x.exclusions ? `<div class="small muted">Exclusions: ${esc(x.exclusions)}</div>` : ''}` },
    { label: 'Priority', render: (x) => (x.priority ? pill(x.priority) : '<span class="muted">All</span>') },
    { label: 'Target', render: (x) => `<b>${x.direction === 'higher_is_better' ? '≥' : '≤'} ${fmtUnit(x.target_value, x.unit)}</b><div class="small muted">${esc(x.measurement_window.replace(/_/g, ' '))} · ${x.support_window_code === 'business_hours' ? 'business hours' : '24x7'}</div>` },
    { label: 'Contract clause', render: (x) => clause(x) },
    { label: 'Remedy', render: (x) => `${x.remedy_clause_ref ? `<span class="clause-ref">${esc(x.remedy_clause_ref)}</span><br>` : ''}<span class="small">${esc(x.remedy_text) || ''}</span>` },
  ], rep.slas, { empty: 'No approved SLA applies to this service.' })}</section>

  <section class="panel"><div class="panel-head"><h2>Support hours</h2><span class="muted">Times in the stated time zone</span></div>
  ${table([
    { label: 'Cover', render: (w) => `<b>${esc(w.label)}</b>${w.applies_to ? `<div class="small muted">${esc(w.applies_to)}</div>` : ''}` },
    { label: 'Days', key: 'days_of_week' },
    { label: 'Hours', render: (w) => `${esc(w.start_time)}–${esc(w.end_time)}<div class="small muted">${esc(w.timezone)}</div>` },
    { label: 'Channels', key: 'channels' },
    { label: 'Contract clause', render: (w) => clause(w) },
  ], rep.supportHours, { empty: 'Support hours are not defined.' })}</section>

  <div class="grid cols-2">
    <section class="panel"><div class="panel-head"><h2>Vendor escalation contacts</h2></div>
    ${table([
    { label: 'Level', render: (c) => `<b>${c.escalation_level}</b>` },
    { label: 'Contact', render: (c) => `${esc(c.full_name)}<div class="small muted">${esc(c.role_title)}${c.is_primary ? ' · primary' : ''}</div>` },
    { label: 'Reach', render: (c) => `<span class="small">${esc(c.phone)}<br>${esc(c.email)}</span>` },
  ], rep.vendorContacts, { empty: 'No vendor contacts.' })}</section>
  </div>

  <section class="panel"><div class="panel-head"><h2>Responsibilities</h2></div>
  ${table([
    { label: 'Activity', key: 'activity' },
    { label: 'Bank', render: (x) => `${esc(x.bank_party)} ${x.bank_raci ? `<b>${esc(x.bank_raci)}</b>` : ''}` },
    { label: 'Vendor', render: (x) => `${esc(x.vendor_party)} ${x.vendor_raci ? `<b>${esc(x.vendor_raci)}</b>` : ''}` },
    { label: 'Contract clause', render: (x) => clause(x) },
  ], rep.responsibilities, { empty: 'No responsibilities recorded.' })}</section>

  <section class="panel"><div class="panel-head"><h2>Other contractual obligations</h2></div>
  ${table([
    { label: 'Category', render: (x) => pill(x.category) },
    { label: 'Obligation', render: (x) => nl2br(x.description) },
    { label: 'Owners', render: (x) => `<span class="small">Bank: ${esc(x.bank_owner_role) || '—'}<br>Vendor: ${esc(x.vendor_owner_role) || '—'}</span>` },
    { label: 'Frequency', key: 'frequency' },
    { label: 'Contract clause', render: (x) => clause(x) },
  ], rep.obligations, { empty: 'No other obligations recorded.' })}</section>

  <section class="panel"><div class="panel-head"><h2>Recent incidents for this service</h2><a href="#/incidents">All incident reports</a></div>
  ${table([
    { label: 'Report', render: (r) => `<a href="#/incidents/${r.report_id}">${esc(r.report_no)}</a>` },
    { label: 'Title', key: 'title' },
    { label: 'Priority', render: (r) => pill(r.priority) },
    { label: 'Detected', render: (r) => fmtDT(r.detected_at) },
    { label: 'SLA breaches', cls: 'num', render: (r) => r.breaches },
    { label: 'Status', render: (r) => pill(r.status) },
  ], rep.recentIncidents, { empty: 'No incidents recorded for this vendor and service.' })}</section>`;

  root.querySelector('#issue').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const doc = await guard(() => call('commitments.issuePdf', { vendorId: Number(vendorId), serviceId: Number(serviceId), asOf }));
      toast('Sealed commitment report issued and registered.', 'ok');
      const file = await call('documents.read', { id: doc.documentId });
      await showPdf(file.dataBase64, file.fileName);
    } catch (_) { /* toast shown */ } finally { e.target.disabled = false; }
  };
}
