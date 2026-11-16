'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('@cantoo/pdf-lib');
const { Database } = require('../main/db/database');
const { createApi } = require('../main/api');

/** Minimal PDF renderer for tests (no browser needed). */
async function fakeRenderPdf(html) {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).drawText(String(html.length), { x: 50, y: 800, size: 12 });
  return Buffer.from(await doc.save());
}

/** Empty personal-edition installation driven through the same API the UI uses. */
async function freshApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vms-personal-'));
  const paths = { data: dir, evidence: path.join(dir, 'evidence'), documents: path.join(dir, 'documents') };
  Object.values(paths).forEach((p) => fs.mkdirSync(p, { recursive: true }));
  const db = await Database.open(null);
  const ctx = { db, paths, renderPdf: fakeRenderPdf, dbFile: null };
  const api = createApi(ctx);
  const call = async (ch, args) => {
    const r = await api.invoke(ch, args);
    if (!r.ok) { const e = new Error(r.error.message); e.code = r.error.code; throw e; }
    return r.data;
  };
  return { ctx, db, call };
}

/** A small illustrative catalogue: one section, vendor, service, contract with clauses and SLAs. */
async function catalogue(call) {
  const sec = await call('registry.save', { entity: 'bank_section', data: { section_name: 'Network & Telecom' } });
  const v = await call('registry.save', { entity: 'vendor', data: { legal_name: 'Example Carrier Ltd.', risk_tier: 'CRITICAL' } });
  const s = await call('registry.save', { entity: 'service', data: { service_name: 'Branch WAN', service_tower: 'Network & Telecom', criticality: 'CRITICAL', section_id: sec.section_id } });
  const c = await call('registry.save', { entity: 'contract', data: { vendor_id: v.vendor_id, title: 'Managed WAN', start_date: '2026-01-01', end_date: '2027-12-31' } });
  const cv = await call('registry.save', { entity: 'contract_version', data: { contract_id: c.contract_id, effective_from: '2026-01-01', status: 'APPROVED' } });
  const cl = await call('registry.save', { entity: 'contract_clause', data: { version_id: cv.version_id, clause_ref: '5.2', title: 'P1 response', clause_type: 'SLA', clause_text: 'Respond within 15 minutes.' } });
  await call('registry.save', { entity: 'vendor_service', data: { vendor_id: v.vendor_id, service_id: s.service_id, contract_id: c.contract_id } });
  const sla = await call('registry.save', { entity: 'sla_definition', data: { name: 'P1 response', service_id: s.service_id, metric_code: 'INCIDENT_RESPONSE', priority: 'P1', direction: 'lower_is_better', target_value: 15, unit: 'minutes', measurement_window: 'per_incident', support_window_code: '24x7', is_critical: 1, formula_version: 'v1', effective_from: '2026-01-01', approval_status: 'APPROVED' } });
  await call('registry.save', { entity: 'sla_contract_mapping', data: { sla_id: sla.sla_id, version_id: cv.version_id, clause_id: cl.clause_id } });
  return { sec, v, s, c, cv, cl, sla };
}

async function completeIncident(call, k) {
  const r = await call('incidents.create', { vendor_id: k.v.vendor_id, service_id: k.s.service_id, title: 'WAN outage', priority: 'P1', detected_at: '2026-11-10T08:00:00Z' });
  const id = r.report_id;
  await call('incidents.update', { id, data: { impact_summary: 'Branches offline', reported_at: '2026-11-10T08:05:00Z', acknowledged_at: '2026-11-10T08:30:00Z', restored_at: '2026-11-10T10:00:00Z', root_cause: 'Fibre cut', outage_type: 'FULL', outage_start: '2026-11-10T08:00:00Z', outage_end: '2026-11-10T10:00:00Z' } });
  await call('incidents.saveChild', { reportId: id, kind: 'timeline', data: { occurred_at: '2026-11-10T08:00:00Z', event_type: 'Detection', actor_party: 'BANK', description: 'Alarm' } });
  await call('incidents.saveChild', { reportId: id, kind: 'state', data: { component: 'WAN', indicator: 'Branches up', before_value: '76', during_value: '40', after_value: '76' } });
  await call('incidents.saveChild', { reportId: id, kind: 'vendorAction', data: { action_at: '2026-11-10T09:50:00Z', action_type: 'Fix', description: 'Spliced fibre' } });
  await call('incidents.saveChild', { reportId: id, kind: 'corrective', data: { description: 'Add a diverse route', owner_party: 'VENDOR' } });
  return r;
}

module.exports = { freshApp, catalogue, completeIncident, fakeRenderPdf };
