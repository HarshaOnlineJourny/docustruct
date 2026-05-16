// Free diagnostic: dump the raw text pdfjs extracts from a given PDF.
// Useful for designing regex anchors when the AI's patterns don't match.
//
// Run:   npm run dump-pdf -- <pdf_path>
//   e.g. npm run dump-pdf -- "D:\\Claude\\Projects\\DocuStruct\\server\\data\\uploads\\doc_1778826522583_37ht_BCBS_TX_2.pdf"
//
// Output: prints the full extracted text to stdout AND writes it to
//   <pdf_path>.txt next to the source so you can grep, paste, etc.
import fs from 'node:fs';
import path from 'node:path';
import { extractText } from '../extraction/pdfText.js';

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: npm run dump-pdf -- <pdf_path>');
  process.exit(1);
}
const pdfPath = path.resolve(arg);
if (!fs.existsSync(pdfPath)) {
  console.error(`File not found: ${pdfPath}`);
  process.exit(1);
}

const parsed = await extractText(pdfPath);
const stream = parsed.lines.map((l) => l.text).join('\n');

const outPath = pdfPath + '.txt';
fs.writeFileSync(outPath, stream, 'utf8');

console.log(`PDF      : ${pdfPath}`);
console.log(`Pages    : ${parsed.pages ?? '?'}`);
console.log(`Lines    : ${parsed.lines.length}`);
console.log(`Chars    : ${stream.length}`);
console.log(`Written  : ${outPath}`);
console.log();
console.log('=== First 800 chars ===');
console.log(stream.slice(0, 800));
console.log();
console.log('=== Middle 800 chars (around char ' + Math.floor(stream.length / 2) + ') ===');
const mid = Math.floor(stream.length / 2);
console.log(stream.slice(Math.max(0, mid - 400), mid + 400));
console.log();
console.log('=== Last 800 chars ===');
console.log(stream.slice(-800));
