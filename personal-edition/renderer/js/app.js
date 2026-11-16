// Application shell (Personal Edition): no sign-in. Navigation rail and hash router.
import { call } from './api.js';
import { state, esc, $, icon, guard } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as registry from './views/registry.js';
import * as commitments from './views/commitments.js';
import * as incidents from './views/incidents.js';
import * as incident from './views/incident.js';
import * as documents from './views/documents.js';
import * as audit from './views/audit.js';
import * as settings from './views/settings.js';

const NAV = [
  { group: 'Overview' },
  { href: '#/dashboard', label: 'Dashboard', icon: 'home' },
  { group: 'Reports' },
  { href: '#/commitments', label: 'Service commitments', icon: 'shield' },
  { href: '#/incidents', label: 'Incident reports', icon: 'alert' },
  { href: '#/documents', label: 'Sealed documents', icon: 'lock' },
  { group: 'Catalogue' },
  { href: '#/r/bank_section', label: 'Bank sections', icon: 'users' },
  { href: '#/r/vendor', label: 'Vendors', icon: 'building' },
  { href: '#/r/service', label: 'Services', icon: 'layers' },
  { href: '#/r/contract', label: 'Contracts', icon: 'file' },
  { href: '#/r/sla_definition', label: 'SLA catalogue', icon: 'gauge' },
  { href: '#/r/action_issue', label: 'Corrective actions', icon: 'check' },
  { group: 'Records' },
  { href: '#/audit', label: 'Activity log', icon: 'log' },
  { href: '#/settings', label: 'Settings', icon: 'cog' },
];

const ROUTES = [
  [/^#\/dashboard$/, dashboard],
  [/^#\/commitments(?:\/(\d+)\/(\d+))?$/, commitments],
  [/^#\/incidents$/, incidents],
  [/^#\/incidents\/(\d+)(?:\/(\w+))?$/, incident],
  [/^#\/documents$/, documents],
  [/^#\/r\/(\w+)$/, registry],
  [/^#\/r\/(\w+)\/(\d+)$/, registry],
  [/^#\/audit$/, audit],
  [/^#\/settings$/, settings],
];

export function drawOwner() {
  const u = state.user;
  const foot = $('.rail-foot');
  if (foot) foot.innerHTML = `<div class="who">${esc(u.full_name)}</div><div class="role">${esc(u.job_title || '')}</div><a class="small" href="#/settings" style="color:#e7c9d9">Edit my details</a>`;
}

function shellView() {
  $('#app').innerHTML = `<div class="shell">
    <aside class="rail">
      <div class="brand"><img src="assets/bop-emblem.png" alt=""><div><div class="ar" dir="rtl" lang="ar">بنك فلسطين</div><div class="en">BANK OF PALESTINE</div><div class="app">Vendor &amp; SLA · Personal</div></div></div>
      <nav class="nav" aria-label="Main">${NAV.map((n) => (n.group
        ? `<div class="nav-group">${esc(n.group)}</div>`
        : `<a href="${n.href}" data-nav="${n.href}">${icon(n.icon)}<span>${esc(n.label)}</span></a>`)).join('')}</nav>
      <div class="rail-foot"></div>
    </aside>
    <main class="main" id="main"><div class="page" id="page"></div></main></div>`;
  drawOwner();
}

let renderSeq = 0;
async function route() {
  const hash = location.hash || '#/dashboard';
  if (!location.hash) { location.hash = '#/dashboard'; return; }
  const match = ROUTES.find(([re]) => re.test(hash));
  // A dialog belongs to the page it was opened on: close it when the page changes.
  document.querySelectorAll('dialog').forEach((d) => { if (d.open) d.close(); d.remove(); });
  // Fresh container per render so listeners from the previous view are discarded.
  const old = $('#page');
  const page = old.cloneNode(false);
  old.replaceWith(page);
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', hash === a.dataset.nav || hash.startsWith(`${a.dataset.nav}/`)));
  if (!match) { page.innerHTML = '<div class="empty">This page does not exist.</div>'; return; }
  const seq = ++renderSeq;
  const params = hash.match(match[0]).slice(1);
  try {
    await match[1].render(page, params, { isCurrent: () => seq === renderSeq, rerender: route, refreshBadge: () => {} });
    $('#main').scrollTop = 0;
  } catch (e) {
    if (seq !== renderSeq) return;
    page.innerHTML = `<div class="notice bad">${esc(e.message || e)}</div>`;
  }
}

async function boot() {
  const [me, settingsAll] = await Promise.all([call('auth.me'), call('settings.all')]);
  state.user = me;
  state.tz = (settingsAll.business_calendar && settingsAll.business_calendar.timezone) || 'Asia/Hebron';
  state.meta = await call('meta.entities');
  document.title = 'BOP Vendor & SLA · Personal';
  shellView();
  await route();
}

window.addEventListener('hashchange', route);
guard(boot);
