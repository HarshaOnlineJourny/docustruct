# Multi-Tenancy Implementation Guide

**Scope**: Enforce `organization_id` filtering across all data routes  
**Risk**: 🔴 DO NOT SKIP — data leakage without this  
**Effort**: ~10-15 developer-hours  
**Testing**: 2-4 hours with cross-tenant test matrix

---

## Part 1: Schema Migration (2-3 hours)

### 1.1 Add `organization_id` to Templates

**File**: `server/src/db.js`

**Current** (line 86-105):
```sql
CREATE TABLE IF NOT EXISTS templates (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  organization        TEXT,        -- ← OLD: unenforceable
  state               TEXT,
  category            TEXT,
  year                INTEGER,
  notes               TEXT,
  extraction_strategy TEXT NOT NULL DEFAULT 'ai_vision',
  ai_prompt           TEXT,
  ai_provider         TEXT,
  ai_model            TEXT,
  learned_patterns    TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**After** (add organization_id FK):
```sql
CREATE TABLE IF NOT EXISTS templates (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id     INTEGER NOT NULL DEFAULT 1
                      REFERENCES organizations(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  organization        TEXT,        -- ← Keep for backwards compat, not used
  state               TEXT,
  category            TEXT,
  year                INTEGER,
  notes               TEXT,
  extraction_strategy TEXT NOT NULL DEFAULT 'ai_vision',
  ai_prompt           TEXT,
  ai_provider         TEXT,
  ai_model            TEXT,
  learned_patterns    TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, name)
);
CREATE INDEX IF NOT EXISTS templates_org_idx ON templates(organization_id);
```

**Why**:
- Add FK to enforce tenant isolation
- Add UNIQUE constraint on (org, name) so each org can have their own "Commission Statement" template
- Add index for fast org filtering

### 1.2 Add `organization_id` to Documents, Batches, Training Samples

**Similar changes**:

```sql
-- For documents
ALTER TABLE documents ADD COLUMN organization_id INTEGER 
  REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX documents_org_idx ON documents(organization_id);

-- For batches
ALTER TABLE batches ADD COLUMN organization_id INTEGER 
  REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX batches_org_idx ON batches(organization_id);

-- For training_samples
ALTER TABLE training_samples ADD COLUMN organization_id INTEGER 
  REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX training_samples_org_idx ON training_samples(organization_id);
