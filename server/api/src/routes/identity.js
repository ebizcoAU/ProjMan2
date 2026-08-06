// Mounted at /identity — PM2-02's evidence surface (serverdesignspec §13.4).
//
// GET /identity/evidence        — the owner, full detail (self-scoped by construction).
// POST /identity/share          — the owner mints a signed, time-boxed grant token —
//                                  same stateless-code shape as /introductions and
//                                  /engagements (no new table for v1: a "who did I
//                                  grant, and when does it expire" question a signed
//                                  JWT already answers without persisting a grants row).
// GET /identity/:id/profile     — a third party presents that token; issuing_org_id
//                                  is REDACTED here regardless (decision #28 — only
//                                  the subject's OWN /identity/evidence read is full).

const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { query } = require('express-validator');

const { authenticate } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { ServiceError } = require('../services/errors');
const config = require('../config');
const AttestationService = require('../services/AttestationService');

// A share grant is handed to a viewer to use over some window, not scanned
// face-to-face — deliberately longer-lived than the 5-min QR codes elsewhere.
const SHARE_TTL_SECONDS = 24 * 60 * 60;

router.use(authenticate);

// GET /identity/evidence — the owner's own attestation set + trust score, full detail.
router.get('/evidence', async (req, res) => {
  try {
    const data = await AttestationService.evidenceFor(req.auth.userId);
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

// POST /identity/share — mint a signed, time-boxed grant for THIS caller's own profile.
router.post('/share', async (req, res) => {
  try {
    const token = jwt.sign(
      { typ: 'identity_share', sub: req.auth.userId },
      config.jwt.secret,
      { expiresIn: SHARE_TTL_SECONDS }
    );
    return res.json({ success: true, data: { token, expires_in: SHARE_TTL_SECONDS } });
  } catch (err) {
    return sendError(res, err);
  }
});

// GET /identity/:id/profile?token=... — a consented, third-party, redacted read.
router.get(
  '/:id/profile',
  [query('token').trim().notEmpty().withMessage('token is required')],
  async (req, res) => {
    try {
      let payload;
      try {
        payload = jwt.verify(String(req.query.token).trim(), config.jwt.secret);
      } catch {
        throw new ServiceError('INVALID_TOKEN', 'This share token is invalid or has expired', 400);
      }
      if (payload.typ !== 'identity_share' || String(payload.sub) !== String(req.params.id)) {
        throw new ServiceError('FORBIDDEN', 'This token does not grant access to this profile', 403);
      }
      const data = await AttestationService.evidenceFor(req.params.id);
      // Decision #28: redact the issuer for every third-party read — the subject
      // themselves already gets the full version at GET /identity/evidence.
      data.attestations = data.attestations.map(({ issuing_org_id, issuing_org_name, ...rest }) => rest);
      return res.json({ success: true, data });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

module.exports = router;
