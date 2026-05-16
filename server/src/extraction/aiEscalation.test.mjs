// AI escalation pass test. Uses a mock provider injected directly into the
// registry — no real network calls.
//
// REQUIREMENTS: This test loads `db.js`, which requires the better-sqlite3
// native binding compiled for your platform. Run from your dev machine
// (`node src/extraction/aiEscalation.test.mjs`) — it won't run on a host
// where node_modules was built for a different OS / arch.
//
//   node src/extraction/aiEscalation.test.mjs
import assert from 'node:assert/strict';
import { aiEscalatePass } from './extractor.js';
import { setSetting } from '../ai/settings.js';
import { recentCalls } from '../ai/costMeter.js';
import { db } from '../db.js';
import { AIProvider } from '../ai/providers/base.js';

// Inject a mock provider into the registry. Top-level await is fine in .mjs.
const registry = await import('../ai/registry.js');
const realGet = registry.getProvider;
class MockProvider extends AIProvider {
  get name() { return 'Mock'; }
  listModels() { return [{ id: 'mock-1', label: 'Mock', costPer1MInput: 0, costPer1MOutput: 0 }]; }
  async extractCell(input, _config) {
    // Return a high-confidence "fix" for any cell — pretend the LLM always
    // succeeds. Lets us verify the escalation pipeline end-to-end.
    return {
      value: input.cellText.toUpperCase(),
      confidence: 0.95,
      raw: input.cellText.toUpperCase(),
      usage: { promptTokens: 10, completionTokens: 5, costUsd: 0.0001 },
    };
  }
}
// Monkey-patch — we have a Map under the hood.
const mockId = 'mockprovider';
const mockInst = new MockProvider();
const PROVIDERS_INTERNAL = (await import('../ai/registry.js')).__esModule || null;
// Easiest: stash on globalThis and patch getProvider via a wrapper module
// — but registry doesn't expose a setter. Use a different approach: persist
// settings pointing to the mock by overriding `getProvider` indirectly via
// replacing the imported module's function reference in our local scope.
//
// Simpler: bypass registry by pre-populating ai.* settings and reaching
// extractCellWithAI's branch directly. We mock by writing the provider
// 'openai' but stubbing fetch.
import { OpenAIProvider } from '../ai/providers/openai.js';
OpenAIProvider.prototype.extractCell = async function (input) {
  return {
    value: input.cellText.toUpperCase(),
    confidence: 0.95,
    raw: input.cellText.toUpperCase(),
    usage: { promptTokens: 10, completionTokens: 5, costUsd: 0.0001 },
  };
};

// Configure AI: enabled, openai, mock model, fake key, low threshold so even
// medium-confidence cells escalate.
setSetting('ai.enabled', true);
setSetting('ai.provider', 'openai');
setSetting('ai.model', 'gpt-4o-mini');
setSetting('ai.api_key', 'sk-test-fake');
setSetting('ai.confidence_threshold', 0.9);
setSetting('ai.max_calls_per_import', 10);
setSetting('ai.monthly_budget_usd', 5);

// Reset call log so we can count fresh.
db.prepare('DELETE FROM ai_calls').run();

const result = {
  records: [
    { values: { policy_no: { value: 'NG-low', confidence: 0.4, raw_text: 'NG-low', source: 'anchor' } } },
    { values: { policy_no: { value: 'NG-high', confidence: 0.95, raw_text: 'NG-high', source: 'anchor' } } },
  ],
  warnings: [],
};
const template = {
  id: 1,
  fields: [{ id: 1, name: 'policy_no', label: 'Policy', type: 'text' }],
};

const escalated = await aiEscalatePass(result, { lines: [] }, template, {});
assert.equal(escalated.records[0].values.policy_no.value, 'NG-LOW', 'low-confidence cell got escalated');
assert.equal(escalated.records[0].values.policy_no.source, 'ai');
assert.equal(escalated.records[1].values.policy_no.value, 'NG-high', 'high-confidence cell unchanged');
assert.equal(escalated.records[1].values.policy_no.source, 'anchor');
assert.equal(escalated.ai?.escalated, 1);
assert.equal(escalated.ai?.calls, 1);

const log = recentCalls({ limit: 5 });
assert.ok(log.length >= 1, 'AI call was logged');
assert.equal(log[0].provider, 'openai');
assert.equal(log[0].task, 'extractCell');

// Reset settings so we don't pollute the local DB.
setSetting('ai.enabled', false);

console.log('  ✓ escalation upgrades low-confidence cells, leaves high-confidence alone');
console.log('  ✓ ai_calls log records the call');
console.log('AI escalation tests passed.');
