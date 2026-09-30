// SafetyService — Safety/OHS (xprojman-48 as ruled in §7.1 and agreed in §8, migration v048).
//
// SYNC (App, offline): guardPush BEFORE the generic writer, afterPush AFTER it, for
// safety_events / incident_details / safety_actions / site_inductions.
//   * raise = safety.report; every change after that = safety.manage (F7: never Builder).
//   * is_notifiable is create-only on sync; a notifiable event is append-only on sync
//     (SAFETY_FROZEN, terminal) — corrections go through REST, with an audited diff.
//   * closing needs every action closed (SAFETY_OPEN_ACTIONS, retryable, details.action_ids).
//   * incident_details is create-only and never pulled (health information, F2).
// REST (Portal): list/detail/respond/close/notifiable/actions/summary/inductions/SWMS reads.
// ALERTS (F3/F5): email the PM + Site Supervisor(s) and publish an MQTT nudge. Fire and
// forget — an alert never blocks or fails the domain write.

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const config = require('../config');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const { projectScope } = require('../lib/scope');
const { sendMail } = require('../lib/email');
const mqtt = require('../mqtt/client');
const ProjectService = require('./ProjectService');

const SYNC_TABLES = new Set(['safety_events', 'incident_details', 'safety_actions', 'site_inductions']);
const KINDS = ['hazard', 'near_miss', 'incident'];
const SEVERITIES = ['low', 'medium', 'high'];
const STATUSES = ['open', 'in_progress', 'closed'];
const EXPIRING_DAYS = 14;

const isSafetyOps = (wireName) => SYNC_TABLES.has(wireName);
const canReport = (role) => access.hasPermission(role, 'safety.report');
const canManage = (role) => access.hasPermission(role, 'safety.manage');

function requireManage(role) {
  if (!canManage(role)) throw new ServiceError('FORBIDDEN', 'Requires permission: safety.manage', 403);
}

async function loadEvent(orgId, id) {
  const [[row]] = await pool.query('SELECT * FROM safety_events WHERE id = ? AND org_id = ? LIMIT 1', [id, orgId]);
  return row;
}

async function openActionIds(orgId, eventId) {
  const [rows] = await pool.query(
    `SELECT id FROM safety_actions WHERE event_id = ? AND org_id = ? AND status = 'open' AND is_deleted = 0`,
    [eventId, orgId]);
  return rows.map((r) => r.id);
}

async function assertClosable(orgId, eventId) {
  const ids = await openActionIds(orgId, eventId);
  if (ids.length) {
    throw new ServiceError('SAFETY_OPEN_ACTIONS', `${ids.length} corrective action(s) still open`, 409,
      { action_ids: ids });
  }
}

// ── Alerts ────────────────────────────────────────────────────────────────────

async function recipients(orgId, projectId, { includePm = true } = {}) {
  // The project's Site Supervisor(s) and — for F3 — its PM(s): members with that role,
  // plus the named pm_user_id (who may not be a member row).
  const roles = includePm ? ['siteSupervisor', 'projectManager'] : ['siteSupervisor'];
  const [rows] = await pool.query(
    `SELECT DISTINCT u.email, u.full_name
       FROM users u
      WHERE u.org_id = ? AND u.email IS NOT NULL
        AND ( (u.role IN (${roles.map(() => '?').join(',')}) AND u.id IN
                (SELECT pm.user_id FROM project_members pm WHERE pm.project_id = ? AND pm.is_deleted = 0))
              ${includePm ? 'OR u.id = (SELECT p.pm_user_id FROM projects p WHERE p.id = ?)' : ''} )`,
    [orgId, ...roles, projectId, ...(includePm ? [projectId] : [])]
  );
  return rows;
}