```

### 1.3 Migration Function

**Add to `db.js` after line 341** (in the migrations section):

```js
if (installedVersion < 9) {
  // v8 -> v9: Add organization_id to templates, documents, batches, training_samples
  
  // Ensure columns exist
  ensureColumn('templates', 'organization_id', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('documents', 'organization_id', 'INTEGER');
  ensureColumn('batches', 'organization_id', 'INTEGER');
  ensureColumn('training_samples', 'organization_id', 'INTEGER');
  
  // Create indices
  try { db.exec('CREATE INDEX IF NOT EXISTS templates_org_idx ON templates(organization_id)'); }
  catch (e) { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS documents_org_idx ON documents(organization_id)'); }
  catch (e) { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS batches_org_idx ON batches(organization_id)'); }
  catch (e) { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS training_samples_org_idx ON training_samples(organization_id)'); }
  catch (e) { /* already exists */ }
  
  // Backfill: derive org_id from template → document
  db.exec(`
    UPDATE documents 
    SET organization_id = (
      SELECT organization_id FROM templates WHERE id = documents.template_id
    )
    WHERE organization_id IS NULL
  `);
  
  // Backfill: derive org_id from template → batch
  db.exec(`
    UPDATE batches 
    SET organization_id = (
      SELECT organization_id FROM templates WHERE id = batches.template_id
    )
    WHERE organization_id IS NULL
  `);
  
  // Backfill: derive org_id from template → training_samples
  db.exec(`
    UPDATE training_samples 
    SET organization_id = (
      SELECT organization_id FROM templates WHERE id = training_samples.template_id
    )
    WHERE organization_id IS NULL
  `);
}
```

**Update SCHEMA_VERSION** (line 26):
```js
const SCHEMA_VERSION = 9;  // was 8
```

---

## Part 2: Update Query Functions (3-4 hours)

### 2.1 listTemplates() & getTemplate()

**File**: `server/src/db.js` (lines 368-416)

**Before**:
```js
export function listTemplates() {
  const rows = db
    .prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM fields f WHERE f.template_id = t.id) AS field_count,
              (SELECT COUNT(*) FROM documents d WHERE d.template_id = t.id) AS document_count
         FROM templates t
        ORDER BY t.name`
    )
    .all();
  // ...
}

export function getTemplate(id) {
  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  // ...
}
```

**After**:
```js
export function listTemplates(organizationId) {
  const rows = db
    .prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM fields f WHERE f.template_id = t.id) AS field_count,
              (SELECT COUNT(*) FROM documents d WHERE d.template_id = t.id AND d.organization_id = ?) AS document_count
         FROM templates t
        WHERE t.organization_id = ?
        ORDER BY t.name`
    )
    .all(organizationId, organizationId);
  // ...
  return rows;
}

export function getTemplate(id, organizationId) {
  const template = db.prepare(
    'SELECT * FROM templates WHERE id = ? AND organization_id = ?'
  ).get(id, organizationId);
  if (!template) return null;
  
  template.fields = db
    .prepare('SELECT * FROM fields WHERE template_id = ? ORDER BY sort_order, id')
    .all(id);
  return template;
}
```

### 2.2 createTemplate()

**Update** (line 418-473) to capture and store organization_id:

**Before**:
```js
export function createTemplate(input) {
  const {
    name,
    organization,
    state,
    // ...
  } = input;
  const insertTpl = db.prepare(
    `INSERT INTO templates(
       name, organization, state, category, year, notes,
       extraction_strategy, ai_prompt, ai_provider, ai_model, learned_patterns
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
```

**After**:
```js
export function createTemplate(input) {
  const {
    name,
    organization,
    state,
    organizationId,  // ← ADD: required for multi-tenancy
    // ...
  } = input;
  
  if (!organizationId) {
    throw new Error('organizationId required');
  }
  
  const insertTpl = db.prepare(
    `INSERT INTO templates(
       organization_id, name, organization, state, category, year, notes,
       extraction_strategy, ai_prompt, ai_provider, ai_model, learned_patterns
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  
  const tx = db.transaction(() => {
    const { lastInsertRowid: templateId } = insertTpl.run(
      organizationId,  // ← ADD: first parameter
      name,
      organization ?? null,
      state ?? null,
      category ?? null,
      year ?? null,
      notes ?? null,
      extraction_strategy,
      ai_prompt ?? null,
      ai_provider ?? null,
      ai_model ?? null,
      learned_patterns ? (typeof learned_patterns === 'string' ? learned_patterns : JSON.stringify(learned_patterns)) : null
    );
    // ... rest of function
    return templateId;
  });
  return getTemplate(tx(), organizationId);  // ← Pass org_id to getTemplate
}
```

### 2.3 listDocuments() & listRecords()

**File**: `server/src/db.js` (lines 491-585)

**Before**:
```js
export function listDocuments(filter = {}) {
  const where = [];
  const params = [];
  if (filter.template_id) {
    where.push('d.template_id = ?');
    params.push(filter.template_id);
  }
  // ... more filters
  const sql = `
    SELECT d.*, t.name AS template_name
      FROM documents d
      JOIN templates t ON t.id = d.template_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY d.created_at DESC`;
  return db.prepare(sql).all(...params);
}
```

**After**:
```js
export function listDocuments(filter = {}, organizationId) {
  if (!organizationId) throw new Error('organizationId required');
  
  const where = ['d.organization_id = ?'];
  const params = [organizationId];
  
  if (filter.template_id) {
    where.push('d.template_id = ?');
    params.push(filter.template_id);
  }
  if (filter.status) {
    where.push('d.status = ?');
    params.push(filter.status);
  }
  if (filter.batch_id) {
    where.push('d.batch_id = ?');
    params.push(filter.batch_id);
  }
  
  const sql = `
    SELECT d.*, t.name AS template_name
      FROM documents d
      JOIN templates t ON t.id = d.template_id
     WHERE ${where.join(' AND ')}
     ORDER BY d.created_at DESC`;
  
  return db.prepare(sql).all(...params);
}

export function listRecords(filter = {}, organizationId) {
  if (!organizationId) throw new Error('organizationId required');
  
  const where = ['d.organization_id = ?'];
  const params = [organizationId];
  
  if (filter.template_id) {
    where.push('r.template_id = ?');
    params.push(filter.template_id);
  }
  if (filter.document_id) {
    where.push('r.document_id = ?');
    params.push(filter.document_id);
  }
  if (filter.year) {
    where.push('t.year = ?');
    params.push(filter.year);
  }
  if (filter.status) {
    where.push('d.status = ?');
    params.push(filter.status);
  }
  if (filter.from_date) {
    where.push('d.created_at >= ?');
    params.push(filter.from_date);
  }
  if (filter.to_date) {
    where.push('d.created_at <= ?');
    params.push(filter.to_date);
  }
  
  // Remove old 'organization' TEXT filter (no longer used)
  // if (filter.organization) { ... }
  
  const sql = `
    SELECT r.id, r.row_index, r.confidence, r.document_id, r.source_text,
           d.original_name, d.status AS document_status,
           t.id AS template_id, t.name AS template_name,
           t.organization, t.year
      FROM records r
      JOIN documents d ON d.id = r.document_id
      JOIN templates t ON t.id = r.template_id
     WHERE ${where.join(' AND ')}
     ORDER BY r.created_at DESC, r.row_index`;
  
  const rows = db.prepare(sql).all(...params);
  
  if (rows.length === 0) return [];
  
  // ... rest of function (field value hydration)
}
```

### 2.4 saveExtraction()

**File**: `server/src/db.js` (line 587)

**Before**:
```js
export function saveExtraction(documentId, templateId, extraction) {
  // ...
}
```

**After**:
```js
export function saveExtraction(documentId, templateId, extraction, organizationId) {
  if (!organizationId) throw new Error('organizationId required');
  
  // Validate ownership
  const doc = db.prepare('SELECT organization_id FROM documents WHERE id = ?').get(documentId);
  if (!doc || doc.organization_id !== organizationId) {
    throw new Error('Document not found or unauthorized');
  }
  
  // ... rest of function
}
```

---

## Part 3: Update Routes (5-7 hours)

### 3.1 Templates Routes

**File**: `server/src/routes/templates.js`

```js
// Before: router.get('/', (_req, res) => { ... })
// After:
router.get('/', (req, res) => {
  const templates = listTemplates(req.organization_id);
  res.json(templates);
});

// Before: router.get('/:id', (req, res) => { ... })
// After:
router.get('/:id', (req, res) => {
  const t = getTemplate(Number(req.params.id), req.organization_id);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  
  const samples = db
    .prepare(
      `SELECT id, original_name, file_path, created_at,
              (SELECT COUNT(*) FROM training_mappings tm WHERE tm.sample_id = ts.id) AS mapping_count
         FROM training_samples ts
        WHERE ts.template_id = ? AND ts.organization_id = ?
        ORDER BY ts.created_at`
    )
    .all(t.id, req.organization_id);
  
  const mappings = db
    .prepare(
      `SELECT tm.* FROM training_mappings tm
        JOIN training_samples ts ON ts.id = tm.sample_id
        WHERE ts.template_id = ? AND ts.organization_id = ?`
    )
    .all(t.id, req.organization_id);
  
  t.samples = samples;
  t.mappings = mappings;
  return res.json(t);
});

// Before: router.post('/', (req, res) => { ... })
// After:
router.post('/', (req, res) => {
  const { name, fields } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!Array.isArray(fields) || fields.length === 0) {
    return res.status(400).json({ error: 'at least one field is required' });
  }
  
  const created = createTemplate({
    ...req.body,
    organizationId: req.organization_id  // ← ADD: pass org_id
  });
  
  res.status(201).json(created);
});

// Before: router.patch('/:id', (req, res) => { ... })
// After:
router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare(
    'SELECT id FROM templates WHERE id = ? AND organization_id = ?'  // ← ADD: org check
  ).get(id, req.organization_id);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  
  // ... rest of update logic
});

// Before: router.delete('/:id', (req, res) => { ... })
// After:
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  
  // Verify ownership before delete
  const t = db.prepare(
    'SELECT id FROM templates WHERE id = ? AND organization_id = ?'
  ).get(id, req.organization_id);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  
  const result = db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});
