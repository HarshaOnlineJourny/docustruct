// Lightweight self-tests for the type cleaners. Run with:
//   node src/extraction/cleaners.test.mjs
import assert from 'node:assert/strict';
import { cleanText, cleanNumber, cleanAmount, cleanDate, cleanByType } from './cleaners.js';

const cases = [
  // text
  () => assert.equal(cleanText('  RAY,   JENNIFER ').value, 'RAY, JENNIFER'),
  () => assert.equal(cleanText('').ok, false),

  // number
  () => assert.equal(cleanNumber('100.00%').value, 100),
  () => assert.equal(cleanNumber('1,234').value, 1234),
  () => assert.equal(cleanNumber('-7.5').value, -7.5),
  () => assert.equal(cleanNumber('abc').ok, false),

  // amount
  () => assert.equal(cleanAmount('$5.00').value, 5),
  () => assert.equal(cleanAmount('-$5.00').value, -5),
  () => assert.equal(cleanAmount('($5.00)').value, -5),
  () => assert.equal(cleanAmount('$1,210.50').value, 1210.5),
  () => assert.equal(cleanAmount('$0.00').value, 0),

  // date
  () => assert.equal(cleanDate('01/01/2023').value, '2023-01-01'),
  () => assert.equal(cleanDate('02/01/25').value, '2025-02-01'),
  () => assert.equal(cleanDate('January 31, 2025').value, '2025-01-31'),
  () => assert.equal(cleanDate('not a date').ok, false),

  // dispatcher
  () => assert.equal(cleanByType('amount', '$25.00').value, 25),
  () => assert.equal(cleanByType('date', '08/25/2025').value, '2025-08-25'),
];

let pass = 0;
let fail = 0;
for (const [i, fn] of cases.entries()) {
  try { fn(); pass++; }
  catch (err) { fail++; console.error(`  ✗ case ${i}: ${err.message}`); }
}
console.log(`Cleaner tests: ${pass}/${cases.length} passed`);
if (fail > 0) process.exit(1);
