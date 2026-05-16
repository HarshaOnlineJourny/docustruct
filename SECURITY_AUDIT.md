# Security & Architecture Audit — DocuStruct

**Date**: May 2026  
**Status**: Pre-SaaS (single-tenant, no auth)

## Critical Issues

### 1. **No Authentication System** 🔴
- All endpoints are open; anyone can access/modify data
- No session/token management
- Required: email/password login, JWT/session handling
- Impact: **BLOCKER for SaaS launch**

### 2. **No Multi-Tenancy Isolation** 🔴
- Database schema includes `organization` field on `templates`, but it's not enforced
- No middleware validates request context against `organization_id`
- Queries don't filter by tenant; user can read/modify any organization's data
- Impact: **BLOCKER for multi-tenant deployment**

### 3. **No Authorization (RBAC)** 🔴
- No role definitions (admin/operator/viewer) in schema
- No permission checks before sensitive operations (delete, export, settings changes)
- Impact: **BLOCKER for team collaboration**

### 4. **Weak Input Validation** 🟡
- User inputs accepted without sanitization (template names, field labels, notes)
- No length limits on text fields
- No SQL injection protection (queries use parameterized statements ✓, but no field type validation)
- Delete operations accept arbitrary IDs without authorization

### 5. **Secrets Management** 🟡
- AI provider API keys stored in plaintext in `settings` table
- No encryption for sensitive configuration
- Required: symmetric encryption (at-rest) + HTTPS only (in-transit)

### 6. **Environment Handling** 🟡
- `.env` values not validated on startup
- `NODE_ENV` defaults to 'development'; no safe defaults for production
- Missing: rate limiting, request size caps (5mb is broad)

### 7. **Error Handling** 🟡
- Stack traces leaked to clients in non-production
- Generic 500 errors don't hide implementation details
- No logging/monitoring for suspicious activity

### 8. **CORS & Security Headers** 🟡
- CORS is permissive (`cors()` with no config); OK for local dev, not for production
- Missing: CSP, X-Frame-Options, X-Content-Type-Options headers
- No HTTPS enforcement in production

## Schema Changes Required

```sql
-- Add to db.js schema (version 8+)

CREATE TABLE organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,  -- bcrypt
  role TEXT NOT NULL DEFAULT 'operator' 
    CHECK (role IN ('admin','operator','viewer')),
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,  -- UUID
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE org_secrets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,  -- e.g. 'ai_provider_key_openai'
  encrypted_value TEXT NOT NULL,  -- use crypto.subtle or sodium
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, key)
);

-- Alter existing tables to enforce tenancy:
-- (requires data migration)
ALTER TABLE templates ADD COLUMN organization_id INTEGER NOT NULL DEFAULT 1
  REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE templates ADD CONSTRAINT templates_org_id_unique 
  UNIQUE(organization_id, name);
```

## Middleware & Auth Flow

### Auth Middleware
```js
// middleware/auth.js
export const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(token);
    if (!session || new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Session expired' });
    }
    req.user_id = session.user_id;
    req.organization_id = session.organization_id;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const authorize = (...roles) => (req, res, next) => {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user_id);
  if (!user || !roles.includes(user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
};
```

### Login/Signup Flow
```js
// POST /api/auth/signup
// { name, email, password } → create org + user + session

// POST /api/auth/login
// { email, password } → validate, create session, return token

// POST /api/auth/logout
// invalidate session

// GET /api/auth/me
// return current user + org
```

## Improvements by Priority

| Priority | Category | Action |
|----------|----------|--------|
| P0 | Auth | Implement login/signup pages + JWT/session endpoints |
| P0 | Isolation | Add auth middleware; filter all queries by `organization_id` |
| P0 | Secrets | Encrypt API keys at rest; use environment variables |
| P1 | RBAC | Define roles in schema; add authorization checks |
| P1 | Validation | Strict input validation (length, type, format) |
| P1 | Headers | Add security headers (CSP, HSTS, X-Frame-Options) |
| P2 | Logging | Structured logging for audit trail |
| P2 | Rate Limiting | Per-IP, per-user rate limits on sensitive endpoints |

## Immediate Actions

1. **Add auth tables** (v8 migration)
2. **Build signup/login pages** (React)
3. **Implement auth endpoints** (Express)
4. **Protect routes** with middleware
5. **Filter queries** by organization_id
6. **Encrypt secrets** in settings
7. **Add environment validation** (.env schema)
8. **Test login flow** end-to-end
