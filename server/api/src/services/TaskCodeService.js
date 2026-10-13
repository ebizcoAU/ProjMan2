// TaskCodeService — stored task codes and the server-ticked SYS+ steps (xprojman-56, v052).
//
// CODES: a task's code is stored (tasks.code), never derived from seq. Library-seeded tasks carry
// their library row's v3.4 code. Everything else is MINTED: S{stage}.{n}, n = 1 + the highest
// numeric part among the library codes of that stage and the codes already used in that project
// stage. Letter-suffixed codes are never minted, and a code the library reserves is never taken.
//
// SYS+ STEPS: a task with auto_event set is ticked by the server when the event fires, and a
// manual tick is refused (SYSTEM_STEP). Events: job_award_accepted, programme_activated,
// stage_validated (S12.10 Base / S13.11 Frame), cross_check (S18.10: Stages 12 + 15 validated),
// client_signoff (S18.14), project_completed (S18.15). attestations_emitted (S18.16) waits for a real
// emitter of the completion attestations.

const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const hooks = require('./stageHooks');

const numericPart = (code) => {
  const m = /^S\d+\.(\d+)$/.exec(code || '');
  return m ? Number(m[1]) : null;
};

/** Mint the next free code for a project stage. `conn` may be a pool or a transaction connection. */
async function mint(conn, { orgId, stageId }) {
  const [[stage]] = await conn.query(
    'SELECT seq, project_id FROM project_stages WHERE id = ? AND org_id = ? LIMIT 1', [stageId, orgId]);
  if (!stage) return null;
  const [lib] = await conn.query('SELECT code FROM stage_task_templates WHERE stage_seq = ?', [stage.seq]);
  const [used] = await conn.query(
    'SELECT code FROM tasks WHERE stage_id = ? AND org_id = ? AND code IS NOT NULL', [stageId, orgId]);
  let max = 0;
  for (const r of [...lib, ...used]) {
    const n = numericPart(r.code);
    if (n != null && n > max) max = n;
  }
  return `S${stage.seq}.${max + 1}`;
}

/** Give every code-less task on a project (with a stage) a minted code. Cheap when there are none. */
async function ensureCodes(orgId, projectId) {
  const [rows] = await pool.query(
    `SELECT id, stage_id FROM tasks
      WHERE org_id = ? AND project_id = ? AND code IS NULL AND stage_id IS NOT NULL AND is_deleted = 0
      ORDER BY seq IS NULL, seq, created_at`, [orgId, projectId]);
  for (const r of rows) {
    const code = await mint(pool, { orgId, stageId: r.stage_id });
    if (code) {
      await pool.query('UPDATE tasks SET code = ?, server_updated_at = NOW(3) WHERE id = ? AND code IS NULL', [code, r.id]);
    }
  }
}

/** Refuse a manual change to a SYS+ step. */
function assertNotSystemStep(task) {
  if (task?.auto_event) {
    throw new ServiceError('SYSTEM_STEP', 'This step is completed by the system when its event happens', 409,
      { auto_event: task.auto_event });
  }
}

/**
 * Tick (or, for a re-opened gate, un-tick) the SYS+ tasks of a project for an event.
 * `stageSeq` narrows stage_validated to the stage that was validated.
 */
async function autoTick(orgId, projectId, event, { stageSeq = null, done = true } = {}) {
  const params = [done ? 'complete' : 'not_started', done ? 100 : 0, orgId, projectId, event];
  let stageSql = '';
  if (stageSeq != null) { stageSql = ' AND ps.seq = ?'; params.push(stageSeq); }
  await pool.query(
    `UPDATE tasks t JOIN project_stages ps ON ps.id = t.stage_id
        SET t.status = ?, t.completion = ?, t.server_updated_at = NOW(3)
      WHERE t.org_id = ? AND t.project_id = ? AND t.auto_event = ? AND t.is_deleted = 0${stageSql}`,
    params);
}

async function crossCheck(orgId, projectId) {
  const [[r]] = await pool.query(
    `SELECT SUM(seq = 12 AND is_validated = 1) AS s12, SUM(seq = 15 AND is_validated = 1) AS s15
       FROM project_stages WHERE org_id = ? AND project_id = ? AND is_deleted = 0`, [orgId, projectId]);
  if (Number(r?.s12) && Number(r?.s15)) await autoTick(orgId, projectId, 'cross_check');
}

// Stage engine events → SYS+ ticks. Hook handlers never fail the transition that fired them.
hooks.on('onStageValidated', async ({ orgId, projectId, stage }) => {
  const seq = Number(stage?.seq);
  if (seq === 12 || seq === 13) await autoTick(orgId, projectId, 'stage_validated', { stageSeq: seq });
  if (seq === 12 || seq === 15) await crossCheck(orgId, projectId);
});
hooks.on('onStageCompleted', async ({ orgId, projectId, stage }) => {
  // S18.16 (attestations_emitted) is NOT ticked here: nothing writes the per-participant
  // attestations at completion yet, and ticking it would record work that didn't happen.
  if (Number(stage?.seq) === 18) await autoTick(orgId, projectId, 'project_completed');
});

module.exports = { mint, ensureCodes, assertNotSystemStep, autoTick };
