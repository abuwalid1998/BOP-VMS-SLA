# BOP VMS-SLA: Vendor Management & SLA Platform

A Windows desktop application (Electron + SQLite) for the Bank of Palestine Vendor Management
Section. It implements the *VMS-SLA reference architecture* with two connected features:

1. **Service Commitment Report.** For a vendor and a service, every contractual commitment (SLA
   targets, support hours, escalation contacts, responsibilities, obligations), each linked to the
   contract clause it comes from. Commitments with no clause are reported as gaps.
2. **Vendor Incident Report.** Impact, timeline, service state before and after, vendor actions with
   evidence, automatic SLA compliance calculation, root cause and corrective actions. It ends in a
   sealed, locked PDF.

## What is in this repository

| Folder | What it is |
| --- | --- |
| [`personal-edition/`](personal-edition/) | **Personal Edition.** Single user, no login, no approvals. Every record gets an automatic code (S-0001, V-0001, INC-0001, ...). One *Finalise* step seals the report. |
| [`full-edition/`](full-edition/) | **Full Edition.** Multi-user with roles and sign-in, and electronic sign-off by the IT Section Head, the Vendor Management Section Head and the CIO (Ed25519 signatures). |
| [`docs/`](docs/) | `BOP-VMS-SLA-Personal-System-Guide.docx`: every screen, how the system works, how it manages vendor relationships, and its impact. |
| [`tools/`](tools/) | `load-sample-data.bat`: loads fictional sample data (10 IT sections, 10 vendors, contracts, 42 SLAs, 5 incident reports) into an installed Personal Edition. |

## Build and install (Windows)

The installers are not stored in this repository (each is over 130 MB). To build one:

1. Install Node.js 20 or newer.
2. Open `personal-edition` (or `full-edition`) and double-click **`build-installer.cmd`**.
3. The installer is written to that folder's `dist\` (for example `BOP-VMS-SLA-Personal-Setup-1.0.0.exe`).

To run from source instead:

```bash
cd personal-edition
```

```bash
npm install
```

```bash
npm start
```

## Load sample data (Personal Edition)

1. Install and open the Personal Edition once, then close it.
2. Download [`tools/load-sample-data.bat`](tools/load-sample-data.bat) and double-click it, then type **Y**.

It backs up your data first, uses the installed app itself (no Node.js needed) and never loads the
data twice. All vendor names, people, contracts and incidents in it are fictional.

## Database

SQLite is used at runtime. One dialect-neutral schema (`main/db/schema.js`) generates the DDL for
SQLite, PostgreSQL and Oracle, including the triggers that lock finalised records.
`scripts/migrate-db.js` (or *Settings / Administration → Database* in the app) produces a full
migration script or loads the data directly. The PostgreSQL path is tested end to end; the Oracle
scripts follow Oracle 12.2+ syntax and should be tested on a real Oracle instance before use.

## Tests

```bash
cd personal-edition && npm install && npm test
```

```bash
cd full-edition && npm install && npm test
```

## Notes

* This is a proposed design. Validate it with IT, Legal, Compliance, Information Security,
  Operational Risk and Internal Audit before production use.
* The installers are not code-signed. Sign them with the bank's certificate (`CSC_LINK` /
  `CSC_KEY_PASSWORD`) for distribution.
* Bank of Palestine name and logo are the property of Bank of Palestine.
* The fonts (IBM Plex) are under the SIL Open Font License.
