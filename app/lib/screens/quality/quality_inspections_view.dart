import 'package:flutter/material.dart';
import '../../config/app_theme.dart';
import '../../models/domain.dart';
import '../../services/permissions_service.dart';
import '../../services/project_service.dart';
import '../../services/quality_ops_service.dart';
import 'inspection_detail_screen.dart';

/// Inspections (appspec §5.5) — the checklist list for a job. Completing a
/// **hold-point** inspection with a pass drives the stage's `is_validated`
/// (§10.5/§12.4) — that's the one action gated further by `quality.validate`
/// (inspector-only); everything here (create, list, open) needs only
/// `quality.write`.
class QualityInspectionsView extends StatefulWidget {
  final Project project;
  const QualityInspectionsView({super.key, required this.project});

  @override
  State<QualityInspectionsView> createState() => _QualityInspectionsViewState();
}

class _QualityInspectionsViewState extends State<QualityInspectionsView> {
  QualityOpsService get _svc => QualityOpsService.instance;
  String get _pid => widget.project.id;

  List<ProjectStage> _stages = [];
  bool _canWrite = false;

  @override
  void initState() {
    super.initState();
    _hydrate();
  }

  @override
  void didUpdateWidget(covariant QualityInspectionsView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.project.id != widget.project.id) _hydrate();
  }

  Future<void> _hydrate() async {
    await PermissionsService.instance.ensureLoaded();
    final detail = await ProjectService.detail(_pid);
    await _svc.hydrateProject(_pid);
    if (!mounted) return;
    setState(() {
      _stages = detail.stages;
      _canWrite = PermissionsService.instance.has('quality.write');
    });
  }

  String? _stageLabel(String? stageId) {
    if (stageId == null) return null;
    final s = _stages.where((s) => s.id == stageId).cast<ProjectStage?>().firstOrNull;
    return s == null ? null : 'Stage ${s.seq} · ${s.name}';
  }

  @override
  Widget build(BuildContext context) {
    final list = _svc.inspections(_pid);
    return Scaffold(
      backgroundColor: Op.bg,
      body: list.isEmpty ? _empty() : _list(list),
      floatingActionButton: _canWrite
          ? FloatingActionButton.extended(
              backgroundColor: Op.accent,
              onPressed: _newInspection,
              icon: const Icon(Icons.add),
              label: const Text('New inspection'),
            )
          : null,
    );
  }

  Widget _list(List<InspectionEntry> list) => ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
        itemCount: list.length,
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (_, i) => _card(list[i]),
      );

  Widget _card(InspectionEntry i) {
    final (icon, tint, label) = _statusVisual(i);
    final stageLabel = _stageLabel(i.stageId);
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () async {
        await Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => InspectionDetailScreen(
              project: widget.project,
              inspectionId: i.id,
              stageLabel: stageLabel,
            ),
          ),
        );
        if (mounted) setState(() {});
      },
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Op.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Op.border),
        ),
        child: Row(
          children: [
            Icon(icon, color: tint, size: 24),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Text(i.type,
                        style: const TextStyle(
                            color: Op.text,
                            fontSize: 15,
                            fontWeight: FontWeight.w700)),
                    if (i.isHoldPoint) ...[
                      const SizedBox(width: 6),
                      _badge('HOLD POINT', Op.warning),
                    ],
                  ]),
                  const SizedBox(height: 2),
                  Text(
                      [
                        if (stageLabel != null) stageLabel else 'QA — no stage',
                        '${i.items.length} item${i.items.length == 1 ? '' : 's'}',
                      ].join(' · '),
                      style: const TextStyle(color: Op.muted, fontSize: 12.5)),
                ],
              ),
            ),
            Text(label,
                style: TextStyle(
                    color: tint, fontSize: 12.5, fontWeight: FontWeight.w700)),
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right, color: Op.muted),
          ],
        ),
      ),
    );
  }

  Widget _badge(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
            color: color.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(6)),
        child: Text(text,
            style: TextStyle(
                color: color, fontSize: 10, fontWeight: FontWeight.w800)),
      );

  (IconData, Color, String) _statusVisual(InspectionEntry i) => switch (i.result) {
        InspectionResult.pass => (Icons.check_circle, Op.success, 'Pass'),
        InspectionResult.fail => (Icons.cancel, Op.warning, 'Fail'),
        InspectionResult.pending => (Icons.pending_outlined, Op.muted, 'Pending'),
      };

  Widget _empty() => ListView(children: [
        const SizedBox(height: 96),
        const Icon(Icons.fact_check_outlined, size: 52, color: Op.muted),
        const SizedBox(height: 10),
        const Center(
            child: Text('No inspections yet',
                style: TextStyle(
                    color: Op.text, fontSize: 15, fontWeight: FontWeight.w700))),
        const SizedBox(height: 4),
        Center(
            child: Text(
                _canWrite
                    ? 'Start a checklist against a stage, or a stand-alone QA run.'
                    : 'Nothing scheduled yet.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Op.muted, fontSize: 13))),
      ]);

  Future<void> _newInspection() async {
    final created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Op.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (_) => _NewInspectionSheet(projectId: _pid, stages: _stages),
    );
    if (created == true && mounted) setState(() {});
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}

class _NewInspectionSheet extends StatefulWidget {
  final String projectId;
  final List<ProjectStage> stages;
  const _NewInspectionSheet({required this.projectId, required this.stages});

  @override
  State<_NewInspectionSheet> createState() => _NewInspectionSheetState();
}

class _NewInspectionSheetState extends State<_NewInspectionSheet> {
  final _type = TextEditingController();
  final _notes = TextEditingController();
  ProjectStage? _stage;
  bool _busy = false;

  @override
  void dispose() {
    _type.dispose();
    _notes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
          20, 18, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('New inspection',
              style: TextStyle(
                  color: Op.text, fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 16),
          _field(_type, 'Type — e.g. slab, frame, waterproofing, QA',
              autofocus: true),
          const SizedBox(height: 12),
          DropdownButtonFormField<ProjectStage?>(
            initialValue: _stage,
            decoration: _decoration('Stage (optional)'),
            style: const TextStyle(color: Op.text),
            dropdownColor: Op.surface,
            items: [
              const DropdownMenuItem<ProjectStage?>(
                  value: null, child: Text('No stage — QA only')),
              for (final s in widget.stages)
                DropdownMenuItem<ProjectStage?>(
                  value: s,
                  child: Text('Stage ${s.seq} · ${s.name}'
                      '${s.isHoldPoint ? ' (hold point)' : ''}'),
                ),
            ],
            onChanged: (v) => setState(() => _stage = v),
          ),
          if (_stage?.isHoldPoint == true)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                  'A pass here can validate this hold point and unblock the stage.',
                  style: TextStyle(
                      color: Op.warning.withValues(alpha: 0.9), fontSize: 12)),
            ),
          const SizedBox(height: 12),
          _field(_notes, 'Notes (optional)'),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Op.accent),
              onPressed: _type.text.trim().isEmpty || _busy ? null : _create,
              child: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : const Text('Create'),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _create() async {
    setState(() => _busy = true);
    await QualityOpsService.instance.createInspection(
      widget.projectId,
      type: _type.text.trim(),
      stageId: _stage?.id,
      isHoldPoint: _stage?.isHoldPoint ?? false,
      notes: _notes.text.trim(),
    );
    if (mounted) Navigator.pop(context, true);
  }

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

  Widget _field(TextEditingController c, String label,
          {bool autofocus = false}) =>
      TextField(
        controller: c,
        autofocus: autofocus,
        onChanged: (_) => setState(() {}),
        style: const TextStyle(color: Op.text),
        decoration: _decoration(label),
      );
}
