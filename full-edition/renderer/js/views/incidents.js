// Feature 2: Vendor incident reports - register and creation.
import { call } from '../api.js';
import { esc, table, pill, fmtDT, modal, toInput, fromInput, can, EDITOR_ROLES, icon } from '../ui.js';

export async function newIncident() {
  const pairs = await call('commitments.pairs');
  if (!pairs.length) {
    return modal({ title: 'No vendor services yet', body: '<p>An incident report is raised against a vendor and the service it provides. Register a vendor, a service, and link them (open the vendor, then "Services provided") first.</p>', cancelLabel: 'Close' });
  }
  const vendors = [...new Map(pairs.map((p) => [p.vendor_id, p.legal_name])).entries()];
  return modal({
    title: 'New vendor incident report',
    intro: 'Choose the vendor and the affected service. The report is linked to the contract version in force, so SLA targets and clauses come from the governed catalogue.',
    body: `<div class="form-grid">
      <label class="field"><span class="req">Vendor</span><select name="vendor_id" required><option value=""></option>${vendors.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('')}</select></label>
      <label class="field"><span class="req">Affected service</span><select name="service_id" required disabled><option value="">Choose the vendor first</option></select></label>
      <label class="field wide"><span class="req">Title</span><input name="title" required placeholder="What happened, in a few words"></label>
      <label class="field"><span class="req">Priority</span><select name="priority"><option>P1</option><option selected>P2</option><option>P3</option><option>P4</option></select>
        <span class="help">P1 critical outage · P2 significant degradation · P3 limited impact · P4 minor</span></label>
      <label class="field">Detected at<input type="datetime-local" name="detected_at" value="${toInput(new Date().toISOString())}"></label></div>`,
    submitLabel: 'Create report',
    onOpen: (form) => {
      form.vendor_id.addEventListener('change', () => {
        const opts = pairs.filter((p) => String(p.vendor_id) === form.vendor_id.value);
        form.service_id.innerHTML = opts.length ? opts.map((p) => `<option value="${p.service_id}">${esc(p.service_code)} — ${esc(p.service_name)}</option>`).join('') : '<option value="">No services registered for this vendor</option>';
        form.service_id.disabled = !opts.length;
      });
    },
    onSubmit: async (form) => {
      const r = await call('incidents.create', { vendor_id: form.vendor_id.value, service_id: form.service_id.value, title: form.title.value, priority: form.priority.value, detected_at: fromInput(form.detected_at.value) });
      location.hash = `#/incidents/${r.report_id}`;
      return r;
    },
  });
}

export async function render(root, _p, nav) {
  const saved = JSON.parse(sessionStorage.getItem('incFilters') || '{}');
  const rows = await call('incidents.list', saved);
  if (!nav.isCurrent()) return;
  root.innerHTML = `<div class="page-head"><div class="titles"><h1>Vendor incident reports</h1>
    <div class="sub">Record incident impact, timeline, vendor actions and evidence; calculate SLA compliance; then route the report for technical, vendor-management and executive sign-off.</div></div>
    <div class="actions">${can(...EDITOR_ROLES) ? `<button class="btn primary" id="new">${icon('plus')} New incident report</button>` : ''}</div></div>
    <form class="toolbar" id="filters">
      <input type="search" name="q" placeholder="Report no., title or ITSM ref" value="${esc(saved.q || '')}" aria-label="Search">
      <select name="status" aria-label="Status"><option value="">All statuses</option>${['DRAFT', 'IN_APPROVAL', 'RETURNED', 'APPROVED', 'LOCKED'].map((s) => `<option value="${s}" ${saved.status === s ? 'selected' : ''}>${s === 'LOCKED' ? 'Approved · locked' : s.replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</option>`).join('')}</select>
      <select name="priority" aria-label="Priority"><option value="">All priorities</option>${['P1', 'P2', 'P3', 'P4'].map((p) => `<option ${saved.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
    </form>
    ${table([
    { label: 'Report', render: (r) => `<a href="#/incidents/${r.report_id}"><b>${esc(r.report_no)}</b></a>${r.revision > 1 ? `<div class="small muted">rev ${r.revision}</div>` : ''}` },
    { label: 'Incident', render: (r) => `${esc(r.title)}<div class="small muted">${esc(r.vendor_name)} · ${esc(r.service_code)} ${esc(r.service_name)}</div>` },
    { label: 'Priority', render: (r) => pill(r.priority) },
    { label: 'Detected', render: (r) => `<span class="nowrap">${fmtDT(r.detected_at)}</span>` },
    { label: 'SLA breaches', cls: 'num', render: (r) => (r.critical_breaches ? `<span class="crit-mark" title="Includes a critical SLA">${r.breaches} ◆</span>` : r.breaches) },
    { label: 'Status', render: (r) => `${pill(r.status)}${r.pending_step ? `<div class="small muted">Waiting: ${esc(r.pending_step)}</div>` : ''}` },
  ], rows, { empty: 'No incident reports match these filters.', rowAttr: (r) => `class="clickable" data-id="${r.report_id}"` })}`;
  const f = root.querySelector('#filters');
  const apply = () => { sessionStorage.setItem('incFilters', JSON.stringify({ q: f.q.value, status: f.status.value, priority: f.priority.value })); nav.rerender(); };
  f.addEventListener('change', apply);
  f.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
  root.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && !e.target.closest('a')) location.hash = `#/incidents/${tr.dataset.id}`; });
  const nb = root.querySelector('#new');
  if (nb) nb.onclick = () => newIncident();
}