```

### 3.2 Data Routes (Critical)

**File**: `server/src/routes/data.js`

```js
// Before: router.get('/records', (req, res) => { ... })
// After:
router.get('/records', (req, res) => {
  // Validate template ownership if template_id is provided
  let templateId = req.query.template_id ? Number(req.query.template_id) : undefined;
  if (templateId) {
    const tpl = db.prepare(
      'SELECT id FROM templates WHERE id = ? AND organization_id = ?'
    ).get(templateId, req.organization_id);
    if (!tpl) {
      return res.status(404).json({ error: 'Template not found' });
    }
  }
  
  const filter = {
    template_id: templateId,
    document_id: req.query.document_id ? Number(req.query.document_id) : undefined,
    year: req.query.year ? Number(req.query.year) : undefined,
    status: req.query.status || undefined,
    from_date: req.query.from_date || undefined,
    to_date: req.query.to_date || undefined,
    // REMOVED: organization: req.query.organization (no longer used)
  };
  
  let records = listRecords(filter, req.organization_id);  // ← Pass org_id
  
  // ... rest of filtering
  
  res.json({
    total,
    limit,
    offset,
    records: records.slice(offset, offset + limit),
  });
});

// Before: router.post('/records/delete', ...)
// After:
router.post('/records/delete', express.json({ limit: '1mb' }), (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'ids[] required' });
  
  // Verify all records belong to user's org before deleting
  const ownershipCheck = db.prepare(`
    SELECT COUNT(*) as count FROM records r
    JOIN documents d ON d.id = r.document_id
    WHERE r.id IN (${ids.map(() => '?').join(',')})
    AND d.organization_id = ?
  `).get(...ids, req.organization_id);
  
  if (ownershipCheck.count !== ids.length) {
    return res.status(403).json({ error: 'Cannot delete records from other organizations' });
  }
  
  const placeholders = ids.map(() => '?').join(',');
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM records WHERE id IN (${placeholders})`).run(...ids);
  });
  tx();
  res.json({ ok: true, deleted: ids.length });
});

// Before: router.post('/corrections', ...)
// After:
router.post('/corrections', (req, res) => {
  const { record_id, field_id, new_value } = req.body;
  if (!record_id || !field_id) {
    return res.status(400).json({ error: 'record_id and field_id required' });
  }
  
  // Verify record belongs to user's org
  const recordCheck = db.prepare(`
    SELECT r.id FROM records r
    JOIN documents d ON d.id = r.document_id
    WHERE r.id = ? AND d.organization_id = ?
  `).get(record_id, req.organization_id);
  
  if (!recordCheck) {
    return res.status(403).json({ error: 'Record not found or unauthorized' });
  }
  
  // ... rest of correction logic
});

// Before: router.get('/export.csv', ...)
// After:
router.get('/export.csv', (req, res) => {
  let templateId = req.query.template_id ? Number(req.query.template_id) : undefined;
  if (templateId) {
    const tpl = db.prepare(
      'SELECT id FROM templates WHERE id = ? AND organization_id = ?'
    ).get(templateId, req.organization_id);
    if (!tpl) {
      return res.status(404).json({ error: 'Template not found' });
    }
  }
  
  const filter = {
    template_id: templateId,
    year: req.query.year ? Number(req.query.year) : undefined,
    // REMOVED: organization filter
  };
  
  const records = listRecords(filter, req.organization_id);  // ← Pass org_id
  
  // ... rest of export logic
});
```

