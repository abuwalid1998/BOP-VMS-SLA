// Approval inbox: reports waiting for the signed-in user's signature.
import { call } from '../api.js';
import { esc, table, pill, fmtDT, state } from '../ui.js';

export async function render(root, _p, nav) {
  const rows = await call('approvals.inbox');
  if (!nav.isCurrent()) return;
  const role = state.roles[state.user.role_code] || state.user.role_code;
  root.innerHTML = `<div class="page-head"><div class="titles"><h1>My approvals</h1>
    <div class="sub">Incident reports waiting for your signature as ${esc(role)}. Open a report, review it, then sign or return it for changes.</div></div></div>
    ${table([
    { label: 'Report', render: (r) => `<a href="#/incidents/${r.report_id}/approval"><b>${esc(r.report_no)}</b></a>${r.revision > 1 ? `<div class="small muted">rev ${r.revision}</div>` : ''}` },
    { label: 'Incident', render: (r) => `${esc(r.title)}<div class="small muted">${esc(r.vendor_name)} · ${esc(r.service_name)}</div>` },
    { label: 'Priority', render: (r) => pill(r.priority) },
    { label: 'Your step', render: (r) => esc(r.step_label) },
    { label: 'SLA breaches', cls: 'num', render: (r) => (r.critical_breaches ? `<span class="crit-mark">${r.breaches} ◆</span>` : r.breaches) },
    { label: 'Waiting since', render: (r) => fmtDT(r.step_updated_at || r.step_created_at) },
    { label: '', cls: 'row-actions', render: (r) => `<a class="btn primary sm" href="#/incidents/${r.report_id}/approval">Review and sign</a>` },
  ], rows, { empty: 'Nothing is waiting for your signature.' })}`;
}
