# BOP VMS-SLA Personal Edition

Single-user Windows desktop application for the Bank of Palestine Vendor Management Section Head.
There are no user accounts, no sign-in and no approval chain. You record, calculate and finalise
everything yourself.

It has two connected features:

1. **Service Commitment Report.** Pick a vendor and a service to see every commitment: SLA targets,
   support hours, vendor escalation contacts, responsibilities and other obligations. Each commitment
   is linked to its contract clause, and commitments with no clause are flagged as gaps. It can be
   issued as a sealed PDF.
2. **Vendor Incident Report.** Record the incident, its impact and timeline, the service state before
   and after, vendor actions with evidence, root cause and corrective actions. The app calculates SLA
   compliance. **Finalise** freezes the content, produces a sealed PDF and locks the report.

It installs alongside the multi-user edition (`BOP VMS-SLA`) without conflict. Each edition has its
own data folder.

## Install

1. Run `BOP-VMS-SLA-Personal-Setup-1.0.0.exe`, choose **Only for me**, then **Install**.
2. The app opens on the dashboard: no sign-in, no sample data.
3. Under **Settings**, enter your name and job title; they are printed on the sealed PDFs.
4. Follow the *Getting started* checklist on the dashboard.

The installer is not code-signed, so Windows SmartScreen may warn: choose **More info → Run anyway**.

## Automatic codes

Every record gets the next code in its series when first saved. Codes are never typed and never
change.

| Record | Codes |
|---|---|
| Bank section | SEC-0001, SEC-0002, … |
| Vendor | V-0001, … |
| Service | S-0001, … |
| Contract | C-0001, … (the vendor's own contract number has its own field) |
| Contract version | v1, v2, … within each contract |
| SLA definition | SLA-0001, … |
| Incident report | INC-0001, … |

## Your data

All data is kept in `%APPDATA%\BOP VMS-SLA Personal\data`: the database, evidence files, sealed PDFs
and a log. In the app, *File → Open data folder* opens it, and *Settings* shows the paths.

* **Back up:** close the app and copy the whole `data` folder.
* **Restore:** put the copy back in the same place.
* **Uninstall:** removes the program but keeps the data.
* **Move to PostgreSQL or Oracle:** *Settings → Move to PostgreSQL or Oracle* downloads a full
  migration script. You can also run `node scripts/migrate-db.js` from the source.

## Build the installer yourself

On Windows with Node.js 20+, extract the source zip, open the `bop-vms-sla-personal` folder and
double-click `build-installer.cmd`. The installer is written to `dist\`. Change `version` in
`package.json` before each new release; installing over an older version keeps the data.

## Developers

```bash
npm install
```

```bash
npm start
```

```bash
npm test
```

The schema is defined once in `main/db/schema.js`, which generates SQLite, PostgreSQL and Oracle DDL.
The SLA engine is in `main/services/sla-calc.js`, finalising in `main/services/finalize.js`, and
automatic codes in `main/services/registry.js` (`AUTO_CODES`). The tests create their own temporary
records; nothing is packaged with the app.
