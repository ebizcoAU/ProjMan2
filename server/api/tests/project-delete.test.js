// Project status enum + DELETE /projects/:id — xprojman-35 (Portal Agent, 2026-09-04).
//
// Proves:
//   1. Enum: 'archived' rejected (renamed slot), 'inactive'/'cancelled' accepted; Cancel
//      is just that PATCH, so no dedicated cancel test beyond the enum accepting it.
//   2. Eligibility gate: NOT_DRAFT, HAS_PROGRESS_CLAIMS, HAS_JOB_AWARDS, HAS_ENGAGEMENTS
//      each independently block delete with 409 + a real reason.
//   3. The two-tier cascade: sync-registered tables (projects, project_stages, tasks,
//      project_members) are TOMBSTONED (is_deleted=1, row survives) so a device that
//      already pulled them gets a real delete signal on its next pull; REST-only tables
//      (estimate_lines/cost_plans, purchase_orders/supplier_invoices, contracts/
//      variations, fixed_assets incl. the depreciation_schedule ON DELETE CASCADE,
//      subcontractor_engagements, project_payments, hold_point_requirements,
//      modular_units, documents) are HARD-deleted, and a document's stored bytes are
//      actually purged from disk.
//   4. GET /projects/:id 404s post-delete (getProject already filters is_deleted=0 —
//      no new code needed there, just confirming the existing filter covers this).
//
// Run: DISABLE_RATE_LIMIT=true DB_NAME=c1projman2_e2e PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 DB_NAME=c1projman2_e2e node tests/project-delete.test.js
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';
const { v4: uuidv4 } = require('uuid');
const pool = require('../src/db/pool');
const storage = require('../src/lib/storage');
const DocumentService = require('../src/services/DocumentService');

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};
async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json; try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, json };
}

