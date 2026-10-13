import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../../config/app_theme.dart';
import '../../models/domain.dart';
import '../../services/safety_ops_service.dart';
import '../../widgets/photo_capture.dart';

/// Hazard / near-miss / incident list + raise, wired to sync (xprojman-48,
/// server v048) through [SafetyOpsService]. The Safety sub-page lists hazards
/// and near misses; the Incidents sub-page lists incidents (see [SafetyTab]).
/// Same shape as `quality_defects_view.dart`: filter chips, severity-striped
/// cards, bottom-sheet raise and detail.
///
/// Privacy (xprojman-48 F2, appdesignspecification §11.5 L4): an incident's
/// description must not name anyone or describe injuries. Those go in the
/// separate "Private: injury details" section, which leaves the phone once
/// sent.
class SafetyEntriesView extends StatefulWidget {
  final Project project;
  final bool incidents;
  const SafetyEntriesView(
      {super.key, required this.project, required this.incidents});

  @override
  State<SafetyEntriesView> createState() => _SafetyEntriesViewState();
}

class _SafetyEntriesViewState extends State<SafetyEntriesView> {
  SafetyOpsService get _svc => SafetyOpsService.instance;
  String get _pid => widget.project.id;
  SafetyStatus? _filter;

  Set<SafetyKind> get _kinds => widget.incidents
      ? const {SafetyKind.incident}
      : const {SafetyKind.hazard, SafetyKind.nearMiss};

  @override
  void initState() {
    super.initState();
    _svc.changes.addListener(_onChange);
    _svc.hydrateProject(_pid);
  }

  @override
  void didUpdateWidget(covariant SafetyEntriesView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.project.id != widget.project.id) {
      _svc.hydrateProject(_pid);
    }
    if (oldWidget.project.id != widget.project.id ||
        oldWidget.incidents != widget.incidents) {
      setState(() => _filter = null);
    }
  }

  @override
  void dispose() {
    _svc.changes.removeListener(_onChange);
    super.dispose();
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  String get _noun => widget.incidents ? 'incident' : 'hazard';

  @override
  Widget build(BuildContext context) {
    final list = _svc.entries(_pid, kinds: _kinds, status: _filter);
    return Scaffold(
      backgroundColor: Op.bg,
      body: Column(
        children: [
          _filterBar(),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () => _svc.sync(projectId: _pid),
              child: list.isEmpty ? _empty() : _list(list),
            ),
          ),
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
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
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
      ),
    );
  }

  Widget _list(List<SafetyEntry> list) => ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
        itemCount: list.length,
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (_, i) => _card(list[i]),
      );

  Widget _card(SafetyEntry e) {
    final sevColor = switch (e.severity) {
      SafetySeverity.high => Op.danger,
      SafetySeverity.medium => Op.warning,
      SafetySeverity.low => Op.muted,
    };
    final meta = [
      if (e.kind == SafetyKind.nearMiss) 'Near miss',
      if (e.location?.isNotEmpty == true) e.location!,
      if (e.hasPhoto) '${e.photoIds.length} photo${e.photoIds.length == 1 ? '' : 's'}',
      if (e.openActions > 0) '${e.openActions} open action${e.openActions == 1 ? '' : 's'}',
      if (e.raisedByName?.isNotEmpty == true) e.raisedByName!,
    ];
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => _open(e),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Op.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: e.isNotifiable ? Op.danger : Op.border),
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
                  Text(meta.join(' · '),
                      style: const TextStyle(color: Op.muted, fontSize: 12.5)),
                ],
              ),
            ),
            if (!e.isSynced) ...[
              Icon(e.syncError != null ? Icons.error_outline : Icons.cloud_upload_outlined,
                  size: 16, color: e.syncError != null ? Op.danger : Op.warning),
              const SizedBox(width: 6),
            ],
            _StatusChip(e.status),
          ],
        ),
      ),
    );
  }

  Widget _empty() => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const SizedBox(height: 96),
          Icon(widget.incidents ? Icons.health_and_safety_outlined : Icons.warning_amber_outlined,
              size: 52, color: Op.muted),
          const SizedBox(height: 10),
          Center(
              child: Text(widget.incidents ? 'No incidents here' : 'No hazards here',
                  style: const TextStyle(
                      color: Op.text, fontSize: 15, fontWeight: FontWeight.w700))),
          const SizedBox(height: 4),
          Center(
              child: Text('Raise a $_noun with the button below.',
                  style: const TextStyle(color: Op.muted, fontSize: 13))),
        ],
      );

  Future<void> _raise() => _sheet(_RaiseSheet(projectId: _pid, incidents: widget.incidents));

  Future<void> _open(SafetyEntry e) => _sheet(_DetailSheet(projectId: _pid, eventId: e.id));

  Future<void> _sheet(Widget child) => showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Op.surface,
        shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
        builder: (_) => child,
      );
}

