// AI-assisted template creation routes.
//
//   POST /api/ai/suggest-template      legacy: text-only suggestion
//   POST /api/ai/onboard/analyze       upload 1-3 PDFs + optional user prompt;
//                                      AI proposes template + extracts sample
//                                      records + composes a per-template
//                                      extraction prompt the user can edit.
//   POST /api/ai/onboard/confirm       persist the (possibly edited) template
//                                      with extraction_strategy='ai_vision' and
//                                      run a first batch on the uploaded PDFs.
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import {
  db, UPLOADS_DIR, createTemplate, getTemplate, saveExtraction,
} from '../db.js';
import {
  suggestTemplateWithAI,
  visionRescueWithAI,
  analyzePdfForOnboardingWithAI,
  aiStatus,
} from '../ai/index.js';
import { extractText } from '../extraction/pdfText.js';
import { backMapAIRecords } from '../extraction/backMap.js';
import { extractByLearnedPatterns } from '../extraction/patternExtract.js';

const router = express.Router();

// Memory storage for the legacy suggest endpoint (no PDF persistence needed).
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 3 },
});

// Disk storage for the wizard so the same files can be re-used on confirm
// without a second upload.
const diskUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-z0-9.\-_]/gi, '_');
      cb(null, `onboard_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 3 },
});

function composeExtractionPrompt({ userPrompt, fields, name }) {
  const fieldLines = fields
    .map((f) => `  - ${f.name} (${f.type})${f.is_primary ? ' [primary]' : ''}${f.label ? ' — ' + f.label : ''}`)
    .join('\n');
  const lines = [
    `Template: ${name || 'Untitled'}`,
    '',
    'Extract every data record from this PDF. Read in visual top-to-bottom order.',
    'Skip headers, totals, footers, and producer-summary lines — only true data rows.',
    '',
    'Fields to extract:',
    fieldLines,
  ];
  if (userPrompt && userPrompt.trim()) {
    lines.push('', 'Additional instructions from the user:', userPrompt.trim());
  }
  return lines.join('\n');
}

// --- Legacy suggest-template (kept for backward compat) ---------------------
router.post('/suggest-template', memUpload.array('files', 3), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'Upload 1-3 PDFs.' });

    const samples = [];
    for (const f of files) {
      const os = await import('node:os');
      const tmp = path.join(os.tmpdir(), `docu_${Date.now()}_${f.originalname.replace(/[^a-z0-9.\-_]/gi, '_')}`);
      fs.writeFileSync(tmp, f.buffer);
      try {
        const parsed = await extractText(tmp);
        const text = parsed.lines.map((l) => l.text).join('\n');
        samples.push({ name: f.originalname, text });
      } finally {
        try { fs.unlinkSync(tmp); } catch {}
      }
    }

    const ai = await suggestTemplateWithAI(samples, { organizationId: req.organization_id });
    if (ai.skipped) {
      return res.status(400).json({
        error: 'AI is not configured. Visit Settings to enable AI.',
        skipped: ai.skipped,
      });
    }
    res.json({ samples_used: samples.length, ...ai });
  } catch (err) { next(err); }
});

// --- Onboarding wizard: analyze ---------------------------------------------
//
// Vision-first flow:
//   1. Send the first PDF + user hint to the LLM (vision). One call returns
//      both a proposed template AND a first batch of extracted records.
//      This is the path that handles hostile / scanned PDFs (BCBS-style).
//   2. If the vision call yields no fields (very rare — model refused, or
//      provider doesn't support vision), fall back to text excerpts via
//      suggestTemplateWithAI.
router.post('/onboard/analyze', diskUpload.array('files', 3), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'Upload 1-3 PDFs.' });

    const userPrompt = (req.body?.prompt || '').toString().slice(0, 2000);
    const userName   = (req.body?.name || '').toString().slice(0, 200);
    console.log(`[onboard/analyze] ${files.length} file(s), prompt=${userPrompt.length}ch, name="${userName}"`);

    let tmpl = {};
    let proposedFields = [];
    let sampleRecords = [];
    let visionUsage = null;
    let proposalUsage = null;
    let visionWarning = null;
    let learnedPatterns = null;
    const status = aiStatus({ organizationId: req.organization_id });

    // Helper: detect Anthropic's usage-limit message so we can short-circuit
    // both calls with a clear error instead of bubbling a generic 500.
    function isUsageLimit(errMessage) {
      const s = String(errMessage || '');
      return /usage limits|monthly limit|spend(ing)? limit|usage cap/i.test(s)
        || /regain access on \d{4}-\d{2}-\d{2}/i.test(s);
    }

    // 1) Vision-first analysis on the FIRST PDF.
    console.log(`[onboard/analyze] vision analyze: ${files[0].originalname}`);
    const analyzed = await analyzePdfForOnboardingWithAI(files[0].path, userPrompt, { organizationId: req.organization_id });
    if (analyzed.skipped) {
      console.warn(`[onboard/analyze] vision skipped=${analyzed.skipped} error=${analyzed.error || 'n/a'}`);
      // Special-case: Anthropic spending cap reached. No point in falling
      // back to the text-based suggester — it'll hit the same 400.
      if (isUsageLimit(analyzed.error)) {
        return res.status(402).json({
          error: 'Anthropic API usage limit reached. Increase your monthly limit at console.anthropic.com → Settings → Limits, or wait for it to reset.',
          skipped: 'usage_limit',
          detail: analyzed.error,
        });
      }
      // Special-case: our internal monthly budget cap was hit.
      if (analyzed.skipped === 'budget_exceeded') {
        return res.status(402).json({
          error: 'Monthly AI budget cap reached. Increase the budget in Settings → AI → Monthly budget (USD), then retry.',
          skipped: 'budget_exceeded',
        });
      }
      visionWarning = `Vision analysis ${analyzed.skipped}${analyzed.error ? ' — ' + analyzed.error : ''}`;
    } else {
      tmpl = analyzed.template || {};
      proposedFields = Array.isArray(tmpl.fields)
        ? tmpl.fields.filter((f) => f && typeof f === 'object' && typeof f.name === 'string')
        : [];
      sampleRecords = (analyzed.records || []).slice(0, 12).map((rec) => ({
        values: rec.values || {},
        confidence: rec.confidence ?? 0.85,
      }));
      visionUsage = analyzed.usage || null;
      learnedPatterns = analyzed.learned_patterns || null;
      console.log(`[onboard/analyze] vision returned ${proposedFields.length} field(s), ${sampleRecords.length} record(s), patterns=${learnedPatterns ? 'yes' : 'no'}`);
    }

    // 2) Text-based fallback if vision produced no usable fields.
    if (proposedFields.length === 0) {
      console.log(`[onboard/analyze] falling back to text-based suggestTemplate`);
      const samples = [];
      for (const f of files) {
        try {
          const parsed = await extractText(f.path);
          const text = parsed.lines.map((l) => l.text).join('\n');
          samples.push({ name: f.originalname, text });
          console.log(`[onboard/analyze] extracted ${text.length}ch from ${f.originalname}`);
        } catch (e) {
          samples.push({ name: f.originalname, text: '(text extraction failed; PDF likely scanned)' });
          console.warn(`[onboard/analyze] text extraction failed for ${f.originalname}: ${e.message || e}`);
        }
      }
      const samplesWithHint = userPrompt
        ? [{ name: 'user_guidance', text: `User instructions: ${userPrompt}` }, ...samples]
        : samples;
      const proposal = await suggestTemplateWithAI(samplesWithHint, { organizationId: req.organization_id });
      if (proposal.skipped) {
        const detail = proposal.error ? ` Reason: ${proposal.error}` : '';
        console.warn(`[onboard/analyze] suggestTemplate skipped=${proposal.skipped}${detail}`);
        if (isUsageLimit(proposal.error)) {
          return res.status(402).json({
            error: 'Anthropic API usage limit reached. Increase your monthly limit at console.anthropic.com → Settings → Limits, or wait for it to reset.',
            skipped: 'usage_limit',
            detail: proposal.error,
          });
        }
        if (proposal.skipped === 'budget_exceeded') {
          return res.status(402).json({
            error: 'Monthly AI budget cap reached. Increase the budget in Settings → AI → Monthly budget (USD), then retry.',
            skipped: 'budget_exceeded',
          });
        }
        return res.status(400).json({
          error: proposal.skipped === 'no_provider'
            ? 'AI is not configured. Open Settings → AI to add your API key.'
            : `AI call failed (${proposal.skipped}).${detail}`,
          skipped: proposal.skipped,
          detail: proposal.error || null,
        });
      }
      tmpl = (proposal && typeof proposal.template === 'object' && proposal.template) || {};
      proposedFields = Array.isArray(tmpl.fields)
        ? tmpl.fields.filter((f) => f && typeof f === 'object' && typeof f.name === 'string')
        : [];
      proposalUsage = proposal.usage || null;
      console.log(`[onboard/analyze] text proposal returned ${proposedFields.length} field(s)`);
    }

    const proposedName = userName || tmpl.name || 'New Template';
    const extractionPrompt = composeExtractionPrompt({
      userPrompt,
      fields: proposedFields,
      name: proposedName,
    });

    res.json({
      proposed_template: {
        name: proposedName,
        organization: tmpl.organization ?? null,
        state: tmpl.state ?? null,
        year: tmpl.year ?? null,
        category: tmpl.category ?? 'Commission Statement',
        fields: proposedFields.map((f, i) => ({
          name: f.name,
          label: f.label || f.name,
          type: ['text', 'number', 'date', 'amount'].includes(f.type) ? f.type : 'text',
          is_primary: !!f.is_primary,
          rationale: f.rationale ?? null,
          sort_order: i,
        })),
      },
      extraction_prompt: extractionPrompt,
      user_prompt: userPrompt,
      sample_records: sampleRecords,
      sample_pdf: files[0].originalname,
      vision_warning: visionWarning,
      learned_patterns: learnedPatterns,
      ai: { provider: status.provider, model: status.model },
      files: files.map((f) => ({
        path: path.relative(UPLOADS_DIR, f.path),
        original_name: f.originalname,
        size: f.size,
      })),
      usage: {
        proposal: proposalUsage,
        vision: visionUsage,
      },
    });
  } catch (err) { next(err); }
});

// --- Onboarding wizard: confirm ---------------------------------------------
router.post('/onboard/confirm', express.json({ limit: '2mb' }), async (req, res, next) => {
  try {
    const {
      template: t,
      ai_prompt,
      ai_provider,
      ai_model,
      learned_patterns,
      files = [],
      import_files = true,
    } = req.body || {};
    if (!t || !t.name || !Array.isArray(t.fields) || t.fields.length === 0) {
      return res.status(400).json({ error: 'Template needs a name and at least one field.' });
    }
    if (!ai_prompt || !ai_prompt.trim()) {
      return res.status(400).json({ error: 'Extraction prompt is required.' });
    }
    const status = aiStatus({ organizationId: req.organization_id });

    const created = createTemplate({
      name: t.name,
      organization: t.organization ?? null,
      state: t.state ?? null,
      category: t.category ?? null,
      year: t.year ?? null,
      notes: t.notes ?? null,
      extraction_strategy: 'ai_vision',
      ai_prompt: ai_prompt,
      ai_provider: ai_provider || status.provider || 'anthropic',
      ai_model: ai_model || status.model || null,
      learned_patterns: learned_patterns || null,
      organizationId: req.organization_id,
      fields: t.fields.map((f, i) => ({
        name: f.name,
        label: f.label || f.name,
        type: f.type || 'text',
        is_primary: !!f.is_primary,
        sort_order: f.sort_order ?? i,
      })),
    });

    let batchId = null;
    let recordsTotal = 0;
    const docs = [];
    if (import_files && files.length > 0) {
      const batchRes = db.prepare(
        `INSERT INTO batches(template_id, name, doc_count, status, organization_id)
         VALUES (?, ?, ?, 'processing', ?)`
      ).run(created.id, `Onboarding ${new Date().toISOString().slice(0, 10)}`, files.length, req.organization_id);
      batchId = batchRes.lastInsertRowid;

      const docInsert = db.prepare(
        `INSERT INTO documents(template_id, batch_id, file_path, original_name, status, organization_id)
         VALUES (?, ?, ?, ?, 'processing', ?)`
      );

      const visionTemplate = {
        fields: created.fields,
        ai_prompt: created.ai_prompt,
      };

      let failed = 0;
      // We capture the AI records + file from the FIRST successful import so
      // we can back-map them into deterministic training mappings below.
      let firstSuccess = null;
      for (const f of files) {
        const relPath = (f.path || '').toString();
        const absPath = path.isAbsolute(relPath) ? relPath : path.join(UPLOADS_DIR, relPath);
        if (!fs.existsSync(absPath)) {
          failed++;
          docs.push({ original_name: f.original_name, status: 'failed', error: 'file missing' });
          continue;
        }
        const docId = docInsert.run(
          created.id, batchId, relPath, f.original_name || path.basename(absPath), req.organization_id
        ).lastInsertRowid;
        try {
          const r = await visionRescueWithAI(absPath, visionTemplate, {
            templateId: created.id, documentId: docId, hint: created.ai_prompt,
          });
          if (r.skipped) throw new Error(`vision skipped: ${r.skipped}${r.error ? ' — ' + r.error : ''}`);
          const result = {
            records: r.records,
            warnings: [`Extracted via AI vision (cost $${(r.usage?.costUsd ?? 0).toFixed(4)}).`],
            mode: 'ai_vision',
          };
          saveExtraction(docId, created.id, result, req.organization_id);
          recordsTotal += r.records.length;
          docs.push({ id: docId, status: 'done', records: r.records.length });
          if (!firstSuccess) {
            firstSuccess = {
              absPath,
              relPath,
              originalName: f.original_name || path.basename(absPath),
              records: r.records,
            };
          }
        } catch (err) {
          failed++;
          db.prepare(`UPDATE documents SET status='failed', error_message=? WHERE id=?`)
            .run(String(err.message || err), docId);
          docs.push({ id: docId, status: 'failed', error: String(err.message || err) });
        }
      }
      const finalStatus = failed === files.length ? 'failed' : (failed > 0 ? 'partial' : 'done');
      db.prepare(`UPDATE batches SET status=?, finished_at=datetime('now') WHERE id=?`)
        .run(finalStatus, batchId);

      // Back-mapping: convert AI records into deterministic training so
      // future imports of similar PDFs run free.
      if (firstSuccess && firstSuccess.records.length > 0) {
        try {
          const flatRecords = firstSuccess.records.map((rec) => {
            const flat = {};
            for (const [k, v] of Object.entries(rec.values || {})) flat[k] = v?.value ?? null;
            return { values: flat };
          });
          const bm = await backMapAIRecords({
            pdfPath: firstSuccess.absPath,
            fields: created.fields,
            aiRecords: flatRecords,
          });
          const ratio = bm.total > 0 ? (bm.anchored / bm.total) : 0;
          console.log(`[onboard/confirm] backmap anchored ${bm.anchored}/${bm.total} (${(ratio * 100).toFixed(0)}%) - ${bm.mappings.length} field mapping(s). Reason: ${bm.reason}`);

          // Strict thresholds: only flip to deterministic when back-mapping
          // anchored ≥80% of records AND recovered mappings for ≥80% of the
          // template's fields. Lower confidence templates (especially
          // hostile PDFs like BCBS) stay on AI vision — the fallback path
          // in routes/imports.js will still try deterministic first on new
          // PDFs but won't trust it.
          const fieldCoverage = bm.mappings.length / Math.max(1, created.fields.length);
          if (ratio >= 0.8 && fieldCoverage >= 0.8) {
            const sampleInsert = db.prepare(
              `INSERT INTO training_samples(template_id, file_path, original_name, organization_id)
               VALUES (?, ?, ?, ?)`
            );
            const sampleId = sampleInsert.run(
              created.id, firstSuccess.relPath, firstSuccess.originalName, req.organization_id
            ).lastInsertRowid;

            const fieldIdByName = new Map(created.fields.map((f) => [f.name, f.id]));
            const mappingInsert = db.prepare(
              `INSERT INTO training_mappings(
                 sample_id, field_id, selection_text, prototype_line_text,
                 column_index, token_start, token_end,
                 line_index, page_index, column_start, column_end,
                 anchor_text, anchor_kind
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            for (const m of bm.mappings) {
              const fid = fieldIdByName.get(m.field_name);
              if (!fid) continue;
              mappingInsert.run(
                sampleId, fid, m.selection_text, m.prototype_line_text,
                m.column_index, m.token_start, m.token_end,
                m.line_index, m.page_index, m.column_start, m.column_end,
                m.anchor_text, m.anchor_kind
              );
            }

            db.prepare(
              `UPDATE templates SET extraction_strategy = 'manual', updated_at = datetime('now') WHERE id = ?`
            ).run(created.id);
            console.log(`[onboard/confirm] template ${created.id} flipped to extraction_strategy=manual (free repeat imports).`);
          } else {
            console.log(`[onboard/confirm] back-map confidence too low; keeping extraction_strategy=ai_vision.`);
          }
        } catch (e) {
          console.warn(`[onboard/confirm] back-map error: ${e.message || e}`);
        }
      }

      // If the AI returned learned_patterns during onboarding, validate
      // them against the first PDF. If they extract a meaningful number of
      // records (≥80% of the AI baseline), flip the template to 'manual'
      // so future imports run free via patternExtract.
      if (firstSuccess && learned_patterns) {
        try {
          const tpl = { fields: created.fields, learned_patterns };
          const r = await extractByLearnedPatterns(firstSuccess.absPath, tpl);
          const ratio = firstSuccess.records.length > 0
            ? r.records.length / firstSuccess.records.length : 0;
          console.log(`[onboard/confirm] pattern validation: ${r.records.length}/${firstSuccess.records.length} records (${(ratio * 100).toFixed(0)}%). reason=${r.reason}`);
          if (ratio >= 0.8) {
            db.prepare(
              `UPDATE templates SET extraction_strategy = 'manual', updated_at = datetime('now') WHERE id = ?`
            ).run(created.id);
            console.log(`[onboard/confirm] template ${created.id} flipped to extraction_strategy=manual via learned patterns. Future imports of similar PDFs will run FREE.`);
          } else {
            console.log(`[onboard/confirm] patterns under-perform; keeping ai_vision. (Will retry deterministic on import with fallback.)`);
          }
        } catch (e) {
          console.warn(`[onboard/confirm] pattern validation error: ${e.message || e}`);
        }
      }
    }

    res.status(201).json({
      template: getTemplate(created.id, req.organization_id),
      batch_id: batchId,
      records_total: recordsTotal,
      documents: docs,
    });
  } catch (err) { next(err); }
});

export default router;
