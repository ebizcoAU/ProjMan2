import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import '../../config/app_theme.dart';
import '../../models/domain.dart';
import '../../services/induction_ops_service.dart';
import '../../services/quality_ops_service.dart';
import '../../widgets/signature_pad.dart';

/// Safety → Inductions (xprojman-48 F5/F6, server v048). Two sections:
/// - **My site status / Site inductions:** workers see their own induction;
///   a Site Supervisor or PM sees the register and inducts people.
/// - **SWMS sign-on:** read the project's SWMS and sign on, offline-capable.
/// A WHS site record only: no rosters or pay hours (Owner scope ruling).
class InductionsView extends StatefulWidget {
  final Project project;
  const InductionsView({super.key, required this.project});

  @override
  State<InductionsView> createState() => _InductionsViewState();
}

class _InductionsViewState extends State<InductionsView> {
  InductionOpsService get _svc => InductionOpsService.instance;
  String get _pid => widget.project.id;

  @override
  void initState() {
    super.initState();
    _svc.changes.addListener(_onChange);
    _svc.hydrateProject(_pid);
  }

  @override
  void didUpdateWidget(covariant InductionsView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.project.id != widget.project.id) _svc.hydrateProject(_pid);
  }

  @override
  void dispose() {
    _svc.changes.removeListener(_onChange);
    super.dispose();
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final inductions = _svc.inductions(_pid);
    final swms = _svc.swms(_pid);
    return Scaffold(
      backgroundColor: Op.bg,
      body: RefreshIndicator(
        onRefresh: () async {
          await _svc.refreshSwmsRegister(_pid);
          await _svc.sync(projectId: _pid);
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
          children: [
            _heading(_svc.canInduct ? 'Site inductions' : 'My site induction'),
            if (!_svc.canInduct) _myStatus(now),
            if (_svc.canInduct) ...[
              if (inductions.isEmpty)
                _muted('Nobody has been inducted on this site yet.'),
              for (final i in inductions) _inductionCard(i, now),
            ],
            const SizedBox(height: 20),
            _heading('SWMS sign-on'),
            if (swms.isEmpty)
              _muted('No SWMS on this project yet. They are added in the Portal.'),
            for (final d in swms) _swmsCard(d),
          ],
        ),
      ),
      floatingActionButton: _svc.canInduct
          ? FloatingActionButton.extended(
              backgroundColor: Op.accent,
              onPressed: _induct,
              icon: const Icon(Icons.person_add_alt_1_outlined),
              label: const Text('Induct someone'),
            )
          : null,
    );
  }

  Widget _heading(String t) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(t, style: const TextStyle(color: Op.text, fontSize: 15, fontWeight: FontWeight.w800)),
      );

  Widget _muted(String t) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Text(t, style: const TextStyle(color: Op.muted, fontSize: 13)),
      );

  Widget _myStatus(DateTime now) {
    final mine = _svc.myInduction(_pid);
    if (mine == null) {
      return _statusBox(Op.warning, Op.warningText, Icons.info_outline,
          'You haven\'t been inducted on this site. See the Site Supervisor before starting work.');
    }
    return switch (mine.statusAt(now)) {
      InductionStatus.expired => _statusBox(Op.danger, Op.dangerText, Icons.error_outline,
          'Your induction expired on ${_fmtDate(mine.expiresAt!)}. See the Site Supervisor.'),
      InductionStatus.expiringSoon => _statusBox(Op.warning, Op.warningText, Icons.schedule,
          'Inducted. Expires on ${_fmtDate(mine.expiresAt!)}.'),
      InductionStatus.valid => _statusBox(Op.success, Op.successText, Icons.verified_outlined,
          mine.expiresAt == null
              ? 'Inducted on ${_fmtDate(mine.inductedAt)}.'
              : 'Inducted until ${_fmtDate(mine.expiresAt!)}.'),
    };
  }

  Widget _statusBox(Color fill, Color ink, IconData icon, String text) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
            color: fill.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
        child: Row(children: [
          Icon(icon, color: ink, size: 20),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: TextStyle(color: ink, fontSize: 13.5, fontWeight: FontWeight.w600))),
        ]),
      );

  Widget _inductionCard(SiteInduction i, DateTime now) {
    final (ink, label) = switch (i.statusAt(now)) {
      InductionStatus.valid => (Op.successText, i.expiresAt == null ? 'No expiry' : 'Until ${_fmtDate(i.expiresAt!)}'),
      InductionStatus.expiringSoon => (Op.warningText, 'Expires ${_fmtDate(i.expiresAt!)}'),
      InductionStatus.expired => (Op.dangerText, 'Expired ${_fmtDate(i.expiresAt!)}'),
    };
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Op.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Op.border),
      ),
      child: Row(children: [
        Icon(i.isVisitor ? Icons.badge_outlined : Icons.person_outline, color: Op.muted),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(i.name, style: const TextStyle(color: Op.text, fontSize: 14.5, fontWeight: FontWeight.w700)),
            Text(
                [
                  if (i.isVisitor) 'Visitor',
                  'Inducted ${_fmtDate(i.inductedAt)}',
                  if (i.signoff == null) 'not signed',
                  if (i.syncError != null) 'not saved (${i.syncError})',
                ].join(' · '),
                style: const TextStyle(color: Op.muted, fontSize: 12)),
          ]),
        ),
        if (!i.isSynced && i.syncError == null)
          const Padding(
            padding: EdgeInsets.only(right: 6),
            child: Icon(Icons.cloud_upload_outlined, size: 16, color: Op.warning),
          ),
        Text(label, style: TextStyle(color: ink, fontSize: 12, fontWeight: FontWeight.w700)),
      ]),
    );
  }

  Widget _swmsCard(SwmsDocument d) {
    final signed = d.mine != null;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Op.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Op.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.description_outlined, color: Op.muted),
          const SizedBox(width: 10),
          Expanded(
            child: Text(d.title,
                style: const TextStyle(color: Op.text, fontSize: 14.5, fontWeight: FontWeight.w700)),
          ),
        ]),
        const SizedBox(height: 4),
        Text(
            [
              if (signed) 'You signed on ${_fmtDate(d.mine!.signedAt)}' else 'Not signed by you',
              if (_svc.canInduct) '${d.signoffs.length} signed on',
              if (d.localPath != null) 'saved on this phone',
            ].join(' · '),
            style: TextStyle(color: signed ? Op.successText : Op.muted, fontSize: 12)),
        const SizedBox(height: 8),
        Row(children: [
          OutlinedButton.icon(
            onPressed: () => _openSwms(d),
            icon: const Icon(Icons.open_in_new, size: 16),
            label: const Text('Read'),
          ),
          const SizedBox(width: 8),
          if (!signed && _svc.canSignSwms)
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Op.accent),
              onPressed: () => _signSwms(d),
              child: const Text('Sign on'),
            ),
        ]),
      ]),
    );
  }

  Future<void> _openSwms(SwmsDocument d) async {
    final messenger = ScaffoldMessenger.of(context);
    final file = await _svc.swmsFile(d);
    if (file == null) {
      messenger.showSnackBar(const SnackBar(
          content: Text('Couldn\'t open this SWMS. Connect once to save it to the phone.')));
      return;
    }
    await Share.shareXFiles([XFile(file.path, mimeType: d.mimeType)], subject: d.title);
  }

  Future<void> _signSwms(SwmsDocument d) async {
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Op.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (_) => _SignSheet(
        title: 'Sign on: ${d.title}',
        statement: 'I have read and understood this SWMS, and I will follow it. '
            'If the work or conditions change, I will stop and tell my supervisor.',
        onSave: (png) => _svc.signSwms(d, signaturePng: png),
      ),
    );
    if (ok == true && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Signed on. It will send when there\'s signal.')));
    }
  }

  Future<void> _induct() => showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Op.surface,
        shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
        builder: (_) => _InductSheet(projectId: _pid),
      );
}

