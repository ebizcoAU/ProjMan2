// Checklists REST (xprojman-46 §5 as amended by §7, migration v047). The App executes
// through /sync/push; this is the Portal's surface — author templates, review results.
//
// Mounted at /checklist-templates:
//   GET    /                    org + system templates, items inline (manage OR execute)
//   GET    /:id                 one template + items                 (manage OR execute)
//   POST   /                    create, or { copy_from } a draft copy          (manage)
//   PATCH  /:id                 edit; `items` replaces the set, allowed while published
//   DELETE /:id                 soft delete                                     (manage)
//   POST   /:id/publish | /:id/unpublish                                        (manage)
//
// Mounted at /checklists:
//   GET    /:id                 an instance + items + sign-offs, evidence embedded
//
// Mounted at /projects (projectRouter):
//   GET    /:id/checklists      review list, filters + cursor paging            (manage)

const express = require('express');
const { authenticate, requirePermission } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const access = require('../lib/access');
const ChecklistService = require('../services/ChecklistService');

const canManage = requirePermission('checklists.manage');
// Reading templates: the author, or a device that runs them.
function canReadTemplates(req, res, next) {
  const principal = { role: req.auth.role, isOrgOwner: req.auth.isOrgOwner };
  if (access.grants(principal, 'checklists.manage') || access.grants(principal, 'checklists.execute')) return next();
  return res.status(403).json({ success: false, message: 'Requires permission: checklists.manage or checklists.execute', code: 'FORBIDDEN' });
}
const authOf = (req) => ({ role: req.auth.role, userId: req.auth.userId });
const wrap = (fn) => async (req, res) => {
  try {
    const { status = 200, data } = await fn(req);
    return res.status(status).json({ success: true, data });
  } catch (err) { return sendError(res, err); }
};

const templates = express.Router();
templates.use(authenticate);
templates.get('/', canReadTemplates, wrap(async (req) => ({
  data: await ChecklistService.listTemplates({ orgId: req.auth.orgId }),
})));
templates.get('/:id', canReadTemplates, wrap(async (req) => ({
  data: await ChecklistService.getTemplate({ orgId: req.auth.orgId, id: req.params.id }),
})));
templates.post('/', canManage, wrap(async (req) => ({
  status: 201,
  data: await ChecklistService.createTemplate({
    orgId: req.auth.orgId, actor: { userId: req.auth.userId }, body: req.body || {},
  }),
})));
templates.patch('/:id', canManage, wrap(async (req) => ({
  data: await ChecklistService.updateTemplate({ orgId: req.auth.orgId, id: req.params.id, body: req.body || {} }),
})));
templates.delete('/:id', canManage, wrap(async (req) => ({
  data: await ChecklistService.deleteTemplate({ orgId: req.auth.orgId, id: req.params.id }),
})));
templates.post('/:id/publish', canManage, wrap(async (req) => ({
  data: await ChecklistService.setPublished({ orgId: req.auth.orgId, id: req.params.id, published: true }),
})));
templates.post('/:id/unpublish', canManage, wrap(async (req) => ({
  data: await ChecklistService.setPublished({ orgId: req.auth.orgId, id: req.params.id, published: false }),
})));

const instances = express.Router();
instances.use(authenticate);
instances.get('/:id', canManage, wrap(async (req) => ({
  data: await ChecklistService.getInstance({ orgId: req.auth.orgId, auth: authOf(req), id: req.params.id }),
})));

const projectRouter = express.Router();
projectRouter.get('/:id/checklists', authenticate, canManage, wrap(async (req) => ({
  data: await ChecklistService.listForProject({
    orgId: req.auth.orgId, auth: authOf(req), projectId: req.params.id, query: req.query,
  }),
})));

module.exports = { templates, instances, projectRouter };
