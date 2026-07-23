// stageHooks — the event-hook registry (servdesignspec §10.6).
//
// The 18-Stage Matrix's automation (Stage 1 OCR + client email, Stage 13 → schedule
// Stage 14 + notify trades, Stage 18 → capitalise + depreciate + ATO) is real but
// depends on services not yet built (Python OCR/email, scheduler/IVR, accounting).
// So each is a NAMED hook with a no-op default: the progression engine fires it on the
// relevant transition, the audit trail records it, and wiring a real body later is
// additive — it never reopens StageProgressionService.
//
// A body registers with `on(name, fn)`; `fire(name, ctx)` runs all handlers, never
// throwing into the caller (a hook failure must not fail the stage transition that
// triggered it — the transition already committed).

const { audit } = require('../lib/audit');

const HANDLERS = new Map(); // name → [fn]

/** Register a handler for a hook. Bodies (Python/accounting/scheduler) call this. */
function on(name, fn) {
  if (!HANDLERS.has(name)) HANDLERS.set(name, []);
  HANDLERS.get(name).push(fn);
}

/**
 * Fire a hook. Records an audit row (so the automation point is always traceable even
 * before a body exists), then runs any registered handlers best-effort.
 */
async function fire(name, ctx = {}) {
  try {
    await audit(null, `stage.hook.${name}`, {
      orgId: ctx.orgId,
      entity: 'project_stages',
      entityId: ctx.stage?.id,
      detail: { stage_code: ctx.stage?.stage_code, seq: ctx.stage?.seq, hook: name },
    });
  } catch { /* audit is best-effort */ }

  const fns = HANDLERS.get(name) || [];
  for (const fn of fns) {
    try { await fn(ctx); }
    catch (err) { console.warn(`[HOOK] ${name} handler failed (non-fatal):`, err.message); }
  }
}

/**
 * assertClaimAllowed (§10.6) — the payment-freeze interlock. A claim/invoice against a
 * stage is refused if that stage, or a gating prior hold point, is not validated
 * (matrix Stage 18: invoice blocked if Stage 12/15 not validated). Specified now,
 * enforced by the claims module when it exists — exported so that module calls one
 * function instead of re-deriving the rule.
 *
 * @throws {ServiceError} CLAIM_BLOCKED
 */
async function assertClaimAllowed(pool, { orgId, stageId }) {
  const { ServiceError } = require('./errors');
  const [[stage]] = await pool.query(
    `SELECT id, project_id, seq, is_hold_point, is_validated
       FROM project_stages WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1`,
    [stageId, orgId]
  );
  if (!stage) throw new ServiceError('NOT_FOUND', 'Stage not found', 404);

  // The stage itself, if a hold point, must be validated.
  if (stage.is_hold_point && !stage.is_validated) {
    throw new ServiceError('CLAIM_BLOCKED',
      'This stage is an unvalidated hold point — the claim is frozen until it passes inspection', 409);
  }
  // Any earlier hold point that is not validated also freezes downstream claims.
  const [[bad]] = await pool.query(
    `SELECT seq, stage_code FROM project_stages
      WHERE project_id = ? AND org_id = ? AND is_deleted = 0
        AND seq < ? AND is_hold_point = 1 AND is_validated = 0
      ORDER BY seq LIMIT 1`,
    [stage.project_id, orgId, stage.seq]
  );
  if (bad) {
    throw new ServiceError('CLAIM_BLOCKED',
      `An earlier hold point (stage ${bad.seq}, ${bad.stage_code}) is not validated — the claim is frozen`, 409);
  }
}

module.exports = { on, fire, assertClaimAllowed };
