'use strict';
/**
 * PDF generation, sealing and verification.
 *
 * Sealing a final incident report:
 *  1. Render the HTML template to PDF (Electron printToPDF; Chromium in dev).
 *  2. Post-process with pdf-lib: document metadata, an embedded JSON manifest
 *     (content hash + every signature with its public key), and PDF permissions
 *     that disable editing, assembly and form filling. The owner password is
 *     random and discarded, so nobody - including administrators - can lift the
 *     restrictions inside the file.
 *  3. Store the file read-only, register its SHA-256 in report_document
 *     (append-only table) and the audit chain, then lock the report record.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, PDFHeader, PDFDict, PDFArray, PDFString, PDFHexString, PDFStream } = require('@cantoo/pdf-lib');

/**
 * pdf-lib encrypts streams but leaves string objects (document info,
 * attachment names) in clear text, which readers then mis-decrypt. Encrypt
 * every string with its object's key, as the PDF standard requires.
 */
function encryptStrings(doc) {
  const security = doc.context.security;
  const encRef = doc.context.trailerInfo.Encrypt;
  const toHex = (bytes) => Buffer.from(bytes).toString('hex');
  const visit = (obj, ref) => {
    const enc = (str) => PDFHexString.of(toHex(security.getEncryptFn(ref.objectNumber, ref.generationNumber)(str.asBytes())));
    if (obj instanceof PDFStream) { visit(obj.dict, ref); return; }
    if (obj instanceof PDFDict) {
      for (const [key, value] of obj.entries()) {
        if (value instanceof PDFString || value instanceof PDFHexString) obj.set(key, enc(value));
        else visit(value, ref);
      }
      return;
    }
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i += 1) {
        const value = obj.get(i);
        if (value instanceof PDFString || value instanceof PDFHexString) obj.set(i, enc(value));
        else visit(value, ref);
      }
    }
  };
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (encRef && ref.objectNumber === encRef.objectNumber) continue;
    visit(obj, ref);
  }
}
const { AppError, nowIso, sha256 } = require('../services/util');
const audit = require('../services/audit');
const incidents = require('../services/incidents');
const approvals = require('../services/approvals');
const commitments = require('../services/commitments');
const templates = require('./templates');

async function seal(pdfBytes, { title, subject, keywords, manifest }) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  doc.setTitle(title);
  doc.setSubject(subject);
  doc.setAuthor('Bank of Palestine - Vendor Management Section');
  doc.setCreator('BOP VMS-SLA');
  doc.setProducer('BOP VMS-SLA document service');
  doc.setKeywords(keywords);
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());
  if (manifest) {
    await doc.attach(Buffer.from(JSON.stringify(manifest, null, 2)), 'signature-manifest.json', {
      mimeType: 'application/json', description: 'Signature manifest: content hash, signatures and public keys', creationDate: new Date(), modificationDate: new Date(),
    });
  }
  await doc.flush(); // embed the attachment now so its strings are encrypted below
  doc.context.header = PDFHeader.forVersion(1, 7); // selects AES-128 (V4/AESV2) instead of RC4
  doc.encrypt({
    ownerPassword: crypto.randomBytes(32).toString('hex'),
    permissions: { printing: 'highResolution', modifying: false, copying: true, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false },
  });
  encryptStrings(doc);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