### 3.3 Settings Routes (Critical)

**File**: `server/src/routes/settings.js`

```js
// Before: router.get('/', (_req, res) => { ... })
// After:
router.get('/', (req, res) => {
  res.json({
    settings: getAllSettings({ organizationId: req.organization_id }),  // ← Use req.organization_id
    ai: aiStatus({ organizationId: req.organization_id }),
  });
});

// Before: router.post('/ai', (req, res) => { ... })
// After:
router.post('/ai', (req, res) => {
  const allowed = [
    'enabled', 'provider', 'model', 'api_key',
    'confidence_threshold', 'max_calls_per_import', 'monthly_budget_usd',
  ];
  const body = req.body || {};
  for (const k of allowed) {
    if (!(k in body)) continue;
    let v = body[k];
    if (k === 'api_key' && (v === '' || v === '••••')) continue;
    if (v === '') v = null;
    setSetting('ai.' + k, v, { organizationId: req.organization_id });  // ← Use req.organization_id
  }
  res.json({ ok: true, ai: aiStatus({ organizationId: req.organization_id }) });
});

// Before: router.get('/ai/usage', ...)
// After:
router.get('/ai/usage', (req, res) => {
  const org = req.organization_id;
  const config = getAIConfig({ organizationId: org });
  res.json({
    spend: aiStatus({ organizationId: org }).spend_month_to_date,
    recent: recentCalls({ organizationId: org, limit: 50 }),
    config: { ...config, apiKey: config.apiKey ? '••••' : null },
  });
});
```

