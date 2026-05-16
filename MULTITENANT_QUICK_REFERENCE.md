# Multi-Tenancy: Quick Reference & Vulnerability Map

**TL;DR**: Your auth is set up, but data filtering is not enforced. Anyone can read/modify any org's data. Fix needed before SaaS launch.

---

## 30-Second Risk Summary

| What | Status | Risk |
|------|--------|------|
| **Auth system** | ✅ Implemented | None (sessions, users, roles exist) |
| **Route protection** | ✅ Implemented | Low (authenticate middleware in place) |
| **Multi-tenancy** | 🔴 **NOT enforced** | 🔴 **CRITICAL** (all data leaks cross-tenant) |
| **Query isolation** | 🔴 **Missing** | 🔴 **CRITICAL** (no org_id filtering) |
| **Schema** | ⚠️ Partial | Medium (templates missing organization_id column) |

**Impact**: Org A user can **read, modify, and delete** Org B's templates, documents, records, and API keys.

---

## Attack Surface Map

```
User Request (Org A)
    ↓
[authenticate] ✅ Validates session, sets req.organization_id
    ↓
[Route Handler] 🔴 IGNORES req.organization_id
    ↓
[Query to DB] 🔴 NO WHERE organization_id = ?
    ↓
[Result] 🔴 Returns ALL data regardless of tenant
    ↓
Org B data leaks to Org A
```

---

## Which Routes Are Vulnerable?

### 🔴 CRITICAL (All Data Routes)

| Endpoint | Issue | Fix Time |
|----------|-------|----------|
| `GET /api/templates` | Returns all templates, no org filter | 5 min |
| `GET /api/templates/:id` | No ownership check | 5 min |
| `POST /api/templates` | No org_id captured | 5 min |
| `GET /api/data/records` | User can query by organization TEXT field | 10 min |
| `POST /api/data/corrections` | No ownership validation | 5 min |
| `POST /api/data/records/delete` | No ownership check | 5 min |
| `GET /api/data/export.csv` | Exports all org's data if no template filter | 5 min |
| `GET /api/settings` | Hardcoded to org_id=1 | 5 min |
| `POST /api/settings/ai` | Hardcoded to org_id=1 | 5 min |
| `GET /api/settings/ai/usage` | Hardcoded to org_id=1 | 5 min |
| `POST /api/extraction/:id/preview` | No template ownership check | 10 min |
| `POST /api/training/...` | No ownership checks | 15 min |
| `POST /api/imports/...` | No ownership checks | 15 min |

**Total Fix Time**: ~100 minutes (~2 hours per developer)

---

## Code Changes Required (High Level)

### Step 1: Schema (10 min)
```sql
ALTER TABLE templates ADD COLUMN organization_id INTEGER NOT NULL DEFAULT 1 
  REFERENCES organizations(id);
ALTER TABLE documents ADD COLUMN organization_id INTEGER;
ALTER TABLE batches ADD COLUMN organization_id INTEGER;
ALTER TABLE training_samples ADD COLUMN organization_id INTEGER;
CREATE INDEX templates_org_idx ON templates(organization_id);
```

### Step 2: Update Functions (20 min)

**Pattern**: Add `organizationId` parameter to every query function
```js
// Before
export function listTemplates() {
  return db.prepare('SELECT * FROM templates ORDER BY name').all();
}

// After
export function listTemplates(organizationId) {
  return db.prepare(
    'SELECT * FROM templates WHERE organization_id = ? ORDER BY name'
  ).all(organizationId);
}
```

**Functions to update**:
- listTemplates(organizationId)
- getTemplate(id, organizationId)
- listDocuments(filter, organizationId)
- listRecords(filter, organizationId)
- createTemplate(..., organizationId)
- (15+ more)

### Step 3: Update Routes (50 min)

**Pattern**: Pass `req.organization_id` to every query
```js
// Before
router.get('/', (_req, res) => {
  res.json(listTemplates());
});

// After
router.get('/', (req, res) => {
  res.json(listTemplates(req.organization_id));
});
```

**Routes to update**: 30+ endpoints across 7 files

### Step 4: Validation (10 min)

```js
// Add to every cross-resource access
const template = getTemplate(templateId, req.organization_id);
if (!template) return res.status(404).json({ error: 'Template not found' });
```

---

## Before & After Examples

### Example 1: List Templates

**BEFORE** (Vulnerable):
```js
router.get('/api/templates', (req, res) => {
  res.json(listTemplates());  // ← Returns ALL templates
});

// Org B's response includes Org A's templates!
```

**AFTER** (Fixed):
```js
router.get('/api/templates', (req, res) => {
  res.json(listTemplates(req.organization_id));  // ← Filter by org
});

// Only returns templates from authenticated user's org
```

### Example 2: Read Records

**BEFORE** (Vulnerable):
```js
router.get('/api/data/records', (req, res) => {
  const filter = {
    organization: req.query.organization,  // ← User-controlled!
  };
  const records = listRecords(filter);  // ← User can request any org
  res.json(records);
});

// Org A user: ?organization=OrgB → gets Org B's records
```

**AFTER** (Fixed):
```js
router.get('/api/data/records', (req, res) => {
  // Remove 'organization' from filter (deprecated)
  const filter = {
    template_id: req.query.template_id,
    // ... other filters, no organization
  };
  
  // Validate template ownership if provided
  if (filter.template_id) {
    const tpl = getTemplate(filter.template_id, req.organization_id);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
  }
  
  const records = listRecords(filter, req.organization_id);  // ← Pass org_id
  res.json(records);
});

// Org A user: can only see their own records, 404 for others
```

