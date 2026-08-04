// Portal Dashboard summary acceptance — GET /projects/dashboard-summary.
//
// The endpoint that unblocks the Portal Dashboard (halted "until a dashboard-summary endpoint
// exists"). Proves the three things the original directive got wrong:
//   1. ROUTE ORDER — the literal path is not swallowed by GET /:id.
//   2. MONEY IS GATED — `money` is null (not zero) for a caller without money.read (§7.2.1). The
//      original spec put a budget summary in front of "any tenant user".
//   3. SCOPE — an assigned-scope role counts only their own jobs; a portfolio role counts the org.
// Plus: "overdue" is DERIVED from due_date (there is no 'overdue' status), hold points come from
// hold_point_requirements (blocks_progress) rather than a coarse stage-status proxy, and the
// job-award count is self-scoped.
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 node tests/dashboard.test.js
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';
const crypto = require('crypto');
const pool = require('../src/db/pool');

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};
async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json; try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, json };
}

(async () => {
  console.log(`Portal Dashboard summary test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Dash ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken, pmUser = reg.json.data.user.id, orgId = reg.json.data.organisation.id;

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);

  // Two projects: one active + overdue with money, one draft.
  const p1 = await call('POST', '/projects',
    { code: `D1-${s}`, name: 'Lot 1', status: 'active', due_date: '2020-01-01' }, pm);
  const p2 = await call('POST', '/projects', { code: `D2-${s}`, name: 'Lot 2' }, pm);
  const proj1 = p1.json.data.id, proj2 = p2.json.data.id;
  await call('POST', `/projects/${proj1}/programme`, { template_id: wa18.id }, pm);
  await pool.query('UPDATE projects SET contract_value = 250000 WHERE id = ?', [proj1]);
  await pool.query('UPDATE projects SET contract_value = 100000 WHERE id = ?', [proj2]);

  // ── 1. Route order ──
  const sum = await call('GET', '/projects/dashboard-summary', undefined, pm);
  ok('ROUTE ORDER: /projects/dashboard-summary resolves (not swallowed by GET /:id)',
    sum.status === 200 && !!sum.json.data?.projects, JSON.stringify(sum.json).slice(0, 160));

  const d = sum.json.data;
  ok('project counts by status are aggregated',
    d.projects.total === 2 && d.projects.by_status.active === 1 && d.projects.by_status.draft === 1,
    JSON.stringify(d.projects));
  ok('OVERDUE is derived from due_date (no such status exists)',
    d.projects.overdue === 1, JSON.stringify(d.projects));

  // ── 2. Money gating ──
  ok('a money.read holder gets the money block',
    d.money && Number(d.money.contract_value_total) === 350000, JSON.stringify(d.money));

  // A foreperson user (NOT the founder — a founder's device carries owner capabilities whatever
  // role it is paired as, which would mask the gate).
  const foreEmail = `fore${s}@x.com`;
  await call('POST', '/organisation/users',
    { email: foreEmail, full_name: 'Fred Foreperson', role: 'foreperson', password: 'site-gate-42' }, pm);
  const foreLogin = await call('POST', '/auth/login',
    { email: foreEmail, password: 'site-gate-42', device: { device_uid: `fore-${s}`, platform: 'android' } });
  const foreTok = foreLogin.json.data?.accessToken;
  const foreUser = foreLogin.json.data?.user?.id;

  const foreSum = await call('GET', '/projects/dashboard-summary', undefined, foreTok);
  ok('a role WITHOUT money.read still gets the dashboard', foreSum.status === 200, JSON.stringify(foreSum.json));
  ok('§7.2.1: the money block is NULL for them — not zero, which would be a lie',
    foreSum.json.data.money === null, JSON.stringify(foreSum.json.data.money));

  // ── 3. Scope ──
  ok('an ASSIGNED-scope role with no memberships sees none of the org\'s projects',
    foreSum.json.data.projects.total === 0, JSON.stringify(foreSum.json.data.projects));

  await call('POST', `/projects/${proj1}/members`, { user_id: foreUser }, pm);
  const foreSum2 = await call('GET', '/projects/dashboard-summary', undefined, foreTok);
  ok('…and sees exactly the job they are on once a member (1 of 2)',
    foreSum2.json.data.projects.total === 1 && foreSum2.json.data.projects.active === undefined,
    JSON.stringify(foreSum2.json.data.projects));
  ok('the PORTFOLIO role still counts the whole org (2)',
    (await call('GET', '/projects/dashboard-summary', undefined, pm)).json.data.projects.total === 2);

  // ── Defects, hold points, awards ──
  const mkDefect = async (status, severity, due) => {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO defects (id, org_id, project_id, description, severity, status, due_date, raised_by)
       VALUES (?, ?, ?, 'x', ?, ?, ?, ?)`,
      [id, orgId, proj1, severity, status, due, pmUser]);
  };
  await mkDefect('open', 'high', '2020-01-01');    // open + high + overdue
  await mkDefect('open', 'low', null);
  await mkDefect('in_progress', 'medium', null);
  await mkDefect('closed', 'high', '2020-01-01');  // closed — excluded from high/overdue

  const d2 = (await call('GET', '/projects/dashboard-summary', undefined, pm)).json.data;
  ok('defects: open / in_progress counted', d2.defects.open === 2 && d2.defects.in_progress === 1,
    JSON.stringify(d2.defects));
  ok('defects: a CLOSED defect is excluded from high-severity and overdue',
    d2.defects.high_severity === 1 && d2.defects.overdue === 1, JSON.stringify(d2.defects));

  const [[hp]] = await pool.query(
    "SELECT id FROM hold_point_requirements WHERE project_id = ? AND blocks_progress = 1 LIMIT 1", [proj1]);
  if (hp) {
    await pool.query("UPDATE hold_point_requirements SET status = 'open' WHERE id = ?", [hp.id]);
    const d3 = (await call('GET', '/projects/dashboard-summary', undefined, pm)).json.data;
    ok('hold points come from hold_point_requirements (blocks_progress), not a stage-status proxy',
      d3.hold_points.open_blocking >= 1, JSON.stringify(d3.hold_points));
  } else {
    ok('hold points come from hold_point_requirements (blocks_progress), not a stage-status proxy',
      d2.hold_points.open_blocking === 0, 'no blocking hold points in this template — 0 is correct');
  }

  const [[award]] = await pool.query(
    `SELECT id FROM job_awards WHERE org_id = ? LIMIT 1`, [orgId]);
  if (!award) {
    await pool.query(
      `INSERT INTO job_awards (id, org_id, project_id, from_user_id, to_user_id, role_offered, status, sent_at)
       VALUES (?, ?, ?, ?, ?, 'builder', 'sent', NOW())`,
      [crypto.randomUUID(), orgId, proj1, pmUser, foreUser]);
  }
  const foreSum3 = await call('GET', '/projects/dashboard-summary', undefined, foreTok);
  const pmSum3 = await call('GET', '/projects/dashboard-summary', undefined, pm);
  ok('job-award count is SELF-scoped (the invitee sees it, the sender does not)',
    foreSum3.json.data.job_awards.pending_for_me === 1 &&
    pmSum3.json.data.job_awards.pending_for_me === 0,
    `invitee=${foreSum3.json.data.job_awards.pending_for_me} sender=${pmSum3.json.data.job_awards.pending_for_me}`);

  // ── Cross-org ──
  const reg2 = await call('POST', '/auth/register', {
    organisation: { name: `Other ${s}` },
    user: { full_name: 'Other PM', email: `oth${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `oth-${s}`, platform: 'android' },
  });
  const otherSum = await call('GET', '/projects/dashboard-summary', undefined, reg2.json.data.accessToken);
  ok('CROSS-ORG: another org sees none of this org\'s projects or defects',
    otherSum.json.data.projects.total === 0 && otherSum.json.data.defects.open === 0,
    JSON.stringify(otherSum.json.data.projects));

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
