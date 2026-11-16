First release of the Bank of Palestine Vendor Management & SLA platform (VMS-SLA), Windows desktop.

## Downloads

| File | What it is |
| --- | --- |
| **BOP-VMS-SLA-Personal-Setup-1.0.0.exe** | Personal Edition: single user, no login, no approvals, automatic codes (S-0001, V-0001, INC-0001). |
| **BOP-VMS-SLA-Setup-1.0.0.exe** | Full Edition: multi-user with roles and three-step electronic sign-off (IT Section Head, Vendor Management Section Head, CIO). |
| **BOP-VMS-SLA-Personal-System-Guide.docx** | System guide: every screen, how it works, how it manages vendor relationships, impact. |
| **load-sample-data.bat** | Loads fictional sample data (10 IT sections, 10 vendors, 42 SLAs, 5 incident reports) into an installed Personal Edition. |
| **SHA256SUMS.txt** | Checksums for verifying the downloads. |

## Install

1. Download the installer for the edition you want and run it.
2. Choose **Only for me** (no administrator rights needed), then **Install**.
3. Personal Edition opens straight to the dashboard. Full Edition asks you to create the administrator account on first start.

The installers are not code-signed yet, so Windows SmartScreen may show "Windows protected your PC": choose **More info → Run anyway**.

Both editions can be installed side by side; each keeps its own data in `%APPDATA%\BOP VMS-SLA\data` or `%APPDATA%\BOP VMS-SLA Personal\data`. Uninstalling keeps the data.

## Sample data (Personal Edition)

Close the app, run `load-sample-data.bat`, type **Y**. It backs up your data first and never loads twice. All vendors, people and contracts in it are fictional.

## What's in 1.0.0

- Service Commitment Report: every SLA target, support window, escalation contact and responsibility linked to its contract clause; gaps flagged; sealed PDF.
- Vendor Incident Report: timeline, before/after state, vendor actions with SHA-256-fingerprinted evidence, automatic SLA calculation (business hours, accepted clock pauses, monthly availability, critical override), root cause and corrective actions; sealed, locked PDF.
- SQLite database with generated PostgreSQL and Oracle DDL and full migration scripts.
- Tamper-evident activity log and database triggers that lock finalised records.
