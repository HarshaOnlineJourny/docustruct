// Settings + AI configuration endpoints.
//   GET  /api/settings              -> redacted settings + AI status + spend
//   POST /api/settings/ai           -> save AI config (key encrypted)
//   GET  /api/settings/ai/providers -> available providers + their models
//   GET  /api/settings/ai/usage     -> recent ai_calls (audit log)
import express from 'express';
import { listProviders, aiStatus } from '../ai/index.js';
import { getAllSettings, setSetting, getAIConfig } from '../ai/settings.js';
import { recentCalls } from '../ai/costMeter.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    settings: getAllSettings({ organizationId: req.organization_id }),
    ai: aiStatus({ organizationId: req.organization_id }),
  });
});

router.get('/ai/providers', (_req, res) => {
  res.json(listProviders());
});

router.post('/ai', (req, res) => {
  const allowed = [
    'enabled', 'provider', 'model', 'api_key',
    'confidence_threshold', 'max_calls_per_import', 'monthly_budget_usd',
  ];
  const body = req.body || {};
  for (const k of allowed) {
    if (!(k in body)) continue;
    let v = body[k];
    // Empty-string means "leave unchanged" for the api_key field so the user
    // can edit other settings without having to re-paste their secret.
    if (k === 'api_key' && (v === '' || v === '••••')) continue;
    if (v === '') v = null;
    setSetting('ai.' + k, v, { organizationId: req.organization_id });
  }
  res.json({ ok: true, ai: aiStatus({ organizationId: req.organization_id }) });
});

router.get('/ai/usage', (req, res) => {
  res.json({
    spend: aiStatus({ organizationId: req.organization_id }).spend_month_to_date,
    recent: recentCalls({ organizationId: req.organization_id, limit: 50 }),
    config: { ...getAIConfig({ organizationId: req.organization_id }), apiKey: getAIConfig({ organizationId: req.organization_id }).apiKey ? '••••' : null },
  });
});

export default router;
