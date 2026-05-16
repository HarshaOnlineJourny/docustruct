// Top-level AI service. Single entry point used by the extractor; swallows
// "no provider configured" gracefully so the deterministic engine remains
// the primary path.
import crypto from 'node:crypto';
import { getAIConfig } from './settings.js';
import { getProvider, listProviders } from './registry.js';
import { cacheKey, getCached, setCached } from './cache.js';
import { logCall, monthToDateUsd } from './costMeter.js';

export { listProviders };

export async function extractCellWithAI(input, { organizationId = 1, templateId = null, documentId = null } = {}) {
  const cfg = getAIConfig({ organizationId });
  if (!cfg.enabled || !cfg.provider || !cfg.apiKey || !cfg.model) {
    return { skipped: 'no_provider' };
  }
  // Budget guard.
  const spent = monthToDateUsd({ organizationId });
  if (spent >= cfg.monthlyBudgetUsd) {
    return { skipped: 'budget_exceeded' };
  }

  const provider = getProvider(cfg.provider);
  if (!provider) return { skipped: 'unknown_provider' };

  const key = cacheKey({ task: 'extractCell', templateId, fieldId: input.fieldId, cellText: input.cellText, context: input.context });
  const hit = getCached(key, { organizationId });
  if (hit) {
    logCall({ organizationId, templateId, documentId, task: 'extractCell',
              provider: cfg.provider, model: cfg.model, cacheHit: true });
    return hit;
  }

  try {
    const result = await provider.extractCell(input, { ...cfg });
    setCached(key, result, { organizationId });
    logCall({
      organizationId, templateId, documentId,
      task: 'extractCell', provider: cfg.provider, model: cfg.model,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
      costUsd: result.usage?.costUsd,
    });
    return result;
  } catch (err) {
    if (err.code === 'NOT_IMPLEMENTED') {
      return { skipped: 'not_implemented' };
    }
    logCall({
      organizationId, templateId, documentId,
      task: 'extractCell', provider: cfg.provider, model: cfg.model,
      success: false, error: String(err.message || err),
    });
    return { skipped: 'error', error: String(err.message || err) };
  }
}


// Suggest a starter template from text excerpts of N PDFs.
// Inputs: samples = [{ name, text }] (caller has already extracted text).
// Returns: { template, raw, usage } or { skipped: ... } if AI not configured.
export async function suggestTemplateWithAI(samples, { organizationId = 1 } = {}) {
  const cfg = getAIConfig({ organizationId });
  if (!cfg.enabled || !cfg.provider || !cfg.apiKey || !cfg.model) {
    return { skipped: 'no_provider' };
  }
  const spent = monthToDateUsd({ organizationId });
  if (spent >= cfg.monthlyBudgetUsd) {
    return { skipped: 'budget_exceeded' };
  }
  const provider = getProvider(cfg.provider);
  if (!provider) return { skipped: 'unknown_provider' };
  try {
    const result = await provider.suggestTemplate(samples, { ...cfg });
    logCall({
      organizationId,
      task: 'suggestTemplate',
      provider: cfg.provider, model: cfg.model,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
      costUsd: result.usage?.costUsd,
    });
    return result;
  } catch (err) {
    if (err.code === 'NOT_IMPLEMENTED') return { skipped: 'not_implemented' };
    logCall({
      organizationId, task: 'suggestTemplate',
      provider: cfg.provider, model: cfg.model,
      success: false, error: String(err.message || err),
    });
    return { skipped: 'error', error: String(err.message || err) };
  }
}


