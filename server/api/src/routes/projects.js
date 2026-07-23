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

router.use(authenticate);

// Capabilities, not role lists (§9). Adding a role that may write projects is a
// matrix row; this line never changes.
const canReadProjects = requirePermission('projects.read');
const canWriteProjects = requirePermission('projects.write');
const canWriteProgramme = requirePermission('programme.write');
const canWriteProgress = requirePermission('progress.write');
const canValidate = requirePermission('quality.validate');
const canManageUsers = requirePermission('users.manage');

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

module.exports = router;