### 3.4 Extraction Routes

**File**: `server/src/routes/extraction.js` (lines 37-42)

```js
// Before:
router.post('/:templateId/preview', upload.single('file'), async (req, res, next) => {
  const templateId = Number(req.params.templateId);
  const template = templateWithMappings(templateId);
  if (!template) return res.status(404).json({ error: 'Template not found' });

// After:
router.post('/:templateId/preview', upload.single('file'), async (req, res, next) => {
  const templateId = Number(req.params.templateId);
  
  // Verify ownership before extraction (prevents burning other org's budget)
  const template = db.prepare(
    'SELECT * FROM templates WHERE id = ? AND organization_id = ?'
  ).get(templateId, req.organization_id);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  
  const templateWithMappings = (() => {
    template.mappings = db
      .prepare(
        `SELECT tm.* FROM training_mappings tm
          JOIN training_samples ts ON ts.id = tm.sample_id
          WHERE ts.template_id = ? AND ts.organization_id = ?`
      )
      .all(templateId, req.organization_id);
    return template;
  })();
  
  if (!req.file) return res.status(400).json({ error: 'file required' });
  
  // ... rest of extraction logic
```

### 3.5 Training & Imports Routes

**File**: `server/src/routes/training.js`

Add similar ownership checks:

```js
// Before any document/template access:
const template = db.prepare(
  'SELECT * FROM templates WHERE id = ? AND organization_id = ?'
).get(templateId, req.organization_id);

if (!template) {
  return res.status(404).json({ error: 'Template not found' });
}
```

**File**: `server/src/routes/imports.js`

