// Bulk PDF import.
//
// Extraction priority for each file:
//   0. learned patterns          — free, applied when template has them
//   1. deterministic engine      — free, for manual templates with mappings
//   2. AI vision (last resort)   — costs $$, requires ai_confirmed=1 unless
//                                  the template's strategy is ai_vision
//
// When pattern + deterministic both return 0 records AND the template has
// an ai_prompt, the import returns 402 Payment Required with the list of
// files that would need AI + the estimated cost. The client shows a confirm
// dialog and re-submits with ai_confirmed=1.
//
// After a successful AI vision run, any updated learned_patterns the model
// produced are MERGED into template.learned_patterns so the next similar
// PDF can be extracted free.
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { db, UPLOADS_DIR, getTemplate, listDocuments, saveExtraction } from '../db.js';
import { extractFromFile } from '../extraction/extractor.js';
import { extractByLearnedPatterns, mergeLearnedPatterns } from '../extraction/patternExtract.js';
import { visionRescueWithAI } from '../ai/index.js';

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-z0-9.\-_]/gi, '_');
      cb(null, `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function loadTemplate(templateId, organizationId) {
  const template = getTemplate(templateId, organizationId);
  if (!template) return null;
  template.mappings = db
    .prepare(
      `SELECT tm.* FROM training_mappings tm
        JOIN training_samples ts ON ts.id = tm.sample_id
        WHERE ts.template_id = ? AND ts.organization_id = ?`
    )
    .all(templateId, organizationId);
  return template;
}

// Cost rough-cut for the UI's confirm dialog.
const COST_PER_PDF_USD = 0.5;

router.post('/:templateId', upload.array('files', 25), async (req, res, next) => {
  try {
    const templateId = Number(req.params.templateId);
    const template = loadTemplate(templateId, req.organization_id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'no files uploaded' });

    const explicitVision = req.query.ai_vision === '1' || req.body?.ai_vision === '1';
    const aiConfirmed   = req.query.ai_confirmed === '1' || req.body?.ai_confirmed === '1';
    const templateVision = template.extraction_strategy === 'ai_vision';

    // --- PASS A: dry-run patterns / deterministic per file ------------------
    // We figure out which files free paths can handle, and which would need
    // AI. If any need AI and the user hasn't confirmed, we return 402 before
    // making any AI calls.
    console.log(`[imports] template ${templateId} strategy=${template.extraction_strategy} learned_patterns=${template.learned_patterns ? 'present' : 'EMPTY'}`);
    const plan = [];
    for (const f of files) {
      let preExtracted = null;
      // Patterns first (free).
      if (template.learned_patterns) {
        try {
          const pr = await extractByLearnedPatterns(f.path, template);
          console.log(`[imports] pattern dry-run for ${f.originalname}: ${pr.records.length} records (reason=${pr.reason}, anchors=${pr.anchors ?? 0})`);
          if (pr.records.length > 0) preExtracted = { records: pr.records, mode: 'pattern' };
        } catch (e) {
          console.warn(`[imports] pattern dry-run threw for ${f.originalname}: ${e.message || e}`);
        }
      } else {
        console.log(`[imports] no learned_patterns saved on template ${templateId} — patterns path skipped.`);
      }
      // If patterns failed and template isn't AI-only, try deterministic.
      if (!preExtracted && !templateVision && !explicitVision) {
        try {
          const det = await extractFromFile(f.path, template);
          if ((det?.records?.length ?? 0) > 0) preExtracted = { records: det.records, mode: 'text', det };
        } catch (e) {
          console.warn(`[imports] deterministic dry-run failed for ${f.originalname}: ${e.message || e}`);
        }
      }
      plan.push({ file: f, preExtracted });
    }

    const filesNeedingAI = plan.filter((p) => !p.preExtracted);
    const aiAllowed = aiConfirmed || templateVision || explicitVision;
    if (filesNeedingAI.length > 0 && !aiAllowed) {
      // No AI calls have been made yet. Return 402 so the client can confirm.
      const cost = +(filesNeedingAI.length * COST_PER_PDF_USD).toFixed(2);
      return res.status(402).json({
        error: `${filesNeedingAI.length} file${filesNeedingAI.length === 1 ? '' : 's'} need AI extraction.`,
        requires_ai: true,
        files_needing_ai: filesNeedingAI.map((p) => p.file.originalname),
        files_free: plan.filter((p) => p.preExtracted).map((p) => p.file.originalname),
        estimated_cost_usd: cost,
        message: `Resubmit with ai_confirmed=1 to proceed.`,
      });
    }

    // --- PASS B: persist records, calling AI only where required -----------
    const batchId = db.prepare(
      `INSERT INTO batches(template_id, name, doc_count, status, organization_id)
       VALUES (?, ?, ?, 'processing', ?)`
    ).run(templateId, req.body?.name || `Import ${new Date().toISOString()}`, files.length, req.organization_id).lastInsertRowid;

    const docInsert = db.prepare(
      `INSERT INTO documents(template_id, batch_id, file_path, original_name, status, organization_id)
       VALUES (?, ?, ?, ?, 'processing', ?)`
    );

    const documents = [];
    let okCount = 0;
    let needsOcr = 0;
    let failed = 0;
    let aggregatedFreshPatterns = null;

    for (const p of plan) {
      const f = p.file;
      const docId = docInsert.run(
        templateId, batchId, path.relative(UPLOADS_DIR, f.path), f.originalname, req.organization_id
      ).lastInsertRowid;

      try {
        let result;
        if (p.preExtracted) {
          if (p.preExtracted.mode === 'pattern') {
            result = {
              records: p.preExtracted.records,
              warnings: [`Extracted via learned patterns (${p.preExtracted.records.length} records, $0.00).`],
              mode: 'pattern',
            };
          } else {
            result = p.preExtracted.det;
            result.warnings = [...(result.warnings || []), 'Extracted via deterministic engine ($0.00).'];
          }
        } else {
          // AI vision path (user has confirmed, or template is ai_vision-only).
          const hint = template.ai_prompt || '';
          const r = await visionRescueWithAI(f.path, template, { templateId, documentId: docId, hint });
          if (r.skipped) throw new Error(`AI vision unavailable (${r.skipped}).`);
          const warnings = [`Extracted via AI vision (cost $${(r.usage?.costUsd ?? 0).toFixed(4)}).`];
          if (r.truncated) warnings.push(`Warning: AI output reached the token limit after ${r.records.length} records.`);
          result = { records: r.records, warnings, mode: 'ai_vision' };
          if (r.learned_patterns) {
            aggregatedFreshPatterns = mergeLearnedPatterns(aggregatedFreshPatterns, r.learned_patterns);
          }
        }
        saveExtraction(docId, templateId, result, req.organization_id);
        if (result.needsOcr) needsOcr++; else okCount++;
        documents.push({ id: docId, status: result.needsOcr ? 'needs_ocr' : 'done', mode: result.mode });
      } catch (err) {
        failed++;
        db.prepare(`UPDATE documents SET status='failed', error_message=? WHERE id=?`)
          .run(String(err.message || err), docId);
        documents.push({ id: docId, status: 'failed', error: String(err.message || err) });
      }
    }

    const finalStatus =
      failed === files.length ? 'failed' :
      failed > 0 || needsOcr > 0 ? 'partial' : 'done';
    db.prepare(`UPDATE batches SET status=?, finished_at=datetime('now') WHERE id=?`).run(finalStatus, batchId);

    // Merge fresh patterns into the template ONLY if they actually work.
    // Validate: run the fresh patterns over each file that needed AI; if
    // they extract >= 50% of the records the AI just got on that file,
    // merge into the saved learned_patterns. Otherwise discard — useless
    // patterns just pollute the template.
    if (aggregatedFreshPatterns) {
      const candidate = { fields: template.fields, learned_patterns: aggregatedFreshPatterns };
      let aiRecordsTotal = 0;
      let patternRecordsTotal = 0;
      for (let i = 0; i < plan.length; i++) {
        const p = plan[i];
        if (p.preExtracted) continue; // this file used a free path, irrelevant
        const doc = documents[i];
        if (!doc || doc.status !== 'done') continue;
        try {
          const r = await extractByLearnedPatterns(p.file.path, candidate);
          // Compare to whatever this file ended up saving (AI vision count).
          const aiCount = db.prepare(
            'SELECT COUNT(*) AS n FROM records WHERE document_id = ?'
          ).get(doc.id).n;
          aiRecordsTotal += aiCount;
          patternRecordsTotal += r.records.length;
        } catch (e) {
          console.warn(`[imports] pattern validation error on doc ${doc?.id}: ${e.message || e}`);
        }
      }
      const ratio = aiRecordsTotal > 0 ? patternRecordsTotal / aiRecordsTotal : 0;
      console.log(`[imports] fresh-pattern validation: ${patternRecordsTotal}/${aiRecordsTotal} records (${(ratio * 100).toFixed(0)}%).`);
      if (ratio >= 0.5) {
        const merged = mergeLearnedPatterns(template.learned_patterns, aggregatedFreshPatterns);
        db.prepare(
          `UPDATE templates SET learned_patterns = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(JSON.stringify(merged), templateId);
        console.log(`[imports] template ${templateId} learned_patterns updated from AI fallback (validated).`);
      } else {
        console.log(`[imports] discarded fresh patterns — validation under 50%. Template kept unchanged.`);
      }
    }

    res.status(201).json({
      batch_id: batchId,
      status: finalStatus,
      total: files.length,
      ok: okCount,
      needs_ocr: needsOcr,
      failed,
      documents,
      patterns_updated: !!aggregatedFreshPatterns,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/batches', (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.*, t.name AS template_name
         FROM batches b
         JOIN templates t ON t.id = b.template_id
         WHERE b.organization_id = ?
         ORDER BY b.created_at DESC`
    )
    .all(req.organization_id);
  res.json(rows);
});

router.get('/batches/:id', (req, res) => {
  const id = Number(req.params.id);
  const batch = db.prepare('SELECT * FROM batches WHERE id = ? AND organization_id = ?').get(id, req.organization_id);
  if (!batch) return res.status(404).json({ error: 'Not found' });
  batch.documents = listDocuments({ batch_id: id }, req.organization_id);
  res.json(batch);
});

// Re-extract a single document. Used by the post-correction "Re-extract this
// file" flow. Manual corrections (source = 'manual') are preserved across
// the re-extraction.
async function reextractDocument(docId, organizationId) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND organization_id = ?').get(docId, organizationId);
  if (!doc) throw new Error('Document not found');
  const template = loadTemplate(doc.template_id, organizationId);
  if (!template) throw new Error('Template not found');
  const manuals = db
    .prepare(
      `SELECT r.row_index, rv.field_id, rv.value
         FROM record_values rv
         JOIN records r ON r.id = rv.record_id
        WHERE r.document_id = ? AND rv.source = 'manual'`
    )
    .all(docId);
  const filePath = path.isAbsolute(doc.file_path)
    ? doc.file_path
    : path.join(UPLOADS_DIR, doc.file_path);
  let result = null;
  // Try patterns first
  if (template.learned_patterns) {
    try {
      const pr = await extractByLearnedPatterns(filePath, template);
      if (pr.records.length > 0) {
        result = { records: pr.records, warnings: [`Re-extracted via learned patterns ($0.00).`], mode: 'pattern' };
      }
    } catch (_) {}
  }
  if (!result) {
    if (template.extraction_strategy === 'ai_vision') {
      const r = await visionRescueWithAI(filePath, template, {
        templateId: template.id, documentId: docId, hint: template.ai_prompt || '',
      });
      if (r.skipped) throw new Error(`AI vision unavailable (${r.skipped}).`);
      result = { records: r.records, warnings: [`Re-extracted via AI vision (cost $${(r.usage?.costUsd ?? 0).toFixed(4)}).`], mode: 'ai_vision' };
    } else {
      result = await extractFromFile(filePath, template, { documentId: docId });
    }
  }
  saveExtraction(docId, doc.template_id, result, organizationId);
  if (manuals.length > 0) {
    const upsert = db.prepare(
      `INSERT INTO record_values(record_id, field_id, value, source, confidence)
       VALUES (?, ?, ?, 'manual', 1.0)
       ON CONFLICT(record_id, field_id) DO UPDATE SET
         value = excluded.value, source = excluded.source, confidence = excluded.confidence`
    );
    const rowMap = new Map(
      db.prepare('SELECT id, row_index FROM records WHERE document_id = ?').all(docId).map((r) => [r.row_index, r.id])
    );
    for (const m of manuals) {
      const rid = rowMap.get(m.row_index);
      if (rid) upsert.run(rid, m.field_id, m.value);
    }
  }
  return { records: result.records.length, manuals_preserved: manuals.length };
}

router.post('/documents/:id/reextract', async (req, res, next) => {
  try {
    const docId = Number(req.params.id);
    const r = await reextractDocument(docId, req.organization_id);
    res.json({ ok: true, ...r });
  } catch (err) { next(err); }
});

router.post('/templates/:id/reextract', async (req, res, next) => {
  try {
    const templateId = Number(req.params.id);
    // Validate template ownership
    const template = getTemplate(templateId, req.organization_id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const docs = db
      .prepare('SELECT id FROM documents WHERE template_id = ? AND organization_id = ? AND status IN (?, ?)')
      .all(templateId, req.organization_id, 'done', 'partial');
    let total = 0;
    let preserved = 0;
    for (const d of docs) {
      try {
        const r = await reextractDocument(d.id, req.organization_id);
        total += r.records;
        preserved += r.manuals_preserved;
      } catch (_) { /* skip */ }
    }
    res.json({ ok: true, documents_reextracted: docs.length, records_total: total, manuals_preserved: preserved });
  } catch (err) { next(err); }
});

export default router;
