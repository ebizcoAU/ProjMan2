// RctiService — recipient-created tax invoices (xprojman-43 R3, §13.3a; §14 O2).
//
// When this org issues the tax invoice for a counterparty's supply (an RCTI), the ATO RCTI
// determination needs a WRITTEN agreement with that counterparty. rcti_agreements holds it, per
// counterparty: a supplier (supplier_invoices) or a claimant user (progress_claims). The
// rcti_issued flag on a row can only be turned on while a current agreement exists
// (RCTI_NO_AGREEMENT); the R4 export marks those rows so the accounting system records them as
// RCTIs. Turning it off is always allowed. The ATO detail is unverified until the solicitor
// review, so a missing signed copy only warns (RCTI_AGREEMENT_NO_DOCUMENT).

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const currentSql = (a = '') => `${a}revoked_at IS NULL AND ${a}agreed_at <= CURDATE() AND (${a}ends_at IS NULL OR ${a}ends_at >= CURDATE())`;

const canRead = (role) => access.hasPermission(role, 'money.read') || access.hasPermission(role, 'po.write');
// A supplier agreement is procurement (po.write, the builder's own subs too); a claimant agreement
// sits with the org paying progress claims (money.write).
const canWriteFor = (role, { supplierId }) => (supplierId
  ? access.hasPermission(role, 'money.write') || access.hasPermission(role, 'po.write')
  : access.hasPermission(role, 'money.write'));

const SELECT = `
  SELECT a.*, s.name AS supplier_name, u.full_name AS party_name,
         (${currentSql('a.')}) AS is_current
    FROM rcti_agreements a
    LEFT JOIN suppliers s ON s.id = a.supplier_id
    LEFT JOIN users u ON u.id = a.party_user_id`;

const dateOnly = (v) => (v == null ? null : String(v).slice(0, 10));

function shape(r) {
  return {
    id: r.id, supplier_id: r.supplier_id, supplier_name: r.supplier_name || null,
    party_user_id: r.party_user_id, party_name: r.party_user_id ? (r.party_name || null) : null,
    agreed_at: dateOnly(r.agreed_at), ends_at: dateOnly(r.ends_at), document_id: r.document_id, note: r.note,
    revoked_at: r.revoked_at, is_current: !!r.is_current, created_at: r.created_at,
  };
}

