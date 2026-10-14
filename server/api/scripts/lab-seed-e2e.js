// Lab seed for App / Portal E2E (PM request 2026-10-14). DRY RUN BY DEFAULT.
//
// Creates, in one dedicated org ("ProjMan Lab E2E Builder", marker email e2e-lab@projman.internal):
//   (a) an active project at Stage 12: contract value, payment schedule, a locked cost plan, the
//       v3.4 programme (18 stages, the v3.4-coded task library and hold-point requirements);
//       stages 1–11 complete and their hold points/requirements satisfied, Stage 12 in progress,
//       an accepted Builder award (the programme gate). Locking the cost plan lets the R5 trigger
//       draft the Deposit progress claim, as it would in real use.
//   (b) a Portal PM/office user (projectManager: holds checklists.manage, safety.manage, handover.witness)
//   (c) a site supervisor (siteSupervisor) and a client (client: handover.signoff) on the project,
//       for App E2E (Safety, Inductions, S18.14). Plus the org's founding Builder (owner).
//
// NO EMAIL / SMS / MQTT: every row is inserted directly, or through services that send nothing
// (ProjectService.createProject, StageTemplateService.instantiate, MembershipService,
// ClientClaimService.saveSchedule, EstimateService). The registration/notifier paths are never
// called, and EMAIL_ENABLED/SMS_ENABLED/MQTT_ENABLED are forced false before anything loads.
// All addresses are @projman.internal (non-routable).
//
// Passwords are random and written ONLY to the credentials file (chmod 600), never printed.
// Idempotent: anything that exists is left alone (an existing account keeps its password).
//
//   node scripts/lab-seed-e2e.js                 dry run: what exists, what would be created
//   node scripts/lab-seed-e2e.js --apply         create what's missing
//   node scripts/lab-seed-e2e.js --remove        dry run of the removal
//   node scripts/lab-seed-e2e.js --remove --apply  remove it
//   --credentials-file <path>                    default ~/projman2-backups/lab-e2e-credentials.txt
//
// Refuses unless NODE_ENV=development and DB_NAME=c1projman2 (or c1projman2_e2e, the throwaway
// test DB this script is tested on).

process.env.EMAIL_ENABLED = 'false';
process.env.SMS_ENABLED = 'false';
process.env.MQTT_ENABLED = 'false';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const ALLOWED_DBS = ['c1projman2', 'c1projman2_e2e'];
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const REMOVE = args.includes('--remove');
const credIdx = args.indexOf('--credentials-file');
const CRED_FILE = credIdx >= 0 ? path.resolve(args[credIdx + 1])
  : path.join(os.homedir(), 'projman2-backups', 'lab-e2e-credentials.txt');

if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') {
  console.error(`Refusing: NODE_ENV is "${process.env.NODE_ENV}", this script only runs with NODE_ENV=development.`);
  process.exit(2);
}
const config = require('../src/config');
if (config.server.env !== 'development' || !config.server.isDev) {
  console.error(`Refusing: NODE_ENV resolves to "${config.server.env}", not development.`);
  process.exit(2);
}
if (!ALLOWED_DBS.includes(config.db.name)) {
  console.error(`Refusing: DB_NAME is "${config.db.name}"; allowed: ${ALLOWED_DBS.join(', ')}.`);
  process.exit(2);
}

const pool = require('../src/db/pool');
const access = require('../src/lib/access');
const ProjectService = require('../src/services/ProjectService');
const StageTemplateService = require('../src/services/StageTemplateService');
const MembershipService = require('../src/services/MembershipService');
const ClientClaimService = require('../src/services/ClientClaimService');
const EstimateService = require('../src/services/EstimateService');