class _StatusChip extends StatelessWidget {
  final SafetyStatus status;
  const _StatusChip(this.status);

  @override
  Widget build(BuildContext context) {
    final (fill, ink, label) = switch (status) {
      SafetyStatus.open => (Op.warning, Op.warningText, 'Open'),
      SafetyStatus.inProgress => (Op.accent, Op.accent, 'In progress'),
      SafetyStatus.closed => (Op.success, Op.successText, 'Closed'),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration:
          BoxDecoration(color: fill.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
      child: Text(label, style: TextStyle(color: ink, fontSize: 11, fontWeight: FontWeight.w700)),
    );
  }
}

// ── Shared bits ──────────────────────────────────────────────────────────────

const _regulatorNotice =
    'ProjMan records this incident and emails the PM and Site Supervisor. '
    'It does not notify the regulator for you.';
const _regulatorDuty =
    'A death, serious injury or illness, or dangerous incident must be reported '
    'to the regulator immediately.';
const _photoHint =
    'Photograph the hazard, damage or conditions. Avoid people where you can.';

String _syncMessage(String code) => switch (code) {
      'SAFETY_FROZEN' =>
        'Notifiable incidents can\'t be changed on the phone. Make corrections in the Portal.',
      'SAFETY_OPEN_ACTIONS' => 'Close every action before closing this.',
      'SAFETY_CLOSED' => 'This is already closed.',
      'FORBIDDEN' => 'Only a Site Supervisor or PM can change this.',
      'VALIDATION_ERROR' => 'Something is missing. Check the description.',
      _ when code.startsWith('DETAILS_') =>
        'Injury details couldn\'t be sent ($code). They are still on this phone.',
      _ => 'Couldn\'t sync ($code).',
    };

String _fmtDt(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
}

String _fmtDate(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year}';
}

Widget _field(TextEditingController c, String label,
        {String? helper, bool autofocus = false, int maxLines = 1, VoidCallback? onChanged}) =>
    TextField(
      controller: c,
      autofocus: autofocus,
      maxLines: maxLines,
      onChanged: onChanged == null ? null : (_) => onChanged(),
      style: const TextStyle(color: Op.text),
      decoration: InputDecoration(
        labelText: label,
        helperText: helper,
        helperMaxLines: 2,
        labelStyle: const TextStyle(color: Op.muted),
        filled: true,
        fillColor: Op.bg,
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Op.border)),
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Op.border)),
      ),
    );

Widget _sectionTitle(String t) => Padding(
      padding: const EdgeInsets.only(top: 16, bottom: 8),
      child: Text(t, style: const TextStyle(color: Op.text, fontSize: 13, fontWeight: FontWeight.w700)),
    );

Widget _notice(String text, {Color color = Op.muted, IconData icon = Icons.info_outline}) => Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 6),
        Expanded(child: Text(text, style: TextStyle(color: color, fontSize: 12))),
      ]),
    );

Widget _severityPicker(SafetySeverity value, ValueChanged<SafetySeverity> onChanged) =>
    SegmentedButton<SafetySeverity>(
      segments: const [
        ButtonSegment(value: SafetySeverity.low, label: Text('Low')),
        ButtonSegment(value: SafetySeverity.medium, label: Text('Medium')),
        ButtonSegment(value: SafetySeverity.high, label: Text('High')),
      ],
      selected: {value},
      onSelectionChanged: (s) => onChanged(s.first),
    );