// Whole-PDF vision rescue. Used when text extraction yields nothing useful
// (hostile / scanned / multi-line PDFs). Reads the file from disk, ships it
// to the provider, and returns the records in the same shape as the
// deterministic engine would produce.
import fs from 'node:fs';
export async function visionRescueWithAI(pdfPath, template, { organizationId = 1, templateId = null, documentId = null, hint = '' } = {}) {
  const cfg = getAIConfig({ organizationId });
  if (!cfg.enabled || !cfg.provider || !cfg.apiKey || !cfg.model) {
    return { skipped: 'no_provider' };
  }
  const spent = monthToDateUsd({ organizationId });
  if (spent >= cfg.monthlyBudgetUsd) {
    return { skipped: 'budget_exceeded' };
  }
  const provider = getProvider(cfg.provider);
  if (!provider) return { skipped: 'unknown_provider' };

  try {
    const buf = fs.readFileSync(pdfPath);
    // File-hash cache: same PDF + same template fields + same prompt + same
    // model = same result. Re-running preview or re-extracting the same PDF
    // is free after the first call.
    const fileHash = crypto.createHash('sha1').update(buf).digest('hex');
    const fieldSig = (template.fields || []).map((f) => `${f.name}:${f.type}:${f.is_primary ? 1 : 0}`).join('|');
    const visionKey = cacheKey({
      task: 'visionRescue',
      templateId,
      fieldId: null,
      cellText: fileHash,
      context: `${cfg.model}|${hint}|${fieldSig}`,
    });
    const cached = getCached(visionKey, { organizationId });
    if (cached) {
      logCall({
        organizationId, templateId, documentId,
        task: 'visionRescue', provider: cfg.provider, model: cfg.model,
        cacheHit: true,
      });
      return cached;
    }
    const result = await provider.extractRecordsFromPDF(buf, template, { ...cfg, hint });
    logCall({
      organizationId, templateId, documentId,
      task: 'visionRescue', provider: cfg.provider, model: cfg.model,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
      costUsd: result.usage?.costUsd,
    });
    // Convert the LLM's record list into the engine's record shape.
    const records = (result.records || []).map((r) => {
      const values = {};
      for (const f of template.fields) {
        const raw = r.values?.[f.name];
        values[f.name] = {
          value: raw == null || raw === '' ? null : raw,
          raw_text: raw == null ? null : String(raw),
          source: 'ai_vision',
          confidence: r.confidence ?? 0.85,
        };
      }
      return { values, confidence: r.confidence ?? 0.85, source_text: '' };
    });
    const payload = {
      ok: true, records, raw: result.raw, usage: result.usage,
      truncated: !!result.truncated,
      learned_patterns: result.learned_patterns || null,
    };
    // Cache for repeat runs on the same PDF.
    setCached(visionKey, payload, { organizationId });
    return payload;
  } catch (err) {
    if (err.code === 'NOT_IMPLEMENTED') return { skipped: 'not_implemented' };
    logCall({
      organizationId, templateId, documentId,
      task: 'visionRescue', provider: cfg.provider, model: cfg.model,
      success: false, error: String(err.message || err),
    });
    return { skipped: 'error', error: String(err.message || err) };
  }
}

// Vision-first onboarding: ship a PDF to the LLM and ask it to propose a
// template AND extract a first batch of records in one call. Used by the
// AI Onboarding Wizard so it handles hostile / scanned PDFs natively.
export async function analyzePdfForOnboardingWithAI(pdfPath, userHint, { organizationId = 1 } = {}) {
  const cfg = getAIConfig({ organizationId });
  if (!cfg.enabled || !cfg.provider || !cfg.apiKey || !cfg.model) {
    return { skipped: 'no_provider' };
  }
  const spent = monthToDateUsd({ organizationId });
  if (spent >= cfg.monthlyBudgetUsd) {
    return { skipped: 'budget_exceeded' };
  }
  const provider = getProvider(cfg.provider);
  if (!provider) return { skipped: 'unknown_provider' };
  if (typeof provider.analyzePdfForOnboarding !== 'function') {
    return { skipped: 'not_implemented' };
  }
  try {
    const buf = fs.readFileSync(pdfPath);
    const result = await provider.analyzePdfForOnboarding(buf, userHint || '', { ...cfg });
    logCall({
      organizationId,
      task: 'analyzePdfForOnboarding',
      provider: cfg.provider, model: cfg.model,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
      costUsd: result.usage?.costUsd,
    });
    return { ok: true, ...result, learned_patterns: result.learned_patterns || null };
  } catch (err) {
    if (err.code === 'NOT_IMPLEMENTED') return { skipped: 'not_implemented' };
    logCall({
      organizationId, task: 'analyzePdfForOnboarding',
      provider: cfg.provider, model: cfg.model,
      success: false, error: String(err.message || err),
    });
    return { skipped: 'error', error: String(err.message || err) };
  }
}

export function aiStatus({ organizationId = 1 } = {}) {
  const cfg = getAIConfig({ organizationId });
  return {
    enabled: cfg.enabled && !!cfg.provider && !!cfg.apiKey && !!cfg.model,
    provider: cfg.provider,
    model: cfg.model,
    monthly_budget_usd: cfg.monthlyBudgetUsd,
    confidence_threshold: cfg.confidenceThreshold,
    max_calls_per_import: cfg.maxCallsPerImport,
    spend_month_to_date: monthToDateUsd({ organizationId }),
  };
}
