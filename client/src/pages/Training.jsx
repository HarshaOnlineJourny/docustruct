import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import Empty from '../components/Empty.jsx';
import {
  IconUpload, IconSpark, IconClose, IconAlert, IconInfo,
} from '../components/icons.jsx';

// --- Validation helpers ----------------------------------------------------
//
// Light front-end checks that nudge the user toward a clean training
// session. None of these are hard blocks — they raise warnings only.

const DATE_RE = /\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}/;
const NUMERIC_RE = /-?\$?\(?\d[\d,]*(?:\.\d+)?\)?%?/;

function validateValueForType(value, type) {
  if (!value) return null;
  if (type === 'date' && !DATE_RE.test(value)) {
    return `“${truncate(value, 30)}” doesn't look like a date.`;
  }
  if ((type === 'amount' || type === 'number') && !NUMERIC_RE.test(value)) {
    return `“${truncate(value, 30)}” doesn't look like a ${type}.`;
  }
  return null;
}

// Return a hint if the picked token count differs from what other data rows
// have in the same column. Useful to nudge users to extend a single-token
// selection to "LAST, FIRST" when the data is multi-token.
function consistencyHint(mapping, dataRows) {
  if (!mapping || mapping.column_index == null) return null;
  const tokenSpan = (mapping.token_end ?? 0) - (mapping.token_start ?? 0) + 1;
  const otherCounts = [];
  for (const r of dataRows) {
    if (r.lineIndex === mapping.line_index) continue;
    const cell = r.columns?.[mapping.column_index];
    const tokens = (cell?.text || '').split(/\s+/).filter(Boolean);
    if (tokens.length > 0) otherCounts.push(tokens.length);
    if (otherCounts.length >= 5) break;
  }
  if (otherCounts.length === 0) return null;
  const median = otherCounts.sort((a, b) => a - b)[Math.floor(otherCounts.length / 2)];
  if (median > tokenSpan) {
    return `Other rows have ${median} token${median === 1 ? '' : 's'} in this column — consider Shift+click to extend.`;
  }
  return null;
}

