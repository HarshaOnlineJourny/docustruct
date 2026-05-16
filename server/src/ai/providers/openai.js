import { AIProvider } from './base.js';
import { buildExtractCellPrompt, buildSuggestTemplatePrompt, estimateTokens, calcCostUsd } from '../prompt.js';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export class OpenAIProvider extends AIProvider {
  get name() { return 'OpenAI'; }

  listModels() {
    return [
      { id: 'gpt-4o',      label: 'GPT-4o',      contextWindow: 128000, costPer1MInput: 2.5,  costPer1MOutput: 10 },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', contextWindow: 128000, costPer1MInput: 0.15, costPer1MOutput: 0.60 },
    ];
  }

  async extractCell(input, config) {
    const { system, user } = buildExtractCellPrompt(input);
    const body = {
      model: config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    };
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content || '{}';
    const parsed = safeJson(content);
    const promptTokens = json.usage?.prompt_tokens     ?? estimateTokens(system + user);
    const completionTokens = json.usage?.completion_tokens ?? estimateTokens(content);
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
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    };
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content || '{}';
    const parsed = safeJson(content);
    const promptTokens = json.usage?.prompt_tokens     ?? estimateTokens(system + user);
    const completionTokens = json.usage?.completion_tokens ?? estimateTokens(content);
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
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