/** Fire-and-forget: never throws into the caller. */
function alert({ orgId, projectId, topic, subject, text, recipientsOpts }) {
  (async () => {
    try {
      mqtt.publish(`${config.mqtt.topicPrefix}/${orgId}/safety/${topic.event}`, { ...topic.payload, ts: Date.now() });
      const to = await recipients(orgId, projectId, recipientsOpts);
      if (!to.length) console.warn(`[SAFETY] no alert recipients for project ${projectId} (${topic.event})`);
      for (const r of to) await sendMail({ to: r.email, subject, text });
    } catch (err) {
      console.warn('[SAFETY] alert failed (non-fatal):', err.message);
    }
  })();
}

async function alertNotifiable(orgId, eventId) {
  const [[e]] = await pool.query(
    `SELECT e.id, e.project_id, e.kind, e.description, e.location, p.name AS project_name
       FROM safety_events e JOIN projects p ON p.id = e.project_id WHERE e.id = ? AND e.org_id = ?`,
    [eventId, orgId]);
  if (!e) return;
  // F3 wording: ProjMan records and emails. It does not notify the regulator.
  alert({
    orgId, projectId: e.project_id,
    topic: { event: 'notifiable', payload: { event_id: e.id, project_id: e.project_id } },
    subject: `Notifiable ${e.kind.replace('_', ' ')} recorded — ${e.project_name}`,
    text: `A ${e.kind.replace('_', ' ')} on ${e.project_name} has been flagged as notifiable.\n\n`
      + `${e.description}${e.location ? `\nLocation: ${e.location}` : ''}\n\n`
      + 'ProjMan has recorded this incident and emailed the PM and Site Supervisor. '
      + 'It does not notify the regulator for you.',
  });
}

/** F5: derive site_attendance.induction_ok at check-in; warn + alert, never block. */
async function deriveInduction({ orgId, attendanceId }) {
  const [[a]] = await pool.query(
    `SELECT a.id, a.project_id, a.person_id, a.person_name, p.name AS project_name
       FROM site_attendance a JOIN projects p ON p.id = a.project_id
      WHERE a.id = ? AND a.org_id = ? LIMIT 1`, [attendanceId, orgId]);
  if (!a) return;
  const [[hit]] = await pool.query(
    `SELECT id FROM site_inductions
      WHERE org_id = ? AND project_id = ? AND is_deleted = 0
        AND (expires_at IS NULL OR expires_at >= CURDATE())
        AND ( (? IS NOT NULL AND user_id = ?) OR (? IS NOT NULL AND LOWER(name) = LOWER(?)) )
      LIMIT 1`,
    [orgId, a.project_id, a.person_id, a.person_id, a.person_name, a.person_name]);
  const ok = hit ? 1 : 0;
  await pool.query(
    'UPDATE site_attendance SET induction_ok = ?, server_updated_at = NOW(3) WHERE id = ? AND org_id = ?',
    [ok, a.id, orgId]);
  if (!ok) {
    alert({
      orgId, projectId: a.project_id,
      topic: { event: 'induction_missing', payload: { attendance_id: a.id, project_id: a.project_id } },
      subject: `Site sign-in without a current induction — ${a.project_name}`,
      text: `${a.person_name || 'A worker'} signed in on ${a.project_name} without a current site induction. `
        + 'Sign-in was not blocked. Please induct them.',
    });
  }
}

// ── Sync guard / after ────────────────────────────────────────────────────────