Widget _photoRow(List<String> ids, VoidCallback? onAdd) => Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        for (final id in ids) PhotoThumb(idOrRef: id, size: 56),
        if (onAdd != null)
          OutlinedButton.icon(
            onPressed: onAdd,
            icon: const Icon(Icons.add_a_photo_outlined, size: 18),
            label: const Text('Add photo'),
          ),
      ],
    );

// ── Raise ────────────────────────────────────────────────────────────────────

class _RaiseSheet extends StatefulWidget {
  final String projectId;
  final bool incidents;
  const _RaiseSheet({required this.projectId, required this.incidents});

  @override
  State<_RaiseSheet> createState() => _RaiseSheetState();
}

class _RaiseSheetState extends State<_RaiseSheet> {
  // Minted up front so photos can be captured against it before saving.
  final String _id = const Uuid().v4();
  final _description = TextEditingController();
  final _location = TextEditingController();
  final _injuredName = TextEditingController();
  final _injuryType = TextEditingController();
  final _bodyPart = TextEditingController();
  final _witnesses = TextEditingController();
  late SafetyKind _kind = widget.incidents ? SafetyKind.incident : SafetyKind.hazard;
  SafetySeverity _severity = SafetySeverity.medium;
  DateTime _occurredAt = DateTime.now();
  bool _notifiable = false;
  InjuryTreatment? _treatment;
  bool? _lostTime;
  bool _showDetails = false;
  final List<String> _photos = [];
  bool _busy = false;

  bool get _isIncident => _kind == SafetyKind.incident;

