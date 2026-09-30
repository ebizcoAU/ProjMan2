import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../config/app_theme.dart';
import '../../models/domain.dart';
import '../../services/checklist_ops_service.dart';
import '../../services/quality_ops_service.dart';
import '../../services/signoff_store.dart';
import '../../widgets/photo_capture.dart';
import '../../widgets/signature_pad.dart';

/// Run one checklist (appspec §4.2). Each item gets **explicit Pass / Fail /
/// N/A buttons**, not tap-to-cycle ("one tap, one decision", resolved
/// 2026-09-03), at ≥48dp. Photo per item, a sign-off section named for the
/// category (attendees or operator), then Complete. Once complete, the
/// record is frozen and read-only. A mistake is fixed by starting a
/// correction, never by editing (xprojman-46 F5). Synced (server v047):
/// tapping Complete locks the checklist at once, and the completion itself
/// goes up once the items, sign-offs and evidence have synced.
class ChecklistRunScreen extends StatefulWidget {
  final Project project;
  final ChecklistInstance instance;
  const ChecklistRunScreen(
      {super.key, required this.project, required this.instance});

  @override
  State<ChecklistRunScreen> createState() => _ChecklistRunScreenState();
}

class _ChecklistRunScreenState extends State<ChecklistRunScreen> {
  ChecklistOpsService get _svc => ChecklistOpsService.instance;

  /// Always the freshest copy: a background sync reloads the cache and can
  /// replace the object (e.g. when the server stamps the result).
  ChecklistInstance get _c =>
      _svc.byId(widget.project.id, widget.instance.id) ?? widget.instance;

  @override
  void initState() {
    super.initState();
    _svc.changes.addListener(_onChange);
  }

  @override
  void dispose() {
    _svc.changes.removeListener(_onChange);
    super.dispose();
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  /// Set after a refused completion, so the offending items are highlighted
  /// until they're fixed.
  bool _showBlockers = false;

  @override
  Widget build(BuildContext context) {
    final signoffs = _svc.signoffs(_c);
    return Scaffold(
      backgroundColor: Op.bg,
      appBar: AppBar(
        backgroundColor: Op.surface,
        foregroundColor: Op.text,
        elevation: 0,
        title: Text(_c.templateName,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, Spacing.listBottomInset),
        children: [
          if (_c.isCompleted)
            _resultBanner()
          else if (_c.syncError != null)
            _syncErrorBanner(_c.syncError!)
          else if (_c.completionRequested)
            _completingBanner(),
          _header(),
          const SizedBox(height: Spacing.lg),
          _sectionTitle('Items', '${_c.answered}/${_c.items.length} answered'),
          for (final item in _c.items) _itemCard(item),
          const SizedBox(height: Spacing.lg),
          _sectionTitle(_c.category.signoffHeading,
              signoffs.isEmpty ? 'none yet' : '${signoffs.length}'),
          for (final s in signoffs) _signoffRow(s),
          if (!_c.isFrozen) _addSignoffButton(),
        ],
      ),
      bottomNavigationBar: _c.isCompleted
          ? _correctionBar()
          : (_c.isFrozen ? null : _completeBar()),
    );
  }

  // ── Header ───────────────────────────────────────────────────────────────

  Widget _resultBanner() {
    final pass = _c.result == ChecklistResult.pass;
    final when = _c.completedAt == null
        ? ''
        : DateFormat('d MMM yyyy, h:mm a').format(_c.completedAt!);
    return Container(
      margin: const EdgeInsets.only(bottom: Spacing.md),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: (pass ? Op.success : Op.danger).withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(Radii.lg),
        border: Border.all(color: pass ? Op.successText : Op.dangerText),
      ),
      child: Row(children: [
        Icon(pass ? Icons.check_circle : Icons.cancel,
            color: pass ? Op.successText : Op.dangerText),
        const SizedBox(width: Spacing.md),
        Expanded(
          child: Text(
            '${pass ? 'Passed' : 'Failed'} — completed'
            '${when.isNotEmpty ? ' $when' : ''}.\n'
            'Locked. To fix a mistake, start a correction.',
            style: TextStyle(
                color: pass ? Op.successText : Op.dangerText,
                fontSize: 13,
                fontWeight: FontWeight.w600),
          ),
        ),
      ]),
    );
  }

