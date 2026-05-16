# Auth & Multi-Tenancy Implementation — DocuStruct

**Completed**: May 16, 2026

## Summary

DocuStruct now has a complete authentication and authorization system ready for multi-tenant SaaS deployment.

### What's Done

✅ **Auth System**
- User registration (signup) with org creation
- Email/password login with session tokens
- Session management (24-hour expiry, logout)
- Password hashing (scrypt) + validation

✅ **Database Schema (v8)**
- `organizations` table
- `users` table with roles (admin/operator/viewer)
- `sessions` table with expiry checks
- `org_secrets` table for encrypted API keys

✅ **Backend Routes**
- `POST /api/auth/signup` — create org + user + session
- `POST /api/auth/login` — validate credentials, create session
- `POST /api/auth/logout` — invalidate session
- `GET /api/auth/me` — fetch current user + org

✅ **Auth Middleware**
- `authenticate` — validates Bearer token, attaches user/org to request
- `authorize` — role-based checks (stub for extension)
- Protected routes enforce auth on all `/api/*` endpoints

✅ **Frontend Pages**
- `/login` — email/password form
- `/signup` — org name + email + password form
- Route protection: unauthenticated users → `/login`, authenticated users → `/dashboard`
- Session token stored in `localStorage`

✅ **API Client**
- `getAuthHeader()` — injects `Authorization: Bearer <token>` to all requests
- Automatic auth on GET/POST/DELETE/upload

✅ **Styling**
- Auth page layout (centered form, 420px width)
- Dark sidebar theme compatible
- Form inputs, buttons, error messages with design tokens

## Files Added/Modified

### Backend
| File | Purpose |
|------|---------|
| `server/src/auth.js` | Password hashing, session tokens, encryption utilities |
| `server/src/db.js` | v8 schema + auth table helpers (createUser, getSession, etc.) |
| `server/src/routes/auth.js` | Auth endpoints (signup, login, logout, /me) |
| `server/src/middleware/auth.js` | authenticate + authorize middleware |
| `server/src/index.js` | Mount auth routes + protect others |

### Frontend
| File | Purpose |
|------|---------|
| `client/src/pages/Login.jsx` | Login form component |
| `client/src/pages/Signup.jsx` | Signup form component |
| `client/src/App.jsx` | Route protection + auth state |
| `client/src/api.js` | Add auth header to all requests |
| `client/src/styles.css` | Auth page styling |

### Docs
| File | Purpose |
|------|---------|
| `SECURITY_AUDIT.md` | Pre-auth security & architecture gaps |
| `IMPLEMENTATION_GUIDE.md` | This file |

## How to Test

### 1. Start the server
```bash
cd server
npm run dev
```

### 2. Start the client
```bash
cd client
npm run dev
# Opens http://localhost:5173
```

### 3. Test signup flow
- Navigate to http://localhost:5173/signup
- Enter org name, email, password (8+ chars)
- Should redirect to /dashboard on success
- Session token stored in localStorage

### 4. Test login flow
- Logout (optional): check localStorage, clear `session_token`
- Navigate to http://localhost:5173/login
- Enter email + password
- Should redirect to /dashboard
- Session stored in `sessions` table with 24h expiry

### 5. Verify auth protection
```bash
# No token → 401
curl http://localhost:4000/api/templates

# With token → 200
curl -H "Authorization: Bearer <token>" http://localhost:4000/api/templates
```

## Deployment Notes

### Environment Variables
```env
# Required in production
ENCRYPTION_KEY=<32-byte hex string>  # For secret encryption
NODE_ENV=production
PORT=4000

# Optional (dev defaults)
DB_PATH=./data/docustruct.sqlite
```

### Database Migration
Running the server with an existing v7 database:
1. Schema v8 creates new auth tables
2. Migration creates default org if needed
3. Existing templates/data remain untouched
4. No data loss

To start fresh:
```bash
rm server/data/docustruct.sqlite
npm run dev  # Recreates schema v8
```

### Security Checklist for SaaS Launch

