// DocuStruct extraction engine.
//
// Inputs: a parsed-text representation of a PDF (lines + items) and a template
// with fields + training mappings.
//
// Strategy:
//   1. Group mappings by prototype_line_text. The largest group's training row
//      is our "row prototype".
//   2. If the prototype group has >=2 fields, use ROW MODE: pre-compute
//      page-level canonical columns, then for each candidate line on each
//      page, snap items to those columns and read each field by column_index.
//   3. If only a single primary field was trained and it repeats, use BLOCK
//      MODE: split the doc into record blocks anchored on the primary field.
//   4. Otherwise fall back to DOCUMENT MODE: pull each field once, preferring
//      anchor (header) text when available.
import {
  extractText,
  normalize,
  buildColumns,
  findColumnIndexForCell,
  inferPageColumns,
  snapToColumns,
} from './pdfText.js';
import { cleanByType } from './cleaners.js';
// AI helpers are dynamic-imported inside aiEscalatePass so the deterministic
// engine and its tests don't pull in the DB module.

const NUMERIC_TOKEN = /^-?\$?\(?\d[\d,]*(?:\.\d+)?\)?%?$/;
const DATE_TOKEN = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

export async function extractFromFile(filePath, template, opts = {}) {
  const parsed = await extractText(filePath);
  if (parsed.needsOcr) {
    return {
      pageCount: parsed.pageCount,
      needsOcr: true,
      records: [],
      warnings: ['PDF has no extractable text — needs OCR.'],
      mode: 'needs_ocr',
    };
  }
  const result = extractFromLines(parsed, template);
  // Two-pass: deterministic always runs first; AI escalation, if configured,
  // runs only on cells with confidence below the threshold and within the
  // per-import call cap.
  return aiEscalatePass(result, parsed, template, opts);
}

// Public so routes can await escalation explicitly when needed.
export async function aiEscalatePass(result, parsed, template, opts = {}) {
  // Dynamic-import to keep the deterministic path DB-free.
  const { extractCellWithAI, aiStatus } = await import('../ai/index.js');
  const { getAIConfig } = await import('../ai/settings.js');
  const status = aiStatus({ organizationId: opts.organizationId ?? 1 });
  if (!status.enabled) return result;
  const cfg = getAIConfig({ organizationId: opts.organizationId ?? 1 });

  const threshold = cfg.confidenceThreshold;
  const maxCalls = cfg.maxCallsPerImport;
  const fieldsByName = new Map(template.fields.map((f) => [f.name, f]));

  let calls = 0;
  let escalated = 0;
  for (const record of result.records) {
    if (calls >= maxCalls) break;
    for (const [fieldName, cell] of Object.entries(record.values || {})) {
      if (calls >= maxCalls) break;
      if (cell == null) continue;
      const conf = cell.confidence ?? 0;
      if (conf >= threshold) continue;
      const field = fieldsByName.get(fieldName);
      if (!field) continue;

      // Pass the full row text + column header so the LLM has context. We
      // build the row text from the record's values; the column header
      // (when known) is taken from the record itself if attached.
      const surroundingRow = Object.entries(record.values || {})
        .map(([n, v]) => `${n}: ${v?.value ?? '—'}`)
        .join('  |  ');
      const aiResp = await extractCellWithAI({
        cellText: cell.raw_text || cell.value || '',
        columnHeader: cell.column_header || '',
        surroundingRow,
        fieldName,
        fieldLabel: field.label,
        fieldType: field.type,
        fieldId: field.id,
        examples: [],
        context: { recordIdx: record.row_index },
      }, {
        organizationId: opts.organizationId ?? 1,
        templateId: template.id,
        documentId: opts.documentId ?? null,
      });
      calls++;

      if (aiResp.skipped) continue;
      if (aiResp.value != null) {
        cell.value = aiResp.value;
        cell.raw_text = aiResp.raw || cell.raw_text;
        cell.source = 'ai';
        cell.confidence = aiResp.confidence ?? Math.max(conf, 0.75);
        escalated++;
      }
    }
  }

  if (escalated > 0) {
    result.ai = { escalated, calls, max_calls: maxCalls };
    result.warnings = [
      ...(result.warnings || []),
      `AI escalation: ${escalated}/${calls} cells improved (cap ${maxCalls}).`,
    ];
  }
  return result;
}

