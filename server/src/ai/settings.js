// Settings access layer. Multi-tenant ready: every read/write takes an
// organization_id, defaulting to 1 in single-tenant mode. Secrets are
// encrypted at rest with a server-side key (DOCUSTRUCT_ENC_KEY env var, or
// a deterministic fallback for local dev).
import crypto from 'node:crypto';
import { db } from '../db.js';

const ENC_KEY_RAW = process.env.DOCUSTRUCT_ENC_KEY ||
  // Local-dev fallback. NOT secure — please set DOCUSTRUCT_ENC_KEY in prod.
  'docustruct-dev-key-change-me-pleeeeease';
const KEY = crypto.createHash('sha256').update(ENC_KEY_RAW).digest();

function encrypt(plain) {
  if (plain == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'enc:v1:' + Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(stored) {
  if (!stored) return null;
  if (!stored.startsWith('enc:v1:')) return stored; // legacy plaintext
  const buf = Buffer.from(stored.slice('enc:v1:'.length), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

const SECRET_KEYS = new Set([
  'ai.api_key',
]);
function isSecret(key) {
  return SECRET_KEYS.has(key) || key.startsWith('secret.');
}

export function getSetting(key, { organizationId = 1, raw = false } = {}) {
  const row = db
    .prepare('SELECT value, is_secret FROM settings WHERE organization_id = ? AND key = ?')
    .get(organizationId, key);
  if (!row) return null;
  let value = row.value;
  if (row.is_secret && !raw) value = decrypt(value);
  if (value == null) return null;
  try { return JSON.parse(value); } catch { return value; }
}

export function setSetting(key, value, { organizationId = 1 } = {}) {
  const encoded = value == null ? null : JSON.stringify(value);
  const secret = isSecret(key) ? 1 : 0;
  const stored = secret ? encrypt(encoded) : encoded;
  db.prepare(
    `INSERT INTO settings(organization_id, key, value, is_secret, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(organization_id, key) DO UPDATE SET
       value = excluded.value,
       is_secret = excluded.is_secret,
       updated_at = excluded.updated_at`
  ).run(organizationId, key, stored, secret);
}

export function getAllSettings({ organizationId = 1, redactSecrets = true } = {}) {
  const rows = db
    .prepare('SELECT key, value, is_secret FROM settings WHERE organization_id = ?')
    .all(organizationId);
  const out = {};
  for (const r of rows) {
    if (r.is_secret && redactSecrets) {
      out[r.key] = r.value ? '••••' : null;
    } else {
      let v = r.is_secret ? decrypt(r.value) : r.value;
      try { v = JSON.parse(v); } catch {}
      out[r.key] = v;
    }
  }
  return out;
}

// Helper: hydrate the AI configuration as a single object.
export function getAIConfig({ organizationId = 1 } = {}) {
  return {
    enabled: getSetting('ai.enabled', { organizationId }) ?? false,
    provider: getSetting('ai.provider', { organizationId }) ?? null,
    model: getSetting('ai.model', { organizationId }) ?? null,
    apiKey: getSetting('ai.api_key', { organizationId }) ?? null,
    confidenceThreshold: getSetting('ai.confidence_threshold', { organizationId }) ?? 0.6,
    maxCallsPerImport: getSetting('ai.max_calls_per_import', { organizationId }) ?? 50,
    monthlyBudgetUsd: getSetting('ai.monthly_budget_usd', { organizationId }) ?? 5,
  };
}
