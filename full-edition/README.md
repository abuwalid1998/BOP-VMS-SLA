# BOP VMS-SLA: Vendor Management & SLA Platform (desktop edition)

Electron desktop application for the Bank of Palestine Vendor Management Section. It implements the
*VMS-SLA reference architecture* (v1.0, 15 Nov 2026) with two integrated features:

1. **Service Commitment Report.** Pick a vendor and service to see every contractual commitment:
   SLA targets, support hours, escalation contacts (vendor and bank) and responsibilities. Each
   commitment is linked to the contract clause it comes from, and unlinked ones are flagged as gaps.
2. **Vendor Incident Report & Approval.** Record incident details, impact and timeline, the service
   state before and after, every vendor action with its evidence, the SLA compliance calculation,
   root cause and corrective actions. The report then goes through electronic sign-off:

   | Step | Approver | Responsibility |
   |---|---|---|
   | 1 | Responsible BOP IT Section Head | Technical validation |
   | 2 | Vendor Management Section Head | Vendor performance and contractual review |
   | 3 | CIO | Executive approval, according to incident severity and approval policy |

   After the final signature the report is locked in the database, and a sealed PDF (signatures,
   timestamps, approval history, evidence hashes) is generated and registered.

Both features read from the same governed catalogue (vendors, services, contracts, clauses, SLA
definitions). They are modules of the VMS-SLA platform, not standalone tools.

---

## Install (Windows)

1. Run **`BOP-VMS-SLA-Setup-1.0.0.exe`**.
2. Choose **Only for me** (no administrator rights needed) or **Anyone who uses this computer**, and
   the install folder.
3. The installer adds a desktop shortcut and a Start menu entry under *Bank of Palestine*, then
   starts the app.
4. **First launch:** the app starts with an empty database and asks you to create the
   **administrator account**. There is no sample data.
5. Follow the *Getting started* checklist on the dashboard:
   1. Add the bank sections.
   2. Add people and their roles.
   3. Assign each section's head.
   4. Add vendors and services.
   5. Add contracts with their clauses.
   6. Link each vendor to the services it provides.
   7. Add SLA definitions and map them to clauses.

The installer is not code-signed yet, so Windows SmartScreen may show *"Windows protected your PC"*:
choose **More info → Run anyway**. To sign it, see "Build the installer" below.

**Where the data lives:** `%APPDATA%\BOP VMS-SLA\data` holds the database (`vms-sla.sqlite`), the
evidence files, the sealed PDFs and logs (*File → Open data folder*). Uninstalling (*Settings → Apps*)
removes the program but **keeps this data**. To start again with an empty database, close the app and
move that folder away, or run `node scripts/reset-db.js`, which moves the data to a backup folder.

**IT deployment (silent install):**

```bat
BOP-VMS-SLA-Setup-1.0.0.exe /S /currentuser
```

```bat
BOP-VMS-SLA-Setup-1.0.0.exe /S /allusers /D=C:\Program Files\BOP VMS-SLA
```

The `/allusers` install needs administrator rights.

## Build the installer

On a Windows PC with Node.js 20+ installed, double-click **`build-installer.cmd`**. It installs the
build tools, runs the tests and writes `dist\BOP-VMS-SLA-Setup-<version>.exe`. Or run the steps
yourself:

```bash
npm ci
```

```bash
npm run dist
```

To sign the installer with the bank's code-signing certificate, set `CSC_LINK` (path to the .pfx)
and `CSC_KEY_PASSWORD` before `npm run dist`. Change the version in `package.json` before each
release; installing a newer version over an older one keeps the data.

Building on Linux or macOS also works but needs Wine for the Windows installer step.

## Run from source (developers)

```bash
npm install
```

```bash
npm start
```

## How the sign-off works

* **Submit:** SLA compliance is recalculated, readiness checks run (impact, milestones, timeline,
  vendor actions, before/after state, a corrective action for every breach, and a section head
  assigned), the report content is frozen and its SHA-256 **content hash** is recorded.
* **Approval chain:** built from the *approval policy* (Administration screen). By default P1 and P2
  always need the CIO; P3 and P4 need the CIO only if a **critical SLA** is breached.
* **Signing:** the approver re-enters their password. That unlocks their personal **Ed25519 key**
  (stored AES-256-GCM-encrypted under their password). The key signs a payload holding the content
  hash, decision, comment, UTC timestamp, signer and the previous signature's hash, so the signatures
  form a chain.
* **Controls:**
  * Step 1 can only be signed by the head of the section that owns the service.
  * One person cannot sign two steps of the same revision.
  * If the content changed after submission, signing is blocked.
  * Five failed attempts lock the account for 15 minutes.
* **Return for changes:** a reason is required. The author edits and resubmits, which starts a new
  revision with a fresh chain. Earlier revisions and signatures remain in the history.
* **Final approval:**
  * The PDF is rendered and sealed. Editing is disabled by the PDF permissions (AES-128, random owner
    password that is discarded), and a JSON signature manifest is attached.
  * The PDF is stored read-only with its SHA-256 in the append-only document register.
  * The report row is locked.
* **Verification:** *Sealed documents → Verify* re-hashes the stored file and re-verifies every
  signature. *Check a PDF someone sent you* tells whether any copy is authentic. On the command line:
  `npm run verify:pdf -- <file.pdf>`.

## SLA calculation (engine `incident-v1`)

