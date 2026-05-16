// Data Grid endpoints: list records, post corrections, export CSV.
import express from 'express';
import { db, listRecords, listDocuments, getTemplate, bumpCorrections, getFieldStats, fieldAccuracy, UPLOADS_DIR } from '../db.js';

const router = express.Router();

router.get('/records', (req, res) => {
  // Validate template ownership if filtering by template_id
  let templateId = req.query.template_id ? Number(req.query.template_id) : undefined;
  if (templateId) {
    const tpl = getTemplate(templateId, req.organization_id);
    if (!tpl) {
      return res.status(404).json({ error: 'Template not found' });
    }
  }

  const filter = {
    template_id: templateId,
    document_id: req.query.document_id ? Number(req.query.document_id) : undefined,
    // NOTE: 'organization' TEXT filter removed — org_id is enforced at database layer
    year: req.query.year ? Number(req.query.year) : undefined,
    status: req.query.status || undefined,
    from_date: req.query.from_date || undefined,
    to_date: req.query.to_date || undefined,
  };
  let records = listRecords(filter, req.organization_id);
  // Optional in-memory filters: search across all cell values + AI-only.
  const q = (req.query.q || '').toLowerCase().trim();
  if (q) {
    records = records.filter((r) =>
      Object.values(r.values || {}).some((v) =>
        String(v?.value ?? '').toLowerCase().includes(q)
      ) ||
      String(r.original_name || '').toLowerCase().includes(q)
    );
  }
  if (req.query.has_ai === '1') {
    records = records.filter((r) =>
      Object.values(r.values || {}).some((v) => v?.source === 'ai')
    );
  }
  const total = records.length;
  const limit  = Math.min(Number(req.query.limit)  || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  res.json({
    total,
    limit,
    offset,
    records: records.slice(offset, offset + limit),
  });
});

// Bulk-delete records by id. Body: { ids: [123, 124, ...] }.
// Cascades to record_values and corrections via FK.
router.post('/records/delete', express.json({ limit: '1mb' }), (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'ids[] required' });

  // Verify all records belong to user's organization before deleting
  const placeholders = ids.map(() => '?').join(',');
  const ownershipCheck = db.prepare(`
    SELECT COUNT(*) as count FROM records r
    JOIN documents d ON d.id = r.document_id
    WHERE r.id IN (${placeholders})
    AND d.organization_id = ?
  `).get(...ids, req.organization_id);

  if (ownershipCheck.count !== ids.length) {
    return res.status(403).json({ error: 'Cannot delete records from other organizations' });
  }

  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM records WHERE id IN (${placeholders})`).run(...ids);
  });
  tx();
  res.json({ ok: true, deleted: ids.length });
});

router.post('/corrections', (req, res) => {
  const { record_id, field_id, new_value } = req.body;
  if (!record_id || !field_id) {
    return res.status(400).json({ error: 'record_id and field_id required' });
  }

  // Verify record belongs to user's organization
  const recordCheck = db.prepare(`
    SELECT r.id FROM records r
    JOIN documents d ON d.id = r.document_id
    WHERE r.id = ? AND d.organization_id = ?
  `).get(record_id, req.organization_id);

  if (!recordCheck) {
    return res.status(403).json({ error: 'Record not found or unauthorized' });
  }

  const current = db
    .prepare('SELECT value FROM record_values WHERE record_id = ? AND field_id = ?')
    .get(record_id, field_id);
  const oldValue = current?.value ?? null;
  const tx = db.transaction(() => {
    if (current) {
      db.prepare(
        `UPDATE record_values
            SET value = ?, source = 'manual', confidence = 1.0
          WHERE record_id = ? AND field_id = ?`
      ).run(new_value ?? null, record_id, field_id);
    } else {
      db.prepare(
        `INSERT INTO record_values(record_id, field_id, value, source, confidence)
         VALUES (?, ?, ?, 'manual', 1.0)`
      ).run(record_id, field_id, new_value ?? null);
    }
    db.prepare(
      `INSERT INTO corrections(record_id, field_id, old_value, new_value)
       VALUES (?, ?, ?, ?)`
    ).run(record_id, field_id, oldValue, new_value ?? null);
    // Bump the per-(template, field) corrections counter so the confidence
    // model learns this field is harder than its raw extraction rate.
    const tplRow = db
      .prepare('SELECT template_id FROM records WHERE id = ?')
      .get(record_id);
    if (tplRow) bumpCorrections(tplRow.template_id, field_id, 1);
  });
  tx();
  res.json({ ok: true });
});

router.get('/export.csv', (req, res) => {
  // Validate template ownership if filtering by template_id
  let templateId = req.query.template_id ? Number(req.query.template_id) : undefined;
  if (templateId) {
    const tpl = getTemplate(templateId, req.organization_id);
    if (!tpl) {
      return res.status(404).json({ error: 'Template not found' });
    }
  }

  const filter = {
    template_id: templateId,
    // NOTE: 'organization' TEXT filter removed
    year: req.query.year ? Number(req.query.year) : undefined,
  };
  const records = listRecords(filter, req.organization_id);
  if (records.length === 0) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="records.csv"');
    return res.send('');
  }

  // Compose a single header set across all records for the CSV.
  const fieldNames = new Set();
  for (const r of records) {
    for (const k of Object.keys(r.values)) fieldNames.add(k);
  }
  const fields = [...fieldNames];

  const header = ['document', 'template', 'row', ...fields].map(csvCell).join(',');
  const lines = [header];
  for (const r of records) {
    const row = [
      r.original_name || '',
      r.template_name || '',
      r.row_index,
      ...fields.map((f) => r.values[f]?.value ?? ''),
    ];
    lines.push(row.map(csvCell).join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="records.csv"');
  res.send(lines.join('\n'));
});

router.get('/documents', (req, res) => {
  const filter = {
    template_id: req.query.template_id ? Number(req.query.template_id) : undefined,
    status: req.query.status || undefined,
  };

  // Validate template ownership if provided
  if (filter.template_id) {
    const tpl = getTemplate(filter.template_id, req.organization_id);
    if (!tpl) {
      return res.status(404).json({ error: 'Template not found' });
    }
  }

  const docs = listDocuments(filter, req.organization_id);
  res.json(docs);
});

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}


// Per-(template, field) stats. Used by the Templates page accuracy badges
// and the Review queue to threshold low-accuracy fields.
router.get('/field-stats', (req, res) => {
  const templateId = req.query.template_id ? Number(req.query.template_id) : null;
  if (!templateId) return res.status(400).json({ error: 'template_id is required' });
  try {
    const rows = getFieldStats(templateId, req.organization_id).map((r) => ({
      ...r,
      accuracy: fieldAccuracy(r),
    }));
    res.json(rows);
  } catch (err) {
    if (err.message.includes('unauthorized')) {
      return res.status(404).json({ error: 'Template not found' });
    }
    throw err;
  }
});

// Review queue: records with at least one cell below `threshold` confidence.
// Highest-impact records (most low-confidence cells) come first.
router.get('/review-queue', (req, res) => {
  const threshold = req.query.threshold ? Number(req.query.threshold) : 0.7;
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const templateFilter = req.query.template_id ? Number(req.query.template_id) : null;

  // Validate template ownership if provided
  if (templateFilter) {
    const tpl = getTemplate(templateFilter, req.organization_id);
    if (!tpl) {
      return res.status(404).json({ error: 'Template not found' });
    }
  }

  const records = listRecords({ template_id: templateFilter }, req.organization_id);
  const flagged = [];
  for (const r of records) {
    const lows = Object.entries(r.values || {})
      .filter(([, v]) => v && (v.confidence ?? 0) < threshold)
      .map(([name, v]) => ({ field_name: name, ...v }));
    if (lows.length === 0) continue;
    flagged.push({
      id: r.id,
      document_id: r.document_id,
      template_id: r.template_id,
      template_name: r.template_name,
      original_name: r.original_name,
      row_index: r.row_index,
      record_confidence: r.confidence,
      values: r.values,
      low_confidence_fields: lows,
    });
  }
  flagged.sort((a, b) => b.low_confidence_fields.length - a.low_confidence_fields.length);
  res.json({ threshold, total: flagged.length, items: flagged.slice(0, limit) });
});


// Propose other records that probably should also receive this correction.
// We look in the same DOCUMENT for records whose:
//   - field is currently empty / null OR equals the corrected record's old value, AND
//   - source_text contains the new value as a substring (so we can verify it).
// Returns candidate records the UI can confirm before applying.
router.post('/corrections/propose-propagation', (req, res) => {
  const { record_id, field_id, new_value } = req.body || {};
  if (!record_id || !field_id || new_value == null || new_value === '') {
    return res.json({ candidates: [] });
  }
  // The just-corrected record (its document_id, template_id) anchors the
  // search to the same import.
  const anchor = db
    .prepare(`
      SELECT r.id, r.document_id, r.template_id FROM records r
      JOIN documents d ON d.id = r.document_id
      WHERE r.id = ? AND d.organization_id = ?
    `)
    .get(Number(record_id), req.organization_id);
  if (!anchor) return res.json({ candidates: [] });

  const needle = String(new_value).toLowerCase();
  const others = db
    .prepare(
      `SELECT r.id, r.row_index, r.source_text,
              rv.value AS current_value, rv.confidence AS current_confidence
         FROM records r
         LEFT JOIN record_values rv ON rv.record_id = r.id AND rv.field_id = ?
        WHERE r.document_id = ?
          AND r.id != ?`
    )
    .all(Number(field_id), anchor.document_id, Number(record_id));

  const candidates = [];
  for (const o of others) {
    const txt = String(o.source_text || '').toLowerCase();
    if (!txt.includes(needle)) continue;
    // Skip rows where the current value already exactly matches.
    if (String(o.current_value ?? '').toLowerCase() === needle) continue;
    candidates.push({
      record_id: o.id,
      row_index: o.row_index,
      current_value: o.current_value,
      current_confidence: o.current_confidence,
      source_text_excerpt: excerptAround(o.source_text, needle, 60),
    });
  }
  res.json({ candidates });
});

function excerptAround(text, needle, pad = 40) {
  if (!text) return '';
  const lc = text.toLowerCase();
  const idx = lc.indexOf(needle.toLowerCase());
  if (idx < 0) return text.slice(0, pad * 2);
  const start = Math.max(0, idx - pad);
  const end = Math.min(text.length, idx + needle.length + pad);
  return (start > 0 ? '… ' : '') + text.slice(start, end) + (end < text.length ? ' …' : '');
}

// Apply the same correction to multiple records at once. Body:
//   { record_ids: [N, ...], field_id, new_value }
router.post('/corrections/batch-apply', (req, res) => {
  const { record_ids, field_id, new_value } = req.body || {};
  if (!Array.isArray(record_ids) || record_ids.length === 0 || !field_id) {
    return res.status(400).json({ error: 'record_ids[] and field_id required' });
  }

  // Verify all records belong to user's organization
  const placeholders = record_ids.map(() => '?').join(',');
  const ownershipCheck = db.prepare(`
    SELECT COUNT(*) as count FROM records r
    JOIN documents d ON d.id = r.document_id
    WHERE r.id IN (${placeholders})
    AND d.organization_id = ?
  `).get(...record_ids.map(Number), req.organization_id);

  if (ownershipCheck.count !== record_ids.length) {
    return res.status(403).json({ error: 'Cannot modify records from other organizations' });
  }

  const upsert = db.prepare(
    `INSERT INTO record_values(record_id, field_id, value, source, confidence)
     VALUES (?, ?, ?, 'manual', 1.0)
     ON CONFLICT(record_id, field_id) DO UPDATE SET
       value = excluded.value, source = excluded.source, confidence = excluded.confidence`
  );
  const insertCorrection = db.prepare(
    `INSERT INTO corrections(record_id, field_id, old_value, new_value)
     VALUES (?, ?, ?, ?)`
  );
  const getOld = db.prepare(
    `SELECT value FROM record_values WHERE record_id = ? AND field_id = ?`
  );
  const getTemplate = db.prepare(
    `SELECT template_id FROM records WHERE id = ?`
  );

  let applied = 0;
  const tx = db.transaction(() => {
    for (const rid of record_ids) {
      const id = Number(rid);
      const oldRow = getOld.get(id, Number(field_id));
      const oldVal = oldRow?.value ?? null;
      upsert.run(id, Number(field_id), new_value);
      insertCorrection.run(id, Number(field_id), oldVal, new_value);
      const t = getTemplate.get(id);
      if (t) bumpCorrections(t.template_id, Number(field_id), 1);
      applied++;
    }
  });
  tx();
  res.json({ ok: true, applied });
});


// Promote a corrected record into a new training sample. The engine's
// multi-sample picker (T1.A) then evaluates this sample alongside any
// existing ones; if its column / token layout works on more rows, it wins.
//
// Body: { record_id }
// Returns: { ok, sample_id?, mappings_added?, reason? }
router.post('/corrections/learn', async (req, res, next) => {
  try {
    const { record_id } = req.body || {};
    if (!record_id) return res.status(400).json({ error: 'record_id required' });

    const record = db
      .prepare(`
        SELECT r.id, r.document_id, r.template_id, r.row_index, r.source_text
        FROM records r
        JOIN documents d ON d.id = r.document_id
        WHERE r.id = ? AND d.organization_id = ?
      `)
      .get(Number(record_id), req.organization_id);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    if (!record.source_text) return res.json({ ok: false, reason: 'no_source_text' });

    // All current values for this record (incl. manual corrections that
    // already overwrote auto-extracted values).
    const values = db
      .prepare(
        `SELECT rv.field_id, rv.value, f.name AS field_name, f.label AS field_label, f.type AS field_type
           FROM record_values rv
           JOIN fields f ON f.id = rv.field_id
          WHERE rv.record_id = ? AND rv.value IS NOT NULL AND rv.value != ''`
      )
      .all(Number(record_id));
    if (values.length < 2) return res.json({ ok: false, reason: 'not_enough_values' });

    const doc = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(record.document_id);
    if (!doc) return res.json({ ok: false, reason: 'document_missing' });

    // Re-parse the document so we can compute canonical columns and find
    // each value's canonical column index + token range.
    const path = await import('node:path');
    const filePath = path.isAbsolute(doc.file_path)
      ? doc.file_path
      : path.join(UPLOADS_DIR, doc.file_path);
    const { extractText, inferPageColumns, snapToColumns } = await import('../extraction/pdfText.js');
    const parsed = await extractText(filePath);

    const matchingLine = parsed.lines.find((l) => l.text === record.source_text)
      || parsed.lines.find((l) => l.text.includes(record.source_text.slice(0, 50)));
    if (!matchingLine) return res.json({ ok: false, reason: 'row_not_found_after_reparse' });

    const linesOnPage = parsed.lines.filter((l) => l.pageIndex === matchingLine.pageIndex);
    const ranges = inferPageColumns(linesOnPage);
    const cols = ranges.length > 0 ? snapToColumns(matchingLine, ranges) : [];

    // For each known value, find which canonical column it sits in and the
    // contiguous token range within that cell.
    const newMappings = [];
    for (const v of values) {
      const target = String(v.value).trim();
      if (!target) continue;
      let found = null;
      for (let ci = 0; ci < cols.length; ci++) {
        const cellTxt = cols[ci].text || '';
        const tokens = cellTxt.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) continue;
        const lc = target.toLowerCase();
        // Find the smallest contiguous token slice that includes the value.
        let bestStart = -1, bestEnd = -1;
        for (let s = 0; s < tokens.length; s++) {
          for (let e = s; e < tokens.length; e++) {
            const slice = tokens.slice(s, e + 1).join(' ').toLowerCase();
            if (slice.includes(lc)) {
              if (bestStart < 0 || (e - s) < (bestEnd - bestStart)) {
                bestStart = s; bestEnd = e;
              }
              break;
            }
          }
        }
        if (bestStart >= 0) {
          found = { column_index: ci, token_start: bestStart, token_end: bestEnd };
          break;
        }
      }
      if (!found) continue;
      newMappings.push({
        field_id: v.field_id,
        selection_text: target,
        column_index: found.column_index,
        token_start: found.token_start,
        token_end: found.token_end,
      });
    }
    if (newMappings.length < 2) {
      return res.json({ ok: false, reason: 'could_not_locate_enough_fields', located: newMappings.length });
    }

    // Save as a brand-new training_sample so the engine treats it as
    // additional evidence (does not replace existing mappings).
    const insertSample = db.prepare(
      `INSERT INTO training_samples(template_id, file_path, original_name)
       VALUES (?, ?, ?)`
    );
    const sampleId = insertSample.run(
      record.template_id,
      doc.file_path,
      (doc.original_name || 'document') + ' (from correction)'
    ).lastInsertRowid;

    const insertMapping = db.prepare(
      `INSERT INTO training_mappings
         (sample_id, field_id, selection_text, prototype_line_text, column_index,
          token_start, token_end, line_index, page_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = db.transaction(() => {
      for (const m of newMappings) {
        insertMapping.run(
          sampleId, m.field_id, m.selection_text, matchingLine.text,
          m.column_index, m.token_start, m.token_end,
          matchingLine.lineIndex, matchingLine.pageIndex
        );
      }
    });
    tx();

    // How many other documents share this template — so the UI can offer
    // "re-extract all N files" as an option.
    const otherDocs = db
      .prepare(
        `SELECT COUNT(*) AS n FROM documents WHERE template_id = ? AND id != ?`
      )
      .get(record.template_id, record.document_id).n;

    res.json({
      ok: true,
      sample_id: sampleId,
      mappings_added: newMappings.length,
      document_id: record.document_id,
      template_id: record.template_id,
      other_documents: otherDocs,
    });
  } catch (err) {
    next(err);
  }
});


