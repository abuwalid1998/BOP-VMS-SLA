// Tamper-evident audit trail.
import { call } from '../api.js';
import { esc, table, fmtDT, guard } from '../ui.js';

export async function render(root, _p, nav) {
  const rows = await call('audit.list', { limit: 500 });
  if (!nav.isCurrent()) return;
  root.innerHTML = `<div class="page-head"><div class="titles"><h1>Activity log</h1>
    <div class="sub">Every change and document event, in order. Each entry carries the hash of the previous one, so edits or deletions outside the application are detectable.</div></div>
    <div class="actions"><button class="btn primary" id="verify">Verify the chain</button></div></div>
    <div id="result"></div>
    <div class="toolbar"><input type="search" id="q" placeholder="Filter by action, object or person" aria-label="Filter"></div>
    <div id="list"></div>`;
  const draw = (q = '') => {
    const ql = q.toLowerCase();
    root.querySelector('#list').innerHTML = table([
      { label: '#', cls: 'num', render: (r) => r.event_id },
      { label: 'When', render: (r) => `<span class="nowrap">${fmtDT(r.occurred_at)}</span>` },
            { label: 'Action', render: (r) => `<b>${esc(r.action.replace(/_/g, ' ').toLowerCase())}</b>` },
      { label: 'Object', render: (r) => `${esc(r.object_type)} ${esc(r.object_id || '')}` },
      { label: 'Details', render: (r) => `<span class="small">${esc((r.details || '').slice(0, 200))}</span>` },
      { label: 'Event hash', render: (r) => `<span class="mono muted">${esc(r.event_hash.slice(0, 16))}…</span>` },
    ], rows.filter((r) => !ql || `${r.action} ${r.object_type} ${r.actor_name} ${r.details}`.toLowerCase().includes(ql)));
  };
  draw();
  root.querySelector('#q').addEventListener('input', (e) => draw(e.target.value));
  root.querySelector('#verify').onclick = async () => {
    const r = await guard(() => call('audit.verify'));
    root.querySelector('#result').innerHTML = r.ok
      ? `<div class="notice ok"><b>Chain intact.</b> All ${r.count} events link correctly and match their hashes.</div>`
      : `<div class="notice bad"><b>Chain broken at event ${r.brokenAt}.</b> ${esc(r.reason)}.</div>`;
  };
}
