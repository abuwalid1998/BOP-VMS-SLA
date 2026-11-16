// Administration: account, users, approval policy, business calendar, database export.
import { call } from '../api.js';
import { state, esc, table, pill, fmtDT, modal, toast, guard, can, downloadText, clearOptionCache } from '../ui.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COND = { ALWAYS: 'Always', CRITICAL_BREACH: 'Only when a critical SLA is breached', ANY_BREACH: 'When any SLA is breached' };
const STEP_ROLES = { IT_SECTION_HEAD: 'Responsible BOP IT Section Head', VM_SECTION_HEAD: 'Vendor Management Section Head', CIO: 'Chief Information Officer', SERVICE_OWNER: 'Service Owner' };

export async function render(root, _p, nav) {
  const isAdmin = can('ADMIN');
  const canPolicy = can('ADMIN', 'VM_SECTION_HEAD');
  const [users, policy, settings, sections, info] = await Promise.all([
    call('admin.users'), call('approvals.policy'), call('settings.all'), call('registry.list', { entity: 'bank_section' }),
    isAdmin ? call('db.info') : Promise.resolve(null),
  ]);
  if (!nav.isCurrent()) return;
  const cal = settings.business_calendar;

  root.innerHTML = `<div class="page-head"><div class="titles"><h1>Administration</h1><div class="sub">Your account, people and roles, the sign-off policy, the business calendar used by SLA clocks, and database export.</div></div></div>

  <section class="panel"><div class="panel-head"><h2>My account</h2><button class="btn" id="pw">Change my password</button></div>
    <dl class="kv"><dt>Name</dt><dd>${esc(state.user.full_name)}</dd><dt>Role</dt><dd>${esc(state.user.role_label)}</dd>
    <dt>Signing key</dt><dd class="mono">${esc(state.user.key_fingerprint)}</dd></dl>
    <p class="small muted" style="margin-top:10px">Your password also protects your personal signing key. Changing it re-encrypts the key; your existing signatures stay valid.</p></section>

  <section class="panel"><div class="panel-head"><h2>Approval policy</h2>${canPolicy ? '<button class="btn primary sm" id="save-policy">Save policy</button>' : ''}</div>
    <p class="small muted">Which approvers sign a vendor incident report, by priority. Technical validation and vendor-management review are always required; executive approval can depend on the outcome.</p>
    <div class="tbl-wrap"><table class="tbl" id="policy"><thead><tr><th>Priority</th><th>Step</th><th>Approver</th><th>Step name</th><th>Required</th><th>Active</th></tr></thead><tbody>
    ${policy.map((p, i) => `<tr data-i="${i}"><td>${pill(p.priority)}</td><td>${p.step_no}</td><td>${esc(STEP_ROLES[p.role_code] || p.role_code)}</td>
      <td><input name="step_label" value="${esc(p.step_label)}" ${canPolicy ? '' : 'disabled'} aria-label="Step name"></td>
      <td><select name="required_when" ${canPolicy && p.role_code === 'CIO' ? '' : 'disabled'} aria-label="Required">${Object.entries(COND).map(([k, l]) => `<option value="${k}" ${k === p.required_when ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><input type="checkbox" name="active" ${p.active ? 'checked' : ''} ${canPolicy && p.role_code === 'CIO' ? '' : 'disabled'} aria-label="Active"></td></tr>`).join('')}
    </tbody></table></div></section>

  <form class="panel" id="calendar"><div class="panel-head"><h2>Business calendar</h2>${canPolicy ? '<button class="btn primary sm" type="submit">Save calendar</button>' : ''}</div>
    <p class="small muted">Used for SLAs measured in business hours. Changes apply to the next calculation; signed reports keep the results they were signed with.</p>
    <div class="form-grid three">
      <label class="field">Time zone<input name="timezone" value="${esc(cal.timezone)}" ${canPolicy ? '' : 'disabled'}></label>
      <label class="field">Day starts<input type="time" name="start" value="${esc(cal.start)}" ${canPolicy ? '' : 'disabled'}></label>
      <label class="field">Day ends<input type="time" name="end" value="${esc(cal.end)}" ${canPolicy ? '' : 'disabled'}></label>
      <div class="field wide"><span>Working days</span><div class="actions">${DAYS.map((d, i) => `<label class="field check"><input type="checkbox" name="day" value="${i}" ${cal.days.includes(i) ? 'checked' : ''} ${canPolicy ? '' : 'disabled'}> ${d}</label>`).join('')}</div></div>
      <label class="field wide">Public holidays<textarea name="holidays" placeholder="One date per line, YYYY-MM-DD" ${canPolicy ? '' : 'disabled'}>${esc((cal.holidays || []).join('\n'))}</textarea></label>
    </div></form>

  <section class="panel"><div class="panel-head"><h2>People and roles</h2>${isAdmin ? '<button class="btn primary sm" id="new-user">Add person</button>' : ''}</div>
    ${table([
    { label: 'Name', render: (u) => `<b>${esc(u.full_name)}</b><div class="small muted">${esc(u.username)} · ${esc(u.job_title || '')}</div>` },
    { label: 'Role', render: (u) => esc(u.role_label) },
    { label: 'Section', render: (u) => esc(u.section_name || '—') },
    { label: 'Last sign-in', render: (u) => fmtDT(u.last_login_at) },
    { label: 'Status', render: (u) => (u.active ? pill('ok', 'Active') : pill('', 'Inactive')) + (u.locked_until && new Date(u.locked_until) > new Date() ? ` ${pill('bad', 'Locked')}` : '') },
    ...(isAdmin ? [{ label: '', cls: 'row-actions', render: (u) => `<button class="btn ghost sm" data-user="${u.user_id}">Edit</button><button class="btn ghost sm" data-reset="${u.user_id}">Reset password</button>` }] : []),
  ], users)}</section>

  ${isAdmin ? `<section class="panel"><div class="panel-head"><h2>Database</h2></div>
    <dl class="kv"><dt>SQLite database</dt><dd class="mono">${esc(info.file)}</dd><dt>Evidence store</dt><dd class="mono">${esc(info.evidenceDir)}</dd><dt>Sealed documents</dt><dd class="mono">${esc(info.documentsDir)}</dd></dl>
    <h3 style="margin:18px 0 6px">Recreate on another database</h3>
    <p class="small muted">The full migration script creates the schema, copies every row (ids preserved), then adds constraints, indexes and the integrity triggers. Copy the evidence and document folders alongside. For a direct load with verification of row counts, use <span class="mono">npm run db:migrate</span>.</p>
    <div class="actions"><button class="btn primary" data-mig="postgres">PostgreSQL migration script</button><button class="btn primary" data-mig="oracle">Oracle migration script</button></div>
    <h3 style="margin:18px 0 6px">Empty schema only</h3>
    <div class="actions"><button class="btn" data-ddl="sqlite">SQLite DDL</button><button class="btn" data-ddl="postgres">PostgreSQL DDL</button><button class="btn" data-ddl="oracle">Oracle DDL</button></div></section>` : ''}`;

  // ---------------------------------------------------------------- handlers
  root.querySelector('#pw').onclick = () => modal({
    title: 'Change my password', narrow: true,
    body: `<div class="form-grid"><label class="field wide">Current password<input type="password" name="current" autocomplete="current-password"></label>
      <label class="field wide">New password<input type="password" name="next" autocomplete="new-password"><span class="help">At least 10 characters, mixing three of: lower case, upper case, digits, symbols.</span></label>
      <label class="field wide">Repeat new password<input type="password" name="next2" autocomplete="new-password"></label></div>`,
    submitLabel: 'Change password',
    onSubmit: async (f) => {
      if (f.next.value !== f.next2.value) throw new Error('The new passwords do not match.');
      await call('auth.changePassword', { current: f.current.value, next: f.next.value });
      toast('Password changed.', 'ok');
      return true;
    },
  });

  const sp = root.querySelector('#save-policy');
  if (sp) sp.onclick = async () => {
    const rows = [...root.querySelectorAll('#policy tbody tr')].map((tr) => {
      const p = policy[Number(tr.dataset.i)];
      return { ...p, step_label: tr.querySelector('[name=step_label]').value, required_when: tr.querySelector('[name=required_when]').value, active: tr.querySelector('[name=active]').checked ? 1 : 0 };
    });
    await guard(() => call('approvals.savePolicy', { rows }), 'Approval policy saved. It applies to reports submitted from now on.');
  };

  root.querySelector('#calendar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const value = {
      timezone: f.timezone.value.trim(), start: f.start.value, end: f.end.value,
      days: [...f.querySelectorAll('[name=day]:checked')].map((x) => Number(x.value)),
      holidays: f.holidays.value.split(/\s+/).map((x) => x.trim()).filter(Boolean),
    };
    await guard(() => call('settings.set', { key: 'business_calendar', value }), 'Business calendar saved.');
    state.tz = value.timezone;
  });

  const userForm = (u = {}) => `<div class="form-grid">
    ${u.user_id ? '' : '<label class="field"><span class="req">Username</span><input name="username"></label>'}
    <label class="field"><span class="req">Full name</span><input name="full_name" value="${esc(u.full_name || '')}"></label>
    <label class="field">Job title<input name="job_title" value="${esc(u.job_title || '')}"></label>
    <label class="field">Email<input name="email" value="${esc(u.email || '')}"></label>
    <label class="field"><span class="req">Role</span><select name="role_code">${Object.entries(state.roles).map(([k, l]) => `<option value="${k}" ${k === u.role_code ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <label class="field">Section<select name="section_id"><option value=""></option>${sections.map((s) => `<option value="${s.section_id}" ${s.section_id === u.section_id ? 'selected' : ''}>${esc(s.section_name)}</option>`).join('')}</select></label>
    ${u.user_id ? `<label class="field check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Active</label>` : '<label class="field wide"><span class="req">Initial password</span><input type="password" name="password" autocomplete="new-password"><span class="help">The person must change it at first sign-in.</span></label>'}</div>`;

  const nu = root.querySelector('#new-user');
  if (nu) nu.onclick = () => modal({
    title: 'Add person', body: userForm(), submitLabel: 'Add person',
    onSubmit: async (f) => {
      await call('admin.createUser', { username: f.username.value, full_name: f.full_name.value, job_title: f.job_title.value, email: f.email.value, role_code: f.role_code.value, section_id: f.section_id.value || null, password: f.password.value, must_change_password: 1 });
      clearOptionCache();
      toast('Person added. A signing key was issued.', 'ok');
      nav.rerender();
      return true;
    },
  });

  root.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-user]');
    const rs = e.target.closest('[data-reset]');
    const mig = e.target.closest('[data-mig]');
    const ddl = e.target.closest('[data-ddl]');
    if (ed) {
      const u = users.find((x) => String(x.user_id) === ed.dataset.user);
      await modal({
        title: `Edit ${u.full_name}`, body: userForm(u), submitLabel: 'Save changes',
        onSubmit: async (f) => {
          await call('admin.updateUser', { id: u.user_id, data: { full_name: f.full_name.value, job_title: f.job_title.value, email: f.email.value, role_code: f.role_code.value, section_id: f.section_id.value, active: f.active.checked ? 1 : 0 } });
          clearOptionCache();
          toast('Saved.', 'ok');
          nav.rerender();
          return true;
        },
      });
    }
    if (rs) {
      const u = users.find((x) => String(x.user_id) === rs.dataset.reset);
      await modal({
        title: `Reset password for ${u.full_name}`, narrow: true,
        intro: 'A new signing key is issued, because the old one cannot be recovered without the old password. Earlier signatures stay verifiable.',
        body: '<label class="field"><span class="req">Temporary password</span><input type="password" name="password" autocomplete="new-password"></label>',
        submitLabel: 'Reset password', danger: true,
        onSubmit: async (f) => { await call('admin.resetPassword', { id: u.user_id, password: f.password.value }); toast('Password reset. The person must change it at next sign-in.', 'ok'); return true; },
      });
    }
    if (mig) {
      mig.disabled = true;
      try {
        const sql = await guard(() => call('db.migrationScript', { dialect: mig.dataset.mig }));
        downloadText(sql, `vms-sla_${mig.dataset.mig}_migration_${new Date().toISOString().slice(0, 10)}.sql`, 'application/sql');
      } catch (_) { /* shown */ } finally { mig.disabled = false; }
    }
    if (ddl) {
      const sql = await guard(() => call('db.ddl', { dialect: ddl.dataset.ddl }));
      downloadText(sql, `vms-sla_${ddl.dataset.ddl}_schema.sql`, 'application/sql');
    }
  });
}
