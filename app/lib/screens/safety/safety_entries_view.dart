import 'package:flutter/material.dart';
import '../../config/app_theme.dart';
import '../../models/domain.dart';
import '../../services/safety_ops_service.dart';

/// Hazard/incident list + raise, one [kind] per screen (Safety subpage =
/// hazard, Incidents subpage = incident — see [SafetyTab]). **UI mockup
/// only** — see [SafetyOpsService]'s own header for why. Deliberately mirrors
/// `quality_defects_view.dart`'s shape (filter chips, severity-striped card,
/// bottom-sheet raise/edit) since Defects is the closest built analogue and
/// `xprojman-28.md` §5 recommends the same underlying schema shape.
class SafetyEntriesView extends StatefulWidget {
  final Project project;
  final SafetyKind kind;
  const SafetyEntriesView({super.key, required this.project, required this.kind});

  @override
  State<SafetyEntriesView> createState() => _SafetyEntriesViewState();
}

class _SafetyEntriesViewState extends State<SafetyEntriesView> {
  SafetyOpsService get _svc => SafetyOpsService.instance;
  String get _pid => widget.project.id;
  SafetyStatus? _filter;

  @override
  void didUpdateWidget(covariant SafetyEntriesView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.project.id != widget.project.id ||
        oldWidget.kind != widget.kind) {
      setState(() => _filter = null);
    }
  }

  String get _noun => widget.kind == SafetyKind.hazard ? 'hazard' : 'incident';

  @override
  Widget build(BuildContext context) {
    final list =
        _svc.entries(_pid, kind: widget.kind, status: _filter);
    return Scaffold(
      backgroundColor: Op.bg,
      body: Column(
        children: [
          _mockBanner(),
          _filterBar(),
          Expanded(child: list.isEmpty ? _empty() : _list(list)),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: Op.accent,
        onPressed: _raise,
        icon: const Icon(Icons.add),
        label: Text('Raise $_noun'),
      ),
    );
  }

  Widget _mockBanner() => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        color: Op.warning.withValues(alpha: 0.12),
        child: Row(children: [
          const Icon(Icons.design_services_outlined, size: 14, color: Op.warningText),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Design mockup — not wired to a server yet. Entries reset on restart.',
              style: const TextStyle(color: Op.warningText, fontSize: 11.5, fontWeight: FontWeight.w600),
            ),
          ),
        ]),
      );

  Widget _filterBar() {
    final options = <(String, SafetyStatus?)>[
      ('All', null),
      ('Open', SafetyStatus.open),
      ('In progress', SafetyStatus.inProgress),
      ('Closed', SafetyStatus.closed),
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

  Widget _list(List<SafetyEntry> list) => ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
        itemCount: list.length,
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (_, i) => _card(list[i]),
      );

  Widget _card(SafetyEntry e) {
    final sevColor = switch (e.severity) {
      SafetySeverity.high => Op.warning,
      SafetySeverity.medium => Op.accent,
      SafetySeverity.low => Op.muted,
    };
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => _open(e),
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
              decoration:
                  BoxDecoration(color: sevColor, borderRadius: BorderRadius.circular(3)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(e.description,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: Op.text, fontSize: 15, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(
                      [
                        if (e.location?.isNotEmpty == true) e.location!,
                        if (e.hasPhoto) '📷 photo',
                        if (e.raisedByName?.isNotEmpty == true) e.raisedByName!,
                      ].join(' · '),
                      style: const TextStyle(color: Op.muted, fontSize: 12.5)),
                ],
              ),
            ),
            _statusChip(e.status),
          ],
        ),
      ),
    );
  }

  Widget _statusChip(SafetyStatus s) {
    final (fill, ink, label) = switch (s) {
      SafetyStatus.open => (Op.warning, Op.warningText, 'Open'),
      SafetyStatus.inProgress => (Op.accent, Op.accent, 'In progress'),
      SafetyStatus.closed => (Op.success, Op.successText, 'Closed'),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration:
          BoxDecoration(color: fill.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
      child: Text(label,
          style: TextStyle(color: ink, fontSize: 11, fontWeight: FontWeight.w700)),
    );
  }

  Widget _empty() => ListView(children: [
        const SizedBox(height: 96),
        Icon(
            widget.kind == SafetyKind.hazard
                ? Icons.warning_amber_outlined
                : Icons.health_and_safety_outlined,
            size: 52,
            color: Op.muted),
        const SizedBox(height: 10),
        Center(
            child: Text('No ${_noun}s here',
                style: const TextStyle(
                    color: Op.text, fontSize: 15, fontWeight: FontWeight.w700))),
        const SizedBox(height: 4),
        Center(
            child: Text('Raise a $_noun with the button below.',
                style: const TextStyle(color: Op.muted, fontSize: 13))),
      ]);

  Future<void> _raise() async {
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Op.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (_) => _SafetySheet(projectId: _pid, kind: widget.kind),
    );
    if (result == true && mounted) setState(() {});
  }

  Future<void> _open(SafetyEntry e) async {
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Op.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (_) => _SafetySheet(projectId: _pid, kind: widget.kind, existing: e),
    );
    if (result == true && mounted) setState(() {});
  }
}

