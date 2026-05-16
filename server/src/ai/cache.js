// Cell-level cache. Persisted to settings table under key 'ai.cache.<hash>'.
// In-memory LRU on top so repeated cells in the same import are free.
import crypto from 'node:crypto';
import { db } from '../db.js';

const MEM = new Map();
const MEM_LIMIT = 500;

export function cacheKey({ task, templateId, fieldId, cellText, context }) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify({ task, templateId, fieldId, cellText, context }))
    .digest('hex');
}

export function getCached(key, { organizationId = 1 } = {}) {
  if (MEM.has(key)) return MEM.get(key);
  const row = db
    .prepare(`SELECT value FROM settings WHERE organization_id = ? AND key = ?`)
    .get(organizationId, 'ai.cache.' + key);
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value);
    MEM.set(key, parsed);
    return parsed;
  } catch { return null; }
}

export function setCached(key, value, { organizationId = 1 } = {}) {
  if (MEM.size >= MEM_LIMIT) MEM.delete(MEM.keys().next().value);
  MEM.set(key, value);
  db.prepare(
    `INSERT INTO settings(organization_id, key, value, is_secret, updated_at)
     VALUES (?, ?, ?, 0, datetime('now'))
     ON CONFLICT(organization_id, key) DO UPDATE SET
       value = excluded.value, updated_at = excluded.updated_at`
  ).run(organizationId, 'ai.cache.' + key, JSON.stringify(value));
}
