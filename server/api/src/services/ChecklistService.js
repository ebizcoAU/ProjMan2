// ChecklistService — generic checklists (xprojman-46 as amended by its §7, migration v047).
//
// Two halves:
//   * SYNC (the App executes offline): guardPush runs BEFORE the generic writer and
//     afterPush AFTER it, for checklist_instances / checklist_instance_items / signoffs.
//       guard  — checklists.execute; template + target_role on create; the snapshot
//                (template_name, category) copied in from the template; CHECKLIST_FROZEN
//                once an instance is completed (terminal for the app); completion only
//                when every required item is answered and every photo_required item
//                answered pass/fail has a `documents` photo (CHECKLIST_INCOMPLETE,
//                retryable, details.item_ids). N/A is exempt from the photo check.
//       after  — started_by on create; completed_by/completed_at/result on completion.
//   * REST (the Portal authors and reviews): templates CRUD/publish/copy_from, and the
//     read-only review list + detail with evidence embedded.
//
// Evidence is never a column on these rows — it is a documents row keyed
// entity_type='checklist_item' / 'signoff' (xprojman-46 §7 #1).

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const { projectScope } = require('../lib/scope');
const ProjectService = require('./ProjectService');

const SYNC_TABLES = new Set(['checklist_instances', 'checklist_instance_items', 'signoffs']);
const CATEGORIES = ['internal_qa', 'toolbox_talk', 'plant_prestart', 'other'];
const MAX_ITEMS = 100;

const isChecklistOps = (wireName) => SYNC_TABLES.has(wireName);
const canManage = (role) => access.hasPermission(role, 'checklists.manage');
const canExecute = (role) => access.hasPermission(role, 'checklists.execute');

// ── Sync guard ────────────────────────────────────────────────────────────────

async function loadInstance(orgId, id) {
  const [[row]] = await pool.query(
    'SELECT * FROM checklist_instances WHERE id = ? AND org_id = ? LIMIT 1', [id, orgId]);
  return row;
}

function assertNotFrozen(instance) {
  if (instance && instance.status === 'completed') {
    throw new ServiceError('CHECKLIST_FROZEN',
      'This checklist is completed and frozen — record a correction as a new checklist', 409);
  }
}

/** The completion rule (F5): every required item answered, every evidence photo present. */
async function assertCompletable(orgId, instanceId) {
  const [items] = await pool.query(
    `SELECT i.id, i.is_required, i.photo_required, i.result,
            EXISTS (SELECT 1 FROM documents d
                     WHERE d.org_id = i.org_id AND d.entity_type = 'checklist_item'
                       AND d.entity_id = i.id AND d.is_deleted = 0) AS has_photo
       FROM checklist_instance_items i
      WHERE i.instance_id = ? AND i.org_id = ? AND i.is_deleted = 0`,
    [instanceId, orgId]
  );
  const unanswered = items.filter((i) => i.is_required && i.result === 'pending').map((i) => i.id);
  // N/A is exempt (xprojman-46 §7, App 15f965c): the photo check applies to pass/fail only.
  const missingPhoto = items
    .filter((i) => i.photo_required && (i.result === 'pass' || i.result === 'fail') && !Number(i.has_photo))
    .map((i) => i.id);
  const itemIds = [...new Set([...unanswered, ...missingPhoto])];
  if (itemIds.length) {
    throw new ServiceError('CHECKLIST_INCOMPLETE',
      'Some required items are unanswered or missing their photo', 409,
      { item_ids: itemIds, unanswered, missing_photo: missingPhoto });
  }
}

