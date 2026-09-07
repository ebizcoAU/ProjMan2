// Mounted at /projects — transport only. The rules live in services/ProjectService.js.
//
//   GET    /projects                       list (filter: ?status=, paginate)
//   GET    /projects/dashboard-summary     Portal console aggregate (money block gated)
//   POST   /projects                       create           (org_admin | project_developer)
//   GET    /projects/:id                   detail + stages + tasks
//   GET    /projects/:id/site-map          server-mediated Google Static Map (xprojman-40)
//   PATCH  /projects/:id                   update           (org_admin | project_developer)
//   DELETE /projects/:id                   daisy-chain delete — draft/no-claims/no-awards/
//                                           no-engagements only (xprojman-35); Cancel is the
//                                           PATCH above with status:'cancelled'
//   POST   /projects/:id/stages            add a stage      (programme.write)
//   PATCH  /projects/:id/stages/:stageId   edit a stage     (programme.write)
//   POST   /projects/:id/programme         instantiate from a template (programme.write)
//   POST   /projects/:id/stages/:id/advance  advance status (progress.write, gated)
//   POST   /projects/:id/stages/:id/validate hold-point validation (quality.validate)
//   POST   /projects/:id/inspections               create             (quality.write)
//   GET    /projects/:id/inspections               list (+items)      (projects.read)
//   POST   /projects/:id/inspections/:iid/complete  commit verdict     (quality.write;
//                                                    hold-point pass also needs quality.validate)
//   GET    /projects/:id/defects                    punch-list (?status=) (projects.read)
//   GET    /projects/:id/certificates                cert register (+expiry) (projects.read)
//   GET    /projects/:id/fixed-assets                P8a asset register + schedules
//   POST   /projects/:id/fixed-assets                declare an asset   (money.write)
//   POST   /projects/:id/fixed-assets/prepare-draft  S18.11 prepare     (money.write)
//   POST   /projects/:id/fixed-assets/:aid/approve   S18.12 approve     (tax.approve)
//
// The web console is the system of record for project structure (projman-01 §4);
// the field app receives every write here through /sync/pull and pushes progress
// (stage status, task completion) through /sync/push. Financial columns are
// role-redacted in the service — the same rule the sync pull applies. The stage
// progression gates (§10.4) live in StageProgressionService and guard BOTH /advance
// here and the sync-push path, so a device cannot skip a hold point.

const router = require('express').Router();
const { body, query, validationResult } = require('express-validator');

const { authenticate, requirePermission } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const ProjectService = require('../services/ProjectService');
const MembershipService = require('../services/MembershipService');
const StageTemplateService = require('../services/StageTemplateService');
const StageProgressionService = require('../services/StageProgressionService');
const InspectionService = require('../services/InspectionService');
const TaskProgressService = require('../services/TaskProgressService');
const JobAwardService = require('../services/JobAwardService');
const HoldPointService = require('../services/HoldPointService');
const EstimateService = require('../services/EstimateService');
const ClaimService = require('../services/ClaimService');
const ProcurementService = require('../services/ProcurementService');
const ContractService = require('../services/ContractService');
const DepreciationService = require('../services/DepreciationService');
const ProjectDeletionService = require('../services/ProjectDeletionService');
const CostingService = require('../services/CostingService');
const SiteMapService = require('../services/SiteMapService');
const ProjectBriefService = require('../services/ProjectBriefService');
const storage = require('../lib/storage');

router.use(authenticate);

// Capabilities, not role lists (§9). Adding a role that may write projects is a
// matrix row; this line never changes.
const canReadProjects = requirePermission('projects.read');
const canWriteProjects = requirePermission('projects.write');
const canWriteProgramme = requirePermission('programme.write');
const canWriteProgress = requirePermission('progress.write');
const canValidate = requirePermission('quality.validate');
const canManageUsers = requirePermission('users.manage');
const canWriteQuality = requirePermission('quality.write');
const canVerifyProgress = requirePermission('progress.verify');
const canManagePanel = requirePermission('panel.manage');
const canWriteMoney = requirePermission('money.write');   // P7a estimate/cost-plan writes
const canSubmitClaims = requirePermission('claims.submit'); // P7a Builder submits
const canApproveClaims = requirePermission('claims.approve'); // P7a PM approves/pays
const canWritePo = requirePermission('po.write');           // P7b procurement writes
const canRaiseVariation = requirePermission('variations.raise'); // P7c PM raises variations
const canApproveTax = requirePermission('tax.approve');     // P8a S18.12 accountant approval (v012, reused)

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({ success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path });
  return true;
}

