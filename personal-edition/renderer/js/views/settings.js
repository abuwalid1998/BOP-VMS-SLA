// Settings (Personal Edition): your details, business calendar, data folder and database export.
import { call } from '../api.js';
import { state, esc, toast, guard, downloadText } from '../ui.js';
import { drawOwner } from '../app.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function render(root, _p, nav) {
  const [settings, info] = await Promise.all([call('settings.all'), call('db.info')]);
  if (!nav.isCurrent()) return;
  const cal = settings.business_calendar;
  const me = settings.owner_profile;

  root.innerHTML = `<div class="page-head"><div class="titles"><h1>Settings</h1><div class="sub">Your details on reports, the business calendar used by SLA clocks, and where your data is kept.</div></div></div>

  <form class="panel" id="profile"><div class="panel-head"><h2>My details</h2><button class="btn primary sm" type="submit">Save my details</button></div>
    <p class="small muted">Printed on every sealed PDF as the person who finalised or issued it, and recorded in the activity log.</p>
    <div class="form-grid three">
      <label class="field"><span class="req">Full name</span><input name="full_name" value="${esc(me.full_name)}"></label>
      <label class="field">Job title<input name="job_title" value="${esc(me.job_title || '')}"></label>
      <label class="field">Email<input name="email" type="email" value="${esc(me.email || '')}"></label>
    </div></form>

  <form class="panel" id="calendar"><div class="panel-head"><h2>Business calendar</h2><button class="btn primary sm" type="submit">Save calendar</button></div>
    <p class="small muted">Used for SLAs measured in business hours. Changes apply to the next calculation; finalised reports keep the results they were sealed with.</p>
    <div class="form-grid three">
      <label class="field">Time zone<input name="timezone" value="${esc(cal.timezone)}"></label>
      <label class="field">Day starts<input type="time" name="start" value="${esc(cal.start)}"></label>
      <label class="field">Day ends<input type="time" name="end" value="${esc(cal.end)}"></label>
      <div class="field wide"><span>Working days</span><div class="actions">${DAYS.map((d, i) => `<label class="field check"><input type="checkbox" name="day" value="${i}" ${cal.days.includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div></div>
      <label class="field wide">Public holidays<textarea name="holidays" placeholder="One date per line, YYYY-MM-DD">${esc((cal.holidays || []).join('\n'))}</textarea></label>
    </div></form>

  <section class="panel"><div class="panel-head"><h2>My data</h2></div>
    <dl class="kv"><dt>Data folder</dt><dd class="mono">${esc(info.dataDir)}</dd><dt>Database</dt><dd class="mono">${esc(info.file)}</dd><dt>Evidence files</dt><dd class="mono">${esc(info.evidenceDir)}</dd><dt>Sealed PDFs</dt><dd class="mono">${esc(info.documentsDir)}</dd></dl>
    <p class="small muted" style="margin-top:10px">To back up, close the app and copy the whole data folder. To restore, put the copy back in the same place. In the desktop app, File → Open data folder opens it.</p>
    <h3 style="margin:18px 0 6px">Move to PostgreSQL or Oracle</h3>
    <p class="small muted">A full script creates the tables, copies every record with its code, then adds the integrity rules. Copy the evidence and sealed-PDF folders alongside.</p>
    <div class="actions"><button class="btn" data-mig="postgres">PostgreSQL migration script</button><button class="btn" data-mig="oracle">Oracle migration script</button>
      <button class="btn ghost" data-ddl="postgres">Empty PostgreSQL schema</button><button class="btn ghost" data-ddl="oracle">Empty Oracle schema</button></div></section>`;

  root.querySelector('#profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await guard(() => call('settings.set', { key: 'owner_profile', value: { full_name: f.full_name.value, job_title: f.job_title.value, email: f.email.value } }), 'Your details are saved.');
      state.user = await call('auth.me');
      drawOwner();
    } catch (_) { /* shown */ }
  });

  root.querySelector('#calendar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const value = {
      timezone: f.timezone.value.trim(), start: f.start.value, end: f.end.value,
      days: [...f.querySelectorAll('[name=day]:checked')].map((x) => Number(x.value)),
      holidays: f.holidays.value.split(/\s+/).map((x) => x.trim()).filter(Boolean),
    };
    try {
      await guard(() => call('settings.set', { key: 'business_calendar', value }), 'Business calendar saved.');
      state.tz = value.timezone;
    } catch (_) { /* shown */ }
  });

  root.addEventListener('click', async (e) => {
    const mig = e.target.closest('[data-mig]');
    const ddl = e.target.closest('[data-ddl]');
    try {
      if (mig) downloadText(await guard(() => call('db.migrationScript', { dialect: mig.dataset.mig })), `vms-sla_${mig.dataset.mig}_migration_${new Date().toISOString().slice(0, 10)}.sql`, 'application/sql');
      if (ddl) downloadText(await guard(() => call('db.ddl', { dialect: ddl.dataset.ddl })), `vms-sla_${ddl.dataset.ddl}_schema.sql`, 'application/sql');
    } catch (_) { /* shown */ }
  });
  void toast;
}
