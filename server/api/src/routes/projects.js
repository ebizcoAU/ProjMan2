// Mounted at /projects — transport only. The rules live in services/ProjectService.js.
//
//   GET    /projects                       list (filter: ?status=, paginate)
//   POST   /projects                       create           (org_admin | project_developer)
//   GET    /projects/:id                   detail + stages + tasks
//   PATCH  /projects/:id                   update           (org_admin | project_developer)
//   POST   /projects/:id/stages            add a stage      (admin | developer | manager)
//   PATCH  /projects/:id/stages/:stageId   edit a stage     (admin | developer | manager)
//
// The web console is the system of record for project structure (projman-01 §4);
// the field app receives every write here through /sync/pull and pushes progress
// (stage status, task completion) through /sync/push. Financial columns are
// role-redacted in the service — the same rule the sync pull applies.

const router = require('express').Router();
const { body, query, validationResult } = require('express-validator');

const { authenticate, requireRole } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const ProjectService = require('../services/ProjectService');

router.use(authenticate);

const canStructure = requireRole('org_admin', 'project_developer');
const canProgramme = requireRole('org_admin', 'project_developer', 'project_manager');

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
  canStructure,
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
      const { id } = await ProjectService.createProject({ orgId: req.auth.orgId, data: req.body });
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
router.get('/:id', async (req, res) => {
  try {
    const data = await ProjectService.getProject({
      orgId: req.auth.orgId, role: req.auth.role, id: req.params.id,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

// ── PATCH /projects/:id ───────────────────────────────────────
router.patch(
  '/:id',
  canStructure,
  [
    body('code').optional().trim().notEmpty().isLength({ max: 30 }),
    body('name').optional().trim().notEmpty(),
    body('contract_type').optional({ nullable: true, checkFalsy: true }).isIn(['fixed_price', 'cost_plus']),
    body('status').optional().isIn(['draft', 'active', 'on_hold', 'completed', 'archived']),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      await ProjectService.updateProject({ orgId: req.auth.orgId, id: req.params.id, data: req.body });
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
  canProgramme,
  [
    body('name').trim().notEmpty().withMessage('A stage name is required'),
    body('seq').optional().isInt({ min: 0 }),
    body('status').optional().isIn(['pending', 'in_progress', 'complete', 'skipped']),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const { id } = await ProjectService.createStage({
        orgId: req.auth.orgId, projectId: req.params.id, data: req.body,
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
  canProgramme,
  [
    body('name').optional().trim().notEmpty(),
    body('seq').optional().isInt({ min: 0 }),
    body('status').optional().isIn(['pending', 'in_progress', 'complete', 'skipped']),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      await ProjectService.updateStage({
        orgId: req.auth.orgId, projectId: req.params.id,
        stageId: req.params.stageId, data: req.body,
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

module.exports = router;
