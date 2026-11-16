// Catalogue screens (vendors, services, contracts, SLA catalogue...), driven by backend metadata.
import { call } from '../api.js';
import { state, esc, table, pill, fmtDay, modal, fieldsHtml, readForm, toast, guard, confirmDialog, clearOptionCache, icon } from '../ui.js';

const CHILDREN = {
  vendor: [['vendor_contact', 'vendor_id', 'Escalation contacts'], ['vendor_service', 'vendor_id', 'Services provided'], ['contract', 'vendor_id', 'Contracts'], ['risk_assessment', 'vendor_id', 'Risk assessments'], ['action_issue', 'vendor_id', 'Corrective actions']],
  service: [['vendor_service', 'service_id', 'Vendors providing this service'], ['sla_definition', 'service_id', 'SLA definitions']],
  contract: [['contract_version', 'contract_id', 'Versions']],
  contract_version: [['contract_clause', 'version_id', 'Clauses'], ['sla_contract_mapping', 'version_id', 'SLA to clause mappings'], ['contract_obligation', 'version_id', 'Other obligations']],
  vendor_service: [['support_window', 'vendor_service_id', 'Support hours'], ['responsibility', 'vendor_service_id', 'Responsibilities'], ['contract_obligation', 'vendor_service_id', 'Other obligations']],
  sla_definition: [['sla_contract_mapping', 'sla_id', 'Contract clause mappings']],
};

const INTRO = {
  vendor: 'Every supplier and its risk tier. New vendors get a code automatically (V-0001). Open a vendor to manage contacts, services and contracts.',
  service: 'Bank services and the IT section responsible for each. New services get a code automatically (S-0001).',
  contract: 'Contracts (C-0001) and their versions (v1, v2). Each version holds the clauses that commitments link to.',
  sla_definition: 'SLA definitions (SLA-0001). Only definitions marked Approved are used in calculations and commitment reports.',
  action_issue: 'Corrective and preventive actions from incident reports and reviews.',
  bank_section: 'IT and business sections that own services. Each new section gets a code automatically (SEC-0001).',
};

const canWrite = (m) => m.writeRoles.includes(state.user.role_code);

function cell(meta, f, row) {
  const v = row[f.name];
  if (f.type === 'ref') return esc(row[`${f.name}__label`] || '');
  if (f.type === 'select') {
    if (['risk_tier', 'criticality', 'status', 'rating', 'severity'].includes(f.name) && v) return pill(v);
    const o = f.options.find((x) => String(x.value) === String(v));
    return esc(o ? o.label : v);
  }
  if (f.type === 'bool') return v ? 'Yes' : '';
  if (f.type === 'date') return fmtDay(v);
  if (f.type === 'textarea') return esc(String(v || '').slice(0, 140)) + (String(v || '').length > 140 ? '…' : '');
  if (f.name === 'is_critical') return v ? '<span class="crit-mark">◆ Critical</span>' : '';
  return esc(v);
}

function columnsFor(entity, opts = {}) {
  const m = state.meta[entity];
  return m.list.filter((n) => n !== opts.hide).map((n) => {
    const f = m.fields.find((x) => x.name === n);
    if (!f) return null;
    return { label: f.label, render: (r) => (n === 'is_critical' && r[n] ? '<span class="crit-mark">◆</span>' : cell(m, f, r)) };
  }).filter(Boolean);
}

export async function editRecord(entity, row, { parentField, parentId, onSaved } = {}) {
  const m = state.meta[entity];
  const values = row ? { ...row } : { __new: true, ...(parentField ? { [parentField]: parentId } : {}) };
  const body = await fieldsHtml(m.fields, values);
  return modal({
    title: row ? `Edit ${m.label.toLowerCase()}` : `New ${m.label.toLowerCase()}`,
    body,
    submitLabel: row ? 'Save changes' : `Add ${m.label.toLowerCase()}`,
    onSubmit: async (form) => {
      const data = readForm(form);
      if (parentField && !row) data[parentField] = parentId;
      if (row) data[m.pk] = row[m.pk];
      const saved = await call('registry.save', { entity, data });
      clearOptionCache();
      toast(`${m.label} saved.`, 'ok');
      if (onSaved) await onSaved(saved);
      return saved;
    },
  });
}

async function removeRecord(entity, row, after) {
  const m = state.meta[entity];
  if (!(await confirmDialog(`Delete ${m.label.toLowerCase()}?`, 'This cannot be undone. Records that are referenced elsewhere cannot be deleted.', { submitLabel: 'Delete', danger: true }))) return;
  await guard(() => call('registry.remove', { entity, id: row[m.pk] }), `${m.label} deleted.`);
  clearOptionCache();
  after();
}

async function listPage(root, entity, nav) {
  const m = state.meta[entity];
  if (!m) throw new Error('Unknown catalogue.');
  const rows = await call('registry.list', { entity });
  if (!nav.isCurrent()) return;
  const hasDetail = !!CHILDREN[entity];
  root.innerHTML = `<div class="page-head"><div class="titles"><h1>${esc(m.plural)}</h1><div class="sub">${esc(INTRO[entity] || '')}</div></div>
    <div class="actions">${canWrite(m) ? `<button class="btn primary" id="new">${icon('plus')} New ${esc(m.label.toLowerCase())}</button>` : ''}</div></div>
    <div class="toolbar"><input type="search" id="q" placeholder="Filter ${esc(m.plural.toLowerCase())}" aria-label="Filter"></div>
    <div id="list"></div>`;
  const draw = (q = '') => {
    const ql = q.toLowerCase();
    const filtered = rows.filter((r) => !ql || JSON.stringify(r).toLowerCase().includes(ql));
    root.querySelector('#list').innerHTML = table(columnsFor(entity), filtered, { rowAttr: (r) => `class="clickable" data-id="${r[m.pk]}" tabindex="0"`, empty: `No ${m.plural.toLowerCase()} yet.` });
  };
  draw();
  root.querySelector('#q').addEventListener('input', (e) => draw(e.target.value));
  const open = async (id) => {
    if (hasDetail) { location.hash = `#/r/${entity}/${id}`; return; }
    const row = rows.find((r) => String(r[m.pk]) === String(id));
    if (canWrite(m)) await editRecord(entity, row, { onSaved: () => nav.rerender() });
  };
  root.querySelector('#list').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && !e.target.closest('a')) open(tr.dataset.id); });
  root.querySelector('#list').addEventListener('keydown', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && e.key === 'Enter') open(tr.dataset.id); });
  const nb = root.querySelector('#new');
  if (nb) nb.onclick = () => editRecord(entity, null, { onSaved: (s) => { if (hasDetail) location.hash = `#/r/${entity}/${s[m.pk]}`; else nav.rerender(); } });
}

