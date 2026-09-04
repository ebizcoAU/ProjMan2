// DocumentService — the Documents/Upload module (contract: xprojman-21, migration v024).
//
// One polymorphic store behind all five capture surfaces (inspection photo, defect photo,
// certificate, site-diary photo, delivery docket) plus office/web uploads. This is the module the
// app team's offline image queue (xprojman-22) is held on.
//
// ── THE TWO IDS (xprojman-21 P1, the part that is easy to get wrong) ─────────────────────────
//   `entity_id`  = the OWNING ROW'S OWN app-minted UUID. Names WHAT the photo is of. Because every
//                  domain row is app-PK'd, the app has this id at capture time, offline, before
//                  anything syncs — so the document self-describes its owner and neither side
//                  waits for the other. No post-upload patch of the owning row, ever.
//   `client_ref` = the app-minted UPLOAD idempotency key. De-dups the UPLOAD. A retried offline
//                  upload returns the ORIGINAL document_id rather than making a second row.
// Different ids, different jobs. Conflating them reintroduces the ordering dependency.
//
// ── P3: the server derives sha256 / size_bytes / mime_type from the bytes ────────────────────
// Anything the client sends for these three is ADVISORY — the server's own derivation wins. It is
// computing the hash for integrity anyway, so there is one authority and nothing to get wrong
// on-device.

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const storage = require('../lib/storage');
const { projectScope } = require('../lib/scope');

// The canonical sets from xprojman-21 §P2. `task` added v030 (xprojman-29) — task-level
// drawings/reports reuse this exact mechanism rather than a new store.
const ENTITY_TYPES = ['inspection_item', 'defect', 'certificate', 'site_diary', 'delivery', 'task'];
const KINDS = ['inspection_photo', 'defect_photo', 'certificate', 'site_diary_photo',
               'delivery_docket', 'task_document', 'general'];
// Convenience only: when the client names an entity_type but no kind, this is the kind it meant.
// The pairing is NOT enforced beyond this — a surface may legitimately attach a `general` file.
const DEFAULT_KIND = {
  inspection_item: 'inspection_photo',
  defect: 'defect_photo',
  certificate: 'certificate',
  site_diary: 'site_diary_photo',
  delivery: 'delivery_docket',
  task: 'task_document',
};

// The document read capability: `projects.read` (every role with a project-detail surface) OR the
// narrow `documents.read` (v025, decision #19 — the Builder, who holds no projects.read but must
// see documents on the jobs they are engaged on). Either way the rows are then narrowed by the
// caller's project reach, so "engaged" means "project_members row" with no extra work here.
const canReadDocs = (actor) => {
  const principal = { role: actor.role, isOrgOwner: actor.isOrgOwner };
  return access.grants(principal, 'projects.read') || access.grants(principal, 'documents.read');
};
const canCurate = (actor) =>
  access.grants({ role: actor.role, isOrgOwner: actor.isOrgOwner }, 'quality.write') ||
  access.grants({ role: actor.role, isOrgOwner: actor.isOrgOwner }, 'documents.write');

// ── mime sniffing (P3) ───────────────────────────────────────────────────────────────────────
// Magic numbers first — the bytes are the authority. Extension is only a fallback for formats
// without a distinctive header, and octet-stream is the honest answer when neither knows.
const EXT_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.heic': 'image/heic', '.pdf': 'application/pdf',
  '.txt': 'text/plain', '.csv': 'text/csv',
};

