// Central registry of available providers. Adding a new provider is a
// one-line change here; the rest of the system goes through this registry.
import { OpenAIProvider } from './providers/openai.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OllamaProvider } from './providers/ollama.js';

const PROVIDERS = new Map();
PROVIDERS.set('openai', new OpenAIProvider());
PROVIDERS.set('anthropic', new AnthropicProvider());
PROVIDERS.set('ollama', new OllamaProvider());

export function listProviders() {
  return [...PROVIDERS.entries()].map(([id, p]) => ({
    id,
    name: p.name,
    models: p.listModels(),
  }));
}

export function getProvider(id) {
  return PROVIDERS.get(id) || null;
}
