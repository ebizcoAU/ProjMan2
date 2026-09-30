// Safety/OHS REST (xprojman-48 §5 as agreed in §8, migration v048). The App raises and
// responds through /sync/push; this is the Portal's desk surface. Every write is
// safety.manage and audit-logged; permission checks live in SafetyService.
//
// Mounted at /safety-events:
//   GET    /:id                    detail — event + documents + actions(+documents) +
//                                  incident_details (safety.manage or the reporter)
//   PATCH  /:id                    severity / location / description / status (not closed)
//   POST   /:id/close              { close_note } → SAFETY_OPEN_ACTIONS while any action is open
//   PATCH  /:id/notifiable         { is_notifiable, notified_at, regulator_reference }
//   PATCH  /:id/incident-details   correction, audited diff (safety.manage or the reporter)
//   POST   /:id/actions            { action, assigned_to | assigned_to_name, due_date }
// Mounted at /safety-actions:
//   PATCH  /:id                    edit an open action, or { status:'closed' }
// Mounted at /safety:
//   GET    /summary                trend (safety.manage, reach via projectScope)
// Mounted at /projects (projectRouter):
//   GET    /:id/safety-events      list (safety.report OR safety.manage — the Builder's F7 list)
//   GET    /:id/site-inductions    register (?status=valid|expiring|expired)
//   GET    /:id/signoffs           ?subject_type=swms&subject_id= (SWMS sign-on status)

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const SafetyService = require('../services/SafetyService');

const authOf = (req) => ({ role: req.auth.role, userId: req.auth.userId });
const auditFor = (req) => (action, opts) => audit(req, action, opts);
const wrap = (fn) => async (req, res) => {
  try {
    const { status = 200, data } = await fn(req);
    return res.status(status).json({ success: true, data });
  } catch (err) { return sendError(res, err); }
};
const base = (req) => ({ orgId: req.auth.orgId, auth: authOf(req), audit: auditFor(req) });

const events = express.Router();
events.use(authenticate);
events.get('/:id', wrap(async (req) => ({
  data: await SafetyService.getEvent({ ...base(req), id: req.params.id }),
})));
events.patch('/:id', wrap(async (req) => ({
  data: await SafetyService.patchEvent({ ...base(req), id: req.params.id, body: req.body || {} }),
})));
events.post('/:id/close', wrap(async (req) => ({
  data: await SafetyService.closeEvent({ ...base(req), id: req.params.id, closeNote: req.body?.close_note }),
})));
events.patch('/:id/notifiable', wrap(async (req) => ({
  data: await SafetyService.setNotifiable({ ...base(req), id: req.params.id, body: req.body || {} }),
})));
events.patch('/:id/incident-details', wrap(async (req) => ({
  data: await SafetyService.patchIncidentDetails({ ...base(req), id: req.params.id, body: req.body || {} }),
})));
events.post('/:id/actions', wrap(async (req) => ({
  status: 201,
  data: await SafetyService.addAction({ ...base(req), eventId: req.params.id, body: req.body || {} }),
})));

const actions = express.Router();
actions.use(authenticate);
actions.patch('/:id', wrap(async (req) => ({
  data: await SafetyService.patchAction({ ...base(req), actionId: req.params.id, body: req.body || {} }),
})));

const summary = express.Router();
summary.use(authenticate);
summary.get('/summary', wrap(async (req) => ({
  data: await SafetyService.summary({ ...base(req), query: req.query }),
})));

const projectRouter = express.Router();
projectRouter.get('/:id/safety-events', authenticate, wrap(async (req) => ({
  data: await SafetyService.listEvents({ ...base(req), projectId: req.params.id, query: req.query }),
})));
projectRouter.get('/:id/site-inductions', authenticate, wrap(async (req) => ({
  data: await SafetyService.listInductions({ ...base(req), projectId: req.params.id, status: req.query.status }),
})));
projectRouter.get('/:id/signoffs', authenticate, wrap(async (req) => ({
  data: await SafetyService.listSignoffs({
    ...base(req), projectId: req.params.id, subjectType: req.query.subject_type, subjectId: req.query.subject_id,
  }),
})));

module.exports = { events, actions, summary, projectRouter };
