@echo off
REM ==========================================================================
REM  BOP VMS-SLA Personal Edition - load SAMPLE (test) data
REM
REM  Adds example records so you can try the system:
REM    - 10 IT sections (typical bank IT structure)
REM    - 10 example vendors with escalation contacts and risk assessments
REM    - 11 services, 10 contracts, about 100 clauses, 42 SLA definitions
REM    - support hours, responsibilities, obligations
REM    - 5 draft incident reports with SLA results and corrective actions
REM  Vendors, people, contracts and incidents are FICTIONAL examples.
REM
REM  How to use: close the app, then double-click this file.
REM  Your current data is copied to a backup folder first.
REM  It uses the installed app itself, so Node.js is NOT needed.
REM  Optional: set VMS_APP_DIR to the install folder if it is not found.
REM ==========================================================================
setlocal EnableExtensions
title BOP VMS-SLA Personal - load sample data
set "APPNAME=BOP VMS-SLA Personal"
set "AUTO="
if /i "%~1"=="/y" set "AUTO=1"

REM ---- find the installed app
set "INSTALL="
if defined VMS_APP_DIR if exist "%VMS_APP_DIR%\%APPNAME%.exe" set "INSTALL=%VMS_APP_DIR%"
if not defined INSTALL if exist "%LOCALAPPDATA%\Programs\%APPNAME%\%APPNAME%.exe" set "INSTALL=%LOCALAPPDATA%\Programs\%APPNAME%"
if not defined INSTALL if exist "%ProgramFiles%\%APPNAME%\%APPNAME%.exe" set "INSTALL=%ProgramFiles%\%APPNAME%"
if not defined INSTALL (
  echo Could not find "%APPNAME%". Install it first with BOP-VMS-SLA-Personal-Setup.exe,
  echo or set VMS_APP_DIR to the folder that contains "%APPNAME%.exe".
  goto :stop
)
if not exist "%INSTALL%\resources\app.asar" (
  echo The installation in "%INSTALL%" looks incomplete. Reinstall the app and try again.
  goto :stop
)
echo App found: %INSTALL%

REM ---- the app must be closed (it keeps the database open in memory)
tasklist /FI "IMAGENAME eq %APPNAME%.exe" 2>nul | find /i "%APPNAME%.exe" >nul
if not errorlevel 1 (
  echo.
  echo "%APPNAME%" is running. Close it, then run this file again.
  goto :stop
)

set "DATA=%APPDATA%\%APPNAME%\data"
echo Data folder: %DATA%
echo.
echo This adds FICTIONAL sample vendors, contracts, SLAs and incident reports.
if not defined AUTO (
  set "ANS="
  set /p "ANS=Type Y and press Enter to continue: "
)
if not defined AUTO if /i not "%ANS%"=="Y" (
  echo Cancelled. Nothing was changed.
  goto :stop
)

REM ---- back up existing data
if exist "%DATA%\vms-sla.sqlite" (
  set "BACKUP=%DATA%-backup-%RANDOM%%RANDOM%"
  call :backup
  if errorlevel 1 goto :stop
)
if not exist "%DATA%" mkdir "%DATA%"

REM ---- run the data section of this file (everything after the marker line)
REM      with the app's own engine; no Node.js installation is needed
set "LOG=%TEMP%\bop-vms-sample-data-%RANDOM%.log"
echo Loading sample data, please wait...
set "ELECTRON_RUN_AS_NODE=1"
"%INSTALL%\%APPNAME%.exe" -e "const f=process.argv[1],s=require('fs').readFileSync(f,'utf8'),m='//__SAMPLE_DATA_'+'JS__',i=s.indexOf(m);if(i<0){console.error('This file is damaged: the data section is missing.');process.exit(4)}const M=require('module'),x=new M(f);x.filename=f;x.paths=[];x._compile(s.slice(i+m.length),f)" "%~f0" "%INSTALL%\resources\app.asar" "%DATA%" > "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
set "ELECTRON_RUN_AS_NODE="
echo.
type "%LOG%"
del "%LOG%" >nul 2>nul
echo.
if "%RC%"=="0" (
  echo Done. Open "%APPNAME%" to see the sample data.
) else if "%RC%"=="3" (
  echo Nothing was changed.
) else (
  echo Loading failed ^(code %RC%^). Your previous data is in the backup folder shown above.
)
goto :stop

:backup
echo Backing up current data to: %BACKUP%
xcopy "%DATA%" "%BACKUP%\" /E /I /Q /Y /H >nul
if errorlevel 1 (
  echo The backup failed. Nothing was changed.
  exit /b 1
)
exit /b 0

:stop
echo.
if not defined AUTO pause
endlocal
exit /b
//__SAMPLE_DATA_JS__
// BOP VMS-SLA Personal Edition - sample data loader (TEST DATA ONLY).
// Run by load-mock-data.bat through the installed app (ELECTRON_RUN_AS_NODE).
// Section names follow a typical bank IT structure. Vendor names, people,
// contracts and incidents are fictional examples, not real records.
'use strict';
const path = require('path');
const fs = require('fs');
const [asarDir, dataDir] = process.argv.slice(2);
if (!asarDir || !dataDir) { console.error('Usage: mock.js <app.asar folder> <data folder>'); process.exit(2); }
const { createContext } = require(path.join(asarDir, 'main', 'context.js'));
const { createApi } = require(path.join(asarDir, 'main', 'api.js'));

const DAY = 86400000;
const now = Date.now();
const iso = (daysAgo, hh = 8, mm = 0) => { const d = new Date(now - daysAgo * DAY); d.setUTCHours(hh, mm, 0, 0); return d.toISOString(); };
const plus = (isoStr, minutes) => new Date(Date.parse(isoStr) + minutes * 60000).toISOString();
const day = (offsetDays) => new Date(now + offsetDays * DAY).toISOString().slice(0, 10);
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

// ------------------------------------------------------------------ IT sections
const SECTIONS = [
  ['INFRA', 'Infrastructure & Data Centre', 'Information Technology'],
  ['NET', 'Network & Telecommunications', 'Information Technology'],
  ['CORE', 'Core Banking Systems', 'Information Technology'],
  ['DIGITAL', 'Digital Channels', 'Information Technology'],
  ['CARDS', 'Cards & Payments Systems', 'Information Technology'],
  ['ATM', 'ATM & Branch Technology', 'Information Technology'],
  ['DESK', 'IT Service Desk & End-User Computing', 'Information Technology'],
  ['DB', 'Database & Middleware', 'Information Technology'],
  ['ERP', 'Enterprise Applications', 'Information Technology'],
  ['SEC', 'Information Security', 'Information Security & Cyber Risk'],
];