  Widget _completingBanner() => _banner(
        icon: Icons.cloud_upload_outlined,
        fg: Op.warningText,
        bg: Op.warning,
        text: 'Completing — locked. It finishes as soon as the answers, '
            'photos and signatures have synced. No signal needed right now.',
      );

  Widget _syncErrorBanner(String code) => _banner(
        icon: Icons.sync_problem,
        fg: Op.dangerText,
        bg: Op.danger,
        text: switch (code) {
          'UPLOAD_FAILED' =>
            'A photo or signature couldn\'t be uploaded, so this checklist '
                'can\'t complete. Check Profile → Device & Sync.',
          'CHECKLIST_INCOMPLETE' =>
            'The server is still missing some evidence — it will retry '
                'automatically once the uploads land.',
          'CHECKLIST_FROZEN' =>
            'This checklist was completed on another device. Showing the '
                'server copy.',
          'FORBIDDEN' =>
            'Your role can\'t run this checklist, so it wasn\'t saved to '
                'the server.',
          _ => 'This checklist couldn\'t sync ($code).',
        },
      );

  Widget _banner(
          {required IconData icon,
          required Color fg,
          required Color bg,
          required String text}) =>
      Container(
        margin: const EdgeInsets.only(bottom: Spacing.md),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: bg.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(Radii.lg),
          border: Border.all(color: fg),
        ),
        child: Row(children: [
          Icon(icon, color: fg),
          const SizedBox(width: Spacing.md),
          Expanded(
            child: Text(text,
                style: TextStyle(
                    color: fg, fontSize: 13, fontWeight: FontWeight.w600)),
          ),
        ]),
      );

  Widget _header() {
    final started = DateFormat('d MMM yyyy, h:mm a').format(_c.startedAt);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Op.surface,
        borderRadius: BorderRadius.circular(Radii.lg),
        border: Border.all(color: Op.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _metaRow(Icons.category_outlined, _c.category.label),
          _metaRow(Icons.folder_outlined, widget.project.name),
          _metaRow(Icons.schedule,
              'Started $started${_c.startedByName != null ? ' by ${_c.startedByName}' : ''}'),
          // The app has no GPS package yet (no geolocator in pubspec). The
          // instance's lat/lng are captured at start once that's added.
          _metaRow(Icons.location_on_outlined, 'Location — captured at start (not wired yet)'),
          if (_c.supersedesId != null)
            _metaRow(Icons.history, 'Corrects an earlier checklist'),
        ],
      ),
    );
  }

  Widget _metaRow(IconData icon, String text) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          Icon(icon, size: 16, color: Op.muted),
          const SizedBox(width: Spacing.sm),
          Expanded(
              child: Text(text,
                  style: const TextStyle(color: Op.text, fontSize: 13.5))),
        ]),
      );

  Widget _sectionTitle(String title, String trailing) => Padding(
        padding: const EdgeInsets.only(bottom: Spacing.sm),
        child: Row(children: [
          Text(title,
              style: const TextStyle(
                  color: Op.text, fontSize: 15, fontWeight: FontWeight.w800)),
          const Spacer(),
          Text(trailing, style: const TextStyle(color: Op.muted, fontSize: 12.5)),
        ]),
      );

  // ── Items ────────────────────────────────────────────────────────────────

  Widget _itemCard(ChecklistItem item) {
    final blocker = _showBlockers && !_c.isFrozen ? item.blocker : null;
    return Container(
      margin: const EdgeInsets.only(bottom: Spacing.sm),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: Op.surface,
        borderRadius: BorderRadius.circular(Radii.md),
        border: Border.all(
            color: blocker != null ? Op.dangerText : Op.border,
            width: blocker != null ? 1.5 : 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${item.seq}.',
                style: const TextStyle(
                    color: Op.muted, fontSize: 14.5, fontWeight: FontWeight.w700)),
            const SizedBox(width: Spacing.sm),
            Expanded(
              child: Text(item.label,
                  style: const TextStyle(color: Op.text, fontSize: 14.5)),
            ),
          ]),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 4, children: [
            _tag(item.isRequired ? 'Required' : 'Optional'),
            if (item.photoRequired) _tag('Photo required', icon: Icons.photo_camera_outlined),
            if (blocker != null) _tag(blocker, danger: true),
          ]),
          const SizedBox(height: 10),
          _resultButtons(item),
          if (item.note != null)
            Padding(
              padding: const EdgeInsets.only(top: Spacing.sm),
              child: Text(item.note!,
                  style: const TextStyle(color: Op.muted, fontSize: 13)),
            ),
          if (item.photoIds.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: Spacing.sm),
              child: Wrap(spacing: 6, runSpacing: 6, children: [
                for (final id in item.photoIds) PhotoThumb(idOrRef: id, size: 44),
              ]),
            ),
          if (!_c.isFrozen)
            Row(children: [
              TextButton.icon(
                onPressed: () => _addPhoto(item),
                icon: const Icon(Icons.add_a_photo_outlined, size: 18),
                label: Text(item.photoCount == 0 ? 'Photo' : 'Add photo'),
                style: TextButton.styleFrom(
                    foregroundColor: Op.accent, minimumSize: const Size(48, 48)),
              ),
              TextButton.icon(
                  onPressed: () => _editNote(item),
                  icon: const Icon(Icons.notes, size: 18),
                  label: Text(item.note == null ? 'Note' : 'Edit note'),
                  style: TextButton.styleFrom(
                      foregroundColor: Op.accent, minimumSize: const Size(48, 48)),
                ),
            ]),
        ],
      ),
    );
  }

  Widget _tag(String text, {IconData? icon, bool danger = false}) {
    final fg = danger ? Op.dangerText : Op.muted;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: danger ? Op.danger.withValues(alpha: 0.10) : Op.bg,
        borderRadius: BorderRadius.circular(Radii.sm),
        border: Border.all(color: danger ? Op.dangerText : Op.border),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 13, color: fg), const SizedBox(width: 4)],
        Text(text,
            style: TextStyle(color: fg, fontSize: 11.5, fontWeight: FontWeight.w600)),
      ]),
    );
  }

  /// Pass = green, Fail = red, N/A = grey. Fail uses danger rather than
  /// amber so a real fail can't be mistaken for "pending" (the audit rule
  /// already applied on Inspections). A selected button is a solid fill of
  /// the dark *Text variant, which keeps white text at ≥7:1.
  Widget _resultButtons(ChecklistItem item) {
    Widget btn(ChecklistItemResult r, String label, IconData icon, Color color) {
      final selected = item.result == r;
      return Expanded(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 3),
          child: OutlinedButton.icon(
            onPressed: _c.isFrozen ? null : () => _setResult(item, r),
            icon: Icon(icon, size: 18),
            label: Text(label),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
              foregroundColor: selected ? Colors.white : color,
              backgroundColor: selected ? color : Op.surface,
              disabledForegroundColor: selected ? Colors.white : Op.muted,
              disabledBackgroundColor: selected ? color : Op.surface,
              side: BorderSide(color: selected ? color : Op.border, width: 1.5),
              textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(Radii.md)),
            ),
          ),
        ),
      );
    }

    return Row(children: [
      btn(ChecklistItemResult.pass, 'Pass', Icons.check, Op.successText),
      btn(ChecklistItemResult.fail, 'Fail', Icons.close, Op.dangerText),
      btn(ChecklistItemResult.na, 'N/A', Icons.remove, Op.muted),
    ]);
  }

  Future<void> _setResult(ChecklistItem item, ChecklistItemResult r) async {
    // Tapping the selected answer again clears it, so a mis-tap is undoable
    // without an extra "clear" control.
    final next = item.result == r ? ChecklistItemResult.pending : r;
    if (await _svc.setResult(_c, item, next) && mounted) setState(() {});
  }

  Future<void> _addPhoto(ChecklistItem item) async {
    // The offline document queue (xprojman-22): capture → enqueue → cache the
    // client_ref on the item. The evidence is a `documents` row keyed by the
    // item's id (entity_type 'checklist_item', server v047).
    final ref = await captureAndEnqueue(context,
        entityType: 'checklist_item',
        entityId: item.id,
        projectId: widget.project.id);
    if (ref == null) return;
    if (await _svc.attachPhoto(_c, item, ref) && mounted) setState(() {});
  }

  Future<void> _editNote(ChecklistItem item) async {
    final ctl = TextEditingController(text: item.note ?? '');
    final saved = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Note'),
        content: TextField(
          controller: ctl,
          autofocus: true,
          maxLength: 255, // checklist_instance_items.note VARCHAR(255)
          maxLines: 3,
          decoration: const InputDecoration(hintText: 'What did you see?'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, ctl.text), child: const Text('Save')),
        ],
      ),
    );
    if (saved == null) return;
    if (await _svc.setNote(_c, item, saved) && mounted) setState(() {});
  }

  // ── Sign-offs ────────────────────────────────────────────────────────────

  Widget _signoffRow(Signoff s) => Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: Op.surface,
          borderRadius: BorderRadius.circular(Radii.md),
          border: Border.all(color: Op.border),
        ),
        child: Row(children: [
          Icon(s.hasSignature ? Icons.draw_outlined : Icons.person_outline,
              size: 18, color: Op.successText),
          const SizedBox(width: Spacing.sm),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(s.displayName,
                  style: const TextStyle(
                      color: Op.text, fontSize: 14, fontWeight: FontWeight.w600)),
              Text(
                  '${s.isVisitor ? 'Visitor · ' : ''}Signed ${DateFormat('h:mm a').format(s.signedAt)}',
                  style: const TextStyle(color: Op.muted, fontSize: 12)),
            ]),
          ),
          if (!_c.isFrozen)
            IconButton(
              tooltip: 'Remove',
              icon: const Icon(Icons.close, size: 18, color: Op.muted),
              onPressed: () async {
                if (await _svc.removeSignoff(_c, s) && mounted) {
                  setState(() {});
                }
              },
            ),
        ]),
      );

  Widget _addSignoffButton() => Padding(
        padding: const EdgeInsets.only(top: Spacing.xs),
        child: OutlinedButton.icon(
          onPressed: _addSignoff,
          icon: const Icon(Icons.draw_outlined, size: 18),
          label: Text(_c.category == ChecklistCategory.toolboxTalk
              ? 'Add attendee'
              : 'Add sign-off'),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(48),
            foregroundColor: Op.accent,
            side: const BorderSide(color: Op.border, width: 1.5),
          ),
        ),
      );

  Future<void> _addSignoff() async {
    final added = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Op.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.sheet))),
      builder: (ctx) => _SignoffSheet(instance: _c, projectId: widget.project.id),
    );
    if (added == true && mounted) setState(() {});
  }

  // ── Bottom bars ──────────────────────────────────────────────────────────

  Widget _completeBar() => SafeArea(
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          decoration: const BoxDecoration(
            color: Op.surface,
            border: Border(top: BorderSide(color: Op.border)),
          ),
          child: FilledButton.icon(
            onPressed: _complete,
            icon: const Icon(Icons.task_alt),
            label: const Text('Complete checklist'),
            style: FilledButton.styleFrom(
              backgroundColor: Op.accent,
              minimumSize: const Size.fromHeight(52),
              textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
          ),
        ),
      );

  Widget _correctionBar() => SafeArea(
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          decoration: const BoxDecoration(
            color: Op.surface,
            border: Border(top: BorderSide(color: Op.border)),
          ),
          child: OutlinedButton.icon(
            onPressed: _startCorrection,
            icon: const Icon(Icons.history),
            label: const Text('Start a correction'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(52),
              foregroundColor: Op.accent,
              side: const BorderSide(color: Op.accent, width: 1.5),
            ),
          ),
        ),
      );

  Future<void> _complete() async {
    final pending = _c.items
        .where((i) => i.result == ChecklistItemResult.pending)
        .length;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Complete this checklist?'),
        content: Text(
          'Once completed it is locked and can\'t be edited — a mistake is '
          'fixed by starting a correction.'
          '${pending > 0 ? '\n\n$pending optional item${pending == 1 ? '' : 's'} left unanswered.' : ''}',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true), child: const Text('Complete')),
        ],
      ),
    );
    if (ok != true) return;
    final res = await _svc.complete(_c);
    if (!mounted) return;
    if (res.success) {
      setState(() => _showBlockers = false);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Checklist locked — completing as it syncs.'),
          duration: Duration(seconds: 3)));
      return;
    }
    setState(() => _showBlockers = true);
    final n = res.blockers.length;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(res.code == 'CHECKLIST_INCOMPLETE'
          ? '$n item${n == 1 ? '' : 's'} still need${n == 1 ? 's' : ''} attention — highlighted in red.'
          : 'This checklist is already completed.'),
    ));
  }

  Future<void> _startCorrection() async {
    final inst = await _svc.startCorrection(_c);
    if (!mounted) return;
    await Navigator.pushReplacement(
      context,
      MaterialPageRoute(
          builder: (_) =>
              ChecklistRunScreen(project: widget.project, instance: inst)),
    );
  }
}

