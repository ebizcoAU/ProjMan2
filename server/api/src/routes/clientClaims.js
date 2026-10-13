// /api/v1/client-claims — client progress claims at the billing milestones (xprojman-43 R2,
// §11 contract as corrected in §12, renamed per §13.2 and §14 O3). ClientClaimService holds the
// rules; this file is the HTTP shape. Reads money.read; every write money.write.
// The project-scoped entry points (payment schedule, raise a draft) live in routes/projects.js.

const express = require('express');
const { authenticate, requirePermission } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const ClientClaimService = require('../services/ClientClaimService');

const router = express.Router();
router.use(authenticate);

const canReadMoney = requirePermission('money.read');
const canWriteMoney = requirePermission('money.write');
const actorOf = (req) => ({ role: req.auth.role, userId: req.auth.userId });
// Services return either a body or { data, warnings } when there's a non-blocking warning to show.
const send = (res, result, status = 200) => {
  const isWrapped = result && Object.prototype.hasOwnProperty.call(result, 'warnings') && result.data;
  const data = isWrapped ? result.data : result;
  const warnings = isWrapped ? result.warnings : [];
  return res.status(status).json({ success: true, data, ...(warnings.length ? { warnings } : {}) });
};

router.get('/', canReadMoney, async (req, res) => {
  try {
    send(res, await ClientClaimService.list({
      orgId: req.auth.orgId, actor: actorOf(req), projectId: req.query.project_id, status: req.query.status,
    }));
  } catch (err) { sendError(res, err); }
});

router.get('/:id', canReadMoney, async (req, res) => {
  try { send(res, await ClientClaimService.detail({ orgId: req.auth.orgId, actor: actorOf(req), id: req.params.id })); }
  catch (err) { sendError(res, err); }
});

router.patch('/:id', canWriteMoney, async (req, res) => {
  try {
    const result = await ClientClaimService.patchDraft({ orgId: req.auth.orgId, actor: actorOf(req), id: req.params.id, body: req.body || {} });
    await audit(req, 'client_claim.update', { entity: 'client_claims', entityId: req.params.id, detail: { fields: Object.keys(req.body || {}) } });
    send(res, result);
  } catch (err) { sendError(res, err); }
});

router.post('/:id/issue', canWriteMoney, async (req, res) => {
  try {
    const result = await ClientClaimService.issue({ orgId: req.auth.orgId, actor: actorOf(req), id: req.params.id });
    await audit(req, 'client_claim.issue', { entity: 'client_claims', entityId: req.params.id,
      detail: { claim_number: result.data.client_claim.claim_number } });
    send(res, result);
  } catch (err) { sendError(res, err); }
});

router.post('/:id/payment', canWriteMoney, async (req, res) => {
  try {
    const result = await ClientClaimService.recordPayment({ orgId: req.auth.orgId, actor: actorOf(req), id: req.params.id, body: req.body || {} });
    await audit(req, 'client_claim.payment', { entity: 'client_claims', entityId: req.params.id,
      detail: { payment_reference: req.body?.payment_reference || null } });
    send(res, result);
  } catch (err) { sendError(res, err); }
});

router.post('/:id/void', canWriteMoney, async (req, res) => {
  try {
    const result = await ClientClaimService.voidClaim({ orgId: req.auth.orgId, actor: actorOf(req), id: req.params.id, reason: req.body?.reason });
    await audit(req, 'client_claim.void', { entity: 'client_claims', entityId: req.params.id,
      detail: { reason: req.body?.reason, replacement_id: result.replacement?.id } });
    send(res, result);
  } catch (err) { sendError(res, err); }
});

module.exports = router;