// ------------------------------------------------------------------ vendors, contracts, services, SLAs
// SLA rows: [name, metric, priority, target, unit, {critical, bh, warning}]
const VENDORS = [
  {
    key: 'telecom',
    v: { legal_name: 'Al-Bireh Telecom Networks Co.', legal_name_ar: '\u0634\u0631\u0643\u0629 \u0627\u0644\u0628\u064a\u0631\u0629 \u0644\u0634\u0628\u0643\u0627\u062a \u0627\u0644\u0627\u062a\u0635\u0627\u0644\u0627\u062a', country: 'Palestine', risk_tier: 'CRITICAL', website: 'https://example.ps/abtn', notes: 'Primary MPLS carrier for head office, data centres and branches. Sole provider for 46 branches.' },
    contacts: [['NOC Duty Manager', 'Network Operations Centre', 1], ['Khalil Odeh', 'Service Delivery Manager', 2], ['Rania Barghouti', 'Key Account Director', 3], ['Samir Hasan', 'Chief Technology Officer', 4]],
    contract: { title: 'Managed WAN, MPLS and Internet Services Agreement', ref: 'ABTN/BOP/MSA/2024-031', start: -700, end: 395, notice: 180, value: 1480000, currency: 'USD', versions: 2 },
    risk: [['CONCENTRATION', 'HIGH', 'Single carrier for 46 of 78 branches.', 'Tender a second carrier for diverse last-mile links by Q3.'], ['BCP', 'MEDIUM', 'Failover to 4G backup tested on 60% of branches.', 'Complete 4G backup testing for all branches.']],
    services: [
      { section: 'NET', name: 'Branch WAN & MPLS Connectivity', tower: 'Network & Telecom', criticality: 'CRITICAL', cls: 'CONFIDENTIAL', desc: 'MPLS links between head office, primary and DR data centres and all branches.', scope: 'MPLS circuits for 78 branches, two data-centre hubs, managed CPE routers, 4G backup links and 24x7 NOC monitoring.',
        support: [['Network operations and fault management', 'All incidents', 'Mon-Sun incl. holidays', '00:00', '23:59', 'NOC hotline, service portal'], ['Moves, adds and changes', 'Service requests', 'Sat-Thu', '08:00', '16:00', 'Service portal, email']],
        slas: [['Core MPLS network availability', 'AVAILABILITY', '', 99.9, 'percent', { critical: 1, warning: 99.95 }], ['P1 incident response', 'INCIDENT_RESPONSE', 'P1', 15, 'minutes'], ['P1 service restoration', 'INCIDENT_RESTORATION', 'P1', 4, 'hours', { critical: 1, warning: 3.5 }], ['P2 incident response', 'INCIDENT_RESPONSE', 'P2', 30, 'minutes'], ['P2 service restoration', 'INCIDENT_RESTORATION', 'P2', 8, 'hours'], ['P3 incident resolution', 'INCIDENT_RESOLUTION', 'P3', 2, 'days', { bh: 1 }], ['P1 root cause analysis', 'RCA_DELIVERY', 'P1', 5, 'days', { bh: 1 }]],
        raci: [['Incident detection and logging', 'IT Service Desk', 'R', 'Supplier NOC', 'R'], ['Circuit and CPE fault repair', 'Network & Telecommunications', 'C', 'Field engineering', 'A/R'], ['Branch site access and power', 'Branch operations', 'A/R', 'Field engineering', 'C'], ['Monthly SLA reporting', 'Vendor Management', 'A', 'Service Delivery Manager', 'R', 'noclause']] },
      { section: 'NET', name: 'Internet Access & DDoS Protection', tower: 'Network & Telecom', criticality: 'HIGH', cls: 'INTERNAL', desc: 'Dual internet links for digital channels with volumetric DDoS scrubbing.', scope: 'Two 1 Gbps internet links, BGP, and always-on DDoS scrubbing for the digital banking ranges.',
        support: [['Security operations', 'DDoS attacks', 'Mon-Sun', '00:00', '23:59', 'SOC hotline']],
        slas: [['Internet service availability', 'AVAILABILITY', '', 99.95, 'percent', { critical: 1 }], ['DDoS mitigation response', 'INCIDENT_RESPONSE', 'P1', 10, 'minutes', { critical: 1 }]],
        raci: [['DDoS attack mitigation', 'Information Security', 'C', 'Scrubbing centre', 'A/R']] },
    ],
  },
  {
    key: 'core',
    v: { legal_name: 'Levant Core Banking Solutions Ltd.', legal_name_ar: '\u062d\u0644\u0648\u0644 \u0627\u0644\u0645\u0634\u0631\u0642 \u0644\u0644\u0623\u0646\u0638\u0645\u0629 \u0627\u0644\u0645\u0635\u0631\u0641\u064a\u0629', country: 'Jordan', risk_tier: 'CRITICAL', website: 'https://example.jo/lcbs', notes: 'Core banking application support, regulatory releases and end-of-day batch support.' },
    contacts: [['Support Desk', '24x7 Application Support', 1], ['Hani Masri', 'Support Manager', 2], ['Lubna Saadeh', 'Client Partner', 3], ['Ayman Khoury', 'Regional Managing Director', 4]],
    contract: { title: 'Core Banking Support and Maintenance Agreement', ref: 'LCBS-SMA-PS-0117', start: -1060, end: 75, notice: 120, value: 2250000, currency: 'USD', versions: 2 },
    risk: [['OPERATIONAL', 'HIGH', 'End-of-day batch depends on one vendor engineer for two modules.', 'Request a named backup engineer and runbook handover.'], ['CONCENTRATION', 'CRITICAL', 'Core banking cannot be replaced within 24 months.', 'Maintain escrow and exit plan; review at renewal.']],
    services: [
      { section: 'CORE', name: 'Core Banking Application Support', tower: 'Core Banking / Applications', criticality: 'CRITICAL', cls: 'RESTRICTED', desc: 'Level 2/3 support of the core banking system, end-of-day batch and regulatory releases.', scope: 'Production, DR and UAT environments; defect fixes, regulatory patches and batch support.',
        support: [['Critical support', 'Severity 1-2', 'Mon-Sun', '00:00', '23:59', 'Hotline, ITSM'], ['Standard support', 'Severity 3-4', 'Sun-Thu', '08:00', '17:00', 'ITSM, email']],
        slas: [['Core banking production availability', 'AVAILABILITY', '', 99.95, 'percent', { critical: 1 }], ['Severity 1 response', 'INCIDENT_RESPONSE', 'P1', 15, 'minutes'], ['Severity 1 restoration', 'INCIDENT_RESTORATION', 'P1', 2, 'hours', { critical: 1 }], ['Severity 2 response', 'INCIDENT_RESPONSE', 'P2', 30, 'minutes'], ['Severity 2 restoration', 'INCIDENT_RESTORATION', 'P2', 4, 'hours'], ['Severity 3 response', 'INCIDENT_RESPONSE', 'P3', 4, 'hours', { bh: 1 }], ['Severity 1-2 RCA delivery', 'RCA_DELIVERY', '', 5, 'days', { bh: 1 }]],
        raci: [['Application incident resolution', 'Core Banking Systems', 'A', 'Supplier support', 'R'], ['End-of-day batch execution', 'Core Banking Systems', 'A/R', 'Supplier support', 'C'], ['Regulatory release testing', 'Core Banking Systems', 'A', 'Supplier QA', 'R']] },
    ],
  },
  {
    key: 'digital',
    v: { legal_name: 'Nablus Digital Labs', legal_name_ar: '\u0645\u062e\u062a\u0628\u0631\u0627\u062a \u0646\u0627\u0628\u0644\u0633 \u0627\u0644\u0631\u0642\u0645\u064a\u0629', country: 'Palestine', risk_tier: 'HIGH', website: 'https://example.ps/ndl', notes: 'Develops and supports the mobile banking and internet banking platforms.' },
    contacts: [['Digital Support Desk', 'Application Support', 1], ['Yara Shtayyeh', 'Delivery Manager', 2], ['Omar Tamimi', 'Account Manager', 3]],
    contract: { title: 'Mobile and Internet Banking Development and Support Agreement', ref: 'NDL-2025-BOP-02', start: -420, end: 680, notice: 90, value: 860000, currency: 'USD', versions: 1 },
    risk: [['CYBER', 'HIGH', 'Annual penetration test found two medium findings in the mobile API.', 'Vendor to remediate before the next release; retest.']],
    services: [
      { section: 'DIGITAL', name: 'Mobile & Internet Banking Platform', tower: 'Software / Managed Services', criticality: 'CRITICAL', cls: 'RESTRICTED', desc: 'Customer mobile app (iOS/Android), internet banking portal and their API layer.', scope: 'Application support, monthly releases, security patches and app-store publishing.',
        support: [['Production support', 'P1, P2', 'Mon-Sun', '00:00', '23:59', 'Hotline, ITSM'], ['Release and change support', 'P3, P4, changes', 'Sun-Thu', '08:00', '17:00', 'ITSM']],
        slas: [['Digital channels availability', 'AVAILABILITY', '', 99.9, 'percent', { critical: 1 }], ['P1 incident response', 'INCIDENT_RESPONSE', 'P1', 15, 'minutes'], ['P1 service restoration', 'INCIDENT_RESTORATION', 'P1', 3, 'hours', { critical: 1 }], ['P2 service restoration', 'INCIDENT_RESTORATION', 'P2', 8, 'hours'], ['Critical vulnerability fix', 'OTHER', '', 7, 'days']],
        raci: [['Release testing and approval', 'Digital Channels', 'A', 'Delivery team', 'R'], ['App-store publishing', 'Digital Channels', 'A', 'Delivery team', 'R']] },
    ],
  },
  {
    key: 'cards',
    v: { legal_name: 'Crescent Payment Services', legal_name_ar: '\u0627\u0644\u0647\u0644\u0627\u0644 \u0644\u062e\u062f\u0645\u0627\u062a \u0627\u0644\u062f\u0641\u0639', country: 'Jordan', risk_tier: 'CRITICAL', website: 'https://example.jo/cps', notes: 'Card processing, authorisation switch and card management system (hosted).' },
    contacts: [['Switch Operations', '24x7 Operations', 1], ['Nadia Haddad', 'Operations Manager', 2], ['Faris Qudah', 'Relationship Director', 3], ['Tareq Nasser', 'Chief Operating Officer', 4]],
    contract: { title: 'Card Processing and Switching Services Agreement', ref: 'CPS-PS-BOP-2023-09', start: -900, end: 560, notice: 180, value: 1320000, currency: 'USD', versions: 2 },
    risk: [['PRIVACY', 'HIGH', 'Cardholder data processed outside Palestine.', 'Confirm PCI DSS certificate and data-transfer approvals annually.']],
    services: [
      { section: 'CARDS', name: 'Card Processing & Authorisation Switch', tower: 'Software / Managed Services', criticality: 'CRITICAL', cls: 'RESTRICTED', desc: 'Authorisation of debit, prepaid and credit card transactions for ATMs, POS and e-commerce.', scope: 'Hosted authorisation switch, card management, clearing files and fraud monitoring feeds.',
        support: [['Switch operations', 'All incidents', 'Mon-Sun', '00:00', '23:59', 'Hotline']],
        slas: [['Authorisation switch availability', 'AVAILABILITY', '', 99.95, 'percent', { critical: 1 }], ['P1 incident response', 'INCIDENT_RESPONSE', 'P1', 10, 'minutes'], ['P1 service restoration', 'INCIDENT_RESTORATION', 'P1', 1, 'hours', { critical: 1 }], ['P2 service restoration', 'INCIDENT_RESTORATION', 'P2', 4, 'hours'], ['P1 root cause analysis', 'RCA_DELIVERY', 'P1', 3, 'days', { bh: 1 }]],
        raci: [['Card authorisation', 'Cards & Payments Systems', 'C', 'Switch operations', 'A/R'], ['Daily clearing reconciliation', 'Cards & Payments Systems', 'A/R', 'Switch operations', 'C']] },
    ],
  },
  {
    key: 'soc',
    v: { legal_name: 'Sentinel Cyber Defense FZ-LLC', legal_name_ar: '\u0633\u0646\u062a\u064a\u0646\u0644 \u0644\u0644\u062f\u0641\u0627\u0639 \u0627\u0644\u0633\u064a\u0628\u0631\u0627\u0646\u064a', country: 'United Arab Emirates', risk_tier: 'HIGH', website: 'https://example.ae/scd', notes: 'Managed SOC: 24x7 monitoring of SIEM alerts, threat hunting and incident notification.' },
    contacts: [['SOC Analyst on duty', 'Security Operations Centre', 1], ['Rami Aziz', 'SOC Manager', 2], ['Dina Farah', 'Customer Success Lead', 3]],
    contract: { title: 'Managed Security Operations Centre Services', ref: 'SCD-MSSP-0442', start: -300, end: 430, notice: 90, value: 410000, currency: 'USD', versions: 1 },
    risk: [['CYBER', 'MEDIUM', 'SOC has privileged read access to SIEM.', 'Quarterly access review by Information Security.']],
    services: [
      { section: 'SEC', name: 'Managed Security Monitoring (SOC)', tower: 'Cybersecurity', criticality: 'HIGH', cls: 'CONFIDENTIAL', desc: '24x7 monitoring of SIEM alerts with triage and notification to the bank.', scope: 'SIEM use-case monitoring, triage, threat hunting and monthly reporting.',
        support: [['Security monitoring', 'All alerts', 'Mon-Sun', '00:00', '23:59', 'SOC hotline, email']],
        slas: [['Critical alert notification', 'INCIDENT_RESPONSE', 'P1', 15, 'minutes', { critical: 1 }], ['High alert notification', 'INCIDENT_RESPONSE', 'P2', 30, 'minutes'], ['Medium alert notification', 'INCIDENT_RESPONSE', 'P3', 4, 'hours']],
        raci: [['Alert triage', 'Information Security', 'I', 'SOC analysts', 'A/R'], ['Containment decisions', 'Information Security', 'A/R', 'SOC analysts', 'C']] },
    ],
  },
  {
    key: 'atm',
    v: { legal_name: 'Self-Service Technologies Middle East', legal_name_ar: '\u062a\u0642\u0646\u064a\u0627\u062a \u0627\u0644\u062e\u062f\u0645\u0629 \u0627\u0644\u0630\u0627\u062a\u064a\u0629 - \u0627\u0644\u0634\u0631\u0642 \u0627\u0644\u0623\u0648\u0633\u0637', country: 'Jordan', risk_tier: 'HIGH', website: 'https://example.jo/sstme', notes: 'First- and second-line maintenance of the ATM and deposit-machine fleet.' },
    contacts: [['Field Service Dispatch', 'Dispatch Desk', 1], ['Mahmoud Jaber', 'Country Service Manager', 2], ['Suha Khalaf', 'Regional Director', 3]],
    contract: { title: 'ATM and Self-Service Devices Maintenance Contract', ref: 'SSTME-MNT-PS-21', start: -1420, end: 40, notice: 90, value: 690000, currency: 'USD', versions: 2 },
    risk: [['OPERATIONAL', 'MEDIUM', 'Spare-parts stock in Ramallah covers only common faults.', 'Agree a minimum spare-parts list at renewal.']],
    services: [
      { section: 'ATM', name: 'ATM & Deposit Machine Maintenance', tower: 'ATM / Branch Technology', criticality: 'HIGH', cls: 'INTERNAL', desc: 'Corrective and preventive maintenance for 150 ATMs and 40 deposit machines.', scope: 'On-site repair, preventive maintenance every quarter, spare parts and firmware updates.',
        support: [['Field service', 'All device faults', 'Sat-Thu', '08:00', '18:00', 'Dispatch desk, ITSM']],
        slas: [['ATM fleet uptime', 'AVAILABILITY', '', 98.5, 'percent'], ['P2 on-site arrival', 'INCIDENT_RESPONSE', 'P2', 3, 'hours', { bh: 1 }], ['P2 device restoration', 'INCIDENT_RESTORATION', 'P2', 8, 'hours', { bh: 1 }], ['P3 device repair', 'INCIDENT_RESOLUTION', 'P3', 2, 'days', { bh: 1 }]],
        raci: [['Cash replenishment', 'Branch operations', 'A/R', 'Field service', 'I'], ['Device repair', 'ATM & Branch Technology', 'C', 'Field service', 'A/R']] },
    ],
  },
  {
    key: 'dc',
    v: { legal_name: 'Jericho Data Centre Services', legal_name_ar: '\u0623\u0631\u064a\u062d\u0627 \u0644\u062e\u062f\u0645\u0627\u062a \u0645\u0631\u0627\u0643\u0632 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a', country: 'Palestine', risk_tier: 'CRITICAL', website: 'https://example.ps/jdcs', notes: 'Colocation for the disaster-recovery site.' },
    contacts: [['Site Operations', 'Operations Centre', 1], ['Ibrahim Salem', 'Site Manager', 2], ['Mai Atallah', 'Commercial Director', 3]],
    contract: { title: 'Disaster Recovery Site Colocation Agreement', ref: 'JDCS-COLO-07', start: -260, end: 835, notice: 180, value: 540000, currency: 'USD', versions: 1 },
    risk: [['BCP', 'HIGH', 'Last full DR failover test was 14 months ago.', 'Schedule a full DR test this half-year.']],
    services: [
      { section: 'INFRA', name: 'DR Data Centre Colocation', tower: 'Infrastructure & Data Centre', criticality: 'CRITICAL', cls: 'RESTRICTED', desc: 'Racks, power, cooling and physical security for the DR site.', scope: 'Six racks with A/B power, N+1 cooling, physical security and remote hands.',
        support: [['Site operations and remote hands', 'All', 'Mon-Sun', '00:00', '23:59', 'Operations centre phone, ticket']],
        slas: [['Rack power and cooling availability', 'AVAILABILITY', '', 99.98, 'percent', { critical: 1 }], ['Critical facility response', 'INCIDENT_RESPONSE', 'P1', 15, 'minutes'], ['Critical facility restoration', 'INCIDENT_RESTORATION', 'P1', 1, 'hours', { critical: 1 }]],
        raci: [['Power and cooling', 'Infrastructure & Data Centre', 'I', 'Site operations', 'A/R'], ['Physical access approval', 'Infrastructure & Data Centre', 'A/R', 'Site security', 'R']] },
    ],
  },
  {
    key: 'power',
    v: { legal_name: 'Ramallah Power & Cooling Co.', legal_name_ar: '\u0634\u0631\u0643\u0629 \u0631\u0627\u0645 \u0627\u0644\u0644\u0647 \u0644\u0644\u0637\u0627\u0642\u0629 \u0648\u0627\u0644\u062a\u0628\u0631\u064a\u062f', country: 'Palestine', risk_tier: 'HIGH', notes: 'Maintenance of UPS units, generators and precision cooling at the primary data centre.' },
    contacts: [['Emergency line', 'Maintenance dispatch', 1], ['Nabil Ghanem', 'Maintenance Manager', 2]],
    contract: { title: 'UPS, Generator and Precision Cooling Maintenance', ref: 'RPC-AMC-2025-11', start: -330, end: 400, notice: 60, value: 96000, currency: 'USD', versions: 1 },
    risk: [],
    services: [
      { section: 'INFRA', name: 'UPS & Precision Cooling Maintenance', tower: 'Infrastructure & Data Centre', criticality: 'HIGH', cls: 'INTERNAL', desc: 'Preventive and corrective maintenance of UPS, generators and CRAC units.', scope: 'Two 200 kVA UPS, one 500 kVA generator and four CRAC units at the primary data centre.',
        support: [['Emergency maintenance', 'Critical faults', 'Mon-Sun', '00:00', '23:59', 'Emergency line']],
        slas: [['Emergency on-site arrival', 'INCIDENT_RESPONSE', 'P1', 2, 'hours', { critical: 1 }], ['Critical fault restoration', 'INCIDENT_RESTORATION', 'P1', 6, 'hours']],
        raci: [['Quarterly preventive maintenance', 'Infrastructure & Data Centre', 'A', 'Maintenance team', 'R']] },
    ],
  },
  {
    key: 'devices',
    v: { legal_name: 'Hebron Office Systems', legal_name_ar: '\u0627\u0644\u062e\u0644\u064a\u0644 \u0644\u0623\u0646\u0638\u0645\u0629 \u0627\u0644\u0645\u0643\u0627\u062a\u0628', country: 'Palestine', risk_tier: 'MEDIUM', notes: 'Supply and maintenance of desktops, laptops and printers for head office and branches.' },
    contacts: [['Helpdesk', 'Service desk', 1], ['Ahmad Natsheh', 'Service Manager', 2]],
    contract: { title: 'End-User Devices and Printing Services', ref: 'HOS-EUC-2025', start: -200, end: 530, notice: 60, value: 210000, currency: 'USD', versions: 1 },
    risk: [],
    services: [
      { section: 'DESK', name: 'End-User Devices & Printing', tower: 'Service Desk / End User', criticality: 'MEDIUM', cls: 'INTERNAL', desc: 'Desktops, laptops and printers at head office and branches.', scope: 'Device repair or swap, printer maintenance and consumables for 1,600 devices.',
        support: [['Business-hours support', 'All requests', 'Sat-Thu', '08:00', '16:00', 'Phone, ITSM']],
        slas: [['P3 device repair or swap', 'INCIDENT_RESOLUTION', 'P3', 1, 'days', { bh: 1 }], ['P4 request fulfilment', 'INCIDENT_RESOLUTION', 'P4', 3, 'days', { bh: 1 }]],
        raci: [['Device swap', 'IT Service Desk & End-User Computing', 'C', 'Field technician', 'A/R']] },
    ],
  },
  {
    key: 'cloud',
    v: { legal_name: 'Mediterranean Cloud & Licensing', legal_name_ar: '\u0627\u0644\u0645\u062a\u0648\u0633\u0637 \u0644\u0644\u062d\u0648\u0633\u0628\u0629 \u0627\u0644\u0633\u062d\u0627\u0628\u064a\u0629 \u0648\u0627\u0644\u062a\u0631\u0627\u062e\u064a\u0635', country: 'Palestine', risk_tier: 'MEDIUM', notes: 'Licensing partner and support for Microsoft 365 and the email platform.' },
    contacts: [['Partner support', 'Support desk', 1], ['Lina Awwad', 'Account Manager', 2]],
    contract: { title: 'Microsoft 365 Licensing and Support', ref: 'MCL-M365-BOP-26', start: -120, end: 245, notice: 30, value: 180000, currency: 'USD', versions: 1 },
    risk: [['PRIVACY', 'MEDIUM', 'Email data hosted in a cloud region outside Palestine.', 'Confirm data residency settings and DLP policies.']],
    services: [
      { section: 'ERP', name: 'Microsoft 365 & Email Platform', tower: 'Software / Managed Services', criticality: 'HIGH', cls: 'CONFIDENTIAL', desc: 'Email, Teams and SharePoint for all staff.', scope: 'Licences, tenant administration support and escalation to the platform provider.',
        support: [['Partner support', 'All tickets', 'Sun-Thu', '08:00', '17:00', 'Portal, phone']],
        slas: [['P2 response', 'INCIDENT_RESPONSE', 'P2', 1, 'hours', { bh: 1 }], ['P2 resolution', 'INCIDENT_RESOLUTION', 'P2', 1, 'days', { bh: 1 }]],
        raci: [['Licence true-up', 'Enterprise Applications', 'A', 'Account manager', 'R']] },
    ],
  },
];

