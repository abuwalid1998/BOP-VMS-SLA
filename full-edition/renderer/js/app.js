// Application shell: sign-in, navigation rail and hash router.
import { call } from './api.js';
import { state, esc, $, icon, toast, modal, guard } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as registry from './views/registry.js';
import * as commitments from './views/commitments.js';
import * as incidents from './views/incidents.js';
import * as incident from './views/incident.js';
import * as approvals from './views/approvals.js';
import * as documents from './views/documents.js';
import * as audit from './views/audit.js';
import * as admin from './views/admin.js';

const NAV = [
  { group: 'Overview' },
  { href: '#/dashboard', label: 'Dashboard', icon: 'home' },
  { href: '#/approvals', label: 'My approvals', icon: 'inbox', badge: 'approvals' },
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
  { group: 'Governance' },
  { href: '#/audit', label: 'Audit trail', icon: 'log', roles: ['ADMIN', 'VM_SECTION_HEAD', 'AUDITOR', 'CIO'] },
  { href: '#/admin', label: 'Administration', icon: 'cog' },
];

const ROUTES = [
  [/^#\/dashboard$/, dashboard],
  [/^#\/approvals$/, approvals],
  [/^#\/commitments(?:\/(\d+)\/(\d+))?$/, commitments],
  [/^#\/incidents$/, incidents],
  [/^#\/incidents\/(\d+)(?:\/(\w+))?$/, incident],
  [/^#\/documents$/, documents],
  [/^#\/r\/(\w+)$/, registry],
  [/^#\/r\/(\w+)\/(\d+)$/, registry],
  [/^#\/audit$/, audit],
  [/^#\/admin$/, admin],
];

function loginView(error = '') {
  document.title = 'Sign in · BOP Vendor & SLA';
  $('#app').innerHTML = `<div class="login">
    <div class="brandside"><img src="assets/bop-logo.jpg" alt="Bank of Palestine"></div>
    <div class="formside"><form id="login-form" autocomplete="on">
      <div><h1>Vendor Management &amp; SLA</h1><p class="muted">Sign in with your bank account to manage vendor services, SLAs and incident approvals.</p></div>
      ${error ? `<div class="dlg-error">${esc(error)}</div>` : ''}
      <label class="field">Username<input name="username" autocomplete="username" required></label>
      <label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary" type="submit" style="justify-content:center">Sign in</button>
    </form></div></div>`;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      state.user = await call('auth.login', { username: f.username.value, password: f.password.value });
      await boot();
    } catch (ex) {
      loginView(ex.message);
    }
  });
}

function setupView(error = '') {
  document.title = 'First-time setup · BOP Vendor & SLA';
  $('#app').innerHTML = `<div class="login">
    <div class="brandside"><img src="assets/bop-logo.jpg" alt="Bank of Palestine"></div>
    <div class="formside"><form id="setup-form" autocomplete="off">
      <div><h1>Set up VMS-SLA</h1><p class="muted">This installation has no users yet. Create the administrator account. The administrator then adds bank sections, people, vendors, services and contracts.</p></div>
      ${error ? `<div class="dlg-error">${esc(error)}</div>` : ''}
      <label class="field"><span class="req">Full name</span><input name="full_name" required></label>
      <label class="field"><span class="req">Username</span><input name="username" required autocomplete="username"><span class="help">Letters, digits, dot, dash or underscore.</span></label>
      <label class="field">Job title<input name="job_title"></label>
      <label class="field">Email<input name="email" type="email"></label>
      <label class="field"><span class="req">Password</span><input name="password" type="password" required autocomplete="new-password"><span class="help">At least 10 characters, mixing three of: lower case, upper case, digits, symbols. It also protects this account's signing key.</span></label>
      <label class="field"><span class="req">Repeat password</span><input name="password2" type="password" required autocomplete="new-password"></label>
      <button class="btn primary" type="submit" style="justify-content:center">Create administrator and continue</button>
    </form></div></div>`;
  $('#setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.password.value !== f.password2.value) { setupView('The passwords do not match.'); return; }
    try {
      state.user = await call('setup.createAdmin', { full_name: f.full_name.value, username: f.username.value, job_title: f.job_title.value, email: f.email.value, password: f.password.value });
      await boot();
    } catch (ex) {
      setupView(ex.message);
    }
  });
}

function shellView() {
  const u = state.user;
  $('#app').innerHTML = `<div class="shell">
    <aside class="rail">
      <div class="brand"><img src="assets/bop-emblem.png" alt=""><div><div class="ar" dir="rtl" lang="ar">بنك فلسطين</div><div class="en">BANK OF PALESTINE</div><div class="app">Vendor &amp; SLA Management</div></div></div>
      <nav class="nav" aria-label="Main">${NAV.filter((n) => !n.roles || n.roles.includes(u.role_code)).map((n) => (n.group
        ? `<div class="nav-group">${esc(n.group)}</div>`
        : `<a href="${n.href}" data-nav="${n.href}">${icon(n.icon)}<span>${esc(n.label)}</span>${n.badge ? '<span class="badge" data-badge hidden></span>' : ''}</a>`)).join('')}</nav>
      <div class="rail-foot"><div class="who">${esc(u.full_name)}</div><div class="role">${esc(u.job_title || u.role_label)}</div><button id="logout">Sign out</button></div>
    </aside>
    <main class="main" id="main"><div class="page" id="page"></div></main></div>`;
  $('#logout').onclick = async () => { await call('auth.logout'); state.user = null; location.hash = ''; loginView(); };
}

async function refreshBadge() {
  try {
    const n = (await call('approvals.inbox')).length;
    const b = document.querySelector('[data-badge]');
    if (b) { b.hidden = !n; b.textContent = n; }
  } catch (_) { /* ignore */ }
}

let renderSeq = 0;
async function route() {
  if (!state.user) return;
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
    await match[1].render(page, params, { isCurrent: () => seq === renderSeq, rerender: route, refreshBadge });
    $('#main').scrollTop = 0;
  } catch (e) {
    if (seq !== renderSeq) return;
    page.innerHTML = `<div class="notice bad">${esc(e.message || e)}</div>`;
    if (e.code === 'AUTH') { state.user = null; loginView(e.message); }
  }
  refreshBadge();
}

async function boot() {
  const [settings, roles] = await Promise.all([call('settings.all'), call('meta.roles')]);
  state.tz = (settings.business_calendar && settings.business_calendar.timezone) || 'Asia/Hebron';
  state.roles = roles;
  state.meta = await call('meta.entities');
  shellView();
  if (state.user.must_change_password) await forcePasswordChange();
  await route();
}

async function forcePasswordChange() {
  await modal({
    title: 'Choose a new password',
    intro: 'An administrator reset your password. Choose a new one before continuing. It also protects your signing key.',
    body: `<div class="form-grid"><label class="field wide">Current (temporary) password<input type="password" name="current" required></label>
      <label class="field">New password<input type="password" name="next" required></label><label class="field">Repeat new password<input type="password" name="next2" required></label></div>`,
    submitLabel: 'Change password',
    onSubmit: async (f) => {
      if (f.next.value !== f.next2.value) throw new Error('The new passwords do not match.');
      await call('auth.changePassword', { current: f.current.value, next: f.next.value });
      toast('Password changed.', 'ok');
      return true;
    },
  });
}

window.addEventListener('hashchange', route);
(async () => {
  try {
    state.user = await call('auth.me');
  } catch (_) { state.user = null; }
  if (state.user) { await guard(boot); return; }
  let needsSetup = false;
  try { needsSetup = (await call('setup.status')).needsSetup; } catch (_) { /* show sign-in */ }
  if (needsSetup) setupView(); else loginView();
})();