const DOMAIN = 'projman.internal';
const ORG = { name: 'ProjMan Lab E2E Builder', email: `e2e-lab@${DOMAIN}`, state: 'WA' };
const USERS = [
  { key: 'builder', email: `e2e-builder@${DOMAIN}`, full_name: 'Lab E2E Builder (owner)', role: 'builder', owner: 1 },
  { key: 'pm', email: `e2e-pm@${DOMAIN}`, full_name: 'Lab E2E Project Manager', role: 'projectManager', owner: 0 },
  { key: 'supervisor', email: `e2e-supervisor@${DOMAIN}`, full_name: 'Lab E2E Site Supervisor', role: 'siteSupervisor', owner: 0 },
  { key: 'client', email: `e2e-client@${DOMAIN}`, full_name: 'Lab E2E Client', role: 'client', owner: 0 },
];
const PROJECT = { code: 'LAB-E2E', name: 'Lab E2E — Lot 12 dwelling', contract_value: 650000, site_address: '12 Test Street, Perth WA 6000' };
const SCHEDULE = { deposit: 5, base: 10, frame: 15, lock_up: 35, fixing: 20, completion: 15 };
const ESTIMATE_LINES = [
  { seq: 10, description: 'Site set-out and earthworks', quantity: 1, unit: 'item', rate: 18500 },
  { seq: 11, description: 'Footings and slab', quantity: 1, unit: 'item', rate: 62000 },
  { seq: 13, description: 'Frame and trusses', quantity: 1, unit: 'item', rate: 88000 },
];
const AT_STAGE = 12;

const log = (s) => console.log(s);
const mode = `${REMOVE ? 'REMOVE' : 'SEED'} · ${APPLY ? 'APPLY' : 'DRY RUN (nothing is written)'} · DB ${config.db.name}`;

// ── Read the current state ──────────────────────────────────────────────────────

async function state() {
  const [[org]] = await pool.query('SELECT id, name, status FROM organisations WHERE email = ? AND name = ? LIMIT 1', [ORG.email, ORG.name]);
  const users = {};
  for (const u of USERS) {
    const [[row]] = await pool.query('SELECT id, org_id, role, status FROM users WHERE email = ? LIMIT 1', [u.email]);
    users[u.key] = row || null;
  }
  let project = null;
  if (org) {
    const [[p]] = await pool.query('SELECT id, code, contract_value FROM projects WHERE org_id = ? AND code = ? AND is_deleted = 0 LIMIT 1', [org.id, PROJECT.code]);
    project = p || null;
  }
  return { org: org || null, users, project };
}

// ── Seed ────────────────────────────────────────────────────────────────────────

const newPasswords = [];

async function ensureOrg(st) {
  if (st.org) { log(`  = organisation "${ORG.name}" exists (${st.org.id})`); return st.org.id; }
  log(`  + organisation "${ORG.name}" (${ORG.email}, ${ORG.state}, GST registered)`);
  if (!APPLY) return null;
  const id = uuidv4();
  await pool.query(
    `INSERT INTO organisations (id, name, email, state, gst_registered, timezone, currency, plan, status)
     VALUES (?, ?, ?, ?, 1, ?, ?, 'trial', 'active')`,
    [id, ORG.name, ORG.email, ORG.state, config.server.timezone, config.server.currency]);
  return id;
}