async function guardPush({ wireName, operation, id, safe, actor }) {
  if (!isSafetyOps(wireName)) return;
  const { orgId, userId, role } = actor;

  if (wireName === 'safety_events') {
    const current = await loadEvent(orgId, id);
    if (!current) {
      if (!canReport(role)) throw new ServiceError('FORBIDDEN', 'Requires permission: safety.report', 403);
      if (!KINDS.includes(safe.kind)) throw new ServiceError('VALIDATION_ERROR', `kind must be one of ${KINDS.join(', ')}`, 400);
      if (!safe.description || !String(safe.description).trim()) {
        throw new ServiceError('VALIDATION_ERROR', 'description is required', 400);
      }
      if (safe.status && safe.status !== 'open') {
        throw new ServiceError('VALIDATION_ERROR', 'A safety event is raised open', 400);
      }
      delete safe.close_note;
      safe.raised_by = userId;
      return;
    }
    // After raising: append-only if notifiable, manage-only otherwise.
    if (current.is_notifiable) {
      throw new ServiceError('SAFETY_FROZEN',
        'A notifiable incident is append-only on the device — corrections go through the Portal', 409);
    }
    requireManage(role);
    delete safe.is_notifiable; // create-only on sync (REST confirms/clears it)
    if (operation === 'delete' || safe.is_deleted) return;
    if (safe.status === 'closed' && current.status !== 'closed') await assertClosable(orgId, id);
    return;
  }

  if (wireName === 'incident_details') {
    if (!canReport(role)) throw new ServiceError('FORBIDDEN', 'Requires permission: safety.report', 403);
    const [[existing]] = await pool.query('SELECT id FROM incident_details WHERE id = ? AND org_id = ? LIMIT 1', [id, orgId]);
    if (existing || operation !== 'create') {
      throw new ServiceError('CREATE_ONLY', 'Incident details are create-only on the device; corrections go through the Portal', 409);
    }
    const ev = safe.event_id ? await loadEvent(orgId, safe.event_id) : null;
    if (!ev) throw new ServiceError('NOT_FOUND', 'Safety event not found', 404);
    const [[dup]] = await pool.query('SELECT id FROM incident_details WHERE event_id = ? LIMIT 1', [ev.id]);
    if (dup) throw new ServiceError('CREATE_ONLY', 'This event already has incident details', 409);
    return;
  }

  if (wireName === 'safety_actions') {
    requireManage(role);
    let eventId = safe.event_id;
    const [[existing]] = await pool.query('SELECT * FROM safety_actions WHERE id = ? AND org_id = ? LIMIT 1', [id, orgId]);
    if (!eventId) eventId = existing?.event_id;
    const ev = eventId ? await loadEvent(orgId, eventId) : null;
    if (!ev) throw new ServiceError('NOT_FOUND', 'Safety event not found', 404);
    if (!existing && (!safe.action || !String(safe.action).trim())) {
      throw new ServiceError('VALIDATION_ERROR', 'action is required', 400);
    }
    return;
  }

  // site_inductions
  requireManage(role);
  const [[existing]] = await pool.query('SELECT id FROM site_inductions WHERE id = ? AND org_id = ? LIMIT 1', [id, orgId]);
  if (!existing) {
    if (!safe.user_id && !safe.name) throw new ServiceError('VALIDATION_ERROR', 'An induction needs user_id or name', 400);
    if (!safe.inducted_at) throw new ServiceError('VALIDATION_ERROR', 'inducted_at is required', 400);
    safe.inducted_by = userId;
  }
}

async function afterPush({ wireName, operation, id, safe, actor }) {
  const { orgId, userId } = actor;
  if (wireName === 'safety_events') {
    await pool.query(
      `UPDATE safety_events SET raised_at = COALESCE(raised_at, NOW()) WHERE id = ? AND org_id = ?`, [id, orgId]);
    if (safe.status === 'closed') {
      await pool.query(
        `UPDATE safety_events SET closed_by = COALESCE(closed_by, ?), closed_at = COALESCE(closed_at, NOW())
          WHERE id = ? AND org_id = ?`, [userId, id, orgId]);
    }
    if (operation === 'create' && Number(safe.is_notifiable) === 1) await alertNotifiable(orgId, id);
    return;
  }
  if (wireName === 'safety_actions') {
    await afterActionWrite({ orgId, userId, actionId: id, status: safe.status });
  }
}

async function afterActionWrite({ orgId, userId, actionId, status }) {
  if (status === 'closed') {
    await pool.query(
      `UPDATE safety_actions SET closed_by = COALESCE(closed_by, ?), closed_at = COALESCE(closed_at, NOW())
        WHERE id = ? AND org_id = ?`, [userId, actionId, orgId]);
  }
  // Responding moves an open event to in_progress.
  await pool.query(
    `UPDATE safety_events e JOIN safety_actions a ON a.event_id = e.id
        SET e.status = 'in_progress', e.updated_at = ?
      WHERE a.id = ? AND a.org_id = ? AND e.status = 'open'`, [Date.now(), actionId, orgId]);
}

