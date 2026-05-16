// Pattern-based extractor.
// Saved shape supports BOTH:
//   { record_anchor: "rx", fields: { name: { pattern: "rx", example: "v" } } }
//   { record_anchor_alternatives: ["rx1","rx2"], fields: { name: { alternatives: [...] } } }
// Internally we always work with arrays of alternatives.
import { extractText } from './pdfText.js';

function compile(patternStr, flags = '') {
  if (typeof patternStr !== 'string' || !patternStr) return null;
  let p = patternStr.trim();
  if (p.startsWith('/')) {
    const last = p.lastIndexOf('/');
    if (last > 0) p = p.slice(1, last);
  }
  try { return new RegExp(p, flags); }
  catch (_) { return null; }
}

function extractFirstCapture(window, patternStr) {
  const rx = compile(patternStr);
  if (!rx) return null;
  const m = window.match(rx);
  if (!m) return null;
  return (m[1] !== undefined ? m[1] : m[0]).trim();
}

function coerce(value, type) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (type === 'number' || type === 'amount') {
    const neg = /^\(.+\)$/.test(s);
    const cleaned = s.replace(/[(),$\s%]/g, '').replace(/^-/, '');
    const n = Number(cleaned);
    if (Number.isFinite(n)) return neg ? -n : n;
    return null;
  }
  if (type === 'date') {
    const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      let [, mm, dd, yy] = m;
      if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
      return `${yy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return s;
  }
  return s;
}

// Normalize any saved shape into { anchorPatterns: [], fieldAlts: { name: [pattern, ...] } }
export function normalizePatterns(rawJson) {
  if (!rawJson) return null;
  const obj = (typeof rawJson === 'string') ? safeJson(rawJson) : rawJson;
  if (!obj || typeof obj !== 'object') return null;
  const anchorPatterns = [];
  if (Array.isArray(obj.record_anchor_alternatives)) {
    for (const p of obj.record_anchor_alternatives) if (typeof p === 'string' && p) anchorPatterns.push(p);
  }
  if (typeof obj.record_anchor === 'string' && obj.record_anchor) anchorPatterns.push(obj.record_anchor);
  if (anchorPatterns.length === 0) return null;
  const fieldAlts = {};
  const f = obj.fields || {};
  for (const [name, def] of Object.entries(f)) {
    const alts = [];
    if (def && Array.isArray(def.alternatives)) {
      for (const a of def.alternatives) {
        if (a && typeof a.pattern === 'string') alts.push(a.pattern);
        else if (typeof a === 'string') alts.push(a);
      }
    }
    if (def && typeof def.pattern === 'string' && def.pattern) alts.push(def.pattern);
    if (alts.length > 0) fieldAlts[name] = [...new Set(alts)];
  }
  return { anchorPatterns: [...new Set(anchorPatterns)], fieldAlts };
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

export async function extractByLearnedPatterns(pdfPath, template) {
  const norm = normalizePatterns(template.learned_patterns);
  if (!norm) return { records: [], reason: 'no_patterns', anchorPatterns: [] };

  const parsed = await extractText(pdfPath);
  const stream = parsed.lines.map((l) => l.text).join('\n');

  // Collect anchor positions across ALL anchor alternatives, then dedupe by start.
  const seen = new Set();
  const anchorStarts = [];
  for (const a of norm.anchorPatterns) {
    const rx = compile(a, 'g');
    if (!rx) continue;
    let m;
    while ((m = rx.exec(stream)) !== null) {
      if (!seen.has(m.index)) {
        seen.add(m.index);
        anchorStarts.push(m.index);
      }
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
  }
  if (anchorStarts.length === 0) {
    // Help the next debugging step: emit the anchor patterns we tried and a
    // short snippet of the PDF text so we can see what they were matching
    // against. Truncated to ~300 chars to keep the log readable.
    console.warn(`[patternExtract] no anchor matches in ${pdfPath}.`);
    console.warn(`[patternExtract] tried anchors: ${JSON.stringify(norm.anchorPatterns)}`);
    console.warn(`[patternExtract] PDF text snippet: ${JSON.stringify(stream.slice(0, 300))}`);
    return { records: [], reason: 'no_matches', anchorPatterns: norm.anchorPatterns };
  }
  anchorStarts.sort((a, b) => a - b);

  const windows = anchorStarts.map((start, i) => {
    const stop = i + 1 < anchorStarts.length ? anchorStarts[i + 1] : stream.length;
    return stream.slice(start, stop);
  });

  const records = [];
  for (const w of windows) {
    const values = {};
    let anyHit = false;
    for (const f of (template.fields || [])) {
      const alts = norm.fieldAlts[f.name] || [];
      let raw = null;
      for (const p of alts) {
        const got = extractFirstCapture(w, p);
        if (got != null) { raw = got; break; }
      }
      if (raw != null) anyHit = true;
      values[f.name] = {
        value: coerce(raw, f.type),
        raw_text: raw,
        source: 'pattern',
        confidence: raw != null ? 0.92 : null,
      };
    }
    if (anyHit) {
      records.push({ values, confidence: 0.92, source_text: w.trim().slice(0, 500) });
    }
  }
  return { records, reason: 'ok', anchors: anchorStarts.length };
}

// Merge a fresh learned_patterns object into an existing one. Returns the new
// shape (multi-alternative form). Existing alternatives are preserved; new
// ones are appended and deduplicated.
export function mergeLearnedPatterns(existing, fresh) {
  const a = normalizePatterns(existing);
  const b = normalizePatterns(fresh);
  if (!a && !b) return null;
  if (!a) return shapeToMulti(b);
  if (!b) return shapeToMulti(a);
  const anchors = [...new Set([...a.anchorPatterns, ...b.anchorPatterns])];
  const fieldNames = new Set([...Object.keys(a.fieldAlts), ...Object.keys(b.fieldAlts)]);
  const fields = {};
  for (const name of fieldNames) {
    const alts = [...(a.fieldAlts[name] || []), ...(b.fieldAlts[name] || [])];
    fields[name] = { alternatives: [...new Set(alts)].map((p) => ({ pattern: p })) };
  }
  return { record_anchor_alternatives: anchors, fields };
}

function shapeToMulti(norm) {
  if (!norm) return null;
  const fields = {};
  for (const [name, alts] of Object.entries(norm.fieldAlts)) {
    fields[name] = { alternatives: alts.map((p) => ({ pattern: p })) };
  }
  return { record_anchor_alternatives: norm.anchorPatterns, fields };
}
