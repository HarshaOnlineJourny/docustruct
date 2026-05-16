// Preview extraction (without persisting) on a single PDF — used by the
// Review screen.
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { db, UPLOADS_DIR, getTemplate } from '../db.js';
import { extractFromFile } from '../extraction/extractor.js';
import { extractByLearnedPatterns } from '../extraction/patternExtract.js';
import { visionRescueWithAI } from '../ai/index.js';

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-z0-9.\-_]/gi, '_');
      cb(null, `preview_${Date.now()}_${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function templateWithMappings(templateId, organizationId) {
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

router.post('/:templateId/preview', upload.single('file'), async (req, res, next) => {
  try {
    const templateId = Number(req.params.templateId);
    const template = templateWithMappings(templateId, req.organization_id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    if (!req.file) return res.status(400).json({ error: 'file required' });

    let result;
    let mode_used = 'text';
    // Vision is used when (a) caller asked for it, OR (b) this is an
    // AI-vision template — those have no training mappings and would
    // produce 0 records via the deterministic engine.
    const explicitVision = req.query.ai_vision === '1' || req.body.ai_vision === '1';
    const templateVision = template.extraction_strategy === 'ai_vision';
    if (explicitVision || templateVision) {
      const r = await visionRescueWithAI(req.file.path, template, {
        templateId,
        hint: template.ai_prompt || '',
      });
      if (r.skipped) {
        return res.status(400).json({ error: 'AI vision unavailable: ' + r.skipped });
      }
      const warnings = [`Extracted via AI vision (cost $${(r.usage?.costUsd ?? 0).toFixed(4)}).`];
      if (r.truncated) {
        warnings.push(`Warning: AI output reached the token limit after ${r.records.length} records. Some rows from the end of the PDF may be missing.`);
      }
      result = { records: r.records, warnings, mode: 'ai_vision' };
      mode_used = 'ai_vision';
    } else {
      // Priority 1: learned patterns (free).
      if (template.learned_patterns) {
        try {
          const pr = await extractByLearnedPatterns(req.file.path, template);
          if (pr.records.length > 0) {
            result = {
              records: pr.records,
              warnings: [`Extracted via learned patterns (${pr.records.length} records, $0.00).`],
              mode: 'pattern',
            };
            mode_used = 'pattern';
          }
        } catch (e) { console.warn(`[preview] pattern extract error: ${e.message || e}`); }
      }
      // Priority 2: deterministic engine.
      if (!result) result = await extractFromFile(req.file.path, template);
      // Same fallback as the import path: when a manual template that came
      // from AI onboarding returns 0 deterministic records on a divergent
      // PDF, re-run via AI vision using the saved prompt.
      if (
        (result?.records?.length ?? 0) === 0 &&
        template.ai_prompt &&
        template.extraction_strategy === 'manual'
      ) {
        const r = await visionRescueWithAI(req.file.path, template, {
          templateId, hint: template.ai_prompt,
        });
        if (!r.skipped && r.records.length > 0) {
          const warnings = [
            `Deterministic engine returned no records — re-extracted via AI vision (cost $${(r.usage?.costUsd ?? 0).toFixed(4)}).`,
          ];
          if (r.truncated) {
            warnings.push(`Warning: AI output reached the token limit after ${r.records.length} records.`);
          }
          result = { records: r.records, warnings, mode: 'ai_vision_fallback' };
          mode_used = 'ai_vision_fallback';
        }
      }
    }
    res.json({
      template,
      extraction: result,
      mode_used,
      file: {
        name: req.file.originalname,
        path: path.relative(UPLOADS_DIR, req.file.path),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Re-extract an existing training sample (useful for tuning).
router.get('/:templateId/sample/:sampleId/preview', async (req, res, next) => {
  try {
    const templateId = Number(req.params.templateId);
    const template = templateWithMappings(templateId, req.organization_id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const sample = db
      .prepare('SELECT * FROM training_samples WHERE id = ? AND template_id = ? AND organization_id = ?')
      .get(Number(req.params.sampleId), templateId, req.organization_id);
    if (!sample) return res.status(404).json({ error: 'Sample not found' });
    const filePath = path.isAbsolute(sample.file_path)
      ? sample.file_path
      : path.join(UPLOADS_DIR, sample.file_path);
    const result = await extractFromFile(filePath, template);
    res.json({ template, extraction: result, file: { name: sample.original_name } });
  } catch (err) {
    next(err);
  }
});

export default router;