// ── REST ──────────────────────────────────────────────────────────────────────

const person = (id, name) => (id ? { id, name: name || null } : null);

async function documentsFor(orgId, entityType, ids) {
  const by = new Map();
  if (!ids.length) return by;
  const [docs] = await pool.query(
    `SELECT id, entity_id, kind, original_filename AS file_name, created_at FROM documents
      WHERE org_id = ? AND entity_type = ? AND is_deleted = 0 AND entity_id IN (${ids.map(() => '?').join(',')})
      ORDER BY created_at`, [orgId, entityType, ...ids]);
  for (const d of docs) {
    if (!by.has(d.entity_id)) by.set(d.entity_id, []);
    by.get(d.entity_id).push({ id: d.id, kind: d.kind, file_name: d.file_name, created_at: d.created_at });
  }
  return by;
}

const EVENT_SELECT = `
  SELECT e.id, e.project_id, e.stage_id, e.unit_id, e.kind, e.description, e.location, e.severity,
         e.status, e.occurred_at, e.lat, e.lng, e.is_notifiable,
         e.notifiable_confirmed_by, nu.full_name AS notifiable_confirmed_by_name,
         e.notified_at, e.regulator_reference,
         e.raised_by, ru.full_name AS raised_by_name, e.raised_at,
         e.closed_by, cu.full_name AS closed_by_name, e.closed_at, e.close_note, e.created_at
    FROM safety_events e
    LEFT JOIN users ru ON ru.id = e.raised_by
    LEFT JOIN users cu ON cu.id = e.closed_by
    LEFT JOIN users nu ON nu.id = e.notifiable_confirmed_by`;

function shapeEvent(r) {
  const { raised_by_name, closed_by_name, notifiable_confirmed_by_name, ...rest } = r;
  return {
    ...rest,
    raised_by: person(r.raised_by, raised_by_name),
    closed_by: person(r.closed_by, closed_by_name),
    notifiable_confirmed_by: person(r.notifiable_confirmed_by, notifiable_confirmed_by_name),
  };
}

