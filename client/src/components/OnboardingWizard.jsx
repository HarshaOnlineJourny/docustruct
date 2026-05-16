// AI Onboarding Wizard.
//
// Walks the user through three steps:
//   1. Upload — pick 1–3 PDFs, optional name, optional natural-language hint.
//   2. Analyze — server runs suggestTemplate + vision pass on the first PDF.
//   3. Review — user edits the proposed name, fields, and extraction prompt,
//      sees a preview of sample rows, and confirms.
//
// On confirm the server creates the template (extraction_strategy='ai_vision'),
// imports the same PDFs as the first batch, and the wizard returns the new
// template id so the parent can route to the Data Grid.
//
// The flow replaces the old click-train-first onboarding for new templates.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from './Toast.jsx';
import {
  IconCpu, IconUpload, IconClose, IconCheck, IconPlus, IconTrash, IconSpark,
} from './icons.jsx';

const TYPES = ['text', 'number', 'date', 'amount'];

export default function OnboardingWizard({ onClose, onCreated, onSwitchToManual }) {
  const [step, setStep] = useState(1);     // 1 upload, 2 analyzing, 3 review
  const [files, setFiles] = useState([]);  // File[]
  const [hint, setHint] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState(null); // { proposed_template, sample_records, extraction_prompt, files, ... }
  const [aiCheck, setAiCheck] = useState({ loading: true, enabled: false, provider: null, model: null });
  const toast = useToast();

  // Precheck: do we even have AI configured? Saves users from uploading PDFs
  // only to hit a 400 on /onboard/analyze.
  useEffect(() => {
    let cancelled = false;
    api.get('/settings').then((r) => {
      if (cancelled) return;
      const ai = r?.ai || {};
      setAiCheck({ loading: false, enabled: !!ai.enabled, provider: ai.provider, model: ai.model });
    }).catch(() => {
      if (!cancelled) setAiCheck({ loading: false, enabled: false, provider: null, model: null });
    });
    return () => { cancelled = true; };
  }, []);

  function pickFiles(e) {
    const list = [...(e.target.files || [])].slice(0, 3);
    setFiles(list);
    if (!name && list[0]) {
      // Pre-fill the template name from the first PDF (sans extension).
      const base = list[0].name.replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ');
      setName(base);
    }
  }

  async function runAnalyze() {
    if (files.length === 0) return;
    setBusy(true);
    setStep(2);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      if (hint) fd.append('prompt', hint);
      if (name) fd.append('name', name);
      const r = await api.upload('/ai/onboard/analyze', fd);
      setAnalysis(r);
      setStep(3);
      const fieldCount = r.proposed_template?.fields?.length ?? 0;
      const recordCount = r.sample_records?.length ?? 0;
      const cost = r.usage?.proposal?.costUsd
        ? ` · $${(r.usage.proposal.costUsd + (r.usage.vision?.costUsd ?? 0)).toFixed(4)}`
        : '';
      if (r.vision_warning) {
        toast.error(`Proposed ${fieldCount} fields but couldn't extract a preview: ${r.vision_warning}`);
      } else {
        toast.success(`AI proposed ${fieldCount} fields and extracted ${recordCount} sample row${recordCount === 1 ? '' : 's'}${cost}.`);
      }
    } catch (e) {
      toast.error(e.message);
      setStep(1);
    } finally { setBusy(false); }
  }

  async function runConfirm(payload) {
    setBusy(true);
    try {
      const r = await api.post('/ai/onboard/confirm', payload);
      toast.success(
        `Template "${r.template?.name}" created. Imported ${r.records_total} record${r.records_total === 1 ? '' : 's'}.`
      );
      onCreated?.(r);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true"
         style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}
         onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}
           style={{ maxWidth: 880, width: '100%', margin: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <IconCpu /> Create template with AI
          </h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="close">
            <IconClose size={14} />
          </button>
        </div>

        <Stepper step={step} />

        {step === 1 && aiCheck.loading && (
          <div className="muted" style={{ padding: 24, textAlign: 'center', fontSize: 13 }}>
            Checking AI configuration…
          </div>
        )}

        {step === 1 && !aiCheck.loading && !aiCheck.enabled && (
          <NoAIStep onSwitchToManual={onSwitchToManual} onClose={onClose} />
        )}

        {step === 1 && !aiCheck.loading && aiCheck.enabled && (
          <UploadStep
            files={files} onPick={pickFiles}
            name={name} setName={setName}
            hint={hint} setHint={setHint}
            onAnalyze={runAnalyze}
            busy={busy}
            onSwitchToManual={onSwitchToManual}
            ai={aiCheck}
          />
        )}

        {step === 2 && <AnalyzingStep files={files} />}

        {step === 3 && analysis && (
          <ReviewStep
            analysis={analysis}
            busy={busy}
            onBack={() => setStep(1)}
            onConfirm={runConfirm}
          />
        )}
      </div>
    </div>
  );
}

