// Diagnose a problem PDF. Prints raw text items with x/y coords, then the
// clustered lines, then the page-level canonical columns. Useful when the
// Training UI's Sample-rows tab looks wrong.
//
//   npm run inspect -- /absolute/path/to/file.pdf
//   npm run inspect -- /absolute/path/to/file.pdf --page 3
//   npm run inspect -- /absolute/path/to/file.pdf --raw            # raw items only
import { extractText, buildColumns, inferPageColumns } from '../extraction/pdfText.js';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node src/scripts/inspect.js <pdf> [--page N] [--raw]');
  process.exit(1);
}
const file = args[0];
const pageArgIdx = args.indexOf('--page');
const onlyPage = pageArgIdx >= 0 ? Number(args[pageArgIdx + 1]) - 1 : null;
const rawOnly = args.includes('--raw');

const parsed = await extractText(file);
console.log(`File: ${file}`);
console.log(`Pages: ${parsed.pageCount}  needsOcr: ${parsed.needsOcr}`);
console.log(`Total clustered lines: ${parsed.lines.length}`);
console.log('');

const linesByPage = new Map();
for (const line of parsed.lines) {
  if (onlyPage != null && line.pageIndex !== onlyPage) continue;
  if (!linesByPage.has(line.pageIndex)) linesByPage.set(line.pageIndex, []);
  linesByPage.get(line.pageIndex).push(line);
}

for (const [pIdx, lines] of linesByPage.entries()) {
  console.log(`=== Page ${pIdx + 1} (${lines.length} lines) ===`);

  if (rawOnly) {
    // Dump every raw item with its coordinates in y-desc, x-asc order.
    const items = [];
    for (const line of lines) for (const it of line.items) items.push({ ...it, line: line.lineIndex });
    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    for (const it of items) {
      console.log(
        `  y=${pad(it.y.toFixed(1), 6)}  x=${pad(it.x.toFixed(1), 6)}  ` +
        `w=${pad((it.width || 0).toFixed(1), 5)}  h=${pad((it.height || 0).toFixed(1), 5)}  ` +
        `${JSON.stringify(it.str)}`
      );
    }
    continue;
  }

  // Show clustered lines + their inferred columns.
  const ranges = inferPageColumns(lines);
  console.log(`  canonical columns: ${ranges.length}`);
  for (const line of lines) {
    const cols = buildColumns(line);
    const tag = line.text.length > 80 ? '   [LONG]' : '';
    console.log(
      `  L${pad(line.lineIndex, 4)}  y=${pad(line.y.toFixed(1), 6)}  ` +
      `cols=${pad(cols.length, 2)}  items=${pad(line.items.length, 3)}${tag}`
    );
    console.log(`         text: ${truncate(line.text, 100)}`);
    console.log(`         cols: ${cols.map((c) => truncate(c.text, 18)).join(' | ')}`);
  }
  console.log('');
}

function pad(s, n) { return String(s).padStart(n); }
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
