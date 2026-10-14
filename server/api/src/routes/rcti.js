// /api/v1/rcti-agreements — the written RCTI agreement per counterparty (xprojman-43 R3, §13.3a),
// and /api/v1/sop-templates — the Security of Payment rules as data (§13.3). RctiService and
// SopService hold the rules; this file is the HTTP shape.
//   GET  /rcti-agreements?supplier_id=&party_user_id=&current=1   (money.read or po.write)
//   POST /rcti-agreements { supplier_id | party_user_id, agreed_at, ends_at?, document_id?, note? }
//   POST /rcti-agreements/:id/revoke
//   GET  /sop-templates                                            (any signed-in user)

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const RctiService = require('../services/RctiService');
const SopService = require('../services/SopService');

const actorOf = (req) => ({ role: req.auth.role, userId: req.auth.userId });

const agreements = express.Router();
agreements.use(authenticate);

agreements.get('/', async (req, res) => {
  try {
    const data = await RctiService.list({
      orgId: req.auth.orgId, actor: actorOf(req), supplierId: req.query.supplier_id,
      partyUserId: req.query.party_user_id, current: ['1', 'true'].includes(String(req.query.current || '')),
    });
    res.json({ success: true, data });
  } catch (err) { sendError(res, err); }
});

agreements.post('/', async (req, res) => {
  try {
    const result = await RctiService.create({ orgId: req.auth.orgId, actor: actorOf(req), body: req.body || {} });
    const a = result.data.rcti_agreement;
    await audit(req, 'rcti_agreement.create', { entity: 'rcti_agreements', entityId: a.id,
      detail: { supplier_id: a.supplier_id, party_user_id: a.party_user_id, agreed_at: a.agreed_at, ends_at: a.ends_at } });
    res.status(201).json({ success: true, data: result.data, ...(result.warnings.length ? { warnings: result.warnings } : {}) });
  } catch (err) { sendError(res, err); }
});

agreements.post('/:id/revoke', async (req, res) => {
  try {
    const data = await RctiService.revoke({ orgId: req.auth.orgId, actor: actorOf(req), id: req.params.id });
    await audit(req, 'rcti_agreement.revoke', { entity: 'rcti_agreements', entityId: req.params.id });
    res.json({ success: true, data });
  } catch (err) { sendError(res, err); }
});

const sopTemplates = express.Router();
sopTemplates.use(authenticate);
sopTemplates.get('/', async (req, res) => {
  try { res.json({ success: true, data: await SopService.listRules() }); }
  catch (err) { sendError(res, err); }
});

module.exports = { agreements, sopTemplates };