function preflightWarnings(template, mappings) {
  if (!template) return [];
  const warnings = [];
  const mappedFieldIds = new Set(Object.keys(mappings).map(Number));

  if (mappedFieldIds.size === 0) {
    warnings.push('Map at least one field before saving.');
    return warnings;
  }
  if (mappedFieldIds.size === 1) {
    warnings.push('Only one field is mapped. Row-mode extraction needs at least two trained fields on the same row.');
  }
  const primary = template.fields.find((f) => f.is_primary);
  if (primary && !mappedFieldIds.has(primary.id)) {
    warnings.push(`Primary field “${primary.label}” isn't mapped — block-mode extraction won't work.`);
  }
  // Type mismatches
  for (const f of template.fields) {
    const m = mappings[f.id];
    if (!m) continue;
    const issue = validateValueForType(m.selection_text, f.type);
    if (issue) warnings.push(`${f.label}: ${issue}`);
  }
  return warnings;
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Heuristic: when many "lines" on the page contain too many items, the PDF
// is using a non-standard text layout (BCBS-style hostile PDF). We surface
// a banner so the user knows OCR is the right path.
function detectHostile(sample) {
  if (!sample?.lines?.length) return false;
  const longLines = sample.lines.filter((l) => (l.columns?.length ?? 0) > 20).length;
  return longLines >= 3;
}

export default function Training() {
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState(null);
  const [template, setTemplate] = useState(null);
  const [sample, setSample] = useState(null);
  const [activeFieldId, setActiveFieldId] = useState(null);
  const [lastEditedFieldId, setLastEditedFieldId] = useState(null);
  const [mappings, setMappings] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [tab, setTab] = useState('rows');
  const fileRef = useRef(null);
  const toast = useToast();
  const confirmDialog = useConfirm();

  const [searchParams] = useSearchParams();

  useEffect(() => {
    api.get('/templates').then((list) => {
      setTemplates(list);
      const requested = Number(searchParams.get('template'));
      if (requested && list.some((t) => t.id === requested)) {
        setTemplateId(requested);
        loadTemplate(requested);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function loadTemplate(id) {
    if (!id) return;
    const t = await api.get('/templates/' + id);
    setTemplate(t);
    setActiveFieldId(t.fields[0]?.id ?? null);
    setLastEditedFieldId(null);
    setMappings({});
    setSample(null);
    setPreview(null);
  }

  async function uploadSample(e) {
    e.preventDefault();
    const file = fileRef.current.files[0];
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const result = await api.upload(`/training/${templateId}/sample`, fd);
      setSample(result);
      setPreview(null);
      setTab('rows');
      toast.success(`Uploaded ${result.original_name}`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  function tokensIn(cell) { return (cell?.text || '').split(/\s+/).filter(Boolean); }
  function occurrenceOf(line, columnIndex) {
    if (!line?.columns) return 1;
    const target = line.columns[columnIndex]?.text;
    if (!target) return 1;
    let n = 0;
    for (let i = 0; i <= columnIndex; i++) if (line.columns[i]?.text === target) n++;
    return n;
  }
  function headerAbove(line) {
    if (!sample) return null;
    const idx = sample.lines.findIndex((l) => l.lineIndex === line.lineIndex);
    for (let i = idx - 1; i >= 0; i--) {
      const cand = sample.lines[i];
      if (cand.pageIndex !== line.pageIndex) break;
      if (!cand.is_data_row && cand.columns?.length >= 2) return cand;
    }
    return null;
  }

  function pickToken(line, columnIndex, tokenIndex, shift) {
    const fieldId = shift ? (lastEditedFieldId ?? activeFieldId) : activeFieldId;
    if (!fieldId) return;
    const cell = line.columns[columnIndex];
    if (!cell) return;
    const tokens = tokensIn(cell);
    if (tokens.length === 0) return;

    let tStart = tokenIndex, tEnd = tokenIndex;
    const existing = mappings[fieldId];
    if (
      shift && existing &&
      existing.line_index === line.lineIndex &&
      existing.column_index === columnIndex &&
      existing.token_start != null && existing.token_end != null
    ) {
      tStart = Math.min(existing.token_start, tokenIndex);
      tEnd = Math.max(existing.token_end, tokenIndex);
    }

    const selectionText = tokens.slice(tStart, tEnd + 1).join(' ');
    const occurrence = occurrenceOf(line, columnIndex);
    const header = headerAbove(line);
    const anchor = header?.columns?.[columnIndex]?.text || null;
    const field = template.fields.find((f) => f.id === fieldId);

    setMappings((m) => ({
      ...m,
      [fieldId]: {
        field_id: fieldId, field_name: field.name,
        selection_text: selectionText,
        prototype_line_text: line.text,
        column_index: columnIndex,
        token_start: tStart, token_end: tEnd,
        line_index: line.lineIndex, page_index: line.pageIndex,
        occurrence,
        anchor_text: anchor, anchor_kind: anchor ? 'header' : null,
      },
    }));
    setLastEditedFieldId(fieldId);

    if (!shift) {
      const nextField = template.fields.find((f) => f.id !== fieldId && !mappings[f.id]);
      if (nextField) setActiveFieldId(nextField.id);
    }
  }

  function clearField(fieldId) {
    setMappings((m) => { const next = { ...m }; delete next[fieldId]; return next; });
    if (lastEditedFieldId === fieldId) setLastEditedFieldId(null);
  }

  useEffect(() => {
    if (!sample || Object.keys(mappings).length === 0) { setPreview(null); return; }
    const t = setTimeout(async () => {
      setPreviewBusy(true);
      try {
        const result = await api.post(`/training/${templateId}/preview-mappings`, {
          sample_id: sample.sample_id,
          mappings: Object.values(mappings),
        });
        setPreview(result);
      } catch (err) {
        setPreview({ error: err.message });
      } finally { setPreviewBusy(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [mappings, sample, templateId]);

  async function saveMappings() {
    if (!sample) return;
    try {
      await api.post(`/training/${templateId}/mappings`, {
        sample_id: sample.sample_id,
        mappings: Object.values(mappings),
      });
      toast.success('Mappings saved. Try Review or Import next.');
    } catch (e) {
      toast.error(e.message);
    }
  }

  const tokenLookup = useMemo(() => {
    const out = new Map();
    for (const m of Object.values(mappings)) {
      if (m.line_index == null || m.column_index == null) continue;
      if (!out.has(m.line_index)) out.set(m.line_index, new Map());
      const cols = out.get(m.line_index);
      if (!cols.has(m.column_index)) cols.set(m.column_index, new Map());
      const tokenMap = cols.get(m.column_index);
      const tStart = m.token_start ?? 0, tEnd = m.token_end ?? 9999;
      for (let i = tStart; i <= tEnd; i++) tokenMap.set(i, m.field_name);
    }
    return out;
  }, [mappings]);

  const dataRows = useMemo(() => sample?.lines?.filter((l) => l.is_data_row) ?? [], [sample]);
  const headerLine = useMemo(() => {
    if (!sample?.lines || dataRows.length === 0) return null;
    const idx = sample.lines.findIndex((l) => l.lineIndex === dataRows[0].lineIndex);
    for (let i = idx - 1; i >= 0; i--) {
      const cand = sample.lines[i];
      if (cand.pageIndex !== dataRows[0].pageIndex) break;
      if (!cand.is_data_row && (cand.columns?.length ?? 0) >= 2) return cand;
    }
    return null;
  }, [sample, dataRows]);
  const colCount = useMemo(() => {
    let max = 0;
    for (const l of dataRows) max = Math.max(max, l.columns?.length ?? 0);
    if (headerLine) max = Math.max(max, headerLine.columns?.length ?? 0);
    return max;
  }, [dataRows, headerLine]);

  const isHostile = sample && detectHostile(sample);

  return (
    <>
      <div className="page-header">
        <div className="page-title-block">
          <h1>Training</h1>
          <div className="page-subtitle">
            Click on the <strong>token</strong> that holds each field's value. <span className="kbd">Shift</span> + click to extend the selection across multiple tokens.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <select className="input input-inline" value={templateId || ''}
                  onChange={(e) => { setTemplateId(Number(e.target.value)); loadTemplate(Number(e.target.value)); }}>
            <option value="">Select a template…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {template && (
            <form onSubmit={uploadSample} className="toolbar" style={{ marginLeft: 8 }}>
              <input type="file" accept="application/pdf" ref={fileRef} className="input input-inline" />
              <button className="btn btn-primary" type="submit">
                <IconUpload size={14} /> Upload sample
              </button>
            </form>
          )}
        </div>

        {template && (
          <div style={{ marginTop: 16 }}>
            <div className="muted" style={{ marginBottom: 8, fontSize: 12.5 }}>
              Active field — clicks land here:
            </div>
            <div className="toolbar">
              {template.fields.map((f) => {
                const mapped = mappings[f.id];
                const isActive = activeFieldId === f.id;
                const wasLast = lastEditedFieldId === f.id;
                return (
                  <span
                    key={f.id}
                    onClick={() => setActiveFieldId(f.id)}
                    className={'tag' + (isActive ? ' tag-primary' : '') + (mapped && !isActive ? ' tag-info' : '')}
                    style={{
                      cursor: 'pointer',
                      padding: '4px 10px',
                      fontSize: 12,
                      outline: wasLast && !isActive ? '2px solid var(--color-primary)' : 'none',
                      outlineOffset: 1,
                    }}
                    title={(mapped ? `Mapped to "${mapped.selection_text}"` : 'Not mapped') + (wasLast ? ' (shift-click extends this)' : '')}
                  >
                    {f.label}
                    <span className="muted" style={{ fontSize: 11, marginLeft: 4 }}>{f.type}</span>
                    {mapped && ' ✓'}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {isHostile && (
        <div className="banner banner-warning">
          <IconAlert className="banner-icon" />
          <div>
            <strong>This PDF uses a non-standard text layout.</strong> Many parsed
            "lines" contain text from multiple visual rows, so the Sample-rows
            view will look scrambled. OCR support for hostile PDFs is on the
            roadmap. For now, try a different carrier's PDF.
          </div>
        </div>
      )}

      {!sample && template && (
        <Empty
          icon={<IconUpload size={28} />}
          title="Upload a sample PDF"
          message="One representative PDF is enough. DocuStruct will parse it, auto-detect the data rows, and let you click on cells to map them."
        />
      )}

      {sample && (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="col">
            <div className="card card-pad-0">
              <div className="card-header" style={{ padding: '10px 16px' }}>
                <div className="toolbar">
                  <Tab name="rows"    current={tab} onClick={setTab}>Sample rows {dataRows.length > 0 && <span className="muted">· {dataRows.length}</span>}</Tab>
                  <Tab name="raw"     current={tab} onClick={setTab}>Raw text <span className="muted">· {sample.lines.length}</span></Tab>
                  <Tab name="preview" current={tab} onClick={setTab}>Test preview {preview && !preview.error && <span className="muted">· {preview.record_count}</span>}</Tab>
                </div>
                <span className="muted" style={{ fontSize: 12 }}>
                  {sample.original_name} · {sample.page_count} pg
                </span>
              </div>
              <div style={{ padding: 12 }}>
                {tab === 'rows' && (
                  <SampleRowsView dataRows={dataRows} headerLine={headerLine}
                                  colCount={colCount} tokenLookup={tokenLookup} onPick={pickToken} />
                )}
                {tab === 'raw' && (
                  <RawTextView lines={sample.lines} tokenLookup={tokenLookup} onPick={pickToken} />
                )}
                {tab === 'preview' && (
                  <TestPreviewView preview={preview} busy={previewBusy} template={template} />
                )}
              </div>
            </div>
          </div>

          <aside style={{ width: 360, flex: 'none' }}>
            <div className="card">
              <h3 style={{ marginBottom: 12 }}>Selections</h3>
              {template?.fields.map((f) => {
                const m = mappings[f.id];
                return (
                  <div key={f.id} style={{ marginBottom: 12, fontSize: 12.5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <strong>{f.label}</strong>
                      <span className="muted">{f.type}</span>
                      {m && (
                        <button className="btn btn-ghost btn-icon right" onClick={() => clearField(f.id)} aria-label="clear">
                          <IconClose size={12} />
                        </button>
                      )}
                    </div>
                    <div className="muted" style={{ wordBreak: 'break-word', marginTop: 2 }}>
                      {m ? (
                        <>“{m.selection_text}” <span className="soft">col {m.column_index} · {m.token_start === m.token_end ? `tok ${m.token_start}` : `tok ${m.token_start}-${m.token_end}`}{m.occurrence > 1 ? ' · #' + m.occurrence : ''}</span></>
                      ) : <em>not mapped</em>}
                    </div>
                    {m && (() => {
                      const typeIssue = validateValueForType(m.selection_text, f.type);
                      const consistency = consistencyHint(m, dataRows);
                      const issue = typeIssue || consistency;
                      if (!issue) return null;
                      return (
                        <div style={{ display: 'flex', gap: 6, marginTop: 4, fontSize: 11, color: 'var(--color-warning)' }}>
                          <IconAlert size={12} />
                          <span>{issue}</span>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}

              <div className="divider" />
              <div className="row-tight" style={{ marginBottom: 8 }}>
                <strong>Live preview</strong>
                {previewBusy && <span className="muted soft" style={{ fontSize: 12 }}>· running…</span>}
              </div>
              {preview && !preview.error && (
                <div style={{ fontSize: 12.5 }}>
                  Mode <code>{preview.mode}</code> · <strong>{preview.record_count}</strong> records
                  {preview.warnings?.length > 0 && (
                    <div className="muted" style={{ marginTop: 4 }}>{preview.warnings.join(' · ')}</div>
                  )}
                  <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => setTab('preview')}>
                    See sample rows →
                  </button>
                </div>
              )}
              {preview?.error && <div className="muted" style={{ fontSize: 12 }}>{preview.error}</div>}
              {!preview && !previewBusy && (
                <div className="muted" style={{ fontSize: 12 }}>Map at least 2 tokens to see a preview.</div>
              )}

              <button className="btn btn-primary" style={{ marginTop: 16, width: '100%' }}
                      onClick={saveMappings} disabled={Object.keys(mappings).length === 0}>
                <IconSpark size={14} /> Save mappings
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function Tab({ name, current, onClick, children }) {
  const active = name === current;
  return (
    <button onClick={() => onClick(name)}
            className={'btn ' + (active ? 'btn-primary' : 'btn-secondary') + ' btn-sm'}>
      {children}
    </button>
  );
}

function SampleRowsView({ dataRows, headerLine, colCount, tokenLookup, onPick }) {
  if (dataRows.length === 0) {
    return (
      <div className="empty">
        <IconInfo size={24} className="empty-icon" />
        <h3>No data rows auto-detected</h3>
        <p>Use the <strong>Raw text</strong> tab to map fields manually, or check the warnings on the source PDF.</p>
      </div>
    );
  }
  const cols = Array.from({ length: colCount }, (_, i) => i);
  return (
    <div className="table-wrap" style={{ maxHeight: '60vh' }}>
      <table className="table table-compact">
        <thead>
          <tr>
            <th>#</th>
            {cols.map((ci) => (
              <th key={ci}>{headerLine?.columns?.[ci]?.text || `Col ${ci}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((line, rowIdx) => (
            <tr key={line.lineIndex}>
              <td className="muted">{rowIdx + 1}</td>
              {cols.map((ci) => (
                <td key={ci}>
                  <CellTokens line={line} cell={line.columns?.[ci]} columnIndex={ci}
                              tokenLookup={tokenLookup} onPick={onPick} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RawTextView({ lines, tokenLookup, onPick }) {
  return (
    <div className="lines" style={{ maxHeight: '60vh' }}>
      {lines.map((line) => (
        <div key={line.lineIndex} className="line"
             style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '3px 6px', opacity: line.is_data_row ? 1 : 0.55 }}>
          <span className="pageMark">p{line.pageIndex + 1}</span>
          {line.columns?.length > 0 ? line.columns.map((c) => (
            <span key={c.index}
                  style={{ display: 'inline-flex', gap: 2, padding: '0 4px', borderRadius: 4, background: 'rgba(255,255,255,0.7)' }}
                  title={'col ' + c.index}>
              <CellTokens line={line} cell={c} columnIndex={c.index}
                          tokenLookup={tokenLookup} onPick={onPick} />
            </span>
          )) : <span className="muted">{line.text}</span>}
        </div>
      ))}
    </div>
  );
}

function TestPreviewView({ preview, busy, template }) {
  if (busy) return <div className="muted">Running extraction…</div>;
  if (!preview) return <div className="muted">Map at least 2 tokens to see a preview.</div>;
  if (preview.error) return <div className="muted">{preview.error}</div>;
  const fields = preview.template_fields || template?.fields || [];
  if (preview.sample_records?.length === 0) {
    return (
      <div className="muted" style={{ fontSize: 13 }}>
        Mode <code>{preview.mode}</code> · 0 records.{' '}
        {preview.warnings?.length > 0 && <em>{preview.warnings.join(' · ')}</em>}
      </div>
    );
  }
  return (
    <>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
        Mode <code>{preview.mode}</code> · <strong>{preview.record_count}</strong> records detected, showing first {preview.sample_records.length}.
      </div>
      <div className="table-wrap" style={{ maxHeight: '55vh' }}>
        <table className="table table-compact">
          <thead>
            <tr>
              <th>#</th>
              {fields.map((f) => <th key={f.id || f.name}>{f.label || f.name}</th>)}
              <th>Conf</th>
            </tr>
          </thead>
          <tbody>
            {preview.sample_records.map((r, i) => (
              <tr key={i}>
                <td className="muted">{i + 1}</td>
                {fields.map((f) => {
                  const v = r.values?.[f.name];
                  return (
                    <td key={f.id || f.name}>
                      <div>{v?.value ?? '—'}</div>
                      {v?.raw_text && v.raw_text !== String(v.value) && (
                        <div style={{ fontSize: 10, color: 'var(--color-text-soft)' }}>raw: {v.raw_text}</div>
                      )}
                    </td>
                  );
                })}
                <td className={'confidence ' + (r.confidence >= 0.75 ? 'high' : r.confidence >= 0.4 ? 'mid' : 'low')}>
                  {r.confidence != null ? Math.round(r.confidence * 100) + '%' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CellTokens({ line, cell, columnIndex, tokenLookup, onPick }) {
  const tokens = (cell?.text || '').split(/\s+/).filter(Boolean);
  const colMap = tokenLookup.get(line.lineIndex)?.get(columnIndex);
  if (tokens.length === 0) return <span className="muted">—</span>;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 2 }}>
      {tokens.map((tok, ti) => {
        const fieldName = colMap?.get(ti);
        return (
          <span key={ti}
                onClick={(e) => { e.stopPropagation(); onPick(line, columnIndex, ti, e.shiftKey); }}
                style={{
                  cursor: 'pointer',
                  padding: '1px 5px',
                  borderRadius: 3,
                  background: fieldName ? 'var(--color-primary)' : 'transparent',
                  color: fieldName ? 'white' : 'inherit',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                }}>
            {fieldName && ti === 0 && (
              <span style={{ fontSize: 10, opacity: 0.85, marginRight: 3 }}>{fieldName}:</span>
            )}
            {tok}
          </span>
        );
      })}
    </span>
  );
}
