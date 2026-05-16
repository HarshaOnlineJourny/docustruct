// SQLite setup. We use better-sqlite3 for synchronous, ergonomic queries — DocuStruct
// is local-first and single-process, so we don't need a connection pool or async ORM.
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DATA_DIR = path.resolve(__dirname, '..', 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const SAMPLES_DIR = path.join(DATA_DIR, 'samples');
const DB_PATH = path.join(DATA_DIR, 'docustruct.sqlite');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(SAMPLES_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Schema -----------------------------------------------------------------
// Versioned manually for now. Bump SCHEMA_VERSION + add migration if you change
// anything below.
const SCHEMA_VERSION = 9;

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Auth: Organizations (tenants)
  CREATE TABLE IF NOT EXISTS organizations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Auth: Users
  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'operator'
                    CHECK (role IN ('admin','operator','viewer')),
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS users_org_idx ON users(organization_id);
  CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);

  -- Auth: Sessions
  CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    expires_at      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS sessions_org_idx ON sessions(organization_id);

  -- Auth: Encrypted secrets (API keys, etc.)
  CREATE TABLE IF NOT EXISTS org_secrets (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key             TEXT NOT NULL,
    encrypted_value TEXT NOT NULL,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(organization_id, key)
  );

  -- A template captures the carrier / form layout the user wants to extract.
  --
  -- extraction_strategy:
  --   'ai_vision' (default): templates created by the AI Onboarding Wizard.
  --                          Imports skip the deterministic engine and call
  --                          the LLM directly with the saved ai_prompt.
  --   'manual':              click-to-train templates that go through the
  --                          deterministic + learned-pattern engine, with
  --                          AI escalation as a fallback.
  CREATE TABLE IF NOT EXISTS templates (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id     INTEGER NOT NULL DEFAULT 1
                          REFERENCES organizations(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    organization        TEXT,        -- e.g. "Messer Financial Group" (legacy, not enforced)
    state               TEXT,        -- e.g. "FL" or NULL for multi-state
    category            TEXT,        -- e.g. "Commission Statement"
    year                INTEGER,
    notes               TEXT,
    extraction_strategy TEXT NOT NULL DEFAULT 'ai_vision'
                          CHECK (extraction_strategy IN ('ai_vision','manual')),
    ai_prompt           TEXT,        -- the per-template extraction prompt
                                     -- the LLM was given during onboarding
    ai_provider         TEXT,        -- 'anthropic' (default), 'openai', etc.
    ai_model            TEXT,        -- e.g. 'claude-sonnet-4-5'
    learned_patterns    TEXT,        -- JSON: regex patterns learned during
                                     -- AI onboarding so future imports of
                                     -- similar PDFs run free (no AI call)
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS templates_org_idx ON templates(organization_id);

  -- Output fields the user wants extracted for this template.
  CREATE TABLE IF NOT EXISTS fields (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id  INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,           -- machine name (snake_case)
    label        TEXT NOT NULL,           -- display label
    type         TEXT NOT NULL CHECK (type IN ('text','number','date','amount')),
    is_primary   INTEGER NOT NULL DEFAULT 0,  -- if set, used to detect record blocks
    sort_order   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(template_id, name)
  );

  -- A training sample: one PDF that the user used to teach the template.
  CREATE TABLE IF NOT EXISTS training_samples (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL DEFAULT 1
                      REFERENCES organizations(id) ON DELETE CASCADE,
    template_id     INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    file_path       TEXT NOT NULL,    -- under data/uploads or data/samples
    original_name   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS training_samples_org_idx ON training_samples(organization_id);

  -- Per-field selection the user made on the training sample.
  --   selection_text       the cell text the user clicked (e.g. "RAY, JENNIFER")
  --   prototype_line_text  the full text of the row the cell came from
  --   column_index         ordinal column in the prototype's column layout
  --                        (set whenever multiple fields share a prototype line)
  --   line_index, page_index   prototype location in the training sample
  --   anchor_text/kind     nearest header or label string for document-mode fallback
  -- Per-field selection the user made on the training sample.
  --   selection_text       the joined token text the user picked (e.g. "RAY, JENNIFER")
  --   prototype_line_text  the full text of the row the cell came from
  --   column_index         ordinal column in the page-level canonical layout
  --   token_start/_end     0-based inclusive token range WITHIN the cell, used
  --                        when one cell holds multiple field values (e.g. a
  --                        row where buildColumns merges policy_no + holder)
  --   line_index, page_index   prototype location in the training sample
  --   anchor_text/kind     nearest header / label string for document-mode fallback
  CREATE TABLE IF NOT EXISTS training_mappings (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id           INTEGER NOT NULL REFERENCES training_samples(id) ON DELETE CASCADE,
    field_id            INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    selection_text      TEXT NOT NULL,
    prototype_line_text TEXT,
    column_index        INTEGER,
    token_start         INTEGER,
    token_end           INTEGER,
    line_index          INTEGER,
    page_index          INTEGER,
    column_start        INTEGER,
    column_end          INTEGER,
    anchor_text         TEXT,
    anchor_kind         TEXT,
    UNIQUE(sample_id, field_id)
  );

  -- Each PDF the user imports. Tracked at document level.
  CREATE TABLE IF NOT EXISTS documents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL DEFAULT 1
                      REFERENCES organizations(id) ON DELETE CASCADE,
    template_id     INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    batch_id        INTEGER REFERENCES batches(id) ON DELETE SET NULL,
    file_path       TEXT NOT NULL,
    original_name   TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','done','needs_ocr','failed')),
    page_count      INTEGER,
    record_count    INTEGER NOT NULL DEFAULT 0,
    warnings        TEXT,            -- JSON array
    error_message   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS documents_org_idx ON documents(organization_id);

  -- A batch is a group of documents imported together.
  CREATE TABLE IF NOT EXISTS batches (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL DEFAULT 1
                      REFERENCES organizations(id) ON DELETE CASCADE,
    template_id     INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    name            TEXT,
    status          TEXT NOT NULL DEFAULT 'processing'
                    CHECK (status IN ('processing','done','partial','failed')),
    doc_count       INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at     TEXT
  );
  CREATE INDEX IF NOT EXISTS batches_org_idx ON batches(organization_id);

  -- One record per detected row inside a document. Document-level extractions
  -- produce exactly one record with row_index=0.
  CREATE TABLE IF NOT EXISTS records (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id  INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    template_id  INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    row_index    INTEGER NOT NULL,
    confidence   REAL,
    source_text  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS records_document_idx ON records(document_id);
  CREATE INDEX IF NOT EXISTS records_template_idx ON records(template_id);

  -- Per-(record, field) value with provenance.
  CREATE TABLE IF NOT EXISTS record_values (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id   INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    field_id    INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    value       TEXT,
    raw_text    TEXT,             -- original substring from the PDF
    source      TEXT,             -- 'anchor' | 'label' | 'document' | 'manual'
    confidence  REAL,
    UNIQUE(record_id, field_id)
  );

  CREATE INDEX IF NOT EXISTS record_values_field_idx ON record_values(field_id);

  -- User corrections. Acts as both an audit trail and training signal.
  CREATE TABLE IF NOT EXISTS corrections (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id    INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    field_id     INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    old_value    TEXT,
    new_value    TEXT,
    corrected_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Settings store. Keyed by (organization_id, key) so multi-tenancy can
  -- be added later without changing call sites — single-tenant uses org_id=1.
  -- Values are JSON-encoded. Secrets (anything with key like '%_api_key' or
  -- starting with 'secret.') are encrypted at rest.
  CREATE TABLE IF NOT EXISTS settings (
    organization_id  INTEGER NOT NULL DEFAULT 1,
    key              TEXT NOT NULL,
    value            TEXT,
    is_secret        INTEGER NOT NULL DEFAULT 0,
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (organization_id, key)
  );

  -- Per-(template, field) counters. Drives the historical confidence model
  -- and surfaces "this field is X% accurate on this template" badges in the
  -- UI. Bumped by saveExtraction (extractions), the corrections route
  -- (corrections), and the AI escalation pass (ai_escalations).
  CREATE TABLE IF NOT EXISTS field_stats (
    template_id    INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    field_id       INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    extractions    INTEGER NOT NULL DEFAULT 0,
    corrections    INTEGER NOT NULL DEFAULT 0,
    ai_escalations INTEGER NOT NULL DEFAULT 0,
    last_updated   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (template_id, field_id)
  );
  -- Audit log for every AI call. Used for cost tracking and debugging.
  CREATE TABLE IF NOT EXISTS ai_calls (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id  INTEGER NOT NULL DEFAULT 1,
    template_id      INTEGER REFERENCES templates(id) ON DELETE SET NULL,
    document_id      INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    task             TEXT NOT NULL,
    provider         TEXT NOT NULL,
    model            TEXT,
    prompt_tokens    INTEGER,
    completion_tokens INTEGER,
    cost_usd         REAL,
    cache_hit        INTEGER NOT NULL DEFAULT 0,
    success          INTEGER NOT NULL DEFAULT 1,
    error_message    TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS ai_calls_org_idx ON ai_calls(organization_id);
  CREATE INDEX IF NOT EXISTS ai_calls_doc_idx ON ai_calls(document_id);
`);

// Record schema version + run idempotent migrations.
const versionRow = db
  .prepare('SELECT value FROM schema_meta WHERE key = ?')
  .get('schema_version');
const installedVersion = versionRow ? Number(versionRow.value) : 0;

if (installedVersion < 2) {
  // v1 -> v2: add token_start / token_end columns to training_mappings.
  for (const col of ['token_start', 'token_end']) {
    try { db.exec(`ALTER TABLE training_mappings ADD COLUMN ${col} INTEGER`); }
    catch (_) { /* already present */ }
  }
}
// v2 -> v3 ships only new tables (settings, ai_calls). The CREATE TABLE IF
// NOT EXISTS statements above are idempotent so no extra migration step is
// needed; bumping SCHEMA_VERSION is enough.
// v3 -> v4 adds the field_stats table — also handled by CREATE IF NOT EXISTS
// above. Add an idempotent re-init for fresh stats on existing templates if
// they have records but no stats row.
if (installedVersion < 5) {
  try { db.exec('ALTER TABLE records ADD COLUMN source_text TEXT'); }
  catch (_) { /* already present */ }
}
// v5 -> v6: introduce the AI Onboarding Wizard. Templates gain an explicit
// extraction strategy plus the saved per-template AI prompt / provider /
// model. Existing templates are wiped per product decision (the click-to-
// train data model is being superseded by AI-vision-by-default; users can
// still opt back to 'manual' but starting fresh keeps the demo coherent).
// Idempotent column additions — run on EVERY startup, not gated by
// schema_meta. Past experience: if schema_meta got bumped without the
// column-add running (interrupted boot, code reordering, etc.), the
// gated migration silently skips and createTemplate fails with
// "no column named X". Running every boot makes us self-healing.
function ensureColumn(table, column, defStr) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${defStr}`); }
  catch (e) {
    const msg = String(e.message || '');
    if (!/duplicate column name/i.test(msg)) throw e;
  }
}
ensureColumn('templates', 'extraction_strategy', "TEXT NOT NULL DEFAULT 'ai_vision'");
ensureColumn('templates', 'ai_prompt',        'TEXT');
ensureColumn('templates', 'ai_provider',      'TEXT');
ensureColumn('templates', 'ai_model',         'TEXT');
ensureColumn('templates', 'learned_patterns', 'TEXT');

// Per-version-bump migrations that aren't just column adds.
if (installedVersion > 0 && installedVersion < 6) {
  // v5 -> v6 wipes existing templates per the AI Onboarding product
  // decision. Skip on fresh DBs.
  db.exec('DELETE FROM templates');
}
if (installedVersion < 4) {
  db.exec(`
    INSERT OR IGNORE INTO field_stats(template_id, field_id, extractions, corrections, ai_escalations)
    SELECT t.id, f.id,
      (SELECT COUNT(*) FROM record_values rv JOIN records r ON r.id = rv.record_id
        WHERE r.template_id = t.id AND rv.field_id = f.id AND rv.value IS NOT NULL) AS ext,
      (SELECT COUNT(*) FROM corrections c JOIN records r ON r.id = c.record_id
        WHERE r.template_id = t.id AND c.field_id = f.id) AS cor,
      0
    FROM templates t
    JOIN fields f ON f.template_id = t.id;
  `);
}
if (installedVersion < 8) {
  // v7 -> v8: Auth system. Create default org if needed so existing tests/seeds work.
  try {
    const defaultOrg = db.prepare('SELECT id FROM organizations WHERE name = ?').get('Default');
    if (!defaultOrg) {
      db.prepare('INSERT INTO organizations(name) VALUES (?)').run('Default');
    }
  } catch (e) {
    // Organizations table might not exist yet in migrations
  }
}
if (installedVersion < 9) {
  // v8 -> v9: Multi-tenancy enforcement. Add organization_id to templates, documents, batches, training_samples.
  // This migration is designed to be safe to run multiple times (idempotent).

  console.log('[db] Running v8 -> v9 migration: multi-tenancy enforcement');

  // Ensure columns exist (if they don't already from fresh schema)
  ensureColumn('templates', 'organization_id', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('documents', 'organization_id', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('batches', 'organization_id', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('training_samples', 'organization_id', 'INTEGER NOT NULL DEFAULT 1');

  // Create indices for org_id columns (for fast filtering)
  // SQLite doesn't validate constraints until we recreate the table, so indices are safe
  try { db.exec('CREATE INDEX IF NOT EXISTS templates_org_idx ON templates(organization_id)'); }
  catch (e) { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS documents_org_idx ON documents(organization_id)'); }
  catch (e) { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS batches_org_idx ON batches(organization_id)'); }
  catch (e) { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS training_samples_org_idx ON training_samples(organization_id)'); }
  catch (e) { /* already exists */ }

  // Backfill: Derive organization_id from template for documents and batches
  try {
    db.exec(`
      UPDATE documents
      SET organization_id = (
        SELECT organization_id FROM templates WHERE id = documents.template_id
      )
      WHERE organization_id = 1 AND template_id IN (
        SELECT id FROM templates WHERE organization_id != 1
      )
    `);
    console.log('[db] Backfilled documents organization_id');
  } catch (e) {
    console.warn('[db] Backfill documents failed (may be OK if no cross-org data):', e.message);
  }

  try {
    db.exec(`
      UPDATE batches
      SET organization_id = (
        SELECT organization_id FROM templates WHERE id = batches.template_id
      )
      WHERE organization_id = 1 AND template_id IN (
        SELECT id FROM templates WHERE organization_id != 1
      )
    `);
    console.log('[db] Backfilled batches organization_id');
  } catch (e) {
    console.warn('[db] Backfill batches failed (may be OK if no cross-org data):', e.message);
  }

  // Backfill: Derive organization_id from template for training_samples
  try {
    db.exec(`
      UPDATE training_samples
      SET organization_id = (
        SELECT organization_id FROM templates WHERE id = training_samples.template_id
      )
      WHERE organization_id = 1 AND template_id IN (
        SELECT id FROM templates WHERE organization_id != 1
      )
    `);
    console.log('[db] Backfilled training_samples organization_id');
  } catch (e) {
    console.warn('[db] Backfill training_samples failed (may be OK if no cross-org data):', e.message);
  }

  console.log('[db] v8 -> v9 migration complete');
}

if (!versionRow) {
  db.prepare('INSERT INTO schema_meta(key, value) VALUES (?, ?)').run(
    'schema_version',
    String(SCHEMA_VERSION)
  );
} else if (installedVersion < SCHEMA_VERSION) {
  db.prepare('UPDATE schema_meta SET value = ? WHERE key = ?').run(
    String(SCHEMA_VERSION),
    'schema_version'
  );
}

// --- Tiny helpers used by routes/seeds --------------------------------------

export function listTemplates(organizationId) {
  if (!organizationId || !Number.isInteger(organizationId)) {
    throw new Error('organizationId is required and must be an integer');
  }
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
  // Compute pattern coverage so the UI can show a free-vs-paid badge.
  for (const r of rows) {
    r.pattern_coverage = computePatternCoverage(r.learned_patterns, r.field_count);
  }
  return rows;
}

// Returns { has_anchor, covered_fields, total_fields }. covered_fields counts
// distinct fields with at least one pattern alternative.
function computePatternCoverage(rawJson, totalFields) {
  if (!rawJson) return { has_anchor: false, covered_fields: 0, total_fields: totalFields || 0 };
  let obj;
  try { obj = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson; }
  catch { return { has_anchor: false, covered_fields: 0, total_fields: totalFields || 0 }; }
  if (!obj || typeof obj !== 'object') return { has_anchor: false, covered_fields: 0, total_fields: totalFields || 0 };
  const hasAnchor = !!(
    (typeof obj.record_anchor === 'string' && obj.record_anchor) ||
    (Array.isArray(obj.record_anchor_alternatives) && obj.record_anchor_alternatives.length > 0)
  );
  let covered = 0;
  const fields = obj.fields || {};
  for (const def of Object.values(fields)) {
    if (!def) continue;
    if ((typeof def.pattern === 'string' && def.pattern) ||
        (Array.isArray(def.alternatives) && def.alternatives.length > 0)) {
      covered++;
    }
  }
  return { has_anchor: hasAnchor, covered_fields: covered, total_fields: totalFields || 0 };
}

export function getTemplate(id, organizationId) {
  if (!organizationId || !Number.isInteger(organizationId)) {
    throw new Error('organizationId is required and must be an integer');
  }
  const template = db.prepare(
    'SELECT * FROM templates WHERE id = ? AND organization_id = ?'
  ).get(id, organizationId);
  if (!template) return null;
  template.fields = db
    .prepare('SELECT * FROM fields WHERE template_id = ? ORDER BY sort_order, id')
    .all(id);
  return template;
}

export function createTemplate(input) {
  const {
    name,
    organization,
    state,
    category,
    year,
    notes,
    fields = [],
    organizationId,  // ← NEW: required for multi-tenancy
    // AI-onboarding fields (default = 'ai_vision' for new templates per
    // product decision; manual click-to-train opts out explicitly).
    extraction_strategy = 'ai_vision',
    ai_prompt = null,
    ai_provider = null,
    ai_model = null,
    learned_patterns = null,
  } = input;

  if (!organizationId || !Number.isInteger(organizationId)) {
    throw new Error('organizationId is required and must be an integer');
  }

  const insertTpl = db.prepare(
    `INSERT INTO templates(
       organization_id, name, organization, state, category, year, notes,
       extraction_strategy, ai_prompt, ai_provider, ai_model, learned_patterns
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertField = db.prepare(
    `INSERT INTO fields(template_id, name, label, type, is_primary, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    const { lastInsertRowid: templateId } = insertTpl.run(
      organizationId,  // ← NEW: first parameter
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
    fields.forEach((f, i) => {
      insertField.run(
        templateId,
        f.name,
        f.label,
        f.type,
        f.is_primary ? 1 : 0,
        f.sort_order ?? i
      );
    });
    return templateId;
  });
  return getTemplate(tx(), organizationId);  // ← Pass org_id to getTemplate
}

// Patch the AI configuration on an existing template. Used by the wizard's
// "tweak the prompt and try again" loop.
export function updateTemplateAI(id, { extraction_strategy, ai_prompt, ai_provider, ai_model }, organizationId) {
  if (!organizationId || !Number.isInteger(organizationId)) {
    throw new Error('organizationId is required and must be an integer');
  }

  // Verify ownership before update
  const template = db.prepare(
    'SELECT id FROM templates WHERE id = ? AND organization_id = ?'
  ).get(id, organizationId);
  if (!template) {
    throw new Error('Template not found or unauthorized');
  }

  const sets = [];
  const params = [];
  if (extraction_strategy !== undefined) { sets.push('extraction_strategy = ?'); params.push(extraction_strategy); }
  if (ai_prompt !== undefined)           { sets.push('ai_prompt = ?');           params.push(ai_prompt); }
  if (ai_provider !== undefined)         { sets.push('ai_provider = ?');         params.push(ai_provider); }
  if (ai_model !== undefined)            { sets.push('ai_model = ?');            params.push(ai_model); }
  if (!sets.length) return getTemplate(id, organizationId);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  params.push(organizationId);
  db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ? AND organization_id = ?`).run(...params);
  return getTemplate(id, organizationId);
}

export function listDocuments(filter = {}, organizationId) {
  if (!organizationId || !Number.isInteger(organizationId)) {
    throw new Error('organizationId is required and must be an integer');
  }

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
  if (!organizationId || !Number.isInteger(organizationId)) {
    throw new Error('organizationId is required and must be an integer');
  }

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
  // NOTE: 'organization' TEXT filter removed — use org_id enforcement instead
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
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const values = db
    .prepare(
      `SELECT rv.record_id, rv.value, rv.raw_text, rv.source, rv.confidence,
              f.name AS field_name, f.label AS field_label, f.type AS field_type
         FROM record_values rv
         JOIN fields f ON f.id = rv.field_id
        WHERE rv.record_id IN (${placeholders})`
    )
    .all(...ids);

  const valuesByRecord = new Map();
  for (const v of values) {
    if (!valuesByRecord.has(v.record_id)) valuesByRecord.set(v.record_id, {});
    valuesByRecord.get(v.record_id)[v.field_name] = {
      value: v.value,
      raw_text: v.raw_text,
      source: v.source,
      confidence: v.confidence,
      label: v.field_label,
      type: v.field_type,
    };
  }
  return rows.map((r) => ({ ...r, values: valuesByRecord.get(r.id) ?? {} }));
}

export function saveExtraction(documentId, templateId, extraction, organizationId) {
  if (!organizationId || !Number.isInteger(organizationId)) {
    throw new Error('organizationId is required and must be an integer');
  }

  // Verify ownership: document and template must both belong to the organization
  const doc = db.prepare(
    'SELECT organization_id FROM documents WHERE id = ? AND organization_id = ?'
  ).get(documentId, organizationId);
  if (!doc) {
    throw new Error('Document not found or unauthorized');
  }

  const tpl = db.prepare(
    'SELECT organization_id FROM templates WHERE id = ? AND organization_id = ?'
  ).get(templateId, organizationId);
  if (!tpl) {
    throw new Error('Template not found or unauthorized');
  }

  const insertRecord = db.prepare(
    `INSERT INTO records(document_id, template_id, row_index, confidence, source_text)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertValue = db.prepare(
    `INSERT INTO record_values(record_id, field_id, value, raw_text, source, confidence)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const fieldsByName = new Map(
    db
      .prepare('SELECT id, name FROM fields WHERE template_id = ?')
      .all(templateId)
      .map((f) => [f.name, f.id])
  );

  const tx = db.transaction(() => {
    // Wipe any prior records for this document (re-extraction).
    db.prepare('DELETE FROM records WHERE document_id = ?').run(documentId);
    // Track per-(template, field) counts for the historical confidence model.
    const fieldExtractions = new Map();   // field_id -> count of clean cells
    const fieldAIEscalations = new Map(); // field_id -> count of ai source
    extraction.records.forEach((rec, i) => {
      const { lastInsertRowid: rid } = insertRecord.run(
        documentId,
        templateId,
        i,
        rec.confidence ?? null,
        rec.source_text ?? null
      );
      for (const [fieldName, cell] of Object.entries(rec.values || {})) {
        const fid = fieldsByName.get(fieldName);
        if (!fid) continue;
        insertValue.run(
          rid,
          fid,
          cell.value ?? null,
          cell.raw_text ?? null,
          cell.source ?? null,
          cell.confidence ?? null
        );
        if (cell.value != null) {
          fieldExtractions.set(fid, (fieldExtractions.get(fid) || 0) + 1);
          if (cell.source === 'ai') {
            fieldAIEscalations.set(fid, (fieldAIEscalations.get(fid) || 0) + 1);
          }
        }
      }
    });
    for (const [fid, n] of fieldExtractions) bumpStat(templateId, fid, 'extractions', n);
    for (const [fid, n] of fieldAIEscalations) bumpStat(templateId, fid, 'ai_escalations', n);
    db.prepare(
      `UPDATE documents
          SET status = ?,
              page_count = ?,
              record_count = ?,
              warnings = ?,
              error_message = NULL,
              processed_at = datetime('now')
        WHERE id = ?`
    ).run(
      extraction.needsOcr ? 'needs_ocr' : 'done',
      extraction.pageCount ?? null,
      extraction.records.length,
      JSON.stringify(extraction.warnings ?? []),
      documentId
    );
  });
  tx();
}

// --- Field-stats helpers ----------------------------------------------------
// All counters are aggregated. We bump in batches inside transactions for
// performance — one INSERT per (template, field) per save / correction.
function bumpStat(templateId, fieldId, column, delta = 1) {
  db.prepare(
    `INSERT INTO field_stats(template_id, field_id, ${column}, last_updated)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(template_id, field_id) DO UPDATE SET
       ${column} = ${column} + excluded.${column},
       last_updated = excluded.last_updated`
  ).run(templateId, fieldId, delta);
}

export function bumpExtractions(templateId, fieldId, delta = 1) {
  bumpStat(templateId, fieldId, 'extractions', delta);
}
export function bumpCorrections(templateId, fieldId, delta = 1) {
  bumpStat(templateId, fieldId, 'corrections', delta);
}
export function bumpAIEscalations(templateId, fieldId, delta = 1) {
  bumpStat(templateId, fieldId, 'ai_escalations', delta);
}

// Read aggregated stats for a template's fields.
export function getFieldStats(templateId, organizationId) {
  if (!organizationId || !Number.isInteger(organizationId)) {
    throw new Error('organizationId is required and must be an integer');
  }

  // Verify template ownership
  const tpl = db.prepare(
    'SELECT id FROM templates WHERE id = ? AND organization_id = ?'
  ).get(templateId, organizationId);
  if (!tpl) {
    throw new Error('Template not found or unauthorized');
  }

  return db
    .prepare(
      `SELECT f.id AS field_id, f.name, f.label, f.type, f.is_primary,
              COALESCE(s.extractions, 0)    AS extractions,
              COALESCE(s.corrections, 0)    AS corrections,
              COALESCE(s.ai_escalations, 0) AS ai_escalations,
              s.last_updated
         FROM fields f
         LEFT JOIN field_stats s ON s.template_id = f.template_id AND s.field_id = f.id
        WHERE f.template_id = ?
        ORDER BY f.sort_order, f.id`
    )
    .all(templateId);
}

// Compute historical accuracy: 1 - corrections/extractions, only when we
// have enough samples (>= 5). Returns null when insufficient data.
export function fieldAccuracy({ extractions, corrections }) {
  if (extractions < 5) return null;
  const acc = 1 - corrections / extractions;
  return Math.max(0, Math.min(1, acc));
}

// --- Auth helpers ---

export function createOrganization(name) {
  const stmt = db.prepare('INSERT INTO organizations(name) VALUES (?)');
  const { lastInsertRowid } = stmt.run(name);
  return { id: lastInsertRowid, name, created_at: new Date().toISOString() };
}

export function getOrganization(id) {
  return db.prepare('SELECT * FROM organizations WHERE id = ?').get(id);
}

export function createUser(email, passwordHash, organizationId, role = 'operator') {
  const stmt = db.prepare(
    `INSERT INTO users(email, password_hash, organization_id, role)
     VALUES (?, ?, ?, ?)`
  );
  const { lastInsertRowid } = stmt.run(email, passwordHash, organizationId, role);
  return { id: lastInsertRowid, email, organization_id: organizationId, role };
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

export function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function createSession(sessionId, userId, organizationId, expiresAt) {
  db.prepare(
    `INSERT INTO sessions(id, user_id, organization_id, expires_at)
     VALUES (?, ?, ?, ?)`
  ).run(sessionId, userId, organizationId, expiresAt);
  return { id: sessionId, user_id: userId, organization_id: organizationId, expires_at: expiresAt };
}

export function getSession(sessionId) {
  const session = db.prepare(
    'SELECT s.*, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?'
  ).get(sessionId);
  if (!session) return null;
  // Check expiry
  if (new Date(session.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }
  return session;
}

export function deleteSession(sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function setOrgSecret(organizationId, key, encryptedValue) {
  db.prepare(
    `INSERT INTO org_secrets(organization_id, key, encrypted_value)
     VALUES (?, ?, ?)
     ON CONFLICT(organization_id, key) DO UPDATE SET encrypted_value = excluded.encrypted_value,
     updated_at = datetime('now')`
  ).run(organizationId, key, encryptedValue);
}

export function getOrgSecret(organizationId, key) {
  return db.prepare(
    'SELECT encrypted_value FROM org_secrets WHERE organization_id = ? AND key = ?'
  ).get(organizationId, key);
}