function sniffMime(buf, filename) {
  if (buf && buf.length >= 12) {
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buf.slice(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
    if (buf.slice(0, 3).toString('ascii') === 'GIF') return 'image/gif';
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    // ISO-BMFF container: HEIC and friends declare their brand at bytes 8–12.
    if (buf.slice(4, 8).toString('ascii') === 'ftyp') {
      const brand = buf.slice(8, 12).toString('ascii');
      if (brand.startsWith('hei') || brand.startsWith('mif')) return 'image/heic';
    }
  }
  const ext = path.extname(filename || '').toLowerCase();
  return EXT_MIME[ext] || 'application/octet-stream';
}

/**
 * POST /documents — store bytes + metadata. Authenticated; no further permission by contract
 * (every capture surface must be able to upload, including the Builder, who holds no
 * `projects.read` — see the read-gate note on listByEntity).
 *
 * IDEMPOTENT on (org_id, client_ref): a retried offline upload returns the original document_id
 * with `duplicate: true` and does NOT write a second copy of the bytes.
 */
async function upload({ orgId, actor, clientRef, kind, entityType, entityId, projectId,
                        originalFilename, buffer }) {
  if (!clientRef || !String(clientRef).trim()) {
    throw new ServiceError('VALIDATION_ERROR', 'client_ref is required (the app-minted upload idempotency key)', 400);
  }
  if (!buffer || !buffer.length) {
    throw new ServiceError('VALIDATION_ERROR', 'a file is required', 400);
  }
  if (entityType && !ENTITY_TYPES.includes(entityType)) {
    throw new ServiceError('VALIDATION_ERROR', `entity_type must be one of ${ENTITY_TYPES.join(', ')}`, 400);
  }
  if (entityType && !entityId) {
    throw new ServiceError('VALIDATION_ERROR', 'entity_id is required when entity_type is given', 400);
  }
  const resolvedKind = kind || (entityType ? DEFAULT_KIND[entityType] : 'general');
  if (!KINDS.includes(resolvedKind)) {
    throw new ServiceError('VALIDATION_ERROR', `kind must be one of ${KINDS.join(', ')}`, 400);
  }

  // The idempotency check comes BEFORE writing bytes, so a retry costs no storage.
  const [[existing]] = await pool.query(
    'SELECT id, kind, mime_type, size_bytes, sha256, created_at FROM documents WHERE org_id = ? AND client_ref = ? LIMIT 1',
    [orgId, clientRef]
  );
  if (existing) {
    return {
      document_id: existing.id, client_ref: clientRef, status: 'duplicate', duplicate: true,
      kind: existing.kind, mime_type: existing.mime_type,
      size_bytes: Number(existing.size_bytes), sha256: existing.sha256,
    };
  }

  if (projectId) {
    const [[proj]] = await pool.query(
      'SELECT id FROM projects WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1', [projectId, orgId]);
    if (!proj) throw new ServiceError('VALIDATION_ERROR', 'project_id not found in your organisation', 422);
  }

  // P3 — server derives all three from the bytes.
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const sizeBytes = buffer.length;
  const mimeType = sniffMime(buffer, originalFilename);

  const ext = path.extname(originalFilename || '').toLowerCase().slice(0, 10);
  const storageKey = storage.put(buffer, { orgId, ext });

  const id = uuidv4();
  try {
    await pool.query(
      `INSERT INTO documents
         (id, org_id, project_id, client_ref, entity_type, entity_id, kind, original_filename,
          mime_type, size_bytes, sha256, storage_key, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, orgId, projectId || null, clientRef, entityType || null, entityId || null, resolvedKind,
       originalFilename || null, mimeType, sizeBytes, sha256, storageKey, actor.userId]
    );
  } catch (err) {
    // Two devices retrying the same capture can race past the SELECT above. The unique key is the
    // real guarantee; on collision, drop the just-written bytes and answer with the winner.
    if (err && err.code === 'ER_DUP_ENTRY') {
      storage.remove(storageKey);
      const [[winner]] = await pool.query(
        'SELECT id, kind, mime_type, size_bytes, sha256 FROM documents WHERE org_id = ? AND client_ref = ? LIMIT 1',
        [orgId, clientRef]);
      return {
        document_id: winner.id, client_ref: clientRef, status: 'duplicate', duplicate: true,
        kind: winner.kind, mime_type: winner.mime_type,
        size_bytes: Number(winner.size_bytes), sha256: winner.sha256,
      };
    }
    storage.remove(storageKey);
    throw err;
  }

  return {
    document_id: id, client_ref: clientRef, status: 'stored', duplicate: false,
    kind: resolvedKind, mime_type: mimeType, size_bytes: sizeBytes, sha256,
  };
}

/**
 * The read gate, in one place so list and stream cannot drift apart.
 *
 * `projects.read` OR `documents.read` OR "you uploaded it".
 *
 * The `builder` role holds no `projects.read` at all, so the contract's bare projects.read gate
 * would have let a Builder upload a delivery docket and then be unable to read it back, breaking
 * one of the five surfaces. v024 shipped with the own-upload escape; **v025 adds `documents.read`
 * (decision #19, owner-ruled)** so a Builder also sees documents uploaded by OTHERS on the jobs
 * they are engaged on.
 *
 * On top of the permission, a document attached to a project is narrowed by the caller's project
 * reach (the same `projectScope` fragment the sync pull uses), so an assigned-scope role cannot
 * read documents from a job they are not on. That narrowing is what makes "engaged projects only"
 * true for the Builder without any engagement-specific code here: accepting a job award writes the
 * `project_members` row, and `projectScope` reaches exactly those.
 */
function assertCanRead(doc, actor) {
  if (doc.uploaded_by && doc.uploaded_by === actor.userId) return;
  if (!canReadDocs(actor)) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: projects.read or documents.read', 403);
  }
}

/** GET /documents?entity_type=&entity_id=  — the list-by-entity read (P2), newest first. */
async function listByEntity({ orgId, actor, entityType, entityId }) {
  if (!entityType || !entityId) {
    throw new ServiceError('VALIDATION_ERROR', 'entity_type and entity_id are both required', 400);
  }
  if (!ENTITY_TYPES.includes(entityType)) {
    throw new ServiceError('VALIDATION_ERROR', `entity_type must be one of ${ENTITY_TYPES.join(', ')}`, 400);
  }

  // Project narrowing: rows with a project_id must be in reach; rows without one (org-level
  // uploads) are not project-scoped and fall through on the org check alone.
  const scope = projectScope({ role: actor.role, userId: actor.userId },
    { projectColumn: 'project_id', alias: 'd' });
  // scope.sql arrives as " AND d.project_id IN (…)". Three ways a row survives the narrowing:
  //   • it is unattached (project_id IS NULL) — not project-scoped at all;
  //   • the caller reaches its project (the scope fragment);
  //   • THE CALLER UPLOADED IT — which must be in the SQL, not a later JS filter. An uploader is
  //     not necessarily a member of the project they uploaded against (a Builder capturing a
  //     delivery docket is the live case), so narrowing first would drop their own document
  //     before the permission rule ever saw it.
  // Empty for a portfolio role, which reaches everything.
  const narrow = scope.sql
    ? ` AND (d.project_id IS NULL OR d.uploaded_by = ? OR ${scope.sql.replace(/^\s*AND\s+/, '')})`
    : '';
  const narrowParams = scope.sql ? [actor.userId, ...scope.params] : [];

  const [rows] = await pool.query(
    `SELECT d.id AS document_id, d.kind, d.entity_type, d.entity_id, d.mime_type, d.size_bytes,
            d.sha256, d.original_filename, d.client_ref, d.created_at, d.uploaded_by,
            u.full_name AS uploaded_by_name
       FROM documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.org_id = ? AND d.entity_type = ? AND d.entity_id = ? AND d.is_deleted = 0${narrow}
      ORDER BY d.created_at DESC, d.id DESC`,
    [orgId, entityType, entityId, ...narrowParams]
  );

  // Permission filter in code rather than SQL: "or you uploaded it" is a per-row question, and
  // expressing it in the WHERE would make the projects.read branch unreadable.
  const reader = canReadDocs(actor);
  const visible = rows.filter((r) => reader || r.uploaded_by === actor.userId);
  return { documents: visible.map((r) => ({ ...r, size_bytes: Number(r.size_bytes) })) };
}

/** GET /documents/:id — the row + storage key for streaming. */
async function getForStream({ orgId, actor, id }) {
  const [[doc]] = await pool.query(
    'SELECT * FROM documents WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1', [id, orgId]);
  if (!doc) throw new ServiceError('NOT_FOUND', 'Document not found', 404);
  assertCanRead(doc, actor);

  if (doc.project_id) {
    // 404 rather than 403 for an out-of-reach project — revealing "exists but denied" would leak
    // the org's project contents one probe at a time, the same rule getProject follows.
    const scope = projectScope({ role: actor.role, userId: actor.userId }, { projectColumn: 'id' });
    const [[reachable]] = await pool.query(
      `SELECT id FROM projects WHERE id = ? AND org_id = ? AND is_deleted = 0${scope.sql} LIMIT 1`,
      [doc.project_id, orgId, ...scope.params]);
    if (!reachable && doc.uploaded_by !== actor.userId) {
      throw new ServiceError('NOT_FOUND', 'Document not found', 404);
    }
  }
  if (!storage.exists(doc.storage_key)) {
    throw new ServiceError('NOT_FOUND', 'Document bytes are missing from storage', 404);
  }
  return doc;
}

/**
 * DELETE /documents/:id — soft delete (`quality.write` OR `documents.write`, per the directive).
 *
 * Soft, not hard: the row is the evidentiary record that a document existed and was removed, and
 * `is_deleted` is what the list read already filters on. The BYTES are deliberately left in
 * storage — a soft delete that destroys the file is not reversible, and reversibility is the
 * entire point of soft deletion. Purging bytes is a separate retention job.
 */
async function softDelete({ orgId, actor, id }) {
  if (!canCurate(actor)) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: quality.write or documents.write', 403);
  }
  const [[doc]] = await pool.query(
    'SELECT id, is_deleted FROM documents WHERE id = ? AND org_id = ? LIMIT 1', [id, orgId]);
  if (!doc) throw new ServiceError('NOT_FOUND', 'Document not found', 404);
  if (doc.is_deleted) return { id, status: 'already_deleted' };

  await pool.query('UPDATE documents SET is_deleted = 1 WHERE id = ? AND org_id = ?', [id, orgId]);
  return { id, status: 'deleted' };
}

module.exports = {
  upload, listByEntity, getForStream, softDelete,
  sniffMime, ENTITY_TYPES, KINDS, DEFAULT_KIND,
};