  @override
  void dispose() {
    for (final c in [_description, _location, _injuredName, _injuryType, _bodyPart, _witnesses]) {
      c.dispose();
    }
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
            Text('Raise ${_kind.label.toLowerCase()}',
                style: const TextStyle(color: Op.text, fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: 16),
            if (!widget.incidents) ...[
              SegmentedButton<SafetyKind>(
                segments: const [
                  ButtonSegment(value: SafetyKind.hazard, label: Text('Hazard')),
                  ButtonSegment(value: SafetyKind.nearMiss, label: Text('Near miss')),
                ],
                selected: {_kind},
                onSelectionChanged: (s) => setState(() => _kind = s.first),
              ),
              const SizedBox(height: 12),
            ],
            _field(_description, _isIncident ? 'What happened' : 'Description',
                helper: _isIncident ? 'Don\'t name anyone or describe injuries here.' : null,
                autofocus: true,
                maxLines: 3,
                onChanged: () => setState(() {})),
            const SizedBox(height: 12),
            _field(_location, 'Location on site (optional)'),
            const SizedBox(height: 12),
            _severityPicker(_severity, (s) => setState(() => _severity = s)),
            if (_kind != SafetyKind.hazard) ...[
              _sectionTitle('When did it happen?'),
              OutlinedButton.icon(
                onPressed: _pickOccurred,
                icon: const Icon(Icons.schedule, size: 18),
                label: Text(_fmtDt(_occurredAt)),
              ),
            ],
            _sectionTitle('Photos'),
            _photoRow(_photos, _addPhoto),
            _notice(_photoHint),
            if (_isIncident) ..._incidentSections(),
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
                    : Text('Raise ${_kind.label.toLowerCase()}'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _incidentSections() => [
        _sectionTitle('Notifiable'),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _notifiable,
          onChanged: (v) => setState(() => _notifiable = v),
          title: const Text('This is a notifiable incident',
              style: TextStyle(color: Op.text, fontSize: 14)),
          subtitle: const Text('Death, serious injury or illness, or a dangerous incident.',
              style: TextStyle(color: Op.muted, fontSize: 12)),
        ),
        _notice(_notifiable ? _regulatorNotice : _regulatorDuty,
            color: _notifiable ? Op.dangerText : Op.muted,
            icon: _notifiable ? Icons.report_outlined : Icons.info_outline),
        if (_notifiable)
          _notice('Once sent, a notifiable incident can\'t be changed on the phone.'),
        const SizedBox(height: 8),
        InkWell(
          onTap: () => setState(() => _showDetails = !_showDetails),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(children: [
              const Icon(Icons.lock_outline, size: 18, color: Op.text),
              const SizedBox(width: 8),
              const Expanded(
                child: Text('Private: injury details (optional)',
                    style: TextStyle(color: Op.text, fontSize: 13, fontWeight: FontWeight.w700)),
              ),
              Icon(_showDetails ? Icons.expand_less : Icons.expand_more, color: Op.muted),
            ]),
          ),
        ),
        if (_showDetails) ...[
          _notice('Health information. It is sent once, then removed from this phone. '
              'Only you, the Site Supervisor and the PM can see it.'),
          const SizedBox(height: 10),
          _field(_injuredName, 'Injured person\'s name'),
          const SizedBox(height: 10),
          _field(_injuryType, 'Type of injury'),
          const SizedBox(height: 10),
          _field(_bodyPart, 'Part of body'),
          const SizedBox(height: 10),
          DropdownButtonFormField<InjuryTreatment>(
            initialValue: _treatment,
            decoration: const InputDecoration(labelText: 'Treatment', filled: true, fillColor: Op.bg),
            items: [
              for (final t in InjuryTreatment.values)
                DropdownMenuItem(value: t, child: Text(t.label)),
            ],
            onChanged: (t) => setState(() => _treatment = t),
          ),
          const SizedBox(height: 10),
          const Text('Time lost from work?', style: TextStyle(color: Op.muted, fontSize: 12.5)),
          const SizedBox(height: 6),
          SegmentedButton<bool>(
            emptySelectionAllowed: true,
            segments: const [
              ButtonSegment(value: true, label: Text('Yes')),
              ButtonSegment(value: false, label: Text('No')),
            ],
            selected: {?_lostTime},
            onSelectionChanged: (s) => setState(() => _lostTime = s.isEmpty ? null : s.first),
          ),
          const SizedBox(height: 10),
          _field(_witnesses, 'Witnesses (names)'),
        ],
      ];

  Future<void> _pickOccurred() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: _occurredAt,
      firstDate: now.subtract(const Duration(days: 30)),
      lastDate: now,
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
        context: context, initialTime: TimeOfDay.fromDateTime(_occurredAt));
    if (time == null) return;
    final picked = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    setState(() => _occurredAt = picked.isAfter(now) ? now : picked);
  }

  Future<void> _addPhoto() async {
    final ref = await captureAndEnqueue(context,
        entityType: 'safety_event', entityId: _id, projectId: widget.projectId);
    if (ref == null || !mounted) return;
    setState(() => _photos.add(ref));
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    await SafetyOpsService.instance.raise(
      id: _id,
      projectId: widget.projectId,
      kind: _kind,
      description: _description.text,
      location: _location.text,
      severity: _severity,
      occurredAt: _kind == SafetyKind.hazard ? null : _occurredAt,
      isNotifiable: _isIncident && _notifiable,
      details: _isIncident
          ? IncidentDetailsInput(
              injuredName: _injuredName.text,
              injuryType: _injuryType.text,
              bodyPart: _bodyPart.text,
              treatment: _treatment,
              lostTime: _lostTime,
              witnessNames: _witnesses.text,
            )
          : null,
      photoIds: _photos,
    );
    if (mounted) Navigator.pop(context);
  }
}

// ── Detail (view, manager actions) ──────────────────────────────────────────

class _DetailSheet extends StatefulWidget {
  final String projectId;
  final String eventId;
  const _DetailSheet({required this.projectId, required this.eventId});

  @override
  State<_DetailSheet> createState() => _DetailSheetState();
}

class _DetailSheetState extends State<_DetailSheet> {
  SafetyOpsService get _svc => SafetyOpsService.instance;
  final _newAction = TextEditingController();
  final _assignee = TextEditingController();
  final _closeNote = TextEditingController();
  DateTime? _due;
  bool _editing = false;
  late final _editDescription = TextEditingController();
  late final _editLocation = TextEditingController();
  SafetySeverity _editSeverity = SafetySeverity.medium;

