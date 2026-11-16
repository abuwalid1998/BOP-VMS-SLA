// Feature 2: Vendor Incident Report editor, SLA compliance and sign-off.
import { call } from '../api.js';
import {
  state, esc, nl2br, table, pill, fmtDT, fmtDay, fmtUnit, fmtNum, modal, toInput, readForm, toast, guard, confirmDialog,
  fileToBase64, showPdf, downloadBase64, can, icon, LABEL,
} from '../ui.js';

const TABS = [
  ['details', 'Incident'],
  ['timeline', 'Timeline'],
  ['state', 'Before / after'],
  ['actions', 'Vendor actions'],
  ['sla', 'SLA'],
  ['rca', 'Root cause'],
];
const BANK_VALIDATORS = ['IT_SECTION_HEAD', 'TECH_OWNER', 'SERVICE_OWNER', 'VM_SECTION_HEAD'];
const EVENT_TYPES = ['Detection', 'Reported to vendor', 'Vendor acknowledged', 'Escalation', 'Clock paused', 'Clock resumed', 'Workaround', 'Service restored', 'Resolved', 'Customer communication', 'Outage start', 'Outage end', 'Other'];
const ACTION_TYPES = ['Acknowledgement', 'Diagnosis', 'Escalation', 'Workaround', 'Fix', 'Rollback', 'Communication', 'RCA', 'Other'];

// ---------------------------------------------------------------- child forms
const CHILD_FORMS = {
  timeline: { label: 'timeline event', fields: [['occurred_at', 'When', 'dt', 1], ['event_type', 'Event', 'list:events', 1], ['actor_party', 'Party', 'select:BANK,VENDOR,JOINT', 1], ['actor_name', 'Who'], ['description', 'What happened', 'textarea', 1], ['source', 'Source of this fact', 'text', 0, 'For example ITSM, monitoring, vendor update']] },
  pause: { label: 'SLA clock pause', intro: 'Pause the restoration and resolution clocks only while the vendor is demonstrably waiting on the bank. A bank validator must approve each pause before it counts.', fields: [['paused_at', 'Clock paused at', 'dt', 1], ['resumed_at', 'Clock resumed at', 'dt', 1], ['reason', 'Bank dependency', 'textarea', 1]] },
  state: { label: 'service state row', fields: [['component', 'Component', 'text', 1], ['indicator', 'Indicator', 'text', 1], ['unit', 'Unit'], ['evidence_id', 'Evidence', 'evidence'], ['before_value', 'Before'], ['before_status', 'Status before', 'select:,Normal,Degraded,Down'], ['during_value', 'During'], ['after_value', 'After'], ['after_status', 'Status after', 'select:,Normal,Degraded,Down'], ['notes', 'Notes', 'textarea']] },
  vendorAction: { label: 'vendor action', fields: [['action_at', 'When', 'dt', 1], ['action_type', 'Action', 'list:actions', 1], ['vendor_actor', 'Vendor person'], ['evidence_id', 'Evidence', 'evidence'], ['description', 'What the vendor did', 'textarea', 1], ['outcome', 'Outcome', 'textarea']] },
  corrective: { label: 'corrective action', fields: [['description', 'Action', 'textarea', 1], ['source_finding', 'Finding it addresses'], ['action_type', 'Type', 'select:CORRECTIVE,PREVENTIVE', 1], ['severity', 'Severity', 'select:CRITICAL,HIGH,MEDIUM,LOW', 1], ['owner_party', 'Owner party', 'select:VENDOR,BANK,JOINT', 1], ['owner_name', 'Owner'], ['due_date', 'Due date', 'date'], ['status', 'Status', 'select:OPEN,IN_PROGRESS,DONE_PENDING_REVIEW,CLOSED,CANCELLED']] },
};

