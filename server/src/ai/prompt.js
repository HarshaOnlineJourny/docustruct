// Prompt construction for the extractCell task. Kept tiny and structured so
// the LLM is constrained to JSON output with a value + confidence.
export function buildExtractCellPrompt(input) {
  const {
    cellText = '',
    columnHeader = '',
    surroundingRow = '',
    fieldName,
    fieldLabel,
    fieldType,
    examples = [],
  } = input;

  const typeHint = {
    text:   'A short text value (e.g. a name, code, or label).',
    number: 'A number (no currency or percent symbol). Return as JSON number.',
    amount: 'A money amount as a JSON number (no $, no commas; negatives become negative numbers).',
    date:   'A date in ISO format (YYYY-MM-DD).',
  }[fieldType] || 'A short value.';

  const system = [
    'You are an information extraction assistant for a PDF data-standardization product.',
    'Return ONLY a JSON object with these keys: { "value": ..., "confidence": 0.0-1.0, "reasoning": "..." }.',
    'If you cannot find the value, set "value": null and explain in "reasoning".',
    'Never hallucinate values. Only return what is clearly present in the cell or its surrounding row.',
  ].join('\n');

  const exampleBlock = examples.length
    ? `\nKnown good examples for this field:\n${examples.slice(0, 5).map((e) => `  - ${e}`).join('\n')}`
    : '';

  const user = [
    `Field name:   ${fieldName}`,
    `Field label:  ${fieldLabel || fieldName}`,
    `Field type:   ${fieldType}  - ${typeHint}`,
    columnHeader ? `Column header: ${columnHeader}` : null,
    surroundingRow ? `Surrounding row text:\n  ${surroundingRow}` : null,
    `Cell text:\n  ${cellText}`,
    exampleBlock,
    '',
    'Return JSON only.',
  ].filter(Boolean).join('\n');

  return { system, user };
}

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function calcCostUsd({ promptTokens, completionTokens, model, modelInfo }) {
  if (!modelInfo) return null;
  const inUsd  = (promptTokens     ?? 0) * (modelInfo.costPer1MInput  ?? 0) / 1_000_000;
  const outUsd = (completionTokens ?? 0) * (modelInfo.costPer1MOutput ?? 0) / 1_000_000;
  return Math.round((inUsd + outUsd) * 1_000_000) / 1_000_000;
}

export function buildSuggestTemplatePrompt({ samples = [] }) {
  const system = [
    'You are a template-design assistant for DocuStruct.',
    'Given excerpts from one or more PDFs, propose a single template that captures the structured information they share.',
    'Return ONLY a JSON object with this exact shape:',
    '{',
    '  "name": string,',
    '  "organization": string|null,',
    '  "state": string|null,',
    '  "year": number|null,',
    '  "category": string,',
    '  "fields": [',
    '    { "name": string, "label": string, "type": "text"|"number"|"date"|"amount", "is_primary": boolean, "rationale": string }',
    '  ]',
    '}',
    'Aim for 5-12 fields. Mark exactly one field as is_primary.',
    'Return JSON only.',
  ].join('\n');

  const user = [
    `You are looking at ${samples.length} PDF excerpt(s):`,
    ...samples.map((s, i) => `\n--- PDF #${i + 1} (${s.name}) ---\n${s.text.slice(0, 3000)}`),
    '\nPropose the template now.',
  ].join('\n');

  return { system, user };
}

const SKIP_RULES = [
  'Skip ONLY these line types:',
  '  - column headers (e.g. "Acct/Policy", "Comm Amt")',
  '  - section labels (e.g. "COMMISSIONS", "CANCELLATIONS")',
  '  - subtotal / total / grand-total rows',
  '  - page headers and footers (carrier address, page numbers)',
  'EVERY OTHER ROW is a data record - including rows with negative amounts,',
  'cancellations marked with dates, retention items, and "repetitive" rows.',
  'If a record spans TWO visual lines (e.g. policy/holder on line 1, product/dates on line 2), treat them as ONE record.',
  'If a value is missing for a record, set it to null. Never invent values.',
  'If the document has many records (50+), include them all - do not truncate.',
].join('\n');

const TYPE_RULES = [
  'Type rules:',
  '  - text:   short string',
  '  - number: JSON number, no currency or %',
  '  - amount: JSON number, no $; parenthesised values are negative',
  '  - date:   ISO format YYYY-MM-DD',
].join('\n');