async function ensureUser(st, orgId, u) {
  const existing = st.users[u.key];
  if (existing) {
    if (orgId && existing.org_id !== orgId) {
      throw new Error(`${u.email} exists in ANOTHER organisation (${existing.org_id}); refusing to touch it`);
    }
    log(`  = user ${u.email} (${u.role}) exists, password unchanged`);
    return existing.id;
  }
  log(`  + user ${u.email} (${u.role}${u.owner ? ', org owner' : ''}), random password → credentials file`);
  if (!APPLY) return null;
  const id = uuidv4();
  const password = crypto.randomBytes(15).toString('base64url');
  await pool.query(
    `INSERT INTO users (id, org_id, email, password_hash, full_name, role, is_org_owner, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
    [id, orgId, u.email, await bcrypt.hash(password, config.password.bcryptCost), u.full_name, u.role, u.owner]);
  newPasswords.push({ email: u.email, role: u.role, password });
  return id;
}

async function seedProject(orgId, ids) {
  const pmActor = { role: 'projectManager', userId: ids.pm };

  const custId = uuidv4();
  await pool.query('INSERT INTO customers (id, org_id, name, email) VALUES (?, ?, ?, ?)',
    [custId, orgId, 'Lab E2E Client', `e2e-client@${DOMAIN}`]);
  const { id: projectId } = await ProjectService.createProject({
    orgId, addedBy: ids.pm,
    data: { ...PROJECT, customer_id: custId, pm_user_id: ids.pm, status: 'active', contract_type: 'fixed_price', site_state: ORG.state },
  });

  const { templates } = await StageTemplateService.listTemplates({ orgId });
  const tpl = templates.find((t) => t.is_system && Number(t.stage_count) === 18);
  if (!tpl) throw new Error('No system 18-stage template found');
  await StageTemplateService.instantiate({ orgId, projectId, templateId: tpl.id, actorUserId: ids.pm });

  for (const k of ['builder', 'supervisor', 'client']) {
    await MembershipService.addMember({ orgId, projectId, userId: ids[k], addedBy: ids.pm });
  }

  // S9.6/S9.7/S9.10: the Builder award, accepted; the programme goes live.
  await pool.query(
    `INSERT INTO job_awards (id, org_id, project_id, from_user_id, to_user_id, role_offered, status, responded_at,
                             response_channel, builder_engagement_type)
     VALUES (?, ?, ?, ?, ?, 'builder', 'accepted', NOW(), 'portal', 'employee')`,
    [uuidv4(), orgId, projectId, ids.pm, ids.builder]);
  await pool.query('UPDATE projects SET programme_activated_at = NOW() WHERE id = ?', [projectId]);

  await ClientClaimService.saveSchedule({ orgId, projectId, actor: pmActor,
    schedule: Object.entries(SCHEDULE).map(([milestone, percentage]) => ({ milestone, percentage })) });

  const [stages] = await pool.query('SELECT id, seq FROM project_stages WHERE project_id = ? AND org_id = ?', [projectId, orgId]);
  const stageBySeq = new Map(stages.map((s) => [Number(s.seq), s.id]));
  for (const l of ESTIMATE_LINES) {
    await EstimateService.createLine({ orgId, projectId, actor: pmActor, stageId: stageBySeq.get(l.seq),
      description: l.description, category: 'labour', quantity: l.quantity, unit: l.unit, rate: l.rate });
  }

  // Progress to Stage 12: earlier stages complete and validated, their requirements and tasks done.
  await pool.query(
    `UPDATE project_stages SET status = 'complete', start_date = COALESCE(start_date, CURDATE()),
            end_date = COALESCE(end_date, CURDATE()),
            is_validated = IF(is_hold_point = 1, 1, is_validated),
            validated_by = IF(is_hold_point = 1, ?, validated_by),
            validated_at = IF(is_hold_point = 1, NOW(), validated_at), server_updated_at = NOW(3)
      WHERE project_id = ? AND org_id = ? AND seq < ?`, [ids.pm, projectId, orgId, AT_STAGE]);
  await pool.query(
    `UPDATE project_stages SET status = 'in_progress', start_date = COALESCE(start_date, CURDATE()), server_updated_at = NOW(3)
      WHERE project_id = ? AND org_id = ? AND seq = ?`, [projectId, orgId, AT_STAGE]);
  await pool.query(
    `UPDATE hold_point_requirements r JOIN project_stages ps ON ps.id = r.stage_id
        SET r.status = 'satisfied', r.satisfied_by = ?, r.satisfied_at = NOW()
      WHERE r.project_id = ? AND r.org_id = ? AND ps.seq < ?`, [ids.pm, projectId, orgId, AT_STAGE]);
  await pool.query(
    `UPDATE tasks t JOIN project_stages ps ON ps.id = t.stage_id
        SET t.status = 'complete', t.completion = 100, t.server_updated_at = NOW(3)
      WHERE t.project_id = ? AND t.org_id = ? AND ps.seq < ? AND t.is_deleted = 0`, [projectId, orgId, AT_STAGE]);

  // S9.9: locking the cost plan completes the Deposit gate; the R5 trigger drafts that claim.
  await EstimateService.setLock({ orgId, projectId, actor: pmActor, locked: true });
  return projectId;
}

function writeCredentials() {
  if (!newPasswords.length) return;
  fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true, mode: 0o700 });
  const block = [
    `# ProjMan lab E2E accounts — ${new Date().toISOString()} — DB ${config.db.name}`,
    '# Created by server/api/scripts/lab-seed-e2e.js. Lab only. Do not share or commit.',
    ...newPasswords.map((p) => `${p.email}\t${p.role}\t${p.password}`),
    '',
  ].join('\n');
  fs.appendFileSync(CRED_FILE, block, { mode: 0o600 });
  fs.chmodSync(CRED_FILE, 0o600);
  log(`\nPasswords for ${newPasswords.length} new account(s) written to ${CRED_FILE} (chmod 600). Not printed.`);
}