/// Sign a person on: pick a project member or type a visitor's name, then
/// sign. The signature is required, since the sign-off is the whole point of
/// the row.
class _SignoffSheet extends StatefulWidget {
  final ChecklistInstance instance;
  final String projectId;
  const _SignoffSheet({required this.instance, required this.projectId});

  @override
  State<_SignoffSheet> createState() => _SignoffSheetState();
}

class _SignoffSheetState extends State<_SignoffSheet> {
  final _pad = SignaturePadController();
  final _nameCtl = TextEditingController();
  List<TeamMember> _members = [];
  TeamMember? _member;
  bool _loadingMembers = true;

  @override
  void initState() {
    super.initState();
    _pad.addListener(() => setState(() {}));
    // A real call, read-only. Offline it just returns no members and the
    // typed-name path still works.
    QualityOpsService.instance.fetchProjectMembers(widget.projectId).then((m) {
      if (mounted) {
        setState(() {
          _members = m;
          _loadingMembers = false;
        });
      }
    });
  }

  @override
  void dispose() {
    _pad.dispose();
    _nameCtl.dispose();
    super.dispose();
  }

  String get _name => _member?.name ?? _nameCtl.text.trim();
  bool get _canSave => _name.isNotEmpty && !_pad.isEmpty;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
          20, 18, 20, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.instance.category.signoffHeading,
                style: const TextStyle(
                    color: Op.text, fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: Spacing.md),
            if (_loadingMembers)
              const LinearProgressIndicator(color: Op.accent)
            else if (_members.isNotEmpty)
              DropdownButtonFormField<String>(
                initialValue: _member?.userId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Team member'),
                items: [
                  for (final m in _members)
                    DropdownMenuItem(value: m.userId, child: Text(m.name)),
                ],
                onChanged: (id) => setState(() {
                  _member = _members.firstWhere((m) => m.userId == id);
                  _nameCtl.clear();
                }),
              ),
            const SizedBox(height: Spacing.sm),
            TextField(
              controller: _nameCtl,
              maxLength: 160, // signoffs.name VARCHAR(160)
              decoration: InputDecoration(
                labelText: _members.isEmpty
                    ? 'Name'
                    : 'Or a visitor / non-user — type their name',
              ),
              onChanged: (_) => setState(() => _member = null),
            ),
            const SizedBox(height: Spacing.sm),
            SignaturePad(controller: _pad),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                  onPressed: _pad.isEmpty ? null : _pad.clear,
                  child: const Text('Clear signature')),
            ),
            const SizedBox(height: Spacing.sm),
            FilledButton(
              onPressed: _canSave && !_saving ? _save : null,
              style: FilledButton.styleFrom(
                  backgroundColor: Op.accent,
                  minimumSize: const Size.fromHeight(52)),
              child: const Text('Save sign-off'),
            ),
          ],
        ),
      ),
    );
  }

  bool _saving = false;

  Future<void> _save() async {
    setState(() => _saving = true);
    final png = await _pad.toPng();
    final s = await ChecklistOpsService.instance.addSignoff(
      widget.instance,
      userId: _member?.userId,
      displayName: _name,
      signaturePng: png,
    );
    if (mounted) Navigator.pop(context, s != null);
  }
}
