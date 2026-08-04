import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../../config/app_theme.dart';
import '../../services/dispute_service.dart';
import '../../widgets/photo_capture.dart';

/// "Raise a dispute" (appdesignspecification.md §2.7): the disputing party
/// flags a specific record and attaches counter-evidence — an in-app action,
/// not a verbal complaint. Presented as a bottom sheet so it can be reached
/// from wherever a verification decision actually lives today (e.g. an
/// inspection item) rather than only from the not-yet-built Verified Work
/// History screen the spec's nav places it under.
Future<bool?> showRaiseDisputeSheet(
  BuildContext context, {
  String? projectId,
  required String subjectType,
  required String subjectId,
  String? subjectLabel,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Op.surface,
    shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
    builder: (_) => _RaiseDisputeSheet(
      projectId: projectId,
      subjectType: subjectType,
      subjectId: subjectId,
      subjectLabel: subjectLabel,
    ),
  );
}

class _RaiseDisputeSheet extends StatefulWidget {
  final String? projectId;
  final String subjectType;
  final String subjectId;
  final String? subjectLabel;
  const _RaiseDisputeSheet({
    required this.projectId,
    required this.subjectType,
    required this.subjectId,
    required this.subjectLabel,
  });

  @override
  State<_RaiseDisputeSheet> createState() => _RaiseDisputeSheetState();
}

class _RaiseDisputeSheetState extends State<_RaiseDisputeSheet> {
  final _reason = TextEditingController();
  String? _photoRef; // queue client_ref for the counter-evidence photo
  bool _busy = false;
  // Mint the dispute id up front so counter-evidence queues against it before
  // the row is written (order-free link, xprojman-21 §P1).
  final String _disputeId = const Uuid().v4();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    await DisputeService.instance.raise(
      id: _disputeId,
      projectId: widget.projectId,
      subjectType: widget.subjectType,
      subjectId: widget.subjectId,
      subjectLabel: widget.subjectLabel,
      reason: _reason.text.trim(),
      counterEvidencePhotoIds: _photoRef == null ? null : [_photoRef!],
    );
    if (mounted) Navigator.pop(context, true);
  }

  Future<void> _attachEvidence() async {
    // Disputes are local-only today (no server table); the document still
    // uploads order-free against the dispute id as a `general` kind and links
    // automatically when the disputes server surface eventually ships.
    final ref = await captureAndEnqueue(context,
        entityType: 'dispute',
        entityId: _disputeId,
        projectId: widget.projectId,
        kind: 'general');
    if (ref != null && mounted) setState(() => _photoRef = ref);
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
            const Text('Raise a dispute',
                style: TextStyle(
                    color: Op.text, fontSize: 17, fontWeight: FontWeight.w800)),
            if (widget.subjectLabel != null) ...[
              const SizedBox(height: 4),
              Text(widget.subjectLabel!,
                  style: const TextStyle(color: Op.muted, fontSize: 13)),
            ],
            const SizedBox(height: 8),
            const Text(
                'This escalates to Site Supervisor first — never Builder. '
                'The original record is never erased; both the call and the '
                'resolution stay on file.',
                style: TextStyle(color: Op.muted, fontSize: 12)),
            const SizedBox(height: 16),
            TextField(
              controller: _reason,
              autofocus: true,
              maxLines: 4,
              style: const TextStyle(color: Op.text),
              decoration: InputDecoration(
                labelText: 'Why are you contesting this?',
                labelStyle: const TextStyle(color: Op.muted),
                filled: true,
                fillColor: Op.bg,
                border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: Op.border)),
                enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: Op.border)),
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _attachEvidence,
              icon: Icon(_photoRef == null
                  ? Icons.add_a_photo_outlined
                  : Icons.check_circle_outline),
              label: Text(_photoRef == null
                  ? 'Attach counter-evidence photo'
                  : 'Photo attached'),
              style: OutlinedButton.styleFrom(
                foregroundColor: _photoRef == null ? Op.muted : Op.success,
                side: BorderSide(
                    color: _photoRef == null ? Op.border : Op.success),
                minimumSize: const Size.fromHeight(44),
              ),
            ),
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                style: FilledButton.styleFrom(backgroundColor: Op.warning),
                onPressed: _reason.text.trim().isEmpty || _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Text('Submit dispute'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