```js
// Before importing, validate batch/template ownership:
const batch = db.prepare(
  'SELECT b.* FROM batches b
   JOIN templates t ON t.id = b.template_id
   WHERE b.id = ? AND t.organization_id = ?'
).get(batchId, req.organization_id);

if (!batch) {
  return res.status(404).json({ error: 'Batch not found or unauthorized' });
}
```

**File**: `server/src/routes/aiTemplates.js`

Similar validation for template ownership before AI operations.

---

## Part 4: Middleware Enhancement (30 min)

### 4.1 Add Organization Context Validation

**File**: `server/src/middleware/auth.js`

```js
// Add new middleware to validate org context
export function validateOrgContext(req, res, next) {
  if (!req.organization_id || !Number.isInteger(req.organization_id)) {
    return res.status(401).json({ error: 'Invalid organization context' });
  }
  next();
}
```

**File**: `server/src/index.js` (line 61-67)

```js
// Add validateOrgContext to all protected routes
app.use('/api/templates', authenticate, validateOrgContext, templatesRouter);
app.use('/api/training', authenticate, validateOrgContext, trainingRouter);
app.use('/api/extraction', authenticate, validateOrgContext, extractionRouter);
app.use('/api/imports', authenticate, validateOrgContext, importsRouter);
app.use('/api/data', authenticate, validateOrgContext, dataRouter);
app.use('/api/settings', authenticate, validateOrgContext, settingsRouter);
app.use('/api/ai', authenticate, validateOrgContext, aiTemplatesRouter);
```

---

## Part 5: Testing Matrix (2-4 hours)

### Test Plan

Create file: `server/tests/multitenant.test.js`

```js
import test from 'node:test';
import assert from 'node:assert';
import { getTemplate, listTemplates, listRecords } from '../src/db.js';

test('Multi-tenancy: Organization Isolation', async (t) => {
  // Setup: Create two orgs with templates
  const org1Id = 1;
  const org2Id = 2;
  
  // Test 1: Each org sees only their templates
  await t.test('listTemplates filters by org_id', () => {
    const org1Templates = listTemplates(org1Id);
    const org2Templates = listTemplates(org2Id);
    
    org1Templates.forEach(t => assert.strictEqual(t.organization_id, org1Id));
    org2Templates.forEach(t => assert.strictEqual(t.organization_id, org2Id));
    assert(org1Templates.length > 0, 'Org 1 should have templates');
    assert(org2Templates.length > 0, 'Org 2 should have templates');
  });
  
  // Test 2: getTemplate returns 404 for cross-org access
  await t.test('getTemplate returns null for wrong org', () => {
    const org1Template = listTemplates(org1Id)[0];
    const accessed = getTemplate(org1Template.id, org2Id);
    assert.strictEqual(accessed, null, 'Org 2 should not see Org 1 template');
  });
  
  // Test 3: Records filtered by org
  await t.test('listRecords filters by org_id', () => {
    const org1Records = listRecords({}, org1Id);
    const org2Records = listRecords({}, org2Id);
    
    org1Records.forEach(r => {
      const doc = db.prepare('SELECT organization_id FROM documents WHERE id = ?').get(r.document_id);
      assert.strictEqual(doc.organization_id, org1Id);
    });
  });
  
  // Test 4: Settings isolated by org
  await t.test('getAllSettings filters by org_id', () => {
    setSetting('ai.provider', 'openai', { organizationId: org1Id });
    setSetting('ai.provider', 'anthropic', { organizationId: org2Id });
    
    const org1Settings = getAllSettings({ organizationId: org1Id });
    const org2Settings = getAllSettings({ organizationId: org2Id });
    
    assert.strictEqual(org1Settings['ai.provider'], 'openai');
    assert.strictEqual(org2Settings['ai.provider'], 'anthropic');
  });
});

test('Multi-tenancy: Route-level Enforcement', async (t) => {
  // Simulate requests from different orgs
  const org1Request = { organization_id: 1 };
  const org2Request = { organization_id: 2 };
  
  // Create templates in each org
  const org1Template = createTemplate({
    name: 'Test Template Org1',
    fields: [{ name: 'test', label: 'Test', type: 'text' }],
    organizationId: 1,
  });
  
  const org2Template = createTemplate({
    name: 'Test Template Org2',
    fields: [{ name: 'test', label: 'Test', type: 'text' }],
    organizationId: 2,
  });
  
  // Test that Org 2 cannot fetch Org 1's template
  await t.test('Org 2 user cannot fetch Org 1 template', () => {
    const template = getTemplate(org1Template.id, org2Request.organization_id);
    assert.strictEqual(template, null);
  });
  
  // Test that each org creates templates in their namespace
  await t.test('Templates are isolated by organization', () => {
    const org1Templates = listTemplates(org1Request.organization_id);
    const org2Templates = listTemplates(org2Request.organization_id);
    
    const org1Ids = new Set(org1Templates.map(t => t.id));
    const org2Ids = new Set(org2Templates.map(t => t.id));
    
    assert(!org1Ids.has(org2Template.id), 'Org 1 should not see Org 2 template');
    assert(!org2Ids.has(org1Template.id), 'Org 2 should not see Org 1 template');
  });
});
```

