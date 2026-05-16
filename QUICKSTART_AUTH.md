# QuickStart: Auth System

## Start the App

```bash
# Backend
cd server && npm run dev

# Frontend (new terminal)
cd client && npm run dev
```

Visit http://localhost:5173 — auto-redirects to `/login`

## Try It Out

### Signup (First Time)
1. Click "Sign up"
2. Enter:
   - Organization: `Acme Inc`
   - Email: `admin@acme.com`
   - Password: `Test1234!` (8+ chars)
3. Submit → auto-login → dashboard

### Login (Subsequent Times)
1. Email: `admin@acme.com`
2. Password: `Test1234!`
3. Submit → dashboard

### Test Auth Protection
```bash
# Without token → 401
curl http://localhost:4000/api/templates

# With token → 200
BEARER="<token from login response>"
curl -H "Authorization: Bearer $BEARER" \
  http://localhost:4000/api/templates
```

## What Changed

| Before | After |
|--------|-------|
| No login page | ✅ `/login` + `/signup` |
| All endpoints open | ✅ Protected routes require token |
| No user concept | ✅ Users, orgs, roles (admin/operator/viewer) |
| No sessions | ✅ 24-hour sessions with expiry |
| No password security | ✅ Scrypt hashing + salt |

## Key Files

**Backend**
- `server/src/routes/auth.js` — signup/login/logout endpoints
- `server/src/middleware/auth.js` — token validation
- `server/src/db.js` — user/org/session schema (v8)

**Frontend**
- `client/src/pages/Login.jsx` — login form
- `client/src/pages/Signup.jsx` — signup form
- `client/src/App.jsx` — route protection

## Architecture

```
User visits http://localhost:5173
  ↓
App.jsx checks localStorage for 'session_token'
  ↓
No token? → Redirect to /login
  ↓
User submits login credentials
  ↓
POST /api/auth/login → returns session token
  ↓
App stores token in localStorage
  ↓
Redirect to /dashboard
  ↓
All API calls auto-include: Authorization: Bearer <token>
```

## Database

After signup, check database:
```bash
cd server
sqlite3 data/docustruct.sqlite

# List orgs
SELECT * FROM organizations;

# List users (password_hash is scrypt, not plaintext)
SELECT id, email, role, organization_id FROM users;

# List sessions (expires_at is ISO 8601)
SELECT id, user_id, expires_at FROM sessions;
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Redirect loop between login/dashboard | Clear localStorage, check console for errors |
| 401 on API calls | Ensure `Authorization: Bearer <token>` header is sent |
| "Email already registered" | Use different email or delete user from DB |
| Session expired | Re-login (24-hour expiry) |

## Next Steps

- [ ] Add email verification on signup
- [ ] Add password reset flow
- [ ] Add team invite + role assignment
- [ ] Enforce multi-tenancy (filter by org_id)
- [ ] Add audit logging
- [ ] Deploy with HTTPS + security headers
