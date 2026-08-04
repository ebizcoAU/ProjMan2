import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../../config/app_theme.dart';
import '../../models/domain.dart';
import '../../services/permissions_service.dart';
import '../../services/quality_ops_service.dart';
import '../../widgets/photo_capture.dart';

/// Certificates (appspec §5.5) — the statutory-document register + expiry
/// tracking (§12.6): BA2/BA3/OC, termite, waterproofing warranties, etc.
/// `owner: ['app','web']` (§12.7/§6.1) — the office often uploads the
/// surveyor's signed form, but an inspector may attach one on-site; either
/// way it rides `/sync/push` the same as every other quality write. Presence
/// at a hold point is advisory in v1, not a gate (owner decision #3).
class QualityCertificatesView extends StatefulWidget {
  final Project project;
  const QualityCertificatesView({super.key, required this.project});

  @override
  State<QualityCertificatesView> createState() =>
      _QualityCertificatesViewState();
}

class _QualityCertificatesViewState extends State<QualityCertificatesView> {
  QualityOpsService get _svc => QualityOpsService.instance;
  String get _pid => widget.project.id;

  bool _canWrite = false;

  @override
  void initState() {
    super.initState();
    _hydrate();
  }

  @override
  void didUpdateWidget(covariant QualityCertificatesView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.project.id != widget.project.id) _hydrate();
  }

  Future<void> _hydrate() async {
    await PermissionsService.instance.ensureLoaded();
    await _svc.hydrateProject(_pid);
    if (!mounted) return;
    setState(() => _canWrite = PermissionsService.instance.has('quality.write'));
  }

  @override
  Widget build(BuildContext context) {
    final list = _svc.certificates(_pid);
    return Scaffold(
      backgroundColor: Op.bg,
      body: list.isEmpty ? _empty() : _list(list),
      floatingActionButton: _canWrite
          ? FloatingActionButton.extended(
              backgroundColor: Op.accent,
              onPressed: _add,
              icon: const Icon(Icons.add),
              label: const Text('Add certificate'),
            )
          : null,
    );
  }

  Widget _list(List<CertificateEntry> list) => ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
        itemCount: list.length,
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (_, i) => _card(list[i]),
      );

  Widget _card(CertificateEntry c) {
    final lapsing = c.lapsingSoon;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Op.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: lapsing ? Op.warning : Op.border),
      ),
      child: Row(children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
              color: (lapsing ? Op.warning : Op.border).withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(8)),
          child: Icon(Icons.verified_outlined,
              color: lapsing ? Op.warning : Op.muted),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(c.type,
                  style: const TextStyle(
                      color: Op.text, fontSize: 15, fontWeight: FontWeight.w700)),
              const SizedBox(height: 2),
              Text(
                  [
                    if (c.reference?.isNotEmpty == true) c.reference!,
                    if (c.issuedBy?.isNotEmpty == true) c.issuedBy!,
                    if (c.expiresAt != null) 'expires ${_fmtDate(c.expiresAt!)}',
                  ].join(' · '),
                  style: const TextStyle(color: Op.muted, fontSize: 12.5)),
            ],
          ),
        ),
        if (lapsing) _badge('LAPSING SOON', Op.warning),
      ]),
    );
  }

  Widget _badge(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
        decoration: BoxDecoration(
            color: color.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(6)),
        child: Text(text,
            style: TextStyle(
                color: color, fontSize: 10, fontWeight: FontWeight.w800)),
      );

  Widget _empty() => ListView(children: [
        const SizedBox(height: 96),
        const Icon(Icons.verified_outlined, size: 52, color: Op.muted),
        const SizedBox(height: 10),
        const Center(
            child: Text('No certificates yet',
                style: TextStyle(
                    color: Op.text, fontSize: 15, fontWeight: FontWeight.w700))),
        const SizedBox(height: 4),
        Center(
            child: Text(
                _canWrite
                    ? 'Record a BA2/BA3/OC or a warranty document.'
                    : 'Nothing recorded yet.',
                style: const TextStyle(color: Op.muted, fontSize: 13))),
      ]);

  static String _fmtDate(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';

  Future<void> _add() async {
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Op.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (_) => _CertificateSheet(projectId: _pid),
    );
    if (result == true && mounted) setState(() {});
  }
}

const _certTypes = ['BA2', 'BA3', 'OC', 'Termite', 'Waterproofing', 'Other'];

class _CertificateSheet extends StatefulWidget {
  final String projectId;
  const _CertificateSheet({required this.projectId});

  @override
  State<_CertificateSheet> createState() => _CertificateSheetState();
}