  @override
  void initState() {
    super.initState();
    _svc.changes.addListener(_onChange);
  }

  @override
  void dispose() {
    _svc.changes.removeListener(_onChange);
    for (final c in [_newAction, _assignee, _closeNote, _editDescription, _editLocation]) {
      c.dispose();
    }
    super.dispose();
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  void _show(String? code) {
    if (code == null || !mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_syncMessage(code))));
  }

  @override
  Widget build(BuildContext context) {
    final e = _svc.byId(widget.projectId, widget.eventId);
    if (e == null) return const SizedBox(height: 120);
    final manage = _svc.canManage && !e.isFrozen && e.status != SafetyStatus.closed;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 18, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(
                child: Text(e.kind.label,
                    style: const TextStyle(color: Op.text, fontSize: 17, fontWeight: FontWeight.w800)),
              ),
              _StatusChip(e.status),
            ]),
            const SizedBox(height: 12),
            if (_editing) ..._editForm(e) else ..._summary(e),
            if (e.syncError != null)
              _notice(_syncMessage(e.syncError!), color: Op.dangerText, icon: Icons.error_outline)
            else if (!e.isSynced)
              _notice('Saved on this phone. It will send when there\'s signal.',
                  color: Op.warningText, icon: Icons.cloud_upload_outlined),
            if (e.kind == SafetyKind.incident) ..._incidentInfo(e),
            _sectionTitle('Photos'),
            _photoRow(e.photoIds, e.status == SafetyStatus.closed ? null : () => _addPhoto(e)),
            if (e.status != SafetyStatus.closed) _notice(_photoHint),
            _sectionTitle('Actions'),
            if (e.actions.isEmpty)
              const Text('No corrective actions yet.', style: TextStyle(color: Op.muted, fontSize: 13)),
            for (final a in e.actions) _actionRow(e, a),
            if (manage) ..._addActionForm(e),
            if (manage && !_editing) ..._closeForm(e),
            if (e.status == SafetyStatus.closed && e.closeNote?.isNotEmpty == true)
              _notice('Closing note: ${e.closeNote}'),
            if (!_svc.canManage)
              _notice('A Site Supervisor or PM adds actions and closes this.'),
          ],
        ),
      ),
    );
  }

  List<Widget> _summary(SafetyEntry e) => [
        Text(e.description, style: const TextStyle(color: Op.text, fontSize: 15)),
        const SizedBox(height: 8),
        Text(
            [
              'Severity: ${e.severity.name}',
              if (e.location?.isNotEmpty == true) e.location!,
              if (e.occurredAt != null) 'Happened ${_fmtDt(e.occurredAt!)}',
              'Raised ${_fmtDt(e.raisedAt)}${e.raisedByName != null ? ' by ${e.raisedByName}' : ''}',
            ].join(' · '),
            style: const TextStyle(color: Op.muted, fontSize: 12.5)),
        if (_svc.canManage && !e.isFrozen && e.status != SafetyStatus.closed)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => setState(() {
                _editing = true;
                _editDescription.text = e.description;
                _editLocation.text = e.location ?? '';
                _editSeverity = e.severity;
              }),
              icon: const Icon(Icons.edit_outlined, size: 16),
              label: const Text('Edit'),
            ),
          ),
      ];

  List<Widget> _editForm(SafetyEntry e) => [
        _field(_editDescription, e.kind == SafetyKind.incident ? 'What happened' : 'Description',
            helper: e.kind == SafetyKind.incident ? 'Don\'t name anyone or describe injuries here.' : null,
            maxLines: 3),
        const SizedBox(height: 10),
        _field(_editLocation, 'Location on site (optional)'),
        const SizedBox(height: 10),
        StatefulBuilder(
          builder: (_, set) => _severityPicker(_editSeverity, (s) => set(() => _editSeverity = s)),
        ),
        const SizedBox(height: 8),
        Row(children: [
          TextButton(onPressed: () => setState(() => _editing = false), child: const Text('Cancel')),
          const Spacer(),
          FilledButton(
            onPressed: () async {
              final code = await _svc.update(e,
                  description: _editDescription.text,
                  location: _editLocation.text,
                  severity: _editSeverity);
              _show(code);
              if (code == null && mounted) setState(() => _editing = false);
            },
            child: const Text('Save'),
          ),
        ]),
      ];

  List<Widget> _incidentInfo(SafetyEntry e) => [
        if (e.isNotifiable) ...[
          _sectionTitle('Notifiable incident'),
          _notice(_regulatorNotice, color: Op.dangerText, icon: Icons.report_outlined),
          if (e.isFrozen)
            _notice('This can\'t be changed on the phone. Corrections and closing are done in the Portal.'),
        ],
        switch (e.details) {
          DetailsState.waiting => _notice(
              'Injury details are on this phone, waiting to send. They\'re removed once sent.',
              icon: Icons.lock_outline),
          DetailsState.sent => _notice(
              'Injury details were sent and are no longer kept on this phone. View them in the Portal.',
              icon: Icons.lock_outline),
          DetailsState.none => const SizedBox.shrink(),
        },
      ];

  Widget _actionRow(SafetyEntry e, SafetyAction a) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(children: [
          Icon(a.isClosed ? Icons.check_circle : Icons.radio_button_unchecked,
              size: 18, color: a.isClosed ? Op.success : Op.muted),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
                [
                  a.action,
                  if (a.assignedToName?.isNotEmpty == true) a.assignedToName!,
                  if (a.dueDate != null) 'due ${_fmtDate(a.dueDate!)}',
                ].join(' · '),
                style: TextStyle(
                    color: a.isClosed ? Op.muted : Op.text,
                    fontSize: 13,
                    decoration: a.isClosed ? TextDecoration.lineThrough : null)),
          ),
          if (!a.isClosed && _svc.canManage && e.status != SafetyStatus.closed)
            TextButton(
              onPressed: () async => _show(await _svc.closeAction(e, a)),
              child: const Text('Done'),
            ),
        ]),
      );

  List<Widget> _addActionForm(SafetyEntry e) => [
        const SizedBox(height: 8),
        _field(_newAction, 'New corrective action', onChanged: () => setState(() {})),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: _field(_assignee, 'Who (optional)')),
          const SizedBox(width: 8),
          OutlinedButton(
            onPressed: () async {
              final now = DateTime.now();
              final d = await showDatePicker(
                  context: context,
                  initialDate: _due ?? now,
                  firstDate: now.subtract(const Duration(days: 1)),
                  lastDate: now.add(const Duration(days: 365)));
              if (d != null) setState(() => _due = d);
            },
            child: Text(_due == null ? 'Due date' : _fmtDate(_due!)),
          ),
        ]),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerRight,
          child: FilledButton.tonal(
            onPressed: _newAction.text.trim().isEmpty
                ? null
                : () async {
                    final code = await _svc.addAction(e,
                        action: _newAction.text, assignedToName: _assignee.text, dueDate: _due);
                    _show(code);
                    if (code == null) {
                      _newAction.clear();
                      _assignee.clear();
                      setState(() => _due = null);
                    }
                  },
            child: const Text('Add action'),
          ),
        ),
      ];

  List<Widget> _closeForm(SafetyEntry e) => [
        _sectionTitle('Close'),
        if (e.openActions > 0)
          _notice('Close every action first.')
        else ...[
          _field(_closeNote, 'Closing note (optional)', maxLines: 2),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Op.success),
              onPressed: () async {
                final code = await _svc.close(e, note: _closeNote.text);
                _show(code);
                if (code == null && mounted) Navigator.pop(context);
              },
              child: Text('Close ${e.kind.label.toLowerCase()}'),
            ),
          ),
        ],
      ];

  Future<void> _addPhoto(SafetyEntry e) async {
    final ref = await captureAndEnqueue(context,
        entityType: 'safety_event', entityId: e.id, projectId: e.projectId);
    if (ref == null) return;
    await _svc.attachPhoto(e, ref);
  }
}
