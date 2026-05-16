// Sub-cell token selection: when buildColumns merges multiple field values
// into a single cell, the trained token range disambiguates them.
//
//   node src/extraction/subcell.test.mjs
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

// Three rows with policy_no + policyholder fused into one column (intra-cell
// gap 5, inter-cell gap 80+). Token range disambiguates inside cell 0.
{
  const mkRow = (lineIndex, items) => makeLine({ pageIndex: 0, lineIndex, items });
  const lines = [
    mkRow(0, [
      { x: 10,  s: 'NG101596946900-18932254', w: 130 },
      { x: 145, s: 'RAY,',     w: 25 },     // gap 5
      { x: 175, s: 'JENNIFER', w: 50 },     // gap 5
      { x: 300, s: 'Aetna',    w: 30 },     // gap 75
      { x: 440, s: '01/01/2023', w: 60 },   // gap 110
    ]),
    mkRow(1, [
      { x: 10,  s: 'NG101663114000-10141940', w: 145 },
      { x: 160, s: 'FARROW,', w: 50 },      // gap 5
      { x: 215, s: 'PEARLY',  w: 50 },      // gap 5
      { x: 300, s: 'Aetna',   w: 30 },      // gap 35  <- inter-cell
      { x: 440, s: '01/01/2023', w: 60 },
    ]),
    mkRow(2, [
      { x: 10,  s: 'NG101696612600-10141940', w: 145 },
      { x: 160, s: 'VASQUEZ,', w: 50 },
      { x: 215, s: 'SARA',     w: 30 },
      { x: 300, s: 'Aetna',    w: 30 },
      { x: 440, s: '03/01/2023', w: 60 },
    ]),
  ];
  const protoText = lines[0].text;

  const template = {
    fields: [
      { id: 1, name: 'policy_no',    label: 'Policy', type: 'text',   is_primary: 1 },
      { id: 2, name: 'policyholder', label: 'Holder', type: 'text' },
    ],
    mappings: [
      { field_id: 1, prototype_line_text: protoText, column_index: 0, token_start: 0, token_end: 0, line_index: 0, page_index: 0, selection_text: 'NG101596946900-18932254' },
      { field_id: 2, prototype_line_text: protoText, column_index: 0, token_start: 1, token_end: 2, line_index: 0, page_index: 0, selection_text: 'RAY, JENNIFER' },
    ],
  };

  const result = extractFromLines({ lines, pageCount: 1 }, template);
  assert.equal(result.mode, 'row');
  assert.equal(result.records.length, 3, `expected 3 records, got ${result.records.length}`);
  assert.equal(result.records[0].values.policy_no.value, 'NG101596946900-18932254');
  assert.equal(result.records[0].values.policyholder.value, 'RAY, JENNIFER');
  assert.equal(result.records[1].values.policy_no.value, 'NG101663114000-10141940');
  assert.equal(result.records[1].values.policyholder.value, 'FARROW, PEARLY');
  assert.equal(result.records[2].values.policy_no.value, 'NG101696612600-10141940');
  assert.equal(result.records[2].values.policyholder.value, 'VASQUEZ, SARA');
  console.log('  ✓ token range within merged cell, same token count across rows');
}

// Varying token count: one row has an extra word in the holder name. Token
// range slice would miss; type-aware "LAST, FIRST" pattern fallback recovers.
{
  const mkRow = (lineIndex, items) => makeLine({ pageIndex: 0, lineIndex, items });
  const lines = [
    mkRow(0, [
      { x: 10,  s: 'NG101596946900-18932254', w: 130 },
      { x: 145, s: 'RAY,',     w: 25 },
      { x: 175, s: 'JENNIFER', w: 50 },
      { x: 300, s: 'Aetna',    w: 30 },
      { x: 440, s: '01/01/2023', w: 60 },
    ]),
    mkRow(1, [
      { x: 10,  s: 'NG102000000000-99999999', w: 145 },
      { x: 160, s: 'DE',     w: 15 },
      { x: 178, s: 'LA',     w: 15 },
      { x: 196, s: 'ROSA,',  w: 35 },
      { x: 234, s: 'FRANCISCO', w: 60 },
      { x: 300, s: 'Aetna',  w: 30 },
      { x: 440, s: '02/01/2023', w: 60 },
    ]),
  ];
  const protoText = lines[0].text;

  const template = {
    fields: [
      { id: 1, name: 'policy_no',    label: 'Policy', type: 'text',   is_primary: 1 },
      { id: 2, name: 'policyholder', label: 'Holder', type: 'text' },
    ],
    mappings: [
      { field_id: 1, prototype_line_text: protoText, column_index: 0, token_start: 0, token_end: 0, line_index: 0, page_index: 0, selection_text: 'NG101596946900-18932254' },
      { field_id: 2, prototype_line_text: protoText, column_index: 0, token_start: 1, token_end: 2, line_index: 0, page_index: 0, selection_text: 'RAY, JENNIFER' },
    ],
  };

  const result = extractFromLines({ lines, pageCount: 1 }, template);
  assert.equal(result.records.length, 2, `expected 2 records, got ${result.records.length}`);
  assert.equal(result.records[0].values.policyholder.value, 'RAY, JENNIFER');
  const h1 = result.records[1].values.policyholder.value || '';
  assert.ok(h1.includes(','), `name-pattern fallback should retain "LAST, FIRST" shape, got "${h1}"`);
  console.log(`  ✓ varying token count: row 0 holder = "${result.records[0].values.policyholder.value}", row 1 holder = "${h1}"`);
}

console.log('Sub-cell tests passed.');