// ── GET /projects ─────────────────────────────────────────────
router.get(
  '/',
  canReadProjects,
  [
    query('status').optional().isIn(['draft', 'active', 'on_hold', 'completed', 'inactive', 'cancelled']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const data = await ProjectService.listProjects({
        orgId: req.auth.orgId,
        role: req.auth.role,
        userId: req.auth.userId,
        status: req.query.status,
        page: req.query.page || 1,
        limit: req.query.limit || 20,
      });
      return res.json({ success: true, data });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── POST /projects ────────────────────────────────────────────
router.post(
  '/',
  canWriteProjects,
  [
    body('code').trim().notEmpty().isLength({ max: 30 }).withMessage('A project code is required (max 30 chars)'),
    body('name').trim().notEmpty().withMessage('A project name is required'),
    body('contract_type').optional({ nullable: true, checkFalsy: true }).isIn(['fixed_price', 'cost_plus']),
    body('status').optional().isIn(['draft', 'active', 'on_hold', 'completed', 'inactive', 'cancelled']),
    body('start_date').optional({ nullable: true, checkFalsy: true }).isISO8601(),
    body('due_date').optional({ nullable: true, checkFalsy: true }).isISO8601(),
    // S1.3 (18-Stage spec v3.4) — building type/unit count, declared at creation.
    body('unit_count').optional({ nullable: true }).isInt({ min: 1 }),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const { id } = await ProjectService.createProject({
        orgId: req.auth.orgId, data: req.body, addedBy: req.auth.userId,
      });
      await audit(req, 'project.create', {
        entity: 'projects', entityId: id, detail: { code: req.body.code, name: req.body.name },
      });
      return res.status(201).json({ success: true, data: { id } });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── GET /projects/dashboard-summary ───────────────────────────
// MUST be registered BEFORE `/:id` — Express matches in order, so with the routes reversed the
// literal path would be swallowed and "dashboard-summary" would arrive as a project id.
// One permission-aware aggregate for the Portal console: a fixed number of queries whatever the
// project count (the per-project fan-out this replaces was an N+1), scoped exactly like every other
// read, with the money block omitted entirely for callers without `money.read` (§7.2.1).
router.get('/dashboard-summary', canReadProjects, async (req, res) => {
  try {
    const data = await ProjectService.dashboardSummary({
      orgId: req.auth.orgId, role: req.auth.role, userId: req.auth.userId,
      isOrgOwner: req.auth.isOrgOwner,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

// ── GET /projects/:id ─────────────────────────────────────────
router.get('/:id', canReadProjects, async (req, res) => {
  try {
    const data = await ProjectService.getProject({
      orgId: req.auth.orgId, role: req.auth.role, userId: req.auth.userId, id: req.params.id,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

// ── GET /projects/:id/site-map — server-mediated Google Static Map (xprojman-40
// §2). Same read gate as the project itself; the Google API key never reaches
// the browser (SiteMapService), and the image bytes are proxied through this
// authenticated endpoint — same "authenticated blob, not a public URL" shape
// GET /documents/:id already uses. Disk-cached by address, so a repeat view
// costs nothing against the (metered, billed) upstream API.
router.get('/:id/site-map', canReadProjects, async (req, res) => {
  try {
    const buffer = await SiteMapService.getSiteMap({ orgId: req.auth.orgId, projectId: req.params.id });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'private, max-age=86400');
    return res.send(buffer);
  } catch (err) {
    return sendError(res, err);
  }
});

// ── PATCH /projects/:id ───────────────────────────────────────
router.patch(
  '/:id',
  canWriteProjects,
  [
    body('code').optional().trim().notEmpty().isLength({ max: 30 }),
    body('name').optional().trim().notEmpty(),
    body('contract_type').optional({ nullable: true, checkFalsy: true }).isIn(['fixed_price', 'cost_plus']),
    body('status').optional().isIn(['draft', 'active', 'on_hold', 'completed', 'inactive', 'cancelled']),
    body('geofence_lat').optional({ nullable: true }).isFloat({ min: -90, max: 90 }),
    body('geofence_lng').optional({ nullable: true }).isFloat({ min: -180, max: 180 }),
    body('geofence_radius_m').optional({ nullable: true }).isInt({ min: 10, max: 5000 }),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      await ProjectService.updateProject({
        orgId: req.auth.orgId, id: req.params.id, data: req.body, addedBy: req.auth.userId,
      });
      await audit(req, 'project.update', {
        entity: 'projects', entityId: req.params.id, detail: { fields: Object.keys(req.body) },
      });
      return res.json({ success: true, data: { id: req.params.id } });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── DELETE /projects/:id ──────────────────────────────────────
// xprojman-35 (Portal Agent, 2026-09-04) — "a project that should never have
// existed" purge, gated to draft/no-progress-claims/no-job-awards/no-engagements
// (re-checked inside the transaction, not just here). Cancel — a project that DID do
// real work but was called off — is the existing PATCH { status: 'cancelled' }
// above; it keeps every row on purpose and needs no new code.
router.delete('/:id', canWriteProjects, async (req, res) => {
  try {
    await ProjectDeletionService.deleteProject({ orgId: req.auth.orgId, projectId: req.params.id });
    await audit(req, 'project.delete', { entity: 'projects', entityId: req.params.id });
    return res.json({ success: true, data: { id: req.params.id } });
  } catch (err) {
    return sendError(res, err);
  }
});

// ── POST /projects/:id/stages ─────────────────────────────────
router.post(
  '/:id/stages',
  canWriteProgramme,
  [
    body('name').trim().notEmpty().withMessage('A stage name is required'),
    body('seq').optional().isInt({ min: 0 }),
    body('status').optional().isIn(['pending', 'in_progress', 'complete', 'skipped']),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const { id } = await ProjectService.createStage({
        orgId: req.auth.orgId, projectId: req.params.id, data: req.body, auth: req.auth,
      });
      await audit(req, 'stage.create', {
        entity: 'project_stages', entityId: id,
        detail: { project_id: req.params.id, name: req.body.name },
      });
      return res.status(201).json({ success: true, data: { id } });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── PATCH /projects/:id/stages/:stageId ───────────────────────
router.patch(
  '/:id/stages/:stageId',
  canWriteProgramme,
  [
    body('name').optional().trim().notEmpty(),
    body('seq').optional().isInt({ min: 0 }),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      await ProjectService.updateStage({
        orgId: req.auth.orgId, projectId: req.params.id,
        stageId: req.params.stageId, data: req.body, auth: req.auth,
      });
      await audit(req, 'stage.update', {
        entity: 'project_stages', entityId: req.params.stageId,
        detail: { project_id: req.params.id, fields: Object.keys(req.body) },
      });
      return res.json({ success: true, data: { id: req.params.stageId } });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── POST /projects/:id/programme  { template_id } ─────────────
// Stamp the project's stages from a template (matrix Stage 9, web-first).
router.post(
  '/:id/programme',
  canWriteProgramme,
  [body('template_id').trim().notEmpty().withMessage('template_id is required')],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await StageTemplateService.instantiate({
        orgId: req.auth.orgId, projectId: req.params.id,
        templateId: req.body.template_id, actorUserId: req.auth.userId,
      });
      await audit(req, 'project.programme_instantiated', {
        entity: 'projects', entityId: req.params.id,
        detail: { template_id: req.body.template_id, stages: result.stagesCreated },
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── POST /projects/:id/stages/:stageId/advance  { to_status, milestone? } ─────
// The REST twin of a sync status push — runs the SAME progression gate (§10.4).
router.post(
  '/:id/stages/:stageId/advance',
  canWriteProgress,
  [
    body('to_status').isIn(StageProgressionService.STATUSES)
      .withMessage('to_status must be a valid stage status'),
    body('milestone').optional({ nullable: true }).isString().isLength({ max: 64 }),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await StageProgressionService.advance({
        orgId: req.auth.orgId, projectId: req.params.id, stageId: req.params.stageId,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        toStatus: req.body.to_status, milestone: req.body.milestone,
      });
      await audit(req, 'stage.advance', {
        entity: 'project_stages', entityId: req.params.stageId,
        detail: { project_id: req.params.id, to: req.body.to_status },
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── POST /projects/:id/stages/:stageId/validate  { result, reference?, note? } ─
// The inspector's hold-point gate (§10.5). quality.validate only — projectManager
// deliberately cannot self-validate (separation of duties, matrix).
router.post(
  '/:id/stages/:stageId/validate',
  canValidate,
  [
    body('result').isIn(['pass', 'fail']).withMessage('result must be pass or fail'),
    body('reference').optional({ nullable: true }).isString().isLength({ max: 100 }),
    body('note').optional({ nullable: true }).isString(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await StageProgressionService.validate({
        orgId: req.auth.orgId, projectId: req.params.id, stageId: req.params.stageId,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        result: req.body.result, reference: req.body.reference, note: req.body.note,
      });
      await audit(req, 'stage.validate', {
        entity: 'project_stages', entityId: req.params.stageId,
        detail: { project_id: req.params.id, result: req.body.result, reference: req.body.reference },
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── Hold-point checklist (DIRECTIVE 1 Step D2, 18-Stage spec §1.5) — a list per
// stage, not a single flag. Read is `projects.read`; satisfying one row needs
// whatever authority that ROW names (inspector/siteSupervisor/accountant/PM),
// checked inside HoldPointService.satisfy — no single blanket permission here.
router.get('/:id/stages/:stageId/hold-points', canReadProjects, async (req, res) => {
  try {
    const data = await HoldPointService.listForStage({
      orgId: req.auth.orgId, projectId: req.params.id, stageId: req.params.stageId,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

router.post('/:id/stages/:stageId/hold-points/:reqId/satisfy', async (req, res) => {
  try {
    const result = await HoldPointService.satisfy({
      orgId: req.auth.orgId, projectId: req.params.id, stageId: req.params.stageId,
      requirementId: req.params.reqId,
      actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
    });
    await audit(req, 'hold_point.satisfy', {
      entity: 'hold_point_requirements', entityId: req.params.reqId,
      detail: { project_id: req.params.id, stage_id: req.params.stageId },
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return sendError(res, err);
  }
});

// ── Project membership (the console's Team tab — §9.9.2, web-only in v1) ───────
//   GET    /projects/:id/members            who is on this job
//   POST   /projects/:id/members  {user_id}  add       (users.manage)
//   DELETE /projects/:id/members/:userId     remove    (users.manage)
//
// Membership is the resource-scope source, so who may edit it is deliberately the
// same capability that edits the org's people: `users.manage` (org_admin in v1).
// A grant/revoke flags the affected user's sessions for a full re-pull (§9.4).

router.get('/:id/members', canReadProjects, async (req, res) => {
  try {
    // Only someone who can reach the project may see its team.
    await ProjectService.getProject({
      orgId: req.auth.orgId, role: req.auth.role, userId: req.auth.userId, id: req.params.id,
    });
    const data = await MembershipService.listMembers({ orgId: req.auth.orgId, projectId: req.params.id });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

router.post(
  '/:id/members',
  canManageUsers,
  [body('user_id').trim().notEmpty().withMessage('user_id is required')],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await MembershipService.addMember({
        orgId: req.auth.orgId, projectId: req.params.id,
        userId: req.body.user_id, addedBy: req.auth.userId,
      });
      await audit(req, 'project.member_added', {
        entity: 'project_members', entityId: result.id,
        detail: { project_id: req.params.id, user_id: req.body.user_id },
      });
      return res.status(result.added ? 201 : 200).json({ success: true, data: result });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

router.delete('/:id/members/:userId', canManageUsers, async (req, res) => {
  try {
    await MembershipService.removeMember({
      orgId: req.auth.orgId, projectId: req.params.id, userId: req.params.userId,
    });
    await audit(req, 'project.member_removed', {
      entity: 'project_members', entityId: null,
      detail: { project_id: req.params.id, user_id: req.params.userId },
    });
    return res.json({ success: true, data: { removed: true } });
  } catch (err) {
    return sendError(res, err);
  }
});

// ── Quality (P6, servdesignspec §12) ────────────────────────────────────────────
// `inspection_items`/`defects`/`certificates` bodies ride /sync/push (offline-first,
// QualityOpsService governs that path); REST here is the portal review surface plus
// the one server-mediated action — completing an inspection, which drives a hold
// point's is_validated through the EXISTING StageProgressionService.validate (§12.2).

// ── POST /projects/:id/inspections  { type, stage_id?, is_hold_point?, scheduled_at?, notes? } ─
router.post(
  '/:id/inspections',
  canWriteQuality,
  [
    body('type').trim().notEmpty().withMessage('type is required'),
    body('stage_id').optional({ nullable: true }).isString(),
    body('is_hold_point').optional().isBoolean(),
    body('scheduled_at').optional({ nullable: true, checkFalsy: true }).isISO8601(),
    body('notes').optional({ nullable: true }).isString(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await InspectionService.create({
        orgId: req.auth.orgId, projectId: req.params.id,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        type: req.body.type, stageId: req.body.stage_id, isHoldPoint: req.body.is_hold_point,
        scheduledAt: req.body.scheduled_at, notes: req.body.notes,
      });
      await audit(req, 'inspection.create', {
        entity: 'inspections', entityId: result.id,
        detail: { project_id: req.params.id, type: req.body.type },
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── GET /projects/:id/inspections  (+items) ──────────────────────────────────────
router.get('/:id/inspections', canReadProjects, async (req, res) => {
  try {
    const data = await InspectionService.listInspections({
      orgId: req.auth.orgId, projectId: req.params.id,
      actor: { role: req.auth.role, userId: req.auth.userId },
    });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

// ── POST /projects/:id/inspections/:iid/complete  { result, reference?, document_id? } ─
// A hold-point PASS additionally needs quality.validate — enforced inside
// StageProgressionService.validate, so a projectManager cannot self-validate here
// either (separation of duties, §12.4).
router.post(
  '/:id/inspections/:iid/complete',
  canWriteQuality,
  [
    body('result').isIn(['pass', 'fail']).withMessage('result must be pass or fail'),
    body('reference').optional({ nullable: true }).isString().isLength({ max: 100 }),
    body('document_id').optional({ nullable: true }).isString(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await InspectionService.complete({
        orgId: req.auth.orgId, projectId: req.params.id,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        inspectionId: req.params.iid, result: req.body.result,
        reference: req.body.reference, documentId: req.body.document_id,
      });
      await audit(req, 'inspection.complete', {
        entity: 'inspections', entityId: req.params.iid,
        detail: { project_id: req.params.id, result: req.body.result },
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── GET /projects/:id/defects?status=  the punch-list ───────────────────────────
router.get(
  '/:id/defects',
  canReadProjects,
  [query('status').optional().isIn(['open', 'in_progress', 'closed'])],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const data = await InspectionService.listDefects({
        orgId: req.auth.orgId, projectId: req.params.id,
        actor: { role: req.auth.role, userId: req.auth.userId }, status: req.query.status,
      });
      return res.json({ success: true, data });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── GET /projects/:id/certificates  the cert register (+expiry) ─────────────────
router.get('/:id/certificates', canReadProjects, async (req, res) => {
  try {
    const data = await InspectionService.listCertificates({
      orgId: req.auth.orgId, projectId: req.params.id,
      actor: { role: req.auth.role, userId: req.auth.userId },
    });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

// ── Job Award (DIRECTIVE 1 Step B, servdesignspec §7.3) ─────────────────────────
// POST   /projects/:id/job-awards                send the S9.6 invitation (panel.manage;
//                                                 requires a pre-existing introduction)
// GET    /projects/:id/job-awards                review list
// POST   /projects/:id/job-awards/:jaId/respond   the S9.7 tap — only the invited person
// POST   /projects/:id/job-awards/:jaId/deposit   S9.9 — the binding deposit (panel.manage)
router.post(
  '/:id/job-awards',
  canManagePanel,
  [
    body('to_user_id').trim().notEmpty().withMessage('to_user_id is required'),
    body('role_offered').isIn(['builder', 'tradie', 'foreperson', 'subcontractor']),
    body('builder_engagement_type').optional({ nullable: true })
      .isIn(['employee', 'independent_fixed', 'independent_cost_plus']),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await JobAwardService.create({
        orgId: req.auth.orgId, projectId: req.params.id,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        toUserId: req.body.to_user_id, roleOffered: req.body.role_offered,
        builderEngagementType: req.body.builder_engagement_type,
      });
      await audit(req, 'job_award.create', {
        entity: 'job_awards', entityId: result.id,
        detail: { project_id: req.params.id, role_offered: req.body.role_offered, to_user_id: req.body.to_user_id },
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

router.get('/:id/job-awards', canReadProjects, async (req, res) => {
  try {
    const data = await JobAwardService.list({
      orgId: req.auth.orgId, projectId: req.params.id,
      actor: { role: req.auth.role, userId: req.auth.userId },
    });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

router.post(
  '/:id/job-awards/:jaId/respond',
  [body('accept').isBoolean().withMessage('accept must be true or false')],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await JobAwardService.respond({
        orgId: req.auth.orgId, projectId: req.params.id, jobAwardId: req.params.jaId,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        accept: req.body.accept, surface: req.auth.deviceUid ? 'app' : 'portal',
      });
      await audit(req, 'job_award.respond', {
        entity: 'job_awards', entityId: req.params.jaId,
        detail: { project_id: req.params.id, status: result.status },
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

router.post(
  '/:id/job-awards/:jaId/deposit',
  canManagePanel,
  [
    body('amount').isFloat({ gt: 0 }).withMessage('amount must be a positive number'),
    body('reference').optional({ nullable: true }).isString(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await JobAwardService.recordDeposit({
        orgId: req.auth.orgId, projectId: req.params.id, jobAwardId: req.params.jaId,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        amount: req.body.amount, reference: req.body.reference,
      });
      await audit(req, 'job_award.deposit', {
        entity: 'job_awards', entityId: req.params.jaId,
        detail: { project_id: req.params.id, amount: req.body.amount },
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── POST /projects/:id/tasks/:taskId/verify  the Site Supervisor's tick-then-verify ─
// (DIRECTIVE 1 Step A, servdesignspec §7.2). A device ticks tasks.completion via
// /sync/push (progress.tick, TaskProgressService.guardPush); this is the one
// server-mediated action that sets the protected verified_by/verified_at pair.
router.post('/:id/tasks/:taskId/verify', canVerifyProgress, async (req, res) => {
  try {
    const result = await TaskProgressService.verify({
      orgId: req.auth.orgId, projectId: req.params.id, taskId: req.params.taskId,
      actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
    });
    await audit(req, 'task.verify', {
      entity: 'tasks', entityId: req.params.taskId, detail: { project_id: req.params.id },
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return sendError(res, err);
  }
});

// ── PATCH /projects/:id/tasks/:taskId  office-side task edit ───────────────────
// No blanket permission middleware — the two field groups below sit behind
// DIFFERENT permissions, each checked inside its own service call, same pattern
// every other mixed-tier route in this file already uses:
//   output_note (xprojman-32) / status (xprojman-38, the ONLY path that may set
//     'cancelled'/'n_a', fully reversible) — projects.write, TaskProgressService.
//   skill_level / cost_centre_id (xprojman-39 §2) — money.write, CostingService.
// At least one field across BOTH groups is required. A caller holding only one
// of the two permissions may still patch the fields that permission covers —
// e.g. an `estimator` (money.write, no projects.write) can set a task's skill
// tier without being able to touch its output_note.
router.patch(
  '/:id/tasks/:taskId',
  [
    body('output_note').optional().isString(),
    body('status').optional().isIn(['not_started', 'in_progress', 'complete', 'cancelled', 'n_a']),
    body('skill_level').optional({ nullable: true }).isIn(CostingService.SKILL_LEVELS),
    body('cost_centre_id').optional({ nullable: true }).isString(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    const { output_note, status, skill_level, cost_centre_id } = req.body;
    if (output_note === undefined && status === undefined
        && skill_level === undefined && cost_centre_id === undefined) {
      return res.status(400).json({ success: false, message: 'Nothing to update', code: 'NO_FIELDS' });
    }
    try {
      let result = { id: req.params.taskId };
      if (output_note !== undefined || status !== undefined) {
        result = {
          ...result,
          ...await TaskProgressService.updateOfficeFields({
            orgId: req.auth.orgId, projectId: req.params.id, taskId: req.params.taskId,
            actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
            outputNote: output_note, status,
          }),
        };
      }
      if (skill_level !== undefined || cost_centre_id !== undefined) {
        result = {
          ...result,
          ...await CostingService.setTaskCosting({
            orgId: req.auth.orgId, projectId: req.params.id, taskId: req.params.taskId,
            actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
            skillLevel: skill_level, costCentreId: cost_centre_id,
          }),
        };
      }
      await audit(req, 'task.update', {
        entity: 'tasks', entityId: req.params.taskId,
        detail: { project_id: req.params.id, fields: Object.keys(req.body) },
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── POST /projects/:id/tasks — a hand-added, ad-hoc task under a stage ──────────
// (xprojman-38 §3; no create-task endpoint existed before this, confirmed by a
// full route audit). Same permission tier + Stage-range scoping as adding a
// STAGE itself (programme.write + assertProgrammeWriteScope) — a hand-added task
// is the same class of programme-shaping action.
router.post(
  '/:id/tasks',
  canWriteProgramme,
  [
    body('stage_id').trim().notEmpty().withMessage('stage_id is required'),
    body('name').trim().notEmpty().withMessage('A task name is required'),
    body('predecessor_id').optional({ nullable: true }).isString(),
    body('assigned_to').optional({ nullable: true }).isString(),
    body('budget_hours').optional({ nullable: true }).isFloat({ min: 0 }),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await TaskProgressService.createTask({
        orgId: req.auth.orgId, projectId: req.params.id,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        stageId: req.body.stage_id, name: req.body.name,
        predecessorId: req.body.predecessor_id, assignedTo: req.body.assigned_to,
        budgetHours: req.body.budget_hours,
      });
      await audit(req, 'task.create', {
        entity: 'tasks', entityId: result.id, detail: { project_id: req.params.id, stage_id: req.body.stage_id },
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── Commercial P7a — Cost Plan / estimate lines (xprojman-10 §4) ────────────────
// Writes gated by money.write; reads by money.read (enforced in EstimateService).
//   GET    /:id/cost-plan                 plan header + lines + total
//   POST   /:id/estimate-lines            add a line       (money.write)
//   PATCH  /:id/estimate-lines/:lineId    edit a line      (money.write)
//   DELETE /:id/estimate-lines/:lineId    remove a line    (money.write)
//   POST   /:id/cost-plan/lock  { locked } freeze/unfreeze  (money.write)
router.get('/:id/cost-plan', canReadProjects, async (req, res) => {
  try {
    const data = await EstimateService.list({
      orgId: req.auth.orgId, projectId: req.params.id,
      actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
    });
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err); }
});

router.post(
  '/:id/estimate-lines',
  canWriteMoney,
  [
    body('description').trim().notEmpty().withMessage('description is required'),
    body('stage_id').optional({ nullable: true }).isString(),
    body('category').optional({ nullable: true }).isString(),
    body('quantity').optional({ nullable: true }).isFloat({ min: 0 }),
    body('unit').optional({ nullable: true }).isString(),
    body('rate').optional({ nullable: true }).isFloat(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await EstimateService.createLine({
        orgId: req.auth.orgId, projectId: req.params.id,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        stageId: req.body.stage_id, description: req.body.description, category: req.body.category,
        quantity: req.body.quantity, unit: req.body.unit, rate: req.body.rate,
      });
      await audit(req, 'estimate_line.create', {
        entity: 'estimate_lines', entityId: result.id, detail: { project_id: req.params.id },
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

router.patch('/:id/estimate-lines/:lineId', canWriteMoney, async (req, res) => {
  try {
    const result = await EstimateService.updateLine({
      orgId: req.auth.orgId, projectId: req.params.id, lineId: req.params.lineId,
      actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
      patch: req.body || {},
    });
    return res.json({ success: true, data: result });
  } catch (err) { return sendError(res, err); }
});

router.delete('/:id/estimate-lines/:lineId', canWriteMoney, async (req, res) => {
  try {
    const result = await EstimateService.deleteLine({
      orgId: req.auth.orgId, projectId: req.params.id, lineId: req.params.lineId,
      actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
    });
    return res.json({ success: true, data: result });
  } catch (err) { return sendError(res, err); }
});

router.post(
  '/:id/cost-plan/lock',
  canWriteMoney,
  [body('locked').optional().isBoolean()],
  async (req, res) => {
    try {
      const result = await EstimateService.setLock({
        orgId: req.auth.orgId, projectId: req.params.id,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        locked: req.body.locked !== false,
      });
      await audit(req, 'cost_plan.lock', {
        entity: 'cost_plans', entityId: null, detail: { project_id: req.params.id, status: result.status },
      });
      return res.json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

// ── Commercial P7a — Progress claims (submit → approve → pay), §7.2 / §10.6 ─────────
//   GET  /:id/progress-claims                     list (money.read = all; submitter = own)
//   POST /:id/progress-claims                     Builder submits   (claims.submit)
//   POST /:id/progress-claims/:claimId/approve    PM approve/decline (claims.approve)
//   POST /:id/progress-claims/:claimId/pay        PM records payment (claims.approve)
// No projects.read middleware here: a Builder holds claims.submit but not necessarily
// projects.read, and must see their OWN claims. ClaimService.list is the authority
// (money.read → all; claims.submit → own; else 403) and checks project reachability.
router.get('/:id/progress-claims', async (req, res) => {
  try {
    const data = await ClaimService.list({
      orgId: req.auth.orgId, projectId: req.params.id,
      actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
    });
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err); }
});

router.post(
  '/:id/progress-claims',
  canSubmitClaims,
  [
    body('amount').isFloat({ gt: 0 }).withMessage('amount must be a positive number'),
    body('stage_id').optional({ nullable: true }).isString(),
    body('note').optional({ nullable: true }).isString(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await ClaimService.submit({
        orgId: req.auth.orgId, projectId: req.params.id,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        stageId: req.body.stage_id, amount: req.body.amount, note: req.body.note,
      });
      await audit(req, 'progress_claim.submit', {
        entity: 'progress_claims', entityId: result.id, detail: { project_id: req.params.id },
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

router.post(
  '/:id/progress-claims/:claimId/approve',
  canApproveClaims,
  [body('accept').optional().isBoolean()],
  async (req, res) => {
    try {
      const result = await ClaimService.approve({
        orgId: req.auth.orgId, projectId: req.params.id, claimId: req.params.claimId,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        accept: req.body.accept !== false,
      });
      await audit(req, 'progress_claim.approve', {
        entity: 'progress_claims', entityId: req.params.claimId,
        detail: { project_id: req.params.id, status: result.status },
      });
      return res.json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

router.post(
  '/:id/progress-claims/:claimId/pay',
  canApproveClaims,
  [body('reference').optional({ nullable: true }).isString()],
  async (req, res) => {
    try {
      const result = await ClaimService.pay({
        orgId: req.auth.orgId, projectId: req.params.id, claimId: req.params.claimId,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        reference: req.body.reference,
      });
      await audit(req, 'progress_claim.pay', {
        entity: 'progress_claims', entityId: req.params.claimId,
        detail: { project_id: req.params.id, payment_id: result.payment_id },
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

// ── Commercial P7b — Procurement: purchase orders + supplier invoices ───────────────
// (xprojman-10 §4 P7b, CORRECTED by xprojman-16; §7.2 / §7.2.1). Writes gated by po.write;
// reads by money.read OR po.write, then filtered by engagement mode + owner_party in
// ProcurementService (a Builder's PO/invoice rows are invisible to the PM under
// independent_fixed). POs → committed_amount, matched/approved invoices → actual_amount.
//   GET  /:id/purchase-orders                    list (engagement-mode filtered)
//   POST /:id/purchase-orders                    raise a PO           (po.write)
//   POST /:id/purchase-orders/:poId/status       issue/receive/cancel (po.write, own scope)
//   GET  /:id/supplier-invoices                  list (engagement-mode filtered)
//   POST /:id/supplier-invoices                  record an invoice    (po.write; po_id = 2-way match)
//   POST /:id/supplier-invoices/:invId/status    match/approve/dispute (po.write, own scope)
router.get('/:id/purchase-orders', async (req, res) => {
  try {
    const data = await ProcurementService.listPurchaseOrders({
      orgId: req.auth.orgId, projectId: req.params.id,
      actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
    });
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err); }
});

router.post(
  '/:id/purchase-orders',
  canWritePo,
  [
    body('amount').isFloat({ min: 0 }).withMessage('amount must be a non-negative number'),
    body('stage_id').optional({ nullable: true }).isString(),
    body('task_id').optional({ nullable: true }).isString(),
    body('supplier_id').optional({ nullable: true }).isString(),
    body('supplier_name').optional({ nullable: true }).isString(),
    body('description').optional({ nullable: true }).isString(),
    body('subcontractor_engagement_id').optional({ nullable: true }).isString(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await ProcurementService.createPurchaseOrder({
        orgId: req.auth.orgId, projectId: req.params.id,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        stageId: req.body.stage_id, taskId: req.body.task_id, supplierId: req.body.supplier_id,
        supplierName: req.body.supplier_name,
        description: req.body.description, amount: req.body.amount,
        subcontractorEngagementId: req.body.subcontractor_engagement_id,
      });
      await audit(req, 'purchase_order.create', {
        entity: 'purchase_orders', entityId: result.id,
        detail: { project_id: req.params.id, owner_party: result.owner_party },
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

router.post(
  '/:id/purchase-orders/:poId/status',
  canWritePo,
  [body('status').isIn(['issued', 'received', 'cancelled'])],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await ProcurementService.setPoStatus({
        orgId: req.auth.orgId, projectId: req.params.id, poId: req.params.poId,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        status: req.body.status,
      });
      await audit(req, 'purchase_order.status', {
        entity: 'purchase_orders', entityId: req.params.poId,
        detail: { project_id: req.params.id, status: result.status },
      });
      return res.json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

router.get('/:id/supplier-invoices', async (req, res) => {
  try {
    const data = await ProcurementService.listSupplierInvoices({
      orgId: req.auth.orgId, projectId: req.params.id,
      actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
    });
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err); }
});

router.post(
  '/:id/supplier-invoices',
  canWritePo,
  [
    body('invoice_number').trim().notEmpty().withMessage('invoice_number is required'),
    body('amount').isFloat({ min: 0 }).withMessage('amount must be a non-negative number'),
    body('po_id').optional({ nullable: true }).isString(),
    body('stage_id').optional({ nullable: true }).isString(),
    body('task_id').optional({ nullable: true }).isString(),
    body('supplier_id').optional({ nullable: true }).isString(),
    body('supplier_name').optional({ nullable: true }).isString(),
    body('subcontractor_engagement_id').optional({ nullable: true }).isString(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await ProcurementService.createSupplierInvoice({
        orgId: req.auth.orgId, projectId: req.params.id,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        poId: req.body.po_id, stageId: req.body.stage_id, taskId: req.body.task_id,
        supplierId: req.body.supplier_id,
        supplierName: req.body.supplier_name, invoiceNumber: req.body.invoice_number,
        amount: req.body.amount, subcontractorEngagementId: req.body.subcontractor_engagement_id,
      });
      await audit(req, 'supplier_invoice.create', {
        entity: 'supplier_invoices', entityId: result.id,
        detail: { project_id: req.params.id, matched: result.matched },
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

router.post(
  '/:id/supplier-invoices/:invId/status',
  canWritePo,
  [body('status').isIn(['matched', 'approved', 'disputed'])],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await ProcurementService.setInvoiceStatus({
        orgId: req.auth.orgId, projectId: req.params.id, invoiceId: req.params.invId,
        actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
        status: req.body.status,
      });
      await audit(req, 'supplier_invoice.status', {
        entity: 'supplier_invoices', entityId: req.params.invId,
        detail: { project_id: req.params.id, status: result.status },
      });
      return res.json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

// GET /:id/subcontractor-register — §1.4 step-in-rights window: per-subcontractor
// who/committed/owed AGGREGATES, visible to the PM even under independent_fixed (where the
// PO/invoice ROWS stay hidden). money.read OR po.write. Owner-ruled 2026-08-01; a separate
// aggregate-only view, never line detail (ProcurementService.subcontractorRegister).
router.get('/:id/subcontractor-register', async (req, res) => {
  try {
    const data = await ProcurementService.subcontractorRegister({
      orgId: req.auth.orgId, projectId: req.params.id,
      actor: { orgId: req.auth.orgId, userId: req.auth.userId, role: req.auth.role },
    });
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err); }
});

// ── Commercial P7c — Contracts + Variations (xprojman-10 §4c) ───────────────────────
// Contract writes reuse money.write; reads by money.read (enforced in ContractService).
// variations.raise = PM; variations.approve = client (DORMANT until P10 — a PM is refused).
//   GET  /:id/contracts                  list contracts (+ effective_value roll-up)
//   POST /:id/contracts                  create a contract      (money.write)
//   GET  /:id/variations                 list variations
//   POST /:id/variations                 raise a variation      (variations.raise)
//   POST /:id/variations/:vid/approve    Client approves/declines (variations.approve — P10)
router.get('/:id/contracts', async (req, res) => {
  try {
    const data = await ContractService.listContracts({
      orgId: req.auth.orgId, projectId: req.params.id,
      actor: { role: req.auth.role, userId: req.auth.userId },
    });
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err); }
});

router.post(
  '/:id/contracts',
  canWriteMoney,
  [
    body('party_type').isIn(['client', 'subcontractor', 'supplier']),
    body('contract_value').optional({ nullable: true }).isFloat({ min: 0 }),
    body('retention_pct').optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
    body('party_user_id').optional({ nullable: true }).isString(),
    body('party_name').optional({ nullable: true }).isString(),
    body('title').optional({ nullable: true }).isString(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await ContractService.createContract({
        orgId: req.auth.orgId, projectId: req.params.id,
        actor: { role: req.auth.role, userId: req.auth.userId },
        partyType: req.body.party_type, partyUserId: req.body.party_user_id, partyName: req.body.party_name,
        title: req.body.title, contractValue: req.body.contract_value, retentionPct: req.body.retention_pct,
      });
      await audit(req, 'contract.create', {
        entity: 'contracts', entityId: result.id,
        detail: { project_id: req.params.id, party_type: result.party_type },
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

router.get('/:id/variations', async (req, res) => {
  try {
    const data = await ContractService.listVariations({
      orgId: req.auth.orgId, projectId: req.params.id,
      actor: { role: req.auth.role, userId: req.auth.userId },
    });
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err); }
});

router.post(
  '/:id/variations',
  canRaiseVariation,
  [
    body('description').trim().notEmpty().withMessage('description is required'),
    body('amount').optional({ nullable: true }).isFloat(),
    body('contract_id').optional({ nullable: true }).isString(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await ContractService.raiseVariation({
        orgId: req.auth.orgId, projectId: req.params.id,
        actor: { role: req.auth.role, userId: req.auth.userId },
        contractId: req.body.contract_id, description: req.body.description, amount: req.body.amount,
      });
      await audit(req, 'variation.raise', {
        entity: 'variations', entityId: result.id,
        detail: { project_id: req.params.id, amount: req.body.amount },
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

router.post(
  '/:id/variations/:vid/approve',
  [body('accept').optional().isBoolean()],
  async (req, res) => {
    try {
      const result = await ContractService.respondVariation({
        orgId: req.auth.orgId, projectId: req.params.id, variationId: req.params.vid,
        actor: { role: req.auth.role, userId: req.auth.userId },
        accept: req.body.accept !== false,
      });
      await audit(req, 'variation.approve', {
        entity: 'variations', entityId: req.params.vid,
        detail: { project_id: req.params.id, status: result.status },
      });
      return res.json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

// ── Project Brief snapshots (xprojman-41 §3/§8/§9) — an append-only PDF
// history: "Formalize Brief"/"Re-issue Brief PDF" (variation_id omitted) or
// auto-generated by ContractService.respondVariation on approval
// (variation_id set). projects.write to generate, projects.read to list/view
// — same tier as the project fields the brief is built from.
//   POST /:id/brief-snapshots           formalize/re-issue      (projects.write)
//   GET  /:id/brief-snapshots           list history            (projects.read)
//   GET  /:id/brief-snapshots/:sid      PDF bytes, authenticated (projects.read)
router.post('/:id/brief-snapshots', async (req, res) => {
  try {
    const result = await ProjectBriefService.generateSnapshot({
      orgId: req.auth.orgId, projectId: req.params.id,
      actor: { role: req.auth.role, userId: req.auth.userId },
    });
    await audit(req, 'project_brief.snapshot', {
      entity: 'project_brief_snapshots', entityId: result.id, detail: { project_id: req.params.id },
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) { return sendError(res, err); }
});

router.get('/:id/brief-snapshots', async (req, res) => {
  try {
    const data = await ProjectBriefService.listSnapshots({
      orgId: req.auth.orgId, projectId: req.params.id,
      actor: { role: req.auth.role, userId: req.auth.userId },
    });
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err); }
});

router.get('/:id/brief-snapshots/:sid', async (req, res) => {
  try {
    const snapshot = await ProjectBriefService.getSnapshotForStream({
      orgId: req.auth.orgId, projectId: req.params.id, snapshotId: req.params.sid,
      actor: { role: req.auth.role, userId: req.auth.userId },
    });
    res.setHeader('Content-Type', 'application/pdf');
    // pool.js runs with dateStrings, so generated_at already arrives as a plain string.
    res.setHeader('Content-Disposition', `inline; filename="project-brief-${snapshot.generated_at}.pdf"`);
    return storage.getStream(snapshot.storage_key).pipe(res);
  } catch (err) { return sendError(res, err); }
});

// ── Accounting P8a — Fixed assets & depreciation (serverdesignspec §11.2, v022) ─────
// S18.11 = the system-prepared draft; S18.12 = the accountant's tax.approve write.
// Asset entry is an explicit declaration (money.write) — see the decision note at the top
// of DepreciationService for why deriving from capital supplier_invoices is not buildable yet.
//   GET  /:id/fixed-assets                    the register + schedules (money.read | tax.approve)
//   POST /:id/fixed-assets                    declare an asset            (money.write)
//   POST /:id/fixed-assets/prepare-draft      S18.11 prepare schedules    (money.write)
//   POST /:id/fixed-assets/:assetId/approve   S18.12 draft → approved     (tax.approve)
router.get(
  '/:id/fixed-assets',
  [query('status').optional().isIn(['draft', 'approved'])],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const data = await DepreciationService.listAssets({
        orgId: req.auth.orgId, projectId: req.params.id,
        actor: { role: req.auth.role, userId: req.auth.userId }, status: req.query.status,
      });
      return res.json({ success: true, data });
    } catch (err) { return sendError(res, err); }
  }
);

router.post(
  '/:id/fixed-assets',
  canWriteMoney,
  [
    body('description').trim().notEmpty().withMessage('description is required'),
    body('acquisition_cost').optional({ nullable: true }).isFloat({ min: 0 }),
    body('acquired_at').optional({ nullable: true, checkFalsy: true }).isISO8601(),
    body('method').optional().isIn(['prime_cost', 'diminishing_value']),
    body('effective_life_years').optional({ nullable: true }).isFloat({ min: 0.01 }),
    body('category').optional({ nullable: true }).isString(),
    body('source_supplier_invoice_id').optional({ nullable: true }).isString(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await DepreciationService.createAsset({
        orgId: req.auth.orgId, projectId: req.params.id,
        actor: { role: req.auth.role, userId: req.auth.userId },
        description: req.body.description, category: req.body.category,
        acquisitionCost: req.body.acquisition_cost, acquiredAt: req.body.acquired_at,
        method: req.body.method, effectiveLifeYears: req.body.effective_life_years,
        sourceSupplierInvoiceId: req.body.source_supplier_invoice_id,
      });
      await audit(req, 'fixed_asset.create', {
        entity: 'fixed_assets', entityId: result.id,
        detail: { project_id: req.params.id, description: req.body.description },
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

router.post('/:id/fixed-assets/prepare-draft', canWriteMoney, async (req, res) => {
  try {
    const result = await DepreciationService.prepareDraft({
      orgId: req.auth.orgId, projectId: req.params.id,
      actor: { role: req.auth.role, userId: req.auth.userId },
    });
    await audit(req, 'depreciation.prepare_draft', {
      entity: 'fixed_assets', entityId: req.params.id,
      detail: { project_id: req.params.id, prepared: result.prepared_count, skipped: result.skipped.length },
    });
    return res.json({ success: true, data: result });
  } catch (err) { return sendError(res, err); }
});

router.post('/:id/fixed-assets/:assetId/approve', canApproveTax, async (req, res) => {
  try {
    const result = await DepreciationService.approveAsset({
      orgId: req.auth.orgId, projectId: req.params.id, assetId: req.params.assetId,
      actor: { role: req.auth.role, userId: req.auth.userId },
    });
    await audit(req, 'fixed_asset.approve', {
      entity: 'fixed_assets', entityId: req.params.assetId,
      detail: { project_id: req.params.id, status: result.status },
    });
    return res.json({ success: true, data: result });
  } catch (err) { return sendError(res, err); }
});

module.exports = router;
