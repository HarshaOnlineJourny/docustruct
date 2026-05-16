// Engine tests that don't need pdfjs — we synthesize the parsed-line objects
// so the column logic and extractor can be exercised without installing deps.
//
//   node src/extraction/engine.test.mjs
import assert from 'node:assert/strict';
import {
  buildColumns,
  findColumnIndexForCell,
  inferPageColumns,
  snapToColumns,
} from './pdfText.js';
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

// --- buildColumns: handles repeated values via occurrence -----------------
{
  // Cleanly bimodal: intra-cell gap ≈ 5, inter-cell gap ≈ 60.
  const line = makeLine({
    lineIndex: 0, pageIndex: 0,
    items: [
      { x: 10,  s: 'NG101596946900', w: 90 },          // ends 100
      { x: 160, s: 'RAY,', w: 25 },                    // gap 60
      { x: 190, s: 'JENNIFER', w: 50 },                // gap 5
      { x: 300, s: '01/01/2023', w: 60 },              // gap 60
      { x: 420, s: '$5.00', w: 30 },                   // gap 60
      { x: 510, s: '$5.00', w: 30 },                   // gap 60 (second occurrence)
      { x: 600, s: '$0.00', w: 30 },                   // gap 60
    ],
  });
  const cols = buildColumns(line);
  assert.equal(cols.length, 6, `expected 6 columns, got ${cols.length}: ${cols.map(c => c.text).join(' | ')}`);
  assert.equal(findColumnIndexForCell(cols, 'NG101596946900'), 0);
  const c1 = findColumnIndexForCell(cols, '$5.00', 1);
  const c2 = findColumnIndexForCell(cols, '$5.00', 2);
  assert.ok(c1 !== c2, `two $5.00 cells map to different columns (got ${c1} & ${c2})`);
  console.log('  ✓ buildColumns + findColumnIndexForCell (bimodal row, repeated $5.00)');
}

// --- inferPageColumns + snapToColumns: per-row drift gets normalized -------
//
// Real-world failure case: a row whose policy_no is unusually long has a
// tighter visual gap to the next column. Per-line detection on that row
// alone would merge those two cells. As long as one row on the page has the
// columns properly separated, page-level snap forces every row into the same
// column structure.
{
  // Tight row: policy_no abuts holder (10-unit gap, same as intra-cell).
  // Standalone, this row would only see 3 columns.
  const tight = makeLine({
    lineIndex: 0, pageIndex: 0,
    items: [
      { x: 10,  s: 'NG101696612600-10141940', w: 145 }, // ends 155
      { x: 165, s: 'VASQUEZ,', w: 50 },                  // gap 10 (TIGHT)
      { x: 220, s: 'SARA', w: 30 },                      // gap 5
      { x: 360, s: 'Aetna', w: 30 },                     // gap 110
      { x: 395, s: 'ACA', w: 20 },                       // gap 5
      { x: 545, s: '01/01/2023', w: 60 },                // gap 130
    ],
  });
  // Clean row: cleanly bimodal gaps. Standalone, 4 columns.
  const clean = makeLine({
    lineIndex: 1, pageIndex: 0,
    items: [
      { x: 10,  s: 'NG101596946900', w: 90 },            // ends 100
      { x: 200, s: 'RAY,', w: 25 },                      // gap 100
      { x: 230, s: 'JENNIFER', w: 50 },                  // gap 5
      { x: 360, s: 'Aetna', w: 30 },                     // gap 80
      { x: 395, s: 'ACA', w: 20 },                       // gap 5
      { x: 545, s: '01/01/2023', w: 60 },                // gap 130
    ],
  });

  const tightAlone = buildColumns(tight);
  const cleanAlone = buildColumns(clean);
  // Clean row is the better-segmented one — the test of inferPageColumns is
  // that after snap, the tight row matches.
  const ranges = inferPageColumns([tight, clean]);
  const tightSnapped = snapToColumns(tight, ranges);
  const cleanSnapped = snapToColumns(clean, ranges);

  assert.equal(tightSnapped.length, cleanSnapped.length,
    'both rows snap to identical column count');
  assert.equal(tightSnapped.length, Math.max(tightAlone.length, cleanAlone.length),
    'page columns track the most-segmented row');

  // The tight row's policy_no is no longer fused with VASQUEZ.
  assert.equal(tightSnapped[0].text, 'NG101696612600-10141940',
    `tight row col 0 should be policy_no alone, got "${tightSnapped[0].text}"`);
  console.log('  ✓ inferPageColumns + snapToColumns normalize per-row drift');
}

// --- end-to-end (synthetic) row-mode extraction with page-level snap ------
{
  const items = (cells) =>
    cells.map((c, i) => ({ x: 10 + i * 100, s: c, w: 60 }));

  const lines = [
    makeLine({ lineIndex: 0, pageIndex: 0, items: items(['Policy', 'Holder', 'Date', 'Amount']) }),
    makeLine({ lineIndex: 1, pageIndex: 0, items: items(['NG101596946900', 'RAY,', '01/01/2023', '$5.00']) }),
    makeLine({ lineIndex: 2, pageIndex: 0, items: items(['NG101663114000', 'FARROW,', '01/01/2023', '$1.00']) }),
    makeLine({ lineIndex: 3, pageIndex: 0, items: items(['NG101750889900', 'RUSSELL,', '08/01/2023', '$1.00']) }),
  ];
  const protoText = lines[1].text;

  const template = {
    fields: [
      { id: 1, name: 'policy_no',      label: 'Policy', type: 'text',   is_primary: 1 },
      { id: 2, name: 'policyholder',   label: 'Holder', type: 'text' },
      { id: 3, name: 'effective_date', label: 'Date',   type: 'date' },
      { id: 4, name: 'amount',         label: 'Amount', type: 'amount' },
    ],
    mappings: [
      { field_id: 1, prototype_line_text: protoText, column_index: 0, line_index: 1, page_index: 0, selection_text: 'NG101596946900' },
      { field_id: 2, prototype_line_text: protoText, column_index: 1, line_index: 1, page_index: 0, selection_text: 'RAY,' },
      { field_id: 3, prototype_line_text: protoText, column_index: 2, line_index: 1, page_index: 0, selection_text: '01/01/2023' },
      { field_id: 4, prototype_line_text: protoText, column_index: 3, line_index: 1, page_index: 0, selection_text: '$5.00' },
    ],
  };

  const result = extractFromLines({ lines, pageCount: 1 }, template);
  assert.equal(result.mode, 'row');
  assert.equal(result.records.length, 3, `expected 3 rows, got ${result.records.length}`);
  assert.equal(result.records[0].values.policy_no.value, 'NG101596946900');
  assert.equal(result.records[1].values.policy_no.value, 'NG101663114000');
  assert.equal(result.records[2].values.amount.value, 1);
  assert.equal(result.records[0].values.effective_date.value, '2023-01-01');
  console.log(`  ✓ row mode produced ${result.records.length} records with cleaned values`);
}

console.log('Engine synthetic tests passed.');