function childFormHtml(kind, row, data) {
  const def = CHILD_FORMS[kind];
  const parts = def.fields.map(([name, label, type = 'text', req, help]) => {
    const v = row ? row[name] : '';
    const r = req ? 'req' : '';
    let input;
    if (type === 'dt') input = `<input type="datetime-local" name="${name}" value="${toInput(v)}">`;
    else if (type === 'date') input = `<input type="date" name="${name}" value="${esc(v || '')}">`;
    else if (type === 'textarea') input = `<textarea name="${name}">${esc(v || '')}</textarea>`;
    else if (type.startsWith('select:')) input = `<select name="${name}">${type.slice(7).split(',').map((o) => `<option value="${o}" ${String(v || '') === o ? 'selected' : ''}>${esc(LABEL[o] || o || '—')}</option>`).join('')}</select>`;
    else if (type.startsWith('list:')) input = `<input name="${name}" value="${esc(v || '')}" list="dl-${name}"><datalist id="dl-${name}">${(type === 'list:events' ? EVENT_TYPES : ACTION_TYPES).map((o) => `<option value="${o}">`).join('')}</datalist>`;
    else if (type === 'evidence') input = `<select name="${name}"><option value="">None</option>${data.evidence.map((e) => `<option value="${e.evidence_id}" ${String(v) === String(e.evidence_id) ? 'selected' : ''}>${esc(e.original_name)}</option>`).join('')}</select>${data.evidence.length ? '' : '<span class="help">Upload evidence on the Vendor actions and evidence tab first.</span>'}`;
    else input = `<input name="${name}" value="${esc(v ?? '')}">`;
    return `<label class="field ${type === 'textarea' ? 'wide' : ''}"><span class="${r}">${esc(label)}</span>${input}${help ? `<span class="help">${esc(help)}</span>` : ''}</label>`;
  });
  return `<div class="form-grid">${parts.join('')}</div>`;
}

const PK = { timeline: 'event_id', pause: 'pause_id', state: 'state_id', vendorAction: 'action_id', corrective: 'action_issue_id' };