/** GET /projects/:id/safety-events — safety.report OR safety.manage (F7: Builder's list). */
async function listEvents({ orgId, auth, projectId, query }) {
  if (!canReport(auth.role) && !canManage(auth.role)) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: safety.report or safety.manage', 403);
  }
  await ProjectService.assertProjectReachable(orgId, projectId, auth);
  const where = ['e.org_id = ?', 'e.project_id = ?', 'e.is_deleted = 0'];
  const params = [orgId, projectId];
  const enumFilter = (key, allowed) => {
    if (!query[key]) return;
    if (!allowed.includes(query[key])) throw new ServiceError('VALIDATION_ERROR', `${key} must be one of ${allowed.join(', ')}`, 400);
    where.push(`e.${key} = ?`); params.push(query[key]);
  };
  enumFilter('kind', KINDS); enumFilter('status', STATUSES); enumFilter('severity', SEVERITIES);
  if (query.is_notifiable !== undefined && query.is_notifiable !== '') {
    where.push('e.is_notifiable = ?'); params.push(Number(query.is_notifiable) ? 1 : 0);
  }
  if (query.from) { where.push('COALESCE(e.occurred_at, e.created_at) >= ?'); params.push(query.from); }
  if (query.to) { where.push('COALESCE(e.occurred_at, e.created_at) < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(query.to); }
  if (query.cursor) {
    const [cAt, cId] = String(query.cursor).split('|');
    where.push('(e.created_at < ? OR (e.created_at = ? AND e.id < ?))'); params.push(cAt, cAt, cId || '');
  }
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const [rows] = await pool.query(
    `${EVENT_SELECT.replace('SELECT e.id,', `SELECT
         (SELECT COUNT(*) FROM safety_actions a WHERE a.event_id = e.id AND a.is_deleted = 0 AND a.status = 'open') AS open_action_count,
         (SELECT COUNT(*) FROM safety_actions a WHERE a.event_id = e.id AND a.is_deleted = 0 AND a.status = 'open'
             AND a.due_date IS NOT NULL AND a.due_date < CURDATE()) AS overdue_action_count,
         e.id,`)}
      WHERE ${where.join(' AND ')}
      ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
    [...params, limit + 1]);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    safety_events: page.map((r) => ({
      ...shapeEvent(r),
      open_action_count: Number(r.open_action_count), overdue_action_count: Number(r.overdue_action_count),
    })),
    next_cursor: rows.length > limit && last ? `${last.created_at}|${last.id}` : null,
  };
}

async function loadReachableEvent(orgId, auth, id) {
  const scope = projectScope(auth, { projectColumn: 'project_id', alias: 'e' });
  const [[row]] = await pool.query(`${EVENT_SELECT} WHERE e.id = ? AND e.org_id = ? AND e.is_deleted = 0${scope.sql} LIMIT 1`,
    [id, orgId, ...scope.params]);
  if (!row) throw new ServiceError('NOT_FOUND', 'Safety event not found', 404);
  return row;
}

/** GET /safety-events/:id — safety.manage, or the original reporter. */
async function getEvent({ orgId, auth, id }) {
  const row = await loadReachableEvent(orgId, auth, id);
  const isReporter = String(row.raised_by) === String(auth.userId);
  if (!canManage(auth.role) && !isReporter) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: safety.manage (or be the reporter)', 403);
  }
  const [actions] = await pool.query(
    `SELECT a.id, a.event_id, a.action, a.assigned_to, a.assigned_to_name, a.due_date, a.status,
            a.closed_by, cu.full_name AS closed_by_name, a.closed_at, a.created_at
       FROM safety_actions a LEFT JOIN users cu ON cu.id = a.closed_by
      WHERE a.event_id = ? AND a.org_id = ? AND a.is_deleted = 0 ORDER BY a.created_at`, [id, orgId]);
  const [[details]] = await pool.query(
    `SELECT injured_user_id, injured_name, injury_type, body_part, treatment, lost_time, witness_names
       FROM incident_details WHERE event_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1`, [id, orgId]);
  const eventDocs = await documentsFor(orgId, 'safety_event', [id]);
  const actionDocs = await documentsFor(orgId, 'safety_action', actions.map((a) => a.id));
  return {
    safety_event: {
      ...shapeEvent(row),
      documents: eventDocs.get(id) || [],
      actions: actions.map(({ closed_by_name, ...a }) => ({
        ...a, closed_by: person(a.closed_by, closed_by_name), documents: actionDocs.get(a.id) || [],
      })),
      incident_details: details || null,
    },
  };
}

async function manageEvent(orgId, auth, id) {
  requireManage(auth.role);
  const row = await loadReachableEvent(orgId, auth, id);
  return row;
}

/** PATCH /safety-events/:id — severity/location/description/status (not closed). Audited. */
async function patchEvent({ orgId, auth, id, body, audit }) {
  const before = await manageEvent(orgId, auth, id);
  const sets = []; const params = []; const diff = {};
  const set = (col, val) => { sets.push(`${col} = ?`); params.push(val); diff[col] = { from: before[col], to: val }; };
  if (body.severity !== undefined) {
    if (!SEVERITIES.includes(body.severity)) throw new ServiceError('VALIDATION_ERROR', `severity must be one of ${SEVERITIES.join(', ')}`, 400);
    set('severity', body.severity);
  }
  if (body.location !== undefined) set('location', body.location || null);
  if (body.description !== undefined) {
    if (!String(body.description).trim()) throw new ServiceError('VALIDATION_ERROR', 'description cannot be empty', 400);
    set('description', body.description);
  }
  if (body.status !== undefined) {
    if (!['open', 'in_progress'].includes(body.status)) {
      throw new ServiceError('VALIDATION_ERROR', 'status must be open or in_progress — close with POST .../close', 400);
    }
    set('status', body.status);
  }
  if (!sets.length) throw new ServiceError('VALIDATION_ERROR', 'Nothing to update', 400);
  await pool.query(`UPDATE safety_events SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND org_id = ?`,
    [...params, Date.now(), id, orgId]);
  await audit('safety_event.update', { entity: 'safety_events', entityId: id, detail: diff });
  return { id, ...Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.to])) };
}

async function closeEvent({ orgId, auth, id, closeNote, audit }) {
  const before = await manageEvent(orgId, auth, id);
  if (before.status === 'closed') throw new ServiceError('ALREADY_CLOSED', 'This event is already closed', 409);
  await assertClosable(orgId, id);
  await pool.query(
    `UPDATE safety_events SET status = 'closed', close_note = ?, closed_by = ?, closed_at = NOW(), updated_at = ?
      WHERE id = ? AND org_id = ?`, [closeNote || null, auth.userId, Date.now(), id, orgId]);
  await audit('safety_event.close', { entity: 'safety_events', entityId: id, detail: { close_note: closeNote || null } });
  return { id, status: 'closed' };
}

/** PATCH /safety-events/:id/notifiable — confirm/clear + the regulator fields. Audited. */
async function setNotifiable({ orgId, auth, id, body, audit }) {
  const before = await manageEvent(orgId, auth, id);
  const sets = []; const params = []; const diff = {};
  if (body.is_notifiable !== undefined) {
    const v = body.is_notifiable ? 1 : 0;
    sets.push('is_notifiable = ?', 'notifiable_confirmed_by = ?'); params.push(v, auth.userId);
    diff.is_notifiable = { from: before.is_notifiable, to: v };
  }
  if (body.notified_at !== undefined) {
    sets.push('notified_at = ?'); params.push(body.notified_at || null);
    diff.notified_at = { from: before.notified_at, to: body.notified_at || null };
  }
  if (body.regulator_reference !== undefined) {
    sets.push('regulator_reference = ?'); params.push(body.regulator_reference || null);
    diff.regulator_reference = { from: before.regulator_reference, to: body.regulator_reference || null };
  }
  if (!sets.length) throw new ServiceError('VALIDATION_ERROR', 'Nothing to update', 400);
  await pool.query(`UPDATE safety_events SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND org_id = ?`,
    [...params, Date.now(), id, orgId]);
  await audit('safety_event.notifiable', { entity: 'safety_events', entityId: id, detail: diff });
  if (diff.is_notifiable && diff.is_notifiable.to === 1 && !before.is_notifiable) await alertNotifiable(orgId, id);
  return getEvent({ orgId, auth, id });
}

/** PATCH /safety-events/:id/incident-details — manage or reporter; audited diff. */
async function patchIncidentDetails({ orgId, auth, id, body, audit }) {
  const ev = await loadReachableEvent(orgId, auth, id);
  if (!canManage(auth.role) && String(ev.raised_by) !== String(auth.userId)) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: safety.manage (or be the reporter)', 403);
  }
  const cols = ['injured_user_id', 'injured_name', 'injury_type', 'body_part', 'treatment', 'lost_time', 'witness_names'];
  const [[before]] = await pool.query('SELECT * FROM incident_details WHERE event_id = ? AND org_id = ? LIMIT 1', [id, orgId]);
  const diff = {};
  const vals = {};
  for (const c of cols) if (body[c] !== undefined) { vals[c] = body[c]; diff[c] = { from: before?.[c] ?? null, to: body[c] }; }
  if (!Object.keys(vals).length) throw new ServiceError('VALIDATION_ERROR', 'Nothing to update', 400);
  if (before) {
    await pool.query(`UPDATE incident_details SET ${Object.keys(vals).map((c) => `${c} = ?`).join(', ')}, updated_at = ?
                       WHERE id = ?`, [...Object.values(vals), Date.now(), before.id]);
  } else {
    await pool.query(`INSERT INTO incident_details (id, org_id, event_id, ${Object.keys(vals).join(', ')}, updated_at)
                      VALUES (?, ?, ?, ${Object.keys(vals).map(() => '?').join(', ')}, ?)`,
      [uuidv4(), orgId, id, ...Object.values(vals), Date.now()]);
  }
  await audit('incident_details.update', { entity: 'incident_details', entityId: id, detail: diff });
  return (await getEvent({ orgId, auth, id })).safety_event.incident_details;
}

async function addAction({ orgId, auth, eventId, body, audit }) {
  await manageEvent(orgId, auth, eventId);
  if (!body.action || !String(body.action).trim()) throw new ServiceError('VALIDATION_ERROR', 'action is required', 400);
  const id = uuidv4();
  await pool.query(
    `INSERT INTO safety_actions (id, org_id, event_id, action, assigned_to, assigned_to_name, due_date, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, orgId, eventId, body.action, body.assigned_to || null, body.assigned_to_name || null, body.due_date || null, Date.now()]);
  await afterActionWrite({ orgId, userId: auth.userId, actionId: id });
  await audit('safety_action.create', { entity: 'safety_actions', entityId: id, detail: { event_id: eventId } });
  const [[a]] = await pool.query('SELECT * FROM safety_actions WHERE id = ?', [id]);
  return { ...a, closed_by: null, documents: [] };
}

async function patchAction({ orgId, auth, actionId, body, audit }) {
  requireManage(auth.role);
  const [[a]] = await pool.query('SELECT * FROM safety_actions WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1', [actionId, orgId]);
  if (!a) throw new ServiceError('NOT_FOUND', 'Action not found', 404);
  await loadReachableEvent(orgId, auth, a.event_id);
  if (a.status === 'closed') throw new ServiceError('ALREADY_CLOSED', 'This action is closed', 409);
  const sets = []; const params = [];
  for (const c of ['action', 'assigned_to', 'assigned_to_name', 'due_date']) {
    if (body[c] !== undefined) { sets.push(`${c} = ?`); params.push(body[c] || null); }
  }
  if (body.status !== undefined) {
    if (!['open', 'closed'].includes(body.status)) throw new ServiceError('VALIDATION_ERROR', 'status must be open or closed', 400);
    sets.push('status = ?'); params.push(body.status);
  }
  if (!sets.length) throw new ServiceError('VALIDATION_ERROR', 'Nothing to update', 400);
  await pool.query(`UPDATE safety_actions SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, Date.now(), actionId]);
  await afterActionWrite({ orgId, userId: auth.userId, actionId, status: body.status });
  await audit('safety_action.update', { entity: 'safety_actions', entityId: actionId, detail: body });
  const [[after]] = await pool.query(
    `SELECT a.*, cu.full_name AS closed_by_name FROM safety_actions a LEFT JOIN users cu ON cu.id = a.closed_by WHERE a.id = ?`, [actionId]);
  const { closed_by_name, ...rest } = after;
  return { ...rest, closed_by: person(after.closed_by, closed_by_name) };
}

/** GET /safety/summary — safety.manage; reach follows projectScope. */
async function summary({ orgId, auth, query }) {
  requireManage(auth.role);
  const scope = projectScope(auth, { projectColumn: 'project_id', alias: 'e' });
  const where = ['e.org_id = ?', 'e.is_deleted = 0']; const params = [orgId];
  if (query.project_id) { where.push('e.project_id = ?'); params.push(query.project_id); }
  if (query.from) { where.push('COALESCE(e.occurred_at, e.created_at) >= ?'); params.push(query.from); }
  if (query.to) { where.push('COALESCE(e.occurred_at, e.created_at) < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(query.to); }
  const whereSql = `${where.join(' AND ')}${scope.sql}`;
  const allParams = [...params, ...scope.params];
  const [evs] = await pool.query(
    `SELECT e.kind, e.severity, e.status, e.is_notifiable,
            DATE_FORMAT(COALESCE(e.occurred_at, e.created_at), '%Y-%m') AS period
       FROM safety_events e WHERE ${whereSql}`, allParams);
  const count = (key, vals) => Object.fromEntries(vals.map((v) => [v, evs.filter((e) => e[key] === v).length]));
  const months = {};
  for (const e of evs) {
    months[e.period] ||= { period: e.period, hazard: 0, near_miss: 0, incident: 0 };
    months[e.period][e.kind] += 1;
  }
  const aScope = projectScope(auth, { projectColumn: 'project_id', alias: 'e' });
  const [overdue] = await pool.query(
    `SELECT a.id AS action_id, a.event_id, e.project_id, a.due_date, a.assigned_to_name, a.action
       FROM safety_actions a JOIN safety_events e ON e.id = a.event_id
      WHERE a.org_id = ? AND a.is_deleted = 0 AND a.status = 'open' AND a.due_date < CURDATE()
        AND e.is_deleted = 0${query.project_id ? ' AND e.project_id = ?' : ''}${aScope.sql}
      ORDER BY a.due_date`,
    [orgId, ...(query.project_id ? [query.project_id] : []), ...aScope.params]);
  return {
    totals: { by_kind: count('kind', KINDS), by_severity: count('severity', SEVERITIES), by_status: count('status', STATUSES) },
    series: Object.values(months).sort((a, b) => a.period.localeCompare(b.period)),
    notifiable_count: evs.filter((e) => Number(e.is_notifiable) === 1).length,
    overdue_actions: overdue,
  };
}

/** GET /projects/:id/site-inductions?status=valid|expiring|expired — safety.manage. */
async function listInductions({ orgId, auth, projectId, status }) {
  requireManage(auth.role);
  await ProjectService.assertProjectReachable(orgId, projectId, auth);
  const [rows] = await pool.query(
    `SELECT i.id, i.user_id, COALESCE(u.full_name, i.name) AS name, i.inducted_by, ib.full_name AS inducted_by_name,
            i.inducted_at, i.expires_at, i.checklist_instance_id,
            CASE WHEN i.expires_at IS NULL THEN 'valid'
                 WHEN i.expires_at < CURDATE() THEN 'expired'
                 WHEN i.expires_at <= DATE_ADD(CURDATE(), INTERVAL ${EXPIRING_DAYS} DAY) THEN 'expiring'
                 ELSE 'valid' END AS status
       FROM site_inductions i
       LEFT JOIN users u  ON u.id = i.user_id
       LEFT JOIN users ib ON ib.id = i.inducted_by
      WHERE i.org_id = ? AND i.project_id = ? AND i.is_deleted = 0
      ORDER BY i.inducted_at DESC`, [orgId, projectId]);
  if (status && !['valid', 'expiring', 'expired'].includes(status)) {
    throw new ServiceError('VALIDATION_ERROR', 'status must be valid, expiring or expired', 400);
  }
  return { site_inductions: status ? rows.filter((r) => r.status === status) : rows };
}

/** GET /projects/:id/signoffs?subject_type=&subject_id= — safety.manage (SWMS sign-on). */
async function listSignoffs({ orgId, auth, projectId, subjectType, subjectId }) {
  requireManage(auth.role);
  await ProjectService.assertProjectReachable(orgId, projectId, auth);
  if (!['swms', 'site_induction', 'checklist_instance'].includes(subjectType)) {
    throw new ServiceError('VALIDATION_ERROR', 'subject_type must be swms, site_induction or checklist_instance', 400);
  }
  const [rows] = await pool.query(
    `SELECT s.id, s.user_id, COALESCE(u.full_name, s.name) AS name, s.signed_at
       FROM signoffs s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.org_id = ? AND s.project_id = ? AND s.subject_type = ? AND s.is_deleted = 0
        ${subjectId ? 'AND s.subject_id = ?' : ''}
      ORDER BY s.signed_at`, [orgId, projectId, subjectType, ...(subjectId ? [subjectId] : [])]);
  return { signoffs: rows };
}

module.exports = {
  isSafetyOps, guardPush, afterPush, deriveInduction,
  listEvents, getEvent, patchEvent, closeEvent, setNotifiable, patchIncidentDetails,
  addAction, patchAction, summary, listInductions, listSignoffs,
};
