# Multi-Tenancy & Security Risk Analysis — DocuStruct

**Status**: Pre-SaaS (Auth implemented, but multi-tenancy NOT enforced)  
**Risk Level**: 🔴 CRITICAL — Data leakage between organizations possible  
**Scope**: All data routes vulnerable to cross-tenant access

---

## Executive Summary

Your codebase has **auth infrastructure** in place (users, sessions, org_secrets) but **NO enforcement** of tenant isolation. A user from Org A can read/modify all data from Org B through four main attack vectors.

**Blast radius**: Templates, documents, records, field values, AI usage, settings, and API keys.

---

## Critical Vulnerabilities

### 1. 🔴 **Templates Not Isolated by Organization**

**Problem**: `templates` table has no `organization_id` column. All templates are shared globally.

```js
// server/src/routes/templates.js:6
router.get('/', (_req, res) => {
  res.json(listTemplates());  // ← Returns ALL templates, regardless of tenant
});
```

**Attack**:
```bash
# Org A user can fetch any template from Org B
curl -H "Authorization: Bearer org_a_session" http://localhost:4000/api/templates
# Returns Org B's templates too
```

**Impact**: 
- Read: All organizations' templates visible
- Modify: Any user can update another org's template
- Delete: Any user can delete another org's templates

**Root Cause**: 
- `templates.organization` is TEXT (old system), not `organization_id` (FK)
- `listTemplates()` in `db.js:368` doesn't accept filter parameter
- `getTemplate()` doesn't validate ownership

---

### 2. 🔴 **Documents & Records Leak Cross-Tenant Data**

**Problem**: Document and record listing doesn't filter by authenticated user's organization.

```js
// server/src/routes/data.js:7-42
router.get('/records', (req, res) => {
  const filter = {
    template_id: req.query.template_id,
    organization: req.query.organization || undefined,  // ← User-controlled!
    year: req.query.year,
    status: req.query.status,
  };
  let records = listRecords(filter);
  // ...
});
```

**Attack**:
```bash
# Org A user queries by Org B's name
curl "http://localhost:4000/api/data/records?organization=OrgB" \
  -H "Authorization: Bearer org_a_session"
# Returns all records from Org B
```

**Impact**:
- Exfiltrate all extracted data from competitor organizations
- Export CSVs of another org's records

**Root Cause**:
- `listRecords()` accepts `filter.organization` (TEXT field, user-controlled)
- Middleware attaches `req.organization_id` but routes don't enforce it
- No validation that template_id belongs to user's org before listing records

---

### 3. 🔴 **Settings & API Keys Hardcoded to Org 1**

**Problem**: Settings routes are hardcoded to `organizationId: 1`. All orgs share one AI configuration.

```js
// server/src/routes/settings.js:13-18
router.get('/', (_req, res) => {
  res.json({
    settings: getAllSettings({ organizationId: 1 }),  // ← Hardcoded!
    ai: aiStatus({ organizationId: 1 }),
  });
});

router.post('/ai', (req, res) => {
  for (const k of allowed) {
    setSetting('ai.' + k, v, { organizationId: 1 });  // ← Hardcoded!
  }
});
```

**Attack**:
```bash
# Org A user sets an OpenAI API key — it goes to Org 1's shared config
curl -X POST http://localhost:4000/api/settings/ai \
  -H "Authorization: Bearer org_a_session" \
  -H "Content-Type: application/json" \
  -d '{"api_key": "sk-...attacker-key"}'

# Now ALL users get Org A's API key quota burned
# Org B can read Org A's billing spend and AI usage
```

**Impact**:
- Organizations can see each other's AI API keys
- Budget exhaustion / cost manipulation attacks
- Audit trail leaks (who extracted what, when)

**Root Cause**:
- Settings endpoints ignore `req.organization_id` from auth middleware
- All orgs mapped to hardcoded `organizationId: 1`

---

### 4. 🔴 **Extraction & Training Not Validated for Ownership**

**Problem**: When a user uploads a PDF for extraction preview, there's no check that the template belongs to their org.

```js
// server/src/routes/extraction.js:37-41
router.post('/:templateId/preview', upload.single('file'), async (req, res, next) => {
  const templateId = Number(req.params.templateId);
  const template = templateWithMappings(templateId);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  // ← No check: template.organization_id === req.organization_id
});
```

**Attack**:
```bash
# Org A user extracts data using Org B's template (costing Org B's AI budget)
curl -X POST http://localhost:4000/api/extraction/999/preview \
  -H "Authorization: Bearer org_a_session" \
  -F "file=@org_b_document.pdf"

# Org B's settings are hardcoded to org 1, so Org A's extraction costs Org B nothing
# (or burns whoever has API key in org 1 settings)
```

