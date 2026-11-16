'use strict';
/**
 * Print templates (HTML -> PDF) for the Vendor Incident Report and the
 * Service Commitment Report. Self-contained: inline CSS and an embedded logo,
 * so rendering never depends on network access.
 */
const fs = require('fs');
const path = require('path');

const TZ = 'Asia/Hebron';
const LOGO = (() => {
  try { return `data:image/jpeg;base64,${fs.readFileSync(path.join(__dirname, '../../renderer/assets/bop-logo.jpg')).toString('base64')}`; } catch (_) { return ''; }
})();

const FONT_DIR = path.join(__dirname, '../../renderer/assets/fonts');
const fontFace = (file, weight, range = '') => {
  try {
    const b64 = fs.readFileSync(path.join(FONT_DIR, file)).toString('base64');
    return `@font-face { font-family: "Plex"; font-weight: ${weight}; src: url(data:font/woff2;base64,${b64}) format("woff2");${range ? ` unicode-range: ${range};` : ''} }`;
  } catch (_) { return ''; }
};
const ARABIC = 'U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FEFF';
const FONTS = [
  fontFace('ibm-plex-sans-latin-400-normal.woff2', 400), fontFace('ibm-plex-sans-latin-600-normal.woff2', 600), fontFace('ibm-plex-sans-latin-700-normal.woff2', 700),
  fontFace('ibm-plex-sans-arabic-arabic-400-normal.woff2', 400, ARABIC), fontFace('ibm-plex-sans-arabic-arabic-600-normal.woff2', 600, ARABIC),
  fontFace('ibm-plex-mono-latin-400-normal.woff2', 400).replace('"Plex"', '"PlexMono"'),
].join('\n');