String _fmtDate(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year}';
}

/// Signature-only sheet for the signer themselves (SWMS sign-on).
class _SignSheet extends StatefulWidget {
  final String title;
  final String statement;
  final Future<String?> Function(Uint8List? png) onSave;
  const _SignSheet({required this.title, required this.statement, required this.onSave});

  @override
  State<_SignSheet> createState() => _SignSheetState();
}

class _SignSheetState extends State<_SignSheet> {
  final _pad = SignaturePadController();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _pad.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _pad.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(20, 18, 20, 16 + MediaQuery.of(context).viewInsets.bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.title,
                style: const TextStyle(color: Op.text, fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            Text(widget.statement, style: const TextStyle(color: Op.text, fontSize: 13.5)),
            const SizedBox(height: 12),
            SignaturePad(controller: _pad),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                  onPressed: _pad.isEmpty ? null : _pad.clear, child: const Text('Clear signature')),
            ),
            FilledButton(
              onPressed: _pad.isEmpty || _saving ? null : _save,
              style: FilledButton.styleFrom(
                  backgroundColor: Op.accent, minimumSize: const Size.fromHeight(52)),
              child: const Text('Sign'),
            ),
          ],
        ),
      );

  Future<void> _save() async {
    setState(() => _saving = true);
    final code = await widget.onSave(await _pad.toPng());
    if (mounted) Navigator.pop(context, code == null);
  }
}

