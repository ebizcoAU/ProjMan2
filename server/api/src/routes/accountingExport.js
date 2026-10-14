// /api/v1/accounting-export — the construction money records as an import file for the builder's
// accounting package (xprojman-43 R4, §13.4). AccountingExportService holds the rules.
//   GET /accounting-export?kind=&format=generic|xero&from=&to=&project_id=&only_new=1
//        the CSV (accounts.read); marks the rows exported and records the run.
//        Headers: X-Export-Id, X-Export-Rows, X-Export-Sha256, X-Export-Warnings (comma-separated codes)
//   GET /accounting-export/preview?…      the same rows as JSON, nothing marked (accounts.read)
//   GET /accounting-export/history        the runs (accounts.read)
//   GET /accounting-export/settings       codes, gst_code_map, cost-centre codes, formats (accounts.read or money.read)
//   PUT /accounting-export/settings       (money.write)

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const AccountingExportService = require('../services/AccountingExportService');

const router = express.Router();
router.use(authenticate);

const actorOf = (req) => ({ role: req.auth.role, userId: req.auth.userId, isOrgOwner: req.auth.isOrgOwner });

router.get('/preview', async (req, res) => {
  try {
    const { data, warnings } = await AccountingExportService.preview({ orgId: req.auth.orgId, actor: actorOf(req), query: req.query });
    res.json({ success: true, data, ...(warnings.length ? { warnings } : {}) });
  } catch (err) { sendError(res, err); }
});

router.get('/history', async (req, res) => {
  try { res.json({ success: true, data: await AccountingExportService.history({ orgId: req.auth.orgId, actor: actorOf(req) }) }); }
  catch (err) { sendError(res, err); }
});

router.get('/settings', async (req, res) => {
  try { res.json({ success: true, data: await AccountingExportService.getSettings({ orgId: req.auth.orgId, actor: actorOf(req) }) }); }
  catch (err) { sendError(res, err); }
});

router.put('/settings', async (req, res) => {
  try {
    const data = await AccountingExportService.putSettings({ orgId: req.auth.orgId, actor: actorOf(req), body: req.body || {} });
    await audit(req, 'accounting_export.settings', { entity: 'accounting_export_settings', entityId: req.auth.orgId,
      detail: { fields: Object.keys(req.body || {}) } });
    res.json({ success: true, data });
  } catch (err) { sendError(res, err); }
});

router.get('/', async (req, res) => {
  try {
    const out = await AccountingExportService.exportCsv({ orgId: req.auth.orgId, actor: actorOf(req), query: req.query });
    if (out.export_id) {
      await audit(req, 'accounting_export.run', { entity: 'accounting_exports', entityId: out.export_id,
        detail: { kind: req.query.kind, format: req.query.format || 'generic', row_count: out.row_count } });
    }
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${out.filename}"`,
      'X-Export-Id': out.export_id || '',
      'X-Export-Rows': String(out.row_count),
      'X-Export-Sha256': out.sha256,
      'X-Export-Warnings': out.warnings.map((w) => w.code).join(','),
      'Access-Control-Expose-Headers': 'Content-Disposition, X-Export-Id, X-Export-Rows, X-Export-Sha256, X-Export-Warnings',
    });
    res.send(out.csv);
  } catch (err) { sendError(res, err); }
});

module.exports = router;
