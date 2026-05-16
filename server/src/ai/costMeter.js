// Logs every AI call to the ai_calls table and answers spending questions.
import { db } from '../db.js';

export function logCall({
  organizationId = 1, templateId = null, documentId = null,
  task, provider, model,
  promptTokens = null, completionTokens = null, costUsd = null,
  cacheHit = false, success = true, error = null,
}) {
  db.prepare(
    `INSERT INTO ai_calls(organization_id, template_id, document_id, task, provider, model,
                          prompt_tokens, completion_tokens, cost_usd, cache_hit, success, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    organizationId, templateId, documentId, task, provider, model,
    promptTokens, completionTokens, costUsd,
    cacheHit ? 1 : 0, success ? 1 : 0, error
  );
}

export function monthToDateUsd({ organizationId = 1 } = {}) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total
         FROM ai_calls
        WHERE organization_id = ?
          AND created_at >= date('now', 'start of month')`
    )
    .get(organizationId);
  return row?.total || 0;
}

export function recentCalls({ organizationId = 1, limit = 50 } = {}) {
  return db
    .prepare(
      `SELECT * FROM ai_calls
        WHERE organization_id = ?
        ORDER BY created_at DESC
        LIMIT ?`
    )
    .all(organizationId, limit);
}