**Impact**:
- AI cost manipulation (use another org's budget)
- Resource exhaustion
- Training data leakage (patterns learned from Org B's PDFs)

---

## Schema Issues

### Missing `organization_id` on Core Tables

```sql
-- Missing FK on templates (critical)
CREATE TABLE templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  organization TEXT,              -- ← Old: unenforceable TEXT field
  -- ... missing: organization_id INTEGER REFERENCES organizations(id)
);

-- Missing FK on training_samples, documents, batches
CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  template_id INTEGER,
  -- ... missing: organization_id INTEGER
);

-- Missing FK on batches, training_samples, corrections
CREATE TABLE batches (
  id INTEGER PRIMARY KEY,
  template_id INTEGER,
  -- ... missing: organization_id INTEGER
);
```

### Data Consistency Risk

Some tables have `organization_id` (users, sessions, ai_calls), others don't (templates, documents):
- **With org FK**: users, sessions, org_secrets, ai_calls, settings
- **Without org FK**: templates, documents, batches, training_samples, training_mappings, records, record_values, corrections, field_stats

This creates a mix of enforcement levels and makes queries complex.

---

## Database Query Vulnerabilities

### Unfiltered Template Queries

```js
// db.js:368 — Returns ALL templates, no org filter
export function listTemplates() {
  const rows = db.prepare(
    `SELECT t.* FROM templates t ORDER BY t.name`
  ).all();
  // ...
}

// db.js:409 — Accepts any template ID, no org check
export function getTemplate(id) {
  return db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
}
```

**Fix**: Add organization_id parameter and filter:
```js
export function listTemplates(organizationId) {
  const rows = db.prepare(
    `SELECT t.* FROM templates t 
     WHERE t.organization_id = ?
     ORDER BY t.name`
  ).all(organizationId);
}

export function getTemplate(id, organizationId) {
  return db.prepare(
    'SELECT * FROM templates WHERE id = ? AND organization_id = ?'
  ).get(id, organizationId);
}
```

### Middleware Attaches Context But Routes Ignore It

```js
// middleware/auth.js — Correctly extracts organization_id
export function authenticate(req, res, next) {
  // ...
  req.organization_id = session.organization_id;  // ← Set but not enforced
  next();
}

// routes/templates.js — Ignores req.organization_id
router.get('/', (_req, res) => {
  res.json(listTemplates());  // ← Doesn't pass req.organization_id!
});
```

---

## Complete Attack Scenario

```
Timeline: Org A user (attacker) vs Org B (victim)

1. Org B signs up:
   - POST /api/auth/signup
   - Creates organization "Acme Corp"
   - Creates templates, uploads PDFs, extracts data
   - Sets OpenAI API key in settings

2. Org A signs up (attacker):
   - POST /api/auth/signup
   - Gets session token for "Hacker LLC"

3. Attacker reads Org B's templates:
   - GET /api/templates
   - Response includes all templates (no org filter)
   - Attacker finds "commission_statement_template" (ID=42)

4. Attacker reads Org B's extracted data:
   - GET /api/data/records?organization=Acme+Corp
   - Gets all commission statements Org B extracted
   - Exports CSV with sensitive financial data

5. Attacker burns Org B's AI budget:
   - POST /api/extraction/42/preview (uses Org B's template)
   - Uploads 100 PDFs
   - Each triggers AI extraction → costs Org B's API key
   - Org B's monthly budget depleted

6. Attacker modifies Org B's AI config:
   - POST /api/settings/ai
   - Changes API key to attacker's key
   - Now Org B's imports use attacker's budget
   - Org B can't extract anything
```

---

## Enforcement Points Required

### 1. **Route-Level Checks** (First Defense)

Every route that accesses data must validate:
```js
const template = getTemplate(templateId, req.organization_id);
if (!template) return res.status(404).json({ error: 'Template not found' });
```

### 2. **Database-Level Checks** (Second Defense)

Queries must always filter by organization:
```sql
SELECT * FROM templates WHERE id = ? AND organization_id = ?
```

### 3. **Cascade Validation**

When accessing nested resources, validate each layer:
```
User → Organization (from session)
       ↓
     Template (must match user's org)
       ↓
     Document (must belong to template's org)
       ↓
     Record (must belong to document's org)
       ↓
     RecordValues (nested validation)
```

---

## Remediation Plan

### Phase 1: Schema & Data Migration (High Priority)

1. **Add organization_id to core tables**
   ```sql
   ALTER TABLE templates ADD COLUMN organization_id INTEGER 
     REFERENCES organizations(id) ON DELETE CASCADE;
   ALTER TABLE documents ADD COLUMN organization_id INTEGER;
   ALTER TABLE batches ADD COLUMN organization_id INTEGER;
   ALTER TABLE training_samples ADD COLUMN organization_id INTEGER;
   ```

2. **Migrate existing data to Default org**
   ```sql
   UPDATE templates SET organization_id = 1 WHERE organization_id IS NULL;
   UPDATE documents SET organization_id = 
     (SELECT organization_id FROM templates WHERE id = documents.template_id);
   ```

3. **Add constraints**
   ```sql
   ALTER TABLE templates ADD CONSTRAINT templates_org_id_nn 
     CHECK (organization_id IS NOT NULL);
   ```

### Phase 2: Query Filters (High Priority)

Update all db.js helper functions:
- `listTemplates(organizationId)` ← Add org filter
- `getTemplate(id, organizationId)` ← Validate ownership
- `listDocuments(filter, organizationId)` ← Add org filter
- `listRecords(filter, organizationId)` ← Enforce org context
- `saveExtraction(documentId, templateId, extraction, organizationId)` ← Validate all IDs

### Phase 3: Route Enforcement (High Priority)

Update all routes to pass `req.organization_id`:

```js
// routes/templates.js
router.get('/', (req, res) => {
  res.json(listTemplates(req.organization_id));
});

router.get('/:id', (req, res) => {
  const t = getTemplate(Number(req.params.id), req.organization_id);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  res.json(t);
});

// routes/data.js
router.get('/records', (req, res) => {
  // Validate template ownership if filtering
  if (req.query.template_id) {
    const tpl = getTemplate(req.query.template_id, req.organization_id);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
  }
  
  const filter = {
    template_id: req.query.template_id ? Number(req.query.template_id) : undefined,
    document_id: req.query.document_id ? Number(req.query.document_id) : undefined,
    year: req.query.year ? Number(req.query.year) : undefined,
    status: req.query.status,
    from_date: req.query.from_date,
    to_date: req.query.to_date,
  };
  
  let records = listRecords(filter, req.organization_id);
  // ... rest of route
});

// routes/settings.js
router.get('/', (req, res) => {
  res.json({
    settings: getAllSettings({ organizationId: req.organization_id }),
    ai: aiStatus({ organizationId: req.organization_id }),
  });
});

router.post('/ai', (req, res) => {
  for (const k of allowed) {
    if (!(k in req.body)) continue;
    let v = req.body[k];
    if (k === 'api_key' && (v === '' || v === '••••')) continue;
    if (v === '') v = null;
    setSetting('ai.' + k, v, { organizationId: req.organization_id });
  }
  res.json({ ok: true, ai: aiStatus({ organizationId: req.organization_id }) });
});
```

### Phase 4: Validation & Testing (Medium Priority)

1. **Add organization_id validation to middleware**
   ```js
   export function validateOrgContext(req, res, next) {
     if (!req.organization_id || !Number.isInteger(req.organization_id)) {
       return res.status(401).json({ error: 'Invalid organization context' });
     }
     next();
   }
   ```

2. **Test matrix**:
   - ✅ Org A user can read/write only their templates
   - ✅ Org A user cannot read Org B's templates (404, not error)
   - ✅ Org A user cannot modify Org B's settings
   - ✅ Settings changes only affect their organization
   - ✅ Cross-org template extraction costs correct org's budget
   - ✅ Records export doesn't leak other orgs' data

---

## Risk Summary

| Vector | Severity | Exploitability | Impact |
|--------|----------|-----------------|--------|
| Read other orgs' templates | 🔴 Critical | Trivial (GET /) | Data exposure |
| Read other orgs' records | 🔴 Critical | Trivial (query param) | Data exfiltration |
| Modify other orgs' templates | 🔴 Critical | Simple (PATCH) | Sabotage, data loss |
| Burn other orgs' AI budget | 🔴 Critical | Simple (POST extraction) | DoS, cost fraud |
| Read/modify other orgs' API keys | 🔴 Critical | Simple (GET/POST settings) | Credential theft |
| Exfiltrate corrections audit trail | 🟠 High | Moderate | Competitive intelligence |
| Access other orgs' training PDFs | 🟠 High | Moderate | IP theft |

**Time to Fix**: 2-3 sprints (Phase 1: 2-3 days, Phase 2: 3-4 days, Phase 3: 5-7 days, Phase 4: Testing + buffer)

---

## Related Security Items (Not Blocking)

- ✅ **Email verification**: Not required for MVP (but user enumeration possible)
- ✅ **Password reset**: Not required for MVP
- ✅ **Rate limiting**: POST/PUT endpoints not limited (brute force, spam possible)
- ⚠️ **CORS hardening**: Currently `cors()` with no config (OK for local, risky in production)
- ⚠️ **Security headers**: Missing CSP, X-Frame-Options, HSTS
- ✅ **Secrets at rest**: Org secrets are encrypted (AES-256-GCM), settings API keys encrypted via middleware

---

## Files Requiring Changes

**Schema Migration**:
- `server/src/db.js` (SCHEMA_VERSION 9 migration)

**Query Functions**:
- `server/src/db.js` (update 15+ helper functions)

**Routes** (all need org_id enforcement):
- `server/src/routes/templates.js`
- `server/src/routes/data.js`
- `server/src/routes/extraction.js`
- `server/src/routes/imports.js`
- `server/src/routes/training.js`
- `server/src/routes/aiTemplates.js`
- `server/src/routes/settings.js`

**Middleware**:
- `server/src/middleware/auth.js` (add validateOrgContext)

---

## Next Steps

1. **Review this analysis** with the team
2. **Prioritize**: Multi-tenancy fixes must complete before SaaS launch
3. **Schedule**: Plan 2-3 week sprint for remediation
4. **Testing**: Set up cross-tenant integration tests
5. **Deployment**: Back up database before schema migration
