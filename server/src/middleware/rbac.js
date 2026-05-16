import { getUser } from '../db.js';

// RBAC: Role-based access control
// Roles: admin, operator, viewer
// Permissions:
//   - admin: full access (create, read, update, delete, settings)
//   - operator: create/read/update templates, train, import, review (no delete, no settings)
//   - viewer: read-only access to templates and data

const PERMISSIONS = {
  admin: [
    'create:template', 'read:template', 'update:template', 'delete:template',
    'create:training', 'read:training', 'update:training',
    'create:import', 'read:import', 'update:import',
    'read:data', 'delete:data', 'export:data',
    'read:settings', 'update:settings',
  ],
  operator: [
    'create:template', 'read:template', 'update:template',
    'create:training', 'read:training', 'update:training',
    'create:import', 'read:import', 'update:import',
    'read:data', 'export:data',
  ],
  viewer: [
    'read:template',
    'read:data',
  ],
};

export function authorize(...requiredPermissions) {
  return (req, res, next) => {
    // Must run after authenticate
    if (!req.user_id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = getUser(req.user_id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const userPermissions = PERMISSIONS[user.role] || [];
    const hasPermission = requiredPermissions.every((perm) =>
      userPermissions.includes(perm)
    );

    if (!hasPermission) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Attach user to request for convenience
    req.user = user;
    next();
  };
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user_id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = getUser(req.user_id);
    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    req.user = user;
    next();
  };
}

export function isAdmin(req) {
  return req.user?.role === 'admin';
}

export function isOperator(req) {
  return req.user?.role === 'operator' || isAdmin(req);
}

export function isViewer(req) {
  return req.user?.role === 'viewer' || isOperator(req);
}