export function extractFromLines(parsed, template) {
  const { lines, pageCount } = parsed;
  const fieldsByName = new Map(template.fields.map((f) => [f.name, f]));
  const mappings = template.mappings || [];
  const warnings = [];

  if (mappings.length === 0) {
    warnings.push('Template has no training mappings.');
    return { pageCount, needsOcr: false, records: [], warnings, mode: 'untrained' };
  }

  // Group mappings by prototype_line_text. Each group is a "training sample"
  // — one click-mapping session against one PDF. Multi-sample training means
  // we may have several groups, each a candidate row prototype.
  const byProto = new Map();
  for (const m of mappings) {
    const key = m.prototype_line_text || `line:${m.line_index ?? -1}`;
    if (!byProto.has(key)) byProto.set(key, []);
    byProto.get(key).push(m);
  }

  // Run row-mode against EACH candidate prototype with >=2 mapped fields.
  // Pick the result that produced the most records (and break ties by total
  // cleaned-cell hits across all records).
  const candidates = [...byProto.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([key, group]) => ({ key, group }));

  if (candidates.length > 0) {
    const attempts = candidates.map((p) => {
      const result = extractRowMode(parsed, template, p, [...warnings]);
      const totalHits = result.records.reduce(
        (a, r) => a + Object.values(r.values || {}).filter((v) => v?.value != null).length,
        0
      );
      return { result, score: result.records.length * 1000 + totalHits, sampleKey: p.key };
    });
    attempts.sort((a, b) => b.score - a.score);
    const best = attempts[0];
    if (best.result.records.length > 0) {
      best.result.attempts = attempts.length;
      best.result.sampleKey = best.sampleKey;
      // Surface the loser counts so the UI can show "tried N samples".
      if (attempts.length > 1) {
        best.result.warnings = [
          ...(best.result.warnings || []),
          `Tried ${attempts.length} training samples; picked the one yielding ${best.result.records.length} records.`,
        ];
      }
      return best.result;
    }
  }

  // Single-field training. If the field repeats and is_primary, try block mode.
  const primary = template.fields.find((f) => f.is_primary);
  if (primary) {
    const primaryMapping = mappings.find((m) => {
      const f = fieldsByName.get(fieldNameForMapping(m, template));
      return f && f.is_primary;
    });
    if (primaryMapping) {
      const repeatCount = countRepeats(lines, primaryMapping);
      if (repeatCount >= 2) {
        return extractBlockMode(parsed, template, primaryMapping, mappings, warnings);
      }
    }
  }

  return extractDocumentMode(parsed, template, mappings, warnings);
}

function fieldNameForMapping(mapping, template) {
  const f = template.fields.find((f) => f.id === mapping.field_id);
  return f ? f.name : null;
}

// ---- Row mode --------------------------------------------------------------
function extractRowMode(parsed, template, prototype, warnings) {
  const { lines, pageCount } = parsed;
  const protoText =
    prototype.group[0].prototype_line_text || prototype.group[0].selection_text || '';
  const shape = shapeFromText(protoText);

  const fieldColumns = new Map();
  const fieldMappings = new Map();
  for (const m of prototype.group) {
    if (m.column_index != null) fieldColumns.set(m.field_id, m.column_index);
    fieldMappings.set(m.field_id, m);
  }

  // Recover missing column indices by locating the prototype line.
  if (fieldColumns.size < prototype.group.length) {
    const protoLine = lines.find((l) => l.text === protoText);
    if (protoLine) {
      const cols = buildColumns(protoLine);
      for (const m of prototype.group) {
        if (fieldColumns.has(m.field_id)) continue;
        const idx = findColumnIndexForCell(cols, m.selection_text);
        if (idx != null) fieldColumns.set(m.field_id, idx);
      }
    }
  }

  if (fieldColumns.size === 0) {
    warnings.push('No column indices known — falling back to document mode.');
    return extractDocumentMode(parsed, template, prototype.group, warnings);
  }

  const maxColIdx = Math.max(...fieldColumns.values());

  // Pre-compute canonical column ranges per page so every row uses identical
  // column boundaries. Eliminates per-row drift when one row's policy_no
  // happens to abut its policyholder cell.
  const linesByPage = new Map();
  for (const line of lines) {
    if (!linesByPage.has(line.pageIndex)) linesByPage.set(line.pageIndex, []);
    linesByPage.get(line.pageIndex).push(line);
  }
  const pageColumns = new Map();
  for (const [pIdx, pLines] of linesByPage.entries()) {
    pageColumns.set(pIdx, inferPageColumns(pLines));
  }

  const records = [];
  for (const line of lines) {
    if (!isCandidateRow(line, shape)) continue;
    const ranges = pageColumns.get(line.pageIndex);
    const cols = ranges && ranges.length > 0
      ? snapToColumns(line, ranges)
      : buildColumns(line);
    if (cols.length <= maxColIdx) continue;

    const values = {};
    let hits = 0;
    for (const field of template.fields) {
      const colIdx = fieldColumns.get(field.id);
      if (colIdx == null) continue;
      const cellText = cols[colIdx]?.text ?? '';
      const mapping = fieldMappings.get(field.id);
      const raw = readSubCell(cellText, mapping, field, line.text);
      const cleaned = cleanByType(field.type, raw);
      if (cleaned.ok) hits++;
      values[field.name] = {
        value: cleaned.value,
        raw_text: cleaned.raw_text,
        source: 'anchor',
        confidence: cleaned.ok ? 0.85 : 0.3,
      };
    }

    if (hits >= 2) {
      records.push({
        values,
        confidence: hits / Math.max(1, fieldColumns.size),
        source_text: line.text,
      });
    }
  }

  if (records.length === 0) {
    warnings.push('No rows matched the trained prototype — falling back to document mode.');
    return extractDocumentMode(parsed, template, prototype.group, warnings);
  }

  return { pageCount, needsOcr: false, records, warnings, mode: 'row' };
}

