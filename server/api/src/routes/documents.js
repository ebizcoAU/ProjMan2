// Mounted at /documents — the Documents/Upload module (contract: xprojman-21). Transport only;
// the rules live in services/DocumentService.js.
//
//   POST   /documents                              multipart upload           (authenticated)
//   GET    /documents?entity_type=&entity_id=      list for an entity         (projects.read | own)
//   GET    /documents/:id                          stream the bytes           (projects.read | own)
//   DELETE /documents/:id                          soft delete                (quality.write | documents.write)
//
// REST-mediated, NOT a sync-registry table — it carries bytes, which the JSON sync delta cannot.
// Metadata reaches the app through the list endpoint, never through /sync/pull.
//
// Bytes are buffered in memory (multer memoryStorage) and handed to the storage driver, because
// the server must hash and sniff the whole payload anyway (xprojman-21 P3). MAX_UPLOAD_BYTES caps
// it — a site photo is a few MB; the limit exists so a bad client cannot exhaust memory.

const router = require('express').Router();
const multer = require('multer');

const { authenticate, requirePermission } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const DocumentService = require('../services/DocumentService');
const storage = require('../lib/storage');

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024);   // 25 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

router.use(authenticate);

const actorOf = (req) => ({ role: req.auth.role, userId: req.auth.userId, isOrgOwner: req.auth.isOrgOwner });

// POST /documents — authenticated only, by contract: EVERY capture surface must be able to
// upload, including the Builder, who holds no projects.read (see DocumentService's read-gate note).
router.post('/', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        success: false,
        message: tooBig ? `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1048576)}MB limit` : 'Malformed upload',
        code: tooBig ? 'FILE_TOO_LARGE' : 'BAD_UPLOAD',
      });
    }
    try {
      const b = req.body || {};
      const result = await DocumentService.upload({
        orgId: req.auth.orgId, actor: actorOf(req),
        clientRef: b.client_ref, kind: b.kind,
        entityType: b.entity_type, entityId: b.entity_id, projectId: b.project_id,
        originalFilename: b.original_filename || req.file?.originalname,
        buffer: req.file?.buffer,
      });
      // A duplicate is a successful idempotent retry, not a new resource — 200, not 201.
      if (!result.duplicate) {
        await audit(req, 'document.upload', {
          entity: 'documents', entityId: result.document_id,
          detail: { kind: result.kind, entity_type: b.entity_type, size_bytes: result.size_bytes },
        });
      }
      return res.status(result.duplicate ? 200 : 201).json({ success: true, data: result });
    } catch (e) { return sendError(res, e); }
  });
});

router.get('/', async (req, res) => {
  try {
    const data = await DocumentService.listByEntity({
      orgId: req.auth.orgId, actor: actorOf(req),
      entityType: req.query.entity_type, entityId: req.query.entity_id,
    });
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err); }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await DocumentService.getForStream({
      orgId: req.auth.orgId, actor: actorOf(req), id: req.params.id });
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(doc.size_bytes));
    // inline: the app renders photos directly; a filename is still offered for browser saves.
    res.setHeader('Content-Disposition',
      `inline${doc.original_filename ? `; filename="${doc.original_filename.replace(/"/g, '')}"` : ''}`);
    res.setHeader('ETag', `"${doc.sha256}"`);
    return storage.getStream(doc.storage_key).pipe(res);
  } catch (err) { return sendError(res, err); }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await DocumentService.softDelete({
      orgId: req.auth.orgId, actor: actorOf(req), id: req.params.id });
    await audit(req, 'document.delete', {
      entity: 'documents', entityId: req.params.id, detail: { status: result.status },
    });
    return res.json({ success: true, data: result });
  } catch (err) { return sendError(res, err); }
});

module.exports = router;
