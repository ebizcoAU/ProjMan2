// ProjectDeletionService — DELETE /projects/:id (xprojman-35, Portal Agent request,
// 2026-09-04). Owner directive: Cancel (a plain `status` flip, already covered by the
// existing PATCH) keeps every row; Delete is for a project that should never have
// existed and must be a REAL daisy-chain cascade, not another soft flag.
//
// ★ Corrected from Portal's original draft in two load-bearing ways (see
// xprojman-35.md §5 for the full writeup):
//
// 1. TWO-TIER CASCADE, not one hard-delete pass. Tables in `sync/registry.js`
//    (project_stages, tasks, project_members, site_diary, site_attendance,
//    deliveries, inspections, inspection_items, defects, certificates, ncc_register,
//    and `projects` itself) are what a device's /sync/pull cursor already tracks by
//    `server_updated_at`. A device that already pulled a row (the creator's own
//    device pulls project_stages/tasks the instant a project is created, since
//    StageTemplateService.instantiate runs at create time — this is NOT a rare case)
//    would NEVER receive a delete signal for a physically-removed row: there is
//    nothing left for the next incremental pull to find. So these tables are
//    TOMBSTONED (`is_deleted=1`, fresh `updated_at`/`server_updated_at`), the same
//    convention this codebase already uses everywhere else for exactly this reason
//    (MembershipService.removeMember, SyncService's own device-delete handling) —
//    NOT hard-deleted. Every genuinely REST-only table (never reaches a device via
//    sync) IS hard-deleted, which is where "every master/child row is gone" actually
//    happens at the SQL level.
// 2. A 4th eligibility condition — zero `engagements` rows for the project — that
//    Portal's draft didn't have. `attestations.engagement_id` FKs to `engagements`
//    with no ON DELETE action (RESTRICT), and attestations are a person's OWNED,
//    permanent verified-work-history record that is explicitly meant to "outlive,
//    and span, any one tenant relationship" (migration_v027's own header comment) —
//    they must never be touched by a project purge. Gating delete on zero
//    engagements guarantees, by construction, that no attestation can reference one
//    of this project's engagements, so `attestations`/`identities` need no code path
//    here at all, not even a no-op one.
//
// Every other correction is ordering: supplier_invoices before purchase_orders
// (invoices.po_id), progress_claims + job_awards before project_payments (both FK
// payment_id/deposit_payment_id into it), variations before contracts
// (variations.contract_id), subcontractor_engagements before job_awards
// (subeng.job_award_id). depreciation_schedule needs no explicit delete — its FK to
// fixed_assets is already ON DELETE CASCADE.

const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const storage = require('../lib/storage');
const MembershipService = require('./MembershipService');

// Sync-registered project-child tables — TOMBSTONE (is_deleted=1), never hard-deleted.
// `projects` itself is last on purpose, but nothing here actually depends on order:
// these are all plain UPDATEs, not DELETEs, so no FK-ordering constraint applies.
async function tombstoneSyncedTables(conn, { orgId, projectId, nowMs }) {
  const simple = [
    'project_stages', 'tasks', 'site_diary', 'site_attendance', 'deliveries',
    'inspections', 'defects', 'certificates', 'ncc_register',
  ];
  for (const table of simple) {
    await conn.query(
      `UPDATE \`${table}\` SET is_deleted = 1, updated_at = ?, server_updated_at = NOW(3)
        WHERE org_id = ? AND project_id = ? AND is_deleted = 0`,
      [nowMs, orgId, projectId]
    );
  }
  // Child-scoped (no project_id of its own) — join to its parent, same derivation
  // SyncService uses for the pull.
  await conn.query(
    `UPDATE inspection_items ii
       JOIN inspections i ON i.id = ii.inspection_id
        SET ii.is_deleted = 1, ii.updated_at = ?, ii.server_updated_at = NOW(3)
      WHERE i.org_id = ? AND i.project_id = ? AND ii.is_deleted = 0`,
    [nowMs, orgId, projectId]
  );
  await conn.query(
    `UPDATE project_members SET is_deleted = 1, updated_at = ?, server_updated_at = NOW(3)
      WHERE org_id = ? AND project_id = ? AND is_deleted = 0`,
    [nowMs, orgId, projectId]
  );
  await conn.query(
    `UPDATE projects SET is_deleted = 1, updated_at = ?, server_updated_at = NOW(3)
      WHERE id = ? AND org_id = ?`,
    [nowMs, projectId, orgId]
  );
}

