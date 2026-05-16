// Multi-sample training: when a template has mappings from N samples, the
// engine evaluates each sample against the new PDF and picks the one that
// yields the most records.
//
//   node src/extraction/multisample.test.mjs
import assert from 'node:assert/strict';
import { extractFromLines } from './extractor.js';

function makeLine({ pageIndex, lineIndex, items }) {
  const stitched = items
    .sort((a, b) => a.x - b.x)
    .map((it) => it.s)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    lineIndex,
    pageIndex,
    text: stitched,
    y: 0,
    items: items.map((it) => ({
      str: it.s,
      x: it.x,
      y: 0,
      width: it.w ?? Math.max(20, it.s.length * 6),
      height: 10,
      font: 'F',
    })),
  };
}

// Two training samples with different prototype lines. Only one matches the
// new PDF's actual layout. The engine should pick the matching one.
{
  const items = (cells) =>
    cells.map((c, i) => ({ x: 10 + i * 100, s: c, w: 60 }));

  // The new PDF has 3 data rows, all with 4 columns.
  const lines = [
    makeLine({ lineIndex: 0, pageIndex: 0, items: items(['Policy', 'Holder', 'Date', 'Amount']) }),
    makeLine({ lineIndex: 1, pageIndex: 0, items: items(['NG101596946900', 'RAY,', '01/01/2023', '$5.00']) }),
    makeLine({ lineIndex: 2, pageIndex: 0, items: items(['NG101663114000', 'FARROW,', '01/01/2023', '$1.00']) }),
    makeLine({ lineIndex: 3, pageIndex: 0, items: items(['NG101750889900', 'RUSSELL,', '08/01/2023', '$1.00']) }),
  ];

  // Sample 1: trained on a different layout — its prototype text won't match
  // anything in the new PDF, but the column indices line up so it could
  // plausibly produce some records.
  const protoSample1 = 'TOTALLY DIFFERENT PROTOTYPE FROM SAMPLE 1';
  // Sample 2: trained on a layout that matches the new PDF.
  const protoSample2 = lines[1].text;

  const template = {
    fields: [
      { id: 1, name: 'policy_no',      label: 'Policy', type: 'text',   is_primary: 1 },
      { id: 2, name: 'policyholder',   label: 'Holder', type: 'text' },
      { id: 3, name: 'effective_date', label: 'Date',   type: 'date' },
      { id: 4, name: 'amount',         label: 'Amount', type: 'amount' },
    ],
    mappings: [
      // Sample 1 — column indices the same but prototype text doesn't appear
      // in the new PDF. Engine will still try it because column_index is set.
      { field_id: 1, prototype_line_text: protoSample1, column_index: 0, line_index: 99, page_index: 0, selection_text: 'XXX' },
      { field_id: 2, prototype_line_text: protoSample1, column_index: 1, line_index: 99, page_index: 0, selection_text: 'YYY' },
      // Sample 2 — fully aligned with the new PDF.
      { field_id: 1, prototype_line_text: protoSample2, column_index: 0, line_index: 1, page_index: 0, selection_text: 'NG101596946900' },
      { field_id: 2, prototype_line_text: protoSample2, column_index: 1, line_index: 1, page_index: 0, selection_text: 'RAY,' },
      { field_id: 3, prototype_line_text: protoSample2, column_index: 2, line_index: 1, page_index: 0, selection_text: '01/01/2023' },
      { field_id: 4, prototype_line_text: protoSample2, column_index: 3, line_index: 1, page_index: 0, selection_text: '$5.00' },
    ],
  };

  const result = extractFromLines({ lines, pageCount: 1 }, template);
  assert.equal(result.mode, 'row');
  assert.equal(result.records.length, 3, `expected 3 records, got ${result.records.length}`);
  assert.equal(result.attempts, 2, 'engine evaluated both samples');
  assert.equal(result.sampleKey, protoSample2, 'engine picked the matching sample');
  assert.equal(result.records[0].values.policy_no.value, 'NG101596946900');
  assert.equal(result.records[2].values.amount.value, 1);
  console.log(`  ✓ multi-sample picker chose the matching sample (${result.attempts} attempts)`);
}

console.log('Multi-sample tests passed.');
