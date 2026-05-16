// One-shot: clear the Data Grid (records, documents, batches) WITHOUT
// touching templates, fields, training samples, training mappings, AI
// config, or AI call history.
//
// Use this when you want to re-import PDFs against existing templates to
// verify the deterministic engine works (no AI cost) after onboarding +
// back-mapping.
//
// Run from the server folder:
//   npm run clear-data
import { db } from '../db.js';

console.log('Clearing data grid (records + documents + batches)...');

const beforeRecords = db.prepare('SELECT COUNT(*) AS n FROM records').get().n;
const beforeDocs    = db.prepare('SELECT COUNT(*) AS n FROM documents').get().n;
const beforeBatches = db.prepare('SELECT COUNT(*) AS n FROM batches').get().n;
const beforeCorr    = db.prepare('SELECT COUNT(*) AS n FROM corrections').get().n;
const beforeVals    = db.prepare('SELECT COUNT(*) AS n FROM record_values').get().n;

const tx = db.transaction(() => {
  // ON DELETE CASCADE on documents handles records → record_values → corrections,
  // but be explicit so this script is auditable in isolation.
  db.exec('DELETE FROM corrections');
  db.exec('DELETE FROM record_values');
  db.exec('DELETE FROM records');
  db.exec('DELETE FROM documents');
  db.exec('DELETE FROM batches');
  // Reset the per-(template, field) counters too so accuracy badges reflect
  // the fresh re-import.
  db.exec('UPDATE field_stats SET extractions = 0, corrections = 0, ai_escalations = 0');
});
tx();

const afterTemplates = db.prepare('SELECT COUNT(*) AS n FROM templates').get().n;
const afterMappings  = db.prepare('SELECT COUNT(*) AS n FROM training_mappings').get().n;
const afterSamples   = db.prepare('SELECT COUNT(*) AS n FROM training_samples').get().n;

console.log('\nCleared:');
console.log(`  records       : ${beforeRecords}  -> 0`);
console.log(`  record_values : ${beforeVals}  -> 0`);
console.log(`  documents     : ${beforeDocs}  -> 0`);
console.log(`  batches       : ${beforeBatches}  -> 0`);
console.log(`  corrections   : ${beforeCorr}  -> 0`);
console.log('\nKept (untouched):');
console.log(`  templates           : ${afterTemplates}`);
console.log(`  training_samples    : ${afterSamples}`);
console.log(`  training_mappings   : ${afterMappings}`);
console.log('  fields, settings (AI config), ai_calls history\n');
console.log('Done.');
