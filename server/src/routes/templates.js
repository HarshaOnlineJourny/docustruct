import express from 'express';
import { db, listTemplates, getTemplate, createTemplate, updateTemplateAI } from '../db.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.json(listTemplates(req.organization_id));
});

router.get('/:id', (req, res) => {
  const t = getTemplate(Number(req.params.id), req.organization_id);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  // Hydrate training samples + their mappings.
  const samples = db
    .prepare(
      `SELECT id, original_name, file_path, created_at,
              (SELECT COUNT(*) FROM training_mappings tm WHERE tm.sample_id = ts.id) AS mapping_count
         FROM training_samples ts
        WHERE ts.template_id = ? AND ts.organization_id = ?
        ORDER BY ts.created_at`
    )
    .all(t.id, req.organization_id);
  const mappings = db
    .prepare(
      `SELECT tm.* FROM training_mappings tm
        JOIN training_samples ts ON ts.id = tm.sample_id
        WHERE ts.template_id = ? AND ts.organization_id = ?`
    )
    .all(t.id, req.organization_id);
  t.samples = samples;
  t.mappings = mappings;
  return res.json(t);
});

router.post('/', (req, res) => {
  const { name, fields } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!Array.isArray(fields) || fields.length === 0) {
    return res.status(400).json({ error: 'at least one field is required' });
  }
  try {
    const created = createTemplate({
      ...req.body,
      organizationId: req.organization_id,  // ← Pass org context
    });
    res.status(201).json(created);
  } catch (err) {
    console.error('[templates POST]', err);
    res.status(400).json({ error: err.message || 'Failed to create template' });
  }
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  // Verify ownership before patching
  const t = db.prepare('SELECT id FROM templates WHERE id = ? AND organization_id = ?').get(id, req.organization_id);
  if (!t) return res.status(404).json({ error: 'Template not found' });

  const allowed = [
    'name', 'organization', 'state', 'category', 'year', 'notes',
    'extraction_strategy', 'ai_prompt', 'ai_provider', 'ai_model',
    'learned_patterns',
  ];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (k in req.body) {
      sets.push(`${k} = ?`);
      vals.push(req.body[k] ?? null);
    }
  }
  if (sets.length === 0) return res.json(getTemplate(id, req.organization_id));

  sets.push("updated_at = datetime('now')");
  vals.push(id);
  vals.push(req.organization_id);
  db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ? AND organization_id = ?`).run(...vals);
  return res.json(getTemplate(id, req.organization_id));
});

// Reorder / add / remove fields. Body: { fields: [{ id?, name, label, type, is_primary, sort_order }] }
// Strategy: any field with id stays (and is updated); fields without id are inserted; fields not present get deleted.
router.put('/:id/fields', (req, res) => {
  const id = Number(req.params.id);
  // Verify ownership before updating fields
  const t = db.prepare('SELECT id FROM templates WHERE id = ? AND organization_id = ?').get(id, req.organization_id);
  if (!t) return res.status(404).json({ error: 'Template not found' });

  const incoming = Array.isArray(req.body?.fields) ? req.body.fields : null;
  if (!incoming) return res.status(400).json({ error: 'fields[] required' });

  const existing = db.prepare('SELECT id FROM fields WHERE template_id = ?').all(id);
  const incomingIds = new Set(incoming.filter((f) => f.id != null).map((f) => f.id));
  const tx = db.transaction(() => {
    // Delete fields no longer in the incoming list.
    for (const e of existing) {
      if (!incomingIds.has(e.id)) {
        db.prepare('DELETE FROM fields WHERE id = ?').run(e.id);
      }
    }
    incoming.forEach((f, i) => {
      if (f.id != null) {
        db.prepare(
          `UPDATE fields SET name = ?, label = ?, type = ?, is_primary = ?, sort_order = ?
            WHERE id = ? AND template_id = ?`
        ).run(f.name, f.label, f.type, f.is_primary ? 1 : 0, f.sort_order ?? i, f.id, id);
      } else {
        db.prepare(
          `INSERT INTO fields(template_id, name, label, type, is_primary, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(id, f.name, f.label, f.type, f.is_primary ? 1 : 0, f.sort_order ?? i);
      }
    });
  });
  tx();
  return res.json(getTemplate(id, req.organization_id));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  // Verify ownership before deleting
  const result = db.prepare('DELETE FROM templates WHERE id = ? AND organization_id = ?').run(id, req.organization_id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

export default router;