async function seed() {
  const st = await state();
  log('Organisation and accounts:');
  const orgId = await ensureOrg(st);
  const ids = {};
  for (const u of USERS) ids[u.key] = await ensureUser(st, orgId, u);

  log('\nProject:');
  if (st.project) {
    log(`  = project ${PROJECT.code} exists (${st.project.id}); not re-seeded`);
  } else {
    log(`  + project ${PROJECT.code} "${PROJECT.name}", contract $${PROJECT.contract_value.toLocaleString('en-AU')} ex GST, site ${ORG.state}, customer "Lab E2E Client"`);
    log('  + v3.4 programme from the system 18-stage template (stages, v3.4-coded task library, hold-point requirements)');
    log('  + members: PM (creator + named PM), Builder, Site Supervisor, Client');
    log('  + Builder job award, accepted (S9.7); programme activated (S9.10)');
    log(`  + payment schedule ${Object.entries(SCHEDULE).map(([m, p]) => `${m} ${p}%`).join(', ')}`);
    log(`  + cost plan: ${ESTIMATE_LINES.length} estimate lines, then LOCKED (S9.9) → the R5 trigger drafts the Deposit claim`);
    log(`  + stages 1–${AT_STAGE - 1} complete, hold points validated, requirements satisfied, tasks complete; Stage ${AT_STAGE} in progress`);
    if (APPLY) {
      let projectId;
      try {
        projectId = await seedProject(orgId, ids);
      } catch (err) {
        const [[half]] = await pool.query('SELECT id FROM projects WHERE org_id = ? AND code = ? LIMIT 1', [orgId, PROJECT.code]);
        if (half) err.message += ` — project ${half.id} is half-seeded: run --remove --apply, then --apply again`;
        throw err;
      }
      const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM client_claims WHERE project_id = ?', [projectId]);
      log(`  ✓ created ${projectId} (${c.n} progress claim draft(s))`);
    }
  }
  const [[tpl]] = await pool.query('SELECT COUNT(*) AS n FROM checklist_templates WHERE org_id IS NULL AND is_deleted = 0 AND is_published = 1');
  log(`\nChecklists: ${tpl.n} published system checklist template(s) (v047/v051) apply to every org; instances are created by the App during E2E.`);
  log('\nNote: the client account can sign in, but the `client` role\'s scope class is `portal`, which v1 resolves to NO');
  log('projects until client logins (xprojman-50) are built. App S18.14 E2E uses the assisted sign-off on the');
  log('supervisor\'s or PM\'s device (method assisted_device), which doesn\'t need the client to log in.');
}

// ── Remove ──────────────────────────────────────────────────────────────────────