### Example 3: Settings

**BEFORE** (Vulnerable):
```js
router.get('/api/settings', (_req, res) => {
  res.json({
    settings: getAllSettings({ organizationId: 1 }),  // ← Hardcoded to org 1!
    ai: aiStatus({ organizationId: 1 }),
  });
});

// All orgs share ONE AI configuration
// Org A sets OpenAI key → affects all orgs (or fails, or overwrites)
```

**AFTER** (Fixed):
```js
router.get('/api/settings', (req, res) => {
  res.json({
    settings: getAllSettings({ organizationId: req.organization_id }),  // ← Use authenticated org
    ai: aiStatus({ organizationId: req.organization_id }),
  });
});

// Each org has isolated AI config
// Org A's settings don't affect Org B
```

---

## Testing Checklist

```
For each route:
  ✅ Org A user sees only Org A data
  ✅ Org B user sees only Org B data
  ✅ Org A user gets 404 (not error) when accessing Org B's resource
  ✅ Cross-org modify/delete attempts are blocked with 403
  ✅ Each org's settings are independent
  ✅ AI extraction costs correct org's budget
```

---

## Risk If NOT Fixed

### Data Breach Scenario

```
Day 1: Attacker (Org A) signs up for free trial
Day 2: Attacker discovers no org isolation
Day 3: Attacker exports all customer data from Org B (competitor)
Day 4: Attacker queries Org B's extracted financial data
Day 5: Attacker modifies Org B's template to corrupt their extraction
Day 6: Attacker sets their API key in Org B's settings (if hardcoded to org 1)
Day 7: You discover breach during customer call
Day 8+: Lawsuits, regulatory fines, reputation damage
```

**This is a SHOW-STOPPER for SaaS launch.**

---

## Implementation Order

1. **Schema first** (10 min)
   - Add organization_id columns
   - Create indices
   - Backfill data

2. **db.js functions** (20 min)
   - Add organizationId parameter to queries
   - Add WHERE filters

3. **routes/** (50 min)
   - Pass req.organization_id to functions
   - Add ownership validation

4. **Test** (30 min)
   - Run test matrix
   - Manual cross-tenant verification

5. **Deploy** (15 min)
   - Backup database
   - Run migrations
   - Monitor logs

**Total**: ~2 hours for one dev, ~1 hour with pair programming

---

## Progress Tracking

### Phase 1: Schema (DO THIS FIRST)
- [ ] Add organization_id to templates
- [ ] Add organization_id to documents, batches, training_samples
- [ ] Create indices
- [ ] Test migration locally

### Phase 2: Query Functions (DO THIS SECOND)
- [ ] Update listTemplates()
- [ ] Update getTemplate()
- [ ] Update listDocuments()
- [ ] Update listRecords()
- [ ] Update createTemplate()
- [ ] Update saveExtraction()
- [ ] (8+ more functions)

### Phase 3: Routes (DO THIS THIRD)
- [ ] templates.js (6 endpoints)
- [ ] data.js (5 endpoints)
- [ ] settings.js (4 endpoints)
- [ ] extraction.js (2 endpoints)
- [ ] training.js (varies)
- [ ] imports.js (varies)
- [ ] aiTemplates.js (varies)

### Phase 4: Testing
- [ ] Unit tests pass
- [ ] Cross-tenant test matrix
- [ ] Manual smoke tests
- [ ] Staging deployment
- [ ] Production backup + deploy

---

## What Doesn't Need Fixing (Yet)

✅ **Email verification**: Nice to have, not blocking SaaS  
✅ **Password reset**: Not required for MVP  
✅ **Rate limiting**: Low priority (no public endpoints)  
✅ **CORS hardening**: Current config OK for SaaS  
⚠️ **Secrets**: Already encrypted (AES-256-GCM), good enough  

**Focus on multi-tenancy FIRST. Everything else is secondary.**

---

## Questions for the Team

**Before starting:**

1. Can we take the service down for ~30 min for schema migration?
   - Answer: Most likely yes (pre-launch)

2. Should we test with synthetic multi-tenant data or real customer data?
   - Answer: Synthetic first, then real in staging

3. How many existing organizations do we have?
   - Answer: Probably 0-2 (pre-launch), use DEFAULT org (id=1)

4. Who's responsible for testing cross-tenant scenarios?
   - Answer: QA + Dev pair (2 people, 1 hour)

---

## Success Criteria (Before Launch)

- ✅ Schema v9 deployed
- ✅ 100% of data routes filtered by org_id
- ✅ Zero cross-tenant data leakage in test matrix
- ✅ All 30+ endpoints validated
- ✅ Documentation updated
- ✅ Zero "organizationId required" errors in prod logs (first 24h)

**Estimated Launch Readiness**: 1 sprint (2 weeks) after fixes complete

---

## Next Actions

1. **Read the full analysis**: MULTITENANT_SECURITY_ANALYSIS.md
2. **Review implementation guide**: MULTITENANT_IMPLEMENTATION.md
3. **Assign developer**: Start with Phase 1 (schema)
4. **Set target date**: Multi-tenancy done before customer onboarding
5. **Brief team**: Risk level is CRITICAL, not optional

**This is the highest-priority pre-launch fix. Do it first.**
