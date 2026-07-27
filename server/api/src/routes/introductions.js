// Mounted at /introductions — the QR business-card swap (DIRECTIVE 1 Step B,
// servdesignspecification.md §7.3). Peer-to-peer, no project/permission gate beyond
// being an authenticated user in the org — see IntroductionService's header for why.
//
// Contract confirmed with the App Team (xprojman-03 §A → xprojman-04):
//   POST /introductions/code            → { code, expires_in }   (issuer renders QR)
//   POST /introductions/scan { code }   → { id?, alreadyIntroduced, contact }
//   GET  /introductions                 → { contacts: [...] }
// There is deliberately NO raw "create by user_id" endpoint — the scan is the only
// create path (forgery-resistance for the job_awards cold-stranger constraint).

const router = require('express').Router();
const { body, validationResult } = require('express-validator');

const { authenticate } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const IntroductionService = require('../services/IntroductionService');

router.use(authenticate);

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({ success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path });
  return true;
}

// POST /introductions/code — mint the caller's own short-lived QR code.
router.post('/code', async (req, res) => {
  try {
    const data = IntroductionService.issueCode({ orgId: req.auth.orgId, userId: req.auth.userId });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

// POST /introductions/scan — record an introduction from a scanned code.
router.post(
  '/scan',
  [
    body('code').trim().notEmpty().withMessage('code is required'),
    body('device_signature').optional().isString(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await IntroductionService.scanCode({
        orgId: req.auth.orgId, scannerUserId: req.auth.userId,
        code: req.body.code, deviceSignature: req.body.device_signature,
      });
      if (!result.alreadyIntroduced) {
        await audit(req, 'introduction.create', {
          entity: 'introductions', entityId: result.id, detail: { with: result.contact?.user_id },
        });
      }
      return res.status(result.alreadyIntroduced ? 200 : 201).json({ success: true, data: result });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// GET /introductions — the caller's contact book.
router.get('/', async (req, res) => {
  try {
    const data = await IntroductionService.listContacts({ orgId: req.auth.orgId, userId: req.auth.userId });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

module.exports = router;
