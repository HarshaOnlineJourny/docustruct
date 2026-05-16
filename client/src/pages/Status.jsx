import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Empty from '../components/Empty.jsx';
import Stat from '../components/Stat.jsx';
import { IconActivity, IconCpu } from '../components/icons.jsx';

export default function Status() {
  const [batches, setBatches] = useState([]);
  const [docs, setDocs] = useState([]);
  const [aiUsage, setAiUsage] = useState(null);

  function load() {
    api.get('/imports/batches').then(setBatches).catch(() => {});
    api.get('/data/documents').then(setDocs).catch(() => {});
    api.get('/settings/ai/usage').then(setAiUsage).catch(() => {});
  }
  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <div className="page-header">
        <div className="page-title-block">
          <h1>Status</h1>
          <div className="page-subtitle">Live view of import batches and documents — refreshes every 5s.</div>
        </div>
      </div>

      {aiUsage && aiUsage.config && aiUsage.config.enabled && (
        <div className="stat-grid">
          <Stat icon={<IconCpu size={14} />} label="AI provider"
                value={aiUsage.config.provider || '—'}
                sub={aiUsage.config.model || ''} />
          <Stat icon={<IconActivity size={14} />} label="Spend (MTD)"
                value={'$' + (aiUsage.spend ?? 0).toFixed(2)}
                sub={'budget $' + (aiUsage.config.monthlyBudgetUsd ?? 0)} />
          <Stat icon={<IconActivity size={14} />} label="AI calls (recent)"
                value={aiUsage.recent.length} />
          <Stat icon={<IconActivity size={14} />} label="Cache hits"
                value={aiUsage.recent.filter((c) => c.cache_hit).length} />
        </div>
      )}
      <div className="card card-pad-0">
        <div className="card-header"><h3>Batches</h3></div>
        {batches.length === 0 ? (
          <Empty icon={<IconActivity size={28} />} title="No imports yet"
                 message="Once you run an import, it'll appear here." />
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="table table-compact">
              <thead>
                <tr><th>ID</th><th>Template</th><th>Name</th><th>Docs</th><th>Status</th><th>Started</th></tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td>#{b.id}</td>
                    <td>{b.template_name}</td>
                    <td className="muted">{b.name}</td>
                    <td>{b.doc_count}</td>
                    <td><span className={'tag status-' + b.status}>{b.status}</span></td>
                    <td className="muted">{b.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card card-pad-0">
        <div className="card-header"><h3>Documents</h3></div>
        {docs.length === 0 ? (
          <Empty icon={<IconActivity size={28} />} title="No documents"
                 message="Documents appear here as soon as imports begin processing." />
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="table table-compact">
              <thead>
                <tr><th>ID</th><th>Template</th><th>File</th><th>Records</th><th>Status</th><th>Processed</th></tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>#{d.id}</td>
                    <td>{d.template_name}</td>
                    <td>{d.original_name}</td>
                    <td>{d.record_count}</td>
                    <td><span className={'tag status-' + d.status}>{d.status}</span></td>
                    <td className="muted">{d.processed_at || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
