// Mounted at /auth/app-login — App-mediated login (xprojman-31), generalized off
// VeriTrade's own "Scan to sign in" primitive (xprojman-25, veritradedesignspecification
// §4). Same VeriTradeLoginService, same veritrade_login_sessions table, `product`-
// discriminated (migration v033) — this is the entry point for every product OTHER
// than VeriTrade itself; /veritrade/login/* (routes/veritrade.js) keeps working
// completely unchanged for product='veritrade'.
//
// POST /auth/app-login/initiate        — the browser, unauthenticated. { product }
// GET  /auth/app-login/:id/context     — the App, authenticated, after scanning.
// POST /auth/app-login/:id/approve     — the App user, authenticated, taps Approve.
// POST /auth/app-login/:id/deny        — the App user, authenticated, taps Deny.
// GET  /auth/app-login/:id/status      — the browser, polling; hands over a session
//                                         token pair once, on the first poll after approval.

const router = require('express').Router();
const { body, query, validationResult } = require('express-validator');

const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const VeriTradeLoginService = require('../services/VeriTradeLoginService');

// 'veritrade' is deliberately excluded here — that product has its own namespace
// (/veritrade/login/*) already; this route only serves products routed through it.
const PRODUCTS = ['portal'];

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({ success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path });
  return true;
}

// POST /auth/app-login/initiate — the browser, unauthenticated.
router.post(
  '/initiate',
  [body('product').isIn(PRODUCTS).withMessage(`product must be one of: ${PRODUCTS.join(', ')}`)],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const data = await VeriTradeLoginService.initiate({
        ip: req.ip, userAgent: req.get('user-agent'), product: req.body.product,
      });
      return res.status(201).json({ success: true, data });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// GET /auth/app-login/:id/context — the App, authenticated, after scanning.
router.get(
  '/:id/context',
  authenticate,
  [query('code').trim().notEmpty().withMessage('code is required')],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const data = await VeriTradeLoginService.context({ sessionId: req.params.id, code: req.query.code });
      return res.json({ success: true, data });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// POST /auth/app-login/:id/approve — the App user, authenticated, taps Approve.
router.post(
  '/:id/approve',
  authenticate,
  [body('code').trim().notEmpty().withMessage('code is required')],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const [[user]] = await pool.query(
        `SELECT id, org_id, role, security_version FROM users WHERE id = ? LIMIT 1`,
        [req.auth.userId]
      );
      const data = await VeriTradeLoginService.approve({
        sessionId: req.params.id, code: req.body.code, user,
        ip: req.ip, userAgent: req.get('user-agent'),
      });
      await audit(req, 'app_login.approve', { entity: 'veritrade_login_sessions', entityId: req.params.id });
      return res.json({ success: true, data });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// POST /auth/app-login/:id/deny — the App user, authenticated, taps Deny.
router.post(
  '/:id/deny',
  authenticate,
  [body('code').trim().notEmpty().withMessage('code is required')],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const data = await VeriTradeLoginService.deny({ sessionId: req.params.id, code: req.body.code });
      return res.json({ success: true, data });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// GET /auth/app-login/:id/status — the browser, polling. No auth (the code is the proof).
router.get(
  '/:id/status',
  [query('code').trim().notEmpty().withMessage('code is required')],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const data = await VeriTradeLoginService.status({ sessionId: req.params.id, code: req.query.code });
      return res.json({ success: true, data });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

module.exports = router;
