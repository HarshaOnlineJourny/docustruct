// PDF -> normalized text lines.
//
// Each line carries:
//   - pageIndex          0-based page
//   - lineIndex          ordinal across the whole document
//   - text               normalized text (whitespace collapsed)
//   - items              [{ str, x, y, width, height, font }]  for column work
//   - y                  approximate baseline of the line
import fs from 'node:fs';

let pdfjsModule = null;
async function loadPdfjs() {
  if (!pdfjsModule) {
    try {
      pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
    } catch (_) {
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      pdfjsModule = require('pdfjs-dist/legacy/build/pdf.js');
    }
  }
  return pdfjsModule;
}

// Fraction of average glyph height used as the line-clustering tolerance.
// PDFs with tight tabular layouts (BCBS-style multi-line records) need a
// tighter setting; Aetna / Ambetter row layouts are looser. We default
// conservatively to 0.3 and adapt downward when item-y spacing is small.
const LINE_TOLERANCE = 0.3;

export async function extractText(filePath) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;

  const pages = [];
  let textCharCount = 0;
  for (let p = 0; p < pdf.numPages; p++) {
    const page = await pdf.getPage(p + 1);
    const textContent = await page.getTextContent({ normalizeWhitespace: true });
    const items = textContent.items.map((item) => ({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width ?? 0,
      height: item.height ?? Math.abs(item.transform[3] ?? 10),
      font: item.fontName ?? '',
    }));
    textCharCount += items.reduce((acc, i) => acc + (i.str?.length ?? 0), 0);
    pages.push({ pageIndex: p, items });
  }

  const needsOcr = textCharCount < 20;
  const lines = [];
  let lineIndex = 0;
  for (const page of pages) {
    const pageLines = clusterIntoLines(page.items);
    for (const line of pageLines) {
      lines.push({
        lineIndex: lineIndex++,
        pageIndex: page.pageIndex,
        text: line.text,
        items: line.items,
        y: line.y,
      });
    }
  }
  return { pageCount: pdf.numPages, needsOcr, lines };
}

function clusterIntoLines(items) {
  if (items.length === 0) return [];
  const avgHeight =
    items.reduce((acc, i) => acc + (i.height || 10), 0) / items.length || 10;

  // Adaptive tolerance: take the median |y-gap| between distinct y-positions.
  // Items within (median / 3) are treated as the same baseline. Capped by
  // avgHeight * LINE_TOLERANCE so wildly weird PDFs still cluster something.
  const distinctYs = [...new Set(items.map((i) => Math.round(i.y * 10) / 10))]
    .sort((a, b) => b - a);
  const yGaps = [];
  for (let i = 1; i < distinctYs.length; i++) {
    yGaps.push(Math.abs(distinctYs[i - 1] - distinctYs[i]));
  }
  yGaps.sort((a, b) => a - b);
  const medianGap = yGaps[Math.floor(yGaps.length / 2)] || avgHeight;
  const tol = Math.max(0.5, Math.min(medianGap / 3, avgHeight * LINE_TOLERANCE));

  // Strict y-then-x sort. The cluster step below applies the tolerance.
  const sorted = [...items].sort((a, b) => {
    if (a.y !== b.y) return b.y - a.y;
    return a.x - b.x;
  });
  const groups = [];
  let current = null;
  for (const item of sorted) {
    // Compare against the cluster's anchor (first item's y), not the running
    // last y, so a chain of slightly-different y-values can't drift the
    // cluster span unboundedly across multiple visual lines.
    if (!current || Math.abs(current.y - item.y) > tol) {
      current = { y: item.y, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups
    .map((g) => {
      g.items.sort((a, b) => a.x - b.x);
      let text = '';
      let prev = null;
      for (const it of g.items) {
        if (prev) {
          const prevRight = prev.x + (prev.width || 0);
          const gap = it.x - prevRight;
          if (gap > prev.height * 0.25 && !text.endsWith(' ') && !it.str.startsWith(' ')) {
            text += ' ';
          }
        }
        text += it.str;
        prev = it;
      }
      return { y: g.y, text: normalize(text), items: g.items };
    })
    .filter((line) => line.text.length > 0);
}

export function normalize(s) {
  return s.replace(/\s+/g, ' ').trim();
}

// --- Column detection -------------------------------------------------------
// Per-line splitting: threshold from the gap distribution. Page-level pass
// (inferPageColumns) picks the most-segmented row's columns and
// snapToColumns aligns every other row to those boundaries.

export function buildColumns(line) {
  const items = [...line.items].sort((a, b) => a.x - b.x);
  if (items.length === 0) return [];
  if (items.length === 1) {
    const it = items[0];
    return [{ x: it.x, end: it.x + (it.width || 0), text: normalize(it.str) }];
  }

  const gaps = [];
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];
    gaps.push(Math.max(0, curr.x - (prev.x + (prev.width || 0))));
  }

  const avgHeight =
    items.reduce((a, it) => a + (it.height || 10), 0) / items.length || 10;
  const threshold = naturalBreakThreshold(gaps, avgHeight);

  const cols = [];
  let cur = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!cur) {
      cur = { x: it.x, end: it.x + (it.width || 0), text: it.str };
      cols.push(cur);
      continue;
    }
    const gap = it.x - cur.end;
    if (gap > threshold) {
      cur = { x: it.x, end: it.x + (it.width || 0), text: it.str };
      cols.push(cur);
    } else {
      cur.text += (cur.text.endsWith(' ') ? '' : ' ') + it.str;
      cur.end = it.x + (it.width || 0);
    }
  }
  return cols.map((c) => ({ x: c.x, end: c.end, text: normalize(c.text) }));
}