async function guardPush({ wireName, operation, id, safe, actor }) {
  if (!isChecklistOps(wireName)) return;
  if (!canExecute(actor.role)) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: checklists.execute', 403);
  }

  if (wireName === 'checklist_instances') {
    const current = await loadInstance(actor.orgId, id);
    assertNotFrozen(current);

    if (!current) {
      // A create (or an upsert of a row the server hasn't seen). Unpublished or deleted
      // templates are still accepted — the instance carries its own snapshot (§7 #4).
      if (!safe.template_id) {
        throw new ServiceError('VALIDATION_ERROR', 'template_id is required', 400);
      }
      const [[tpl]] = await pool.query(
        `SELECT id, name, category, target_role FROM checklist_templates
          WHERE id = ? AND (org_id = ? OR org_id IS NULL) LIMIT 1`,
        [safe.template_id, actor.orgId]
      );
      if (!tpl) throw new ServiceError('VALIDATION_ERROR', 'template_id not found', 422);
      if (tpl.target_role && tpl.target_role !== actor.role && !canManage(actor.role)) {
        throw new ServiceError('FORBIDDEN', `This checklist is for the ${tpl.target_role} role`, 403);
      }
      if (safe.status && safe.status !== 'in_progress') {
        throw new ServiceError('VALIDATION_ERROR',
          'A checklist is created in_progress; push status=completed afterwards, once its items are in', 400);
      }
      safe.template_name = tpl.name;
      safe.category = tpl.category;
      safe.started_by = actor.userId;
      return;
    }

    if (safe.template_id && safe.template_id !== current.template_id) {
      throw new ServiceError('VALIDATION_ERROR', 'template_id cannot change after the checklist starts', 400);
    }
    if (safe.status === 'completed' && operation !== 'delete') {
      await assertCompletable(actor.orgId, id);
    }
    return;
  }

  if (wireName === 'checklist_instance_items') {
    let instanceId = safe.instance_id;
    if (!instanceId) {
      const [[row]] = await pool.query(
        'SELECT instance_id FROM checklist_instance_items WHERE id = ? AND org_id = ? LIMIT 1', [id, actor.orgId]);
      instanceId = row?.instance_id;
    }
    const parent = instanceId ? await loadInstance(actor.orgId, instanceId) : null;
    if (!parent) throw new ServiceError('NOT_FOUND', 'Checklist not found', 404);
    assertNotFrozen(parent);
    return;
  }

  // signoffs — v047 knows one subject type; v048 adds site_induction + swms.
  const [[existing]] = await pool.query(
    'SELECT subject_type, subject_id FROM signoffs WHERE id = ? AND org_id = ? LIMIT 1', [id, actor.orgId]);
  const subjectType = safe.subject_type || existing?.subject_type;
  const subjectId = safe.subject_id || existing?.subject_id;
  if (subjectType !== 'checklist_instance') {
    throw new ServiceError('VALIDATION_ERROR', 'subject_type must be checklist_instance', 400);
  }
  const subject = subjectId ? await loadInstance(actor.orgId, subjectId) : null;
  if (!subject) throw new ServiceError('NOT_FOUND', 'Checklist not found', 404);
  assertNotFrozen(subject);
  if (!existing) {
    if (safe.project_id && String(safe.project_id) !== String(subject.project_id)) {
      throw new ServiceError('VALIDATION_ERROR', 'project_id does not match the checklist', 400);
    }
    safe.project_id = subject.project_id;
    if (!safe.user_id && !safe.name) {
      throw new ServiceError('VALIDATION_ERROR', 'A sign-off needs user_id or name', 400);
    }
    if (!safe.signed_at) throw new ServiceError('VALIDATION_ERROR', 'signed_at is required', 400);
  }
}

/** Server-owned stamps, after the generic write. */
async function afterPush({ wireName, operation, id, safe, actor }) {
  if (wireName !== 'checklist_instances' || operation === 'delete') return;
  if (safe.status === 'completed') {
    await pool.query(
      `UPDATE checklist_instances i
          SET i.completed_by = COALESCE(i.completed_by, ?),
              i.completed_at = COALESCE(i.completed_at, NOW()),
              i.result = CASE WHEN EXISTS (
                           SELECT 1 FROM checklist_instance_items x
                            WHERE x.instance_id = i.id AND x.is_deleted = 0 AND x.result = 'fail')
                         THEN 'fail' ELSE 'pass' END
        WHERE i.id = ? AND i.org_id = ?`,
      [actor.userId, id, actor.orgId]
    );
  }
}

// ── REST: templates (Portal author) ───────────────────────────────────────────

async function loadItems(templateIds) {
  if (!templateIds.length) return new Map();
  const [rows] = await pool.query(
    `SELECT id, template_id, seq, label, is_required, photo_required
       FROM checklist_template_items
      WHERE template_id IN (${templateIds.map(() => '?').join(',')}) AND is_deleted = 0
      ORDER BY seq`,
    templateIds
  );
  const byTpl = new Map();
  for (const r of rows) {
    if (!byTpl.has(r.template_id)) byTpl.set(r.template_id, []);
    byTpl.get(r.template_id).push(r);
  }
  return byTpl;
}

