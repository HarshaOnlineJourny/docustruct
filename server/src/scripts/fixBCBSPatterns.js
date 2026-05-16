// One-off: fix the obvious mistake in the AI's saved learned_patterns for
// templates whose anchor expects "{12}" digit policy numbers but the actual
// PDFs have 10-digit policies.
//
// Run:   npm run fix-bcbs-patterns -- <template_id>
//   e.g. npm run fix-bcbs-patterns -- 18
//
// Idempotent: re-running has no effect once the digits are corrected.
import { db } from '../db.js';

const id = Number(process.argv[2]);
if (!Number.isFinite(id)) {
  console.error('Usage: npm run fix-bcbs-patterns -- <template_id>');
  process.exit(1);
}

const row = db.prepare('SELECT id, name, learned_patterns FROM templates WHERE id = ?').get(id);
if (!row) { console.error(`Template ${id} not found.`); process.exit(1); }
if (!row.learned_patterns) { console.error(`Template ${id} has no learned_patterns to fix.`); process.exit(0); }

let p;
try { p = JSON.parse(row.learned_patterns); }
catch { console.error(`Template ${id} learned_patterns is invalid JSON.`); process.exit(1); }

// Generalise: replace any "[0-9]{12}" or "\d{12}" in anchor/field patterns
// with the more permissive "[0-9]{8,12}" so we match 10-digit policies too.
function relax(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/\[0-9\]\{12\}/g, '[0-9]{8,12}')
          .replace(/\\d\{12\}/g, '\\d{8,12}');
}

let changes = 0;
function relaxField(f) {
  if (!f) return;
  if (typeof f.pattern === 'string') {
    const r = relax(f.pattern);
    if (r !== f.pattern) { f.pattern = r; changes++; }
  }
  if (Array.isArray(f.alternatives)) {
    for (const a of f.alternatives) {
      if (a && typeof a.pattern === 'string') {
        const r = relax(a.pattern);
        if (r !== a.pattern) { a.pattern = r; changes++; }
      }
    }
  }
}

if (typeof p.record_anchor === 'string') {
  const r = relax(p.record_anchor);
  if (r !== p.record_anchor) { p.record_anchor = r; changes++; }
}
if (Array.isArray(p.record_anchor_alternatives)) {
  p.record_anchor_alternatives = p.record_anchor_alternatives.map((a) => {
    const r = relax(a);
    if (r !== a) changes++;
    return r;
  });
}
if (p.fields) for (const f of Object.values(p.fields)) relaxField(f);

if (changes === 0) {
  console.log(`Template ${id} ("${row.name}") — no {12} digit patterns found. Nothing to fix.`);
  process.exit(0);
}

db.prepare('UPDATE templates SET learned_patterns = ?, updated_at = datetime(\'now\') WHERE id = ?')
  .run(JSON.stringify(p), id);
console.log(`Template ${id} ("${row.name}") — relaxed ${changes} pattern(s) from {12} → {8,12}.`);
console.log('Run `npm run inspect-templates` to verify, then re-import. Should now extract for free.');
