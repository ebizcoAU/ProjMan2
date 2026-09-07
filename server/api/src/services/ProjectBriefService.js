// ProjectBriefService — Project Brief PDF snapshots (xprojman-41 §3, confirmed
// §8/§9, 2026-09-07). An append-only history: one PDF per "Formalize/Re-issue
// Brief" click (variation_id NULL) or per approved variation (variation_id
// set, auto-generated from ContractService.respondVariation) — never edited
// or replaced, a new row is the point (the owner's own liquidation-protection
// motivation needs a fixed reference the customer can trust wasn't quietly
// changed after the fact).
//
// PDF engine: pdfkit (confirmed §8, correcting an earlier Puppeteer proposal)
// — the same library, and the same "server-side HTML-template-shaped,
// pure-Node, no browser process" posture, as nexus/api's own
// eInvoiceSimulator/pdfGenerator.js (decision D-191).
//
// v1 has no cryptographic signature — a plain timestamped record + an
// acknowledged_by/acknowledged_at pair for once xprojman-41 §1 (customer App
// access) exists for them to tap "acknowledge" (confirmed §8). Real
// e-signature stays a separate, later, explicitly legal question.

const { v4: uuidv4 } = require('uuid');
const PDFDocument = require('pdfkit');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const storage = require('../lib/storage');

const canRead = (role) => access.hasPermission(role, 'projects.read');
const canWrite = (role) => access.hasPermission(role, 'projects.write');

/** Renders the brief to a PDF Buffer. No disk/network I/O — pure layout. */
function renderPdf({ org, project, customer, variation }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).font('Helvetica-Bold').text(org.name || 'ProjMan');
    doc.fontSize(9).font('Helvetica').fillColor('#555')
      .text([org.address, org.suburb, org.state, org.postcode].filter(Boolean).join(', '))
      .text([org.phone, org.email].filter(Boolean).join('  ·  '))
      .text(org.abn ? `ABN ${org.abn}` : '');
    doc.moveDown(1.5).fillColor('#000');

    const title = variation ? 'Project Brief — Variation Confirmation' : 'Project Brief';
    doc.fontSize(14).font('Helvetica-Bold').text(title);
    doc.fontSize(9).font('Helvetica').fillColor('#555')
      .text(`Generated ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Perth' })}`);
    doc.moveDown(1).fillColor('#000');

    const field = (label, value) => {
      if (!value) return;
      doc.fontSize(10).font('Helvetica-Bold').text(label, { continued: true })
        .font('Helvetica').text(`  ${value}`);
    };
    field('Project:', `${project.code || ''} ${project.name || ''}`.trim());
    field('Site address:', project.site_address);
    field('Customer:', customer?.name);
    field('Contract type:', project.contract_type);
    if (project.description) {
      doc.moveDown(0.5).fontSize(10).font('Helvetica-Bold').text('Description:');
      doc.font('Helvetica').text(project.description);
    }

    if (variation) {
      doc.moveDown(1).fontSize(11).font('Helvetica-Bold').text(`Variation #${variation.variation_number}`);
      doc.fontSize(10).font('Helvetica').text(variation.description);
      doc.font('Helvetica-Bold').text(`Amount: ${Number(variation.amount) >= 0 ? '+' : ''}$${Number(variation.amount).toLocaleString('en-AU')}`);
      doc.font('Helvetica').fillColor('#555')
        .text(`Approved ${new Date(variation.approved_at).toLocaleString('en-AU', { timeZone: 'Australia/Perth' })}`)
        .fillColor('#000');
    }

    doc.end();
  });
}

/**
 * The actual generation, no permission check — shared by the two very
 * different callers below, which authorize themselves differently before
 * reaching here. `actor.userId` is recorded as `generated_by` regardless of
 * who they are (a PM formalizing, or a customer whose approval triggered
 * this) — an honest "who caused this snapshot to exist," not necessarily a
 * PM every time.
 */