// Find a gap-size threshold. Strategy:
//   1. baseline = smallest gap on the line (intra-cell typography spacing).
//   2. Walk sorted gaps; the first that's >= max(2*baseline, 0.3*glyphHeight)
//      AND has a noticeable jump from the previous one marks the transition
//      from intra-cell to inter-cell gaps.
//   3. The threshold sits between the last intra-cell gap and the first
//      inter-cell gap. Anything bigger becomes a column break — capturing
//      every inter-cell gap regardless of how many magnitudes there are.
function naturalBreakThreshold(gaps, avgHeight) {
  if (gaps.length === 0) return Infinity;
  const sorted = [...gaps].sort((a, b) => a - b);
  const baseline = sorted[0];
  const absoluteFloor = avgHeight * 0.3;
  // Case A: all gaps are uniformly large (every gap is a column break, like a
  // header row "Col1 Col2 Col3"). Smallest gap already exceeds 1.5× glyph
  // height — split on every gap.
  if (baseline > avgHeight * 1.5) return 0;
  // Case B: bimodal distribution. Walk sorted gaps; the first gap that's
  // both >=2× baseline AND >= absolute floor is the start of the inter-cell
  // cluster. Threshold lives between the last intra-cell gap and that one.
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const prev = sorted[i - 1];
    if (cur >= baseline * 2 && cur >= absoluteFloor && cur - prev > 0) {
      return (prev + cur) / 2;
    }
  }
  return Infinity;
}

// Page-level canonical column inference. Pass all lines on a single page.
// Picks the line with the most detected columns as the column template and
// returns its [{ x, end }] ranges, expanded so the boundary between two
// neighbours is the midpoint between them. Outermost ranges stretch to
// ±Infinity so any item past the visual edges still gets assigned.
export function inferPageColumns(linesOnPage) {
  if (linesOnPage.length === 0) return [];
  let best = null;
  for (const line of linesOnPage) {
    const cols = buildColumns(line);
    if (!best || cols.length > best.cols.length) {
      best = { cols, line };
    }
  }
  if (!best || best.cols.length === 0) return [];
  const ranges = best.cols.map((c) => ({ x: c.x, end: c.end }));
  for (let i = 1; i < ranges.length; i++) {
    const mid = (ranges[i].x + ranges[i - 1].end) / 2;
    ranges[i - 1].end = mid;
    ranges[i].x = mid;
  }
  if (ranges.length > 0) {
    ranges[0].x = -Infinity;
    ranges[ranges.length - 1].end = Infinity;
  }
  return ranges;
}

// Snap a line's items into the given canonical column ranges. Returns
// [{ index, text }] aligned 1:1 with `ranges`. Empty columns get empty text.
export function snapToColumns(line, ranges) {
  const out = ranges.map((_, i) => ({ index: i, text: '' }));
  if (!line.items || line.items.length === 0) return out;
  const items = [...line.items].sort((a, b) => a.x - b.x);
  for (const it of items) {
    const mid = it.x + (it.width || 0) / 2;
    let idx = 0;
    for (let i = 0; i < ranges.length; i++) {
      if (mid >= ranges[i].x && mid < ranges[i].end) { idx = i; break; }
    }
    out[idx].text += (out[idx].text ? ' ' : '') + it.str;
  }
  return out.map((c) => ({ index: c.index, text: normalize(c.text) }));
}

export function findColumnIndexForCell(columns, cellText, occurrence = 1) {
  const target = normalize(cellText);
  if (!target) return null;
  let seen = 0;
  for (let i = 0; i < columns.length; i++) {
    if (columns[i].text.includes(target)) {
      seen++;
      if (seen === occurrence) return i;
    }
  }
  return null;
}

export function findLineForSelection(lines, selectionText) {
  const target = normalize(selectionText);
  if (!target) return -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].text === target) return i;
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].text.includes(target)) return i;
  }
  const collapsed = target.replace(/\s+/g, '');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].text.replace(/\s+/g, '').includes(collapsed)) return i;
  }
  return -1;
}
