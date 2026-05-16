import { AIProvider } from './base.js';
import { buildExtractCellPrompt, buildSuggestTemplatePrompt, estimateTokens } from '../prompt.js';

// Local Ollama. Free. Uses /api/chat. Endpoint host configurable via the
// model field encoding "model@host" or via ai.ollama_host setting (later).
const DEFAULT_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

export class OllamaProvider extends AIProvider {
  get name() { return 'Ollama (local)'; }

  listModels() {
    return [
      { id: 'llama3.2', label: 'Llama 3.2', contextWindow: 128000, costPer1MInput: 0, costPer1MOutput: 0 },
      { id: 'qwen2.5',  label: 'Qwen 2.5',  contextWindow: 128000, costPer1MInput: 0, costPer1MOutput: 0 },
      { id: 'phi4',     label: 'Phi-4',     contextWindow: 16000,  costPer1MInput: 0, costPer1MOutput: 0 },
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
      format: 'json',
      stream: false,
      options: { temperature: 0 },
    };
    const host = config.ollamaHost || DEFAULT_HOST;
    const res = await fetch(host.replace(/\/$/, '') + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = await res.json();
    const content = json.message?.content || '';
    const parsed = safeJson(content);
    const promptTokens     = json.prompt_eval_count ?? estimateTokens(system + user);
    const completionTokens = json.eval_count        ?? estimateTokens(content);
    return {
      value: parsed.value ?? null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
      reasoning: parsed.reasoning,
      raw: content,
      usage: { promptTokens, completionTokens, costUsd: 0 },
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
      format: 'json',
      stream: false,
      options: { temperature: 0.2 },
    };
    const host = config.ollamaHost || DEFAULT_HOST;
    const res = await fetch(host.replace(/\/$/, '') + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const content = json.message?.content || '';
    const parsed = safeJson(content);
    const promptTokens     = json.prompt_eval_count ?? estimateTokens(system + user);
    const completionTokens = json.eval_count        ?? estimateTokens(content);
    return {
      template: parsed,
      raw: content,
      usage: { promptTokens, completionTokens, costUsd: 0 },
    };
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