class _CertificateSheetState extends State<_CertificateSheet> {
  String _type = _certTypes.first;
  final _reference = TextEditingController();
  final _issuedBy = TextEditingController();
  final _notes = TextEditingController();
  DateTime? _issuedAt;
  DateTime? _expiresAt;
  String? _documentRef; // queue client_ref for the attached signed document
  bool _busy = false;
  // Mint the certificate id up front so the document queues against it before
  // the row is saved (order-free link, xprojman-21 §P1).
  final String _certId = const Uuid().v4();

  @override
  void dispose() {
    _reference.dispose();
    _issuedBy.dispose();
    _notes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
          20, 18, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Add certificate',
                style: TextStyle(
                    color: Op.text, fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: _type,
              decoration: _decoration('Type'),
              dropdownColor: Op.surface,
              style: const TextStyle(color: Op.text),
              items: [
                for (final t in _certTypes)
                  DropdownMenuItem(value: t, child: Text(t)),
              ],
              onChanged: (v) => setState(() => _type = v!),
            ),
            const SizedBox(height: 12),
            _field(_reference, 'Reference (optional) — e.g. BA2-0031'),
            const SizedBox(height: 12),
            _field(_issuedBy, 'Issued by (optional) — surveyor/authority'),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: _dateField('Issued', _issuedAt,
                  (d) => setState(() => _issuedAt = d))),
              const SizedBox(width: 12),
              Expanded(child: _dateField('Expires', _expiresAt,
                  (d) => setState(() => _expiresAt = d))),
            ]),
            const SizedBox(height: 12),
            _field(_notes, 'Notes (optional)'),
            const SizedBox(height: 12),
            _documentRow(),
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                style: FilledButton.styleFrom(backgroundColor: Op.accent),
                onPressed: _busy ? null : _save,
                child: _busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Text('Save certificate'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _dateField(String label, DateTime? value, ValueChanged<DateTime> onPick) =>
      InkWell(
        onTap: () async {
          final picked = await showDatePicker(
            context: context,
            initialDate: value ?? DateTime.now(),
            firstDate: DateTime.now().subtract(const Duration(days: 365 * 5)),
            lastDate: DateTime.now().add(const Duration(days: 365 * 10)),
          );
          if (picked != null) onPick(picked);
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          decoration: BoxDecoration(
            color: Op.bg,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: Op.border),
          ),
          child: Row(children: [
            const Icon(Icons.event_outlined, size: 16, color: Op.muted),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                  value == null
                      ? label
                      : '${value.day}/${value.month}/${value.year}',
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      color: value == null ? Op.muted : Op.text, fontSize: 13)),
            ),
          ]),
        ),
      );

  // Document capture rides the one offline image queue (xprojman-22): capture →
  // enqueue against this certificate's id → cache the client_ref; upload
  // flushes when there's signal.
  Future<void> _attachDocument() async {
    final ref = await captureAndEnqueue(context,
        entityType: 'certificate',
        entityId: _certId,
        projectId: widget.projectId);
    if (ref != null && mounted) setState(() => _documentRef = ref);
  }

  Widget _documentRow() => InkWell(
        onTap: _attachDocument,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          decoration: BoxDecoration(
            color: Op.bg,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: Op.accent),
          ),
          child: Row(children: [
            Icon(
                _documentRef == null
                    ? Icons.attach_file
                    : Icons.check_circle,
                color: Op.accent, size: 18),
            const SizedBox(width: 8),
            Text(
                _documentRef == null
                    ? 'Attach the signed document'
                    : 'Document attached',
                style: const TextStyle(color: Op.accent, fontSize: 13)),
          ]),
        ),
      );

  Future<void> _save() async {
    setState(() => _busy = true);
    final e = CertificateEntry(
      id: _certId,
      projectId: widget.projectId,
      type: _type,
      reference: _nullIfEmpty(_reference.text),
      issuedBy: _nullIfEmpty(_issuedBy.text),
      issuedAt: _issuedAt,
      expiresAt: _expiresAt,
      documentIds: _documentRef == null ? null : [_documentRef!],
      notes: _notes.text.trim(),
    );
    await QualityOpsService.instance.recordCertificate(widget.projectId, e);
    if (mounted) Navigator.pop(context, true);
  }

  static String? _nullIfEmpty(String s) => s.trim().isEmpty ? null : s.trim();

  InputDecoration _decoration(String label) => InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Op.muted),
        filled: true,
        fillColor: Op.bg,
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: Op.border)),
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: Op.border)),
      );

  Widget _field(TextEditingController c, String label) => TextField(
        controller: c,
        style: const TextStyle(color: Op.text),
        decoration: _decoration(label),
      );
}
