// Back-mapping: convert AI-extracted records into deterministic training
// mappings (the same shape that click-to-train produces). When this works,
// the template can flip from extraction_strategy='ai_vision' (pays per
// import) to 'manual' (uses the free deterministic engine).
//
// Algorithm:
//   1. Parse the source PDF into normalized lines.
//   2. Build the page's canonical column layout (engine primitive).
//   3. For each AI-extracted record, find the line that contains the
//      primary-field value. That's the "anchor line" for the record.
//   4. Snap the anchor line to canonical columns. For each non-primary
//      field, locate which canonical column contains the AI-extracted
//      value.
//   5. Aggregate column votes across all matched records; pick the most
//      consistent column per field.
//   6. Return mappings shaped for training_mappings inserts.
//
// Quality signal: report what fraction of records were successfully
// anchored. If below a threshold, the caller should keep the template on
// AI vision (text extraction is too jumbled to be useful).
import { extractText, normalize, inferPageColumns, snapToColumns } from './pdfText.js';

// Find the column index whose joined text contains `needle`. Returns -1
// when not found. Allows fuzzy match by normalizing whitespace.
function findColumnContaining(snapped, needle) {
  const n = normalize(String(needle));
  if (!n) return -1;
  for (let i = 0; i < snapped.length; i++) {
    const cellText = normalize(snapped[i].text || '');
    if (cellText.includes(n) || n.includes(cellText) && cellText.length > 2) {
      return i;
    }
  }
  return -1;
}

// Walk lines around the primary line — same line OR the next line — when
// records span two visual lines (BCBS-style). Returns the snapped columns
// for whichever line we're looking at + the line's index.
function getCandidateLines(parsed, primaryLineIndex) {
  const lines = parsed.lines;
  const primary = lines[primaryLineIndex];
  if (!primary) return [];
  const candidates = [primary];
  // Same page, next line if close in y
  const next = lines[primaryLineIndex + 1];
  if (next && next.pageIndex === primary.pageIndex) {
    candidates.push(next);
  }
  return candidates;
}

// Score a single anchor candidate: how many of the field values from this
// AI record we managed to locate in the candidate's nearby columns.
function scoreAnchor(parsed, lineIdx, record, fields, primaryName) {
  const candidates = getCandidateLines(parsed, lineIdx);
  let hits = 0;
  for (const f of fields) {
    if (f.name === primaryName) { hits++; continue; }
    const val = record.values?.[f.name];
    if (val == null || val === '') continue;
    let found = false;
    for (const cand of candidates) {
      const pageLines = parsed.lines.filter((l) => l.pageIndex === cand.pageIndex);
      const cols = inferPageColumns(pageLines);
      const snapped = snapToColumns(cand, cols);
      if (findColumnContaining(snapped, val) >= 0) { found = true; break; }
    }
    if (found) hits++;
  }
  return hits;
}

export async function backMapAIRecords({ pdfPath, fields, aiRecords }) {
  const parsed = await extractText(pdfPath);
  const lines = parsed.lines || [];
  if (lines.length === 0) {
    return { anchored: 0, total: aiRecords.length, mappings: [], sample: null, reason: 'no_text_lines' };
  }
  const primary = fields.find((f) => f.is_primary) || fields[0];
  if (!primary) {
    return { anchored: 0, total: aiRecords.length, mappings: [], sample: null, reason: 'no_primary' };
  }

  // votes[fieldName] -> { columnIndex: count }
  const votes = {};
  let anchoredCount = 0;
  let bestPrototypeLineIndex = -1;
  let bestPrototypePage = 0;

  for (const rec of aiRecords) {
    const primVal = rec.values?.[primary.name];
    if (primVal == null || primVal === '') continue;
    const normPrim = normalize(String(primVal));
    if (!normPrim) continue;

    // Candidate lines: any line whose normalized text contains the primary value.
    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
      if (normalize(lines[i].text).includes(normPrim)) candidates.push(i);
    }
    if (candidates.length === 0) continue;

    // Pick the candidate that best fits the rest of the record's values.
    let bestIdx = candidates[0];
    let bestScore = -1;
    for (const i of candidates) {
      const s = scoreAnchor(parsed, i, rec, fields, primary.name);
      if (s > bestScore) { bestScore = s; bestIdx = i; }
    }
    if (bestScore <= 1) continue; // primary itself doesn't count as a real anchor

    anchoredCount++;
    if (bestPrototypeLineIndex < 0) {
      bestPrototypeLineIndex = bestIdx;
      bestPrototypePage = lines[bestIdx].pageIndex;
    }

    // Now vote each field into its column.
    const candLines = getCandidateLines(parsed, bestIdx);
    for (const f of fields) {
      const val = rec.values?.[f.name];
      if (val == null || val === '') continue;
      let chosen = -1;
      for (const cand of candLines) {
        const pageLines = parsed.lines.filter((l) => l.pageIndex === cand.pageIndex);
        const cols = inferPageColumns(pageLines);
        const snapped = snapToColumns(cand, cols);
        const ci = findColumnContaining(snapped, val);
        if (ci >= 0) { chosen = ci; break; }
      }
      if (chosen < 0) continue;
      votes[f.name] = votes[f.name] || {};
      votes[f.name][chosen] = (votes[f.name][chosen] || 0) + 1;
    }
  }

  if (anchoredCount === 0) {
    return { anchored: 0, total: aiRecords.length, mappings: [], sample: null, reason: 'no_anchors' };
  }

  // Pick the winning column per field.
  const prototypeLine = lines[bestPrototypeLineIndex];
  const pageLinesForPrototype = lines.filter((l) => l.pageIndex === bestPrototypePage);
  const protoCols = inferPageColumns(pageLinesForPrototype);
  const protoSnapped = snapToColumns(prototypeLine, protoCols);

  const mappings = [];
  for (const f of fields) {
    const fv = votes[f.name];
    if (!fv) continue;
    const winner = Object.entries(fv).sort((a, b) => b[1] - a[1])[0];
    const columnIndex = Number(winner[0]);
    const cell = protoSnapped[columnIndex];
    if (!cell) continue;
    mappings.push({
      field_name: f.name,
      selection_text: cell.text || '',
      prototype_line_text: prototypeLine.text || '',
      column_index: columnIndex,
      token_start: 0,
      token_end: Math.max(0, (cell.text || '').split(/\s+/).length - 1),
      line_index: bestPrototypeLineIndex,
      page_index: bestPrototypePage,
      column_start: null,
      column_end: null,
      anchor_text: null,
      anchor_kind: null,
    });
  }

  return {
    anchored: anchoredCount,
    total: aiRecords.length,
    mappings,
    sample: {
      page_index: bestPrototypePage,
      line_index: bestPrototypeLineIndex,
      prototype_line_text: prototypeLine.text,
    },
    reason: 'ok',
  };
}