export function buildExtractRecordsPrompt({ fields = [], hint = '' }) {
  const fieldList = fields
    .map((f) => `  - ${f.name} (${f.type})${f.is_primary ? ' [primary]' : ''}${f.label ? ' - ' + f.label : ''}`)
    .join('\n');
  const system = [
    'You are a PDF data extraction assistant for DocuStruct.',
    'You will receive ONE PDF document. Each record may span TWO visual lines.',
    'Your task: return EVERY data record (row), in visual top-to-bottom order, plus regex PATTERNS that can extract these values from similar PDFs without calling you again.',
    '',
    'Output format - return ONLY JSON of the shape:',
    '{',
    '  "records": [ { "values": { "<field_name>": <value>, ... }, "confidence": 0.0-1.0 } ],',
    '  "learned_patterns": {',
    '    "record_anchor": "<JS regex string, no slashes, no flags>",',
    '    "fields": { "<field_name>": { "pattern": "<JS regex with ONE capturing group>", "example": "<one value from this PDF>" } }',
    '  }',
    '}',
    '',
    TYPE_RULES,
    '',
    SKIP_RULES,
    '',
    'Pattern guidance: target the PDFs RAW TEXT stream as pdfjs would extract it. record_anchor must fire ONCE per record and NOT match headers/totals/footers. Each field pattern has exactly ONE capture group. YOU MUST return learned_patterns when the PDF has extractable text — best-effort patterns are better than none. Only return null for fully scanned image PDFs.',
    'Return JSON only, no prose or markdown fences.',
  ].join('\n');
  const user = [
    'Extract every record from this PDF and propose extraction patterns.',
    '',
    'Fields to extract:',
    fieldList,
    hint ? '\nNote: ' + hint : '',
  ].join('\n');
  return { system, user };
}

export function buildAnalyzePdfPrompt({ userHint = '' }) {
  const system = [
    'You are a PDF onboarding assistant for DocuStruct.',
    'You will receive ONE PDF document. Your job:',
    '  1. Identify what kind of structured records this PDF contains.',
    '  2. Propose a clean set of fields the user should extract for each record.',
    '  3. Return every data record you can read, using your proposed fields.',
    '  4. Return regex PATTERNS that can extract these same values from any similar PDF without calling you again.',
    '',
    'Use the user hint to bias your field choices.',
    '',
    'Output format - return ONLY JSON of this exact shape:',
    '{',
    '  "template": {',
    '    "name": string, "organization": string|null, "state": string|null,',
    '    "year": number|null, "category": string,',
    '    "fields": [ { "name": string, "label": string, "type": "text"|"number"|"date"|"amount", "is_primary": boolean, "rationale": string } ]',
    '  },',
    '  "records": [ { "values": { "<field_name>": <value>, ... }, "confidence": 0.0-1.0 } ],',
    '  "learned_patterns": {',
    '    "record_anchor": "<JS regex string, no slashes, no flags>",',
    '    "fields": {',
    '      "<field_name>": { "pattern": "<JS regex with ONE capturing group>", "example": "<one concrete value from this PDF>" }',
    '    }',
    '  }',
    '}',
    '',
    TYPE_RULES,
    '',
    'Aim for 5-12 fields. Mark exactly one field as is_primary.',
    '',
    SKIP_RULES,
    '',
    'Pattern guidance (CRITICAL):',
    '  - Patterns must match values in the PDFs RAW TEXT stream (as pdfjs extracts it), NOT the visual layout.',
    '  - record_anchor fires ONCE per individual record. It must NOT match headers, totals, footers.',
    '  - Each field pattern must include exactly ONE capturing group around the value.',
    '  - Patterns will be applied with the JavaScript g flag to find ALL records.',
    '  - YOU MUST RETURN learned_patterns. Provide best-effort regexes even if imperfect — partial patterns still save the user money. Only return learned_patterns: null if the PDF is a pure scanned image with no extractable text.',
    '',
    'If the PDF contains no structured records at all, return records: [] and still propose a sensible template.',
    'Return JSON only, no prose or markdown fences.',
  ].join('\n');
  const user = [
    'Analyze this PDF and propose a template plus extracted records plus extraction patterns.',
    userHint ? '\nUser hint:\n' + userHint : '',
  ].filter(Boolean).join('\n');
  return { system, user };
}
