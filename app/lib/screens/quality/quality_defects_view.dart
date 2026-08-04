import 'package:flutter/material.dart';
import '../../config/app_theme.dart';
import '../../models/domain.dart';
import '../../services/permissions_service.dart';
import '../../services/quality_ops_service.dart';
import '../../widgets/photo_capture.dart';

/// Defects (appspec §5.5) — the punch-list: location, description, trade,
/// photo, assign, due (§12.5). Open defects do NOT block stage completion in
/// v1 (only hold points gate) — this is tracked to closure independently.
/// `raised_by`/`closed_at`/`closed_by` are server-stamped; the app only ever
/// pushes `status` transitions and the assignment/detail fields.
class QualityDefectsView extends StatefulWidget {
  final Project project;
  const QualityDefectsView({super.key, required this.project});

  @override
  State<QualityDefectsView> createState() => _QualityDefectsViewState();
}

class _QualityDefectsViewState extends State<QualityDefectsView> {
  QualityOpsService get _svc => QualityOpsService.instance;
  String get _pid => widget.project.id;

  DefectStatus? _filter; // null = all
  List<TeamMember> _team = [];
  bool _canWrite = false;

  @override
  void initState() {
    super.initState();
    _hydrate();
  }

  @override
  void didUpdateWidget(covariant QualityDefectsView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.project.id != widget.project.id) _hydrate();
  }

  Future<void> _hydrate() async {
    await PermissionsService.instance.ensureLoaded();
    final team = await _svc.fetchProjectMembers(_pid);
    await _svc.hydrateProject(_pid);
    if (!mounted) return;
    setState(() {
      _team = team;
      _canWrite = PermissionsService.instance.has('quality.write');
    });
  }

  @override
  Widget build(BuildContext context) {
    final list = _svc.defects(_pid, status: _filter);
    return Scaffold(
      backgroundColor: Op.bg,
      body: Column(
        children: [
          _filterBar(),
          Expanded(child: list.isEmpty ? _empty() : _list(list)),
        ],
      ),
      floatingActionButton: _canWrite
          ? FloatingActionButton.extended(
              backgroundColor: Op.accent,
              onPressed: _raise,
              icon: const Icon(Icons.add),
              label: const Text('Raise defect'),
            )
          : null,
    );
  }

  Widget _filterBar() {
    final options = <(String, DefectStatus?)>[
      ('All', null),
      ('Open', DefectStatus.open),
      ('In progress', DefectStatus.inProgress),
      ('Closed', DefectStatus.closed),
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
                side: BorderSide(
                    color: _filter == o.$2 ? Op.accent : Op.border),
              ),
            ),
        ],
      ),
    );
  }

  Widget _list(List<DefectEntry> list) => ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
        itemCount: list.length,
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (_, i) => _card(list[i]),
      );

  Widget _card(DefectEntry d) {
    final sevColor = switch (d.severity) {
      DefectSeverity.high => Op.warning,
      DefectSeverity.medium => Op.accent,
      DefectSeverity.low => Op.muted,
    };
    final assignee = d.assignedToName?.isNotEmpty == true
        ? d.assignedToName!
        : (d.assignedTo != null ? 'Assigned' : 'Unassigned');
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => _openDefect(d),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Op.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Op.border),
        ),
        child: Row(
          children: [
            Container(
              width: 6,
              height: 44,
              decoration: BoxDecoration(
                  color: sevColor, borderRadius: BorderRadius.circular(3)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(d.description,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: Op.text,
                          fontSize: 15,
                          fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(
                      [
                        if (d.location?.isNotEmpty == true) d.location!,
                        if (d.trade?.isNotEmpty == true) d.trade!,
                        assignee,
                        if (d.dueDate != null) 'due ${_fmtDate(d.dueDate!)}',
                      ].join(' · '),
                      style: const TextStyle(color: Op.muted, fontSize: 12.5)),
                ],
              ),
            ),
            _statusChip(d.status),
          ],
        ),
      ),
    );
  }

  Widget _statusChip(DefectStatus s) {
    final (color, label) = switch (s) {
      DefectStatus.open => (Op.warning, 'Open'),
      DefectStatus.inProgress => (Op.accent, 'In progress'),
      DefectStatus.closed => (Op.success, 'Closed'),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
          color: color.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(8)),
      child: Text(label,
          style:
              TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700)),
    );
  }

  Widget _empty() => ListView(children: [
        const SizedBox(height: 96),
        const Icon(Icons.checklist_outlined, size: 52, color: Op.muted),
        const SizedBox(height: 10),
        const Center(
            child: Text('No defects here',
                style: TextStyle(
                    color: Op.text, fontSize: 15, fontWeight: FontWeight.w700))),
        const SizedBox(height: 4),
        Center(
            child: Text(
                _canWrite ? 'Raise one from the punch-list walk.' : 'Nothing raised yet.',
                style: const TextStyle(color: Op.muted, fontSize: 13))),
      ]);

  static String _fmtDate(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}';

  Future<void> _raise() async {
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Op.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (_) => _DefectSheet(projectId: _pid, team: _team),
    );
    if (result == true && mounted) setState(() {});
  }

  Future<void> _openDefect(DefectEntry d) async {
    if (!_canWrite) return;
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Op.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (_) =>
          _DefectSheet(projectId: _pid, team: _team, existing: d),
    );
    if (result == true && mounted) setState(() {});
  }
}

