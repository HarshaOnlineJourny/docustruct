import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { IconCpu, IconCheck, IconAlert, IconInfo } from '../components/icons.jsx';

// Settings page. Today: AI provider configuration (BYO key) + cost meter.
// In the future: organization branding, user management, retention policies.
export default function Settings() {
  const [providers, setProviders] = useState([]);
  const [ai, setAi] = useState(null);
  const [usage, setUsage] = useState(null);
  const [form, setForm] = useState({
    enabled: false, provider: '', model: '', api_key: '',
    confidence_threshold: 0.6, max_calls_per_import: 50, monthly_budget_usd: 5,
  });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  function load() {
    api.get('/settings').then((r) => {
      setAi(r.ai);
      setForm((f) => ({
        ...f,
        enabled: r.settings['ai.enabled'] ?? false,
        provider: r.settings['ai.provider'] ?? '',
        model: r.settings['ai.model'] ?? '',
        api_key: '', // never preload
        confidence_threshold: r.settings['ai.confidence_threshold'] ?? 0.6,
        max_calls_per_import: r.settings['ai.max_calls_per_import'] ?? 50,
        monthly_budget_usd: r.settings['ai.monthly_budget_usd'] ?? 5,
      }));
    });
    api.get('/settings/ai/providers').then(setProviders);
    api.get('/settings/ai/usage').then(setUsage);
  }
  useEffect(load, []);

  const selectedProvider = providers.find((p) => p.id === form.provider);
  const models = selectedProvider?.models || [];

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const ct = Math.max(0, Math.min(1, Number(form.confidence_threshold) || 0));
      const mc = Math.max(0, Math.floor(Number(form.max_calls_per_import) || 0));
      const mb = Math.max(0, Number(form.monthly_budget_usd) || 0);
      if (form.enabled && (!form.provider || !form.model)) {
        toast.error('Pick a provider and model before enabling AI escalation.');
        setBusy(false);
        return;
      }
      await api.post('/settings/ai', {
        enabled: !!form.enabled,
        provider: form.provider || null,
        model: form.model || null,
        api_key: form.api_key, // empty string = leave unchanged
        confidence_threshold: ct,
        max_calls_per_import: mc,
        monthly_budget_usd: mb,
      });
      toast.success('AI settings saved');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title-block">
          <h1>Settings</h1>
          <div className="page-subtitle">
            Configure the AI escalation layer. The deterministic engine always
            runs first; AI only kicks in when configured AND the cheaper
            layers can't confidently extract a cell.
          </div>
        </div>
      </div>

      {ai && (
        <div className={'banner ' + (ai.enabled ? 'banner-info' : 'banner-warning')}>
          {ai.enabled ? <IconCheck className="banner-icon" /> : <IconAlert className="banner-icon" />}
          <div>
            {ai.enabled ? (
              <>
                <strong>AI escalation is active.</strong> Provider <code>{ai.provider}</code>{' '}
                · model <code>{ai.model}</code> · ${ai.spend_month_to_date.toFixed(2)} / ${ai.monthly_budget_usd} this month.
              </>
            ) : (
              <>
                <strong>AI escalation is off.</strong> Add a provider, paste an API key, and
                enable below to use AI for low-confidence cells.
              </>
            )}
          </div>
        </div>
      )}

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="col">
          <form onSubmit={save} className="card">
            <h3 style={{ marginBottom: 16 }}>
              <IconCpu /> &nbsp; AI provider
            </h3>

            <div className="field-group">
              <label className="label">Provider</label>
              <select className="input" value={form.provider}
                      onChange={(e) => setForm({ ...form, provider: e.target.value, model: '' })}>
                <option value="">— Select a provider —</option>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="help">
                Bring your own key — DocuStruct does not pass through your token to anyone else.
              </div>
            </div>

            {selectedProvider && (
              <div className="field-group">
                <label className="label">Model</label>
                <select className="input" value={form.model}
                        onChange={(e) => setForm({ ...form, model: e.target.value })}>
                  <option value="">— Pick a model —</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} — ${m.costPer1MInput} in / ${m.costPer1MOutput} out per 1M tokens
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="field-group">
              <label className="label">API key</label>
              <input type="password" className="input"
                     placeholder={ai?.enabled ? '•••• (saved — leave blank to keep)' : 'Paste your API key'}
                     value={form.api_key}
                     onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
              <div className="help">
                Encrypted at rest with AES-256-GCM. Empty input means "leave the saved key unchanged".
              </div>
            </div>

            <div className="row">
              <div className="field-group col">
                <label className="label">Confidence threshold</label>
                <input className="input" type="number" min="0" max="1" step="0.05"
                       value={form.confidence_threshold}
                       onChange={(e) => setForm({ ...form, confidence_threshold: e.target.value })} />
                <div className="help">Cells below this confidence escalate to AI. Default 0.6.</div>
              </div>
              <div className="field-group col">
                <label className="label">Max AI calls per import</label>
                <input className="input" type="number" min="0"
                       value={form.max_calls_per_import}
                       onChange={(e) => setForm({ ...form, max_calls_per_import: e.target.value })} />
                <div className="help">Hard cap so a hostile PDF can't blow your budget.</div>
              </div>
              <div className="field-group col">
                <label className="label">Monthly budget (USD)</label>
                <input className="input" type="number" min="0" step="0.5"
                       value={form.monthly_budget_usd}
                       onChange={(e) => setForm({ ...form, monthly_budget_usd: e.target.value })} />
                <div className="help">AI calls stop once this is reached.</div>
              </div>
            </div>

            <div className="field-group" style={{ marginBottom: 0 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!form.enabled}
                       onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                <span><strong>Enable AI escalation</strong> &nbsp;
                  <span className="muted">Off = deterministic only.</span>
                </span>
              </label>
            </div>

            <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </form>
        </div>

        <aside style={{ width: 360, flex: 'none' }}>
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Usage this month</h3>
            <div className="stat" style={{ padding: 12, marginBottom: 12 }}>
              <div className="stat-label">Spend</div>
              <div className="stat-value">${(usage?.spend ?? 0).toFixed(2)}</div>
              <div className="stat-sub">budget ${ai?.monthly_budget_usd ?? 0}</div>
            </div>
            <h4 style={{ marginBottom: 8 }}>Recent calls</h4>
            {(!usage || usage.recent.length === 0) ? (
              <div className="muted" style={{ fontSize: 12 }}>No AI calls yet.</div>
            ) : (
              <div className="table-wrap">
                <table className="table table-compact">
                  <thead><tr><th>When</th><th>Task</th><th>$</th></tr></thead>
                  <tbody>
                    {usage.recent.slice(0, 8).map((c) => (
                      <tr key={c.id}>
                        <td className="muted">{c.created_at?.slice(0, 16)}</td>
                        <td>{c.task}{c.cache_hit ? ' (cache)' : ''}</td>
                        <td>{c.cost_usd != null ? '$' + c.cost_usd.toFixed(4) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h4 style={{ marginBottom: 6 }}>
              <IconInfo /> &nbsp; How this works
            </h4>
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
              DocuStruct runs three extraction layers in order:
            </p>
            <ol className="muted" style={{ fontSize: 12.5, paddingLeft: 18, marginTop: 0 }}>
              <li><strong>Deterministic</strong> — token slice + anchors. Free, instant.</li>
              <li><strong>Learned patterns</strong> — per-template historical winners. Free.</li>
              <li><strong>AI</strong> — only when L1+L2 confidence falls below the threshold above.</li>
            </ol>
          </div>
        </aside>
      </div>
    </>
  );
}
