import { useEffect, useRef, useState } from 'react';
import { api, uploadUrl } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import Empty from '../components/Empty.jsx';
import { IconUpload, IconFile, IconCpu } from '../components/icons.jsx';

// Lower-level upload that lets us read the JSON body on non-2xx responses.
// We need it because a 402 from the import route carries diagnostic info
// (which files would need AI, estimated cost) that we surface in a confirm
// dialog before re-submitting with ai_confirmed=1.
async function uploadWithBody(path, fd) {
  const res = await fetch(uploadUrl(path), { method: 'POST', body: fd });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json().catch(() => ({})) : await res.text();
  return { ok: res.ok, status: res.status, body };
}

export default function Import() {
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [aiVision, setAiVision] = useState(false);
  const [result, setResult] = useState(null);
  const filesRef = useRef(null);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => { api.get('/templates').then(setTemplates); }, []);

  // Build the multipart body. Reused for the initial call and the
  // "ai_confirmed=1" retry so the same File objects are sent in both.
  function buildFormData(files) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return fd;
  }

  async function submit(e) {
    e.preventDefault();
    const fileList = filesRef.current.files;
    if (!templateId || !fileList.length) return;
    setBusy(true); setResult(null);
    try {
      const baseUrl = `/imports/${templateId}` + (aiVision ? '?ai_vision=1' : '');
      let r = await uploadWithBody(baseUrl, buildFormData(fileList));
      // 402 = AI needed and not confirmed. Show a confirm dialog with the
      // details the server gave us, then re-submit if the user agrees.
      if (r.status === 402 && r.body?.requires_ai) {
        const cost = Number(r.body.estimated_cost_usd || 0).toFixed(2);
        const needs = r.body.files_needing_ai || [];
        const freeOnes = r.body.files_free || [];
        const ok = await confirm({
          title: 'AI extraction needed',
          message: (
            <>
              <div style={{ marginBottom: 8 }}>
                Learned patterns couldn't extract <strong>{needs.length}</strong> of your file{needs.length === 1 ? '' : 's'} for free.
                AI vision is required — estimated cost <strong>${cost}</strong>.
              </div>
              {freeOnes.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--color-text-soft)' }}>
                  ✓ Free (patterns/deterministic): {freeOnes.join(', ')}
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--color-text-soft)', marginTop: 4 }}>
                💰 Need AI: {needs.join(', ')}
              </div>
              <div style={{ fontSize: 12, marginTop: 8 }}>
                After this run, the AI's updated patterns will be saved so similar future PDFs run free.
              </div>
            </>
          ),
          confirmLabel: `Proceed (~$${cost})`,
        });
        if (!ok) { setBusy(false); return; }
        const retryUrl = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'ai_confirmed=1';
        r = await uploadWithBody(retryUrl, buildFormData(fileList));
      }
      if (!r.ok) {
        const msg = (r.body && r.body.error) || `${r.status}`;
        throw new Error(msg);
      }
      setResult(r.body);
      const b = r.body;
      const patternsNote = b.patterns_updated ? ' · patterns updated' : '';
      toast.success(`Batch #${b.batch_id}: ${b.ok} ok, ${b.needs_ocr} need OCR, ${b.failed} failed${patternsNote}`);
    } catch (err) {
      toast.error(err.message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title-block">
          <h1>Bulk import</h1>
          <div className="page-subtitle">
            Upload many PDFs that share the same template. Each upload becomes one batch.
          </div>
        </div>
      </div>

      <div className="card">
        <form onSubmit={submit} className="toolbar">
          <select className="input input-inline" value={templateId || ''}
                  onChange={(e) => setTemplateId(Number(e.target.value))}>
            <option value="">Select template…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input type="file" multiple accept="application/pdf" ref={filesRef} className="input input-inline" />
          <label className="row-tight" style={{ fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={aiVision} onChange={(e) => setAiVision(e.target.checked)} />
            <span>AI vision (slower, costs per page)</span>
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy || !templateId}>
            <IconUpload size={14} /> {busy ? 'Importing…' : 'Import'}
          </button>
        </form>
      </div>

      {!result && !busy && (
        <Empty
          icon={<IconFile size={28} />}
          title="No batch yet"
          message="Choose a template and select one or more PDFs to import. Each will be processed against the template's training mappings."
        />
      )}

      {result && (
        <div className="card card-pad-0">
          <div className="card-header">
            <div>
              <h3>Batch #{result.batch_id}</h3>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                {result.ok} done · {result.needs_ocr} need OCR · {result.failed} failed
              </div>
            </div>
            <span className={'tag status-' + result.status}>{result.status}</span>
          </div>
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="table table-compact">
              <thead><tr><th>Document</th><th>Status</th></tr></thead>
              <tbody>
                {result.documents.map((d) => (
                  <tr key={d.id}>
                    <td>doc #{d.id}</td>
                    <td><span className={'tag status-' + d.status}>{d.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
