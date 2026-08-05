import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../config/app_theme.dart';
import '../../models/domain.dart';
import '../../services/site_ops_service.dart';
import '../../widgets/photo_capture.dart';

/// Site Diary (appspec §5.3) — the app's most important screen. Single-purpose,
/// linear in the order a supervisor thinks: **work done → delays → proof**. Auto
/// date + headcount (from attendance); weather is app-cached/manual and **never
/// blocks**. Draft is freely editable; **Finalise** makes it the legal record —
/// append-only on the wire (a finalised day is corrected by a new version, not an
/// edit; §11.4). Voice capture is disabled until later in P5 (appspec Decision 5).
class SiteDiaryView extends StatefulWidget {
  final Project project;
  const SiteDiaryView({super.key, required this.project});

  @override
  State<SiteDiaryView> createState() => _SiteDiaryViewState();
}

class _SiteDiaryViewState extends State<SiteDiaryView> {
  SiteOpsService get _svc => SiteOpsService.instance;
  String get _pid => widget.project.id;

  late DiaryEntry _entry;
  final _lineCtrl = TextEditingController();
  final _delaysCtrl = TextEditingController();
  final _weatherCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _entry = _svc.todayDraft(_pid); // optimistic empty draft, replaced after hydrate
    _delaysCtrl.text = _entry.delays;
    _weatherCtrl.text = _entry.weather ?? '';
    _hydrate();
  }

  @override
  void didUpdateWidget(covariant SiteDiaryView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.project.id != widget.project.id) _hydrate();
  }

  Future<void> _hydrate() async {
    await _svc.hydrateProject(_pid);
    if (!mounted) return;
    setState(() {
      _entry = _svc.todayDraft(_pid);
      _entry.headcount = _svc.onSite(_pid);
      _delaysCtrl.text = _entry.delays;
      _weatherCtrl.text = _entry.weather ?? '';
    });
  }

  @override
  void dispose() {
    _lineCtrl.dispose();
    _delaysCtrl.dispose();
    _weatherCtrl.dispose();
    super.dispose();
  }

  bool get _readOnly => _entry.isFinal;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            children: [
              _metaRow(),
              const SizedBox(height: 16),
              if (_entry.isFinal) _finalBanner(),
              _sectionLabel('Work done today'),
              // Was silent when empty — on a finalised day with nothing
              // logged, the section rendered as just a label and a gap, no
              // indication that's the actual (correct) state (audit C3).
              if (_entry.workDone.isEmpty) _emptyLineHint(),
              ..._entry.workDone.asMap().entries.map(_workLine),
              if (!_readOnly) _addLineField(),
              const SizedBox(height: 20),
              _sectionLabel('Delays / disruptions'),
              _multiline(_delaysCtrl, 'None',
                  onChanged: (v) => _entry.delays = v),
              const SizedBox(height: 20),
              _sectionLabel('Photos (${_entry.photoIds.length})'),
              _photoStrip(),
            ],
          ),
        ),
        _actionBar(),
      ],
    );
  }

  Widget _metaRow() {
    final d = _entry.date;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Op.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Op.border),
      ),
      child: Row(
        children: [
          _meta(Icons.event, _fmtDate(d)),
          const SizedBox(width: 16),
          Expanded(
            child: TextField(
              controller: _weatherCtrl,
              enabled: !_readOnly,
              onChanged: (v) => _entry.weather = v,
              style: const TextStyle(color: Op.text, fontSize: 13),
              decoration: const InputDecoration(
                isDense: true,
                prefixIcon: Icon(Icons.wb_sunny_outlined,
                    size: 18, color: Op.warning),
                prefixIconConstraints:
                    BoxConstraints(minWidth: 28, minHeight: 0),
                hintText: 'Weather (cached)',
                hintStyle: TextStyle(color: Op.muted, fontSize: 13),
                border: InputBorder.none,
              ),
            ),
          ),
          _meta(Icons.groups_outlined, '${_entry.headcount} on site'),
        ],
      ),
    );
  }

  Widget _meta(IconData i, String s) => Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(i, size: 16, color: Op.muted),
        const SizedBox(width: 4),
        Text(s, style: const TextStyle(color: Op.muted, fontSize: 13)),
      ]);

  Widget _finalBanner() => Container(
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
            color: Op.success.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(10)),
        child: Row(children: const [
          Icon(Icons.lock, size: 16, color: Op.successText),
          SizedBox(width: 8),
          Expanded(
            child: Text('Finalised — the legal record for today. Corrections '
                'create a new version.',
                style: TextStyle(color: Op.successText, fontSize: 12.5)),
          ),
        ]),
      );

  Widget _emptyLineHint() => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(
            _readOnly
                ? 'Nothing was recorded for this day.'
                : 'Nothing added yet — log what the crew got done below.',
            style: const TextStyle(
                color: Op.muted, fontSize: 13, fontStyle: FontStyle.italic)),
      );

  Widget _sectionLabel(String s) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(s,
            style: const TextStyle(
                color: Op.text, fontSize: 14, fontWeight: FontWeight.w700)),
      );

  Widget _workLine(MapEntry<int, String> e) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(children: [
          const Padding(
            padding: EdgeInsets.only(top: 2, right: 8),
            child: Icon(Icons.check, size: 16, color: Op.successText),
          ),
          Expanded(
              child: Text(e.value,
                  style: const TextStyle(color: Op.text, fontSize: 14.5))),
          if (!_readOnly)
            // Was a bare InkWell around a 16px icon — under the 48dp target
            // (audit finding B4). IconButton gets the Material minimum for free.
            IconButton(
              iconSize: 16,
              color: Op.muted,
              onPressed: () {
                HapticFeedback.selectionClick();
                setState(() => _entry.workDone.removeAt(e.key));
              },
              icon: const Icon(Icons.close),
            ),
        ]),
      );

  Widget _addLineField() => Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Row(children: [
          Expanded(
            child: TextField(
              controller: _lineCtrl,
              style: const TextStyle(color: Op.text),
              onSubmitted: (_) => _addLine(),
              decoration: InputDecoration(
                isDense: true,
                hintText: 'e.g. Framing complete, level 2',
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
            onPressed: _addLine,
            icon: const Icon(Icons.add_circle, color: Op.accent),
          ),
        ]),
      );

  void _addLine() {
    final t = _lineCtrl.text.trim();
    if (t.isEmpty) return;
    setState(() {
      _entry.workDone.add(t);
      _lineCtrl.clear();
    });
  }

  Widget _multiline(TextEditingController c, String hint,
          {required ValueChanged<String> onChanged}) =>
      TextField(
        controller: c,
        enabled: !_readOnly,
        minLines: 2,
        maxLines: 4,
        onChanged: onChanged,
        style: const TextStyle(color: Op.text),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: const TextStyle(color: Op.muted),
          filled: true,
          fillColor: Op.surface,
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: Op.border)),
          enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: Op.border)),
        ),
      );

  Widget _photoStrip() => Row(children: [
        for (final id in _entry.photoIds)
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: PhotoThumb(idOrRef: id, size: 56),
          ),
        if (!_readOnly)
          InkWell(
            onTap: _addPhoto,
            borderRadius: BorderRadius.circular(8),
            child: Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Op.accent),
              ),
              child: const Icon(Icons.add_a_photo_outlined, color: Op.accent),
            ),
          ),
      ]);

  // Photo capture rides the one offline image queue (xprojman-22): capture →
  // enqueue against this diary version's id → cache the client_ref in
  // `photo_ids`; upload flushes when there's signal. The diary row need not be
  // saved first — the document links by id, order-free (xprojman-21 §P1).
  Future<void> _addPhoto() async {
    final ref = await captureAndEnqueue(context,
        entityType: 'site_diary', entityId: _entry.id, projectId: _pid);
    if (ref != null && mounted) setState(() => _entry.photoIds.add(ref));
  }

  Widget _actionBar() {
    if (_entry.isFinal) {
      return _bar([
        Expanded(
          child: OutlinedButton.icon(
            onPressed: _newVersion,
            icon: const Icon(Icons.edit_note, size: 18),
            style: OutlinedButton.styleFrom(foregroundColor: Op.accent),
            label: const Text('Correct (new version)'),
          ),
        ),
      ]);
    }
    return _bar([
      OutlinedButton(
        onPressed: _saveDraft,
        style: OutlinedButton.styleFrom(
            foregroundColor: Op.text, side: const BorderSide(color: Op.border)),
        child: const Text('Save draft'),
      ),
      const SizedBox(width: 10),
      Expanded(
        child: FilledButton(
          onPressed: _finalise,
          style: FilledButton.styleFrom(backgroundColor: Op.accent),
          child: const Text('Finalise diary'),
        ),
      ),
    ]);
  }
  // Voice entry mic button removed — it was a permanently disabled icon
  // with no way to discover "coming soon" beyond a tooltip mobile users
  // rarely trigger (audit finding E2). Voice is still coming in P5
  // (Decision 5); re-add the button when it actually does something.

  Widget _bar(List<Widget> children) => Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 20),
        decoration: const BoxDecoration(
          color: Op.surface,
          border: Border(top: BorderSide(color: Op.border)),
        ),
        child: Row(children: children),
      );

  Future<void> _saveDraft() async {
    await _svc.saveDraft(_pid, _entry);
    if (!mounted) return;
    setState(() {}); // pick up any server-reconciled fields
    _toast('Draft saved');
  }

  Future<void> _finalise() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Op.surface,
        title: const Text('Finalise today’s diary?',
            style: TextStyle(color: Op.text)),
        content: const Text(
            'This becomes the legal record for today. You can still add a '
            'correction later, but it will be kept as a new version.',
            style: TextStyle(color: Op.muted)),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Op.accent),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Finalise')),
        ],
      ),
    );
    if (ok == true) {
      HapticFeedback.mediumImpact(); // sign-off — a critical, one-way action
      await _svc.finalise(_pid, _entry);
      if (!mounted) return;
      setState(() {});
      _toast('Diary finalised');
    }
  }

  Future<void> _newVersion() async {
    // A finalised day is corrected by a fresh draft — a NEW row, version+1,
    // supersedes_id pointing at the final one (§11.4; server enforces
    // 409 DIARY_FINAL on any attempt to edit the old row directly).
    final next = DiaryEntry(
      headcount: _svc.onSite(_pid),
      workDone: List.of(_entry.workDone),
      delays: _entry.delays,
      weather: _entry.weather,
      version: _entry.version + 1,
      supersedesId: _entry.id,
    );
    await _svc.saveDraft(_pid, next);
    if (!mounted) return;
    setState(() {
      _entry = next;
      _delaysCtrl.text = _entry.delays;
      _weatherCtrl.text = _entry.weather ?? '';
    });
  }

  void _toast(String m) => ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(content: Text(m), duration: const Duration(seconds: 1)));

  static String _fmtDate(DateTime d) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    return '${days[d.weekday - 1]} ${d.day} ${months[d.month - 1]} ${d.year}';
  }
}
