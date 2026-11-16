// Register of sealed PDFs, with integrity verification.
import { call } from '../api.js';
import { esc, table, fmtDT, guard, showPdf, modal, fileToBase64, toast } from '../ui.js';

export async function render(root, _p, nav) {
  const docs = await call('documents.list');
  if (!nav.isCurrent()) return;
  root.innerHTML = `<div class="page-head"><div class="titles"><h1>Sealed documents</h1>
    <div class="sub">Every finalised incident report and issued commitment report, with the SHA-256 registered when it was sealed. A copy whose hash differs is not authentic.</div></div>
    <div class="actions"><button class="btn primary" id="check">Check a PDF someone sent you</button></div></div>
    <div id="result"></div>
    ${table([
    { label: 'Document', render: (d) => `<b>${esc(d.title)}</b>${d.report_no ? `<div class="small"><a href="#/incidents/${d.report_id}">${esc(d.report_no)}</a></div>` : ''}` },
    { label: 'Type', render: (d) => (d.doc_type === 'INCIDENT_FINAL' ? 'Finalised incident report' : 'Service commitments') },
    { label: 'Sealed', render: (d) => `${fmtDT(d.generated_at)}<div class="small muted">${esc(d.generated_by_name)}</div>` },
    { label: 'SHA-256', render: (d) => `<span class="mono">${esc(d.sha256)}</span>` },
    { label: '', cls: 'row-actions', render: (d) => `<button class="btn ghost sm" data-open="${d.document_id}">Open</button><button class="btn ghost sm" data-verify="${d.document_id}">Verify</button>` },
  ], docs, { empty: 'No sealed documents yet. They are produced when you finalise an incident report or issue a commitment report.' })}`;
  const result = root.querySelector('#result');
  root.addEventListener('click', async (e) => {
    const o = e.target.closest('[data-open]');
    const v = e.target.closest('[data-verify]');
    if (o) {
      const f = await guard(() => call('documents.read', { id: Number(o.dataset.open) }));
      if (!f.intact) toast('Warning: the stored file does not match its registered hash.', 'bad');
      await showPdf(f.dataBase64, f.fileName);
    }
    if (v) {
      const r = await guard(() => call('documents.verify', { id: Number(v.dataset.verify) }));
      result.innerHTML = r.ok
        ? `<div class="notice ok"><b>Authentic.</b> ${esc(r.document.title)}: the file matches its registered SHA-256${r.contentIntact ? ' and the report record still matches the finalised content' : ''}.</div>`
        : `<div class="notice bad"><b>Not authentic.</b> ${esc(r.reason)}</div>`;
    }
  });
  root.querySelector('#check').onclick = () => modal({
    title: 'Check a PDF',
    intro: 'The file is hashed locally and compared with the register. It is not stored.',
    body: '<label class="field"><span class="req">PDF file</span><input type="file" name="file" accept="application/pdf" required></label>',
    submitLabel: 'Check',
    onSubmit: async (form) => {
      const file = form.file.files[0];
      if (!file) throw new Error('Choose a file.');
      const r = await call('documents.verifyFile', { dataBase64: await fileToBase64(file) });
      result.innerHTML = r.ok
        ? `<div class="notice ok"><b>Authentic copy</b> of "${esc(r.document.title)}", sealed ${fmtDT(r.document.generated_at)}.</div>`
        : `<div class="notice bad"><b>Not authentic.</b> ${esc(r.reason)}<div class="mono small">${esc(r.sha256)}</div></div>`;
      return true;
    },
  });
}
