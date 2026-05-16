import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Stat from '../components/Stat.jsx';
import Empty from '../components/Empty.jsx';
import {
  IconLayers, IconFile, IconGrid, IconActivity, IconPlus, IconUpload, IconSpark,
} from '../components/icons.jsx';

// Landing page when the app opens. Shows headline counts and recent batches /
// documents so the user has something to act on, plus quick actions to start
// a new template or run an import.
export default function Dashboard() {
  const [templates, setTemplates] = useState([]);
  const [batches, setBatches] = useState([]);
  const [docs, setDocs] = useState([]);
  const [recordsTotal, setRecordsTotal] = useState(0);

  useEffect(() => {
    api.get('/templates').then(setTemplates).catch(() => {});
    api.get('/imports/batches').then(setBatches).catch(() => {});
    api.get('/data/documents').then(setDocs).catch(() => {});
    // /data/records returns { total, limit, offset, records: [] } — we just
    // need the total here, so ask for limit=0 to skip the row payload.
    api.get('/data/records?limit=0').then((r) => setRecordsTotal(r?.total ?? 0)).catch(() => {});
  }, []);

  const totalRecords = recordsTotal;
  const docCount = docs.length;
  const okDocs = docs.filter((d) => d.status === 'done').length;

  return (
    <>
      <div className="page-header">
        <div className="page-title-block">
          <h1>Welcome to DocuStruct</h1>
          <div className="page-subtitle">
            Define a template, train it on one PDF, and bulk-extract structured data from the rest.
          </div>
        </div>
        <div className="toolbar">
          <Link to="/templates" className="btn btn-secondary">
            <IconPlus /> New template
          </Link>
          <Link to="/import" className="btn btn-primary">
            <IconUpload /> Import PDFs
          </Link>
        </div>
      </div>

      <div className="stat-grid">
        <Stat icon={<IconLayers size={14} />} label="Templates" value={templates.length}
              sub={templates.length === 0 ? 'Create your first one to get started' : null} />
        <Stat icon={<IconFile size={14} />} label="Documents" value={docCount}
              sub={`${okDocs} successfully processed`} />
        <Stat icon={<IconGrid size={14} />} label="Records extracted" value={totalRecords.toLocaleString()} />
        <Stat icon={<IconActivity size={14} />} label="Batches" value={batches.length} />
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="col">
          <div className="card card-pad-0">
            <div className="card-header">
              <h3>Templates</h3>
              <Link to="/templates" className="btn btn-ghost btn-sm">View all →</Link>
            </div>
            {templates.length === 0 ? (
              <Empty
                icon={<IconLayers size={28} />}
                title="No templates yet"
                message="A template defines the carrier / form layout you want to extract. Create one to get started."
                action={<Link to="/templates" className="btn btn-primary">Create template</Link>}
              />
            ) : (
              <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Organization</th>
                      <th>Fields</th>
                      <th>Documents</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.slice(0, 6).map((t) => (
                      <tr key={t.id}>
                        <td><strong>{t.name}</strong></td>
                        <td className="muted">{t.organization || '—'}</td>
                        <td>{t.field_count}</td>
                        <td>{t.document_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="col">
          <div className="card card-pad-0">
            <div className="card-header">
              <h3>Recent batches</h3>
              <Link to="/status" className="btn btn-ghost btn-sm">View all →</Link>
            </div>
            {batches.length === 0 ? (
              <Empty
                icon={<IconUpload size={28} />}
                title="No imports yet"
                message="Once you have a trained template, upload PDFs to extract them in bulk."
                action={
                  <Link to="/training" className="btn btn-secondary">
                    <IconSpark /> Train a template
                  </Link>
                }
              />
            ) : (
              <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Batch</th>
                      <th>Template</th>
                      <th>Docs</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.slice(0, 6).map((b) => (
                      <tr key={b.id}>
                        <td>#{b.id}</td>
                        <td className="muted">{b.template_name}</td>
                        <td>{b.doc_count}</td>
                        <td><span className={'tag status-' + b.status}>{b.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