// Within a single cell text, pick the substring matching this field's
// trained token range. If the trained sample didn't record a token range
// (selection covered the whole cell) we just return the cell text.
//
// When the peer row has a different token count we fall back to a
// type-aware pattern match: name fields (text type) anchor on
// "WORD..., WORD..." patterns; date / amount / number fields find the first
// token of that shape inside the cell.
function readSubCell(cellText, mapping, field, fullLineText = '') {
  if (!cellText) return '';
  if (!mapping) return cellText;
  const tStart = mapping.token_start;
  const tEnd = mapping.token_end;
  if (tStart == null || tEnd == null) return cellText;
  const tokens = cellText.split(/\s+/).filter(Boolean);
  if (tStart === 0 && tEnd >= tokens.length - 1) return cellText;

  // Try the trained token range first.
  const sliced = tokens.slice(tStart, tEnd + 1).join(' ');
  if (sliceLooksRight(sliced, mapping, field)) return sliced;

  // Fallback 1: type-aware search inside the cell.
  let matched = patternMatchInCell(cellText, mapping, field);
  if (matched) return matched;

  // Fallback 2: search the whole line. Page-level snap can push trailing
  // tokens of a long value into the neighbouring cell; widening the search
  // recovers them.
  if (fullLineText) {
    matched = patternMatchInCell(fullLineText, mapping, field);
    if (matched) return matched;
  }

  return sliced || cellText;
}

// Quick shape check on a candidate slice — a "LAST, FIRST" trained selection
// must contain a comma; a date / amount field must contain matching tokens.
function sliceLooksRight(slice, mapping, field) {
  if (!slice) return false;
  const trained = (mapping?.selection_text || '').trim();
  if (field.type === 'text' && trained.includes(',') && !slice.includes(',')) return false;
  if (field.type === 'date' && !/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(slice)) return false;
  if ((field.type === 'amount' || field.type === 'number') && !/\d/.test(slice)) return false;
  return true;
}