// Source-highlight endpoint. Given a record, re-parse the source PDF, find
// the line that produced the record, compute per-cell bounding boxes from
// the page-level canonical column layout, and return:
//   { file_url, page, page_size: {w, h}, line_text, boxes: [{field_name, value, x, y, w, h}] }
//
// The client uses this to render the PDF page with highlighted regions.
router.get('/records/:id/source', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const record = db
      .prepare(
        `SELECT r.id, r.document_id, r.template_id, r.row_index, r.source_text,
                d.file_path, d.original_name
           FROM records r JOIN documents d ON d.id = r.document_id
          WHERE r.id = ? AND d.organization_id = ?`
      )
      .get(id, req.organization_id);
    if (!record) return res.status(404).json({ error: 'Record not found' });

    const path = await import('node:path');
    const filePath = path.isAbsolute(record.file_path)
      ? record.file_path
      : path.join(UPLOADS_DIR, record.file_path);

    const { extractText, inferPageColumns, snapToColumns } = await import('../extraction/pdfText.js');
    const parsed = await extractText(filePath);

    // Locate the matching line.
    let line = null;
    if (record.source_text) {
      line = parsed.lines.find((l) => l.text === record.source_text)
          || parsed.lines.find((l) => l.text.includes(record.source_text.slice(0, 50)));
    }
    if (!line) {
      return res.json({
        file_url: '/files/uploads/' + record.file_path,
        original_name: record.original_name,
        page: 0,
        boxes: [],
        warning: 'Source line not found after re-parse.',
      });
    }

    // Approximate page size: use the max x+width and max y across all items
    // on this page. Good enough for relative overlay positioning; the client
    // can use pdfjs's actual viewport once the page renders.
    const linesOnPage = parsed.lines.filter((l) => l.pageIndex === line.pageIndex);
    const ranges = inferPageColumns(linesOnPage);
    const cols = ranges.length > 0 ? snapToColumns(line, ranges) : [];

    // Compute bbox per training-mapped field by intersecting line.items with
    // the canonical column range and the saved token range.
    const tplFields = db
      .prepare('SELECT id, name, label, type FROM fields WHERE template_id = ? ORDER BY sort_order, id')
      .all(record.template_id);
    const fieldsById = new Map(tplFields.map((f) => [f.id, f]));

    const mappings = db
      .prepare(
        `SELECT tm.* FROM training_mappings tm
           JOIN training_samples ts ON ts.id = tm.sample_id
          WHERE ts.template_id = ?`
      )
      .all(record.template_id);

    // Group mappings by field_id, keep the most recent one (highest id).
    const latest = new Map();
    for (const m of mappings) {
      const cur = latest.get(m.field_id);
      if (!cur || m.id > cur.id) latest.set(m.field_id, m);
    }

    const values = db
      .prepare(`SELECT field_id, value FROM record_values WHERE record_id = ?`)
      .all(id);
    const valueByField = new Map(values.map((v) => [v.field_id, v.value]));

    const boxes = [];
    for (const m of latest.values()) {
      if (m.column_index == null) continue;
      const range = ranges[m.column_index];
      if (!range) continue;
      // Items in this column on this line.
      const items = (line.items || []).filter((it) => {
        const mid = it.x + (it.width || 0) / 2;
        return mid >= range.x && mid < range.end;
      });
      if (items.length === 0) continue;
      // Apply token range slicing within the cell.
      const tStart = m.token_start ?? 0;
      const tEnd = m.token_end ?? items.length - 1;
      const slice = items.slice(tStart, tEnd + 1);
      if (slice.length === 0) continue;
      const x = Math.min(...slice.map((i) => i.x));
      const y = Math.min(...slice.map((i) => i.y));
      const right = Math.max(...slice.map((i) => i.x + (i.width || 0)));
      const top = Math.max(...slice.map((i) => i.y + (i.height || 10)));
      boxes.push({
        field_id: m.field_id,
        field_name: fieldsById.get(m.field_id)?.name,
        field_label: fieldsById.get(m.field_id)?.label,
        value: valueByField.get(m.field_id),
        x, y, w: right - x, h: top - y,
      });
    }

    res.json({
      file_url: '/files/uploads/' + record.file_path,
      original_name: record.original_name,
      page: line.pageIndex,
      line_index: line.lineIndex,
      line_text: line.text,
      boxes,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
