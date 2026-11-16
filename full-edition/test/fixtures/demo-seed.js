'use strict';
/**
 * TEST FIXTURE ONLY - not shipped with the application.
 * Demonstration data. Organisations, people and contracts are fictional.
 * Seeding runs the real workflow (calculate SLA, submit, sign with each
 * approver's key, seal the PDF), so the demo data is itself an end-to-end test.
 */
const { nowIso } = require('../../main/services/util');
const auth = require('../../main/services/auth');
const incidents = require('../../main/services/incidents');
const approvals = require('../../main/services/approvals');
const evidence = require('../../main/services/evidence');
const documents = require('../../main/report/documents');
const { seedPolicy } = require('../../main/db/bootstrap');

const DEMO_PASSWORD = 'Bop@Demo2026!';

function ins(db, table, row) {
  const cols = Object.keys(row);
  return db.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c])).lastId;
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

async function seedDemo(ctx, { log = () => {} } = {}) {
  const { db } = ctx;
  log('Seeding demonstration data...');
  seedPolicy(db);
  const now = nowIso();

  // ------------------------------------------------------------ sections + users
  const sec = {};
  for (const [code, name, dept] of [
    ['INFRA', 'Infrastructure & Data Centre', 'Information Technology'],
    ['NET', 'Network & Telecom', 'Information Technology'],
    ['APP', 'Core Banking & Applications', 'Information Technology'],
    ['SEC', 'Cybersecurity', 'Information Technology'],
    ['VMS', 'Vendor Management', 'Procurement & Vendor Management'],
  ]) sec[code] = ins(db, 'bank_section', { section_code: code, section_name: name, department: dept, active: 1, created_at: now });

  const people = [
    ['admin', 'System Administrator', 'ADMIN', null, 'VMS-SLA administrator'],
    ['vm.head', 'Lina Khoury', 'VM_SECTION_HEAD', 'VMS', 'Vendor Management Section Head'],
    ['vm.manager', 'Omar Saleh', 'VENDOR_MANAGER', 'VMS', 'Vendor Relationship Manager'],
    ['net.head', 'Sami Odeh', 'IT_SECTION_HEAD', 'NET', 'Head of Network & Telecom'],
    ['app.head', 'Maha Nassar', 'IT_SECTION_HEAD', 'APP', 'Head of Core Banking & Applications'],
    ['infra.head', 'Yousef Darwish', 'IT_SECTION_HEAD', 'INFRA', 'Head of Infrastructure & Data Centre'],
    ['cio', 'Khaled Mansour', 'CIO', null, 'Chief Information Officer'],
    ['net.tech', 'Hadi Barghouti', 'TECH_OWNER', 'NET', 'Senior Network Engineer'],
    ['app.owner', 'Dana Awad', 'SERVICE_OWNER', 'APP', 'Digital Channels Service Owner'],
    ['auditor', 'Nour Hamdan', 'AUDITOR', null, 'IT Internal Auditor'],
  ];
  const u = {};
  for (const [username, full_name, role_code, s, job_title] of people) {
    u[username] = auth.createUser(db, null, { username, full_name, role_code, section_id: s ? sec[s] : null, job_title, email: `${username}@example.bank`, password: DEMO_PASSWORD });
  }
  for (const [code, head] of [['NET', 'net.head'], ['APP', 'app.head'], ['INFRA', 'infra.head'], ['VMS', 'vm.head']]) {
    db.run('UPDATE bank_section SET head_user_id = ? WHERE section_id = ?', [u[head].user_id, sec[code]]);
  }

  // ------------------------------------------------------------ vendors
  const V = (code, legal, ar, tier, country, notes) => ins(db, 'vendor', { vendor_code: code, legal_name: legal, legal_name_ar: ar, registration_no: `REG-${code}`, country, status: 'ACTIVE', risk_tier: tier, relationship_manager_id: u['vm.manager'].user_id, notes, created_at: now });
  const vNet = V('LCN', 'Levant Connect Networks Ltd.', 'ليفانت كونكت للشبكات', 'CRITICAL', 'Palestine', 'Primary MPLS/WAN carrier for the branch network.');
  const vCbs = V('QCS', 'Al-Quds Core Systems Co.', 'شركة القدس للأنظمة المصرفية', 'CRITICAL', 'Palestine', 'Core banking application support and enhancements.');
  const vDc = V('JDC', 'Jericho Data Centre Services', 'أريحا لخدمات مراكز البيانات', 'HIGH', 'Palestine', 'Colocation and managed hosting for the secondary site.');
  const vAtm = V('CSS', 'Crescent Self-Service Solutions', 'الهلال لحلول الخدمة الذاتية', 'HIGH', 'Jordan', 'ATM first- and second-line maintenance.');

  const contacts = {
    [vNet]: [['Rami Khalil', 'NOC Duty Manager', 1, '+970 2 000 1101', 'noc@levant-connect.example'], ['Iyad Shaheen', 'Service Delivery Manager', 2, '+970 59 000 1102', 'sdm@levant-connect.example'], ['Hiba Qasem', 'Account Director', 3, '+970 59 000 1103', 'accounts@levant-connect.example'], ['Fadi Rantisi', 'Chief Operating Officer', 4, '+970 59 000 1104', 'coo@levant-connect.example']],
    [vCbs]: [['Support Desk', '24x7 Application Support', 1, '+970 2 000 2201', 'support@alquds-core.example'], ['Samer Jaber', 'Support Manager', 2, '+970 59 000 2202', 'support.manager@alquds-core.example'], ['Reem Abu Ali', 'Client Partner', 3, '+970 59 000 2203', 'client@alquds-core.example'], ['Tariq Zughayer', 'Managing Director', 4, '+970 59 000 2204', 'md@alquds-core.example']],
    [vDc]: [['Operations Centre', 'Site Operations', 1, '+970 2 000 3301', 'ops@jericho-dc.example'], ['Mona Atallah', 'Site Manager', 2, '+970 59 000 3302', 'site@jericho-dc.example'], ['Jamil Haddad', 'Commercial Director', 3, '+970 59 000 3303', 'commercial@jericho-dc.example']],
    [vAtm]: [['Field Service Desk', 'Dispatch', 1, '+962 6 000 4401', 'dispatch@crescent-ss.example'], ['Ahmad Tamimi', 'Country Service Manager', 2, '+962 79 000 4402', 'service@crescent-ss.example'], ['Layla Hijazi', 'Regional Director', 3, '+962 79 000 4403', 'regional@crescent-ss.example']],
  };
  for (const [vid, list] of Object.entries(contacts)) {
    list.forEach(([n, r, lvl, ph, em], i) => ins(db, 'vendor_contact', { vendor_id: Number(vid), full_name: n, role_title: r, escalation_level: lvl, phone: ph, email: em, is_primary: i === 0 ? 1 : 0, is_backup: 0, active: 1, created_at: now }));
  }

  // ------------------------------------------------------------ services
  const S = (code, name, tower, crit, s, owner, tech, desc) => ins(db, 'service', { service_code: code, service_name: name, service_tower: tower, criticality: crit, data_classification: 'CONFIDENTIAL', section_id: sec[s], service_owner_id: u[owner].user_id, technical_owner_id: u[tech].user_id, description: desc, created_at: now });
  const sWan = S('SVC-WAN-001', 'Branch WAN (MPLS)', 'Network & Telecom', 'CRITICAL', 'NET', 'vm.manager', 'net.tech', 'MPLS connectivity between head office, data centres and all branches.');
  const sCbs = S('SVC-CBS-001', 'Core Banking Application Support', 'Core Banking / Applications', 'CRITICAL', 'APP', 'app.owner', 'app.head', 'Level 2/3 support of the core banking application and end-of-day batch.');
  const sDc = S('SVC-DC-002', 'Secondary Data Centre Hosting', 'Infrastructure & Data Centre', 'CRITICAL', 'INFRA', 'vm.manager', 'infra.head', 'Colocation, power, cooling and remote hands for the secondary data centre.');
  const sAtm = S('SVC-ATM-001', 'ATM Fleet Maintenance', 'ATM / Branch Technology', 'HIGH', 'INFRA', 'app.owner', 'infra.head', 'Preventive and corrective maintenance for the ATM fleet.');

  // ------------------------------------------------------------ contracts + clauses
  const contractsDef = [
    { v: vNet, s: sWan, no: 'CON-2025-0017', title: 'Managed WAN and MPLS Services Agreement', start: '2025-01-01', end: '2027-12-31', notice: 180, value: 1240000, versions: [['v1', '2025-01-01', '2026-06-30', 'SUPERSEDED'], ['v2', '2026-07-01', null, 'APPROVED']] },
    { v: vCbs, s: sCbs, no: 'CON-2024-0042', title: 'Core Banking Support and Maintenance Agreement', start: '2024-01-01', end: '2026-12-31', notice: 90, value: 2150000, versions: [['v3', '2025-04-01', null, 'APPROVED']] },
    { v: vDc, s: sDc, no: 'CON-2026-0008', title: 'Secondary Data Centre Colocation Agreement', start: '2026-03-01', end: '2029-02-28', notice: 180, value: 870000, versions: [['v1', '2026-03-01', null, 'APPROVED']] },
    { v: vAtm, s: sAtm, no: 'CON-2023-0031', title: 'ATM Maintenance Services Contract', start: '2023-02-01', end: '2027-01-31', notice: 90, value: 640000, versions: [['v2', '2025-02-01', null, 'APPROVED']] },
  ];
  const C = {};
  for (const cd of contractsDef) {
    const cid = ins(db, 'contract', { vendor_id: cd.v, contract_no: cd.no, title: cd.title, start_date: cd.start, end_date: cd.end, notice_period_days: cd.notice, contract_value: cd.value, currency: 'USD', status: 'ACTIVE', repository_ref: `DMS://contracts/${cd.no}`, owner_user_id: u['vm.head'].user_id, created_at: now });
    let current;
    for (const [vno, from, to, st] of cd.versions) {
      const vid = ins(db, 'contract_version', { contract_id: cid, version_no: vno, effective_from: from, effective_to: to, approval_ref: `BOARD-PROC-${cd.no.slice(-4)}-${vno}`, file_hash: require('crypto').createHash('sha256').update(cd.no + vno).digest('hex'), status: st, created_at: now });
      if (st === 'APPROVED') current = vid;
    }
    const vsId = ins(db, 'vendor_service', { vendor_id: cd.v, service_id: cd.s, contract_id: cid, scope: '', start_date: cd.start, end_date: cd.end, status: 'ACTIVE', created_at: now });
    C[cd.no] = { cid, version: current, vs: vsId, vendor: cd.v, service: cd.s };
  }
  db.run('UPDATE vendor_service SET scope = ? WHERE vendor_service_id = ?', ['MPLS access circuits for 76 branches, two data-centre hubs and internet breakout; CPE routers; 24x7 NOC monitoring and proactive fault reporting.', C['CON-2025-0017'].vs]);
  db.run('UPDATE vendor_service SET scope = ? WHERE vendor_service_id = ?', ['Level 2 and 3 support of the core banking application (production, DR and UAT), end-of-day batch support, defect fixes and regulatory patches.', C['CON-2024-0042'].vs]);
  db.run('UPDATE vendor_service SET scope = ? WHERE vendor_service_id = ?', ['Four racks in Hall B with A/B power feeds, N+1 cooling, physical security and remote hands.', C['CON-2026-0008'].vs]);
  db.run('UPDATE vendor_service SET scope = ? WHERE vendor_service_id = ?', ['Corrective and preventive maintenance of 142 ATMs, spare parts and first-line field service.', C['CON-2023-0031'].vs]);

  const clause = (no, ref, title, type, text, page) => ins(db, 'contract_clause', { version_id: C[no].version, clause_ref: ref, title, clause_type: type, clause_text: text, page_no: page, created_at: now });
  const K = {};
  const wan = 'CON-2025-0017';
  K.wanSupport = clause(wan, 'Sch. B 3.1', 'Support hours', 'SUPPORT', 'The Supplier shall provide network operations and fault management 24 hours a day, 7 days a week, including public holidays, through the NOC telephone line and service portal.', 14);
  K.wanSupportBh = clause(wan, 'Sch. B 3.2', 'Service management hours', 'SUPPORT', 'Service requests, moves, adds and changes shall be handled Sunday to Thursday, 08:00 to 16:00 local time.', 14);
  K.wanAvail = clause(wan, 'Sch. B 5.1', 'Network availability', 'AVAILABILITY', 'The Supplier shall ensure the core MPLS network is available not less than 99.9% of each calendar month, measured by the Bank network monitoring platform, excluding pre-approved maintenance windows.', 17);
  K.wanP1Resp = clause(wan, 'Sch. B 5.2', 'Priority 1 response', 'SLA', 'For a Priority 1 incident the Supplier shall acknowledge and assign an engineer within fifteen (15) minutes of notification by the Bank.', 17);
  K.wanP1Rest = clause(wan, 'Sch. B 5.3', 'Priority 1 restoration', 'SLA', 'For a Priority 1 incident the Supplier shall restore service, by permanent fix or agreed workaround, within four (4) hours of notification, excluding periods where the Supplier is demonstrably waiting on the Bank.', 18);
  K.wanP2 = clause(wan, 'Sch. B 5.4', 'Priority 2 response and restoration', 'SLA', 'For a Priority 2 incident the Supplier shall respond within thirty (30) minutes and restore service within eight (8) hours.', 18);
  K.wanP3 = clause(wan, 'Sch. B 5.5', 'Priority 3 resolution', 'SLA', 'Priority 3 incidents shall be resolved within two (2) Business Days.', 18);
  K.wanRca = clause(wan, 'Sch. B 7.1', 'Root cause analysis', 'INCIDENT', 'For every Priority 1 and Priority 2 incident the Supplier shall deliver a written root cause analysis within five (5) Business Days of service restoration.', 20);
  K.wanCredit = clause(wan, 'Sch. B 8.2', 'Service credits', 'SERVICE_CREDIT', 'Where monthly availability falls below 99.9%, the Supplier shall credit 5% of the monthly recurring charge for each 0.1% (or part) below target, capped at 30%. Each Priority 1 restoration breach attracts a credit of 2% of the monthly charge.', 21);
  K.wanEsc = clause(wan, 'Sch. B 9.1', 'Escalation matrix', 'ESCALATION', 'The parties shall maintain the four-level escalation matrix in Annex 4. Unresolved Priority 1 incidents escalate to level 2 after 1 hour, level 3 after 2 hours and level 4 after 4 hours.', 22);
  K.wanResp = clause(wan, 'Sch. B 10.1', 'Responsibilities', 'RESPONSIBILITY', 'The Supplier is responsible for circuits, CPE and the provider core; the Bank is responsible for LAN, branch power and site access. Responsibilities are set out in the RACI in Annex 5.', 23);
  K.wanSec = clause(wan, 'Cl. 12.3', 'Security incident notification', 'SECURITY', 'The Supplier shall notify the Bank of any security incident affecting the services within two (2) hours of becoming aware of it.', 31);
  K.wanExit = clause(wan, 'Cl. 14.2', 'Exit assistance', 'EXIT', 'On termination or expiry the Supplier shall provide up to six (6) months of transition assistance at the then-current rates.', 36);

  const cbs = 'CON-2024-0042';
  K.cbsSupport = clause(cbs, 'Annex 2, 2.1', 'Support coverage', 'SUPPORT', 'Severity 1 and 2 support is available 24x7. Severity 3 and 4 support is available Sunday to Thursday 08:00-17:00.', 41);
  K.cbsAvail = clause(cbs, 'Annex 2, 4.1', 'Application availability', 'AVAILABILITY', 'Production core banking application availability shall be at least 99.95% per calendar month, excluding approved maintenance.', 43);
  K.cbsP1 = clause(cbs, 'Annex 2, 4.2', 'Severity 1 targets', 'SLA', 'Severity 1: response within 15 minutes; restoration within 2 hours.', 43);
  K.cbsP2 = clause(cbs, 'Annex 2, 4.3', 'Severity 2 targets', 'SLA', 'Severity 2: response within 30 minutes; restoration within 4 hours.', 44);
  K.cbsRca = clause(cbs, 'Annex 2, 6.1', 'Problem management', 'INCIDENT', 'Root cause analysis shall be provided within five (5) business days for Severity 1 and 2 incidents.', 46);
  K.cbsCredit = clause(cbs, 'Annex 3, 1.4', 'Service credits', 'SERVICE_CREDIT', 'Service credits of 3% of the monthly support fee per restoration breach, capped at 20%.', 51);
  K.cbsResp = clause(cbs, 'Annex 2, 8.1', 'Operating responsibilities', 'RESPONSIBILITY', 'The Bank operates infrastructure and runs the batch schedule; the Supplier supports the application and fixes defects.', 47);

  const dc = 'CON-2026-0008';
  K.dcAvail = clause(dc, 'Sch. 1, 2.1', 'Power and cooling availability', 'AVAILABILITY', 'Power to each rack (A or B feed) and cooling within ASHRAE limits shall be available 99.98% per month.', 9);
  K.dcP1 = clause(dc, 'Sch. 1, 3.2', 'Critical facility incidents', 'SLA', 'Critical facility incidents: response 15 minutes, restoration 1 hour.', 10);
  K.dcSupport = clause(dc, 'Sch. 1, 1.3', 'Site operations hours', 'SUPPORT', 'Site operations and remote hands are staffed 24x7x365.', 8);

  const atm = 'CON-2023-0031';
  K.atmAvail = clause(atm, 'Sch. A, 4', 'Fleet uptime', 'AVAILABILITY', 'Average ATM fleet uptime shall be at least 98.5% per calendar month.', 12);
  K.atmP2 = clause(atm, 'Sch. A, 5.2', 'Device fault restoration', 'SLA', 'For a device fault classified Priority 2 the Supplier shall arrive on site within 2 business hours and restore within 8 business hours.', 13);
  K.atmSupport = clause(atm, 'Sch. A, 3', 'Field service hours', 'SUPPORT', 'Field service is available Saturday to Thursday 08:00-18:00.', 11);

  // ------------------------------------------------------------ SLA catalogue
  const sla = (code, svc, vendor, name, metric, priority, target, unit, opts = {}) => ins(db, 'sla_definition', {
    sla_code: code, service_id: svc, vendor_id: vendor, name, metric_code: metric, priority,
    direction: metric === 'AVAILABILITY' ? 'higher_is_better' : 'lower_is_better', target_value: target, warning_value: opts.warning ?? null, unit,
    measurement_window: metric === 'AVAILABILITY' ? 'calendar_month' : 'per_incident', support_window_code: opts.bh ? 'business_hours' : '24x7',
    exclusions: opts.excl || (metric === 'AVAILABILITY' ? 'Pre-approved maintenance windows; bank-caused dependencies' : 'Approved clock pauses where the vendor is waiting on the bank'),
    evidence_source: opts.src || 'ITSM ticket timestamps', is_critical: opts.critical ? 1 : 0, weight: opts.weight ?? null, formula_version: 'v1',
    effective_from: opts.from || '2025-01-01', approval_status: 'APPROVED', created_at: now,
  });
  const map = (no, slaId, clauseId, target, remedyClause, remedyText) => ins(db, 'sla_contract_mapping', { version_id: C[no].version, sla_id: slaId, clause_id: clauseId, contractual_target: target, remedy_clause_id: remedyClause || null, remedy_text: remedyText || null, created_at: now });

  const L = {};
  L.wanAvail = sla('SLA-NET-AVAIL-001', sWan, vNet, 'Core MPLS network availability', 'AVAILABILITY', null, 99.9, 'percent', { critical: 1, warning: 99.95, src: 'Network monitoring platform', weight: 35 });
  L.wanP1Resp = sla('SLA-NET-P1-RESP', sWan, vNet, 'P1 incident response', 'INCIDENT_RESPONSE', 'P1', 15, 'minutes', { weight: 15 });
  L.wanP1Rest = sla('SLA-NET-P1-REST', sWan, vNet, 'P1 service restoration', 'INCIDENT_RESTORATION', 'P1', 4, 'hours', { critical: 1, warning: 3.5, weight: 20 });
  L.wanP2Resp = sla('SLA-NET-P2-RESP', sWan, vNet, 'P2 incident response', 'INCIDENT_RESPONSE', 'P2', 30, 'minutes', { weight: 5 });
  L.wanP2Rest = sla('SLA-NET-P2-REST', sWan, vNet, 'P2 service restoration', 'INCIDENT_RESTORATION', 'P2', 8, 'hours', { weight: 10 });
  L.wanP3 = sla('SLA-NET-P3-RES', sWan, vNet, 'P3 incident resolution', 'INCIDENT_RESOLUTION', 'P3', 2, 'days', { bh: 1, weight: 5 });
  L.wanRca = sla('SLA-NET-RCA-001', sWan, vNet, 'P1 root cause analysis delivery', 'RCA_DELIVERY', 'P1', 5, 'days', { bh: 1, weight: 10, src: 'Vendor RCA document received date' });
  map(wan, L.wanAvail, K.wanAvail, '≥ 99.9% per calendar month', K.wanCredit, '5% of MRC per 0.1% below target, cap 30%');
  map(wan, L.wanP1Resp, K.wanP1Resp, 'Acknowledge within 15 minutes');
  map(wan, L.wanP1Rest, K.wanP1Rest, 'Restore within 4 hours', K.wanCredit, '2% of MRC per P1 restoration breach');
  map(wan, L.wanP2Resp, K.wanP2, 'Respond within 30 minutes');
  map(wan, L.wanP2Rest, K.wanP2, 'Restore within 8 hours');
  map(wan, L.wanP3, K.wanP3, 'Resolve within 2 Business Days');
  map(wan, L.wanRca, K.wanRca, 'Written RCA within 5 Business Days');

  L.cbsAvail = sla('SLA-CBS-AVAIL-001', sCbs, vCbs, 'Core banking production availability', 'AVAILABILITY', null, 99.95, 'percent', { critical: 1, src: 'APM / application monitoring', weight: 35 });
  L.cbsP1Resp = sla('SLA-CBS-P1-RESP', sCbs, vCbs, 'Severity 1 response', 'INCIDENT_RESPONSE', 'P1', 15, 'minutes', { weight: 10 });
  L.cbsP1Rest = sla('SLA-CBS-P1-REST', sCbs, vCbs, 'Severity 1 restoration', 'INCIDENT_RESTORATION', 'P1', 2, 'hours', { critical: 1, weight: 20 });
  L.cbsP2Resp = sla('SLA-CBS-P2-RESP', sCbs, vCbs, 'Severity 2 response', 'INCIDENT_RESPONSE', 'P2', 30, 'minutes', { weight: 10 });
  L.cbsP2Rest = sla('SLA-CBS-P2-REST', sCbs, vCbs, 'Severity 2 restoration', 'INCIDENT_RESTORATION', 'P2', 4, 'hours', { weight: 15 });
  L.cbsRca = sla('SLA-CBS-RCA-001', sCbs, vCbs, 'Severity 1-2 RCA delivery', 'RCA_DELIVERY', null, 5, 'days', { bh: 1, weight: 10 });
  L.cbsP3 = sla('SLA-CBS-P3-RESP', sCbs, vCbs, 'Severity 3 response', 'INCIDENT_RESPONSE', 'P3', 4, 'hours', { bh: 1 });
  map(cbs, L.cbsAvail, K.cbsAvail, '≥ 99.95% per calendar month', K.cbsCredit);
  map(cbs, L.cbsP1Resp, K.cbsP1, 'Response within 15 minutes');
  map(cbs, L.cbsP1Rest, K.cbsP1, 'Restoration within 2 hours', K.cbsCredit, '3% of monthly support fee per breach');
  map(cbs, L.cbsP2Resp, K.cbsP2, 'Response within 30 minutes');
  map(cbs, L.cbsP2Rest, K.cbsP2, 'Restoration within 4 hours', K.cbsCredit, '3% of monthly support fee per breach');
  map(cbs, L.cbsRca, K.cbsRca, 'RCA within 5 business days');
  // SLA-CBS-P3-RESP is intentionally left unmapped: it shows up as a gap in the commitment report.

  L.dcAvail = sla('SLA-DC-AVAIL-001', sDc, vDc, 'Rack power and cooling availability', 'AVAILABILITY', null, 99.98, 'percent', { critical: 1, src: 'DCIM / BMS', from: '2026-03-01' });
  L.dcP1Resp = sla('SLA-DC-P1-RESP', sDc, vDc, 'Critical facility response', 'INCIDENT_RESPONSE', 'P1', 15, 'minutes', { from: '2026-03-01' });
  L.dcP1Rest = sla('SLA-DC-P1-REST', sDc, vDc, 'Critical facility restoration', 'INCIDENT_RESTORATION', 'P1', 1, 'hours', { critical: 1, from: '2026-03-01' });
  L.dcP3Res = sla('SLA-DC-P3-RES', sDc, vDc, 'Non-critical facility fault resolution', 'INCIDENT_RESOLUTION', 'P3', 3, 'days', { bh: 1, from: '2026-03-01' });
  map(dc, L.dcAvail, K.dcAvail, '≥ 99.98% per month');
  map(dc, L.dcP1Resp, K.dcP1, 'Response within 15 minutes');
  map(dc, L.dcP1Rest, K.dcP1, 'Restoration within 1 hour');

  L.atmAvail = sla('SLA-ATM-AVAIL-001', sAtm, vAtm, 'ATM fleet uptime', 'AVAILABILITY', null, 98.5, 'percent', { src: 'ATM monitoring' });
  L.atmP2Resp = sla('SLA-ATM-P2-RESP', sAtm, vAtm, 'P2 on-site arrival', 'INCIDENT_RESPONSE', 'P2', 2, 'hours', { bh: 1 });
  L.atmP2Rest = sla('SLA-ATM-P2-REST', sAtm, vAtm, 'P2 device restoration', 'INCIDENT_RESTORATION', 'P2', 8, 'hours', { bh: 1 });
  map(atm, L.atmAvail, K.atmAvail, '≥ 98.5% average fleet uptime');
  map(atm, L.atmP2Resp, K.atmP2, 'On site within 2 business hours');
  map(atm, L.atmP2Rest, K.atmP2, 'Restore within 8 business hours');

  // ------------------------------------------------------------ support hours, RACI, obligations
  const sw = (no, label, applies, days, from, to, channels, cl) => ins(db, 'support_window', { vendor_service_id: C[no].vs, label, applies_to: applies, days_of_week: days, start_time: from, end_time: to, timezone: 'Asia/Hebron', channels, clause_id: cl, created_at: now });
  sw(wan, 'Network operations and fault management', 'All incidents', 'Mon-Sun incl. holidays', '00:00', '23:59', 'NOC hotline, service portal', K.wanSupport);
  sw(wan, 'Service management and requests', 'Changes, requests, P3/P4', 'Sun-Thu', '08:00', '16:00', 'Service portal, email', K.wanSupportBh);
  sw(cbs, 'Critical support', 'Severity 1-2', 'Mon-Sun', '00:00', '23:59', 'Hotline, ITSM', K.cbsSupport);
  sw(cbs, 'Standard support', 'Severity 3-4', 'Sun-Thu', '08:00', '17:00', 'ITSM, email', K.cbsSupport);
  sw(dc, 'Site operations and remote hands', 'All', 'Mon-Sun', '00:00', '23:59', 'Operations centre phone, ticket', K.dcSupport);
  sw(atm, 'Field service', 'All device faults', 'Sat-Thu', '08:00', '18:00', 'Dispatch desk, ITSM', K.atmSupport);

  const raci = (no, activity, bp, br, vp, vr, cl) => ins(db, 'responsibility', { vendor_service_id: C[no].vs, activity, bank_party: bp, bank_raci: br, vendor_party: vp, vendor_raci: vr, clause_id: cl, created_at: now });
  raci(wan, 'Incident detection and logging', 'Service Desk / NOC', 'R', 'Supplier NOC', 'R', K.wanResp);
  raci(wan, 'Circuit and CPE fault repair', 'Network section', 'C', 'Supplier field engineering', 'A/R', K.wanResp);
  raci(wan, 'Branch site access and power', 'Branch operations', 'A/R', 'Supplier field engineering', 'C', K.wanResp);
  raci(wan, 'Root cause analysis', 'Network Section Head', 'A', 'Service Delivery Manager', 'R', K.wanRca);
  raci(wan, 'Monthly SLA reporting', 'Vendor Management', 'A', 'Service Delivery Manager', 'R', null);
  raci(cbs, 'Application incident resolution', 'Applications section', 'A', 'Supplier support', 'R', K.cbsResp);
  raci(cbs, 'End-of-day batch execution', 'Applications section', 'A/R', 'Supplier support', 'C', K.cbsResp);
  raci(dc, 'Power and cooling', 'Infrastructure section', 'I', 'Site operations', 'A/R', K.dcAvail);
  raci(atm, 'Cash replenishment', 'Branch operations', 'A/R', 'Field service', 'I', null);

  const ob = (no, cat, desc, bank, vend, freq, cl) => ins(db, 'contract_obligation', { version_id: C[no].version, vendor_service_id: C[no].vs, clause_id: cl, category: cat, description: desc, bank_owner_role: bank, vendor_owner_role: vend, frequency: freq, created_at: now });
  ob(wan, 'SECURITY', 'Notify the Bank of any security incident affecting the services within 2 hours.', 'CISO', 'Service Delivery Manager', 'Event-driven', K.wanSec);
  ob(wan, 'REPORTING', 'Deliver the monthly SLA performance report with raw availability data by the 5th business day.', 'Vendor Manager', 'Service Delivery Manager', 'Monthly', null);
  ob(wan, 'EXIT', 'Provide up to 6 months of transition assistance on termination or expiry.', 'Vendor Management Section Head', 'Account Director', 'On exit', K.wanExit);

  // ------------------------------------------------------------ incident reports
  const actor = (name) => u[name];
  const ev = (reportId, name, text, who, description, source) => evidence.add(db, ctx, actor(who), { reportId, name, mimeType: 'text/plain', dataBase64: b64(text), description, source });

  // 1) P1 WAN outage, fully approved and locked
  const r1 = incidents.create(db, actor('net.tech'), { vendor_id: vNet, service_id: sWan, title: 'MPLS core outage — 37 branches offline', priority: 'P1', detected_at: '2026-10-12T06:42:00Z' });
  incidents.update(db, actor('net.tech'), r1.report_id, {
    impact_summary: 'Loss of MPLS connectivity for 37 of 76 branches in the northern and central regions. Teller, ATM authorisation and branch printing were unavailable at affected sites.',
    business_impact: 'Branch counters operated in offline mode for cash only. 21 ATMs in affected areas declined transactions. Mobile and internet banking were not affected.',
    customers_affected: 5400, channels_affected: 'Branches, ATMs (21)', financial_impact: 18500, outage_type: 'FULL',
    reported_at: '2026-10-12T06:48:00Z', acknowledged_at: '2026-10-12T07:09:00Z', workaround_at: '2026-10-12T10:55:00Z', restored_at: '2026-10-12T11:31:00Z', resolved_at: '2026-10-13T09:00:00Z',
    outage_start: '2026-10-12T06:40:00Z', outage_end: '2026-10-12T11:31:00Z', itsm_ref: 'INC0048211', vendor_ticket_ref: 'LCN-TT-2026-118',
    root_cause_category: 'Change management', root_cause: 'A routing policy change on the provider core router PE-RAM-02, executed outside the approved maintenance window, withdrew the VPN routes for the northern VRF. The change was not peer reviewed and no rollback plan was attached.',
    contributing_factors: 'Provider NOC alarm for route withdrawal was suppressed during the change. Escalation to level 2 occurred 72 minutes after detection instead of 60.',
    rca_due_at: '2026-10-19T11:31:00Z', rca_received_at: '2026-10-16T13:00:00Z', rca_accepted: 1,
  });
  const T = (rid, who, at, type, party, name, desc, src) => incidents.saveChild(db, actor(who), rid, 'timeline', { occurred_at: at, event_type: type, actor_party: party, actor_name: name, description: desc, source: src });
  T(r1.report_id, 'net.tech', '2026-10-12T06:40:00Z', 'Outage start', 'VENDOR', 'Provider core', 'VPN routes withdrawn on PE-RAM-02 after an unscheduled routing policy change.', 'Network monitoring');
  T(r1.report_id, 'net.tech', '2026-10-12T06:42:00Z', 'Detection', 'BANK', 'Bank NOC', 'Monitoring raised branch-down alarms for 37 sites.', 'Network monitoring');
  T(r1.report_id, 'net.tech', '2026-10-12T06:48:00Z', 'Reported to vendor', 'BANK', 'Hadi Barghouti', 'P1 raised with the vendor NOC by phone and ticket LCN-TT-2026-118.', 'ITSM INC0048211');
  T(r1.report_id, 'net.tech', '2026-10-12T07:09:00Z', 'Vendor acknowledged', 'VENDOR', 'Rami Khalil', 'Vendor NOC acknowledged and assigned an engineer.', 'Vendor ticket');
  T(r1.report_id, 'net.tech', '2026-10-12T08:10:00Z', 'Clock paused', 'BANK', 'Data centre security', 'Vendor engineer waiting for bank data-centre access approval.', 'Access log');
  T(r1.report_id, 'net.tech', '2026-10-12T08:35:00Z', 'Clock resumed', 'BANK', 'Data centre security', 'Access granted.', 'Access log');
  T(r1.report_id, 'net.tech', '2026-10-12T10:55:00Z', 'Workaround', 'VENDOR', 'Iyad Shaheen', 'Static routes applied via secondary PE; 30 branches recovered.', 'Vendor update');
  T(r1.report_id, 'net.tech', '2026-10-12T11:31:00Z', 'Service restored', 'VENDOR', 'Iyad Shaheen', 'Routing policy rolled back; all 37 branches online.', 'Network monitoring');
  incidents.saveChild(db, actor('net.tech'), r1.report_id, 'pause', { paused_at: '2026-10-12T08:10:00Z', resumed_at: '2026-10-12T08:35:00Z', reason: 'Vendor engineer waiting for bank data-centre access approval (bank dependency).' });
  const pause = db.get('SELECT pause_id FROM incident_clock_pause WHERE report_id = ?', [r1.report_id]);
  incidents.approvePause(db, actor('net.head'), r1.report_id, pause.pause_id, true);

  const e1 = ev(r1.report_id, 'nms_branch_availability_2026-10-12.csv', 'timestamp,site,status\n2026-10-12T06:40Z,BR-014,DOWN\n2026-10-12T11:31Z,BR-014,UP\n', 'net.tech', 'Monitoring export: branch reachability 06:00-12:00', 'Network monitoring platform');
  const e2 = ev(r1.report_id, 'LCN-RCA-2026-118.txt', 'Root cause analysis LCN-TT-2026-118\nUnapproved routing policy change on PE-RAM-02...\n', 'net.tech', 'Vendor root cause analysis', 'Vendor');
  const e3 = ev(r1.report_id, 'PE-RAM-02_change_log.txt', '2026-10-12 06:38 policy-statement NORTH-VRF modified by noc-eng-4\n2026-10-12 11:29 rollback\n', 'net.tech', 'Vendor router change log', 'Vendor');
  const ST = (rid, who, comp, ind, unit, b, d, a, bs, as, evid) => incidents.saveChild(db, actor(who), rid, 'state', { component: comp, indicator: ind, unit, before_value: b, during_value: d, after_value: a, before_status: bs, after_status: as, evidence_id: evid });
  ST(r1.report_id, 'net.tech', 'Branch MPLS', 'Branches reachable', 'of 76', '76', '39', '76', 'Normal', 'Normal', e1.evidence_id);
  ST(r1.report_id, 'net.tech', 'Branch MPLS', 'Average latency to DC', 'ms', '18', '—', '19', 'Normal', 'Normal', e1.evidence_id);
  ST(r1.report_id, 'net.tech', 'ATM network', 'ATMs authorising', 'of 142', '141', '120', '141', 'Normal', 'Normal', null);
  const VA = (rid, who, at, actorName, type, desc, outcome, evid) => incidents.saveChild(db, actor(who), rid, 'vendorAction', { action_at: at, vendor_actor: actorName, action_type: type, description: desc, outcome, evidence_id: evid });
  VA(r1.report_id, 'net.tech', '2026-10-12T07:09:00Z', 'Rami Khalil', 'Acknowledgement', 'Acknowledged P1 and assigned field engineer.', 'Engineer dispatched', null);
  VA(r1.report_id, 'net.tech', '2026-10-12T10:55:00Z', 'Iyad Shaheen', 'Workaround', 'Applied static routes through PE-NAB-01.', '30 of 37 branches recovered', e3.evidence_id);
  VA(r1.report_id, 'net.tech', '2026-10-12T11:29:00Z', 'Iyad Shaheen', 'Fix', 'Rolled back routing policy NORTH-VRF on PE-RAM-02.', 'All branches restored', e3.evidence_id);
  VA(r1.report_id, 'net.tech', '2026-10-16T13:00:00Z', 'Iyad Shaheen', 'RCA', 'Delivered written root cause analysis.', 'Accepted by the bank on 2026-10-18', e2.evidence_id);
  for (const a of db.all('SELECT action_id FROM vendor_action WHERE report_id = ? AND evidence_id IS NOT NULL', [r1.report_id])) incidents.verifyVendorAction(db, actor('net.head'), r1.report_id, a.action_id, true);
  const CA = (rid, who, desc, finding, type, sev, party, owner, due) => incidents.saveChild(db, actor(who), rid, 'corrective', { description: desc, source_finding: finding, action_type: type, severity: sev, owner_party: party, owner_name: owner, due_date: due });
  CA(r1.report_id, 'net.tech', 'Enforce four-eyes review and rollback plan for all provider-core changes affecting bank VRFs.', 'Unapproved change outside maintenance window', 'CORRECTIVE', 'CRITICAL', 'VENDOR', 'Iyad Shaheen', '2026-11-10');
  CA(r1.report_id, 'net.tech', 'Stop alarm suppression during changes; route-withdrawal alarms must page the NOC duty manager.', 'Alarm suppressed', 'PREVENTIVE', 'HIGH', 'VENDOR', 'Rami Khalil', '2026-11-30');
  CA(r1.report_id, 'net.tech', 'Pre-authorise vendor data-centre access for P1 incidents to remove the access delay.', 'Bank dependency paused clock 25 min', 'PREVENTIVE', 'MEDIUM', 'BANK', 'Sami Odeh', '2026-12-15');

  approvals.submit(db, actor('net.tech'), r1.report_id);
  const signNext = (rid, who, decision = 'APPROVED', reason) => {
    const step = db.get("SELECT step_id FROM approval_step WHERE report_id = ? AND status = 'PENDING'", [rid]);
    return approvals.sign(db, actor(who), { reportId: rid, stepId: step.step_id, decision, reason, password: DEMO_PASSWORD });
  };
  signNext(r1.report_id, 'net.head', 'APPROVED', 'Timeline and evidence validated against NMS and access logs.');
  signNext(r1.report_id, 'vm.head', 'APPROVED', 'Two critical breaches confirmed. Service credits of 30% availability cap and 2% restoration to be claimed per Sch. B 8.2.');
  const final = signNext(r1.report_id, 'cio', 'APPROVED', 'Approved. Vendor to present corrective plan at the next QBR.');
  if (final.outcome === 'FULLY_APPROVED' && ctx.renderPdf) {
    try { await documents.finalizeIncident(db, ctx, actor('cio'), r1.report_id); } catch (e) { log(`  could not seal demo PDF: ${e.message}`); }
  }
  for (const cid of db.all('SELECT action_issue_id FROM action_issue WHERE report_id = ? ORDER BY action_issue_id LIMIT 1', [r1.report_id])) {
    incidents.saveChild(db, actor('vm.manager'), r1.report_id, 'corrective', { action_issue_id: cid.action_issue_id, status: 'IN_PROGRESS' });
  }

  // 2) P2 core banking, in approval (step 1 signed, waiting for Vendor Management)
  const r2 = incidents.create(db, actor('app.owner'), { vendor_id: vCbs, service_id: sCbs, title: 'End-of-day batch overran — branches opened late', priority: 'P2', detected_at: '2026-11-04T03:15:00Z' });
  incidents.update(db, actor('app.owner'), r2.report_id, {
    impact_summary: 'End-of-day batch job GL-POST-07 failed and had to be rerun; online services opened 95 minutes late.',
    business_impact: 'Branches and digital channels in read-only mode until 09:35 local time.', customers_affected: 12000, channels_affected: 'Branches, internet banking, mobile banking',
    outage_type: 'PARTIAL', reported_at: '2026-11-04T03:22:00Z', acknowledged_at: '2026-11-04T03:41:00Z', restored_at: '2026-11-04T07:35:00Z', resolved_at: '2026-11-05T12:00:00Z',
    outage_start: '2026-11-04T06:00:00Z', outage_end: '2026-11-04T07:35:00Z', itsm_ref: 'INC0049902', vendor_ticket_ref: 'QCS-55190',
    root_cause_category: 'Software defect', root_cause: 'A regression in release 14.2.3 caused GL-POST-07 to fail on accounts with more than 999 sub-ledgers.', contributing_factors: 'Regression test pack did not include high-volume sub-ledger accounts.',
    rca_received_at: '2026-11-08T09:00:00Z', rca_accepted: 1,
  });
  T(r2.report_id, 'app.owner', '2026-11-04T03:15:00Z', 'Detection', 'BANK', 'Batch operator', 'GL-POST-07 failed with error ORA-01438.', 'Batch scheduler');
  T(r2.report_id, 'app.owner', '2026-11-04T03:22:00Z', 'Reported to vendor', 'BANK', 'Batch operator', 'Severity 2 logged with vendor hotline.', 'ITSM INC0049902');
  T(r2.report_id, 'app.owner', '2026-11-04T03:41:00Z', 'Vendor acknowledged', 'VENDOR', 'Support Desk', 'Engineer assigned.', 'Vendor ticket');
  T(r2.report_id, 'app.owner', '2026-11-04T07:35:00Z', 'Service restored', 'VENDOR', 'Samer Jaber', 'Hotfix applied, batch rerun completed.', 'Batch scheduler');
  const e21 = ev(r2.report_id, 'batch_log_GL-POST-07.txt', 'GL-POST-07 03:14:58 ERROR ORA-01438\nGL-POST-07 rerun 07:31 OK\n', 'app.owner', 'Batch scheduler log', 'Batch scheduler');
  ST(r2.report_id, 'app.owner', 'Core banking', 'EOD batch completion time', 'local', '05:40', 'Failed', '06:20 (next day)', 'On time', 'On time', e21.evidence_id);
  ST(r2.report_id, 'app.owner', 'Online channels', 'Opening time', 'local', '08:00', '09:35', '08:00', 'Normal', 'Normal', null);
  VA(r2.report_id, 'app.owner', '2026-11-04T05:50:00Z', 'Samer Jaber', 'Diagnosis', 'Identified regression in 14.2.3 sub-ledger handling.', 'Hotfix prepared', e21.evidence_id);
  VA(r2.report_id, 'app.owner', '2026-11-04T07:10:00Z', 'Samer Jaber', 'Fix', 'Applied hotfix 14.2.3-HF1 and reran batch.', 'Batch completed', e21.evidence_id);
  CA(r2.report_id, 'app.owner', 'Add high-volume sub-ledger accounts to the regression pack.', 'Regression not detected', 'PREVENTIVE', 'HIGH', 'VENDOR', 'Samer Jaber', '2026-12-31');
  approvals.submit(db, actor('app.owner'), r2.report_id);
  signNext(r2.report_id, 'app.head', 'APPROVED', 'Batch logs reviewed; facts confirmed.');

  // 3) P3 data-centre cooling alarm, draft
  const r3 = incidents.create(db, actor('infra.head'), { vendor_id: vDc, service_id: sDc, title: 'Cooling alarm in Hall B — CRAC unit 3', priority: 'P3', detected_at: '2026-11-12T13:05:00Z' });
  incidents.update(db, actor('infra.head'), r3.report_id, { impact_summary: 'CRAC-3 tripped; inlet temperature rose to 27 °C on two racks. No service impact.', outage_type: 'NONE', reported_at: '2026-11-12T13:10:00Z', acknowledged_at: '2026-11-12T13:18:00Z', itsm_ref: 'INC0050333' });
  T(r3.report_id, 'infra.head', '2026-11-12T13:05:00Z', 'Detection', 'BANK', 'BMS', 'High inlet temperature alarm on racks B-07 and B-08.', 'BMS');

  // 4) P2 ATM fault, returned for changes by Vendor Management
  const r4 = incidents.create(db, actor('vm.manager'), { vendor_id: vAtm, service_id: sAtm, title: 'Card reader failures on 6 ATMs — Ramallah', priority: 'P2', detected_at: '2026-11-02T07:30:00Z' });
  incidents.update(db, actor('vm.manager'), r4.report_id, {
    impact_summary: 'Six ATMs rejected chip cards after a firmware push.', outage_type: 'PARTIAL', reported_at: '2026-11-02T07:40:00Z', acknowledged_at: '2026-11-02T10:05:00Z', restored_at: '2026-11-03T12:30:00Z',
    outage_start: '2026-11-02T07:20:00Z', outage_end: '2026-11-03T12:30:00Z', root_cause: 'Card reader firmware 7.4 incompatible with the installed EMV kernel.', root_cause_category: 'Vendor change',
  });
  T(r4.report_id, 'vm.manager', '2026-11-02T07:30:00Z', 'Detection', 'BANK', 'ATM monitoring', 'Six ATMs reporting card reader faults.', 'ATM monitoring');
  ST(r4.report_id, 'vm.manager', 'ATM fleet', 'ATMs in service', 'of 142', '141', '135', '141', 'Normal', 'Normal', null);
  VA(r4.report_id, 'vm.manager', '2026-11-03T12:30:00Z', 'Ahmad Tamimi', 'Fix', 'Rolled back card reader firmware to 7.3.', 'Devices back in service', null);
  CA(r4.report_id, 'vm.manager', 'Firmware changes must be piloted on two ATMs before fleet rollout.', 'Untested firmware push', 'PREVENTIVE', 'HIGH', 'VENDOR', 'Ahmad Tamimi', '2026-12-20');
  approvals.submit(db, actor('vm.manager'), r4.report_id);
  signNext(r4.report_id, 'infra.head', 'APPROVED', 'Monitoring data confirms six devices affected.');
  signNext(r4.report_id, 'vm.head', 'REJECTED', 'Attach the vendor field-service report as evidence for the fix, and confirm whether on-site arrival was within 2 business hours.');

  log('Demonstration data ready.');
  return { users: Object.keys(u), password: DEMO_PASSWORD };
}

module.exports = { seedDemo, DEMO_PASSWORD };