function titleOf(entity, r) {
  switch (entity) {
    case 'vendor': return r.legal_name;
    case 'service': return `${r.service_code} — ${r.service_name}`;
    case 'contract': return `${r.contract_no} — ${r.title}`;
    case 'contract_version': return `${r.contract_id__label.split(' - ')[0]} version ${r.version_no}`;
    case 'vendor_service': return `${r.vendor_id__label} / ${r.service_id__label}`;
    case 'sla_definition': return `${r.sla_code} — ${r.name}`;
    default: return state.meta[entity].label;
  }
}

function parentCrumb(entity, r) {
  switch (entity) {
    case 'contract_version': return `<a href="#/r/contract/${r.contract_id}">${esc(r.contract_id__label)}</a>`;
    case 'vendor_service': return `<a href="#/r/vendor/${r.vendor_id}">${esc(r.vendor_id__label)}</a>`;
    default: return `<a href="#/r/${entity}">${esc(state.meta[entity].plural)}</a>`;
  }
}

async function detailPage(root, entity, id, nav) {
  const m = state.meta[entity];
  const row = await call('registry.get', { entity, id });
  const kids = CHILDREN[entity] || [];
  const childRows = await Promise.all(kids.map(([e, fk]) => call('registry.list', { entity: e, filters: { [fk]: id } })));
  if (!nav.isCurrent()) return;
  const extra = [];
  if (entity === 'vendor_service') extra.push(`<a class="btn" href="#/commitments/${row.vendor_id}/${row.service_id}">${icon('shield')} Service commitment report</a>`);
  if (entity === 'vendor' || entity === 'service') extra.push(`<a class="btn" href="#/incidents">${icon('alert')} Incident reports</a>`);
  root.innerHTML = `<div class="crumbs">${parentCrumb(entity, row)}</div>
    <div class="page-head"><div class="titles"><h1>${esc(titleOf(entity, row))}</h1>${row.legal_name_ar ? `<div class="sub" dir="rtl" lang="ar">${esc(row.legal_name_ar)}</div>` : ''}</div>
      <div class="actions">${extra.join('')}${canWrite(m) ? `<button class="btn" id="edit">Edit</button><button class="btn danger" id="del">Delete</button>` : ''}</div></div>
    <section class="panel"><dl class="kv">${m.fields.map((f) => `<dt>${esc(f.label)}</dt><dd>${cell(m, f, row) || '<span class="muted">—</span>'}</dd>`).join('')}</dl></section>
    ${kids.map(([e, fk, label], i) => {
    const cm = state.meta[e];
    const detail = !!CHILDREN[e];
    const cols = columnsFor(e, { hide: fk });
    if (canWrite(cm)) cols.push({ label: '', cls: 'row-actions', render: (r) => `${detail ? `<a class="btn ghost sm" href="#/r/${e}/${r[cm.pk]}">Open</a>` : ''}<button class="btn ghost sm" data-edit="${i}:${r[cm.pk]}">Edit</button><button class="btn ghost sm" data-del="${i}:${r[cm.pk]}">Delete</button>` });
    else if (detail) cols.push({ label: '', cls: 'row-actions', render: (r) => `<a class="btn ghost sm" href="#/r/${e}/${r[cm.pk]}">Open</a>` });
    return `<section class="panel"><div class="panel-head"><h2>${esc(label)}</h2>${canWrite(cm) ? `<button class="btn sm" data-add="${i}">${icon('plus')} Add</button>` : ''}</div>${table(cols, childRows[i], { empty: `No ${cm.plural.toLowerCase()} yet.` })}</section>`;
  }).join('')}`;

  const editBtn = root.querySelector('#edit');
  if (editBtn) editBtn.onclick = () => editRecord(entity, row, { onSaved: () => nav.rerender() });
  const delBtn = root.querySelector('#del');
  if (delBtn) delBtn.onclick = () => removeRecord(entity, row, () => { location.hash = `#/r/${entity}`; });
  root.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    const ed = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (add) {
      const [ce, fk] = kids[Number(add.dataset.add)];
      await editRecord(ce, null, { parentField: fk, parentId: Number(id), onSaved: () => nav.rerender() });
    } else if (ed || del) {
      const [i, cid] = (ed || del).dataset[ed ? 'edit' : 'del'].split(':');
      const [ce] = kids[Number(i)];
      const r = childRows[Number(i)].find((x) => String(x[state.meta[ce].pk]) === cid);
      if (ed) await editRecord(ce, r, { onSaved: () => nav.rerender() });
      else await removeRecord(ce, r, () => nav.rerender());
    }
  });
}

export async function render(root, [entity, id], nav) {
  if (id) return detailPage(root, entity, id, nav);
  return listPage(root, entity, nav);
}