async function generateSnapshotUnchecked({ orgId, projectId, actor, variationId }) {
  const [[org]] = await pool.query(
    'SELECT name, address, suburb, state, postcode, phone, email, abn FROM organisations WHERE id = ? LIMIT 1',
    [orgId]
  );
  const [[project]] = await pool.query(
    'SELECT code, name, description, site_address, contract_type, customer_id FROM projects WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [projectId, orgId]
  );
  if (!project) throw new ServiceError('NOT_FOUND', 'Project not found', 404);

  const [[customer]] = project.customer_id
    ? await pool.query('SELECT name FROM customers WHERE id = ? AND org_id = ? LIMIT 1', [project.customer_id, orgId])
    : [[null]];

  let variation = null;
  if (variationId) {
    const [[v]] = await pool.query(
      'SELECT variation_number, description, amount, approved_at FROM variations WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
      [variationId, projectId, orgId]
    );
    if (!v) throw new ServiceError('VALIDATION_ERROR', 'variation_id not found on this project', 422);
    variation = v;
  }

  const buffer = await renderPdf({ org, project, customer, variation });
  const storageKey = storage.put(buffer, { orgId, ext: '.pdf' });

  const id = uuidv4();
  await pool.query(
    `INSERT INTO project_brief_snapshots (id, org_id, project_id, variation_id, storage_key, generated_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, orgId, projectId, variationId || null, storageKey, actor.userId]
  );
  return { id, variation_id: variationId || null };
}

/**
 * POST /projects/:id/brief-snapshots — the "Formalize Brief"/"Re-issue Brief
 * PDF" action (xprojman-41 §9). A PM-initiated action, gated `projects.write`
 * same as editing the project itself (Portal's own §9 framing) — always the
 * intake snapshot (`variation_id` NULL); a variation-confirmation snapshot
 * only ever comes from `generateFromVariationApproval` below.
 */
async function generateSnapshot({ orgId, projectId, actor }) {
  if (!canWrite(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: projects.write', 403);
  return generateSnapshotUnchecked({ orgId, projectId, actor, variationId: null });
}

/**
 * Called ONLY from ContractService.respondVariation, after a variation
 * actually flips to 'approved' — deliberately NOT permission-checked against
 * `actor` here (the approving party is a `client`, who holds `variations.
 * approve` but not `projects.write`; the approval itself was already the
 * authorized action, this is its recorded consequence, not a fresh request
 * to authorize). `variationId` is required, unlike the PM-facing function
 * above, so this path can never accidentally mint an untagged intake
 * snapshot.
 */
async function generateFromVariationApproval({ orgId, projectId, actor, variationId }) {
  if (!variationId) throw new ServiceError('VALIDATION_ERROR', 'variationId is required', 400);
  return generateSnapshotUnchecked({ orgId, projectId, actor, variationId });
}

/** GET /projects/:id/brief-snapshots */
async function listSnapshots({ orgId, projectId, actor }) {
  if (!canRead(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: projects.read', 403);
  const [rows] = await pool.query(
    `SELECT s.id, s.variation_id, s.generated_at, s.acknowledged_by, s.acknowledged_at,
            u.full_name AS generated_by_name, v.variation_number
       FROM project_brief_snapshots s
       LEFT JOIN users u ON u.id = s.generated_by
       LEFT JOIN variations v ON v.id = s.variation_id
      WHERE s.project_id = ? AND s.org_id = ?
      ORDER BY s.generated_at DESC`,
    [projectId, orgId]
  );
  return { snapshots: rows };
}

/** GET /projects/:id/brief-snapshots/:snapshotId — authenticated PDF bytes. */
async function getSnapshotForStream({ orgId, projectId, actor, snapshotId }) {
  if (!canRead(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: projects.read', 403);
  const [[row]] = await pool.query(
    'SELECT storage_key, generated_at FROM project_brief_snapshots WHERE id = ? AND project_id = ? AND org_id = ? LIMIT 1',
    [snapshotId, projectId, orgId]
  );
  if (!row) throw new ServiceError('NOT_FOUND', 'Snapshot not found', 404);
  return row;
}

module.exports = { generateSnapshot, generateFromVariationApproval, listSnapshots, getSnapshotForStream };