// ---------------------------------------------------------------- view
export async function render(root, [id, tabParam], nav) {
  let data = await call('incidents.get', { id: Number(id) });
  if (!nav.isCurrent()) return;
  let tab = TABS.some(([k]) => k === tabParam) ? tabParam : 'details';

  const setData = (d) => { data = d; draw(); };
  const act = async (fn, ok) => { try { setData(await guard(fn, ok)); } catch (_) { /* toast shown */ } };

  const childEdit = async (kind, row) => {
    const def = CHILD_FORMS[kind];
    await modal({
      title: row ? `Edit ${def.label}` : `Add ${def.label}`,
      intro: def.intro || '',
      body: childFormHtml(kind, row, data),
      submitLabel: row ? 'Save changes' : `Add ${def.label}`,
      onSubmit: async (form) => {
        const d = readForm(form);
        if (row) d[PK[kind]] = row[PK[kind]];
        setData(await call('incidents.saveChild', { reportId: data.report.report_id, kind, data: d }));
        toast('Saved.', 'ok');
        return true;
      },
    });
  };
  const childDelete = async (kind, row) => {
    if (!(await confirmDialog(`Delete this ${CHILD_FORMS[kind].label}?`, 'The deletion is recorded in the audit trail.', { submitLabel: 'Delete', danger: true }))) return;
    act(() => call('incidents.deleteChild', { reportId: data.report.report_id, kind, id: row[PK[kind]] }), 'Deleted.');
  };

  function draw() {
    const r = data.report;
    const edit = data.canEdit;
    document.title = `${r.report_no} · BOP Vendor & SLA`;
    root.innerHTML = `<div class="crumbs"><a href="#/incidents">Incident reports</a></div>
      <div class="page-head"><div class="titles">
        <div class="actions" style="margin-bottom:6px">${pill(r.priority)} ${pill(r.status)} <span class="muted">${esc(r.report_no)}</span></div>
        <h1>${esc(r.title)}</h1>
        <div class="sub"><a href="#/r/vendor/${r.vendor_id}">${esc(r.vendor_name)}</a> · <a href="#/r/service/${r.service_id}">${esc(r.service_code)} ${esc(r.service_name)}</a> · ${r.contract_no ? `${esc(r.contract_no)} ${esc(r.contract_version_no)}` : '<span class="gap-flag">no contract version</span>'} · ${esc(r.section_name)}</div></div>
        <div class="actions"><a class="btn" href="#/commitments/${r.vendor_id}/${r.service_id}">${icon('shield')} Commitments</a></div></div>
      <div class="split"><div>
        <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" class="${k === tab ? 'active' : ''}" data-tab="${k}">${esc(l)}${tabCount(k)}</button>`).join('')}</div>
        <div id="tab">${TAB_RENDER[tab](edit)}</div>
      </div><aside class="sticky">${sidePanel()}</aside></div>`;
  }

  function tabCount(k) {
    const n = { timeline: data.timeline.length, state: data.serviceState.length, actions: data.vendorActions.length, rca: data.corrective.length }[k];
    if (k === 'sla' && data.slaSummary.breached) return ` <span class="count bad">${data.slaSummary.breached}</span>`;
    return n ? ` <span class="count">${n}</span>` : '';
  }

  // ---------------------------------------------------------------- side panel
  function sidePanel() {
    const r = data.report;
    const doc = data.documents.find((d) => d.doc_type === 'INCIDENT_FINAL');
    const btns = [];
    if (data.canEdit) btns.push(`<button class="btn primary" data-act="finalise">${icon('lock')} Finalise report</button>`);
    if (doc) btns.push(`<button class="btn primary" data-act="openDoc" data-id="${doc.document_id}">${icon('lock')} Open sealed PDF</button>`);
    if (r.status === 'APPROVED') btns.push(`<button class="btn primary" data-act="finalise">${icon('lock')} Generate sealed PDF</button>`);
    btns.push(`<button class="btn" data-act="preview">${icon('pdf')} ${doc ? 'Working copy PDF' : 'Preview PDF'}</button>`);
    if (data.canEdit && r.revision === 1) btns.push('<button class="btn ghost" data-act="delete">Delete draft</button>');
    const ready = data.readiness;
    return `<section class="panel status-card">
      <div class="panel-head"><h2>${r.status === 'LOCKED' ? 'Finalised' : 'Finalise'}</h2></div>
      ${r.status === 'LOCKED'
    ? `<div class="notice ok" style="margin:0">Finalised and locked on ${fmtDT(r.locked_at)}. The record and its sealed PDF can no longer change.</div>`
    : r.status === 'APPROVED'
      ? '<div class="notice warn" style="margin:0">The content is frozen but the sealed PDF was not produced. Generate it to finish.</div>'
      : `<p class="small muted" style="margin:0">Finalising recalculates the SLAs, freezes the content, produces a sealed PDF and locks the report.</p>
         ${ready.length ? `<ul class="checklist" style="margin-top:12px">${ready.map((x) => `<li class="small"><span class="tick" aria-hidden="true"></span>${esc(x)}</li>`).join('')}</ul>` : '<div class="notice ok" style="margin:12px 0 0">Complete. Ready to finalise.</div>'}`}
      <div class="btns">${btns.join('')}</div>
      ${r.content_hash ? `<div class="hash">Content SHA-256 at finalisation<div class="mono">${esc(r.content_hash)}</div></div>` : ''}
    </section>
    ${data.warnings.length && data.canEdit ? `<section class="panel"><div class="panel-head"><h2>Worth checking</h2></div><ul class="small" style="margin:0;padding-left:18px">${data.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></section>` : ''}
    ${data.documents.length ? `<section class="panel"><div class="panel-head"><h2>Sealed documents</h2></div>${data.documents.map((d) => `<div class="small"><b>${esc(d.title)}</b><div class="mono muted">${esc(d.sha256)}</div><button class="btn ghost sm" data-act="openDoc" data-id="${d.document_id}">Open</button></div>`).join('')}</section>` : ''}`;
  }

  // ---------------------------------------------------------------- tabs
  const dis = (edit) => (edit ? '' : 'disabled');
  const TAB_RENDER = {
    details: (edit) => {
      const r = data.report;
      return `<form class="panel" data-form="header">
        <div class="panel-head"><h2>Incident</h2></div>
        <div class="form-grid">
          <label class="field wide"><span class="req">Title</span><input name="title" value="${esc(r.title)}" ${dis(edit)}></label>
          <label class="field"><span class="req">Priority</span><select name="priority" ${dis(edit)}>${['P1', 'P2', 'P3', 'P4'].map((p) => `<option ${p === r.priority ? 'selected' : ''}>${p}</option>`).join('')}</select><span class="help">Priority decides which SLA targets apply.</span></label>
          <label class="field">Outage type<select name="outage_type" ${dis(edit)}>${[['FULL', 'Full outage'], ['PARTIAL', 'Partial outage'], ['DEGRADED', 'Degraded service'], ['NONE', 'No outage']].map(([v, l]) => `<option value="${v}" ${v === r.outage_type ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="help">Only full outages count as unavailable minutes.</span></label>
          <label class="field">ITSM reference<input name="itsm_ref" value="${esc(r.itsm_ref || '')}" ${dis(edit)}></label>
          <label class="field">Vendor ticket<input name="vendor_ticket_ref" value="${esc(r.vendor_ticket_ref || '')}" ${dis(edit)}></label>
        </div>
        <div class="panel-head" style="margin-top:20px"><h2>Impact</h2></div>
        <div class="form-grid">
          <label class="field wide"><span class="req">Impact summary</span><textarea name="impact_summary" ${dis(edit)}>${esc(r.impact_summary || '')}</textarea></label>
          <label class="field wide">Business impact<textarea name="business_impact" ${dis(edit)}>${esc(r.business_impact || '')}</textarea></label>
          <label class="field">Customers affected<input type="number" name="customers_affected" value="${esc(r.customers_affected ?? '')}" ${dis(edit)}></label>
          <label class="field">Channels affected<input name="channels_affected" value="${esc(r.channels_affected || '')}" ${dis(edit)}></label>
          <label class="field">Estimated financial impact (USD)<input type="number" step="any" name="financial_impact" value="${esc(r.financial_impact ?? '')}" ${dis(edit)}></label>
        </div>
        ${edit ? '<div class="actions" style="margin-top:16px"><button class="btn primary" type="submit">Save incident details</button></div>' : ''}
      </form>
      <section class="panel"><dl class="kv"><dt>Recorded</dt><dd>${fmtDT(r.created_at)}</dd><dt>Responsible section</dt><dd>${esc(r.section_name)}</dd><dt>Vendor risk tier</dt><dd>${pill(r.risk_tier)}</dd><dt>Service criticality</dt><dd>${pill(r.criticality)}</dd></dl></section>`;
    },

    timeline: (edit) => {
      const r = data.report;
      const tf = (n, l, req) => `<label class="field"><span class="${req ? 'req' : ''}">${l}</span><input type="datetime-local" name="${n}" value="${toInput(r[n])}" ${dis(edit)}></label>`;
      return `<form class="panel" data-form="header">
        <div class="panel-head"><h2>SLA clock milestones</h2><span class="muted small">Times in ${esc(state.tz)}</span></div>
        <div class="form-grid three">
          ${tf('detected_at', 'Detected', 1)}${tf('reported_at', 'Reported to vendor (clock start)', 1)}${tf('acknowledged_at', 'Vendor acknowledged (response)')}
          ${tf('workaround_at', 'Workaround in place')}${tf('restored_at', 'Service restored', 1)}${tf('resolved_at', 'Resolved (permanent fix)')}
          ${tf('outage_start', 'Outage start')}${tf('outage_end', 'Outage end')}
        </div>
        ${edit ? '<div class="actions" style="margin-top:16px"><button class="btn primary" type="submit">Save milestones</button></div>' : ''}
      </form>
      <section class="panel"><div class="panel-head"><h2>Timeline of events</h2>${edit ? `<button class="btn sm" data-add="timeline">${icon('plus')} Add event</button>` : ''}</div>
        ${table([
    { label: 'When', render: (e) => `<span class="nowrap">${fmtDT(e.occurred_at)}</span>` },
    { label: 'Party', render: (e) => `${pill(e.actor_party === 'VENDOR' ? 'warn' : 'info', e.actor_party)}<div class="small muted">${esc(e.actor_name)}</div>` },
    { label: 'Event', key: 'event_type' },
    { label: 'What happened', render: (e) => `${nl2br(e.description)}${e.source ? `<div class="small muted">Source: ${esc(e.source)}</div>` : ''}` },
    ...(edit ? [{ label: '', cls: 'row-actions', render: (e) => `<button class="btn ghost sm" data-edit="timeline:${e.event_id}">Edit</button><button class="btn ghost sm" data-del="timeline:${e.event_id}">Delete</button>` }] : []),
  ], data.timeline, { empty: 'Add the events in the order they happened.' })}</section>
      <section class="panel"><div class="panel-head"><h2>SLA clock pauses</h2>${edit ? `<button class="btn sm" data-add="pause">${icon('plus')} Add pause</button>` : ''}</div>
        <p class="small muted">Only pauses you accept reduce the restoration and resolution clocks. Response time is never paused.</p>
        ${table([
    { label: 'Paused', render: (p) => fmtDT(p.paused_at) },
    { label: 'Resumed', render: (p) => fmtDT(p.resumed_at) },
    { label: 'Bank dependency', render: (p) => nl2br(p.reason) },
    { label: 'Counted', render: (p) => (p.approved ? pill('ok', 'Accepted') : pill('warn', 'Not accepted')) },
    ...(edit ? [{ label: '', cls: 'row-actions', render: (p) => `${can(...BANK_VALIDATORS) ? `<button class="btn ghost sm" data-pause="${p.pause_id}:${p.approved ? 0 : 1}">${p.approved ? 'Stop counting' : 'Accept pause'}</button>` : ''}<button class="btn ghost sm" data-edit="pause:${p.pause_id}">Edit</button><button class="btn ghost sm" data-del="pause:${p.pause_id}">Delete</button>` }] : []),
  ], data.pauses, { empty: 'No clock pauses.' })}</section>`;
    },

    state: (edit) => `<section class="panel"><div class="panel-head"><h2>Service state before, during and after</h2>${edit ? `<button class="btn sm" data-add="state">${icon('plus')} Add row</button>` : ''}</div>
      <p class="small muted">Compare the same indicators before the incident, during it and after recovery, so approvers can confirm the service is back to its normal state.</p>
      ${table([
    { label: 'Component', render: (s) => `<b>${esc(s.component)}</b><div class="small muted">${esc(s.indicator)}${s.unit ? ` (${esc(s.unit)})` : ''}</div>` },
    { label: 'Before', render: (s) => `${esc(s.before_value)}${s.before_status ? `<div>${pill(s.before_status === 'Normal' ? 'ok' : 'warn', s.before_status)}</div>` : ''}` },
    { label: 'During', render: (s) => `<b>${esc(s.during_value)}</b>` },
    { label: 'After', render: (s) => `${esc(s.after_value)}${s.after_status ? `<div>${pill(s.after_status === 'Normal' ? 'ok' : 'bad', s.after_status)}</div>` : ''}` },
    { label: 'Evidence', render: (s) => evidenceLink(s.evidence_id) },
    ...(edit ? [{ label: '', cls: 'row-actions', render: (s) => `<button class="btn ghost sm" data-edit="state:${s.state_id}">Edit</button><button class="btn ghost sm" data-del="state:${s.state_id}">Delete</button>` }] : []),
  ], data.serviceState, { empty: 'Add at least one indicator, for example "branches reachable" or "transaction error rate".' })}</section>`,

    actions: (edit) => `<section class="panel"><div class="panel-head"><h2>Vendor actions</h2>${edit ? `<button class="btn sm" data-add="vendorAction">${icon('plus')} Record action</button>` : ''}</div>
      <p class="small muted">Record every action the vendor took. Attach evidence and have a bank validator verify it against bank-side data; vendor statements are not accepted on their own.</p>
      ${table([
    { label: 'When', render: (x) => `<span class="nowrap">${fmtDT(x.action_at)}</span><div class="small muted">${esc(x.vendor_actor)}</div>` },
    { label: 'Action', key: 'action_type' },
    { label: 'Description and outcome', render: (x) => `${nl2br(x.description)}${x.outcome ? `<div class="small muted">Outcome: ${nl2br(x.outcome)}</div>` : ''}` },
    { label: 'Evidence', render: (x) => evidenceLink(x.evidence_id) || '<span class="gap-flag">None</span>' },
    { label: 'Bank verification', render: (x) => (x.bank_verified ? `${pill('ok', 'Verified')}<div class="small muted">${esc(x.verified_by_name)}</div>` : pill('', 'Not verified')) },
    ...(edit ? [{ label: '', cls: 'row-actions', render: (x) => `${can(...BANK_VALIDATORS) ? `<button class="btn ghost sm" data-verify="${x.action_id}:${x.bank_verified ? 0 : 1}">${x.bank_verified ? 'Unverify' : 'Verify'}</button>` : ''}<button class="btn ghost sm" data-edit="vendorAction:${x.action_id}">Edit</button><button class="btn ghost sm" data-del="vendorAction:${x.action_id}">Delete</button>` }] : []),
  ], data.vendorActions, { empty: 'No vendor actions recorded yet.' })}</section>
    <section class="panel"><div class="panel-head"><h2>Evidence register</h2>${edit ? `<button class="btn sm" data-act="upload">${icon('plus')} Upload evidence</button>` : ''}</div>
      <p class="small muted">Files are stored read-only in the bank evidence store with their SHA-256 hash. The hash is part of the signed content.</p>
      ${table([
    { label: 'File', render: (e) => `<b>${esc(e.original_name)}</b><div class="small muted">${esc(e.description)}</div>` },
    { label: 'Source', key: 'source' },
    { label: 'Uploaded', render: (e) => `${fmtDT(e.uploaded_at)}<div class="small muted">${esc(e.uploaded_by_name)}</div>` },
    { label: 'SHA-256', render: (e) => `<span class="mono">${esc(e.sha256)}</span>` },
    { label: '', cls: 'row-actions', render: (e) => `<button class="btn ghost sm" data-ev-open="${e.evidence_id}">Download</button><button class="btn ghost sm" data-ev-verify="${e.evidence_id}">Check integrity</button>` },
  ], data.evidence, { empty: 'No evidence uploaded.' })}</section>`,

    sla: (edit) => {
      const s = data.slaSummary;
      const r = data.report;
      return `${s.criticalBreach ? '<div class="notice bad"><b>Critical override.</b> A critical SLA was breached. It is reported on its own and cannot be offset by other results.</div>' : ''}
      <div class="figures">
        <div class="figure"><div class="n">${s.total}</div><div class="l">SLAs evaluated</div></div>
        <div class="figure"><div class="n" style="color:var(--ok)">${s.met}</div><div class="l">Met</div></div>
        <div class="figure"><div class="n" style="color:var(--warn)">${s.atRisk}</div><div class="l">At risk</div></div>
        <div class="figure ${s.breached ? 'alert' : ''}"><div class="n">${s.breached}</div><div class="l">Breached</div></div>
        <div class="figure"><div class="n">${s.notMeasurable}</div><div class="l">Not measurable</div></div>
      </div>
      <section class="panel"><div class="panel-head"><h2>Results</h2><span class="muted small">${r.sla_calculated_at ? `Calculated ${fmtDT(r.sla_calculated_at)} with ${esc(r.sla_calc_version)}` : 'Not calculated yet'}</span>
        ${edit ? `<button class="btn primary sm" data-act="calc">${icon('calc')} Calculate SLA compliance</button>` : ''}</div>
        <p class="small muted">Targets come from the approved SLA catalogue for this service and priority, linked to the contract clause. Finalising the report recalculates automatically.</p>
        ${table([
    { label: 'SLA', render: (x) => `<b class="nowrap">${x.is_critical ? '<span class="crit-mark" title="Critical SLA">◆</span> ' : ''}${esc(x.sla_code)}</b><div>${esc(x.sla_name)}</div>` },
    { label: 'Target', cls: 'nowrap', render: (x) => `${x.direction === 'higher_is_better' ? '≥' : '≤'} ${fmtUnit(x.target_value, x.unit)}` },
    { label: 'Actual', cls: 'nowrap', render: (x) => `<b>${fmtUnit(x.actual_value, x.unit)}</b>` },
    { label: 'Result', render: (x) => pill(x.outcome) },
    { label: 'How it was measured', render: (x) => `<span class="small">${esc(x.calc_detail && x.calc_detail.explanation)}</span>` },
    { label: 'Clause and remedy', render: (x) => `${x.clause_ref ? `<span class="clause-ref">${esc(x.clause_ref)}</span>` : '<span class="gap-flag">No clause</span>'}${x.remedy_text ? `<div class="small muted">${esc(x.remedy_text)}</div>` : ''}` },
  ], data.slaResults, { empty: r.sla_calculated_at ? 'No approved SLA applies to this service and priority.' : 'Record the milestones, then calculate.' })}</section>`;
    },

    rca: (edit) => {
      const r = data.report;
      const locked = r.status === 'LOCKED' || r.status === 'APPROVED';
      return `<form class="panel" data-form="header">
        <div class="panel-head"><h2>Root cause</h2></div>
        <div class="form-grid">
          <label class="field">Root cause category<input name="root_cause_category" value="${esc(r.root_cause_category || '')}" list="dl-rcc" ${dis(edit)}><datalist id="dl-rcc">${['Change management', 'Software defect', 'Hardware failure', 'Capacity', 'Configuration', 'Third party / fourth party', 'Vendor change', 'Process', 'Human error', 'Environmental'].map((o) => `<option value="${o}">`).join('')}</datalist></label>
          <label class="field">RCA due<input type="datetime-local" name="rca_due_at" value="${toInput(r.rca_due_at)}" ${dis(edit)}></label>
          <label class="field wide"><span class="req">Root cause</span><textarea name="root_cause" ${dis(edit)}>${esc(r.root_cause || '')}</textarea></label>
          <label class="field wide">Contributing factors<textarea name="contributing_factors" ${dis(edit)}>${esc(r.contributing_factors || '')}</textarea></label>
          <label class="field">RCA received from vendor<input type="datetime-local" name="rca_received_at" value="${toInput(r.rca_received_at)}" ${dis(edit)}></label>
          <label class="field check" style="margin-top:22px"><input type="checkbox" name="rca_accepted" ${r.rca_accepted ? 'checked' : ''} ${dis(edit)}> RCA accepted by the bank</label>
        </div>
        ${edit ? '<div class="actions" style="margin-top:16px"><button class="btn primary" type="submit">Save root cause</button></div>' : ''}
      </form>
      <section class="panel"><div class="panel-head"><h2>Corrective and preventive actions</h2>${edit ? `<button class="btn sm" data-add="corrective">${icon('plus')} Add action</button>` : ''}</div>
        ${locked ? '<p class="small muted">The report is finalised. Action progress can still be updated here; the actions themselves are part of the sealed record.</p>' : ''}
        ${table([
    { label: 'Action', render: (c) => `${nl2br(c.description)}${c.source_finding ? `<div class="small muted">Finding: ${esc(c.source_finding)}</div>` : ''}` },
    { label: 'Type', render: (c) => esc(c.action_type.toLowerCase()) },
    { label: 'Owner', render: (c) => `${esc(c.owner_party)}<div class="small muted">${esc(c.owner_name)}</div>` },
    { label: 'Due', render: (c) => `<span class="nowrap">${fmtDay(c.due_date)}</span>` },
    { label: 'Severity', render: (c) => pill(c.severity) },
    { label: 'Status', render: (c) => (can('ADMIN', 'VM_SECTION_HEAD', 'VENDOR_MANAGER', 'IT_SECTION_HEAD', 'SERVICE_OWNER', 'TECH_OWNER') ? `<select data-ca-status="${c.action_issue_id}" aria-label="Status">${['OPEN', 'IN_PROGRESS', 'DONE_PENDING_REVIEW', 'CLOSED', 'CANCELLED'].map((s) => `<option value="${s}" ${s === c.status ? 'selected' : ''}>${LABEL[s]}</option>`).join('')}</select>` : pill(c.status)) },
    ...(edit ? [{ label: '', cls: 'row-actions', render: (c) => `<button class="btn ghost sm" data-edit="corrective:${c.action_issue_id}">Edit</button><button class="btn ghost sm" data-del="corrective:${c.action_issue_id}">Delete</button>` }] : []),
  ], data.corrective, { empty: 'Every SLA breach needs at least one corrective action.' })}</section>`;
    },

  };

  function evidenceLink(eid) {
    if (!eid) return '';
    const e = data.evidence.find((x) => x.evidence_id === eid);
    return e ? `<button class="btn ghost sm" data-ev-open="${eid}" title="SHA-256 ${esc(e.sha256)}">${esc(e.original_name)}</button>` : '';
  }

  // ---------------------------------------------------------------- dialogs
  async function upload() {
    await modal({
      title: 'Upload evidence',
      intro: 'Monitoring exports, logs, screenshots, vendor reports. Executables are refused; the limit is 25 MB per file.',
      body: `<div class="form-grid"><label class="field wide"><span class="req">File</span><input type="file" name="file" required></label>
        <label class="field wide">Description<input name="description" placeholder="What this proves"></label>
        <label class="field">Source<input name="source" list="dl-src" placeholder="Where it came from"><datalist id="dl-src"><option value="Network monitoring platform"><option value="ITSM"><option value="Vendor"><option value="APM"><option value="Batch scheduler"><option value="Access log"></datalist></label>
        <label class="field">Classification<select name="classification"><option>INTERNAL</option><option>CONFIDENTIAL</option><option>RESTRICTED</option></select></label></div>`,
      submitLabel: 'Upload',
      onSubmit: async (form) => {
        const file = form.file.files[0];
        if (!file) throw new Error('Choose a file.');
        if (file.size > 25 * 1024 * 1024) throw new Error('Files are limited to 25 MB.');
        await call('evidence.add', { reportId: data.report.report_id, name: file.name, mimeType: file.type, dataBase64: await fileToBase64(file), description: form.description.value, source: form.source.value, classification: form.classification.value });
        setData(await call('incidents.get', { id: data.report.report_id }));
        toast('Evidence stored and hashed.', 'ok');
        return true;
      },
    });
  }

  // ---------------------------------------------------------------- events
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button, [data-tab]');
    if (!t) return;
    const r = data.report;
    if (t.dataset.tab) { tab = t.dataset.tab; history.replaceState(null, '', `#/incidents/${r.report_id}/${tab}`); draw(); return; }
    if (t.dataset.add) return childEdit(t.dataset.add);
    if (t.dataset.edit || t.dataset.del) {
      const [kind, cid] = (t.dataset.edit || t.dataset.del).split(':');
      const list = { timeline: data.timeline, pause: data.pauses, state: data.serviceState, vendorAction: data.vendorActions, corrective: data.corrective }[kind];
      const row = list.find((x) => String(x[PK[kind]]) === cid);
      return t.dataset.edit ? childEdit(kind, row) : childDelete(kind, row);
    }
    if (t.dataset.pause) { const [pid, ap] = t.dataset.pause.split(':'); return act(() => call('incidents.approvePause', { reportId: r.report_id, pauseId: Number(pid), approved: ap === '1' }), ap === '1' ? 'Clock pause approved.' : 'Approval withdrawn.'); }
    if (t.dataset.verify) { const [aid, v] = t.dataset.verify.split(':'); return act(() => call('incidents.verifyAction', { reportId: r.report_id, actionId: Number(aid), verified: v === '1' }), v === '1' ? 'Vendor action verified.' : 'Verification removed.'); }
    if (t.dataset.evOpen) { const f = await guard(() => call('evidence.read', { id: Number(t.dataset.evOpen) })); if (!f.intact) toast('Warning: this file no longer matches its registered hash.', 'bad'); return downloadBase64(f.dataBase64, f.original_name, f.mime_type || 'application/octet-stream'); }
    if (t.dataset.evVerify) { const v = await guard(() => call('evidence.verify', { id: Number(t.dataset.evVerify) })); return toast(v.ok ? 'Intact: the file matches its registered SHA-256.' : v.reason, v.ok ? 'ok' : 'bad'); }
    switch (t.dataset.act) {
      case 'upload': return upload();
      case 'calc': return act(() => call('incidents.calculateSla', { id: r.report_id }), 'SLA compliance calculated.');
      case 'finalise': {
        if (r.status !== 'APPROVED' && !(await confirmDialog('Finalise this report?', 'SLA compliance is recalculated, the content is frozen, a sealed PDF is produced and the report is locked. It cannot be edited afterwards.', { submitLabel: 'Finalise report' }))) return;
        t.disabled = true;
        try {
          const res = await guard(() => call('incidents.finalize', { id: r.report_id }));
          setData(res.report);
          toast('Report finalised. The sealed PDF is registered.', 'ok');
        } catch (_) { /* shown */ } finally { t.disabled = false; }
        return;
      }
      case 'delete':
        if (!(await confirmDialog('Delete this draft?', 'The draft and its entries are removed. The deletion is recorded in the audit trail.', { submitLabel: 'Delete draft', danger: true }))) return;
        await guard(() => call('incidents.remove', { id: r.report_id }), 'Draft deleted.');
        location.hash = '#/incidents';
        return;
      case 'preview': {
        t.disabled = true;
        try { const b64 = await guard(() => call('incidents.previewPdf', { id: r.report_id })); await showPdf(b64, `${r.report_no}_working_copy.pdf`); } catch (_) { /* shown */ } finally { t.disabled = false; }
        return;
      }
      case 'openDoc': {
        const f = await guard(() => call('documents.read', { id: Number(t.dataset.id) }));
        if (!f.intact) toast('Warning: the stored file does not match its registered hash.', 'bad');
        return showPdf(f.dataBase64, f.fileName);
      }
      default:
    }
  });
  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form="header"]');
    if (!form) return;
    e.preventDefault();
    act(() => call('incidents.update', { id: data.report.report_id, data: readForm(form) }), 'Saved.');
  });
  root.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-ca-status]');
    if (!sel) return;
    act(() => call('incidents.saveChild', { reportId: data.report.report_id, kind: 'corrective', data: { action_issue_id: Number(sel.dataset.caStatus), status: sel.value } }), 'Action status updated.');
  });

  draw();
}
