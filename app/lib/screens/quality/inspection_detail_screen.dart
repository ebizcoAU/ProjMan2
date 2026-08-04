import 'package:flutter/material.dart';
import '../../config/app_theme.dart';
import '../../models/domain.dart';
import '../../services/permissions_service.dart';
import '../../services/quality_ops_service.dart';
import '../../widgets/photo_capture.dart';
import 'raise_dispute_screen.dart';

/// A single inspection's checklist (appspec §5.5, servdesignspec §12.4). Items
/// are filled offline via `/sync/push` (§12.4 "bulk detail via sync"); the one
/// server-mediated act is **Complete** — REST-only, and a hold-point PASS
/// additionally needs `quality.validate` (inspector-only, §12.4/§10.10.4 — a PM
/// cannot self-validate). Fail never gates, so it only needs `quality.write`.
class InspectionDetailScreen extends StatefulWidget {
  final Project project;
  final String inspectionId;
  final String? stageLabel;
  const InspectionDetailScreen({
    super.key,
    required this.project,
    required this.inspectionId,
    this.stageLabel,
  });

  @override
  State<InspectionDetailScreen> createState() => _InspectionDetailScreenState();
}

class _InspectionDetailScreenState extends State<InspectionDetailScreen> {
  QualityOpsService get _svc => QualityOpsService.instance;
  String get _pid => widget.project.id;