async function remove() {
  const st = await state();
  if (!st.org) { log('Nothing to remove: the lab E2E organisation does not exist.'); return; }
  const orgId = st.org.id;
  const [members] = await pool.query('SELECT email FROM users WHERE org_id = ?', [orgId]);
  const foreign = members.filter((m) => !String(m.email).endsWith(`@${DOMAIN}`));
  if (foreign.length) {
    throw new Error(`Refusing: the org has ${foreign.length} user(s) outside @${DOMAIN}; remove them by hand first`);
  }
  const [[frozen]] = await pool.query('SELECT COUNT(*) AS n FROM client_signoffs WHERE org_id = ?', [orgId]);
  const [tables] = await pool.query(
    `SELECT DISTINCT c.table_name AS t FROM information_schema.columns c
       JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
      WHERE c.table_schema = DATABASE() AND c.column_name = 'org_id' AND c.table_name NOT IN ('organisations', 'users')`);
  log(`Organisation ${orgId}: ${members.length} user(s), ${tables.length} org-scoped tables to clear.`);

  if (Number(frozen.n) > 0) {
    // client_signoffs are frozen by DB triggers (v050): the org can't be hard-deleted. Deactivate instead.
    log(`  ! ${frozen.n} client sign-off(s) exist and are DB-frozen, so the org can't be deleted.`);
    log('  → deactivate instead: users disabled + sessions revoked, project soft-deleted, organisation suspended');
    if (!APPLY) return;
    await pool.query("UPDATE users SET status = 'disabled' WHERE org_id = ?", [orgId]);
    await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE user_id IN (SELECT id FROM users WHERE org_id = ?) AND revoked_at IS NULL', [orgId]);
    await pool.query('UPDATE projects SET is_deleted = 1 WHERE org_id = ?', [orgId]);
    await pool.query("UPDATE organisations SET status = 'suspended' WHERE id = ?", [orgId]);
    log('  ✓ deactivated');
    return;
  }

  log('  → hard delete every row with this org_id, then the users and the organisation');
  if (!APPLY) return;
  // FK order isn't known up front: retry passes until a pass deletes nothing more. One transaction, so
  // a row still referenced from elsewhere rolls everything back instead of leaving half an org.
  const conn = await pool.getConnection();
  let userCount = 0;
  try {
    await conn.beginTransaction();
    let pending = tables.map((r) => r.t || r.T || r.TABLE_NAME);
    for (let pass = 1; pending.length && pass <= 12; pass++) {
      const failed = [];
      for (const t of pending) {
        try { await conn.query(`DELETE FROM \`${t}\` WHERE org_id = ?`, [orgId]); }
        catch (err) {
          if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') failed.push(t);
          else throw err;
        }
      }
      if (failed.length === pending.length) break;
      pending = failed;
    }
    if (pending.length) throw new Error(`Could not clear: ${pending.join(', ')} (still referenced); rolled back, nothing removed`);
    const [userRows] = await conn.query('SELECT id FROM users WHERE org_id = ?', [orgId]);
    const userIds = userRows.map((u) => u.id);
    if (userIds.length) {
      await conn.query('DELETE FROM sessions WHERE user_id IN (?)', [userIds]);
      await conn.query('DELETE FROM users WHERE org_id = ?', [orgId]);
    }
    await conn.query('DELETE FROM organisations WHERE id = ?', [orgId]);
    await conn.commit();
    userCount = userIds.length;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  log(`  ✓ removed the organisation, ${userCount} user(s) and their rows`);
  log(`  (credentials file ${CRED_FILE} is left as is; delete the block by hand if you like)`);
}

(async () => {
  log(`lab-seed-e2e — ${mode}\nNo email, SMS or MQTT: rows are inserted directly or via non-notifying services.\n`);
  try {
    await access.loadMatrix(); // the services check permissions, as the server does after boot
    if (REMOVE) await remove(); else await seed();
    if (!APPLY) log('\nDry run only. Re-run with --apply to write.');
  } catch (err) {
    console.error(`\nFAILED: ${err.message}`);
    process.exitCode = 1;
  } finally {
    // Even after a failure: an account that was created must never be left without its password.
    try { writeCredentials(); } catch (err) { console.error(`Could not write ${CRED_FILE}: ${err.message}`); process.exitCode = 1; }
    await pool.end();
  }
})();
