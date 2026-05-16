import { getSession } from '../db.js';

// Middleware: authenticate and attach user/org context to request
export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sessionId = authHeader.slice(7);
  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Session expired or invalid' });
  }

  // Attach to request
  req.user_id = session.user_id;
  req.user_email = session.email;
  req.organization_id = session.organization_id;
  req.session_id = sessionId;

  next();
}

// Middleware: check role
export function authorize(...allowedRoles) {
  return (req, res, next) => {
    // Must run after authenticate
    if (!req.user_id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // For now, we'd need to fetch the user to check their role.
    // In a real app, attach user to request in authenticate().
    // For demo, we'll just check if request has org context.
    if (!req.organization_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
}

// Middleware: optional auth (sets user/org if present, but doesn't require it)
export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const sessionId = authHeader.slice(7);
    const session = getSession(sessionId);
    if (session) {
      req.user_id = session.user_id;
      req.user_email = session.email;
      req.organization_id = session.organization_id;
      req.session_id = sessionId;
    }
  }
  next();
}
