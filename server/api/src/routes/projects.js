// Mounted at /projects — transport only. The rules live in services/ProjectService.js.
//
//   GET    /projects                       list (filter: ?status=, paginate)
//   POST   /projects                       create           (org_admin | project_developer)
//   GET    /projects/:id                   detail + stages + tasks
//   PATCH  /projects/:id                   update           (org_admin | project_developer)
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
    query('status').optional().isIn(['draft', 'active', 'on_hold', 'completed', 'archived']),
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
    body('status').optional().isIn(['draft', 'active', 'on_hold', 'completed', 'archived']),
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

// ── PATCH /projects/:id ───────────────────────────────────────
router.patch(
  '/:id',
  canWriteProjects,
  [
    body('code').optional().trim().notEmpty().isLength({ max: 30 }),
    body('name').optional().trim().notEmpty(),
    body('contract_type').optional({ nullable: true, checkFalsy: true }).isIn(['fixed_price', 'cost_plus']),
    body('status').optional().isIn(['draft', 'active', 'on_hold', 'completed', 'archived']),
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

module.exports = router;