const NAME_PATTERN = /[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+)*,\s*[A-Z][A-Za-z'\-]+/;
const POLICY_ID_PATTERN = /[A-Z][A-Za-z0-9]*\d{4,}(?:-[A-Za-z0-9]+)*/;

function patternMatchInCell(cellText, mapping, field) {
  if (!cellText) return null;
  const trained = (mapping?.selection_text || '').trim();

  if (field.type === 'date') {
    const m = cellText.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
    return m ? m[0] : null;
  }
  if (field.type === 'amount' || field.type === 'number') {
    const m = cellText.match(/-?\$?\(?\d[\d,]*(?:\.\d+)?\)?%?/);
    return m ? m[0] : null;
  }
  // Text fields: look for "LAST, FIRST" name shape if the trained selection
  // had a comma; else look for an alphanumeric ID at the start.
  if (trained.includes(',')) {
    const m = cellText.match(NAME_PATTERN);
    if (m) return m[0];
  } else {
    const m = cellText.match(POLICY_ID_PATTERN);
    if (m) return m[0];
  }
  return null;
}

function shapeFromText(text) {
  const tokens = text.split(/\s+/);
  return {
    tokens: tokens.length,
    categories: tokens.map(tokenCategory),
    page: 0,
  };
}

// ---- Block mode ------------------------------------------------------------
function extractBlockMode(parsed, template, primaryMapping, mappings, warnings) {
  const { lines, pageCount } = parsed;
  const protoLine = lines[primaryMapping.line_index ?? -1];
  const matchPattern = protoLine ? looseLinePattern(protoLine.text) : null;
  const blockStarts = [];
  for (let i = 0; i < lines.length; i++) {
    if (matchPattern && matchPattern.test(lines[i].text)) blockStarts.push(i);
  }
  if (blockStarts.length < 2) {
    warnings.push('Primary field did not repeat — falling back to document mode.');
    return extractDocumentMode(parsed, template, mappings, warnings);
  }
  const records = [];
  for (let b = 0; b < blockStarts.length; b++) {
    const start = blockStarts[b];
    const end = b + 1 < blockStarts.length ? blockStarts[b + 1] : lines.length;
    const blockLines = lines.slice(start, end);
    const values = {};
    for (const field of template.fields) {
      const mapping = mappings.find((m) => m.field_id === field.id);
      if (!mapping) continue;
      const cell = readByAnchor(blockLines, mapping, field) ||
                   readByLabel(blockLines, mapping, field);
      values[field.name] = cell ?? emptyCell(field);
    }
    records.push({ values, confidence: 0.6, source_text: blockLines[0]?.text ?? '' });
  }
  return { pageCount, needsOcr: false, records, warnings, mode: 'block' };
}

// ---- Document mode --------------------------------------------------------
function extractDocumentMode(parsed, template, mappings, warnings) {
  const { lines, pageCount } = parsed;
  const values = {};
  for (const field of template.fields) {
    const mapping = mappings.find((m) => m.field_id === field.id);
    if (!mapping) {
      values[field.name] = emptyCell(field);
      continue;
    }
    const cell =
      readByAnchor(lines, mapping, field) ||
      readByLabel(lines, mapping, field) ||
      emptyCell(field);
    values[field.name] = cell;
  }
  return {
    pageCount,
    needsOcr: false,
    records: [{ values, confidence: 0.5 }],
    warnings,
    mode: 'document',
  };
}

// ---- Helpers --------------------------------------------------------------
function emptyCell() {
  return { value: null, raw_text: null, source: null, confidence: 0 };
}

function tokenCategory(tok) {
  if (DATE_TOKEN.test(tok)) return 'D';
  if (NUMERIC_TOKEN.test(tok)) return 'N';
  return 'A';
}

function isCandidateRow(line, shape) {
  if (!line.text) return false;
  if (line.text.split(/\s+/).length < Math.max(3, Math.floor(shape.tokens * 0.5))) {
    return false;
  }
  const cats = line.text.split(/\s+/).map(tokenCategory);
  const protoNums = shape.categories.filter((c) => c === 'N').length;
  const protoDates = shape.categories.filter((c) => c === 'D').length;
  const lineNums = cats.filter((c) => c === 'N').length;
  const lineDates = cats.filter((c) => c === 'D').length;
  if (protoNums > 0 && lineNums < Math.max(1, protoNums - 1)) return false;
  if (protoDates > 0 && lineDates < Math.max(1, protoDates - 1)) return false;
  return true;
}

function looseLinePattern(text) {
  const tokens = text.split(/\s+/).slice(0, 2);
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return null;
  return new RegExp('^' + escaped.join('\\s+'));
}

function countRepeats(lines, mapping) {
  if (!mapping || mapping.line_index == null) return 0;
  const proto = lines[mapping.line_index];
  if (!proto) return 0;
  const pattern = looseLinePattern(proto.text);
  if (!pattern) return 0;
  return lines.filter((l) => pattern.test(l.text)).length;
}

function readByAnchor(lines, mapping, field) {
  if (!mapping.anchor_text) return null;
  const anchor = normalize(mapping.anchor_text);
  for (const line of lines) {
    const idx = line.text.indexOf(anchor);
    if (idx >= 0) {
      const after = line.text.slice(idx + anchor.length).trim();
      const candidate = pickFirstTokenForType(after, field.type);
      if (candidate != null) {
        const cleaned = cleanByType(field.type, candidate);
        return {
          value: cleaned.value,
          raw_text: candidate,
          source: 'anchor',
          confidence: cleaned.ok ? 0.7 : 0.3,
        };
      }
    }
  }
  return null;
}

function readByLabel(lines, mapping, field) {
  const label = normalize(mapping.selection_text || '');
  if (!label) return null;
  const key = label.split(/\s+/)[0];
  if (!key) return null;
  for (const line of lines) {
    const idx = line.text.indexOf(key);
    if (idx < 0) continue;
    const after = line.text.slice(idx + key.length).trim();
    const candidate = pickFirstTokenForType(after, field.type);
    if (candidate) {
      const cleaned = cleanByType(field.type, candidate);
      return {
        value: cleaned.value,
        raw_text: candidate,
        source: 'label',
        confidence: cleaned.ok ? 0.5 : 0.2,
      };
    }
  }
  return null;
}

function pickFirstTokenForType(text, type) {
  if (!text) return null;
  const tokens = text.split(/\s+/);
  if (type === 'amount' || type === 'number') {
    for (const t of tokens) if (NUMERIC_TOKEN.test(t)) return t;
    return null;
  }
  if (type === 'date') {
    for (const t of tokens) if (DATE_TOKEN.test(t)) return t;
    return null;
  }
  return tokens.slice(0, 8).join(' ');
}
