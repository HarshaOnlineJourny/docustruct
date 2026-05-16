// Wipe training mappings + extracted records for a template (or all). Use this
// after retraining so previous bad mappings don't pollute extraction.
//
//   node src/scripts/resetMappings.js           # all templates
//   node src/scripts/resetMappings.js 1         # template id 1
import { db } from '../db.js';

const id = process.argv[2] ? Number(process.argv[2]) : null;

const where = id ? 'WHERE template_id = ?' : '';
const args = id ? [id] : [];

const counts = {
  records: db.prepare(
    `DELETE FROM records ${where}`
  ).run(...args).changes,
  mappings: db.prepare(
    `DELETE FROM training_mappings
     WHERE sample_id IN (SELECT id FROM training_samples ${where})`
  ).run(...args).changes,
  documents: db.prepare(
    `DELETE FROM documents ${where}`
  ).run(...args).changes,
  batches: db.prepare(
    `DELETE FROM batches ${where}`
  ).run(...args).changes,
};

console.log(`Reset ${id ? 'template ' + id : 'all templates'}:`);
for (const [k, n] of Object.entries(counts)) console.log(`  ${k}: ${n} rows deleted`);
