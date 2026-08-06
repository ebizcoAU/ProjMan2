// Mounted at /sync — transport only. The rules live in services/SyncService.js.
//
//   POST /sync/push               dirty rows up
//   GET  /sync/pull?since=cursor  changes down
//   GET  /sync/status
//
// The wire format is MAOI's, unchanged (the app's existing client keeps working):
//   push  { table_name, operation, data, local_id? }  →  { success, server_id, applied }
//   pull  ?since=<unix ms>  →  { success, last_sync_at, changes:[…] }
//
// Every rule that keeps sync honest — the bounded server-epoch cursor, the echo-skip,
// the single-writer ownership check, and the org_id isolation — is in SyncService,
// callable from anywhere. This file just validates and maps.

const router = require('express').Router();
const { query, body, validationResult } = require('express-validator');

const { authenticate } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { TABLES, ALLOWED_OPERATIONS } = require('../sync/registry');
const SyncService = require('../services/SyncService');

router.use(authenticate);

// Surface for the ownership check. A browser session has no device; the app always
// sends one. Derived here because it needs the request.
const callerSurface = (req) => (req.auth.deviceUid ? 'app' : 'web');

// ── POST /sync/push ───────────────────────────────────────────
router.post(
  '/push',
  [
    body('table_name').custom((raw) => {
      if (!(String(raw || '').trim() in TABLES)) throw new Error('Unsupported table_name');
      return true;
    }),
    body('operation').isIn(ALLOWED_OPERATIONS).withMessage('operation must be create, update or delete'),
    body('data').custom((val) => {
      if (typeof val !== 'object' || val === null || Array.isArray(val)) {
        throw new Error('data must be an object');
      }
      return true;
    }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: errors.array()[0].msg, code: 'VALIDATION_ERROR' });
    }
    try {
      const { serverId, applied } = await SyncService.pushRecord({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        deviceUid: req.auth.deviceUid,
        role: req.auth.role,
        surface: callerSurface(req),
        wireName: String(req.body.table_name).trim(),
        operation: req.body.operation,
        data: req.body.data,
        localId: req.body.local_id || req.body.localId || req.body.id,
      });
      return res.json({ success: true, server_id: serverId, applied });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── GET /sync/pull ────────────────────────────────────────────
router.get(
  '/pull',
  [query('since').optional().isInt({ min: 0 }).withMessage('since must be Unix milliseconds')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: errors.array()[0].msg, code: 'VALIDATION_ERROR' });
    }
    try {
      const { last_sync_at, changes, requiresFullSync } = await SyncService.pullDeltas({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        deviceUid: req.auth.deviceUid,
        jti: req.auth.jti,
        role: req.auth.role,
        // No cursor = fresh install / device-loss recovery: send everything.
        sinceMs: req.query.since !== undefined ? parseInt(req.query.since, 10) : 0,
        scopeJson: req.auth.scopeJson || null,   // PM2-02 (§13.2) — only set on an activated engagement token
      });
      return res.json({ success: true, last_sync_at, changes, requiresFullSync });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── GET /sync/status ──────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const data = await SyncService.status({
      orgId: req.auth.orgId,
      deviceUid: req.auth.deviceUid,
      jti: req.auth.jti,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

module.exports = router;
