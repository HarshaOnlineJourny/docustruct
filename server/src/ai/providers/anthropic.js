import { AIProvider } from './base.js';
import { buildExtractCellPrompt, buildSuggestTemplatePrompt, buildExtractRecordsPrompt, buildAnalyzePdfPrompt, estimateTokens, calcCostUsd } from '../prompt.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

export class AnthropicProvider extends AIProvider {
  get name() { return 'Anthropic'; }

  listModels() {
    return [
      // Latest generation (recommended).
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', contextWindow: 200000, costPer1MInput: 3, costPer1MOutput: 15 },
      { id: 'claude-opus-4-6',   label: 'Claude Opus 4.6',   contextWindow: 200000, costPer1MInput: 15, costPer1MOutput: 75 },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', contextWindow: 200000, costPer1MInput: 1, costPer1MOutput: 5 },
      // Legacy generation aliases — kept so older saved settings don't break,
      // but Anthropic may eventually deprecate them.
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (legacy)', contextWindow: 200000, costPer1MInput: 3, costPer1MOutput: 15 },
      { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5 (legacy)',  contextWindow: 200000, costPer1MInput: 1, costPer1MOutput: 5 },
    ];
  }

  async extractCell(input, config) {
    const { system, user } = buildExtractCellPrompt(input);
    const body = {
      model: config.model,
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: user + '\n\nReturn JSON only.' }],
    };
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = await res.json();
    // Anthropic returns content as an array of blocks.
    const content = (json.content || []).map((b) => b.text || '').join('');
    const parsed = safeJson(stripFences(content));
    const promptTokens     = json.usage?.input_tokens  ?? estimateTokens(system + user);
    const completionTokens = json.usage?.output_tokens ?? estimateTokens(content);
    const modelInfo = this.listModels().find((m) => m.id === config.model);
    return {
      value: parsed.value ?? null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
      reasoning: parsed.reasoning,
      raw: content,
      usage: {
        promptTokens, completionTokens,
        costUsd: calcCostUsd({ promptTokens, completionTokens, model: config.model, modelInfo }),
      },
    };
  }
  async suggestTemplate(samples, config) {
    const { system, user } = buildSuggestTemplatePrompt({ samples });
    const body = {
      model: config.model,
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: user + '\n\nReturn JSON only.' }],
    };
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const content = (json.content || []).map((b) => b.text || '').join('');
    const parsed = safeJson(stripFences(content));
    const promptTokens     = json.usage?.input_tokens  ?? estimateTokens(system + user);
    const completionTokens = json.usage?.output_tokens ?? estimateTokens(content);
    const modelInfo = this.listModels().find((m) => m.id === config.model);
    return {
      template: parsed,
      raw: content,
      usage: {
        promptTokens, completionTokens,
        costUsd: calcCostUsd({ promptTokens, completionTokens, model: config.model, modelInfo }),
      },
    };
  }
  // Vision-first onboarding: takes a raw PDF + user hint, returns both a
  // proposed template AND a first pass of extracted records in one call.
  async analyzePdfForOnboarding(pdfBuffer, userHint, config) {
    const { system, user } = buildAnalyzePdfPrompt({ userHint });
    const body = {
      model: config.model,
      max_tokens: 32768,
      system,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBuffer.toString('base64') } },
          { type: 'text', text: user + '\n\nReturn JSON only.' },
        ],
      }],
    };
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': VERSION,
        'anthropic-beta': 'pdfs-2024-09-25',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const content = (json.content || []).map((b) => b.text || '').join('');
    const parsed = safeJson(stripFences(content));
    const promptTokens     = json.usage?.input_tokens  ?? estimateTokens(system + user);
    const completionTokens = json.usage?.output_tokens ?? estimateTokens(content);
    const modelInfo = this.listModels().find((m) => m.id === config.model);
    const records = Array.isArray(parsed.records) ? parsed.records : [];
    if (json.stop_reason === 'max_tokens') {
      console.warn(`[anthropic] analyzePdfForOnboarding hit max_tokens after ${records.length} records — output truncated.`);
    }
    return {
      template: parsed.template || null,
      records,
      learned_patterns: parsed.learned_patterns || null,
      truncated: json.stop_reason === 'max_tokens',
      raw: content,
      usage: {
        promptTokens, completionTokens,
        costUsd: calcCostUsd({ promptTokens, completionTokens, model: config.model, modelInfo }),
      },
    };
  }
  async extractRecordsFromPDF(pdfBuffer, template, config) {
    const { system, user } = buildExtractRecordsPrompt({ fields: template.fields, hint: config.hint });
    const body = {
      model: config.model,
      max_tokens: 32768,
      system,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBuffer.toString('base64') } },
          { type: 'text', text: user + '\n\nReturn JSON only.' },
        ],
      }],
    };
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': VERSION,
        'anthropic-beta': 'pdfs-2024-09-25',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const content = (json.content || []).map((b) => b.text || '').join('');
    const parsed = safeJson(stripFences(content));
    const promptTokens     = json.usage?.input_tokens  ?? estimateTokens(system + user);
    const completionTokens = json.usage?.output_tokens ?? estimateTokens(content);
    const modelInfo = this.listModels().find((m) => m.id === config.model);
    const records = Array.isArray(parsed.records) ? parsed.records : [];
    if (json.stop_reason === 'max_tokens') {
      console.warn(`[anthropic] extractRecordsFromPDF hit max_tokens after ${records.length} records — output truncated.`);
    }
    return {
      records,
      learned_patterns: parsed.learned_patterns || null,
      truncated: json.stop_reason === 'max_tokens',
      raw: content,
      usage: {
        promptTokens, completionTokens,
        costUsd: calcCostUsd({ promptTokens, completionTokens, model: config.model, modelInfo }),
      },
    };
  }
}

function safeJson(s) {
  try { return JSON.parse(s); }
  catch (e) {
    // Most common cause: the model hit max_tokens and the JSON is truncated.
    console.warn(`[anthropic] safeJson failed (${e.message}). Output ${s.length}ch. Tail: ${JSON.stringify(s.slice(-300))}`);
    const salvaged = tryRepairTruncatedJson(s);
    if (salvaged) {
      console.warn(`[anthropic] salvaged ${salvaged.records?.length ?? 0} records from truncated output`);
      return salvaged;
    }
    return {};
  }
}
function stripFences(s) {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

function tryRepairTruncatedJson(s) {
  const m = s.match(/"records"\s*:\s*\[/);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1, inStr = false, esc = false, objDepth = 0;
  let lastComplete = -1;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { objDepth++; continue; }
    if (ch === '}') {
      objDepth--;
      if (objDepth === 0 && depth === 1) lastComplete = i + 1;
      continue;
    }
    if (ch === '[') { depth++; continue; }
    if (ch === ']') { depth--; if (depth === 0) { lastComplete = i + 1; break; } continue; }
  }
  if (lastComplete < 0) return null;
  const repaired = s.slice(0, lastComplete) + ']}';
  try { return JSON.parse(repaired); } catch { return null; }
}
