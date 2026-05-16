import { Fragment, useEffect, useState } from 'react';
import { useConfirm } from '../components/Confirm.jsx';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import Empty from '../components/Empty.jsx';
import OnboardingWizard from '../components/OnboardingWizard.jsx';
import { IconPlus, IconTrash, IconLayers, IconSpark, IconCpu, IconUpload, IconClose, IconCheck } from '../components/icons.jsx';

const TYPES = ['text', 'number', 'date', 'amount'];

export default function Templates() {
  const [templates, setTemplates] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [organization, setOrg] = useState('');
  const [year, setYear] = useState('');
  const [stateCode, setState] = useState('');
  const [category, setCategory] = useState('Commission Statement');
  const [fields, setFields] = useState([
    { name: 'policy_no',      label: 'Policy No',     type: 'text',   is_primary: true },
    { name: 'policyholder',   label: 'Policyholder',  type: 'text',   is_primary: false },
    { name: 'effective_date', label: 'Effective',     type: 'date',   is_primary: false },
    { name: 'commission',     label: 'Commission',    type: 'amount', is_primary: false },
  ]);
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null); // template object being edited
  const [expanded, setExpanded] = useState(null); // template id whose samples are open
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [details, setDetails] = useState({});      // template id -> hydrated template

  function load() { api.get('/templates').then(setTemplates).catch((e) => toast.error(e.message)); }

  async function toggleExpand(t) {
    if (expanded === t.id) { setExpanded(null); return; }
    setExpanded(t.id);
    if (!details[t.id]) {
      try {
        const [full, stats] = await Promise.all([
          api.get('/templates/' + t.id),
          api.get('/data/field-stats?template_id=' + t.id),
        ]);
        full.fieldStats = stats;
        setDetails((d) => ({ ...d, [t.id]: full }));
      } catch (e) { toast.error(e.message); }
    }
  }

  async function runSuggest(files) {
    setSuggestBusy(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const r = await api.upload('/ai/suggest-template', fd);
      const t = r.template || {};
      setName(t.name || '');
      setOrg(t.organization || '');
      setState(t.state || '');
      setYear(t.year || '');
      setCategory(t.category || 'Commission Statement');
      if (Array.isArray(t.fields) && t.fields.length > 0) {
        setFields(t.fields.map((f, i) => ({
          name: f.name || ('field_' + (i + 1)),
          label: f.label || f.name || ('Field ' + (i + 1)),
          type: ['text', 'number', 'date', 'amount'].includes(f.type) ? f.type : 'text',
          is_primary: !!f.is_primary,
        })));
      }
      setSuggestOpen(false);
      setShowForm(true);
      const fields = (t.fields || []).length;
      const cost = r.usage?.costUsd ? ' · $' + r.usage.costUsd.toFixed(4) : '';
      if (fields === 0) {
        toast.error('AI returned 0 fields — the PDFs may not share a coherent structure. Try different samples.');
      } else {
        toast.success(`Suggested ${fields} field${fields === 1 ? '' : 's'}${cost} — review and create.`);
      }
    } catch (e) { toast.error(e.message); }
    finally { setSuggestBusy(false); }
  }

  async function removeSample(templateId, sampleId) {
    const ok = await confirm({
      title: 'Delete training sample?',
      message: 'This sample and its mappings will be removed. Other samples for this template are unaffected.',
      confirmLabel: 'Delete sample',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete('/training/sample/' + sampleId);
      toast.success('Sample deleted');
      // Refresh the cached details for this template.
      const full = await api.get('/templates/' + templateId);
      setDetails((d) => ({ ...d, [templateId]: full }));
      load();
    } catch (e) { toast.error(e.message); }
  }
  useEffect(() => { load(); }, []);

  function updateField(i, patch) {
    setFields((arr) => arr.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function addField() {
    setFields((arr) => [...arr, { name: '', label: '', type: 'text', is_primary: false }]);
  }
  function removeField(i) { setFields((arr) => arr.filter((_, idx) => idx !== i)); }
  function resetForm() {
    setShowForm(false);
    setName(''); setOrg(''); setYear(''); setState('');
  }

  async function save() {
    try {
      await api.post('/templates', {
        name, organization, state: stateCode, category,
        year: year ? Number(year) : null,
        fields,
      });
      toast.success(`Template "${name}" created`);
      resetForm();
      load();
    } catch (e) { toast.error(e.message); }
  }

  async function remove(t) {
    const ok = await confirm({
      title: `Delete "${t.name}"?`,
      message: 'This will permanently remove the template and ALL its documents, records, and corrections.',
      confirmLabel: 'Delete template',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete('/templates/' + t.id);
      toast.success('Template deleted');
      load();
    } catch (e) { toast.error(e.message); }
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title-block">
          <h1>Templates</h1>
          <div className="page-subtitle">
            A template captures one carrier / form layout and the fields you want extracted from it.
          </div>
        </div>
        <div className="toolbar">
          <button className="btn btn-ghost btn-sm" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancel manual form' : 'Manual template'}
          </button>
          <button className="btn btn-primary" onClick={() => setWizardOpen(true)}>
            <IconCpu /> Create with AI
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>New template</h3>
          <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
            <div className="field-group" style={{ flex: '1 1 220px', marginBottom: 0 }}>
              <label className="label">Template name</label>
              <input className="input" placeholder="e.g. Aetna Renewals 2025"
                     value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field-group" style={{ flex: '1 1 200px', marginBottom: 0 }}>
              <label className="label">Organization</label>
              <input className="input" placeholder="Carrier name"
                     value={organization} onChange={(e) => setOrg(e.target.value)} />
            </div>
            <div className="field-group" style={{ flex: '0 0 130px', marginBottom: 0 }}>
              <label className="label">State</label>
              <input className="input" placeholder="FL / TX / ALL"
                     value={stateCode} onChange={(e) => setState(e.target.value)} />
            </div>
            <div className="field-group" style={{ flex: '0 0 110px', marginBottom: 0 }}>
              <label className="label">Year</label>
              <input className="input" type="number" placeholder="2025"
                     value={year} onChange={(e) => setYear(e.target.value)} />
            </div>
            <div className="field-group" style={{ flex: '1 1 200px', marginBottom: 0 }}>
              <label className="label">Category</label>
              <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
          </div>

          <div className="divider" />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h4>Fields</h4>
            <button className="btn btn-secondary btn-sm" onClick={addField}>
              <IconPlus size={12} /> Add field
            </button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th><th>Label</th><th>Type</th><th>Primary?</th><th></th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => (
                  <tr key={i}>
                    <td><input className="input input-sm" value={f.name}
                               onChange={(e) => updateField(i, { name: e.target.value })} /></td>
                    <td><input className="input input-sm" value={f.label}
                               onChange={(e) => updateField(i, { label: e.target.value })} /></td>
                    <td>
                      <select className="input input-sm" value={f.type}
                              onChange={(e) => updateField(i, { type: e.target.value })}>
                        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td>
                      <input type="checkbox" checked={f.is_primary}
                             onChange={(e) => updateField(i, { is_primary: e.target.checked })} />
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-icon" onClick={() => removeField(i)} aria-label="remove">
                        <IconTrash size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={resetForm}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!name || fields.length === 0}>
              Create template
            </button>
          </div>
        </div>
      )}

      <div className="card card-pad-0">
        {templates.length === 0 ? (
          <Empty
            icon={<IconLayers size={32} />}
            title="No templates yet"
            message="Upload 2–3 sample PDFs and let AI design the template for you. You can review and edit before saving."
            action={<button className="btn btn-primary" onClick={() => setWizardOpen(true)}>
              <IconCpu /> Create your first template with AI
            </button>}
          />
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th><th>Organization</th><th>State</th><th>Year</th>
                  <th>Fields</th><th>Documents</th><th></th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => {
                  const isOpen = expanded === t.id;
                  const detail = details[t.id];
                  const samples = detail?.samples || [];
                  return (
                    <Fragment key={t.id}>
                      <tr style={{ cursor: 'pointer' }} onClick={() => toggleExpand(t)}>
                        <td>
                          <span style={{ display: 'inline-block', width: 14, transform: isOpen ? 'rotate(90deg)' : '', transition: 'transform 100ms', color: 'var(--color-text-soft)' }}>▸</span>
                          {' '}<strong>{t.name}</strong>
                          {t.extraction_strategy === 'ai_vision' ? (
                            <span title={`AI vision · ${t.ai_provider || 'anthropic'}`}
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 3,
                                    marginLeft: 8, padding: '1px 7px', fontSize: 10, fontWeight: 600,
                                    color: 'var(--color-primary)', background: 'rgba(79,70,229,0.1)',
                                    borderRadius: 999, verticalAlign: 'middle',
                                  }}>
                              <IconCpu size={10} /> AI
                            </span>
                          ) : (
                            <span title="Click-to-train (deterministic + AI fallback)"
                                  style={{
                                    marginLeft: 8, padding: '1px 7px', fontSize: 10, fontWeight: 600,
                                    color: 'var(--color-text-soft)', background: 'var(--color-surface-2)',
                                    borderRadius: 999, verticalAlign: 'middle',
                                  }}>
                              Manual
                            </span>
                          )}
                          {(() => {
                            const c = t.pattern_coverage;
                            if (!c) return null;
                            const total = c.total_fields || 0;
                            const covered = c.covered_fields || 0;
                            const hasAnchor = !!c.has_anchor;
                            // Health levels: green = anchor + all fields covered;
                            // yellow = anchor + some fields; red = no anchor / no patterns.
                            let bg, fg, label, title;
                            if (!hasAnchor || total === 0) {
                              bg = 'rgba(220,38,38,0.10)'; fg = '#b91c1c';
                              label = 'no patterns';
                              title = 'No learned patterns. Every import will need AI ($).';
                            } else if (covered >= total) {
                              bg = 'rgba(5,150,105,0.12)'; fg = '#047857';
                              label = `patterns ${covered}/${total}`;
                              title = `All fields have learned patterns. Similar PDFs extract free.`;
                            } else {
                              bg = 'rgba(234,179,8,0.18)'; fg = '#854d0e';
                              label = `patterns ${covered}/${total}`;
                              title = `Partial pattern coverage. AI may still be needed for ${total - covered} field(s).`;
                            }
                            return (
                              <span title={title}
                                    style={{
                                      marginLeft: 6, padding: '1px 7px', fontSize: 10, fontWeight: 600,
                                      color: fg, background: bg,
                                      borderRadius: 999, verticalAlign: 'middle',
                                    }}>
                                {label}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="muted">{t.organization || '—'}</td>
                        <td className="muted">{t.state || '—'}</td>
                        <td className="muted">{t.year || '—'}</td>
                        <td>{t.field_count}</td>
                        <td>{t.document_count}</td>
                        <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                          {t.extraction_strategy === 'ai_vision' ? (
                            <Link to={`/data?template=${t.id}`} className="btn btn-secondary btn-sm">
                              <IconLayers size={12} /> View data
                            </Link>
                          ) : (
                            <Link to={`/training?template=${t.id}`} className="btn btn-secondary btn-sm">
                              <IconSpark size={12} /> Train
                            </Link>
                          )}{' '}
                          <button className="btn btn-secondary btn-sm" onClick={async () => {
                            const full = await api.get('/templates/' + t.id);
                            setEditing(full);
                          }}>Edit</button>{' '}
                          <button className="btn btn-ghost btn-icon" onClick={() => remove(t)} aria-label="delete">
                            <IconTrash size={14} />
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7} style={{ background: 'var(--color-surface-2)', padding: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                              <strong style={{ fontSize: 13 }}>Training samples</strong>
                              <Link to={`/training?template=${t.id}`} className="btn btn-secondary btn-sm">
                                <IconPlus size={12} /> Add another sample
                              </Link>
                            </div>
                            {samples.length === 0 ? (
                              <div className="muted" style={{ fontSize: 12 }}>
                                No samples yet. Click <strong>Add another sample</strong> to train this template.
                              </div>
                            ) : (
                              <table className="table table-compact" style={{ background: 'transparent' }}>
                                <thead>
                                  <tr><th>Original name</th><th>Mapped fields</th><th>Trained at</th><th></th></tr>
                                </thead>
                                <tbody>
                                  {samples.map((s) => (
                                    <tr key={s.id}>
                                      <td>{s.original_name}</td>
                                      <td>{s.mapping_count} / {t.field_count}</td>
                                      <td className="muted">{s.created_at}</td>
                                      <td style={{ textAlign: 'right' }}>
                                        <button className="btn btn-ghost btn-icon"
                                                onClick={() => removeSample(t.id, s.id)} aria-label="delete sample">
                                          <IconTrash size={14} />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            <div className="help" style={{ marginTop: 8 }}>
                              Multiple samples make extraction more robust. The engine evaluates every
                              sample on each new PDF and picks the one yielding the most records.
                            </div>
                            {detail?.fieldStats && detail.fieldStats.length > 0 && (
                              <div style={{ marginTop: 14 }}>
                                <strong style={{ fontSize: 13 }}>Field accuracy</strong>
                                <table className="table table-compact" style={{ background: 'transparent', marginTop: 6 }}>
                                  <thead>
                                    <tr><th>Field</th><th>Extractions</th><th>Corrections</th><th>AI escalations</th><th>Accuracy</th></tr>
                                  </thead>
                                  <tbody>
                                    {detail.fieldStats.map((s) => (
                                      <tr key={s.field_id}>
                                        <td>{s.label}</td>
                                        <td>{s.extractions}</td>
                                        <td>{s.corrections}</td>
                                        <td>{s.ai_escalations}</td>
                                        <td>
                                          {s.accuracy != null ? (
                                            <span className={'confidence ' + (s.accuracy >= 0.85 ? 'high' : s.accuracy >= 0.6 ? 'mid' : 'low')}>
                                              {Math.round(s.accuracy * 100)}%
                                            </span>
                                          ) : (
                                            <span className="muted" title={`needs ${Math.max(0, 5 - s.extractions)} more extractions`}>
                                              {s.extractions === 0 ? '—' : `${s.extractions}/5`}
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <div className="help" style={{ marginTop: 4 }}>
                                  Accuracy = 1 − (corrections / extractions). Shown once a field has 5+ extractions.
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <EditTemplateModal template={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setEditing(null);
            setDetails((d) => ({ ...d, [updated.id]: updated }));
            load();
            toast.success('Template updated');
          }}
          onError={(msg) => toast.error(msg)}
        />
      )}

      {suggestOpen && (
        <SuggestModal busy={suggestBusy} onClose={() => setSuggestOpen(false)} onRun={runSuggest} />
      )}

      {wizardOpen && (
        <OnboardingWizard
          onClose={() => setWizardOpen(false)}
          onSwitchToManual={() => { setWizardOpen(false); setShowForm(true); }}
          onCreated={(r) => {
            setWizardOpen(false);
            load();
            // Take the user straight to the freshly extracted records.
            if (r?.template?.id) {
              navigate(`/data?template=${r.template.id}`);
            }
          }}
        />
      )}
    </>
  );
}

function SuggestModal({ busy, onClose, onRun }) {
  const [files, setFiles] = useState([]);
  function pick(e) { setFiles([...(e.target.files || [])].slice(0, 3)); }
  return (
    <div role="dialog" aria-modal="true"
         style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
         onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540, width: '100%', margin: 0 }}>
        <h3 style={{ marginBottom: 6 }}><IconCpu /> &nbsp; Suggest a template from PDFs</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          Upload 1–3 representative PDFs. The AI provider you configured in Settings reads them and proposes a starter template you can edit and create.
        </p>
        <div className="field-group">
          <label className="label">PDFs (up to 3)</label>
          <input type="file" multiple accept="application/pdf" onChange={pick} className="input" />
          <div className="help">Each file is sent to your configured LLM with up to ~3 KB of text per PDF. Cost is logged per call.</div>
        </div>
        <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || files.length === 0} onClick={() => onRun(files)}>
            <IconUpload size={14} /> {busy ? 'Asking the AI…' : 'Suggest template'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditTemplateModal({ template, onClose, onSaved, onError }) {
  const [meta, setMeta] = useState({
    name: template.name || '',
    organization: template.organization || '',
    state: template.state || '',
    year: template.year || '',
    category: template.category || '',
    notes: template.notes || '',
    extraction_strategy: template.extraction_strategy || 'manual',
    ai_prompt: template.ai_prompt || '',
  });
  const isAI = (meta.extraction_strategy === 'ai_vision');
  const [fields, setFields] = useState(
    (template.fields || []).map((f) => ({
      id: f.id, name: f.name, label: f.label, type: f.type, is_primary: !!f.is_primary,
    }))
  );
  const [busy, setBusy] = useState(false);

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    setFields(next);
  }
  function update(i, patch) {
    setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function add() {
    setFields((fs) => [...fs, { name: '', label: '', type: 'text', is_primary: false }]);
  }
  function remove(i) { setFields((fs) => fs.filter((_, idx) => idx !== i)); }

  async function save() {
    setBusy(true);
    try {
      await api['post' in api ? 'post' : 'post']; // ensures method available
      // PATCH meta
      await fetch('/api/templates/' + template.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...meta,
          year: meta.year === '' ? null : Number(meta.year),
          // Only push prompt-related fields if this template is AI-driven.
          ai_prompt: meta.extraction_strategy === 'ai_vision' ? meta.ai_prompt : undefined,
        }),
      }).then(async (r) => { if (!r.ok) throw new Error(await r.text()); });
      // PUT fields
      const updated = await fetch('/api/templates/' + template.id + '/fields', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: fields.map((f, i) => ({ ...f, sort_order: i })),
        }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      });
      onSaved(updated);
    } catch (e) { onError(String(e.message || e)); }
    finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true"
         style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, overflowY: 'auto' }}
         onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760, width: '100%', margin: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3>Edit template</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="close"><IconClose size={14} /></button>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 16, marginBottom: 12 }}>
          <div className="field-group" style={{ flex: '1 1 220px', marginBottom: 0 }}>
            <label className="label">Name</label>
            <input className="input" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
          </div>
          <div className="field-group" style={{ flex: '1 1 200px', marginBottom: 0 }}>
            <label className="label">Organization</label>
            <input className="input" value={meta.organization} onChange={(e) => setMeta({ ...meta, organization: e.target.value })} />
          </div>
          <div className="field-group" style={{ flex: '0 0 130px', marginBottom: 0 }}>
            <label className="label">State</label>
            <input className="input" value={meta.state} onChange={(e) => setMeta({ ...meta, state: e.target.value })} />
          </div>
          <div className="field-group" style={{ flex: '0 0 110px', marginBottom: 0 }}>
            <label className="label">Year</label>
            <input className="input" type="number" value={meta.year} onChange={(e) => setMeta({ ...meta, year: e.target.value })} />
          </div>
          <div className="field-group" style={{ flex: '1 1 200px', marginBottom: 0 }}>
            <label className="label">Category</label>
            <input className="input" value={meta.category} onChange={(e) => setMeta({ ...meta, category: e.target.value })} />
          </div>
        </div>

        {isAI && (
          <>
            <div className="divider" />
            <div className="field-group" style={{ marginBottom: 0 }}>
              <label className="label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>AI extraction prompt</span>
                <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>
                  Sent to {template.ai_provider || 'anthropic'}{template.ai_model ? ` · ${template.ai_model}` : ''} on every import
                </span>
              </label>
              <textarea className="input" rows={6}
                        value={meta.ai_prompt}
                        onChange={(e) => setMeta({ ...meta, ai_prompt: e.target.value })}
                        style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5 }} />
              <div className="help">
                Edit this if you keep seeing extraction mistakes on a class of rows. Existing imports won't change
                — use "Re-extract" on a document to apply the new prompt.
              </div>
            </div>
          </>
        )}

        <div className="divider" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h4>Fields</h4>
          <button className="btn btn-secondary btn-sm" onClick={add}>
            <IconPlus size={12} /> Add field
          </button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th></th><th>Name</th><th>Label</th><th>Type</th><th>Primary?</th><th></th></tr>
            </thead>
            <tbody>
              {fields.map((f, i) => (
                <tr key={f.id ?? 'new-' + i}>
                  <td>
                    <button className="btn btn-ghost btn-icon" disabled={i === 0} onClick={() => move(i, -1)} title="move up">↑</button>
                    <button className="btn btn-ghost btn-icon" disabled={i === fields.length - 1} onClick={() => move(i, +1)} title="move down">↓</button>
                  </td>
                  <td><input className="input input-sm" value={f.name} onChange={(e) => update(i, { name: e.target.value })} /></td>
                  <td><input className="input input-sm" value={f.label} onChange={(e) => update(i, { label: e.target.value })} /></td>
                  <td>
                    <select className="input input-sm" value={f.type} onChange={(e) => update(i, { type: e.target.value })}>
                      <option value="text">text</option>
                      <option value="number">number</option>
                      <option value="date">date</option>
                      <option value="amount">amount</option>
                    </select>
                  </td>
                  <td>
                    <input type="checkbox" checked={!!f.is_primary} onChange={(e) => update(i, { is_primary: e.target.checked })} />
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-icon" onClick={() => remove(i)} aria-label="remove"><IconTrash size={14} /></button>
                  </td>
                </tr>
              ))}
              {fields.length === 0 && (
                <tr><td colSpan={6} className="muted">No fields yet — add at least one.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !meta.name || fields.length === 0} onClick={save}>
            <IconCheck size={14} /> {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