function store(ctx, fileName, bytes) {
  const rel = path.join(new Date().getUTCFullYear().toString(), fileName);
  const abs = path.join(ctx.paths.documents, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (fs.existsSync(abs)) throw new AppError(`A sealed document named ${fileName} already exists.`, 'VALIDATION');
  fs.writeFileSync(abs, bytes, { mode: 0o444 });
  const hash = sha256(bytes);
  fs.writeFileSync(`${abs}.sha256`, `${hash}  ${fileName}\n`, { mode: 0o444 });
  return { file_ref: rel.split(path.sep).join('/'), sha256: hash, size_bytes: bytes.length };
}

function manifestFor(db, reportId) {
  const r = incidents.loadReport(db, reportId);
  const sigs = db.all('SELECT * FROM e_signature WHERE report_id = ? AND revision = ? ORDER BY signature_id', [reportId, r.revision]);
  return {
    type: 'BOP-VMS-SLA/incident-report-manifest', version: 1,
    report_no: r.report_no, revision: r.revision, content_hash: r.content_hash, approved_at: r.approved_at,
    signatures: sigs.map((s) => ({ step_id: s.step_id, signer: s.signer_name, role: s.role_code, decision: s.decision, signed_at: s.signed_at, payload: JSON.parse(s.payload_json), signature_b64: s.signature_b64, public_key_pem: s.public_key_pem, signature_hash: s.signature_hash })),
  };
}

/** Generate, seal, store and lock the final PDF for a fully approved report. */
async function finalizeIncident(db, ctx, actor, reportId) {
  const r = incidents.loadReport(db, reportId);
  if (r.status === 'LOCKED') throw new AppError('This report is already locked.', 'VALIDATION');
  if (r.status !== 'APPROVED') throw new AppError('The report must be fully approved before the final PDF is produced.', 'VALIDATION');
  const verification = approvals.verifySignatures(db, reportId);
  if (!verification.ok) throw new AppError('Signature verification failed. The final PDF was not produced.', 'INTEGRITY');
  const full = incidents.get(db, reportId);
  const appr = approvals.forReport(db, actor, reportId);
  const generatedAt = nowIso();
  const html = templates.incidentReport({ full, approvals: appr, verification, generatedAt, generatedBy: actor.full_name, final: true });
  const raw = await ctx.renderPdf(html);
  const sealed = await seal(raw, {
    title: `${r.report_no} Vendor Incident Report (rev ${r.revision})`,
    subject: `${full.report.vendor_name} - ${full.report.service_name}`,
    keywords: ['BOP', 'VMS-SLA', r.report_no, `content-sha256:${r.content_hash}`],
    manifest: manifestFor(db, reportId),
  });
  const stored = store(ctx, `${r.report_no}_rev${r.revision}_FINAL.pdf`, sealed);
  const documentId = approvals.lockReport(db, actor, reportId, { ...stored, title: `${r.report_no} final approved report (rev ${r.revision})`, encrypted: true });
  return { documentId, ...stored };
}

/** Working copy for review (not sealed, not registered). */
async function previewIncident(db, ctx, actor, reportId) {
  const full = incidents.get(db, reportId);
  const appr = approvals.forReport(db, actor, reportId);
  const html = templates.incidentReport({ full, approvals: appr, verification: null, generatedAt: nowIso(), generatedBy: actor.full_name, final: false });
  return ctx.renderPdf(html);
}

/** Commitment report snapshot: sealed and registered, so the issued version can be proven later. */
async function issueCommitmentReport(db, ctx, actor, vendorId, serviceId, asOf) {
  const rep = commitments.build(db, vendorId, serviceId, asOf);
  const generatedAt = nowIso();
  const html = templates.commitmentReport({ rep, generatedAt, generatedBy: actor.full_name });
  const raw = await ctx.renderPdf(html);
  const sealed = await seal(raw, {
    title: `Service Commitment Report ${rep.service.service_code} / ${rep.vendor.vendor_code}`,
    subject: `${rep.vendor.legal_name} - ${rep.service.service_name}`,
    keywords: ['BOP', 'VMS-SLA', 'commitments', rep.service.service_code, rep.vendor.vendor_code],
  });
  const stamp = generatedAt.replace(/[-:]/g, '').slice(0, 15);
  const stored = store(ctx, `COMMIT_${rep.vendor.vendor_code}_${rep.service.service_code}_${stamp}.pdf`, sealed);
  const { lastId } = db.run(
    `INSERT INTO report_document (report_id, doc_type, revision, title, file_ref, sha256, size_bytes, is_locked, encrypted, generated_by, generated_at)
     VALUES (NULL, 'COMMITMENT', NULL, ?, ?, ?, ?, 1, 1, ?, ?)`,
    [`Service commitments ${rep.vendor.legal_name} / ${rep.service.service_name} as of ${rep.asOf}`, stored.file_ref, stored.sha256, stored.size_bytes, actor.user_id, generatedAt],
  );
  audit.record(db, actor, 'COMMITMENT_REPORT_ISSUED', 'report_document', lastId, { details: { vendorId, serviceId, asOf: rep.asOf, sha256: stored.sha256 } });
  return { documentId: lastId, ...stored };
}

function docPath(ctx, doc) {
  const abs = path.resolve(ctx.paths.documents, doc.file_ref);
  if (!abs.startsWith(path.resolve(ctx.paths.documents))) throw new AppError('Invalid document path.', 'VALIDATION');
  return abs;
}

function list(db) {
  return db.all(`SELECT d.*, u.full_name AS generated_by_name, r.report_no FROM report_document d
                   LEFT JOIN app_user u ON u.user_id = d.generated_by LEFT JOIN incident_report r ON r.report_id = d.report_id
                  ORDER BY d.document_id DESC`);
}

function verify(db, ctx, documentId) {
  const d = db.get('SELECT * FROM report_document WHERE document_id = ?', [documentId]);
  if (!d) throw new AppError('Document not found.', 'NOT_FOUND');
  const p = docPath(ctx, d);
  if (!fs.existsSync(p)) return { ok: false, reason: 'The file is missing from the document store.', document: d };
  const actual = sha256(fs.readFileSync(p));
  const result = { ok: actual === d.sha256, expected: d.sha256, actual, document: d };
  if (!result.ok) result.reason = 'The file has been altered: its SHA-256 does not match the register.';
  if (d.report_id) result.signatures = approvals.verifySignatures(db, d.report_id);
  if (result.signatures && !result.signatures.ok) { result.ok = false; result.reason = result.reason || 'One or more signatures failed verification.'; }
  return result;
}

/** Verify an arbitrary PDF (e.g. one received by email) against the register. */
function verifyBytes(db, bytes) {
  const hash = sha256(bytes);
  const d = db.get('SELECT d.*, r.report_no FROM report_document d LEFT JOIN incident_report r ON r.report_id = d.report_id WHERE d.sha256 = ?', [hash]);
  return d ? { ok: true, sha256: hash, document: d } : { ok: false, sha256: hash, reason: 'This file does not match any sealed document in the register. It is not an authentic copy.' };
}

function read(db, ctx, actor, documentId) {
  const d = db.get('SELECT * FROM report_document WHERE document_id = ?', [documentId]);
  if (!d) throw new AppError('Document not found.', 'NOT_FOUND');
  const buf = fs.readFileSync(docPath(ctx, d));
  audit.record(db, actor, 'DOCUMENT_VIEWED', 'report_document', documentId);
  return { ...d, intact: sha256(buf) === d.sha256, dataBase64: buf.toString('base64'), fileName: path.basename(d.file_ref) };
}

module.exports = { seal, finalizeIncident, previewIncident, issueCommitmentReport, list, verify, verifyBytes, read, docPath };
