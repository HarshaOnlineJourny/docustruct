// Training endpoints:
//   POST /api/training/:templateId/sample            upload sample PDF, return parsed lines+columns
//   POST /api/training/:templateId/mappings          save selections (cell-level)
//   GET  /api/training/:templateId/sample/:id/lines  re-parse an existing sample
//   POST /api/training/:templateId/preview-mappings  in-memory extraction preview (no DB write)
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { db, UPLOADS_DIR, getTemplate } from '../db.js';
import {
  extractText,
  inferPageColumns,
  snapToColumns,
  findLineForSelection,
} from '../extraction/pdfText.js';
import { extractFromLines } from '../extraction/extractor.js';

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-z0-9.\-_]/gi, '_');
      cb(null, `sample_${Date.now()}_${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const NUMERIC = /-?\$?\(?\d[\d,]*(?:\.\d+)?\)?%?/;
const DATEY = /\d{1,2}\/\d{1,2}\/\d{2,4}/;
function looksLikeDataRow(columns) {
  if (!columns || columns.length < 2) return false;
  return columns.some((c) => NUMERIC.test(c.text) || DATEY.test(c.text));
}

// Group lines by page, infer canonical columns per page, and snap every line
// on the page to those columns. Each line in the result has consistent
// column structure across the page.
function lineWiseColumns(lines) {
  const byPage = new Map();
  for (const line of lines) {
    if (!byPage.has(line.pageIndex)) byPage.set(line.pageIndex, []);
    byPage.get(line.pageIndex).push(line);
  }
  const out = [];
  for (const [pageIndex, pageLines] of byPage.entries()) {
    const ranges = inferPageColumns(pageLines);
    for (const line of pageLines) {
      const cols = ranges.length > 0 ? snapToColumns(line, ranges) : [];
      out.push({
        lineIndex: line.lineIndex,
        pageIndex: line.pageIndex,
        text: line.text,
        columns: cols,
        is_data_row: looksLikeDataRow(cols),
      });
    }
  }
  out.sort((a, b) => a.lineIndex - b.lineIndex);
  return out;
}

router.post('/:templateId/sample', upload.single('file'), async (req, res, next) => {
  try {
    const templateId = Number(req.params.templateId);
    const template = getTemplate(templateId, req.organization_id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    if (!req.file) return res.status(400).json({ error: 'file required' });

    const parsed = await extractText(req.file.path);

    const result = db
      .prepare(
        `INSERT INTO training_samples(template_id, file_path, original_name, organization_id)
         VALUES (?, ?, ?, ?)`
      )
      .run(templateId, path.relative(UPLOADS_DIR, req.file.path), req.file.originalname, req.organization_id);

    res.json({
      sample_id: result.lastInsertRowid,
      original_name: req.file.originalname,
      page_count: parsed.pageCount,
      needs_ocr: parsed.needsOcr,
      lines: lineWiseColumns(parsed.lines),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:templateId/mappings', (req, res) => {
  const templateId = Number(req.params.templateId);
  const { sample_id, mappings } = req.body;
  if (!sample_id || !Array.isArray(mappings)) {
    return res.status(400).json({ error: 'sample_id and mappings[] required' });
  }
  const template = getTemplate(templateId, req.organization_id);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  const sample = db.prepare('SELECT id FROM training_samples WHERE id = ? AND organization_id = ?').get(sample_id, req.organization_id);
  if (!sample) return res.status(404).json({ error: 'Sample not found' });

  const fieldsByName = new Map(template.fields.map((f) => [f.name, f.id]));

  const upsert = db.prepare(
    `INSERT INTO training_mappings
       (sample_id, field_id, selection_text, prototype_line_text, column_index,
        token_start, token_end,
        line_index, page_index, column_start, column_end, anchor_text, anchor_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sample_id, field_id) DO UPDATE SET
       selection_text       = excluded.selection_text,
       prototype_line_text  = excluded.prototype_line_text,
       column_index         = excluded.column_index,
       token_start          = excluded.token_start,
       token_end            = excluded.token_end,
       line_index           = excluded.line_index,
       page_index           = excluded.page_index,
       column_start         = excluded.column_start,
       column_end           = excluded.column_end,
       anchor_text          = excluded.anchor_text,
       anchor_kind          = excluded.anchor_kind`
  );

  const tx = db.transaction(() => {
    for (const m of mappings) {
      const fieldId = m.field_id ?? fieldsByName.get(m.field_name);
      if (!fieldId) continue;
      upsert.run(
        sample_id,
        fieldId,
        m.selection_text,
        m.prototype_line_text ?? null,
        m.column_index ?? null,
        m.token_start ?? null,
        m.token_end ?? null,
        m.line_index ?? null,
        m.page_index ?? null,
        m.column_start ?? null,
        m.column_end ?? null,
        m.anchor_text ?? null,
        m.anchor_kind ?? null
      );
    }
  });
  tx();

  res.json({ ok: true, count: mappings.length });
});

router.get('/:templateId/sample/:sampleId/lines', async (req, res, next) => {
  try {
    const sample = db
      .prepare('SELECT * FROM training_samples WHERE id = ? AND template_id = ? AND organization_id = ?')
      .get(Number(req.params.sampleId), Number(req.params.templateId), req.organization_id);
    if (!sample) return res.status(404).json({ error: 'Sample not found' });
    const filePath = path.isAbsolute(sample.file_path)
      ? sample.file_path
      : path.join(UPLOADS_DIR, sample.file_path);
    const parsed = await extractText(filePath);
    res.json({
      original_name: sample.original_name,
      page_count: parsed.pageCount,
      needs_ocr: parsed.needsOcr,
      lines: lineWiseColumns(parsed.lines),
    });
  } catch (err) {
    next(err);
  }
});

// Live-preview extraction without persisting mappings.
router.post('/:templateId/preview-mappings', async (req, res, next) => {
  try {
    const templateId = Number(req.params.templateId);
    const template = getTemplate(templateId, req.organization_id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const { sample_id, mappings = [] } = req.body || {};
    if (!sample_id) return res.status(400).json({ error: 'sample_id required' });
    const sample = db
      .prepare('SELECT * FROM training_samples WHERE id = ? AND template_id = ? AND organization_id = ?')
      .get(Number(sample_id), templateId, req.organization_id);
    if (!sample) return res.status(404).json({ error: 'Sample not found' });
    const filePath = path.isAbsolute(sample.file_path)
      ? sample.file_path
      : path.join(UPLOADS_DIR, sample.file_path);
    const parsed = await extractText(filePath);

    const fieldsByName = new Map(template.fields.map((f) => [f.name, f.id]));
    const enriched = mappings.map((m) => ({
      ...m,
      field_id: m.field_id ?? fieldsByName.get(m.field_name),
    }));

    const result = extractFromLines(parsed, { ...template, mappings: enriched });
    res.json({
      template_fields: template.fields,
      record_count: result.records.length,
      mode: result.mode,
      warnings: result.warnings,
      sample_records: result.records.slice(0, 5),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/locate', async (req, res, next) => {
  try {
    const { lines, selection_text } = req.body;
    if (!Array.isArray(lines) || !selection_text) {
      return res.status(400).json({ error: 'lines[] and selection_text required' });
    }
    const idx = findLineForSelection(lines, selection_text);
    res.json({ line_index: idx });
  } catch (err) {
    next(err);
  }
});


// Delete a single training sample (and its mappings via cascade).
router.delete('/sample/:sampleId', (req, res) => {
  const id = Number(req.params.sampleId);
  const sample = db.prepare('SELECT * FROM training_samples WHERE id = ? AND organization_id = ?').get(id, req.organization_id);
  if (!sample) return res.status(404).json({ error: 'Sample not found' });
  db.prepare('DELETE FROM training_samples WHERE id = ? AND organization_id = ?').run(id, req.organization_id);
  res.json({ ok: true, deleted_sample_id: id, template_id: sample.template_id });
});

export default router;