class _DefectSheet extends StatefulWidget {
  final String projectId;
  final List<TeamMember> team;
  final DefectEntry? existing;
  const _DefectSheet({required this.projectId, required this.team, this.existing});

  @override
  State<_DefectSheet> createState() => _DefectSheetState();
}

class _DefectSheetState extends State<_DefectSheet> {
  late final _location = TextEditingController(text: widget.existing?.location);
  late final _trade = TextEditingController(text: widget.existing?.trade);
  late final _description =
      TextEditingController(text: widget.existing?.description);
  late final _assignee =
      TextEditingController(text: widget.existing?.assignedToName);
  String? _assignedTo;
  DateTime? _dueDate;
  late DefectSeverity _severity = widget.existing?.severity ?? DefectSeverity.medium;
  late DefectStatus _status = widget.existing?.status ?? DefectStatus.open;
  bool _busy = false;
  // The row being composed — for a NEW defect this holds a stable id up front so
  // photos queue against it before it's saved (order-free, xprojman-21 §P1);
  // for an edit it IS the existing row, so before/after photos append in place.
  late final DefectEntry _draft =
      widget.existing ?? DefectEntry(projectId: widget.projectId, description: '');

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    _assignedTo = widget.existing?.assignedTo;
    _dueDate = widget.existing?.dueDate;
  }

  @override
  void dispose() {
    _location.dispose();
    _trade.dispose();
    _description.dispose();
    _assignee.dispose();
    super.dispose();
  }

  List<TeamMember> get _suggestions {
    final q = _assignee.text.trim().toLowerCase();
    if (q.isEmpty) return const [];
    return widget.team
        .where((m) => m.name.toLowerCase().contains(q))
        .take(4)
        .toList();
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
            Text(_isEdit ? 'Defect' : 'Raise defect',
                style: const TextStyle(
                    color: Op.text, fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: 16),
            _field(_description, 'Description', autofocus: !_isEdit),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: _field(_location, 'Location (optional)')),
              const SizedBox(width: 12),
              Expanded(child: _field(_trade, 'Trade (optional)')),
            ]),
            const SizedBox(height: 12),
            SegmentedButton<DefectSeverity>(
              segments: const [
                ButtonSegment(value: DefectSeverity.low, label: Text('Low')),
                ButtonSegment(value: DefectSeverity.medium, label: Text('Medium')),
                ButtonSegment(value: DefectSeverity.high, label: Text('High')),
              ],
              selected: {_severity},
              onSelectionChanged: (s) => setState(() => _severity = s.first),
            ),
            const SizedBox(height: 12),
            _field(_assignee, 'Assign to (name)', onChanged: (_) {
              setState(() => _assignedTo = null); // free text until picked
            }),
            if (_suggestions.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Wrap(
                  spacing: 6,
                  children: [
                    for (final m in _suggestions)
                      ActionChip(
                        label: Text(m.name),
                        backgroundColor: Op.bg,
                        side: const BorderSide(color: Op.border),
                        labelStyle: const TextStyle(color: Op.text, fontSize: 12.5),
                        onPressed: () => setState(() {
                          _assignee.text = m.name;
                          _assignedTo = m.userId;
                        }),
                      ),
                  ],
                ),
              ),
            const SizedBox(height: 12),
            _dueDateRow(),
            const SizedBox(height: 12),
            _photoRow('Photograph the defect', _draft.photoIds, after: false),
            if (_isEdit) ...[
              const SizedBox(height: 12),
              _photoRow('Rectification photo (after)', _draft.photoAfterIds,
                  after: true),
              const SizedBox(height: 12),
              const Text('Status',
                  style: TextStyle(
                      color: Op.text, fontSize: 13, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              SegmentedButton<DefectStatus>(
                segments: const [
                  ButtonSegment(value: DefectStatus.open, label: Text('Open')),
                  ButtonSegment(
                      value: DefectStatus.inProgress, label: Text('In progress')),
                  ButtonSegment(value: DefectStatus.closed, label: Text('Closed')),
                ],
                selected: {_status},
                onSelectionChanged: (s) => setState(() => _status = s.first),
              ),
            ],
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                style: FilledButton.styleFrom(backgroundColor: Op.accent),
                onPressed: _description.text.trim().isEmpty || _busy
                    ? null
                    : _save,
                child: _busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : Text(_isEdit ? 'Save' : 'Raise defect'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _dueDateRow() => InkWell(
        onTap: () async {
          final picked = await showDatePicker(
            context: context,
            initialDate: _dueDate ?? DateTime.now(),
            firstDate: DateTime.now().subtract(const Duration(days: 365)),
            lastDate: DateTime.now().add(const Duration(days: 365 * 2)),
          );
          if (picked != null) setState(() => _dueDate = picked);
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          decoration: BoxDecoration(
            color: Op.bg,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: Op.border),
          ),
          child: Row(children: [
            const Icon(Icons.event_outlined, size: 18, color: Op.muted),
            const SizedBox(width: 8),
            Text(
                _dueDate == null
                    ? 'Due date (optional)'
                    : '${_dueDate!.day}/${_dueDate!.month}/${_dueDate!.year}',
                style: TextStyle(
                    color: _dueDate == null ? Op.muted : Op.text, fontSize: 14)),
          ]),
        ),
      );

  Future<void> _capturePhoto({required bool after}) async {
    final ref = await captureAndEnqueue(context,
        entityType: 'defect', entityId: _draft.id, projectId: widget.projectId);
    if (ref == null) return;
    setState(() => (after ? _draft.photoAfterIds : _draft.photoIds).add(ref));
  }

  Widget _photoRow(String label, List<String> ids, {required bool after}) =>
      InkWell(
        onTap: () => _capturePhoto(after: after),
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          decoration: BoxDecoration(
            color: Op.bg,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: ids.isEmpty ? Op.border : Op.accent),
          ),
          child: Row(children: [
            Icon(ids.isEmpty ? Icons.add_a_photo_outlined : Icons.check_circle,
                size: 18, color: ids.isEmpty ? Op.muted : Op.accent),
            const SizedBox(width: 8),
            Text(ids.isEmpty ? label : '${ids.length} photo(s) — $label',
                style: TextStyle(
                    color: ids.isEmpty ? Op.muted : Op.accent, fontSize: 13)),
          ]),
        ),
      );

  Future<void> _save() async {
    setState(() => _busy = true);
    final e = _draft;
    e.location = _nullIfEmpty(_location.text);
    e.trade = _nullIfEmpty(_trade.text);
    e.description = _description.text.trim();
    e.assignedTo = _assignedTo;
    e.assignedToName = _nullIfEmpty(_assignee.text);
    e.dueDate = _dueDate;
    e.severity = _severity;
    e.status = _status;
    if (_isEdit) {
      await QualityOpsService.instance.updateDefect(widget.projectId, e);
    } else {
      await QualityOpsService.instance.raiseDefect(widget.projectId, e);
    }
    if (mounted) Navigator.pop(context, true);
  }

  static String? _nullIfEmpty(String s) => s.trim().isEmpty ? null : s.trim();

  Widget _field(TextEditingController c, String label,
          {bool autofocus = false, ValueChanged<String>? onChanged}) =>
      TextField(
        controller: c,
        autofocus: autofocus,
        onChanged: (v) {
          setState(() {});
          onChanged?.call(v);
        },
        style: const TextStyle(color: Op.text),
        decoration: InputDecoration(
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
        ),
      );
}
