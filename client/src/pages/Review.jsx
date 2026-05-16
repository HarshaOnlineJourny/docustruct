import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import Empty from '../components/Empty.jsx';
import { IconEye, IconUpload } from '../components/icons.jsx';

function confidenceClass(c) {
  if (c == null) return 'low';
  if (c >= 0.75) return 'high';
  if (c >= 0.4) return 'mid';
  return 'low';
}

export default function Review() {
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [aiVision, setAiVision] = useState(false);
  const fileRef = useRef(null);
  const toast = useToast();

  useEffect(() => { api.get('/templates').then(setTemplates); }, []);

  // When the selected template uses AI vision, the checkbox is forced on —
  // the deterministic engine has no training mappings for these templates
  // and would return 0 records. Toggling it off has no effect.
  const selectedTemplate = templates.find((t) => t.id === templateId) || null;
  const isAITemplate = selectedTemplate?.extraction_strategy === 'ai_vision';
  useEffect(() => { if (isAITemplate) setAiVision(true); }, [isAITemplate]);

  async function runPreview(e) {
    e.preventDefault();
    const file = fileRef.current.files[0];
    if (!file || !templateId) return;
    setBusy(true); setPreview(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const url = `/extraction/${templateId}/preview` + (aiVision ? '?ai_vision=1' : '');
      const result = await api.upload(url, fd);
      setPreview(result);
      toast.success(`Extracted ${result.extraction.records.length} records${aiVision ? ' (AI vision)' : ''}`);
    } catch (err) {
      toast.error(err.message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title-block">
          <h1>Review</h1>
          <div className="page-subtitle">
            Test extraction on a single PDF before running it across a batch.
          </div>
        </div>
      </div>

      <div className="card">
        <form onSubmit={runPreview} className="toolbar">
          <select className="input input-inline" value={templateId || ''}
                  onChange={(e) => setTemplateId(Number(e.target.value))}>
            <option value="">Select template…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input type="file" accept="application/pdf" ref={fileRef} className="input input-inline" />
          <label className="row-tight" style={{ fontSize: 12, cursor: isAITemplate ? 'default' : 'pointer', opacity: isAITemplate ? 0.7 : 1 }}>
            <input type="checkbox"
                   checked={aiVision || isAITemplate}
                   disabled={isAITemplate}
                   onChange={(e) => setAiVision(e.target.checked)} />
            <span>AI vision {isAITemplate ? '(required — this is an AI template)' : '(handles scanned / multi-line PDFs)'}</span>
          </label>
          <button className="btn btn-primary" type="submit" disabled={!templateId || busy}>
            <IconEye size={14} /> {busy ? 'Extracting…' : 'Run preview'}
          </button>
        </form>
      </div>

      {!preview && !busy && (
        <Empty
          icon={<IconUpload size={28} />}
          title="No preview yet"
          message="Pick a trained template, upload one PDF, and review the extracted rows. No data is saved at this stage."
        />
      )}

      {preview && (
        <div className="card card-pad-0">
          <div className="card-header">
            <div>
              <h3>{preview.file?.name}</h3>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                Mode <code>{preview.extraction.mode}</code> · {preview.extraction.records.length} records
              </div>
            </div>
            <div className="toolbar">
              {preview.extraction.warnings?.map((w, i) => (
                <span key={i} className="tag tag-warning">{w}</span>
              ))}
            </div>
          </div>
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>#</th>
                  {preview.template.fields.map((f) => <th key={f.id}>{f.label}</th>)}
                  <th>Conf</th>
                </tr>
              </thead>
              <tbody>
                {preview.extraction.records.map((r, i) => (
                  <tr key={i}>
                    <td className="muted">{i + 1}</td>
                    {preview.template.fields.map((f) => {
                      const cell = r.values?.[f.name];
                      return (
                        <td key={f.id}>
                          <div>{cell?.value ?? '—'}</div>
                          {cell?.raw_text && cell.raw_text !== String(cell.value) && (
                            <div className="soft" style={{ fontSize: 10 }}>raw: {cell.raw_text}</div>
                          )}
                        </td>
                      );
                    })}
                    <td className={'confidence ' + confidenceClass(r.confidence)}>
                      {r.confidence != null ? Math.round(r.confidence * 100) + '%' : '—'}
                    </td>
                  </tr>
                ))}
                {preview.extraction.records.length === 0 && (
                  <tr><td colSpan={preview.template.fields.length + 2} className="muted">
                    No records extracted. Train more fields or check the warnings.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