const shapeTemplate = (t, items) => ({ ...t, is_system: t.org_id === null ? 1 : 0, items: items || [] });

async function listTemplates({ orgId }) {
  const [rows] = await pool.query(
    `SELECT id, org_id, name, category, target_role, description, is_published, created_by, created_at
       FROM checklist_templates
      WHERE (org_id = ? OR org_id IS NULL) AND is_deleted = 0
      ORDER BY org_id IS NULL, name`,
    [orgId]
  );
  const items = await loadItems(rows.map((r) => r.id));
  return { templates: rows.map((t) => shapeTemplate(t, items.get(t.id))) };
}

async function loadTemplate(orgId, id) {
  const [[tpl]] = await pool.query(
    `SELECT id, org_id, name, category, target_role, description, is_published, created_by, created_at
       FROM checklist_templates
      WHERE id = ? AND (org_id = ? OR org_id IS NULL) AND is_deleted = 0 LIMIT 1`,
    [id, orgId]
  );
  if (!tpl) throw new ServiceError('NOT_FOUND', 'Checklist template not found', 404);
  return tpl;
}

async function getTemplate({ orgId, id }) {
  const tpl = await loadTemplate(orgId, id);
  const items = await loadItems([tpl.id]);
  return { template: shapeTemplate(tpl, items.get(tpl.id)) };
}

/** Throws unless the template is the caller's own org's (system ones are read-only). */
async function loadOwnTemplate(orgId, id) {
  const tpl = await loadTemplate(orgId, id);
  if (tpl.org_id === null) {
    throw new ServiceError('SYSTEM_TEMPLATE_READONLY',
      'System templates are read-only — duplicate it (copy_from) to customise', 403);
  }
  return tpl;
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
    throw new ServiceError('VALIDATION_ERROR', `items must be an array of 1–${MAX_ITEMS}`, 400);
  }
  items.forEach((it, index) => {
    const label = typeof it?.label === 'string' ? it.label.trim() : '';
    if (!label || label.length > 255) {
      throw new ServiceError('VALIDATION_ERROR', 'Each item needs a label of 1–255 characters', 400, { index });
    }
  });
}

async function validateTargetRole(role) {
  if (role === undefined || role === null || role === '') return null;
  if (!access.hasPermission(role, 'checklists.execute')) {
    throw new ServiceError('INVALID_TARGET_ROLE', `${role} cannot execute checklists`, 400);
  }
  return role;
}

async function writeItems(conn, { orgId, templateId, items }) {
  const now = Date.now();
  let seq = 0;
  for (const it of items) {
    seq += 1;
    await conn.query(
      `INSERT INTO checklist_template_items
         (id, org_id, template_id, seq, label, is_required, photo_required, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), orgId, templateId, seq, it.label.trim(),
       it.is_required === false || it.is_required === 0 ? 0 : 1,
       it.photo_required ? 1 : 0, now]
    );
  }
}

async function createTemplate({ orgId, actor, body }) {
  let src = null;
  let items = body.items;
  if (body.copy_from) {
    src = await loadTemplate(orgId, body.copy_from);
    items = (await loadItems([src.id])).get(src.id) || [];
  } else {
    validateItems(items);
  }
  const name = String(body.name ?? src?.name ?? '').trim();
  if (!name || name.length > 160) throw new ServiceError('VALIDATION_ERROR', 'name is required (max 160)', 400);
  const category = body.category ?? src?.category;
  if (!CATEGORIES.includes(category)) {
    throw new ServiceError('VALIDATION_ERROR', `category must be one of ${CATEGORIES.join(', ')}`, 400);
  }
  const targetRole = await validateTargetRole(body.target_role !== undefined ? body.target_role : src?.target_role);

  const id = uuidv4();
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    await conn.query(
      `INSERT INTO checklist_templates
         (id, org_id, name, category, target_role, description, is_published, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, orgId, name, category, targetRole, body.description ?? src?.description ?? null,
       actor.userId, Date.now()]
    );
    await writeItems(conn, { orgId, templateId: id, items });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return getTemplate({ orgId, id });
}

/** PATCH — allowed while published (F2: running instances keep their snapshot). A new
 *  items array REPLACES the set: old rows soft-deleted, new rows inserted, so devices
 *  pull the deletes + inserts. */
async function updateTemplate({ orgId, id, body }) {
  await loadOwnTemplate(orgId, id);
  const sets = [];
  const params = [];
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name || name.length > 160) throw new ServiceError('VALIDATION_ERROR', 'name is required (max 160)', 400);
    sets.push('name = ?'); params.push(name);
  }
  if (body.category !== undefined) {
    if (!CATEGORIES.includes(body.category)) {
      throw new ServiceError('VALIDATION_ERROR', `category must be one of ${CATEGORIES.join(', ')}`, 400);
    }
    sets.push('category = ?'); params.push(body.category);
  }
  if (body.target_role !== undefined) {
    sets.push('target_role = ?'); params.push(await validateTargetRole(body.target_role));
  }
  if (body.description !== undefined) { sets.push('description = ?'); params.push(body.description || null); }
  if (body.items !== undefined) validateItems(body.items);

  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    sets.push('updated_at = ?'); params.push(Date.now());
    await conn.query(`UPDATE checklist_templates SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`,
      [...params, id, orgId]);
    if (body.items !== undefined) {
      await conn.query(
        'UPDATE checklist_template_items SET is_deleted = 1, updated_at = ? WHERE template_id = ? AND is_deleted = 0',
        [Date.now(), id]);
      await writeItems(conn, { orgId, templateId: id, items: body.items });
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return getTemplate({ orgId, id });
}

