// InspectionService — quality module reads + the inspection -> validation flow
// (servdesignspec §12). Two responsibilities:
//
//   create()    REST create of an inspection against a project (+ optional stage).
//   complete()  The one server-mediated act (§12.4): commit an inspector's verdict.
//               A hold-point PASS calls the EXISTING StageProgressionService.validate
//               internally — the inspection id becomes the validate `reference`, so
//               the stage's is_validated flip is provenance-linked to the checklist
//               that justified it. The §10 gate is reused, never re-opened.
//
// Plus the portal/app review reads (inspections+items, defects, certificates) — all
// project-scoped the same way ProjectService.getProject is (§9.4 non-disclosure: a
// non-member gets 404, not 403).
//
// `inspection_items`, `defects` and `certificates` bodies ride /sync/push (offline,
// QualityOpsService governs that path) — there are no bespoke REST writers for them
// in v1, same posture as P5 (§11.7).

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const ProjectService = require('./ProjectService');
const StageProgressionService = require('./StageProgressionService');
const JobAwardService = require('./JobAwardService');
const AttestationService = require('./AttestationService');

/** Non-disclosure scope check shared by every action here (mirrors StageProgressionService). */
async function assertReachable({ orgId, projectId, actor }) {
  await ProjectService.assertProjectReachable(orgId, projectId, {
    role: actor.role, userId: actor.userId,
  });
}

/** Load an inspection in the caller's org+project, or 404. */
async function loadInspection({ orgId, projectId, inspectionId }) {
  const [[row]] = await pool.query(
    `SELECT * FROM inspections
      WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1`,
    [inspectionId, projectId, orgId]
  );
  if (!row) throw new ServiceError('NOT_FOUND', 'Inspection not found', 404);
  return row;
}

/**
 * POST /projects/:id/inspections — create an inspection against a project, and
 * optionally a stage. `is_hold_point` mirrors the stage's flag when a stage is given
 * (§12.3 "mirrors the stage") so the checklist and the gate never disagree; the
 * caller may still override for a stand-alone QA inspection with no stage.
 */
async function create({ orgId, projectId, actor, type, stageId, isHoldPoint, scheduledAt, notes }) {
  await assertReachable({ orgId, projectId, actor });

  let holdPoint = !!isHoldPoint;
  if (stageId) {
    const [[stage]] = await pool.query(
      `SELECT is_hold_point FROM project_stages
        WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1`,
      [stageId, projectId, orgId]
    );
    if (!stage) throw new ServiceError('NOT_FOUND', 'Stage not found', 404);
    holdPoint = !!stage.is_hold_point;
  }

  const id = uuidv4();
  await pool.query(
    `INSERT INTO inspections
       (id, org_id, project_id, stage_id, type, is_hold_point, scheduled_at, notes,
        updated_at, server_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
    [id, orgId, projectId, stageId || null, type, holdPoint ? 1 : 0,
     scheduledAt || null, notes || null, Date.now()]
  );
  return { id, is_hold_point: holdPoint };
}

/**
 * POST /projects/:id/inspections/:iid/complete (§12.4). `quality.write` gets you
 * here; a hold-point PASS additionally needs `quality.validate` — enforced by
 * StageProgressionService.validate itself, so the separation of duties (PM cannot
 * self-validate) holds without this method re-implementing the check.
 */
async function complete({ orgId, projectId, actor, inspectionId, result, reference, documentId }) {
  await assertReachable({ orgId, projectId, actor });
  const inspection = await loadInspection({ orgId, projectId, inspectionId });

  const pass = result === 'pass';
  await pool.query(
    `UPDATE inspections
        SET inspector_id = ?, completed_at = NOW(), result = ?,
            reference = COALESCE(?, reference), document_id = COALESCE(?, document_id),
            updated_at = ?, server_updated_at = NOW(3)
      WHERE id = ? AND org_id = ?`,
    [actor.userId, result, reference || null, documentId || null, Date.now(), inspectionId, orgId]
  );

  let validation = null;
  if (inspection.is_hold_point && pass) {
    if (!inspection.stage_id) {
      throw new ServiceError('VALIDATION_ERROR', 'This hold-point inspection has no stage to validate', 400);
    }
    validation = await StageProgressionService.validate({
      orgId, projectId, stageId: inspection.stage_id, actor,
      result: 'pass', reference: inspectionId,
    });
  }

  // PM2-02 evidence emission (§13.3) — a validated PASS credits the engaged Builder's
  // Verified Work History (devroadmap.md §7.1's primary tier); best-effort, never
  // fails a validation that already committed.
  if (pass) {
    JobAwardService.acceptedBuilderEngagement({ orgId, projectId })
      .then((eng) => {
        if (!eng) return null;
        return AttestationService.emit({
          subjectUserId: eng.to_user_id, issuingOrgId: orgId,
          sourceType: 'inspection', sourceId: inspectionId,
          payload: { project_id: projectId, type: inspection.type, is_hold_point: !!inspection.is_hold_point },
        });
      })
      .catch((err) => console.warn('[ATTESTATION] inspection emit failed (non-fatal):', err.message));
  }

  return { id: inspectionId, result, is_hold_point: !!inspection.is_hold_point, validation };
}

/** GET /projects/:id/inspections — list + their items (portal/app review). */
async function listInspections({ orgId, projectId, actor }) {
  await assertReachable({ orgId, projectId, actor });
  const [inspections] = await pool.query(
    `SELECT * FROM inspections
      WHERE project_id = ? AND org_id = ? AND is_deleted = 0
      ORDER BY COALESCE(scheduled_at, created_at) DESC`,
    [projectId, orgId]
  );
  if (inspections.length === 0) return { inspections: [] };

  const [items] = await pool.query(
    `SELECT ii.* FROM inspection_items ii
       JOIN inspections i ON i.id = ii.inspection_id
      WHERE i.project_id = ? AND i.org_id = ? AND ii.is_deleted = 0
      ORDER BY ii.seq`,
    [projectId, orgId]
  );
  const byInspection = new Map();
  for (const item of items) {
    if (!byInspection.has(item.inspection_id)) byInspection.set(item.inspection_id, []);
    byInspection.get(item.inspection_id).push(item);
  }
  return {
    inspections: inspections.map((i) => ({ ...i, items: byInspection.get(i.id) || [] })),
  };
}

/** GET /projects/:id/defects?status= — the punch-list (portal review). */
async function listDefects({ orgId, projectId, actor, status }) {
  await assertReachable({ orgId, projectId, actor });
  const params = [projectId, orgId];
  let where = '';
  if (status) { where = ' AND status = ?'; params.push(status); }
  const [rows] = await pool.query(
    `SELECT * FROM defects
      WHERE project_id = ? AND org_id = ? AND is_deleted = 0${where}
      ORDER BY raised_at DESC`,
    params
  );
  return { defects: rows };
}

/** GET /projects/:id/certificates — the register + expiry (portal review). */
async function listCertificates({ orgId, projectId, actor }) {
  await assertReachable({ orgId, projectId, actor });
  const [rows] = await pool.query(
    `SELECT *, (expires_at IS NOT NULL AND expires_at <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)) AS lapsing_soon
       FROM certificates
      WHERE project_id = ? AND org_id = ? AND is_deleted = 0
      ORDER BY COALESCE(expires_at, issued_at) IS NULL, expires_at, issued_at DESC`,
    [projectId, orgId]
  );
  return { certificates: rows };
}

module.exports = { create, complete, listInspections, listDefects, listCertificates };
