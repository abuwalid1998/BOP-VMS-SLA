// Shared UI helpers: escaping, time zones, dialogs, tables, forms, files.
import { call, isDesktop } from './api.js';

export const state = { user: null, tz: 'Asia/Hebron', meta: null, roles: {} };

export const esc = (v) => (v === null || v === undefined ? '' : String(v)).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const nl2br = (v) => esc(v).replace(/\n/g, '<br>');
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------- time
function partsIn(date, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(date).reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
}
function offsetMs(date, tz) {
  const p = partsIn(date, tz);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(date.getTime() / 1000) * 1000;
}
/** ISO -> value for <input type="datetime-local"> in the bank time zone. */
export function toInput(iso) {
  if (!iso) return '';
  const p = partsIn(new Date(iso), state.tz);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** <input type="datetime-local"> value (bank time zone) -> ISO UTC. */
export function fromInput(v) {
  if (!v) return null;
  const [d, t] = v.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, dd, hh, mi);
  let ts = guess - offsetMs(new Date(guess), state.tz);
  ts = guess - offsetMs(new Date(ts), state.tz);
  return new Date(ts).toISOString();
}
export const fmtDT = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: state.tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—');
export const fmtTime = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: state.tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—');
export const fmtDay = (d) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${String(d).slice(0, 10)}T00:00:00Z`)) : '—');
export const fmtNum = (v, d = 2) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
export const fmtUnit = (v, u) => (v === null || v === undefined ? '—' : `${fmtNum(v, u === 'percent' ? 4 : 2)}${u === 'percent' ? '%' : ` ${u}`}`);
export const daysUntil = (d) => Math.ceil((new Date(`${d}T00:00:00Z`) - new Date()) / 86400000);
export const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- labels
export const LABEL = {
  DRAFT: 'Draft', IN_APPROVAL: 'In approval', RETURNED: 'Draft', APPROVED: 'Finalising', LOCKED: 'Finalised',
  MET: 'Met', BREACHED: 'Breached', AT_RISK: 'At risk', NOT_MEASURABLE: 'Not measurable',
  PENDING: 'Waiting for signature', WAITING: 'Not started', REJECTED: 'Returned', SUPERSEDED: 'Superseded',
  OPEN: 'Open', IN_PROGRESS: 'In progress', DONE_PENDING_REVIEW: 'Done, pending review', CLOSED: 'Closed', CANCELLED: 'Cancelled',
};
export const pill = (code, text) => `<span class="pill ${esc(code)}">${esc(text || LABEL[code] || code)}</span>`;
export const yesNo = (v) => (v ? 'Yes' : 'No');

// ---------------------------------------------------------------- icons (24px stroke)
const ICONS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  inbox: 'M3 13h5l1 3h6l1-3h5M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  building: 'M4 21V5l8-3 8 3v16M9 21v-4h6v4M8 8h1M12 8h1M16 8h0M8 12h1M12 12h1M16 12h0',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  file: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3',
  gauge: 'M4 18a8 8 0 1 1 16 0M12 18l4-6',
  check: 'M4 12l5 5L20 6',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h0M4 12h0M4 18h0',
  log: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  cog: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  plus: 'M12 5v14M5 12h14',
  pdf: 'M6 3h9l4 4v14H6zM9 14h2a1.5 1.5 0 0 0 0-3H9v6',
  lock: 'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3',
  calc: 'M6 3h12v18H6zM9 7h6M9 11h0M12 11h0M15 11h0M9 15h0M12 15h0M15 15h0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-4-5.6',
  link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
};
export const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;

// ---------------------------------------------------------------- toast
export function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 7000 : 3800);
}

export async function guard(fn, okMessage) {
  try {
    const r = await fn();
    if (okMessage) toast(okMessage, 'ok');
    return r;
  } catch (e) {
    toast(e.message || String(e), 'bad');
    if (e.code === 'AUTH') setTimeout(() => location.reload(), 1200);
    throw e;
  }
}

// ---------------------------------------------------------------- dialog
/**
 * Open a modal. onSubmit(form, dialog) may throw; its message is shown inside the dialog.
 * Resolves with onSubmit's result, or null when cancelled.
 */
export function modal({ title, intro = '', body, submitLabel = 'Save', cancelLabel = 'Cancel', narrow = false, danger = false, onSubmit, onOpen }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    if (narrow) dlg.classList.add('narrow');
    dlg.innerHTML = `<form method="dialog" novalidate>
      <div class="dlg-head"><h2>${esc(title)}</h2></div>
      <div class="dlg-body">${intro ? `<p class="muted">${intro}</p>` : ''}<div class="dlg-error" hidden></div>${body}</div>
      <div class="dlg-foot"><button type="button" class="btn" data-cancel>${esc(cancelLabel)}</button>${onSubmit ? `<button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(submitLabel)}</button>` : ''}</div></form>`;
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    const err = dlg.querySelector('.dlg-error');
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.querySelector('[data-cancel]').onclick = () => close(null);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!onSubmit) return close(true);
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      err.hidden = true;
      try {
        close(await onSubmit(form, dlg));
      } catch (ex) {
        err.textContent = ex.message || String(ex);
        err.hidden = false;
        btn.disabled = false;
      }
    });
    dlg.showModal();
    if (onOpen) onOpen(form, dlg);
    const first = form.querySelector('input:not([type=hidden]):not([disabled]), select, textarea');
    if (first) first.focus();
  });
}

export const confirmDialog = (title, text, { submitLabel = 'Confirm', danger = false } = {}) =>
  modal({ title, body: `<p>${text}</p>`, submitLabel, narrow: true, danger, onSubmit: async () => true });

// ---------------------------------------------------------------- tables
/**
 * columns: [{ key, label, render(row) -> html, cls }]
 */
export function table(columns, rows, { empty = 'Nothing to show yet.', rowAttr } = {}) {
  if (!rows.length) return `<div class="empty">${empty}</div>`;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${columns.map((c) => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r) => `<tr ${rowAttr ? rowAttr(r) : ''}>${columns.map((c) => `<td class="${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}

// ---------------------------------------------------------------- forms
const optionCache = new Map();
export async function refOptions(ref, filters) {
  const key = `${ref}|${JSON.stringify(filters || {})}`;
  if (!optionCache.has(key)) optionCache.set(key, await call('registry.options', { ref, filters }));
  return optionCache.get(key);
}
export const clearOptionCache = () => optionCache.clear();

/** Render fields from registry metadata. */
export async function fieldsHtml(fields, values = {}, { lockParent } = {}) {
  const parts = [];
  for (const f of fields) {
    const v = values[f.name] ?? (values.__new ? f.default ?? '' : '');
    const req = f.required ? 'req' : '';
    if (f.auto) {
      parts.push(`<label class="field"><span>${esc(f.label)}</span><input value="${esc(v)}" placeholder="Assigned automatically" disabled><span class="help">${v ? 'Automatic code, never changes.' : 'Given automatically when you save.'}</span></label>`);
      continue;
    }
    const disabled = (lockParent && lockParent === f.name) || (f.readOnly) ? 'disabled' : '';
    const help = f.help ? `<span class="help">${esc(f.help)}</span>` : '';
    const wide = f.type === 'textarea' ? 'wide' : '';
    let input;
    switch (f.type) {
      case 'textarea': input = `<textarea name="${f.name}" ${disabled} ${f.dir ? `dir="${f.dir}"` : ''}>${esc(v)}</textarea>`; break;
      case 'select': input = `<select name="${f.name}" ${disabled}>${f.required ? '' : '<option value=""></option>'}${f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label || '—')}</option>`).join('')}</select>`; break;
      case 'ref': {
        const opts = await refOptions(f.ref);
        input = `<select name="${f.name}" ${disabled}><option value=""></option>${opts.map((o) => `<option value="${o.value}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
        break;
      }
      case 'bool': parts.push(`<label class="field check"><input type="checkbox" name="${f.name}" ${Number(v) ? 'checked' : ''} ${disabled}> ${esc(f.label)} ${help}</label>`); continue;
      case 'date': input = `<input type="date" name="${f.name}" value="${esc(v)}" ${disabled}>`; break;
      case 'time': input = `<input type="time" name="${f.name}" value="${esc(v)}" ${disabled}>`; break;
      case 'number': input = `<input type="number" step="any" name="${f.name}" value="${esc(v)}" ${disabled}>`; break;
      default: input = `<input type="text" name="${f.name}" value="${esc(v)}" ${disabled} ${f.dir ? `dir="${f.dir}"` : ''}>`;
    }
    parts.push(`<label class="field ${wide}"><span class="${req}">${esc(f.label)}</span>${input}${help}</label>`);
  }
  return `<div class="form-grid">${parts.join('')}</div>`;
}

/** Read named controls; checkboxes -> 1/0, datetime-local -> ISO (bank time zone). */
export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked ? 1 : 0;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.type === 'file') continue;
    else if (el.type === 'datetime-local') out[el.name] = fromInput(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

// ---------------------------------------------------------------- files
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('The file could not be read.'));
    r.readAsDataURL(file);
  });
}

export function downloadBase64(base64, name, mime = 'application/octet-stream') {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text, name, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Show a PDF: system viewer in the desktop app, a download in the browser. */
export async function showPdf(base64, name) {
  if (isDesktop() && window.vms.openPdf) return window.vms.openPdf(base64, name);
  return downloadBase64(base64, name, 'application/pdf');
}

// Personal Edition: the single owner may do everything.
export const can = () => true;
export const MASTER_ROLES = ['ADMIN', 'VM_SECTION_HEAD', 'VENDOR_MANAGER'];
export const EDITOR_ROLES = ['ADMIN', 'VM_SECTION_HEAD', 'VENDOR_MANAGER', 'IT_SECTION_HEAD', 'SERVICE_OWNER', 'TECH_OWNER'];