async function list({ orgId, actor, supplierId, partyUserId, current }) {
  if (!canRead(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.read or po.write', 403);
  let where = 'a.org_id = ?';
  const params = [orgId];
  if (supplierId) { where += ' AND a.supplier_id = ?'; params.push(supplierId); }
  if (partyUserId) { where += ' AND a.party_user_id = ?'; params.push(partyUserId); }
  if (current) where += ` AND ${currentSql('a.')}`;
  const [rows] = await pool.query(`${SELECT} WHERE ${where} ORDER BY a.created_at DESC`, params);
  return { rcti_agreements: rows.map(shape) };
}

async function create({ orgId, actor, body }) {
  const supplierId = body.supplier_id || null;
  const partyUserId = body.party_user_id || null;
  if (!!supplierId === !!partyUserId) {
    throw new ServiceError('VALIDATION_ERROR', 'Give exactly one of supplier_id or party_user_id', 400);
  }
  if (!canWriteFor(actor.role, { supplierId })) {
    throw new ServiceError('FORBIDDEN', `Requires permission: ${supplierId ? 'money.write or po.write' : 'money.write'}`, 403);
  }
  if (!DATE.test(String(body.agreed_at || ''))) throw new ServiceError('VALIDATION_ERROR', 'agreed_at must be a date (YYYY-MM-DD)', 400);
  if (body.ends_at != null && !DATE.test(String(body.ends_at))) throw new ServiceError('VALIDATION_ERROR', 'ends_at must be a date (YYYY-MM-DD)', 400);
  if (body.ends_at && body.ends_at < body.agreed_at) throw new ServiceError('VALIDATION_ERROR', 'ends_at is before agreed_at', 400);

  if (supplierId) {
    const [[s]] = await pool.query('SELECT id FROM suppliers WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1', [supplierId, orgId]);
    if (!s) throw new ServiceError('NOT_FOUND', 'Supplier not found', 404);
  } else {
    // The claimant is someone who bills this org: a member, or anyone with a claim on its projects.
    const [[u]] = await pool.query(
      `SELECT u.id FROM users u
        WHERE u.id = ? AND (u.org_id = ? OR EXISTS (SELECT 1 FROM progress_claims pc WHERE pc.submitted_by = u.id AND pc.org_id = ?))
        LIMIT 1`, [partyUserId, orgId, orgId]);
    if (!u) throw new ServiceError('NOT_FOUND', 'That person has no claims with this organisation', 404);
  }
  if (body.document_id) {
    const [[d]] = await pool.query('SELECT id FROM documents WHERE id = ? AND org_id = ? LIMIT 1', [body.document_id, orgId]);
    if (!d) throw new ServiceError('VALIDATION_ERROR', 'document_id is not a document in this organisation', 400);
  }
  const id = uuidv4();
  await pool.query(
    `INSERT INTO rcti_agreements (id, org_id, supplier_id, party_user_id, agreed_at, ends_at, document_id, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, orgId, supplierId, partyUserId, body.agreed_at, body.ends_at || null, body.document_id || null,
     body.note ? String(body.note).slice(0, 300) : null, actor.userId]);
  const [[row]] = await pool.query(`${SELECT} WHERE a.id = ?`, [id]);
  const warnings = body.document_id ? [] : [{
    code: 'RCTI_AGREEMENT_NO_DOCUMENT',
    message: 'Attach the signed RCTI agreement. The ATO expects a written agreement with each supplier you issue RCTIs to.',
  }];
  return { data: { rcti_agreement: shape(row) }, warnings };
}

async function revoke({ orgId, actor, id }) {
  const [[row]] = await pool.query('SELECT * FROM rcti_agreements WHERE id = ? AND org_id = ? LIMIT 1', [id, orgId]);
  if (!row) throw new ServiceError('NOT_FOUND', 'RCTI agreement not found', 404);
  if (!canWriteFor(actor.role, { supplierId: row.supplier_id })) throw new ServiceError('FORBIDDEN', 'Not allowed to revoke this agreement', 403);
  if (row.revoked_at) throw new ServiceError('ALREADY_RESOLVED', 'This agreement is already revoked', 409);
  await pool.query('UPDATE rcti_agreements SET revoked_at = NOW(), revoked_by = ? WHERE id = ?', [actor.userId, id]);
  const [[fresh]] = await pool.query(`${SELECT} WHERE a.id = ?`, [id]);
  return { rcti_agreement: shape(fresh) };
}

/** The current agreement for a counterparty, or null. */
async function currentAgreement(orgId, { supplierId, partyUserId }) {
  if (!supplierId && !partyUserId) return null;
  const col = supplierId ? 'supplier_id' : 'party_user_id';
  const [[row]] = await pool.query(
    `SELECT id FROM rcti_agreements WHERE org_id = ? AND ${col} = ? AND ${currentSql()} ORDER BY agreed_at DESC LIMIT 1`,
    [orgId, supplierId || partyUserId]);
  return row ? row.id : null;
}

/** Resolves the agreement id to store when turning the flag on (null when turning it off). */
async function agreementForFlag(orgId, issued, counterparty) {
  if (!issued) return null;
  const agreementId = await currentAgreement(orgId, counterparty);
  if (!agreementId) {
    throw new ServiceError('RCTI_NO_AGREEMENT',
      'There is no current RCTI agreement with this party, so you cannot issue an RCTI for it', 409);
  }
  return agreementId;
}

module.exports = { list, create, revoke, currentAgreement, agreementForFlag };
