// Type-aware value cleaners. Each cleaner returns { value, raw_text, ok } where
// `value` is the canonical form and `ok` is false when the cleaner couldn't
// confidently coerce the input.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export function cleanText(raw) {
  if (raw == null) return { value: null, raw_text: raw, ok: false };
  const v = String(raw).replace(/\s+/g, ' ').trim();
  return { value: v || null, raw_text: raw, ok: v.length > 0 };
}

export function cleanNumber(raw) {
  if (raw == null) return { value: null, raw_text: raw, ok: false };
  const s = String(raw).replace(/[, ]/g, '').replace(/[%]/g, '');
  // Allow signed decimals.
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return { value: null, raw_text: raw, ok: false };
  const n = Number(m[0]);
  if (Number.isNaN(n)) return { value: null, raw_text: raw, ok: false };
  return { value: n, raw_text: raw, ok: true };
}

// Money / currency. Accepts $-prefixed, parenthesized negatives, embedded commas.
export function cleanAmount(raw) {
  if (raw == null) return { value: null, raw_text: raw, ok: false };
  let s = String(raw).trim();
  let negative = false;
  if (/^\(.+\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  const m = s.match(/\d+(?:\.\d+)?/);
  if (!m) return { value: null, raw_text: raw, ok: false };
  const n = Number(m[0]) * (negative ? -1 : 1);
  if (Number.isNaN(n)) return { value: null, raw_text: raw, ok: false };
  // Keep as a decimal number; the UI / exporter formats as currency.
  return { value: Math.round(n * 100) / 100, raw_text: raw, ok: true };
}

// Date cleaner. Tries common US formats (the carriers in scope are US).
export function cleanDate(raw) {
  if (raw == null) return { value: null, raw_text: raw, ok: false };
  const s = String(raw).trim();

  // mm/dd/yyyy or m/d/yy
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const [, mm, dd, yy] = m;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    return iso(year, Number(mm) - 1, Number(dd), raw);
  }

  // yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    return iso(Number(m[1]), Number(m[2]) - 1, Number(m[3]), raw);
  }

  // "January 31, 2025"
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (month != null) return iso(Number(m[3]), month, Number(m[2]), raw);
  }

  return { value: null, raw_text: raw, ok: false };
}

function iso(year, monthZeroIdx, day, raw) {
  const d = new Date(Date.UTC(year, monthZeroIdx, day));
  if (Number.isNaN(d.getTime())) return { value: null, raw_text: raw, ok: false };
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return { value: `${yyyy}-${mm}-${dd}`, raw_text: raw, ok: true };
}

export function cleanByType(type, raw) {
  switch (type) {
    case 'number': return cleanNumber(raw);
    case 'amount': return cleanAmount(raw);
    case 'date':   return cleanDate(raw);
    case 'text':
    default:       return cleanText(raw);
  }
}