// ------------------------------------------------------------------ helpers
const fmtTarget = (t, unit, bh) => `${t} ${unit === 'days' && bh ? 'business days' : unit === 'hours' && bh ? 'business hours' : unit}`;
function clauseText(svcName, s) {
  const [, metric, prio, t, unit, o = {}] = s;
  const p = prio ? `Priority ${prio.slice(1)}` : 'every';
  switch (metric) {
    case 'AVAILABILITY': return `The Supplier shall ensure the ${svcName} is available not less than ${t}% of each calendar month, measured by the Bank's monitoring tools and excluding pre-approved maintenance windows.`;
    case 'INCIDENT_RESPONSE': return `For a ${p} incident the Supplier shall acknowledge and assign a qualified engineer within ${fmtTarget(t, unit, o.bh)} of notification by the Bank.`;
    case 'INCIDENT_RESTORATION': return `For a ${p} incident the Supplier shall restore the service, by permanent fix or agreed workaround, within ${fmtTarget(t, unit, o.bh)} of notification.`;
    case 'INCIDENT_RESOLUTION': return `A ${p} incident shall be fully resolved within ${fmtTarget(t, unit, o.bh)} of notification.`;
    case 'RCA_DELIVERY': return `For each ${prio ? `Priority ${prio.slice(1)}` : 'Priority 1 and 2'} incident the Supplier shall deliver a written root cause analysis within ${t} business days of service restoration.`;
    default: return `The Supplier shall meet a target of ${t} ${unit} for ${s[0].toLowerCase()}.`;
  }
}