/// A manager inducts a team member or a visitor; the inductee signs.
class _InductSheet extends StatefulWidget {
  final String projectId;
  const _InductSheet({required this.projectId});

  @override
  State<_InductSheet> createState() => _InductSheetState();
}

class _InductSheetState extends State<_InductSheet> {
  final _pad = SignaturePadController();
  final _nameCtl = TextEditingController();
  List<TeamMember> _members = [];
  TeamMember? _member;
  bool _loadingMembers = true;
  int? _months; // null = no expiry
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _pad.addListener(() => setState(() {}));
    // Offline this returns no members and the typed-name path still works.
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
  bool get _canSave => _name.isNotEmpty && !_pad.isEmpty && !_saving;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(20, 18, 20, 16 + MediaQuery.of(context).viewInsets.bottom),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Site induction',
                  style: TextStyle(color: Op.text, fontSize: 17, fontWeight: FontWeight.w800)),
              const SizedBox(height: 12),
              if (_loadingMembers)
                const LinearProgressIndicator(color: Op.accent)
              else if (_members.isNotEmpty)
                DropdownButtonFormField<String>(
                  initialValue: _member?.userId,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Team member'),
                  items: [
                    for (final m in _members) DropdownMenuItem(value: m.userId, child: Text(m.name)),
                  ],
                  onChanged: (id) => setState(() {
                    _member = _members.firstWhere((m) => m.userId == id);
                    _nameCtl.clear();
                  }),
                ),
              const SizedBox(height: 8),
              TextField(
                controller: _nameCtl,
                maxLength: 160, // site_inductions.name VARCHAR(160)
                decoration: InputDecoration(
                    labelText: _members.isEmpty ? 'Name' : 'Or a visitor: type their name'),
                onChanged: (_) => setState(() => _member = null),
              ),
              const Text('Valid for', style: TextStyle(color: Op.muted, fontSize: 12.5)),
              const SizedBox(height: 6),
              SegmentedButton<int?>(
                segments: const [
                  ButtonSegment(value: null, label: Text('No expiry')),
                  ButtonSegment(value: 6, label: Text('6 months')),
                  ButtonSegment(value: 12, label: Text('12 months')),
                ],
                selected: {_months},
                onSelectionChanged: (s) => setState(() => _months = s.first),
              ),
              const SizedBox(height: 14),
              Text('${_name.isEmpty ? 'The inductee' : _name} signs to confirm they received '
                  'the site induction.',
                  style: const TextStyle(color: Op.text, fontSize: 13)),
              const SizedBox(height: 8),
              SignaturePad(controller: _pad),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                    onPressed: _pad.isEmpty ? null : _pad.clear, child: const Text('Clear signature')),
              ),
              FilledButton(
                onPressed: _canSave ? _save : null,
                style: FilledButton.styleFrom(
                    backgroundColor: Op.accent, minimumSize: const Size.fromHeight(52)),
                child: const Text('Save induction'),
              ),
            ],
          ),
        ),
      );

  Future<void> _save() async {
    setState(() => _saving = true);
    final now = DateTime.now();
    final code = await InductionOpsService.instance.induct(
      projectId: widget.projectId,
      userId: _member?.userId,
      name: _name,
      expiresAt: _months == null ? null : DateTime(now.year, now.month + _months!, now.day),
      signaturePng: await _pad.toPng(),
    );
    if (!mounted) return;
    if (code != null) {
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Couldn\'t save ($code).')));
      return;
    }
    Navigator.pop(context);
  }
}
