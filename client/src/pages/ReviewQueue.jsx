import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import Empty from '../components/Empty.jsx';
import { IconAlert, IconCheck, IconActivity } from '../components/icons.jsx';

// Records that have at least one cell below the confidence threshold.
// Triage them inline — every correction strengthens the per-field counters.
export default function ReviewQueue() {
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [threshold, setThreshold] = useState(0.7);
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [propagation, setPropagation] = useState(null);
  const [learning, setLearning] = useState(null);
  const [reextractBusy, setReextractBusy] = useState(false);
  const toast = useToast();

  function load() {
    const q = new URLSearchParams();
    q.set('threshold', threshold);
    if (templateId) q.set('template_id', templateId);
    api.get('/data/review-queue?' + q.toString()).then(setData).catch((e) => toast.error(e.message));
  }
  useEffect(() => { api.get('/templates').then(setTemplates); load(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [templateId, threshold]);

  async function saveCorrection(record, fieldName, newValue) {
    try {
      const tpl = await api.get('/templates/' + record.template_id);
      const field = tpl.fields.find((f) => f.name === fieldName);
      if (!field) return;
      await api.post('/data/corrections', {
        record_id: record.id,
        field_id: field.id,
        new_value: newValue,
      });
      const prop = await api.post('/data/corrections/propose-propagation', {
        record_id: record.id,
        field_id: field.id,
        new_value: newValue,
      });
      setEditing(null);
      load();
      if (prop?.candidates?.length > 0) {
        setPropagation({ field_id: field.id, new_value: newValue, candidates: prop.candidates, field_label: field.label });
      } else {
        toast.success('Correction saved');
      }
      try {
        const learn = await api.post('/data/corrections/learn', { record_id: record.id });
        if (learn?.ok) setLearning({ ...learn, original_name: record.original_name });
      } catch (_) {}
    } catch (e) { toast.error(e.message); }
  }

  async function reextract(scope) {
    if (!learning) return;
    setReextractBusy(true);
    try {
      if (scope === 'doc') {
        const r = await api.post('/imports/documents/' + learning.document_id + '/reextract', {});
        toast.success(`Re-extracted this file (${r.records} records, ${r.manuals_preserved} manual corrections preserved).`);
      } else if (scope === 'all') {
        const r = await api.post('/imports/templates/' + learning.template_id + '/reextract', {});
        toast.success(`Re-extracted ${r.documents_reextracted} files, ${r.records_total} records (${r.manuals_preserved} manual corrections preserved).`);
      }
      setLearning(null);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setReextractBusy(false); }
  }

  async function applyPropagation() {
    if (!propagation) return;
    try {
      const r = await api.post('/data/corrections/batch-apply', {
        record_ids: propagation.candidates.map((c) => c.record_id),
        field_id: propagation.field_id,
        new_value: propagation.new_value,
      });
      toast.success(`Applied to ${r.applied} record${r.applied === 1 ? '' : 's'}`);
      setPropagation(null);
      load();
    } catch (e) { toast.error(e.message); }
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title-block">
          <h1>Review Queue</h1>
          <div className="page-subtitle">
            Records with at least one cell below confidence threshold. Click a low-confidence
            cell to correct it — every correction strengthens the field's accuracy stats.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <select className="input input-inline" value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">All templates</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <label className="muted" style={{ fontSize: 12 }}>Threshold</label>
          <input className="input input-inline" type="number" step="0.05" min="0" max="1"
                 style={{ minWidth: 90 }}
                 value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          <span className="muted" style={{ fontSize: 12 }}>
            {data ? `${data.total} records flagged` : 'Loading…'}
          </span>
        </div>
      </div>

      {learning && (
        <div className="banner banner-success">
          <div style={{ flex: 1 }}>
            <strong>Training updated.</strong> The engine now knows the canonical position of this value
            ({learning.mappings_added} field{learning.mappings_added === 1 ? '' : 's'} located).
            Future imports inherit this automatically.
            <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
              Should existing records be re-extracted with the updated training?
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" disabled={reextractBusy} onClick={() => reextract('doc')}>
            Re-extract this file
          </button>
          <button className="btn btn-primary btn-sm" disabled={reextractBusy} onClick={() => reextract('all')}>
            Re-extract all {learning.other_documents + 1} file{learning.other_documents === 0 ? '' : 's'}
          </button>
          <button className="btn btn-ghost btn-icon" onClick={() => setLearning(null)} aria-label="dismiss">×</button>
        </div>
      )}
      {propagation && (
        <div className="banner banner-info">
          <div style={{ flex: 1 }}>
            <strong>{propagation.candidates.length} other record{propagation.candidates.length === 1 ? '' : 's'}</strong> in this batch
            mention <code>{propagation.new_value}</code> in their source row but currently show a different value
            for <strong>{propagation.field_label}</strong>. Apply this correction to all of them?
          </div>
          <button className="btn btn-primary btn-sm" onClick={applyPropagation}>
            Apply to {propagation.candidates.length}
          </button>
          <button className="btn btn-ghost btn-icon" onClick={() => setPropagation(null)} aria-label="dismiss">×</button>
        </div>
      )}
      {!data || data.items.length === 0 ? (
        <Empty
          icon={<IconCheck size={28} />}
          title={data ? 'Nothing to review' : 'Loading…'}
          message={data ? 'All records meet the confidence threshold. Lower it or import more PDFs.' : null}
        />
      ) : (
        <div className="card card-pad-0">
          <div className="card-header">
            <h3>{data.total} records below {Math.round(data.threshold * 100)}% confidence</h3>
          </div>
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0, maxHeight: '70vh' }}>
            <table className="table table-compact">
              <thead>
                <tr>
                  <th></th>
                  <th>Document</th>
                  <th>Template</th>
                  <th>Row</th>
                  <th>Low-confidence fields</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td><IconAlert size={14} className="muted" /></td>
                    <td className="muted">{r.original_name}</td>
                    <td className="muted">{r.template_name}</td>
                    <td className="muted">{r.row_index}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {r.low_confidence_fields.map((f) => {
                          const isEditing = editing && editing.record_id === r.id && editing.field_name === f.field_name;
                          return (
                            <div key={f.field_name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className="tag tag-warning" style={{ minWidth: 90 }}>
                                {f.field_name}
                              </span>
                              {isEditing ? (
                                <input
                                  className="input input-sm"
                                  autoFocus defaultValue={f.value ?? ''}
                                  onBlur={(e) => saveCorrection(r, f.field_name, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveCorrection(r, f.field_name, e.currentTarget.value);
                                    if (e.key === 'Escape') setEditing(null);
                                  }}
                                  style={{ flex: 1 }}
                                />
                              ) : (
                                <span style={{ flex: 1, cursor: 'pointer' }}
                                      onClick={() => setEditing({ record_id: r.id, field_name: f.field_name })}>
                                  {f.value ?? '—'}
                                </span>
                              )}
                              <span className={'confidence ' + (f.confidence >= 0.4 ? 'mid' : 'low')} style={{ fontSize: 11 }}>
                                {Math.round((f.confidence ?? 0) * 100)}%
                              </span>
                              {f.source === 'ai' && <span className="tag tag-info" style={{ fontSize: 10 }}>ai</span>}
                            </div>
                          );
                        })}
                      </div>
                    </td>
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
