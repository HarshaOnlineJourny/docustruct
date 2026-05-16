// Inspect every template, showing strategy + whether AI returned patterns.
// Run with:   npm run inspect-templates
import { db } from '../db.js';

const rows = db.prepare(
  `SELECT id, name, extraction_strategy, ai_provider, ai_model,
          length(ai_prompt) AS ai_prompt_chars,
          learned_patterns
     FROM templates
     ORDER BY id`
).all();

if (rows.length === 0) {
  console.log('No templates saved.');
  process.exit(0);
}

for (const r of rows) {
  console.log('\n────────────────────────────────────────');
  console.log(`Template #${r.id} — "${r.name}"`);
  console.log(`  strategy     : ${r.extraction_strategy}`);
  console.log(`  ai_provider  : ${r.ai_provider || '(none)'}`);
  console.log(`  ai_model     : ${r.ai_model || '(none)'}`);
  console.log(`  ai_prompt    : ${r.ai_prompt_chars} chars`);

  if (!r.learned_patterns) {
    console.log(`  PATTERNS     : ❌ NULL (AI did not return any, or save failed)`);
    continue;
  }
  let p;
  try { p = JSON.parse(r.learned_patterns); }
  catch (e) {
    console.log(`  PATTERNS     : ⚠️ INVALID JSON (${e.message})`);
    console.log(`  raw          : ${r.learned_patterns.slice(0, 200)}...`);
    continue;
  }

  const anchors = []
    .concat(Array.isArray(p.record_anchor_alternatives) ? p.record_anchor_alternatives : [])
    .concat(typeof p.record_anchor === 'string' ? [p.record_anchor] : []);
  console.log(`  PATTERNS     : ✅ saved`);
  console.log(`  anchors      : ${anchors.length}`);
  for (const a of anchors) console.log(`     • ${JSON.stringify(a)}`);
  const fields = p.fields || {};
  console.log(`  fields       : ${Object.keys(fields).length}`);
  for (const [name, def] of Object.entries(fields)) {
    const alts = (def.alternatives || []).map((a) => a.pattern || a).filter(Boolean);
    if (typeof def.pattern === 'string') alts.push(def.pattern);
    console.log(`     • ${name}: ${alts.length} alternative(s)`);
    for (const a of alts) console.log(`         ${JSON.stringify(a).slice(0, 120)}`);
  }
}
console.log('\n────────────────────────────────────────');
console.log('Done.');
