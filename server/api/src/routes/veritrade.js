// Mounted at /veritrade — VeriTrade V1 backend (veritradedesignspecification.md).
//
// GET   /veritrade/profiles/:userId       — public teaser (§5.1). NO auth — cacheable,
//                                            indexable, deliberately thin.
// GET   /veritrade/profiles/:userId/full  — gated full profile (§5.2). Any logged-in
//                                            App identity (V1: login-gated, subscription
//                                            entitlement deferred).
// PATCH /veritrade/profile                — self-service publish toggle + profile fields.
// GET   /veritrade/search                 — demand side (§10), teaser-level rows only.
// POST  /veritrade/profiles/:userId/engage — the discovery-to-relationship loop (§7).

const router = require('express').Router();
const { body, query, validationResult } = require('express-validator');

const { authenticate } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const VeriTradeService = require('../services/VeriTradeService');

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({ success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path });
  return true;
}

// GET /veritrade/profiles/:userId — public, no auth.
router.get('/profiles/:userId', async (req, res) => {
  try {
    const data = await VeriTradeService.publicTeaser(req.params.userId);
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

// GET /veritrade/profiles/:userId/full — B2B login required.
router.get('/profiles/:userId/full', authenticate, async (req, res) => {
  try {
    const data = await VeriTradeService.fullProfile(req.params.userId);
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

// PATCH /veritrade/profile — the profile owner, self-scoped by construction.
router.patch(
  '/profile',
  authenticate,
  [
    body('published').optional().isBoolean(),
    body('trade_classification').optional({ nullable: true }).trim(),
    body('service_region').optional({ nullable: true }).trim(),
    body('licence_number').optional({ nullable: true }).trim(),
    body('licence_state').optional({ nullable: true }).trim(),
    body('disclose_financials').optional().isBoolean(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const data = await VeriTradeService.updateProfile({
        userId: req.auth.userId,
        published: req.body.published,
        tradeClassification: req.body.trade_classification,
        serviceRegion: req.body.service_region,
        licenceNumber: req.body.licence_number,
        licenceState: req.body.licence_state,
        discloseFinancials: req.body.disclose_financials,
      });
      return res.json({ success: true, data });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// GET /veritrade/search — B2B login required.
router.get(
  '/search',
  authenticate,
  [
    query('trade').optional().trim(),
    query('licence_state').optional().trim(),
    query('region').optional().trim(),
    query('min_verified_projects').optional().isInt({ min: 0 }),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const data = await VeriTradeService.search({
        trade: req.query.trade, licenceState: req.query.licence_state,
        region: req.query.region, minVerifiedProjects: req.query.min_verified_projects,
      });
      return res.json({ success: true, data });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// POST /veritrade/profiles/:userId/engage — B2B login required.
router.post('/profiles/:userId/engage', authenticate, async (req, res) => {
  try {
    const data = await VeriTradeService.engage({
      actorOrgId: req.auth.orgId, actorUserId: req.auth.userId, targetUserId: req.params.userId,
    });
    if (!data.alreadyIntroduced) {
      await audit(req, 'veritrade.engage', { entity: 'introductions', entityId: data.id });
    }
    return res.status(data.alreadyIntroduced ? 200 : 201).json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

module.exports = router;
