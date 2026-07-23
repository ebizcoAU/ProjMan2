// Mounted at /stage-templates — the programme library (servdesignspec §10.8).
//
//   GET  /stage-templates       system templates + this org's
//   GET  /stage-templates/:id   a template + its ordered items
//
// Read surface for the instantiation UI (web, matrix Stage 9). Cloning/creating org
// templates (POST) is deferred — v1 instantiates from the WA_RESIDENTIAL_18 system
// template; org-custom templates land when a builder needs to diverge.

const router = require('express').Router();
const { authenticate, requirePermission } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const StageTemplateService = require('../services/StageTemplateService');

router.use(authenticate);

// Reading templates is part of planning — same capability that writes the programme.
const canReadTemplates = requirePermission('projects.read');

router.get('/', canReadTemplates, async (req, res) => {
  try {
    const data = await StageTemplateService.listTemplates({ orgId: req.auth.orgId });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

router.get('/:id', canReadTemplates, async (req, res) => {
  try {
    const data = await StageTemplateService.getTemplate({ orgId: req.auth.orgId, id: req.params.id });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

module.exports = router;
