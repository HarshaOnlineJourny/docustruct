// CLI: run extraction against every template that has a training sample, print
// a compact summary. Useful for tuning the engine without touching the UI.
//
// Usage:
//   npm run extract             # against all templates
//   npm run extract -- 2        # only template id 2
import path from 'node:path';
import { db, getTemplate, UPLOADS_DIR } from '../db.js';
import { extractFromFile } from '../extraction/extractor.js';

const onlyId = process.argv[2] ? Number(process.argv[2]) : null;

function templateWithMappings(id) {
  const t = getTemplate(id);
  if (!t) return null;
  t.mappings = db
    .prepare(
      `SELECT tm.* FROM training_mappings tm
        JOIN training_samples ts ON ts.id = tm.sample_id
        WHERE ts.template_id = ?`
    )
    .all(id);
  return t;
}

async function run() {
  const templates = db
    .prepare(
      `SELECT t.id FROM templates t
         WHERE EXISTS (SELECT 1 FROM training_samples ts WHERE ts.template_id = t.id)
         ORDER BY t.id`
    )
    .all()
    .map((r) => r.id)
    .filter((id) => !onlyId || id === onlyId);

  for (const id of templates) {
    const template = templateWithMappings(id);
    const sample = db
      .prepare('SELECT * FROM training_samples WHERE template_id = ? ORDER BY id LIMIT 1')
      .get(id);
    if (!sample) continue;
    const file = path.isAbsolute(sample.file_path)
      ? sample.file_path
      : path.join(UPLOADS_DIR, sample.file_path);

    console.log('\n=== ' + template.name + ' ===');
    console.log('   sample: ' + sample.original_name);
    console.log('   fields: ' + template.fields.map((f) => f.name).join(', '));
    const t0 = Date.now();
    const result = await extractFromFile(file, template);
    const ms = Date.now() - t0;
    console.log(`   mode: ${result.mode}  records: ${result.records.length}  pages: ${result.pageCount}  (${ms}ms)`);
    if (result.warnings?.length) console.log('   warnings: ' + result.warnings.join(' | '));
    const sampleSize = Math.min(3, result.records.length);
    for (let i = 0; i < sampleSize; i++) {
      const r = result.records[i];
      const cells = template.fields
        .map((f) => `${f.name}=${formatCell(r.values?.[f.name])}`)
        .join('  ');
      console.log(`   row[${i}]  ${cells}`);
    }
  }
}

function formatCell(c) {
  if (!c) return '∅';
  if (c.value == null) return '∅';
  return String(c.value);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
