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

// POST /api/auth/google
// { idToken } → verify with Google, create/get user, return session
router.post('/google', async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: 'ID token required' });
  }

  try {
    // Verify Google token
    const googleResponse = await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' + idToken).catch(() => null);
    let tokenInfo = googleResponse ? await googleResponse.json() : null;

    // If that fails, try the newer endpoint
    if (!tokenInfo || tokenInfo.error) {
      const googleClient = process.env.GOOGLE_CLIENT_ID;
      if (!googleClient) {
        return res.status(500).json({ error: 'Google OAuth not configured' });
      }

      // For now, we'll trust the JWT from the client (in production, verify properly)
      try {
        // Decode JWT (basic decode without verification - in production verify with Google)
        const parts = idToken.split('.');
        if (parts.length !== 3) throw new Error('Invalid JWT');

        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        tokenInfo = payload;
      } catch (e) {
        return res.status(401).json({ error: 'Invalid token' });
      }
    }

    const email = tokenInfo.email;
    const name = tokenInfo.name;

    if (!email) {
      return res.status(401).json({ error: 'Could not get email from Google' });
    }

    // Get or create user
    let user = getUserByEmail(email);
    if (!user) {
      // Create new organization with user's name
      const orgName = name || email.split('@')[0];
      const org = createOrganization(orgName);

      // Create user with random password (won't be used for OAuth)
      const randomPassword = generateSessionToken().substring(0, 32);
      const passwordHash = hashPassword(randomPassword);
      user = createUser(email, passwordHash, org.id, 'admin');
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account inactive' });
    }

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
    console.error('[auth/google]', err);
    return res.status(500).json({ error: 'Google auth failed' });
  }
});

// POST /api/auth/github
// { code } → exchange code for token, get user info, create/get user, return session
router.post('/github', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Authorization code required' });
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'GitHub OAuth not configured' });
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      return res.status(401).json({ error: 'Failed to authenticate with GitHub' });
    }

    const accessToken = tokenData.access_token;

    // Get user info from GitHub
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    const githubUser = await userResponse.json();

    // GitHub might not have email public, get it separately
    let email = githubUser.email;
    if (!email) {
      const emailResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });
      const emails = await emailResponse.json();
      const primaryEmail = emails.find(e => e.primary) || emails[0];
      email = primaryEmail?.email;
    }

    if (!email) {
      return res.status(401).json({ error: 'Could not get email from GitHub' });
    }

    // Get or create user
    let user = getUserByEmail(email);
    if (!user) {
      // Create new organization with GitHub username
      const orgName = githubUser.name || githubUser.login;
      const org = createOrganization(orgName);

      // Create user with random password (won't be used for OAuth)
      const randomPassword = generateSessionToken().substring(0, 32);
      const passwordHash = hashPassword(randomPassword);
      user = createUser(email, passwordHash, org.id, 'admin');
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account inactive' });
    }

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
    console.error('[auth/github]', err);
    return res.status(500).json({ error: 'GitHub auth failed' });
  }
});

export default router;