async function setPublished({ orgId, id, published }) {
  await loadOwnTemplate(orgId, id);
  await pool.query(
    'UPDATE checklist_templates SET is_published = ?, updated_at = ? WHERE id = ? AND org_id = ?',
    [published ? 1 : 0, Date.now(), id, orgId]);
  return getTemplate({ orgId, id });
}

async function deleteTemplate({ orgId, id }) {
  await loadOwnTemplate(orgId, id);
  const now = Date.now();
  await pool.query('UPDATE checklist_templates SET is_deleted = 1, updated_at = ? WHERE id = ? AND org_id = ?',
    [now, id, orgId]);
  await pool.query('UPDATE checklist_template_items SET is_deleted = 1, updated_at = ? WHERE template_id = ?',
    [now, id]);
  return { id, deleted: true };
}

// ── REST: review (Portal, read-only) ──────────────────────────────────────────

const LIST_FILTERS = { status: ['in_progress', 'completed'], result: ['pending', 'pass', 'fail'] };

/** GET /projects/:id/checklists — newest first, cursor = the last row's `created_at|id`. */
async function listForProject({ orgId, auth, projectId, query }) {
  await ProjectService.assertProjectReachable(orgId, projectId, auth);
  const where = ['i.org_id = ?', 'i.project_id = ?', 'i.is_deleted = 0'];
  const params = [orgId, projectId];
  for (const key of ['status', 'result']) {
    if (query[key]) {
      if (!LIST_FILTERS[key].includes(query[key])) {
        throw new ServiceError('VALIDATION_ERROR', `${key} must be one of ${LIST_FILTERS[key].join(', ')}`, 400);
      }
      where.push(`i.${key} = ?`); params.push(query[key]);
    }
  }
  if (query.category) {
    if (!CATEGORIES.includes(query.category)) {
      throw new ServiceError('VALIDATION_ERROR', `category must be one of ${CATEGORIES.join(', ')}`, 400);
    }
    where.push('i.category = ?'); params.push(query.category);
  }
  if (query.from) { where.push('i.created_at >= ?'); params.push(query.from); }
  if (query.to) { where.push('i.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(query.to); }
  if (query.cursor) {
    const [cAt, cId] = String(query.cursor).split('|');
    where.push('(i.created_at < ? OR (i.created_at = ? AND i.id < ?))');
    params.push(cAt, cAt, cId || '');
  }
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const [rows] = await pool.query(
    `SELECT i.id, i.template_name, i.category, i.status, i.result, i.stage_id, i.unit_id,
            i.started_by, su.full_name AS started_by_name,
            i.completed_by, cu.full_name AS completed_by_name, i.completed_at, i.created_at,
            (SELECT COUNT(*) FROM checklist_instance_items x
              WHERE x.instance_id = i.id AND x.is_deleted = 0 AND x.result = 'fail') AS fail_count,
            (SELECT s.id FROM checklist_instances s
              WHERE s.supersedes_id = i.id AND s.org_id = i.org_id AND s.is_deleted = 0
              ORDER BY s.created_at DESC LIMIT 1) AS superseded_by_id
       FROM checklist_instances i
       LEFT JOIN users su ON su.id = i.started_by
       LEFT JOIN users cu ON cu.id = i.completed_by
      WHERE ${where.join(' AND ')}
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT ?`,
    [...params, limit + 1]
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    checklists: page.map((r) => ({
      id: r.id, template_name: r.template_name, category: r.category, status: r.status,
      result: r.result, stage_id: r.stage_id, unit_id: r.unit_id,
      started_by: r.started_by ? { id: r.started_by, name: r.started_by_name } : null,
      completed_by: r.completed_by ? { id: r.completed_by, name: r.completed_by_name } : null,
      completed_at: r.completed_at, created_at: r.created_at,
      fail_count: Number(r.fail_count), superseded_by_id: r.superseded_by_id,
    })),
    next_cursor: rows.length > limit && last ? `${last.created_at}|${last.id}` : null,
  };
}

async function documentsFor(orgId, entityType, ids) {
  if (!ids.length) return new Map();
  const [docs] = await pool.query(
    `SELECT id, entity_id, kind, original_filename AS file_name, created_at
       FROM documents
      WHERE org_id = ? AND entity_type = ? AND is_deleted = 0
        AND entity_id IN (${ids.map(() => '?').join(',')})
      ORDER BY created_at`,
    [orgId, entityType, ...ids]
  );
  const by = new Map();
  for (const d of docs) {
    if (!by.has(d.entity_id)) by.set(d.entity_id, []);
    by.get(d.entity_id).push({ id: d.id, kind: d.kind, file_name: d.file_name, created_at: d.created_at });
  }
  return by;
}

/** GET /checklists/:id — the instance, its items and sign-offs, evidence embedded. */
async function getInstance({ orgId, auth, id }) {
  const scope = projectScope(auth, { projectColumn: 'project_id', alias: 'i' });
  const [[inst]] = await pool.query(
    `SELECT i.*, su.full_name AS started_by_name, cu.full_name AS completed_by_name
       FROM checklist_instances i
       LEFT JOIN users su ON su.id = i.started_by
       LEFT JOIN users cu ON cu.id = i.completed_by
      WHERE i.id = ? AND i.org_id = ? AND i.is_deleted = 0${scope.sql} LIMIT 1`,
    [id, orgId, ...scope.params]
  );
  if (!inst) throw new ServiceError('NOT_FOUND', 'Checklist not found', 404);

  const [items] = await pool.query(
    `SELECT id, seq, label, is_required, photo_required, result, note
       FROM checklist_instance_items WHERE instance_id = ? AND org_id = ? AND is_deleted = 0 ORDER BY seq`,
    [id, orgId]);
  const [signoffs] = await pool.query(
    `SELECT s.id, s.user_id, COALESCE(u.full_name, s.name) AS name, s.signed_at
       FROM signoffs s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.subject_type = 'checklist_instance' AND s.subject_id = ? AND s.org_id = ? AND s.is_deleted = 0
      ORDER BY s.signed_at`,
    [id, orgId]);
  const itemDocs = await documentsFor(orgId, 'checklist_item', items.map((i) => i.id));
  const signDocs = await documentsFor(orgId, 'signoff', signoffs.map((s) => s.id));
  const [[sup]] = await pool.query(
    `SELECT id FROM checklist_instances WHERE supersedes_id = ? AND org_id = ? AND is_deleted = 0
      ORDER BY created_at DESC LIMIT 1`, [id, orgId]);

  return {
    checklist: {
      ...inst,
      superseded_by_id: sup?.id || null,
      items: items.map((i) => ({ ...i, documents: itemDocs.get(i.id) || [] })),
      signoffs: signoffs.map((s) => ({ ...s, documents: signDocs.get(s.id) || [] })),
    },
  };
}

module.exports = {
  isChecklistOps, guardPush, afterPush,
  listTemplates, getTemplate, createTemplate, updateTemplate, setPublished, deleteTemplate,
  listForProject, getInstance,
  CATEGORIES,
};
