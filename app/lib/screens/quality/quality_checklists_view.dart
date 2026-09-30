import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../config/app_theme.dart';
import '../../models/domain.dart';
import '../../services/checklist_ops_service.dart';
import 'checklist_run_screen.dart';

/// Quality → Checklists (appspec §4.2, xprojman-46): internal QA, toolbox
/// talks and plant pre-starts, run from a published template. Synced
/// (server v047) through [ChecklistOpsService].
///
/// Hold-point checklists aren't here on purpose. Those stay on Inspections,
/// which is the only surface that can gate a stage (xprojman-46 F6).
class QualityChecklistsView extends StatefulWidget {
  final Project project;
  const QualityChecklistsView({super.key, required this.project});

  @override
  State<QualityChecklistsView> createState() => _QualityChecklistsViewState();
}

class _QualityChecklistsViewState extends State<QualityChecklistsView> {
  ChecklistOpsService get _svc => ChecklistOpsService.instance;
  String get _pid => widget.project.id;
  ChecklistStatus? _filter;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _svc.changes.addListener(_onChange);
    _hydrate();
  }

  @override
  void dispose() {
    _svc.changes.removeListener(_onChange);
    super.dispose();
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  Future<void> _hydrate() async {
    setState(() => _loading = true);
    await _svc.hydrateProject(_pid);
    if (mounted) setState(() => _loading = false);
  }

  @override
  void didUpdateWidget(covariant QualityChecklistsView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.project.id != widget.project.id) {
      _filter = null;
      _hydrate();
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = _svc.instances(_pid, status: _filter);
    return Scaffold(
      backgroundColor: Op.bg,
      body: Column(
        children: [
          _filterBar(),
          Expanded(
            child: _loading && list.isEmpty
                ? const Center(
                    child: CircularProgressIndicator(color: Op.accent))
                : RefreshIndicator(
                    onRefresh: _hydrate,
                    child: list.isEmpty ? _empty() : _list(list),
                  ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: Op.accent,
        onPressed: _startNew,
        icon: const Icon(Icons.playlist_add_check),
        label: const Text('Start checklist'),
      ),
    );
  }

  Widget _filterBar() {
    final options = <(String, ChecklistStatus?)>[
      ('All', null),
      ('In progress', ChecklistStatus.inProgress),
      ('Completed', ChecklistStatus.completed),
    ];
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: const BoxDecoration(
        color: Op.surface,
        border: Border(bottom: BorderSide(color: Op.border)),
      ),
      child: Row(
        children: [
          for (final o in options)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Text(o.$1),
                selected: _filter == o.$2,
                onSelected: (_) => setState(() => _filter = o.$2),
                selectedColor: Op.accent.withValues(alpha: 0.18),
                labelStyle: TextStyle(
                    color: _filter == o.$2 ? Op.accent : Op.muted,
                    fontWeight: FontWeight.w600,
                    fontSize: 12.5),
                backgroundColor: Op.bg,
                side: BorderSide(color: _filter == o.$2 ? Op.accent : Op.border),
              ),
            ),
        ],
      ),
    );
  }

  Widget _list(List<ChecklistInstance> list) => ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, Spacing.listBottomInset),
        itemCount: list.length,
        separatorBuilder: (_, _) => const SizedBox(height: Spacing.sm),
        itemBuilder: (_, i) => _card(list[i]),
      );

  Widget _card(ChecklistInstance c) {
    final (stripe, badgeIcon, badgeText, badgeColor) = switch (c.result) {
      _ when c.syncError != null && !c.isCompleted =>
        (Op.danger, Icons.sync_problem, 'Not synced', Op.dangerText),
      _ when c.completionRequested && !c.isCompleted =>
        (Op.warning, Icons.cloud_upload_outlined, 'Completing', Op.warningText),
      ChecklistResult.pass => (Op.success, Icons.check_circle, 'Passed', Op.successText),
      ChecklistResult.fail => (Op.danger, Icons.cancel, 'Failed', Op.dangerText),
      ChecklistResult.pending =>
        (Op.accent, Icons.pending_outlined, 'In progress', Op.accent),
    };
    final when = DateFormat('d MMM, h:mm a').format(c.completedAt ?? c.startedAt);
    return InkWell(
      borderRadius: BorderRadius.circular(Radii.lg),
      onTap: () => _open(c),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Op.surface,
          borderRadius: BorderRadius.circular(Radii.lg),
          border: Border.all(color: Op.border),
        ),
        child: Row(
          children: [
            Container(
              width: 6,
              height: 44,
              decoration: BoxDecoration(
                  color: stripe, borderRadius: BorderRadius.circular(3)),
            ),
            const SizedBox(width: Spacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(c.templateName,
                      style: const TextStyle(
                          color: Op.text, fontSize: 15, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(
                    '${c.category.label} · ${c.answered}/${c.items.length} answered · $when'
                    '${c.supersedesId != null ? ' · correction' : ''}',
                    style: const TextStyle(color: Op.muted, fontSize: 12.5),
                  ),
                ],
              ),
            ),
            const SizedBox(width: Spacing.sm),
            Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(badgeIcon, size: 16, color: badgeColor),
              const SizedBox(width: 4),
              Text(badgeText,
                  style: TextStyle(
                      color: badgeColor, fontSize: 12, fontWeight: FontWeight.w700)),
            ]),
          ],
        ),
      ),
    );
  }

  Widget _empty() => ListView(
        children: [
          const SizedBox(height: 72),
          const Icon(Icons.checklist_rtl, size: 52, color: Op.muted),
          const SizedBox(height: Spacing.md),
          Center(
            child: Text(
                _filter == null ? 'No checklists yet' : 'Nothing here',
                style: const TextStyle(
                    color: Op.text, fontSize: 16, fontWeight: FontWeight.w700)),
          ),
          const SizedBox(height: Spacing.xs),
          const Center(
            child: Text(
              'Start a toolbox talk, plant pre-start\nor internal QA check.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Op.muted, fontSize: 13),
            ),
          ),
        ],
      );

  Future<void> _startNew() async {
    final t = await showModalBottomSheet<ChecklistTemplate>(
      context: context,
      backgroundColor: Op.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.sheet))),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 18, 20, 6),
              child: Text('Start a checklist',
                  style: TextStyle(
                      color: Op.text, fontSize: 17, fontWeight: FontWeight.w800)),
            ),
            if (_svc.templates().isEmpty)
              const Padding(
                padding: EdgeInsets.fromLTRB(20, 4, 20, 16),
                child: Text(
                  'No published checklist templates yet. They appear here once '
                  'your PM publishes one in the Portal — pull down to refresh.',
                  style: TextStyle(color: Op.muted, fontSize: 13),
                ),
              ),
            for (final t in _svc.templates())
              ListTile(
                minVerticalPadding: 12,
                leading: Icon(_iconFor(t.category), color: Op.accent),
                title: Text(t.name,
                    style: const TextStyle(
                        color: Op.text, fontWeight: FontWeight.w700)),
                subtitle: Text(
                    '${t.category.label} · ${t.items.length} items'
                    '${t.description != null ? '\n${t.description}' : ''}',
                    style: const TextStyle(color: Op.muted, fontSize: 12.5)),
                isThreeLine: t.description != null,
                onTap: () => Navigator.pop(ctx, t),
              ),
            const SizedBox(height: Spacing.sm),
          ],
        ),
      ),
    );
    if (t == null) return;
    final inst = await _svc.start(_pid, t);
    if (mounted) await _open(inst);
  }

  static IconData _iconFor(ChecklistCategory c) => switch (c) {
        ChecklistCategory.toolboxTalk => Icons.groups_outlined,
        ChecklistCategory.plantPrestart => Icons.agriculture_outlined,
        ChecklistCategory.internalQa => Icons.fact_check_outlined,
        ChecklistCategory.other => Icons.checklist,
      };

  Future<void> _open(ChecklistInstance c) async {
    await Navigator.push(
      context,
      MaterialPageRoute(
          builder: (_) => ChecklistRunScreen(project: widget.project, instance: c)),
    );
    if (mounted) setState(() {});
  }
}
