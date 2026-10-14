// SopService — the optional Security of Payment claim template (xprojman-43 R3, §13.3; §14 O2).
//
// SOP is opt-in per claim (sop_state NULL = an ordinary claim). The per-state rules are DATA:
//   sop_templates  the fields an SOP claim must carry + the statement rendered onto it. Missing
//                  fields refuse the claim (SOP_TEMPLATE_INCOMPLETE): the user opted in, so a
//                  claim that says it is an SOP claim but isn't one would mislead the respondent.
//   sop_periods    schedule/payment due periods. Every row is unverified until the solicitor
//                  review, so dates are computed and returned with SOP_PERIOD_UNVERIFIED and
//                  nothing is enforced.
// The SOP Acts exclude owner-occupier contracts, so a client claim may only opt in when the
// project says the client is not an owner-occupier (SOP_OWNER_OCCUPIER).

const pool = require('../db/pool');
const { ServiceError } = require('./errors');

const FIELD_LABELS = {
  work_description: 'a description of the work',
  amount: 'the claimed amount',
  reference_date: 'the reference date',
  supporting_statement: 'the supporting statement (a document)',
};

async function loadRules(state) {
  const [[template]] = await pool.query('SELECT * FROM sop_templates WHERE state = ? LIMIT 1', [state]);
  if (!template) {
    throw new ServiceError('VALIDATION_ERROR', `There is no Security of Payment template for ${state}`, 400,
      { sop_state: state });
  }
  const [[period]] = await pool.query('SELECT * FROM sop_periods WHERE state = ? LIMIT 1', [state]);
  const required = typeof template.required_fields === 'string'
    ? JSON.parse(template.required_fields) : template.required_fields;
  return { template: { ...template, required_fields: required || [] }, period: period || null };
}

/** claim: { work_description, amount, reference_date, supporting_statement_document_id } */
function assertComplete(template, claim) {
  const present = {
    work_description: !!String(claim.work_description || '').trim(),
    amount: Number(claim.amount) > 0,
    reference_date: !!claim.reference_date,
    supporting_statement: !!claim.supporting_statement_document_id,
  };
  const missing = template.required_fields.filter((f) => !present[f]);
  if (missing.length) {
    throw new ServiceError('SOP_TEMPLATE_INCOMPLETE',
      `A ${template.state} Security of Payment claim needs ${missing.map((f) => FIELD_LABELS[f] || f).join(', ')}`,
      409, { sop_state: template.state, missing });
  }
}

const money = (n) => `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function render(template, claim) {
  return template.statement_text
    .replace(/\{amount\}/g, money(claim.amount))
    .replace(/\{reference_date\}/g, String(claim.reference_date || '').slice(0, 10));
}

/** Adds n days (business days skip Sat/Sun only) to a wall-clock 'YYYY-MM-DD HH:MM:SS'. */
function addDays(wallClock, n, businessDays) {
  const [datePart, timePart = '00:00:00'] = String(wallClock).split(' ');
  const d = new Date(`${datePart}T00:00:00Z`);
  let left = Number(n);
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (!businessDays || (dow !== 0 && dow !== 6)) left -= 1;
  }
  return `${d.toISOString().slice(0, 10)} ${timePart}`;
}

function dueDates(period, servedAt) {
  if (!period) return { schedule_due_at: null, payment_due_at: null };
  const business = !!period.business_days;
  return {
    schedule_due_at: addDays(servedAt, period.schedule_days, business),
    payment_due_at: addDays(servedAt, period.payment_days, business),
  };
}

function warnings({ template, period, siteState }) {
  const out = [];
  if (!template.verified_at) {
    out.push({ code: 'SOP_TEMPLATE_UNVERIFIED',
      message: `The ${template.state} claim template hasn't been legally reviewed yet. Check the claim with your adviser before relying on it.` });
  }
  if (!period) {
    out.push({ code: 'SOP_PERIOD_UNVERIFIED', message: `No ${template.state} due periods are on file, so no due dates were set.` });
  } else if (!period.verified_at) {
    out.push({ code: 'SOP_PERIOD_UNVERIFIED',
      message: `The ${template.state} due dates are estimates (business days, public holidays not counted) and haven't been legally reviewed. Nothing is enforced.` });
  }
  if (siteState && siteState !== template.state) {
    out.push({ code: 'SOP_STATE_MISMATCH',
      message: `The site is in ${siteState}, but this claim uses the ${template.state} Act.` });
  }
  return out;
}

/**
 * Everything an SOP claim needs at the moment it is served (progress claim submit, client claim
 * issue): checks the fields, renders the statement, computes the due dates, lists the warnings.
 */
async function prepare({ state, claim, servedAt, siteState }) {
  const { template, period } = await loadRules(state);
  assertComplete(template, claim);
  return {
    columns: { sop_statement: render(template, claim), ...dueDates(period, servedAt) },
    warnings: warnings({ template, period, siteState }),
  };
}

/** A supporting-statement document must belong to the org. */
async function assertDocumentInOrg(orgId, documentId) {
  if (!documentId) return;
  const [[doc]] = await pool.query('SELECT id FROM documents WHERE id = ? AND org_id = ? LIMIT 1', [documentId, orgId]);
  if (!doc) throw new ServiceError('VALIDATION_ERROR', 'supporting_statement_document_id is not a document in this organisation', 400);
}

/** GET /sop-templates — the rules as data, for the claim form. */
async function listRules() {
  const [templates] = await pool.query('SELECT * FROM sop_templates ORDER BY state');
  const [periods] = await pool.query('SELECT * FROM sop_periods');
  const byState = Object.fromEntries(periods.map((p) => [p.state, p]));
  return {
    sop_templates: templates.map((t) => {
      const p = byState[t.state];
      return {
        state: t.state, act_name: t.act_name,
        required_fields: typeof t.required_fields === 'string' ? JSON.parse(t.required_fields) : t.required_fields,
        statement_text: t.statement_text, source: t.source, verified: !!t.verified_at,
        period: p ? { schedule_days: p.schedule_days, payment_days: p.payment_days, business_days: !!p.business_days,
          source: p.source, verified: !!p.verified_at } : null,
      };
    }),
  };
}

module.exports = { prepare, loadRules, assertComplete, render, addDays, dueDates, warnings, assertDocumentInOrg, listRules };