(async () => {
  const ctx = await createContext({ dataDir, log: () => {} });
  const api = createApi(ctx);
  const call = async (ch, args) => {
    const r = await api.invoke(ch, args);
    if (!r.ok) throw new Error(`${ch}: ${r.error.message}${r.error.detail ? ` (${r.error.detail})` : ''}`);
    return r.data;
  };
  const save = (entity, data) => call('registry.save', { entity, data });

  const existing = await call('registry.list', { entity: 'vendor' });
  if (existing.some((v) => v.legal_name === VENDORS[0].v.legal_name)) {
    console.log('The sample data is already loaded. Nothing was added.');
    ctx.db.close();
    process.exit(3);
  }

  const counts = { sections: 0, vendors: 0, services: 0, contracts: 0, clauses: 0, slas: 0, incidents: 0 };
  const sec = {};
  for (const [code, name, dept] of SECTIONS) {
    sec[code] = await save('bank_section', { section_name: name, department: dept, active: 1 });
    counts.sections += 1;
  }

  const ref = {};
  for (const V of VENDORS) {
    const v = await save('vendor', { ...V.v, status: 'ACTIVE' });
    counts.vendors += 1;
    for (const [i, [name, title, level]] of V.contacts.entries()) {
      await save('vendor_contact', { vendor_id: v.vendor_id, full_name: name, role_title: title, escalation_level: String(level), phone: `+970 2 29${String(40 + counts.vendors).padStart(2, '0')} ${100 + i}`, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@vendor.example`, is_primary: i === 0 ? 1 : 0, is_backup: 0, active: 1 });
    }
    const C = V.contract;
    const c = await save('contract', { vendor_id: v.vendor_id, title: C.title, repository_ref: C.ref, start_date: day(C.start), end_date: day(C.end), notice_period_days: C.notice, contract_value: C.value, currency: C.currency, status: 'ACTIVE' });
    counts.contracts += 1;
    let cv;
    if (C.versions === 2) {
      const mid = Math.round(C.start / 2);
      await save('contract_version', { contract_id: c.contract_id, effective_from: day(C.start), effective_to: day(mid - 1), approval_ref: `${C.ref}/v1`, status: 'SUPERSEDED' });
      cv = await save('contract_version', { contract_id: c.contract_id, effective_from: day(mid), approval_ref: `${C.ref}/AMD-1`, status: 'APPROVED' });
    } else {
      cv = await save('contract_version', { contract_id: c.contract_id, effective_from: day(C.start), approval_ref: C.ref, status: 'APPROVED' });
    }
    const effFrom = cv.effective_from;
    const clause = async (clause_ref, title, clause_type, clause_text, page_no) => { counts.clauses += 1; return save('contract_clause', { version_id: cv.version_id, clause_ref, title, clause_type, clause_text, page_no }); };
    const kSupport = await clause('Sch. B 2.1', 'Support hours and channels', 'SUPPORT', 'The Supplier shall provide support during the hours and through the channels set out in Schedule B, Table 2.', 6);
    const kCredit = await clause('Sch. B 7.1', 'Service credits', 'SERVICE_CREDIT', 'Where a critical service level is missed, the Supplier shall credit 5% of the monthly charge for that service per breach, capped at 25% per month.', 14);
    const kResp = await clause('Sch. B 9.1', 'Responsibilities', 'RESPONSIBILITY', 'The responsibilities of the Bank and the Supplier are set out in the responsibility matrix in Annex 3.', 16);
    const kSec = await clause('Cl. 12.3', 'Security incident notification', 'SECURITY', 'The Supplier shall notify the Bank of any security incident affecting the services or Bank data within two (2) hours of becoming aware of it.', 22);
    const kAudit = await clause('Cl. 13.1', 'Right to audit', 'AUDIT', 'The Bank and its regulators may audit the Supplier\'s performance of the services on reasonable notice.', 23);
    const kExit = await clause('Cl. 15.2', 'Exit assistance', 'EXIT', 'On termination or expiry the Supplier shall provide up to six (6) months of transition assistance and return all Bank data.', 27);

    let first = null;
    for (const S of V.services) {
      const s = await save('service', { service_name: S.name, service_tower: S.tower, criticality: S.criticality, data_classification: S.cls, section_id: sec[S.section].section_id, description: S.desc });
      counts.services += 1;
      const vs = await save('vendor_service', { vendor_id: v.vendor_id, service_id: s.service_id, contract_id: c.contract_id, scope: S.scope, start_date: day(C.start), end_date: day(C.end), status: 'ACTIVE' });
      if (!first) first = { s, vs };
      for (const [label, applies, days, from, to, channels] of S.support) {
        await save('support_window', { vendor_service_id: vs.vendor_service_id, label, applies_to: applies, days_of_week: days, start_time: from, end_time: to, timezone: 'Asia/Hebron', channels, clause_id: kSupport.clause_id });
      }
      for (const [activity, bp, br, vp, vr, flag] of S.raci) {
        await save('responsibility', { vendor_service_id: vs.vendor_service_id, activity, bank_party: bp, bank_raci: br, vendor_party: vp, vendor_raci: vr, clause_id: flag === 'noclause' ? '' : kResp.clause_id });
      }
      const slaIds = {};
      for (const [i, row] of S.slas.entries()) {
        const [name, metric, priority, target, unit, o = {}] = row;
        const k = await clause(`Sch. B 4.${counts.slas + 1}`, name, metric === 'AVAILABILITY' ? 'AVAILABILITY' : 'SLA', clauseText(S.name, row), 8 + i);
        const d = await save('sla_definition', {
          name, service_id: s.service_id, vendor_id: v.vendor_id, metric_code: metric, priority, direction: metric === 'AVAILABILITY' ? 'higher_is_better' : 'lower_is_better',
          target_value: target, warning_value: o.warning ?? '', unit, measurement_window: metric === 'AVAILABILITY' ? 'calendar_month' : 'per_incident',
          support_window_code: o.bh ? 'business_hours' : '24x7', exclusions: metric === 'AVAILABILITY' ? 'Pre-approved maintenance windows; bank-caused outages' : 'Clock pauses accepted by the Bank',
          evidence_source: metric === 'AVAILABILITY' ? 'Bank monitoring platform' : 'ITSM ticket timestamps', is_critical: o.critical ? 1 : 0, formula_version: 'v1', effective_from: effFrom, approval_status: 'APPROVED',
        });
        counts.slas += 1;
        slaIds[name] = d.sla_id;
        await save('sla_contract_mapping', { version_id: cv.version_id, sla_id: d.sla_id, clause_id: k.clause_id, contractual_target: `${metric === 'AVAILABILITY' ? '\u2265' : '\u2264'} ${fmtTarget(target, unit, o.bh)}`, remedy_clause_id: o.critical ? kCredit.clause_id : '', remedy_text: o.critical ? '5% of the monthly charge per breach, cap 25%' : '' });
      }
      ref[`${V.key}:${S.name}`] = { v, s, vs };
    }
    await save('contract_obligation', { version_id: cv.version_id, vendor_service_id: first.vs.vendor_service_id, clause_id: kSec.clause_id, category: 'SECURITY', description: 'Notify the Bank of any security incident affecting the services or Bank data within 2 hours.', bank_owner_role: 'Head of Information Security', vendor_owner_role: 'Service manager', frequency: 'Event-driven' });
    await save('contract_obligation', { version_id: cv.version_id, vendor_service_id: first.vs.vendor_service_id, clause_id: kAudit.clause_id, category: 'AUDIT', description: 'Give the Bank and its regulators access for audits of the services.', bank_owner_role: 'Internal Audit', vendor_owner_role: 'Account manager', frequency: 'On request' });
    await save('contract_obligation', { version_id: cv.version_id, vendor_service_id: first.vs.vendor_service_id, clause_id: '', category: 'REPORTING', description: 'Deliver the monthly SLA performance report with raw data by the 5th business day.', bank_owner_role: 'Vendor Management', vendor_owner_role: 'Service manager', frequency: 'Monthly' });
    await save('contract_obligation', { version_id: cv.version_id, vendor_service_id: first.vs.vendor_service_id, clause_id: kExit.clause_id, category: 'EXIT', description: 'Provide up to 6 months of transition assistance and return all Bank data on exit.', bank_owner_role: 'Vendor Management Section Head', vendor_owner_role: 'Account director', frequency: 'On exit' });
    for (const [domain, rating, finding, treatment] of V.risk) {
      await save('risk_assessment', { vendor_id: v.vendor_id, service_id: first.s.service_id, risk_domain: domain, rating, finding, treatment, assessed_on: day(-60), due_date: day(120) });
    }
    ref[V.key] = { v, first };
  }

  // ------------------------------------------------------------------ incident reports (drafts, ready to finalise in the app)
  const R = (key, svc) => ref[`${key}:${svc}`];
  const incident = async (target, h) => {
    const r = await call('incidents.create', { vendor_id: target.v.vendor_id, service_id: target.s.service_id, title: h.title, priority: h.priority, detected_at: h.detected_at });
    const id = r.report_id;
    await call('incidents.update', { id, data: h.data });
    for (const t of h.timeline || []) await call('incidents.saveChild', { reportId: id, kind: 'timeline', data: { occurred_at: t[0], event_type: t[1], actor_party: t[2], actor_name: t[3], description: t[4], source: t[5] || 'ITSM' } });
    for (const p of h.pauses || []) {
      await call('incidents.saveChild', { reportId: id, kind: 'pause', data: { paused_at: p[0], resumed_at: p[1], reason: p[2] } });
    }
    let ev = null;
    if (h.evidence) ev = await call('evidence.add', { reportId: id, name: h.evidence[0], mimeType: 'text/plain', dataBase64: b64(h.evidence[1]), description: h.evidence[2], source: h.evidence[3] });
    for (const st of h.state || []) await call('incidents.saveChild', { reportId: id, kind: 'state', data: { component: st[0], indicator: st[1], unit: st[2], before_value: st[3], during_value: st[4], after_value: st[5], before_status: 'Normal', after_status: st[6] || 'Normal', evidence_id: ev ? ev.evidence_id : '' } });
    for (const a of h.actions || []) await call('incidents.saveChild', { reportId: id, kind: 'vendorAction', data: { action_at: a[0], vendor_actor: a[1], action_type: a[2], description: a[3], outcome: a[4], evidence_id: a[5] && ev ? ev.evidence_id : '' } });
    for (const ca of h.corrective || []) await call('incidents.saveChild', { reportId: id, kind: 'corrective', data: { description: ca[0], source_finding: ca[1], action_type: ca[2], severity: ca[3], owner_party: ca[4], owner_name: ca[5], due_date: ca[6] } });
    const full = await call('incidents.get', { id });
    for (const p of full.pauses) await call('incidents.approvePause', { reportId: id, pauseId: p.pause_id, approved: true });
    for (const a of full.vendorActions.filter((x) => x.evidence_id)) await call('incidents.verifyAction', { reportId: id, actionId: a.action_id, verified: true });
    await call('incidents.calculateSla', { id });
    counts.incidents += 1;
  };

  let d0 = iso(38, 6, 40);
  await incident(R('telecom', 'Branch WAN & MPLS Connectivity'), {
    title: 'MPLS outage - 31 northern branches offline', priority: 'P1', detected_at: plus(d0, 2),
    data: { impact_summary: 'Loss of MPLS connectivity for 31 of 78 branches in the Nablus, Jenin and Tulkarm areas. Teller systems and ATM authorisation were unavailable.', business_impact: 'Branches worked offline for cash only; 19 ATMs declined transactions for about 4.5 hours.', customers_affected: 4200, channels_affected: 'Branches, ATMs', financial_impact: 15000, outage_type: 'FULL', reported_at: plus(d0, 8), acknowledged_at: plus(d0, 27), workaround_at: plus(d0, 230), restored_at: plus(d0, 281), resolved_at: plus(d0, 1500), outage_start: d0, outage_end: plus(d0, 281), itsm_ref: 'INC0051187', vendor_ticket_ref: 'ABTN-TT-77120', root_cause_category: 'Change management', root_cause: 'An unscheduled routing change on a provider core router withdrew the VPN routes for the northern region. The change was made outside the agreed maintenance window without a rollback plan.', contributing_factors: 'Route-withdrawal alarm suppressed during the change; escalation to level 2 came 80 minutes after detection.', rca_received_at: plus(d0, 4 * 1440), rca_accepted: 1 },
    timeline: [[d0, 'Outage start', 'VENDOR', 'Provider core', 'VPN routes withdrawn after an unscheduled change.', 'Network monitoring'], [plus(d0, 2), 'Detection', 'BANK', 'Bank NOC', 'Branch-down alarms for 31 sites.', 'Network monitoring'], [plus(d0, 8), 'Reported to vendor', 'BANK', 'Network engineer', 'P1 raised by phone and ticket.'], [plus(d0, 27), 'Vendor acknowledged', 'VENDOR', 'NOC Duty Manager', 'Engineer assigned.'], [plus(d0, 95), 'Clock paused', 'BANK', 'Data centre security', 'Vendor engineer waiting for DC access approval.'], [plus(d0, 125), 'Clock resumed', 'BANK', 'Data centre security', 'Access granted.'], [plus(d0, 230), 'Workaround', 'VENDOR', 'Khalil Odeh', 'Static routes via secondary router; 25 branches back.'], [plus(d0, 281), 'Service restored', 'VENDOR', 'Khalil Odeh', 'Change rolled back; all branches online.', 'Network monitoring']],
    pauses: [[plus(d0, 95), plus(d0, 125), 'Vendor engineer waiting for bank data-centre access approval.']],
    evidence: ['nms_branch_reachability.csv', 'time,site,status\n06:40,NBL-01,DOWN\n11:21,NBL-01,UP\n', 'Monitoring export of branch reachability', 'Network monitoring platform'],
    state: [['Branch MPLS', 'Branches reachable', 'of 78', '78', '47', '78'], ['ATM network', 'ATMs authorising', 'of 150', '149', '130', '149']],
    actions: [[plus(d0, 27), 'NOC Duty Manager', 'Acknowledgement', 'Acknowledged the P1 and dispatched an engineer.', 'Engineer en route', 0], [plus(d0, 230), 'Khalil Odeh', 'Workaround', 'Applied static routes through the secondary router.', '25 branches restored', 1], [plus(d0, 279), 'Khalil Odeh', 'Fix', 'Rolled back the routing change.', 'All branches restored', 1]],
    corrective: [['Four-eyes review and rollback plan for every provider-core change affecting bank traffic.', 'Unapproved change', 'CORRECTIVE', 'CRITICAL', 'VENDOR', 'Khalil Odeh', day(20)], ['Pre-authorise vendor DC access for P1 incidents.', 'Access delay', 'PREVENTIVE', 'MEDIUM', 'BANK', 'Infrastructure & Data Centre', day(35)]],
  });

  d0 = iso(19, 17, 5);
  await incident(R('cards', 'Card Processing & Authorisation Switch'), {
    title: 'Card authorisations failing for e-commerce and POS', priority: 'P1', detected_at: plus(d0, 4),
    data: { impact_summary: 'About 38% of card authorisations for POS and e-commerce were declined with a timeout code for 95 minutes. ATM withdrawals were not affected.', business_impact: 'Customer complaints through the call centre; merchants reported failed payments during evening peak.', customers_affected: 2600, channels_affected: 'POS, e-commerce', outage_type: 'PARTIAL', reported_at: plus(d0, 9), acknowledged_at: plus(d0, 16), restored_at: plus(d0, 104), resolved_at: plus(d0, 1440), outage_start: d0, outage_end: plus(d0, 104), itsm_ref: 'INC0052240', vendor_ticket_ref: 'CPS-OPS-55021', root_cause_category: 'Capacity', root_cause: 'A database connection pool on the authorisation switch was exhausted after a configuration change reduced its size.', contributing_factors: 'The change was not load-tested; the capacity alarm threshold was too high.', rca_received_at: plus(d0, 5 * 1440) },
    timeline: [[plus(d0, 4), 'Detection', 'BANK', 'Cards operations', 'Spike in declined authorisations on the monitoring dashboard.'], [plus(d0, 9), 'Reported to vendor', 'BANK', 'Cards operations', 'P1 raised with switch operations.'], [plus(d0, 16), 'Vendor acknowledged', 'VENDOR', 'Switch Operations', 'Investigation started.'], [plus(d0, 104), 'Service restored', 'VENDOR', 'Nadia Haddad', 'Connection pool size restored; approvals back to normal.']],
    evidence: ['authorisation_decline_rates.txt', '17:00 decline 2%\n17:10 decline 38%\n18:50 decline 2%\n', 'Decline-rate report from the card monitoring tool', 'Card monitoring'],
    state: [['Authorisation switch', 'Approval rate', '%', '97', '60', '97']],
    actions: [[plus(d0, 16), 'Switch Operations', 'Acknowledgement', 'Acknowledged and opened a bridge call.', 'Bridge opened', 0], [plus(d0, 100), 'Nadia Haddad', 'Fix', 'Restored the connection pool configuration and restarted the service.', 'Approvals normal', 1]],
    corrective: [['Load-test every switch configuration change before production.', 'Untested change', 'CORRECTIVE', 'HIGH', 'VENDOR', 'Nadia Haddad', day(25)], ['Lower the connection-pool capacity alarm to 70%.', 'Late alarm', 'PREVENTIVE', 'MEDIUM', 'VENDOR', 'Switch Operations', day(15)]],
  });

  d0 = iso(9, 3, 10);
  await incident(R('core', 'Core Banking Application Support'), {
    title: 'End-of-day batch overran - branches opened late', priority: 'P2', detected_at: d0,
    data: { impact_summary: 'The end-of-day interest posting job failed and had to be rerun; online services opened 70 minutes late.', business_impact: 'Branches and digital channels were read-only until 09:10.', customers_affected: 9000, channels_affected: 'Branches, mobile banking, internet banking', outage_type: 'PARTIAL', reported_at: plus(d0, 6), acknowledged_at: plus(d0, 21), restored_at: plus(d0, 230), resolved_at: plus(d0, 2880), outage_start: plus(d0, 170), outage_end: plus(d0, 240), itsm_ref: 'INC0052611', vendor_ticket_ref: 'LCBS-88213', root_cause_category: 'Software defect', root_cause: 'A regression in the latest regulatory patch caused the interest posting job to fail on accounts with more than 999 sub-ledgers.', contributing_factors: 'The regression test pack did not include high-volume accounts.' },
    timeline: [[d0, 'Detection', 'BANK', 'Batch operator', 'Interest posting job failed.', 'Batch scheduler'], [plus(d0, 6), 'Reported to vendor', 'BANK', 'Batch operator', 'Severity 2 raised on the hotline.'], [plus(d0, 21), 'Vendor acknowledged', 'VENDOR', 'Support Desk', 'Engineer assigned.'], [plus(d0, 230), 'Service restored', 'VENDOR', 'Hani Masri', 'Hotfix applied and batch rerun completed.', 'Batch scheduler']],
    evidence: ['batch_log_interest_posting.txt', '03:10 ERROR ORA-01438\n06:50 rerun OK\n', 'Batch scheduler log', 'Batch scheduler'],
    state: [['Core banking', 'Batch completion time', 'local', '05:30', 'failed', '06:50'], ['Online channels', 'Opening time', 'local', '08:00', '09:10', '08:00']],
    actions: [[plus(d0, 120), 'Hani Masri', 'Diagnosis', 'Identified the regression in the regulatory patch.', 'Hotfix prepared', 1], [plus(d0, 200), 'Hani Masri', 'Fix', 'Applied the hotfix and reran the batch.', 'Batch completed', 1]],
    corrective: [['Add high-volume sub-ledger accounts to the regression test pack.', 'Regression not caught', 'PREVENTIVE', 'HIGH', 'VENDOR', 'Hani Masri', day(30)]],
  });

  d0 = iso(4, 7, 30);
  await incident(R('atm', 'ATM & Deposit Machine Maintenance'), {
    title: 'Cash dispenser faults on 7 ATMs in Ramallah and Al-Bireh', priority: 'P2', detected_at: d0,
    data: { impact_summary: 'Seven ATMs reported cash dispenser jams after a firmware update.', outage_type: 'PARTIAL', reported_at: plus(d0, 12), acknowledged_at: plus(d0, 40), outage_start: d0, itsm_ref: 'INC0052905' },
    timeline: [[d0, 'Detection', 'BANK', 'ATM monitoring', 'Seven ATMs reporting dispenser faults.', 'ATM monitoring']],
    state: [['ATM fleet', 'ATMs in service', 'of 150', '149', '142', '', 'Degraded']],
  });

  d0 = iso(70, 22, 15);
  await incident(R('soc', 'Managed Security Monitoring (SOC)'), {
    title: 'Late notification of a brute-force alert on the VPN gateway', priority: 'P2', detected_at: d0,
    data: { impact_summary: 'A high-severity brute-force alert was notified to the bank 74 minutes after it fired. No account was compromised.', outage_type: 'NONE', reported_at: d0, acknowledged_at: plus(d0, 74), restored_at: plus(d0, 120), root_cause_category: 'Process', root_cause: 'The night-shift analyst triaged the alert as medium because the use case was mis-tagged in the SIEM.', itsm_ref: 'SEC-2291' },
    timeline: [[d0, 'Detection', 'VENDOR', 'SIEM', 'Brute-force alert fired on the VPN gateway.'], [plus(d0, 74), 'Vendor acknowledged', 'VENDOR', 'SOC Analyst on duty', 'Alert escalated to the bank by phone.'], [plus(d0, 120), 'Service restored', 'BANK', 'Information Security', 'Source IPs blocked.']],
    state: [['VPN gateway', 'Failed logins per hour', 'count', '20', '4,800', '25']],
    actions: [[plus(d0, 74), 'SOC Analyst on duty', 'Escalation', 'Notified the bank by phone and email.', 'Bank blocked the source IPs', 0]],
    corrective: [['Correct the severity tagging of the VPN brute-force use case and review all VPN use cases.', 'Mis-tagged use case', 'CORRECTIVE', 'HIGH', 'VENDOR', 'Rami Aziz', day(-5)]],
  });

  ctx.db.close();
  console.log('Sample data added:');
  for (const [k, n] of Object.entries(counts)) console.log(`  ${k.padEnd(10)} ${n}`);
  console.log('Incident reports are drafts: open them in the app to review and finalise.');
})().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