  final _itemCtrl = TextEditingController();
  bool _canWrite = false;
  bool _canValidate = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _canWrite = PermissionsService.instance.has('quality.write');
    _canValidate = PermissionsService.instance.has('quality.validate');
  }

  @override
  void dispose() {
    _itemCtrl.dispose();
    super.dispose();
  }

  InspectionEntry? get _inspection {
    final matches =
        _svc.inspections(_pid).where((i) => i.id == widget.inspectionId);
    return matches.isEmpty ? null : matches.first;
  }

  @override
  Widget build(BuildContext context) {
    final inspection = _inspection;
    if (inspection == null) {
      return Scaffold(
        backgroundColor: Op.bg,
        appBar: AppBar(backgroundColor: Op.surface, foregroundColor: Op.text),
        body: const Center(
            child: Text('Inspection not found', style: TextStyle(color: Op.muted))),
      );
    }
    return Scaffold(
      backgroundColor: Op.bg,
      appBar: AppBar(
        backgroundColor: Op.surface,
        foregroundColor: Op.text,
        elevation: 0,
        title: Text(inspection.type,
            style: const TextStyle(fontWeight: FontWeight.w800)),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(20),
          child: Padding(
            padding: const EdgeInsets.only(left: 16, bottom: 10),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                  widget.stageLabel ?? 'QA — no stage',
                  style: const TextStyle(color: Op.muted, fontSize: 13)),
            ),
          ),
        ),
      ),
      body: Column(
        children: [
          if (inspection.isComplete) _resultBanner(inspection),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: [
                if (inspection.isHoldPoint) _holdPointBanner(),
                const Text('Checklist',
                    style: TextStyle(
                        color: Op.text, fontSize: 14, fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                ...inspection.items.map(_itemRow),
                if (_canWrite && !inspection.isComplete) _addItemRow(),
              ],
            ),
          ),
          if (!inspection.isComplete) _completeBar(inspection),
        ],
      ),
    );
  }

  Widget _resultBanner(InspectionEntry i) {
    final pass = i.result == InspectionResult.pass;
    final color = pass ? Op.success : Op.warning;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      color: color.withValues(alpha: 0.12),
      child: Row(children: [
        Icon(pass ? Icons.check_circle : Icons.cancel, color: color, size: 18),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
              pass
                  ? (i.isHoldPoint
                      ? 'Passed — this hold point is validated.'
                      : 'Passed.')
                  : 'Failed.',
              style: TextStyle(color: color, fontWeight: FontWeight.w700)),
        ),
      ]),
    );
  }

  Widget _holdPointBanner() => Container(
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
            color: Op.warning.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(10)),
        child: const Row(children: [
          Icon(Icons.lock_clock, size: 16, color: Op.warning),
          SizedBox(width: 8),
          Expanded(
            child: Text(
                'Hold point — a pass validates this stage. Only an inspector '
                'can complete a hold-point pass.',
                style: TextStyle(color: Op.warning, fontSize: 12.5)),
          ),
        ]),
      );

  Widget _itemRow(InspectionItemEntry item) {
    final (icon, tint) = switch (item.result) {
      ItemResult.pass => (Icons.check_circle, Op.success),
      ItemResult.fail => (Icons.cancel, Op.warning),
      ItemResult.na => (Icons.remove_circle_outline, Op.muted),
      ItemResult.pending => (Icons.radio_button_unchecked, Op.muted),
    };
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Op.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Op.border),
      ),
      child: Row(children: [
        InkWell(
          onTap: _canWrite ? () => _cycleItem(item) : null,
          child: Icon(icon, color: tint, size: 22),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(item.description,
                  style: const TextStyle(color: Op.text, fontSize: 14.5)),
              if (item.note?.isNotEmpty == true)
                Text(item.note!,
                    style: const TextStyle(color: Op.muted, fontSize: 12)),
              if (item.photoIds.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Row(children: [
                    const Icon(Icons.photo_outlined, size: 12, color: Op.muted),
                    const SizedBox(width: 3),
                    Text('${item.photoIds.length} photo(s)',
                        style: const TextStyle(color: Op.muted, fontSize: 11.5)),
                  ]),
                ),
            ],
          ),
        ),
        if (_canWrite)
          IconButton(
            iconSize: 18,
            color: Op.muted,
            icon: const Icon(Icons.add_a_photo_outlined),
            onPressed: () => _addItemPhoto(item),
          ),
        if (item.result != ItemResult.pending)
          IconButton(
            iconSize: 18,
            color: Op.muted,
            tooltip: 'Raise a dispute',
            icon: const Icon(Icons.flag_outlined),
            onPressed: () => _raiseDispute(item),
          ),
      ]),
    );
  }

  Future<void> _raiseDispute(InspectionItemEntry item) async {
    await showRaiseDisputeSheet(
      context,
      projectId: _pid,
      subjectType: 'inspection_item',
      subjectId: item.id,
      subjectLabel: item.description,
    );
  }

  Future<void> _cycleItem(InspectionItemEntry item) async {
    const order = [
      ItemResult.pending, ItemResult.pass, ItemResult.fail, ItemResult.na,
    ];
    final next = order[(order.indexOf(item.result) + 1) % order.length];
    await _svc.updateInspectionItem(_pid, item, result: next);
    if (mounted) setState(() {});
  }

  Future<void> _addItemPhoto(InspectionItemEntry item) async {
    // Real offline image queue (xprojman-22): capture → enqueue → cache the
    // client_ref on the item; upload rides the queue when there's signal.
    final ref = await captureAndEnqueue(context,
        entityType: 'inspection_item', entityId: item.id, projectId: _pid);
    if (ref == null) return;
    item.photoIds.add(ref);
    await _svc.updateInspectionItem(_pid, item);
    if (mounted) setState(() {});
  }

  Widget _addItemRow() => Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Row(children: [
          Expanded(
            child: TextField(
              controller: _itemCtrl,
              style: const TextStyle(color: Op.text),
              onSubmitted: (_) => _addItem(),
              decoration: InputDecoration(
                isDense: true,
                hintText: 'e.g. Reinforcement cover correct',
                hintStyle: const TextStyle(color: Op.muted, fontSize: 14),
                filled: true,
                fillColor: Op.surface,
                border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: Op.border)),
                enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: Op.border)),
              ),
            ),
          ),
          IconButton(
            onPressed: _addItem,
            icon: const Icon(Icons.add_circle, color: Op.accent),
          ),
        ]),
      );

  Future<void> _addItem() async {
    final desc = _itemCtrl.text.trim();
    if (desc.isEmpty) return;
    final seq = _inspection?.items.length ?? 0;
    await _svc.addInspectionItem(_pid, widget.inspectionId,
        seq: seq, description: desc);
    _itemCtrl.clear();
    if (mounted) setState(() {});
  }

  Widget _completeBar(InspectionEntry i) {
    final passBlocked = i.isHoldPoint && !_canValidate;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 20),
      decoration: const BoxDecoration(
        color: Op.surface,
        border: Border(top: BorderSide(color: Op.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (passBlocked)
            const Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: Text(
                  'Only an inspector holds quality.validate — you can record a '
                  'fail, but not pass this hold point.',
                  style: TextStyle(color: Op.muted, fontSize: 11.5)),
            ),
          Row(children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _canWrite && !_busy
                    ? () => _complete(InspectionResult.fail)
                    : null,
                style: OutlinedButton.styleFrom(
                    foregroundColor: Op.warning,
                    side: const BorderSide(color: Op.warning)),
                child: const Text('Fail'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: FilledButton(
                onPressed: _canWrite && !passBlocked && !_busy
                    ? () => _complete(InspectionResult.pass)
                    : null,
                style: FilledButton.styleFrom(backgroundColor: Op.success),
                child: _busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Text('Pass'),
              ),
            ),
          ]),
        ],
      ),
    );
  }

  Future<void> _complete(InspectionResult result) async {
    setState(() => _busy = true);
    final res = await _svc.completeInspection(_pid, widget.inspectionId,
        result: result);
    if (!mounted) return;
    setState(() => _busy = false);
    if (!res.success) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(res.message ?? 'Could not complete the inspection.')));
      return;
    }
    setState(() {});
  }
}