(async () => {
  console.log(`Project status/delete test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Delete Co ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;
  const orgId = reg.json.data.organisation.id;

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);

  async function newProject(tag, extra = {}) {
    const proj = await call('POST', '/projects', { code: `${tag}-${s}`, name: `Lot ${tag}`, unit_count: 2, ...extra }, pm);
    return proj.json.data.id;
  }

  // ── 1. Enum ──────────────────────────────────────────────────────────────
  const p1 = await newProject('ENUM');
  const badArchive = await call('PATCH', `/projects/${p1}`, { status: 'archived' }, pm);
  ok('archived is rejected (renamed slot, not a valid value any more)',
    badArchive.status === 422 && badArchive.json.code === 'VALIDATION_ERROR', JSON.stringify(badArchive.json));
  const toInactive = await call('PATCH', `/projects/${p1}`, { status: 'inactive' }, pm);
  ok('inactive accepted', toInactive.status === 200, JSON.stringify(toInactive.json));
  const toCancelled = await call('PATCH', `/projects/${p1}`, { status: 'cancelled' }, pm);
  ok('cancelled accepted', toCancelled.status === 200, JSON.stringify(toCancelled.json));
  const [[cancelledRow]] = await pool.query('SELECT is_deleted FROM projects WHERE id = ?', [p1]);
  ok('Cancel is a status flip only — row untouched otherwise (is_deleted still 0)',
    cancelledRow.is_deleted === 0);

  // ── 2. Eligibility gate, each condition in isolation ──────────────────────
  const pActive = await newProject('ACTIVE');
  await call('PATCH', `/projects/${pActive}`, { status: 'active' }, pm);
  const delActive = await call('DELETE', `/projects/${pActive}`, undefined, pm);
  ok('NOT_DRAFT blocks delete', delActive.status === 409 && delActive.json.code === 'NOT_DRAFT', JSON.stringify(delActive.json));

  const pClaim = await newProject('CLAIM');
  await pool.query(
    `INSERT INTO progress_claims (id, org_id, project_id, submitted_by, amount, status)
     VALUES (?, ?, ?, ?, 1000, 'submitted')`,
    [uuidv4(), orgId, pClaim, pmUser]
  );
  const delClaim = await call('DELETE', `/projects/${pClaim}`, undefined, pm);
  ok('HAS_PROGRESS_CLAIMS blocks delete', delClaim.status === 409 && delClaim.json.code === 'HAS_PROGRESS_CLAIMS', JSON.stringify(delClaim.json));

  const pAward = await newProject('AWARD');
  await pool.query(
    `INSERT INTO job_awards (id, org_id, project_id, from_user_id, to_user_id, role_offered, status)
     VALUES (?, ?, ?, ?, ?, 'builder', 'sent')`,
    [uuidv4(), orgId, pAward, pmUser, pmUser]
  );
  const delAward = await call('DELETE', `/projects/${pAward}`, undefined, pm);
  ok('HAS_JOB_AWARDS blocks delete', delAward.status === 409 && delAward.json.code === 'HAS_JOB_AWARDS', JSON.stringify(delAward.json));

  const pEng = await newProject('ENG');
  await pool.query(
    `INSERT INTO engagements (id, org_id, project_id, identity_user_id, role, scope_json, initiated_by)
     VALUES (?, ?, ?, ?, 'builder', ?, ?)`,
    [uuidv4(), orgId, pEng, pmUser, JSON.stringify({ project_id: pEng }), pmUser]
  );
  const delEng = await call('DELETE', `/projects/${pEng}`, undefined, pm);
  ok('HAS_ENGAGEMENTS blocks delete (protects attestations by construction)',
    delEng.status === 409 && delEng.json.code === 'HAS_ENGAGEMENTS', JSON.stringify(delEng.json));

  // ── 3. The real cascade — a project with a representative slice of every table kind ──
  const projId = await newProject('FULL');
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm); // seeds project_stages + tasks + hold_point_requirements

  const [[{ n: stageCountBefore }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM project_stages WHERE project_id = ? AND is_deleted = 0', [projId]);
  const [[{ n: taskCountBefore }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND is_deleted = 0', [projId]);
  const [[{ n: hprCountBefore }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM hold_point_requirements WHERE project_id = ?', [projId]);
  const [[{ n: unitCountBefore }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM modular_units WHERE project_id = ?', [projId]);
  ok('programme instantiation actually seeded stages/tasks/hold-points/units (sanity)',
    stageCountBefore === 18 && taskCountBefore > 0 && hprCountBefore > 0 && unitCountBefore === 2,
    JSON.stringify({ stageCountBefore, taskCountBefore, hprCountBefore, unitCountBefore }));

  // REST-only: estimate line (auto-creates cost_plans) + PO + matched invoice
  const line = await call('POST', `/projects/${projId}/estimate-lines`, { description: 'Slab', quantity: 1, rate: 20000 }, pm);
  ok('estimate line created', line.status === 201, JSON.stringify(line.json));
  const po = await call('POST', `/projects/${projId}/purchase-orders`, { amount: 5000, supplier_name: 'Concrete Co' }, pm);
  ok('PO created', po.status === 201, JSON.stringify(po.json));
  const inv = await call('POST', `/projects/${projId}/supplier-invoices`,
    { invoice_number: `INV-${s}`, amount: 5000, po_id: po.json.data.id, supplier_name: 'Concrete Co' }, pm);
  ok('supplier invoice created', inv.status === 201, JSON.stringify(inv.json));

  // REST-only, direct insert (setup shortcut — the write paths for these are already
  // covered by their own suites; only the DELETE cascade is under test here):
  const contractId = uuidv4();
  await pool.query(
    `INSERT INTO contracts (id, org_id, project_id, party_type, title) VALUES (?, ?, ?, 'client', 'Head contract')`,
    [contractId, orgId, projId]
  );
  await pool.query(
    `INSERT INTO variations (id, org_id, project_id, contract_id, description, amount)
     VALUES (?, ?, ?, ?, 'Extra window', 2500)`,
    [uuidv4(), orgId, projId, contractId]
  );
  await pool.query(
    `INSERT INTO subcontractor_engagements (id, org_id, project_id, subcontractor_name, trade)
     VALUES (?, ?, ?, 'Joe Sparky', 'electrical')`,
    [uuidv4(), orgId, projId]
  );
  await pool.query(
    `INSERT INTO project_payments (id, org_id, project_id, payee_user_id, amount, purpose)
     VALUES (?, ?, ?, ?, 1000, 'deposit')`,
    [uuidv4(), orgId, projId, pmUser]
  );
  const fixedAssetId = uuidv4();
  await pool.query(
    `INSERT INTO fixed_assets (id, org_id, project_id, description, acquisition_cost)
     VALUES (?, ?, ?, 'Site shed', 8000)`,
    [fixedAssetId, orgId, projId]
  );
  await pool.query(
    `INSERT INTO depreciation_schedule (id, org_id, fixed_asset_id, fy, opening_value, depreciation, closing_value)
     VALUES (?, ?, ?, '2025-26', 8000, 800, 7200)`,
    [uuidv4(), orgId, fixedAssetId]
  );

  // A real document, with real bytes on disk, so the purge is verified for real.
  const upload = await DocumentService.upload({
    orgId, actor: { userId: pmUser }, clientRef: uuidv4(), projectId: projId,
    originalFilename: 'site-photo.jpg', buffer: Buffer.from('fake-jpeg-bytes'),
  });
  const [[docRow]] = await pool.query('SELECT storage_key FROM documents WHERE id = ?', [upload.document_id]);
  ok('document bytes actually landed on disk before delete', storage.exists(docRow.storage_key));

  // The creator is self-enrolled as a member at project create — proves project_members
  // (the sync scope-source table) has a real row to tombstone, not zero.
  const [[memberBefore]] = await pool.query(
    'SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND is_deleted = 0', [projId]);
  ok('creator was self-enrolled as a member (sanity)', Number(memberBefore.n) >= 1);

  // ── The delete itself ──
  const del = await call('DELETE', `/projects/${projId}`, undefined, pm);
  ok('delete succeeds once eligible', del.status === 200, JSON.stringify(del.json));

  // ── Tier 1: sync-registered tables are TOMBSTONED, not gone ──
  const [[projRow]] = await pool.query('SELECT is_deleted FROM projects WHERE id = ?', [projId]);
  ok('projects row survives, tombstoned', projRow && projRow.is_deleted === 1);
  const [[{ n: stagesAfter }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM project_stages WHERE project_id = ? AND is_deleted = 1', [projId]);
  ok('all project_stages rows tombstoned', Number(stagesAfter) === stageCountBefore);
  const [[{ n: tasksAfter }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND is_deleted = 1', [projId]);
  ok('all tasks rows tombstoned', Number(tasksAfter) === taskCountBefore);
  const [[{ n: membersAfter }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND is_deleted = 1', [projId]);
  ok('project_members tombstoned (scope-source table, so a device still gets told)',
    Number(membersAfter) >= 1);

  // ── Tier 2: REST-only tables are actually gone ──
  const restOnly = [
    'estimate_lines', 'cost_plans', 'purchase_orders', 'supplier_invoices', 'contracts',
    'variations', 'subcontractor_engagements', 'project_payments', 'fixed_assets',
    'hold_point_requirements', 'modular_units', 'documents',
  ];
  for (const table of restOnly) {
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE project_id = ?`, [projId]);
    ok(`${table} fully purged`, Number(n) === 0, `left: ${n}`);
  }
  const [[{ n: depAfter }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM depreciation_schedule WHERE fixed_asset_id = ?', [fixedAssetId]);
  ok('depreciation_schedule cascaded off fixed_assets (ON DELETE CASCADE)', Number(depAfter) === 0);
  ok('document bytes actually removed from disk', !storage.exists(docRow.storage_key));

  // ── GET 404s post-delete (existing is_deleted=0 filter, no new code) ──
  const getAfter = await call('GET', `/projects/${projId}`, undefined, pm);
  ok('GET /projects/:id 404s after delete', getAfter.status === 404, JSON.stringify(getAfter.json));

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
