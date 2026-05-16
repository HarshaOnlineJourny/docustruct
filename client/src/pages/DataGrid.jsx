import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import Empty from '../components/Empty.jsx';
import { IconGrid, IconDownload, IconCpu, IconEye, IconClose, IconTrash } from '../components/icons.jsx';
import PdfPagePreview, { COLORS } from '../components/PdfPagePreview.jsx';

function confidenceClass(c) {
  if (c == null) return 'low';
  if (c >= 0.75) return 'high';
  if (c >= 0.4) return 'mid';
  return 'low';
}

const PAGE_SIZE = 100;

// Filter state lives in the URL query string so reloads / shared links keep
// the user's view. The server returns paginated records + a total count so
// we can show "rows X-Y of N".
export default function DataGrid() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [templates, setTemplates] = useState([]);
  const [tplFields, setTplFields] = useState([]); // selected template's fields, ordered
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [propagation, setPropagation] = useState(null);
  const [sourceFor, setSourceFor] = useState(null);
  const [sourceData, setSourceData] = useState(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [highlightedField, setHighlightedField] = useState(null);
  const pdfRef = useRef(null);
  const [learning, setLearning] = useState(null); // { sample_id, document_id, template_id, mappings_added, other_documents }
  const [reextractBusy, setReextractBusy] = useState(false);
  const editingSavedRef = useRef(false);
  const toast = useToast();
  const confirm = useConfirm();
  // Selected record ids for bulk delete. Cleared whenever the filter or
  // page changes so the user can't accidentally delete rows they no longer see.
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // --- URL ↔ state plumbing --------------------------------------------------
  const filter = {
    template_id: searchParams.get('template') || '',
    organization: searchParams.get('org') || '',
    year: searchParams.get('year') || '',
    status: searchParams.get('status') || '',
    from_date: searchParams.get('from') || '',
    to_date: searchParams.get('to') || '',
    q: searchParams.get('q') || '',
    has_ai: searchParams.get('ai') === '1',
    offset: Number(searchParams.get('offset') || 0),
  };
  function setFilter(patch) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      // shorthand keys map back to short query names
      const queryKey = ({
        template_id: 'template', organization: 'org',
        from_date: 'from', to_date: 'to',
      })[k] || k;
      if (k === 'has_ai') {
        if (v) next.set('ai', '1'); else next.delete('ai');
      } else if (v == null || v === '' || v === false) {
        next.delete(queryKey);
      } else {
        next.set(queryKey, String(v));
      }
    }
    // reset offset on filter change unless explicit
    if (!('offset' in patch)) next.delete('offset');
    setSearchParams(next, { replace: true });
  }

  useEffect(() => { api.get('/templates').then(setTemplates); }, []);

  // Hydrate selected template's full field list (ordered + canonical column order).
  useEffect(() => {
    if (!filter.template_id) { setTplFields([]); return; }
    api.get('/templates/' + filter.template_id)
      .then((t) => setTplFields(t.fields || []))
      .catch(() => setTplFields([]));
  }, [filter.template_id]);

  function load() {
    setLoading(true);
    const q = new URLSearchParams();
    if (filter.template_id) q.set('template_id', filter.template_id);
    if (filter.organization) q.set('organization', filter.organization);
    if (filter.year) q.set('year', filter.year);
    if (filter.status) q.set('status', filter.status);
    if (filter.from_date) q.set('from_date', filter.from_date);
    if (filter.to_date) q.set('to_date', filter.to_date);
    if (filter.q) q.set('q', filter.q);
    if (filter.has_ai) q.set('has_ai', '1');
    q.set('limit', PAGE_SIZE);
    q.set('offset', filter.offset);
    api.get('/data/records?' + q.toString())
      .then(setResponse)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }
  // Re-load when the URL filter signature changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [searchParams.toString()]);

  const records = response?.records || [];
  const total = response?.total ?? 0;

  // Clear selection whenever the visible record set changes.
  useEffect(() => { setSelectedIds(new Set()); }, [response]);

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (prev.size === records.length) return new Set();
      return new Set(records.map((r) => r.id));
    });
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    const n = selectedIds.size;
    const ok = await confirm({
      title: `Delete ${n} record${n === 1 ? '' : 's'}?`,
      message: `This permanently removes ${n} row${n === 1 ? '' : 's'} and any corrections on them. The source PDFs and template stay intact.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.post('/data/records/delete', { ids: [...selectedIds] });
      toast.success(`Deleted ${r.deleted} record${r.deleted === 1 ? '' : 's'}`);
      setSelectedIds(new Set());
      load();
    } catch (e) { toast.error(e.message); }
  }

  // Field columns: prefer the selected template's order; fall back to the
  // union of names across visible records when "All templates" is selected.
  const fieldNames = useMemo(() => {
    if (tplFields.length > 0) return tplFields.map((f) => f.name);
    const set = new Set();
    for (const r of records) for (const k of Object.keys(r.values)) set.add(k);
    return [...set];
  }, [tplFields, records]);

  async function saveCorrection(record, fieldName, newValue) {
    if (editingSavedRef.current) return; // guard against onBlur+Enter double-fire
    editingSavedRef.current = true;
    try {
      const tpl = await api.get('/templates/' + record.template_id);
      const field = tpl.fields.find((f) => f.name === fieldName);
      if (!field) return;
      await api.post('/data/corrections', {
        record_id: record.id,
        field_id: field.id,
        new_value: newValue,
      });
      setEditing(null);
      // Look for other records in this batch where the same fix probably
      // applies. If we find any, surface a one-click "Apply to N more".
      const prop = await api.post('/data/corrections/propose-propagation', {
        record_id: record.id,
        field_id: field.id,
        new_value: newValue,
      });
      load();
      if (prop?.candidates?.length > 0) {
        const n = prop.candidates.length;
        setPropagation({ field_id: field.id, new_value: newValue, candidates: prop.candidates, field_label: field.label });
      } else {
        toast.success('Correction saved');
      }
      // Also try to teach the engine: if we can locate this value in the
      // canonical column / token layout of the source row, save a new
      // training sample so future imports inherit the learning.
      try {
        const learn = await api.post('/data/corrections/learn', { record_id: record.id });
        if (learn?.ok) {
          setLearning({ ...learn, original_name: record.original_name });
        }
      } catch (_) { /* learning is best-effort */ }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setTimeout(() => { editingSavedRef.current = false; }, 0);
    }
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

  // Close drawer on Esc.
  useEffect(() => {
    if (!sourceFor) return;
    function onKey(e) { if (e.key === 'Escape') setSourceFor(null); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sourceFor]);

  const focusBox = useCallback((box) => {
    if (!box) return;
    setHighlightedField(box.field_id);
    pdfRef.current?.goToBox(box);
  }, []);

  async function openSource(record) {
    setSourceFor(record);
    setSourceData(null);
    setSourceLoading(true);
    try {
      const r = await api.get('/data/records/' + record.id + '/source');
      setSourceData(r);
    } catch (e) {
      toast.error(e.message);
      setSourceFor(null);
    } finally {
      setSourceLoading(false);
    }
  }

  function exportCsv() {
    const q = new URLSearchParams();
    if (filter.template_id) q.set('template_id', filter.template_id);
    if (filter.organization) q.set('organization', filter.organization);
    if (filter.year) q.set('year', filter.year);
    window.location.href = '/api/data/export.csv?' + q.toString();
  }

  const pageStart = total === 0 ? 0 : filter.offset + 1;
  const pageEnd = Math.min(filter.offset + records.length, total);

  return (
    <>
      <div className="page-header">
        <div className="page-title-block">
          <h1>Data Grid</h1>
          <div className="page-subtitle">
            Records across every PDF you've imported. Click a cell to correct it. AI-extracted cells show an
            <span className="tag tag-info" style={{ marginLeft: 6, fontSize: 11 }}><IconCpu size={10} /> ai</span> tag.
          </div>
        </div>
        <div className="toolbar">
          {selectedIds.size > 0 && (
            <button className="btn btn-danger" onClick={deleteSelected}>
              <IconTrash size={14} /> Delete {selectedIds.size} selected
            </button>
          )}
          <button className="btn btn-secondary" onClick={exportCsv} disabled={records.length === 0}>
            <IconDownload size={14} /> Export CSV
          </button>
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
          <button className="btn btn-secondary btn-sm" disabled={reextractBusy}
                  onClick={() => reextract('doc')}>
            Re-extract this file
          </button>
          <button className="btn btn-primary btn-sm" disabled={reextractBusy}
                  onClick={() => reextract('all')}>
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
            <details style={{ marginTop: 4, fontSize: 12 }}>
              <summary className="muted" style={{ cursor: 'pointer' }}>Show matching rows</summary>
              <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                {propagation.candidates.slice(0, 10).map((c) => (
                  <li key={c.record_id} style={{ marginBottom: 2 }}>
                    Row {c.row_index} — currently <code>{c.current_value ?? '—'}</code>
                    <span className="muted"> · {c.source_text_excerpt}</span>
                  </li>
                ))}
                {propagation.candidates.length > 10 && (
                  <li className="muted">… and {propagation.candidates.length - 10} more</li>
                )}
              </ul>
            </details>
          </div>
          <button className="btn btn-primary btn-sm" onClick={applyPropagation}>
            Apply to {propagation.candidates.length}
          </button>
          <button className="btn btn-ghost btn-icon" onClick={() => setPropagation(null)} aria-label="dismiss">×</button>
        </div>
      )}
      <div className="card">
        <div className="toolbar">
          <select className="input input-inline" value={filter.template_id}
                  onChange={(e) => setFilter({ template_id: e.target.value })}>
            <option value="">All templates</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input className="input input-inline" placeholder="Search any cell value or filename"
                 style={{ minWidth: 240 }}
                 value={filter.q} onChange={(e) => setFilter({ q: e.target.value })} />
          <input className="input input-inline" placeholder="Organization"
                 value={filter.organization} onChange={(e) => setFilter({ organization: e.target.value })} />
          <input className="input input-inline" placeholder="Year" type="number" style={{ minWidth: 110 }}
                 value={filter.year} onChange={(e) => setFilter({ year: e.target.value })} />
          <select className="input input-inline" value={filter.status}
                  onChange={(e) => setFilter({ status: e.target.value })}>
            <option value="">Any status</option>
            <option value="done">Done</option>
            <option value="needs_ocr">Needs OCR</option>
            <option value="failed">Failed</option>
          </select>
          <input className="input input-inline" type="date" style={{ minWidth: 160 }}
                 value={filter.from_date} onChange={(e) => setFilter({ from_date: e.target.value })} />
          <input className="input input-inline" type="date" style={{ minWidth: 160 }}
                 value={filter.to_date} onChange={(e) => setFilter({ to_date: e.target.value })} />
          <label className="row-tight" style={{ fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={filter.has_ai}
                   onChange={(e) => setFilter({ has_ai: e.target.checked })} />
            <span>AI-escalated only</span>
          </label>
          <button className="btn btn-ghost btn-sm right" onClick={() => setSearchParams({}, { replace: true })}
                  disabled={Object.values(filter).every((v) => !v && v !== 0)}>
            Reset
          </button>
        </div>
      </div>

      <div className="card card-pad-0">
        <div className="card-header" style={{ padding: '10px 16px' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {loading ? 'Loading…' :
              total === 0 ? 'No records' : `Showing ${pageStart}–${pageEnd} of ${total}`}
          </span>
          <div className="toolbar">
            <button className="btn btn-secondary btn-sm"
                    disabled={filter.offset === 0 || loading}
                    onClick={() => setFilter({ offset: Math.max(0, filter.offset - PAGE_SIZE) })}>
              ← Prev
            </button>
            <button className="btn btn-secondary btn-sm"
                    disabled={pageEnd >= total || loading}
                    onClick={() => setFilter({ offset: filter.offset + PAGE_SIZE })}>
              Next →
            </button>
          </div>
        </div>

        {records.length === 0 && !loading ? (
          <Empty
            icon={<IconGrid size={28} />}
            title={templates.length === 0 ? 'No templates yet' : 'No records match these filters'}
            message={templates.length === 0
              ? 'Create a template, train it on a sample, then import PDFs to see records here.'
              : 'Reset the filters or import more PDFs.'}
          />
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0, maxHeight: '70vh' }}>
            <table className="table table-compact">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      checked={records.length > 0 && selectedIds.size === records.length}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < records.length;
                      }}
                      onChange={toggleSelectAll}
                      title={selectedIds.size === records.length ? 'Deselect all' : 'Select all on this page'}
                    />
                  </th>
                  <th></th>
                  <th>Document</th><th>Template</th><th>Row</th>
                  {fieldNames.map((n) => <th key={n}>{n}</th>)}
                  <th>Conf</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} style={selectedIds.has(r.id) ? { background: 'rgba(79,70,229,0.06)' } : null}>
                    <td>
                      <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} />
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-icon" title="View source PDF"
                              onClick={() => openSource(r)}>
                        <IconEye size={14} />
                      </button>
                    </td>
                    <td className="muted">{r.original_name}</td>
                    <td className="muted">{r.template_name}</td>
                    <td className="muted">{r.row_index}</td>
                    {fieldNames.map((n) => {
                      const cell = r.values[n];
                      const isEditing = editing && editing.record_id === r.id && editing.field_name === n;
                      return (
                        <td key={n}
                            onClick={() => setEditing({ record_id: r.id, field_name: n, value: cell?.value ?? '' })}>
                          {isEditing ? (
                            <input
                              className="input input-sm"
                              autoFocus defaultValue={cell?.value ?? ''}
                              onBlur={(e) => saveCorrection(r, n, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveCorrection(r, n, e.currentTarget.value);
                                if (e.key === 'Escape') setEditing(null);
                              }}
                            />
                          ) : (
                            <span title={cell?.source ? `source: ${cell.source}` : ''}>
                              {cell?.value ?? '—'}
                              {cell?.source === 'ai' && (
                                <span className="tag tag-info" style={{ fontSize: 10, marginLeft: 6 }}>
                                  ai
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className={'confidence ' + confidenceClass(r.confidence)}>
                      {r.confidence != null ? Math.round(r.confidence * 100) + '%' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {sourceFor && (
        <div className="drawer-backdrop" onClick={() => setSourceFor(null)}>
          <aside className="drawer drawer-wide" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <button className="btn btn-ghost btn-sm" onClick={() => setSourceFor(null)}>
                ← Back
              </button>
              <div style={{ flex: 1, marginLeft: 12 }}>
                <h3 style={{ marginBottom: 2 }}>{sourceFor.original_name}</h3>
                <div className="muted" style={{ fontSize: 12 }}>
                  {sourceFor.template_name} · row {sourceFor.row_index}
                  {sourceData?.boxes?.length > 0 && ` · ${sourceData.boxes.length} field${sourceData.boxes.length === 1 ? '' : 's'} located`}
                </div>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => setSourceFor(null)} aria-label="close">
                <IconClose size={18} />
              </button>
            </div>

            <div className="drawer-split">
              {/* LEFT: field/value cards */}
              <div className="drawer-side">
                <div className="drawer-side-head">
                  <h4 style={{ margin: 0 }}>Extracted fields</h4>
                  <span className="muted" style={{ fontSize: 12 }}>click to locate</span>
                </div>
                <div className="drawer-side-body">
                  {sourceLoading && <div className="muted" style={{ padding: 12 }}>Loading…</div>}
                  {sourceData?.warning && (
                    <div className="banner banner-warning" style={{ margin: 12 }}>
                      {sourceData.warning}
                    </div>
                  )}
                  {sourceData?.boxes?.length === 0 && !sourceData?.warning && (
                    <div className="muted" style={{ padding: 12, fontSize: 12 }}>
                      No fields located on this page.
                    </div>
                  )}
                  {sourceData?.boxes?.map((b, i) => {
                    const color = COLORS[(b.field_id ?? i) % COLORS.length];
                    const isActive = highlightedField === b.field_id;
                    return (
                      <button
                        key={b.field_name}
                        onClick={() => focusBox({ ...b, color })}
                        className="field-card"
                        style={{
                          borderLeftColor: color,
                          background: isActive ? 'var(--color-primary-soft)' : 'transparent',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{
                            width: 10, height: 10, borderRadius: 2, background: color, flex: 'none',
                          }} />
                          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.04, color: 'var(--color-text-muted)' }}>
                            {b.field_label || b.field_name}
                          </span>
                        </div>
                        <div style={{
                          marginTop: 4, fontSize: 13, fontFamily: 'var(--font-mono)',
                          wordBreak: 'break-word',
                          color: b.value ? 'var(--color-text)' : 'var(--color-text-soft)',
                        }}>
                          {b.value ?? '—'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* RIGHT: PDF viewer */}
              <div className="drawer-main">
                {sourceData && !sourceData.warning && (
                  <PdfPagePreview
                    ref={pdfRef}
                    fileUrl={sourceData.file_url}
                    initialPage={sourceData.page}
                    boxes={(sourceData.boxes || []).map((b) => ({ ...b, page: sourceData.page }))}
                    highlightedFieldId={highlightedField}
                    onBoxClick={(b) => setHighlightedField(b.field_id)}
                  />
                )}
                {sourceLoading && <div className="muted" style={{ padding: 24 }}>Loading source page…</div>}
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