const esc = (v) => (v === null || v === undefined ? '' : String(v)).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (v) => esc(v).replace(/\n/g, '<br>');
const dt = (v) => (v ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) : '—');
const dtFull = (v) => (v ? `${new Intl.DateTimeFormat('en-GB', { timeZone: TZ, dateStyle: 'long', timeStyle: 'long' }).format(new Date(v))}` : '—');
const day = (v) => (v ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(`${v}T00:00:00Z`)) : '—');
const num = (v, d = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
const unit = (v, u) => (v === null || v === undefined ? '—' : `${num(v, u === 'percent' ? 4 : 2)}${u === 'percent' ? '%' : ` ${u}`}`);
const OUTCOME = { MET: 'Met', BREACHED: 'Breached', AT_RISK: 'At risk', NOT_MEASURABLE: 'Not measurable' };
const ROLE = { IT_SECTION_HEAD: 'Responsible BOP IT Section Head', VM_SECTION_HEAD: 'Vendor Management Section Head', CIO: 'Chief Information Officer', SERVICE_OWNER: 'Service Owner' };

const CSS = `
${FONTS}
@page { size: A4; margin: 16mm 14mm 18mm 14mm; }
* { box-sizing: border-box; }
body { font-family: "Plex", "Segoe UI", "Noto Sans", Arial, sans-serif; color: #2b1622; font-size: 9.5pt; line-height: 1.45; margin: 0; }
.band { display: flex; align-items: center; gap: 14px; background: #9e1b61; color: #fff; padding: 10px 14px; border-radius: 2px; }
.band img { width: 54px; height: 54px; border-radius: 2px; }
.band h1 { font-size: 15pt; margin: 0; font-weight: 600; letter-spacing: .2px; }
.band .sub { font-size: 9pt; opacity: .9; }
.band .right { margin-left: auto; text-align: right; font-size: 9pt; }
.band .right b { font-size: 12pt; display: block; }
.seal { display: inline-block; border: 1.5px solid #fff; padding: 1px 8px; border-radius: 10px; font-size: 8pt; margin-top: 3px; }
h2 { font-size: 11.5pt; color: #7a1149; border-bottom: 1.5px solid #9e1b61; padding-bottom: 3px; margin: 16px 0 8px; break-after: avoid; }
h3 { font-size: 10pt; margin: 10px 0 4px; color: #4a2238; }
table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; break-inside: auto; }
tr { break-inside: avoid; }
th, td { text-align: left; vertical-align: top; padding: 4px 6px; border-bottom: 0.6px solid #e3d2db; }
th { background: #f6edf2; color: #5b1438; font-weight: 600; font-size: 8.5pt; }
.kv td:first-child { width: 30%; color: #6b4a5c; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
.pill { display: inline-block; padding: 0 6px; border-radius: 8px; font-size: 8pt; font-weight: 600; border: 1px solid; }
.MET { color: #17603f; border-color: #17603f; } .BREACHED { color: #a3201b; border-color: #a3201b; }
.AT_RISK { color: #8a5a00; border-color: #8a5a00; } .NOT_MEASURABLE { color: #666; border-color: #999; }
.crit { color: #a3201b; font-weight: 700; }
.nowrap { white-space: nowrap; } .muted { color: #7b6370; } .small { font-size: 8pt; } .mono { font-family: "PlexMono", Consolas, monospace; font-size: 7.5pt; word-break: break-all; }
.callout { border-left: 3px solid #9e1b61; background: #fbf5f8; padding: 6px 10px; margin: 6px 0; }
.callout.bad { border-color: #a3201b; background: #fdf3f2; }
.sig { border: 1px solid #d9c3cf; border-radius: 3px; padding: 8px 10px; margin: 6px 0; break-inside: avoid; display: grid; grid-template-columns: 26px 1fr auto; gap: 10px; }
.sig .no { width: 24px; height: 24px; border-radius: 50%; background: #9e1b61; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; }
.sig .no.rej { background: #a3201b; }
.sig .who { font-weight: 600; font-size: 10pt; }
.sig .stamp { text-align: right; font-size: 8pt; }
.sig .stamp b { display: block; font-size: 10pt; color: #17603f; }
.sig .stamp b.rej { color: #a3201b; }
.foot { margin-top: 14px; border-top: 1px solid #e3d2db; padding-top: 6px; font-size: 7.5pt; color: #7b6370; }
`;

function shell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

function band(title, sub, rightTop, rightBottom, seal) {
  return `<div class="band">${LOGO ? `<img src="${LOGO}" alt="Bank of Palestine">` : ''}
    <div><div class="sub">Bank of Palestine · Vendor Management Section</div><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div>
    <div class="right"><b>${esc(rightTop)}</b>${esc(rightBottom)}${seal ? `<br><span class="seal">${esc(seal)}</span>` : ''}</div></div>`;
}

const kv = (rows) => `<table class="kv">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</table>`;

// ------------------------------------------------------------------ incident
function incidentReport({ full, approvals, verification, generatedAt, generatedBy, final }) {
  const r = full.report;
  const s = full.slaSummary;
  const evName = (id) => { const e = full.evidence.find((x) => x.evidence_id === id); return e ? `${esc(e.original_name)} <span class="mono">${e.sha256.slice(0, 16)}…</span>` : '—'; };
  const sigFor = (stepId) => approvals.signatures.filter((x) => x.step_id === stepId);
  const currentSteps = approvals.steps.filter((x) => x.revision === r.revision).sort((a, b) => a.step_no - b.step_no);

  const body = `
  ${band('Vendor Incident Report', `${r.vendor_name} — ${r.service_name}`, r.report_no, `Revision ${r.revision} · ${r.priority}`, final ? 'Approved · Locked' : r.status.replace('_', ' '))}

  <h2>1. Incident summary</h2>
  <div class="grid2">
    ${kv([['Title', esc(r.title)], ['Vendor', `${esc(r.vendor_name)} (${esc(r.vendor_code)}) · tier ${esc(r.risk_tier)}`], ['Service', `${esc(r.service_code)} — ${esc(r.service_name)}`], ['Service criticality', esc(r.criticality)], ['Responsible IT section', esc(r.section_name)]])}
    ${kv([['Priority', `<b>${esc(r.priority)}</b>`], ['Outage type', esc(r.outage_type)], ['Contract', r.contract_no ? `${esc(r.contract_no)} ${esc(r.contract_version_no)}` : '<span class="crit">No contract version linked</span>'], ['ITSM reference', esc(r.itsm_ref) || '—'], ['Vendor ticket', esc(r.vendor_ticket_ref) || '—']])}
  </div>
  ${s.criticalBreach ? '<div class="callout bad"><b>Critical override:</b> a critical SLA was breached. This is flagged independently of any aggregate score.</div>' : ''}

  <h2>2. Impact</h2>
  ${kv([['Impact summary', nl(r.impact_summary) || '—'], ['Business impact', nl(r.business_impact) || '—'], ['Customers affected', num(r.customers_affected, 0)], ['Channels affected', esc(r.channels_affected) || '—'], ['Estimated financial impact', r.financial_impact ? `USD ${num(r.financial_impact)}` : '—']])}

  <h2>3. Timeline</h2>
  <table><tr><th>Milestone</th><th>Time (${TZ})</th><th>Milestone</th><th>Time (${TZ})</th></tr>
    <tr><td>Detected</td><td>${dt(r.detected_at)}</td><td>Outage start</td><td>${dt(r.outage_start)}</td></tr>
    <tr><td>Reported to vendor (clock start)</td><td>${dt(r.reported_at)}</td><td>Outage end</td><td>${dt(r.outage_end)}</td></tr>
    <tr><td>Vendor acknowledged</td><td>${dt(r.acknowledged_at)}</td><td>Workaround</td><td>${dt(r.workaround_at)}</td></tr>
    <tr><td>Service restored</td><td>${dt(r.restored_at)}</td><td>Resolved</td><td>${dt(r.resolved_at)}</td></tr></table>
  <table><tr><th style="width:20%">Time</th><th style="width:12%">Party</th><th style="width:16%">Event</th><th>Description</th></tr>
    ${full.timeline.map((e) => `<tr><td>${dt(e.occurred_at)}</td><td>${esc(e.actor_party)}${e.actor_name ? `<br><span class="muted small">${esc(e.actor_name)}</span>` : ''}</td><td>${esc(e.event_type)}</td><td>${nl(e.description)}${e.source ? `<br><span class="muted small">Source: ${esc(e.source)}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No events recorded.</td></tr>'}</table>
  ${full.pauses.length ? `<h3>SLA clock pauses</h3><table><tr><th>Paused</th><th>Resumed</th><th>Reason</th><th>Bank approval</th></tr>${full.pauses.map((p) => `<tr><td>${dt(p.paused_at)}</td><td>${dt(p.resumed_at)}</td><td>${nl(p.reason)}</td><td>${p.approved ? `Approved by ${esc(p.approved_by_name)}` : '<span class="crit">Not approved — ignored</span>'}</td></tr>`).join('')}</table>` : ''}

  <h2>4. Service state before and after the incident</h2>
  <table><tr><th>Component</th><th>Indicator</th><th>Before</th><th>During</th><th>After</th><th>Evidence</th></tr>
    ${full.serviceState.map((x) => `<tr><td>${esc(x.component)}</td><td>${esc(x.indicator)}${x.unit ? ` <span class="muted">(${esc(x.unit)})</span>` : ''}</td><td>${esc(x.before_value)} ${x.before_status ? `<span class="muted small">${esc(x.before_status)}</span>` : ''}</td><td>${esc(x.during_value)}</td><td>${esc(x.after_value)} ${x.after_status ? `<span class="muted small">${esc(x.after_status)}</span>` : ''}</td><td>${x.evidence_id ? evName(x.evidence_id) : '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Not recorded.</td></tr>'}</table>

  <h2>5. Vendor actions and evidence</h2>
  <table><tr><th style="width:17%">Time</th><th style="width:14%">Action</th><th>Description and outcome</th><th style="width:22%">Evidence</th><th style="width:14%">Bank verification</th></tr>
    ${full.vendorActions.map((a) => `<tr><td>${dt(a.action_at)}${a.vendor_actor ? `<br><span class="muted small">${esc(a.vendor_actor)}</span>` : ''}</td><td>${esc(a.action_type)}</td><td>${nl(a.description)}${a.outcome ? `<br><span class="muted">Outcome: ${nl(a.outcome)}</span>` : ''}</td><td>${a.evidence_id ? evName(a.evidence_id) : '<span class="crit">None</span>'}</td><td>${a.bank_verified ? `Verified by ${esc(a.verified_by_name)}<br><span class="muted small">${dt(a.verified_at)}</span>` : '<span class="muted">Not verified</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No vendor actions recorded.</td></tr>'}</table>

  <h2>6. SLA compliance</h2>
  <p class="small muted">Calculated with engine ${esc(r.sla_calc_version || '—')} on ${dt(r.sla_calculated_at)}. ${s.total} SLA(s) evaluated: ${s.met} met, ${s.atRisk} at risk, ${s.breached} breached, ${s.notMeasurable} not measurable.</p>
  <table><tr><th style="width:30%">SLA</th><th>Target</th><th>Actual</th><th>Result</th><th>Contract clause</th><th>Remedy</th></tr>
    ${full.slaResults.map((x) => `<tr><td><b class="nowrap">${x.is_critical ? '<span class="crit">◆</span> ' : ''}${esc(x.sla_code)}</b><br>${esc(x.sla_name)}<br><span class="muted small">${esc(x.calc_detail && x.calc_detail.explanation)}</span></td><td>${unit(x.target_value, x.unit)}</td><td>${unit(x.actual_value, x.unit)}</td><td><span class="pill ${x.outcome}">${OUTCOME[x.outcome]}</span></td><td>${esc(x.clause_ref) || '<span class="crit">Not linked</span>'}</td><td class="small">${esc(x.remedy_text) || '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No SLA applies to this service and priority.</td></tr>'}</table>
  ${full.slaResults.some((x) => x.is_critical) ? '<p class="small muted">◆ Critical SLA: a breach triggers the critical override and executive escalation.</p>' : ''}

  <h2>7. Root cause and corrective actions</h2>
  ${kv([['Root cause category', esc(r.root_cause_category) || '—'], ['Root cause', nl(r.root_cause) || '—'], ['Contributing factors', nl(r.contributing_factors) || '—'], ['RCA received', `${dt(r.rca_received_at)}${r.rca_accepted ? ' · accepted by the bank' : ' · not yet accepted'}`]])}
  <table><tr><th>Action</th><th>Type</th><th>Owner</th><th>Due</th><th>Severity</th></tr>
    ${full.corrective.map((c) => `<tr><td>${nl(c.description)}${c.source_finding ? `<br><span class="muted small">Finding: ${esc(c.source_finding)}</span>` : ''}</td><td>${esc(c.action_type)}</td><td>${esc(c.owner_party)}${c.owner_name ? ` — ${esc(c.owner_name)}` : ''}</td><td>${day(c.due_date)}</td><td>${esc(c.severity)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No corrective actions recorded.</td></tr>'}</table>

  <h2>8. Approval and electronic signatures</h2>
  <p class="small muted">Each approver re-authenticated with their password, which unlocked a personal Ed25519 signing key. The signature covers the report content hash, the decision, the time and the previous signature (chain).</p>
  ${currentSteps.map((st) => {
    const sig = sigFor(st.step_id).slice(-1)[0];
    const rej = sig && sig.decision === 'REJECTED';
    return `<div class="sig"><div class="no ${rej ? 'rej' : ''}">${st.step_no}</div>
      <div><div class="who">${esc(st.step_label)}</div><div class="muted small">${esc(st.responsibility || ROLE[st.role_code] || '')}</div>
        ${sig ? `<div>${esc(sig.signer_name)}${sig.signer_title ? `, ${esc(sig.signer_title)}` : ''}</div>
        ${sig.reason ? `<div class="small">Comment: ${esc(sig.reason)}</div>` : ''}
        <div class="mono">Key ${esc(sig.key_fingerprint)}<br>Signature ${esc(sig.signature_hash)}</div>` : `<div class="muted">${esc(st.status === 'PENDING' ? 'Awaiting signature' : st.status.toLowerCase())}</div>`}</div>
      <div class="stamp">${sig ? `<b class="${rej ? 'rej' : ''}">${rej ? 'Returned' : 'Approved'}</b>${dtFull(sig.signed_at)}<br><span class="muted">${esc(sig.signed_at)} UTC</span><br><span class="muted">${esc(sig.auth_method)}</span>` : ''}</div></div>`;
  }).join('')}
  ${verification ? `<p class="small">${verification.ok ? 'All signatures verified against their public keys and the signature chain is intact.' : '<span class="crit">Signature verification failed — see the approval history.</span>'}</p>` : ''}

  <h3>Approval history</h3>
  <table><tr><th>Rev.</th><th>Step</th><th>Status</th><th>By</th><th>When</th><th>Comment</th></tr>
    ${approvals.steps.slice().sort((a, b) => a.revision - b.revision || a.step_no - b.step_no).map((st) => `<tr><td>${st.revision}</td><td>${esc(st.step_label)}</td><td>${esc(st.status)}</td><td>${esc(st.decided_by_name) || '—'}</td><td>${dt(st.decided_at)}</td><td class="small">${esc(st.decision_comment) || ''}</td></tr>`).join('')}</table>

  <h2>9. Document integrity</h2>
  ${kv([['Signed content hash (SHA-256)', `<span class="mono">${esc(r.content_hash)}</span>`], ['Report submitted', dt(r.submitted_at)], ['Final approval', dt(r.approved_at)], ['Generated', `${dt(generatedAt)} by ${esc(generatedBy)}`]])}
  <h3>Evidence register</h3>
  <table><tr><th>#</th><th>File</th><th>Source</th><th>Uploaded</th><th>SHA-256</th></tr>
    ${full.evidence.map((e) => `<tr><td>${e.evidence_id}</td><td>${esc(e.original_name)}<br><span class="muted small">${esc(e.description)}</span></td><td>${esc(e.source)}</td><td>${dt(e.uploaded_at)}<br><span class="muted small">${esc(e.uploaded_by_name)}</span></td><td class="mono">${e.sha256}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No evidence files.</td></tr>'}</table>
  <div class="foot">${final ? 'This PDF was generated and sealed automatically after the final approval. Its SHA-256 is registered in the VMS-SLA document register and the audit trail; editing is disabled by the PDF permissions. Any copy whose hash differs from the register is not an authentic record. A signature manifest (JSON) is embedded as an attachment.' : 'Working copy — not an approved record.'}</div>`;
  return shell(`${r.report_no} — Vendor Incident Report`, body);
}

// ------------------------------------------------------------------ commitments
function commitmentReport({ rep, generatedAt, generatedBy }) {
  const v = rep.vendor;
  const s = rep.service;
  const cv = rep.contractVersion;
  const clause = (x, prefix = 'clause') => (x[`${prefix}_ref`] ? `<b>${esc(x[`${prefix}_ref`])}</b>${x[`${prefix}_title`] ? ` ${esc(x[`${prefix}_title`])}` : ''}${x[`${prefix}_page`] ? ` <span class="muted">p.${x[`${prefix}_page`]}</span>` : ''}${x[`${prefix}_text`] ? `<br><span class="muted small">“${esc(String(x[`${prefix}_text`]).slice(0, 260))}${String(x[`${prefix}_text`]).length > 260 ? '…' : ''}”</span>` : ''}` : '<span class="crit">No clause linked</span>');
  const body = `
  ${band('Service Commitment Report', `${v.legal_name} — ${s.service_name}`, s.service_code, `As of ${day(rep.asOf)}`)}
  <h2>1. Relationship</h2>
  <div class="grid2">
    ${kv([['Vendor', `${esc(v.legal_name)}${v.legal_name_ar ? `<br><span dir="rtl">${esc(v.legal_name_ar)}</span>` : ''}`], ['Risk tier', esc(v.risk_tier)], ['Relationship manager', esc(v.relationship_manager) || '—'], ['Scope', nl(rep.vendorService.scope) || '—']])}
    ${kv([['Service', `${esc(s.service_code)} — ${esc(s.service_name)}`], ['Tower / criticality', `${esc(s.service_tower)} · ${esc(s.criticality)}`], ['IT section', `${esc(s.section_name)} (head: ${esc(s.section_head) || '—'})`], ['Service owner / technical owner', `${esc(s.service_owner) || '—'} / ${esc(s.technical_owner) || '—'}`]])}
  </div>
  ${kv([['Governing contract', cv ? `${esc(cv.contract_no)} — ${esc(cv.contract_title)}, version ${esc(cv.version_no)} (effective ${day(cv.effective_from)}${cv.effective_to ? ` to ${day(cv.effective_to)}` : ''})` : '<span class="crit">No approved contract version</span>'], ['Contract term', cv ? `${day(cv.start_date)} to ${day(cv.end_date)} · notice ${cv.notice_period_days || '—'} days` : '—'], ['Clause coverage', `${rep.coverage.linked} of ${rep.coverage.total} commitments linked to a contract clause`]])}

  <h2>2. SLA targets</h2>
  <table><tr><th>SLA</th><th>Priority</th><th>Target</th><th>Window / clock</th><th>Contract clause</th><th>Remedy</th></tr>
    ${rep.slas.map((x) => `<tr><td><b class="nowrap">${x.is_critical ? '<span class="crit">◆</span> ' : ''}${esc(x.sla_code)}</b><br>${esc(x.name)}</td><td>${esc(x.priority) || 'All'}</td><td class="nowrap">${x.direction === 'higher_is_better' ? '≥' : '≤'} ${unit(x.target_value, x.unit)}</td><td>${esc(String(x.measurement_window).replace(/_/g, ' '))}<br><span class="muted small">${x.support_window_code === 'business_hours' ? 'business hours' : '24x7'}</span>${x.exclusions ? `<br><span class="muted small">Excl.: ${esc(x.exclusions)}</span>` : ''}</td><td>${clause(x)}</td><td class="small">${x.remedy_clause_ref ? `${clause(x, 'remedy_clause')}<br>` : ''}${esc(x.remedy_text) || ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No approved SLA.</td></tr>'}</table>

  <h2>3. Support hours</h2>
  <table><tr><th>Cover</th><th>Applies to</th><th>Days</th><th>Hours</th><th>Channels</th><th>Contract clause</th></tr>
    ${rep.supportHours.map((w) => `<tr><td>${esc(w.label)}</td><td>${esc(w.applies_to) || '—'}</td><td>${esc(w.days_of_week)}</td><td>${esc(w.start_time)}–${esc(w.end_time)} <span class="muted small">${esc(w.timezone)}</span></td><td>${esc(w.channels) || '—'}</td><td>${clause(w)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Not defined.</td></tr>'}</table>

  <h2>4. Escalation contacts</h2>
  <div class="grid2"><div><h3>Vendor</h3><table><tr><th>Level</th><th>Contact</th><th>Reach</th></tr>
    ${rep.vendorContacts.map((c) => `<tr><td>${c.escalation_level}</td><td>${esc(c.full_name)}<br><span class="muted small">${esc(c.role_title)}${c.is_primary ? ' · primary' : ''}${c.is_backup ? ' · backup' : ''}</span></td><td class="small">${esc(c.phone)}<br>${esc(c.email)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">None.</td></tr>'}</table></div>
  <div><h3>Bank</h3><table><tr><th>Level</th><th>Scope</th><th>Contact</th></tr>
    ${rep.bankEscalation.map((b) => `<tr><td>${b.level}</td><td>${esc(b.scope)}</td><td>${esc(b.name) || '<span class="crit">Unassigned</span>'}<br><span class="muted small">${esc(b.title)}</span></td></tr>`).join('')}</table></div></div>

  <h2>5. Responsibilities</h2>
  <table><tr><th>Activity</th><th>Bank</th><th>Vendor</th><th>Contract clause</th></tr>
    ${rep.responsibilities.map((x) => `<tr><td>${esc(x.activity)}</td><td>${esc(x.bank_party)} <b>${esc(x.bank_raci)}</b></td><td>${esc(x.vendor_party)} <b>${esc(x.vendor_raci)}</b></td><td>${clause(x)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Not defined.</td></tr>'}</table>

  <h2>6. Other contractual obligations</h2>
  <table><tr><th>Category</th><th>Obligation</th><th>Owners</th><th>Frequency</th><th>Contract clause</th></tr>
    ${rep.obligations.map((x) => `<tr><td>${esc(x.category)}</td><td>${nl(x.description)}</td><td class="small">Bank: ${esc(x.bank_owner_role) || '—'}<br>Vendor: ${esc(x.vendor_owner_role) || '—'}</td><td>${esc(x.frequency) || '—'}</td><td>${clause(x)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">None recorded.</td></tr>'}</table>

  ${rep.coverage.gaps.length ? `<h2>7. Gaps to resolve</h2><div class="callout bad">${rep.coverage.gaps.map((g) => `<div>${esc(g.kind)}: ${esc(g.name)}</div>`).join('')}</div>` : ''}
  <div class="foot">Generated ${dt(generatedAt)} by ${esc(generatedBy)} from the governed VMS-SLA catalogue. Clause text is quoted from the approved contract version; the signed contract in the DMS is authoritative.</div>`;
  return shell(`${s.service_code} — Service Commitment Report`, body);
}

module.exports = { incidentReport, commitmentReport };