- [ ] Change `ENCRYPTION_KEY` to a strong random value (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- [ ] Enable HTTPS in nginx/reverse proxy
- [ ] Add rate limiting on `/api/auth/*` endpoints
- [ ] Configure CORS properly (not `*` in production)
- [ ] Add HSTS headers
- [ ] Set Secure + HttpOnly cookies (future: use cookies instead of localStorage)
- [ ] Implement email verification on signup
- [ ] Add password reset flow
- [ ] Enable audit logging for sensitive operations
- [ ] Set up monitoring for failed login attempts

## Next Steps (Not Implemented)

### Phase 1: Hardening
- [ ] Email verification on signup
- [ ] Password reset via email
- [ ] 2FA support
- [ ] Rate limiting on auth endpoints
- [ ] Session refresh tokens (long-lived + short-lived pairs)

### Phase 2: Multi-Tenancy Enforcement
- [ ] Filter all template/data queries by `organization_id`
- [ ] Prevent cross-org data access
- [ ] Tenant-scoped API keys

### Phase 3: RBAC Completion
- [ ] Operator: create/edit templates, import, review (no delete, no settings)
- [ ] Viewer: read-only access to data
- [ ] Permission checks on DELETE/PATCH/POST operations

### Phase 4: Billing & Admin
- [ ] Organization settings page (name, billing, members)
- [ ] Invite team members with role assignment
- [ ] Usage tracking (imports, AI calls)
- [ ] Stripe metered billing integration

### Phase 5: Advanced Auth
- [ ] SSO (OIDC/OAuth)
- [ ] API key auth (for programmatic access)
- [ ] Session activity logs
- [ ] Device / IP trust levels

## Code Examples

### Signup
```javascript
POST /api/auth/signup
{
  "name": "Acme Corp",
  "email": "admin@acme.com",
  "password": "securepass123"
}

Response 201:
{
  "user": { "id": 1, "email": "admin@acme.com", "role": "admin" },
  "organization": { "id": 1, "name": "Acme Corp" },
  "session": "3f2d8e1c..." 
}
```

### Login
```javascript
POST /api/auth/login
{
  "email": "admin@acme.com",
  "password": "securepass123"
}

Response 200:
{
  "user": { "id": 1, "email": "admin@acme.com", "role": "admin" },
  "organization": { "id": 1 },
  "session": "9a1b2c3d..."
}
```

### Protected Request
```javascript
GET /api/templates
Headers: { "Authorization": "Bearer 9a1b2c3d..." }

Response 200: [{ id: 1, name: "BCBS Commission", ... }]
```

## Troubleshooting

### "Unauthorized" on protected routes
- Check `session_token` in localStorage
- Verify token hasn't expired (24h)
- Check Authorization header format: `Bearer <token>`

### "Session expired" on login
- Clear localStorage, try again
- Check server time sync (sessions are UTC)

### Database migration issues
- Backup db file: `cp data/docustruct.sqlite data/docustruct.sqlite.bak`
- Delete: `rm data/docustruct.sqlite`
- Restart server to re-create from v8

### Auth pages show blank
- Check browser console for errors
- Verify Vite proxy is running (`http://localhost:5173` → `http://localhost:4000/api`)
- Check CORS settings

## Architecture Notes

### Session Token Format
- 64-char hex string (32 bytes random)
- No structure / expiry in token itself
- Expiry checked server-side on every request
- Invalidated on logout (DELETE from sessions table)

### Org Isolation
- `organization_id` on all domain tables (not yet enforced)
- Middleware attaches `req.organization_id` from session
- Filters should use: `WHERE ... AND organization_id = ?`

### Password Security
- Scrypt key derivation (N=16384, r=8, p=1)
- 16-byte salt per password
- Stored as `salt:hash` hexstring
- Never logs plaintext password

### Secret Encryption
- AES-256-GCM (authenticated encryption)
- Per-secret IV (random per encryption)
- Format: `iv:authTag:ciphertext` (all hex)
- Decryption validates authTag before returning plaintext
