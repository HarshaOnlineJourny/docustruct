import express from 'express';
import {
  hashPassword, verifyPassword, generateSessionToken, expiresAt,
  isValidEmail, isStrongPassword
} from '../auth.js';
import {
  createOrganization, getOrganization, getUserByEmail, createUser, getUser,
  createSession, getSession, deleteSession
} from '../db.js';

const router = express.Router();

// POST /api/auth/signup
// { name, email, password } → create org + user + session
router.post('/signup', (req, res) => {
  const { name, email, password } = req.body;

  // Validation
  if (!name || !name.trim()) return res.status(400).json({ error: 'Organization name required' });
  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email' });
  if (!isStrongPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  // Check if user already exists
  if (getUserByEmail(email)) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  try {
    // Create organization
    const org = createOrganization(name.trim());

    // Create user with admin role
    const passwordHash = hashPassword(password);
    const user = createUser(email, passwordHash, org.id, 'admin');

    // Create session
    const sessionId = generateSessionToken();
    const sessionExpiry = expiresAt(24); // 24 hours
    createSession(sessionId, user.id, org.id, sessionExpiry);

    return res.status(201).json({
      user: { id: user.id, email: user.email, role: user.role },
      organization: { id: org.id, name: org.name },
      session: sessionId,
    });
  } catch (err) {
    console.error('[auth/signup]', err);
    return res.status(500).json({ error: 'Signup failed' });
  }
});

// POST /api/auth/login
// { email, password } → validate + create session
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!password) return res.status(400).json({ error: 'Password required' });

  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!user.is_active) {
    return res.status(403).json({ error: 'Account inactive' });
  }

  try {
    // Create session
    const sessionId = generateSessionToken();
    const sessionExpiry = expiresAt(24);
    createSession(sessionId, user.id, user.organization_id, sessionExpiry);

    const org = getOrganization(user.organization_id);
    return res.json({
      user: { id: user.id, email: user.email, role: user.role },
      organization: { id: org.id, name: org.name },
      session: sessionId,
    });
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout
// { session_id } → invalidate session
router.post('/logout', (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  deleteSession(session_id);
  return res.json({ ok: true });
});

// GET /api/auth/me
// Requires Authorization: Bearer <session_id>
router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sessionId = authHeader.slice(7);
  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Session expired or invalid' });
  }

  const user = getUser(session.user_id);
  return res.json({
    user: { id: user.id, email: user.email, role: user.role },
    organization_id: session.organization_id,
  });
});

export default router;