### Manual Testing Checklist

```
✅ Org A user: GET /api/templates → only sees Org A templates
✅ Org B user: GET /api/templates → only sees Org B templates
✅ Org A user: GET /api/templates/999 (Org B template) → 404
✅ Org A user: GET /api/data/records → only sees Org A records
✅ Org A user: POST /api/data/corrections (Org B record) → 403
✅ Org A user: DELETE /api/templates/999 (Org B template) → 404
✅ Org A user: GET /api/settings → only sees Org A AI config
✅ Org A user: POST /api/settings/ai → only modifies Org A config
✅ Org A user: POST /api/extraction/999/preview → 404 for Org B template
✅ Cost isolation: Org A extraction uses Org A's AI budget, not Org B's
```

---

## Deployment Checklist

- [ ] **Backup production database** before schema migration
- [ ] **Test migrations locally** with current data
- [ ] **Verify backfill query** for documents/batches/training_samples
- [ ] **Run test matrix** in staging
- [ ] **Update API docs** (templates.organizationId now required)
- [ ] **Brief support team** on tenant isolation
- [ ] **Monitor** for errors after deploy (check logs for "organizationId required")
- [ ] **Smoke test** all routes with different session cookies

---

## Files Changed Summary

| File | Changes | Lines |
|------|---------|-------|
| `db.js` | Schema (v9), queries (15+ functions), backfill logic | 80+ |
| `routes/templates.js` | org_id filtering (6 endpoints) | 30+ |
| `routes/data.js` | org_id filtering, ownership checks (5 endpoints) | 40+ |
| `routes/extraction.js` | Ownership validation (2 endpoints) | 15+ |
| `routes/settings.js` | Use req.organization_id (4 endpoints) | 10+ |
| `routes/training.js` | Ownership checks (varies) | 20+ |
| `routes/imports.js` | Ownership checks (varies) | 20+ |
| `middleware/auth.js` | Add validateOrgContext | 10 |
| `index.js` | Add middleware to protected routes | 5 |

**Total**: ~250 lines of code changes, ~2-3 hours per file (reading → understanding → editing → testing).

---

## Rollback Plan

If issues arise:

1. **Stop server**
2. **Restore database backup**
3. **Revert code commits**
4. **Restart server**

No data loss; migration is backward-compatible (old queries still work, new queries enforce org_id).

---

## Success Criteria

✅ Each organization can only see their own:
- Templates
- Documents & records
- Training samples
- Settings & API keys
- AI usage & costs

✅ Cross-tenant requests return 404, not errors
✅ Cross-tenant deletions are blocked with 403
✅ Test matrix passes 100%
✅ Performance: no degradation (indices on org_id)
✅ Error logs: zero "organizationId required" after deploy