class _SafetySheet extends StatefulWidget {
  final String projectId;
  final SafetyKind kind;
  final SafetyEntry? existing;
  const _SafetySheet({required this.projectId, required this.kind, this.existing});

  @override
  State<_SafetySheet> createState() => _SafetySheetState();
}

class _SafetySheetState extends State<_SafetySheet> {
  late final _description = TextEditingController(text: widget.existing?.description);
  late final _location = TextEditingController(text: widget.existing?.location);
  late SafetySeverity _severity = widget.existing?.severity ?? SafetySeverity.medium;
  late SafetyStatus _status = widget.existing?.status ?? SafetyStatus.open;
  late bool _hasPhoto = widget.existing?.hasPhoto ?? false;
  bool _busy = false;

  bool get _isEdit => widget.existing != null;
  String get _noun => widget.kind == SafetyKind.hazard ? 'hazard' : 'incident';

  @override
  void dispose() {
    _description.dispose();
    _location.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 18, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_isEdit ? 'Edit $_noun' : 'Raise $_noun',
                style: const TextStyle(color: Op.text, fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: 16),
            _field(_description, 'Description', autofocus: !_isEdit),
            const SizedBox(height: 12),
            _field(_location, 'Location (optional)'),
            const SizedBox(height: 12),
            SegmentedButton<SafetySeverity>(
              segments: const [
                ButtonSegment(value: SafetySeverity.low, label: Text('Low')),
                ButtonSegment(value: SafetySeverity.medium, label: Text('Medium')),
                ButtonSegment(value: SafetySeverity.high, label: Text('High')),
              ],
              selected: {_severity},
              onSelectionChanged: (s) => setState(() => _severity = s.first),
            ),
            const SizedBox(height: 12),
            InkWell(
              onTap: () => setState(() => _hasPhoto = !_hasPhoto),
              borderRadius: BorderRadius.circular(10),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                decoration: BoxDecoration(
                  color: Op.bg,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: _hasPhoto ? Op.accent : Op.border),
                ),
                child: Row(children: [
                  Icon(_hasPhoto ? Icons.check_circle : Icons.add_a_photo_outlined,
                      size: 18, color: _hasPhoto ? Op.accent : Op.muted),
                  const SizedBox(width: 8),
                  Text(
                      _hasPhoto
                          ? 'Photo attached (mock)'
                          : 'Attach photo — disabled in this mockup',
                      style: TextStyle(color: _hasPhoto ? Op.accent : Op.muted, fontSize: 13)),
                ]),
              ),
            ),
            if (_isEdit) ...[
              const SizedBox(height: 12),
              const Text('Status',
                  style: TextStyle(color: Op.text, fontSize: 13, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              SegmentedButton<SafetyStatus>(
                segments: const [
                  ButtonSegment(value: SafetyStatus.open, label: Text('Open')),
                  ButtonSegment(value: SafetyStatus.inProgress, label: Text('In progress')),
                  ButtonSegment(value: SafetyStatus.closed, label: Text('Closed')),
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
                onPressed: _description.text.trim().isEmpty || _busy ? null : _save,
                child: _busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : Text(_isEdit ? 'Save' : 'Raise $_noun'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    if (_isEdit) {
      final e = widget.existing!;
      e.description = _description.text.trim();
      e.location = _location.text.trim().isEmpty ? null : _location.text.trim();
      e.severity = _severity;
      e.status = _status;
      e.hasPhoto = _hasPhoto;
      SafetyOpsService.instance.update(widget.projectId, e);
    } else {
      await SafetyOpsService.instance.raise(
        projectId: widget.projectId,
        kind: widget.kind,
        description: _description.text.trim(),
        location: _location.text.trim().isEmpty ? null : _location.text.trim(),
        severity: _severity,
        hasPhoto: _hasPhoto,
      );
    }
    if (mounted) Navigator.pop(context, true);
  }

  Widget _field(TextEditingController c, String label, {bool autofocus = false}) => TextField(
        controller: c,
        autofocus: autofocus,
        onChanged: (_) => setState(() {}),
        style: const TextStyle(color: Op.text),
        decoration: InputDecoration(
          labelText: label,
          labelStyle: const TextStyle(color: Op.muted),
          filled: true,
          fillColor: Op.bg,
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Op.border)),
          enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Op.border)),
        ),
      );
}