function Stepper({ step }) {
  const steps = [
    { n: 1, label: 'Upload PDFs' },
    { n: 2, label: 'Analyze' },
    { n: 3, label: 'Review & create' },
  ];
  return (
    <div style={{
      display: 'flex', gap: 0, margin: '12px 0 18px',
      borderBottom: '1px solid var(--color-border)', paddingBottom: 12,
    }}>
      {steps.map((s, i) => {
        const active = step === s.n;
        const done = step > s.n;
        return (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 24, opacity: done || active ? 1 : 0.55 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, borderRadius: '50%',
              background: active ? 'var(--color-primary)' : done ? 'var(--color-success, #059669)' : 'var(--color-border)',
              color: active || done ? 'white' : 'var(--color-text-soft)',
              fontSize: 12, fontWeight: 600,
            }}>
              {done ? '✓' : s.n}
            </span>
            <span style={{ fontSize: 13, fontWeight: active ? 600 : 500 }}>{s.label}</span>
            {i < steps.length - 1 && (
              <span style={{ width: 20, height: 1, background: 'var(--color-border)', marginLeft: 8 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function NoAIStep({ onSwitchToManual, onClose }) {
  return (
    <div style={{ padding: '14px 8px' }}>
      <div style={{
        padding: 14, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)',
        borderRadius: 6, marginBottom: 16,
      }}>
        <strong style={{ color: '#b91c1c' }}>AI is not configured</strong>
        <div style={{ fontSize: 13, marginTop: 6, color: 'var(--color-text)' }}>
          The AI Onboarding wizard needs a provider (Anthropic, OpenAI, …) and an API key.
          Add yours under Settings → AI, then come back to this wizard.
        </div>
      </div>
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-ghost btn-sm" onClick={onSwitchToManual} type="button">
          Or create a template manually →
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <Link to="/settings" className="btn btn-primary" onClick={onClose}>
            Open Settings
          </Link>
        </div>
      </div>
    </div>
  );
}

function UploadStep({ files, onPick, name, setName, hint, setHint, onAnalyze, busy, onSwitchToManual, ai }) {
  return (
    <>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        Upload 1–3 representative PDFs. {ai?.provider ? <>Using <strong>{ai.provider}</strong>{ai.model ? ` · ${ai.model}` : ''}.</> : null}
        {' '}The provider reads them, proposes a template, and extracts a preview of the data so you can verify it before creating the template.
      </p>

      <div className="field-group">
        <label className="label">PDFs (up to 3)</label>
        <input type="file" multiple accept="application/pdf" onChange={onPick} className="input" />
        {files.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12 }}>
            {files.map((f, i) => (
              <div key={i} className="muted" style={{ fontFamily: 'var(--font-mono)' }}>
                · {f.name} <span>({(f.size / 1024).toFixed(0)} KB)</span>
              </div>
            ))}
          </div>
        )}
        <div className="help">Pick a few PDFs that share the same layout. The first one is also used to preview the extracted data.</div>
      </div>

      <div className="field-group">
        <label className="label">Template name <span className="muted">(optional — AI will suggest one)</span></label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)}
               placeholder="e.g. Aetna Renewals 2025" />
      </div>

      <div className="field-group">
        <label className="label">Anything specific to tell the AI? <span className="muted">(optional)</span></label>
        <textarea className="input" rows={3} value={hint} onChange={(e) => setHint(e.target.value)}
                  placeholder='e.g. "Skip the producer summary at the top. Only rows in the body of the statement count."'
                  style={{ resize: 'vertical', minHeight: 60 }} />
        <div className="help">
          The hint is saved with the template and used on every future import. You can edit it later in template settings.
        </div>
      </div>

      <div className="toolbar" style={{ justifyContent: 'space-between', marginTop: 16, alignItems: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={onSwitchToManual} type="button">
          Prefer click-to-train? Create manually →
        </button>
        <button className="btn btn-primary"
                disabled={busy || files.length === 0}
                onClick={onAnalyze}>
          <IconSpark size={14} /> Analyze with AI
        </button>
      </div>
    </>
  );
}

function AnalyzingStep({ files }) {
  return (
    <div style={{ padding: '24px 8px', textAlign: 'center' }}>
      <div className="spinner" style={{
        width: 36, height: 36, border: '3px solid var(--color-border)',
        borderTopColor: 'var(--color-primary)', borderRadius: '50%',
        margin: '0 auto 18px', animation: 'spin 0.8s linear infinite',
      }} />
      <h4 style={{ marginBottom: 6 }}>AI is analyzing your PDFs…</h4>
      <p className="muted" style={{ fontSize: 13 }}>
        Reading {files.length} PDF{files.length === 1 ? '' : 's'}, proposing fields, and extracting a preview.
        This usually takes 5–20 seconds.
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ReviewStep({ analysis, busy, onBack, onConfirm }) {
  const proposed = analysis.proposed_template || {};
  const [name, setName] = useState(proposed.name || '');
  const [organization, setOrg] = useState(proposed.organization || '');
  const [stateCode, setState] = useState(proposed.state || '');
  const [year, setYear] = useState(proposed.year || '');
  const [category, setCategory] = useState(proposed.category || 'Commission Statement');
  const [fields, setFields] = useState(
    (proposed.fields || []).map((f) => ({
      name: f.name, label: f.label, type: f.type, is_primary: !!f.is_primary,
    }))
  );
  const [extractionPrompt, setExtractionPrompt] = useState(analysis.extraction_prompt || '');
  const [importFiles, setImportFiles] = useState(true);

  function updateField(i, patch) {
    setFields((arr) => arr.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function addField() {
    setFields((arr) => [...arr, { name: '', label: '', type: 'text', is_primary: false }]);
  }
  function removeField(i) { setFields((arr) => arr.filter((_, idx) => idx !== i)); }

  function submit() {
    onConfirm({
      template: {
        name, organization, state: stateCode, category,
        year: year === '' || year == null ? null : Number(year),
        fields: fields.map((f, i) => ({ ...f, sort_order: i })),
      },
      ai_prompt: extractionPrompt,
      ai_provider: analysis.ai?.provider,
      ai_model: analysis.ai?.model,
      // Pass through the regex patterns the AI returned during analyze.
      // Without this, /onboard/confirm sees null and the template can never
      // run free — every future import goes through AI vision.
      learned_patterns: analysis.learned_patterns || null,
      files: analysis.files || [],
      import_files: importFiles,
    });
  }

  const sampleRecords = analysis.sample_records || [];
  const visibleFieldNames = fields.map((f) => f.name);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }}>
      {/* Meta row */}
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="field-group" style={{ flex: '1 1 220px', marginBottom: 0 }}>
          <label className="label">Template name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field-group" style={{ flex: '1 1 200px', marginBottom: 0 }}>
          <label className="label">Organization</label>
          <input className="input" value={organization} onChange={(e) => setOrg(e.target.value)} />
        </div>
        <div className="field-group" style={{ flex: '0 0 130px', marginBottom: 0 }}>
          <label className="label">State</label>
          <input className="input" value={stateCode} onChange={(e) => setState(e.target.value)} />
        </div>
        <div className="field-group" style={{ flex: '0 0 110px', marginBottom: 0 }}>
          <label className="label">Year</label>
          <input className="input" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <div className="field-group" style={{ flex: '1 1 200px', marginBottom: 0 }}>
          <label className="label">Category</label>
          <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
      </div>

      {/* Fields editor */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h4 style={{ margin: 0 }}>Fields proposed by AI</h4>
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
                  <td><input className="input input-sm" value={f.name} onChange={(e) => updateField(i, { name: e.target.value })} /></td>
                  <td><input className="input input-sm" value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} /></td>
                  <td>
                    <select className="input input-sm" value={f.type} onChange={(e) => updateField(i, { type: e.target.value })}>
                      {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td>
                    <input type="checkbox" checked={!!f.is_primary} onChange={(e) => updateField(i, { is_primary: e.target.checked })} />
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-icon" onClick={() => removeField(i)} aria-label="remove">
                      <IconTrash size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {fields.length === 0 && (
                <tr><td colSpan={5} className="muted">No fields. Add at least one to continue.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sample records preview */}
      <div>
        <h4 style={{ margin: '0 0 6px' }}>
          Preview from <code style={{ fontSize: 12 }}>{analysis.sample_pdf || 'first PDF'}</code>
          {sampleRecords.length > 0 && (
            <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>
              · {sampleRecords.length} record{sampleRecords.length === 1 ? '' : 's'}
            </span>
          )}
        </h4>
        {sampleRecords.length === 0 ? (
          <div className="muted" style={{ fontSize: 13, padding: 12, background: 'var(--color-surface-2)', borderRadius: 6 }}>
            {analysis.vision_warning
              ? `No preview available — ${analysis.vision_warning}.`
              : 'AI did not extract any records from the first PDF. The template will still be created; you can adjust the prompt below or import a different file.'}
          </div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}>
            <table className="table table-compact">
              <thead>
                <tr>
                  {visibleFieldNames.map((fn) => <th key={fn}>{fn}</th>)}
                </tr>
              </thead>
              <tbody>
                {sampleRecords.map((r, i) => (
                  <tr key={i}>
                    {visibleFieldNames.map((fn) => (
                      <td key={fn} style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {r.values?.[fn] ?? <span className="muted">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Extraction prompt */}
      <div className="field-group" style={{ marginBottom: 0 }}>
        <label className="label">Extraction prompt <span className="muted">(saved with the template)</span></label>
        <textarea className="input" rows={6}
                  value={extractionPrompt} onChange={(e) => setExtractionPrompt(e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5 }} />
        <div className="help">
          This is the instruction the AI will receive every time you import a PDF for this template.
          Edit freely — be explicit about which rows to skip and how each field should be formatted.
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={importFiles} onChange={(e) => setImportFiles(e.target.checked)} />
        Import these {analysis.files?.length || 0} PDF{(analysis.files?.length || 0) === 1 ? '' : 's'} as the first batch
      </label>

      <div className="toolbar" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <button className="btn btn-secondary" onClick={onBack} disabled={busy}>← Back</button>
        <button className="btn btn-primary" disabled={busy || !name || fields.length === 0 || !extractionPrompt.trim()}
                onClick={submit}>
          <IconCheck size={14} /> {busy ? 'Creating…' : 'Create template'}
        </button>
      </div>
    </div>
  );
}
