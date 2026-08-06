// Mounted at /engagements — PM2-02's cross-org bridge (serverdesignspec §13).
// Same QR-handshake shape as /introductions, but this is the one place the org
// boundary is deliberately crossed (xprojman-18 Q2) — see EngagementService's header.

const router = require('express').Router();
const { body, validationResult } = require('express-validator');

const { authenticate } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const EngagementService = require('../services/EngagementService');

router.use(authenticate);

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({ success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path });
  return true;
}

// POST /engagements/initiate — engaging-org principal mints a signed QR code.
router.post(
  '/initiate',
  [
    body('project_id').trim().notEmpty().withMessage('project_id is required'),
    body('role').trim().notEmpty().withMessage('role is required'),
    body('scope_json').optional(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const data = await EngagementService.initiate({
        orgId: req.auth.orgId, projectId: req.body.project_id,
        actor: { role: req.auth.role, userId: req.auth.userId },
        role: req.body.role, scopeJson: req.body.scope_json,
      });
      return res.json({ success: true, data });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// POST /engagements/request — the scanning party posts the code, creates `pending`.
router.post(
  '/request',
  [body('code').trim().notEmpty().withMessage('code is required')],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await EngagementService.request({
        actorUserId: req.auth.userId, code: req.body.code,
      });
      if (!result.alreadyRequested) {
        await audit(req, 'engagement.request', { entity: 'engagements', entityId: result.id });
      }
      return res.status(result.alreadyRequested ? 200 : 201).json({ success: true, data: result });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// GET /engagements/pending — engaging-org principal, inbound requests.
router.get('/pending', async (req, res) => {
  try {
    const data = await EngagementService.pending({
      orgId: req.auth.orgId, actor: { role: req.auth.role, userId: req.auth.userId },
    });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

// POST /engagements/:id/confirm — engaging-org principal activates the grant.
router.post('/:id/confirm', async (req, res) => {
  try {
    const data = await EngagementService.confirm({
      orgId: req.auth.orgId, engagementId: req.params.id,
      actor: { role: req.auth.role, userId: req.auth.userId },
      scopeJson: req.body.scope_json,
    });
    await audit(req, 'engagement.confirm', { entity: 'engagements', entityId: req.params.id });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

// POST /engagements/:id/activate — the engaged person, self. Mints the second token.
router.post('/:id/activate', async (req, res) => {
  try {
    const { readDevice } = require('../lib/tokens');
    const data = await EngagementService.activate({
      engagementId: req.params.id,
      actor: { userId: req.auth.userId },
      device: readDevice(req.body),
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

// POST /engagements/:id/revoke — engaging-org principal, server-driven tombstone.
router.post('/:id/revoke', async (req, res) => {
  try {
    const data = await EngagementService.revoke({
      orgId: req.auth.orgId, engagementId: req.params.id,
      actor: { role: req.auth.role, userId: req.auth.userId },
    });
    await audit(req, 'engagement.revoke', { entity: 'engagements', entityId: req.params.id });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

module.exports = router;