| Metric | Clock |
|---|---|
| Response | reported to vendor → vendor acknowledged |
| Restoration | reported → service restored, minus **bank-approved** clock pauses |
| Resolution | reported → resolved, minus approved pauses |
| RCA delivery | restored → RCA received |
| Availability | month of the outage, all FULL outages of the service that month (this and other reports) over 24x7 minutes |

SLAs measured in business hours use the business calendar (default Sun–Thu 08:00–15:00 Asia/Hebron,
with holidays), which you can change under Administration. Missing timestamps give *Not measurable*,
never *Met*. A breach of a critical SLA is shown as a **critical override**, independently of any
score. Each result stores its explanation, clause reference, remedy and engine version.

## Integrity at the database layer

Generated triggers (on SQLite, PostgreSQL and Oracle) enforce these rules even against direct SQL:

* `e_signature`, `report_document` and `audit_event` are append-only.
* A locked `incident_report`, and its timeline, pauses, service state, vendor actions and SLA
  results, cannot be changed.
* `audit_event` is hash-chained; *Audit trail → Verify the chain* detects any edited or removed event.

---

## Database: SQLite now, PostgreSQL or Oracle later

`main/db/schema.js` is the single, dialect-neutral definition of the 30 tables. `main/db/ddl.js`
generates DDL for each engine (tables, checks, FKs, indexes, triggers).

```bash
npm run db:ddl          # writes db/generated/vms-sla_{sqlite,postgres,oracle}.sql
```

**Recreate the live database on another engine.** Every row is copied with its id preserved;
constraints and triggers are added after the load, and identity counters are reset.

```bash
# 1) Script, to run with psql or SQL*Plus / SQLcl
node scripts/migrate-db.js --target postgres --out vms-sla_pg.sql
psql -d vms_sla -f vms-sla_pg.sql

node scripts/migrate-db.js --target oracle --out vms-sla_ora.sql
sql vms_owner@//dbhost:1521/VMSPDB @vms-sla_ora.sql
```

```bash
# 2) Direct load with row-count verification (drivers are optional dependencies)
PGPASSWORD=... node scripts/migrate-db.js --target postgres --connect "postgres://vms@dbhost:5432/vms_sla"
ORACLE_PASSWORD=... node scripts/migrate-db.js --target oracle --user vms_owner --connect-string dbhost:1521/VMSPDB
```

The same scripts can be downloaded from *Administration → Database*. The database stores the SHA-256
of every evidence file and sealed PDF, but not the files themselves, so copy the `evidence` and
`documents` folders to the new location as well.

---

## Project layout

```
main/
  main.js, preload.js      Electron shell (app:// protocol, context isolation, sandbox, single IPC channel)
  api.js                   request router: authentication, roles, channels
  context.js               data folders, database, PDF renderer
  db/                      schema, DDL generator, SQLite layer (sql.js), migration, first-run bootstrap
  services/                auth, audit, registry, commitments, incidents, sla-calc, approvals, evidence, settings
  report/                  PDF templates, sealing and verification
renderer/                  UI (plain ES modules, no build step), BOP theme, bundled IBM Plex fonts
scripts/                   export-ddl, migrate-db, reset-db, verify-report, dev-server
build/                     installer icon and artwork (electron-builder / NSIS)
build-installer.cmd        one-click installer build on Windows
test/                      node:test suite (SLA engine, workflow, signatures, locking, DDL)
db/generated/              generated DDL for SQLite, PostgreSQL, Oracle
```

```bash
npm test                   # 17 tests
```

The tests build their own fictional data set (`test/fixtures/demo-seed.js`). It is never packaged
into the application.

`npm run dev:web -- --data <folder>` serves the same UI in a browser at http://127.0.0.1:5180 for
testing. It needs `npm i -D playwright` and `npx playwright install chromium` for PDF rendering.

---

## Know before adopting

* **One workstation, one database.** SQLite runs in-process and the app allows a single instance.
  Do not put the data folder on a shared drive for several people at once. For approvers on
  different PCs, move the database to PostgreSQL or Oracle (the schema and migration are ready) and
  put a small service in front of `main/api.js`, which is already UI-independent.
* **Authentication** is local username and password. In production, connect bank SSO/MFA and keep
  the password re-authentication (or an MFA step-up) before signing.
* **Electronic signatures** are authenticated, timestamped, tamper-evident Ed25519 signatures
  verified by the application. They are not X.509/PAdES signatures. If Legal requires qualified or
  advanced signatures, issue signing certificates from the bank PKI/HSM and sign the PDF with them;
  the workflow does not change.
* **PDF lock:** the PDF permissions stop editing in standard viewers. Authenticity rests on the
  registered SHA-256 and the signature verification, not on the PDF password.
* **Timestamps** come from the workstation clock. Synchronise it with the bank time source, or add an
  RFC 3161 timestamp authority.
* The Oracle scripts follow Oracle 12.2+ syntax and pass the structural tests. Test them on a bank
  Oracle instance before production. The PostgreSQL path was tested end to end on PostgreSQL 16.
* As the architecture document says, this is a proposed design. Validate it with IT, Procurement,
  Legal, Compliance, InfoSec, Operational Risk and Internal Audit.

The fonts (IBM Plex) are under
the SIL Open Font License; see `renderer/assets/fonts/OFL-LICENSE.txt`.