// REST-only tables — never reach a device via /sync/*, so a genuine hard delete
// carries no stale-local-cache risk. Order matters here (unlike the tombstone pass
// above) because these rows are actually leaving the table.
async function hardDeleteRestOnlyTables(conn, { orgId, projectId }) {
  const del = (table) => conn.query(
    `DELETE FROM \`${table}\` WHERE org_id = ? AND project_id = ?`, [orgId, projectId]
  );
  await del('estimate_lines');
  await del('cost_plans');
  await del('supplier_invoices');   // before purchase_orders (fk_inv_po)
  await del('purchase_orders');
  await del('variations');          // before contracts (fk_variation_contract)
  await del('contracts');
  await del('subcontractor_engagements'); // before job_awards (fk_subeng_award)
  await del('progress_claims');     // before project_payments (fk_claim_payment) — empty per gate
  await del('job_awards');          // before project_payments (fk_award_deposit) — empty per gate
  await del('project_payments');
  await del('engagements');         // empty per gate — no-op safety net, same posture as
                                     // Portal's own progress_claims/job_awards rows below
  await del('fixed_assets');        // depreciation_schedule cascades (ON DELETE CASCADE)
  await del('hold_point_requirements');
  await del('modular_units');
}

/**
 * Delete a project. Re-checks eligibility INSIDE the transaction (not just before
 * it) so two concurrent requests — a progress-claim submission racing this delete —
 * can't both pass a gate check taken outside a shared lock.
 */
async function deleteProject({ orgId, projectId }) {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    // Row lock: nothing else can flip this project's status or insert a job_award/
    // progress_claim/engagement against it until this transaction resolves.
    const [[project]] = await conn.query(
      'SELECT status FROM projects WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1 FOR UPDATE',
      [projectId, orgId]
    );
    if (!project) throw new ServiceError('NOT_FOUND', 'Project not found', 404);
    if (project.status !== 'draft') {
      throw new ServiceError('NOT_DRAFT', 'Project is not in draft status. Use Cancel instead.', 409);
    }
    const [[{ n: claims }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM progress_claims WHERE project_id = ? AND org_id = ?', [projectId, orgId]
    );
    if (claims > 0) {
      throw new ServiceError('HAS_PROGRESS_CLAIMS',
        `Can't delete — ${claims} progress claim${claims === 1 ? '' : 's'} already submitted. Use Cancel instead.`, 409);
    }
    const [[{ n: awards }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM job_awards WHERE project_id = ? AND org_id = ?', [projectId, orgId]
    );
    if (awards > 0) {
      throw new ServiceError('HAS_JOB_AWARDS',
        `Can't delete — ${awards} job award${awards === 1 ? '' : 's'} already sent. Use Cancel instead.`, 409);
    }
    const [[{ n: engagementCount }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM engagements WHERE project_id = ? AND org_id = ?', [projectId, orgId]
    );
    if (engagementCount > 0) {
      throw new ServiceError('HAS_ENGAGEMENTS',
        `Can't delete — ${engagementCount} cross-org engagement${engagementCount === 1 ? '' : 's'} exist on this project. Use Cancel instead.`, 409);
    }

    // Grab the member list + document storage keys BEFORE either pass mutates them.
    const [members] = await conn.query(
      'SELECT user_id FROM project_members WHERE org_id = ? AND project_id = ? AND is_deleted = 0',
      [orgId, projectId]
    );
    const [docs] = await conn.query(
      'SELECT storage_key FROM documents WHERE org_id = ? AND project_id = ?',
      [orgId, projectId]
    );

    const nowMs = Date.now();
    await tombstoneSyncedTables(conn, { orgId, projectId, nowMs });
    await conn.query('DELETE FROM documents WHERE org_id = ? AND project_id = ?', [orgId, projectId]);
    await hardDeleteRestOnlyTables(conn, { orgId, projectId });

    await conn.commit();

    // File bytes live outside the DB — purge after commit so a rollback never leaves
    // the DB pointing at bytes we already removed. storage.remove is already best-effort.
    for (const { storage_key } of docs) storage.remove(storage_key);
    // Same convention as MembershipService.addMember/removeMember: any change to
    // what a device's next pull will contain flags a full resync, so a client that
    // already cached this project rebuilds from an authoritative response rather
    // than trickling in tombstones one incremental pull at a time.
    for (const { user_id } of members) {
      await MembershipService.flagResync(user_id).catch(() => {});
    }

    return { deleted: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { deleteProject };
