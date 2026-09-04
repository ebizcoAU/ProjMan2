// StageTemplateService — the programme LIBRARY and instantiation (servdesignspec §10.2/§10.3).
//
// Templates are the reusable definitions (system seed WA_RESIDENTIAL_18 + org clones);
// instantiation stamps a project's project_stages from one. Web-first (matrix Stage 9
// is a Dashboard action), so this is REST-served, not synced — the app renders the
// resulting INSTANCE (project_stages), which does sync.

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const HoldPointService = require('./HoldPointService');

/** System templates (org_id NULL) + this org's own. */
async function listTemplates({ orgId }) {
  const [rows] = await pool.query(
    `SELECT t.id, t.name, t.industry, t.description, t.is_system, t.org_id,
            (SELECT COUNT(*) FROM stage_template_items i WHERE i.template_id = t.id) AS stage_count
       FROM stage_templates t
      WHERE t.is_deleted = 0 AND (t.org_id = ? OR t.org_id IS NULL)
      ORDER BY t.is_system DESC, t.name`,
    [orgId]
  );
  return { templates: rows };
}

/** A template + its ordered items. Visible if system or this org's. */
async function getTemplate({ orgId, id }) {
  const [[tpl]] = await pool.query(
    `SELECT id, name, industry, description, is_system, org_id
       FROM stage_templates
      WHERE id = ? AND is_deleted = 0 AND (org_id = ? OR org_id IS NULL) LIMIT 1`,
    [id, orgId]
  );
  if (!tpl) throw new ServiceError('NOT_FOUND', 'Template not found', 404);
  const [items] = await pool.query(
    `SELECT seq, stage_code, name, part, actor_role, default_duration_days,
            is_hold_point, gate_prev, requires_inspection, requires_certificate
       FROM stage_template_items WHERE template_id = ? ORDER BY seq`,
    [id]
  );
  // xprojman-32 — the task library, one level under the stage items above. Included
  // here (not a separate endpoint) so the one template read gives the Portal task
  // drill-down everything it needs to resolve a tasks.template_item_id back to its
  // code/actor/hold-point metadata, same shape as `items` resolves project_stages.
  const [taskItems] = await pool.query(
    `SELECT id, stage_seq, seq, code, name, actor_role, is_hold_point
       FROM stage_task_templates WHERE template_id = ? ORDER BY stage_seq, seq`,
    [id]
  );
  return { template: tpl, items, taskItems };
}

/**
 * Instantiate a template's items into a project's project_stages. Refuses if the
 * project already has stages (re-instantiation would orphan progress) — clear them
 * first if you really mean to re-plan. One INSERT per item, in a transaction.
 */
async function instantiate({ orgId, projectId, templateId, actorUserId }) {
  const [[project]] = await pool.query(
    'SELECT id FROM projects WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [projectId, orgId]
  );
  if (!project) throw new ServiceError('NOT_FOUND', 'Project not found', 404);

  const [[{ n }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM project_stages WHERE project_id = ? AND org_id = ? AND is_deleted = 0',
    [projectId, orgId]
  );
  if (n > 0) {
    throw new ServiceError('PROGRAMME_EXISTS',
      'This project already has a programme; clear its stages before re-instantiating', 409);
  }

  const { items } = await getTemplate({ orgId, id: templateId });
  if (!items.length) throw new ServiceError('VALIDATION_ERROR', 'Template has no stages', 422);

  const [[org]] = await pool.query('SELECT state FROM organisations WHERE id = ? LIMIT 1', [orgId]);

  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const nowMs = Date.now();
    const itemRows = await conn.query(
      'SELECT id, seq FROM stage_template_items WHERE template_id = ? ORDER BY seq', [templateId]
    ).then(([r]) => r);
    const idBySeq = new Map(itemRows.map((r) => [r.seq, r.id]));

    for (const it of items) {
      const stageId = uuidv4();
      await conn.query(
        `INSERT INTO project_stages
           (id, org_id, project_id, seq, stage_code, name, part, actor_role,
            template_item_id, is_hold_point, gate_prev, status, updated_at, server_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started', ?, NOW(3))`,
        [stageId, orgId, projectId, it.seq, it.stage_code, it.name, it.part || null,
         it.actor_role || null, idBySeq.get(it.seq) || null,
         it.is_hold_point ? 1 : 0, it.gate_prev ? 1 : 0, nowMs]
      );
      // DIRECTIVE 1 Step D2 — the per-stage hold-point checklist (additive to the
      // is_hold_point/is_validated gate above, never a replacement of it).
      await HoldPointService.seedForStage({
        conn, orgId, projectId, stageId, seq: it.seq, orgState: org?.state,
      });

      // xprojman-32 (2026-09-03, owner directive) — the task library, one level
      // under stage_template_items. Same atomic-at-creation timing as the stages
      // themselves (§ decision: match current behaviour, don't open the S9.10
      // seed-timing question here — serverdesignspecification.md §14.3).
      const [taskTemplates] = await conn.query(
        `SELECT id, seq, code, name, actor_role FROM stage_task_templates
          WHERE template_id = ? AND stage_seq = ? ORDER BY seq`,
        [templateId, it.seq]
      );
      for (const t of taskTemplates) {
        await conn.query(
          `INSERT INTO tasks (id, org_id, project_id, stage_id, name, template_item_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [uuidv4(), orgId, projectId, stageId, `${t.code} ${t.name}`, t.id]
        );
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return { projectId, templateId, stagesCreated: items.length };
}

module.exports = { listTemplates, getTemplate, instantiate };
