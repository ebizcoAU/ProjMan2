import 'package:flutter/material.dart';
import '../../config/app_theme.dart';
import '../../services/client_signoff_service.dart';
import '../../widgets/signature_pad.dart';

/// S18.14 client final sign-off, the PM's view (xprojman-51). **Design
/// mockup**: see [ClientSignoffService]. Shows the handover pack and its
/// reference, the sign-off history, and the three ways a client can sign.
/// No method is preselected: which one is used is still with the solicitor
/// (F1, devroadmap §13 L2).
class ClientSignoffScreen extends StatefulWidget {
  final String projectId;
  final String projectName;
  const ClientSignoffScreen({super.key, required this.projectId, required this.projectName});

  @override
  State<ClientSignoffScreen> createState() => _ClientSignoffScreenState();
}

class _ClientSignoffScreenState extends State<ClientSignoffScreen> {
  ClientSignoffService get _svc => ClientSignoffService.instance;
  SignoffMethod? _method;

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

  @override
  Widget build(BuildContext context) {
    final pack = _svc.packFor(widget.projectId);
    final current = _svc.current(widget.projectId);
    final stale = _svc.staleSignoff(widget.projectId);
    final history = _svc.signoffs(widget.projectId);
    return Scaffold(
      backgroundColor: Op.bg,
      appBar: AppBar(title: const Text('Client final sign-off')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: [
          _mockBanner(),
          const SizedBox(height: 12),
          if (pack == null)
            _box(Op.warning, Op.warningText, Icons.lock_outline,
                'Available once the Occupation Certificate (S18.3) is validated.')
          else ...[
            _status(current, stale),
            const SizedBox(height: 16),
            _packCard(pack),
            const SizedBox(height: 16),
            _methods(pack),
          ],
          if (history.isNotEmpty) ...[
            const SizedBox(height: 20),
            const Text('History',
                style: TextStyle(color: Op.text, fontSize: 15, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            for (final s in history) _historyRow(s, pack),
          ],
        ],
      ),
    );
  }

  Widget _mockBanner() => Container(
        margin: const EdgeInsets.only(top: 12),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
            color: Op.warning.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
        child: Row(children: [
          const Icon(Icons.design_services_outlined, size: 16, color: Op.warningText),
          const SizedBox(width: 8),
          const Expanded(
            child: Text('Design mockup with sample documents. Nothing is saved to the server yet.',
                style: TextStyle(color: Op.warningText, fontSize: 12, fontWeight: FontWeight.w600)),
          ),
          TextButton(
            onPressed: () => _svc.mockChangePack(widget.projectId),
            child: const Text('Simulate pack change', style: TextStyle(fontSize: 12)),
          ),
        ]),
      );

  Widget _box(Color fill, Color ink, IconData icon, String text) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
            color: fill.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
        child: Row(children: [
          Icon(icon, color: ink, size: 20),
          const SizedBox(width: 10),
          Expanded(
              child: Text(text,
                  style: TextStyle(color: ink, fontSize: 13.5, fontWeight: FontWeight.w600))),
        ]),
      );

  Widget _status(ClientSignoff? current, ClientSignoff? stale) {
    if (current != null) {
      return _box(Op.success, Op.successText, Icons.verified_outlined,
          'Accepted by ${current.signerName} on ${_fmtDt(current.signedAt)} '
          '(pack ${current.shortHash}).');
    }
    if (stale != null) {
      return _box(Op.danger, Op.dangerText, Icons.sync_problem,
          'The handover pack changed after ${stale.signerName} signed (pack ${stale.shortHash}). '
          'The client needs to review the new pack and sign again.');
    }
    final history = _svc.signoffs(widget.projectId);
    if (history.isNotEmpty && history.first.decision == SignoffDecision.declined) {
      return _box(Op.warning, Op.warningText, Icons.report_outlined,
          'Declined by ${history.first.signerName}. Fix the issues, then ask the client to sign again.');
    }
    return _box(Op.accent, Op.accent, Icons.info_outline, 'Not signed yet.');
  }

  Widget _packCard(HandoverPack pack) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Op.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Op.border),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Expanded(
              child: Text('Handover pack',
                  style: TextStyle(color: Op.text, fontSize: 15, fontWeight: FontWeight.w800)),
            ),
            _PackRef(pack.shortHash),
          ]),
          const SizedBox(height: 4),
          Text('${pack.documentCount} documents',
              style: const TextStyle(color: Op.muted, fontSize: 12.5)),
          const SizedBox(height: 8),
          for (final d in pack.manifest) _docRow(d),
          const SizedBox(height: 6),
          SelectableText('Full reference: ${pack.packHash}',
              style: const TextStyle(color: Op.muted, fontSize: 10.5, fontFamily: 'monospace')),
        ]),
      );

  Widget _methods(HandoverPack pack) {
    final witness = _svc.canWitness;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('How will the client sign?',
          style: TextStyle(color: Op.text, fontSize: 15, fontWeight: FontWeight.w800)),
      const SizedBox(height: 4),
      const Text('Which method to use is still being confirmed legally, so none is set as the default.',
          style: TextStyle(color: Op.muted, fontSize: 12.5)),
      const SizedBox(height: 8),
      _methodTile(SignoffMethod.assistedDevice,
          'You hand this device to the client. They read the pack and sign; you are the witness.',
          enabled: witness),
      _methodTile(SignoffMethod.paperUpload,
          'Print the sign-off form from the Portal. The client signs it, and you upload the scan '
          'in the Portal with the pack reference ${pack.shortHash}.'),
      _methodTile(SignoffMethod.clientSelf,
          'The client signs in their own ProjMan app. Available once client accounts are live.',
          enabled: false),
      const SizedBox(height: 10),
      if (_method == SignoffMethod.assistedDevice)
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            style: FilledButton.styleFrom(
                backgroundColor: Op.accent, minimumSize: const Size.fromHeight(52)),
            onPressed: () => _handOver(pack),
            icon: const Icon(Icons.tablet_android_outlined),
            label: const Text('Hand the device to the client'),
          ),
        )
      else if (_method == SignoffMethod.paperUpload)
        _box(Op.accent, Op.accent, Icons.print_outlined,
            'Finish this one in the Portal: print the form, then upload the signed scan. '
            'The reference on the form must be ${pack.shortHash}.'),
      if (!witness)
        const Padding(
          padding: EdgeInsets.only(top: 8),
          child: Text('Only the project manager can witness a sign-off on a device.',
              style: TextStyle(color: Op.muted, fontSize: 12)),
        ),
    ]);
  }

  Widget _methodTile(SignoffMethod m, String detail, {bool enabled = true}) {
    final selected = _method == m;
    return Opacity(
      opacity: enabled ? 1 : 0.5,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: Op.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: selected ? Op.accent : Op.border, width: selected ? 1.5 : 1),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: enabled ? () => setState(() => _method = m) : null,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(selected ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                  color: selected ? Op.accent : Op.muted, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(m.label,
                      style: const TextStyle(color: Op.text, fontSize: 14, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(detail, style: const TextStyle(color: Op.muted, fontSize: 12.5)),
                ]),
              ),
            ]),
          ),
        ),
      ),
    );
  }

  Widget _historyRow(ClientSignoff s, HandoverPack? pack) {
    final accepted = s.decision == SignoffDecision.accepted;
    final onCurrentPack = s.packHash == pack?.packHash;
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
          Icon(accepted ? Icons.check_circle_outline : Icons.cancel_outlined,
              size: 18, color: accepted ? Op.successText : Op.dangerText),
          const SizedBox(width: 8),
          Expanded(
            child: Text('${accepted ? 'Accepted' : 'Declined'} by ${s.signerName}',
                style: const TextStyle(color: Op.text, fontSize: 13.5, fontWeight: FontWeight.w700)),
          ),
          _PackRef(s.shortHash, faded: !onCurrentPack),
        ]),
        const SizedBox(height: 4),
        Text(
            [
              _fmtDt(s.signedAt),
              s.method.label,
              if (!onCurrentPack) 'older pack',
              'waiting to send',
            ].join(' · '),
            style: const TextStyle(color: Op.muted, fontSize: 12)),
        if (s.declineReasons != null) ...[
          const SizedBox(height: 4),
          Text('Reasons: ${s.declineReasons}', style: const TextStyle(color: Op.text, fontSize: 12.5)),
        ],
      ]),
    );
  }

  Future<void> _handOver(HandoverPack pack) async {
    final done = await Navigator.of(context).push<bool>(MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => ClientHandoverScreen(
        projectId: widget.projectId,
        projectName: widget.projectName,
        pack: pack,
      ),
    ));
    if (done == true && mounted) setState(() => _method = null);
  }
}

Widget _docRow(PackDocument d) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Icon(Icons.description_outlined, size: 18, color: Op.muted),
        const SizedBox(width: 8),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(d.kindLabel,
                style: const TextStyle(color: Op.text, fontSize: 13.5, fontWeight: FontWeight.w600)),
            Text(d.fileName, style: const TextStyle(color: Op.muted, fontSize: 12)),
          ]),
        ),
      ]),
    );

class _PackRef extends StatelessWidget {
  final String short;
  final bool faded;
  const _PackRef(this.short, {this.faded = false});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: (faded ? Op.muted : Op.accent).withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(short,
            style: TextStyle(
                color: faded ? Op.muted : Op.accent,
                fontSize: 13,
                fontWeight: FontWeight.w800,
                fontFamily: 'monospace',
                letterSpacing: 1.2)),
      );
}

String _fmtDt(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
}

/// The screen the client holds. They see every document in the pack and the
/// pack reference **before** they choose and sign. Wording is a draft for
/// the solicitor (devroadmap §13 L2).
class ClientHandoverScreen extends StatefulWidget {
  final String projectId;
  final String projectName;
  final HandoverPack pack;
  const ClientHandoverScreen(
      {super.key, required this.projectId, required this.projectName, required this.pack});

  @override
  State<ClientHandoverScreen> createState() => _ClientHandoverScreenState();
}

class _ClientHandoverScreenState extends State<ClientHandoverScreen> {
  final _pad = SignaturePadController();
  final _name = TextEditingController();
  final _reasons = TextEditingController();
  SignoffDecision? _decision;
  bool _saving = false;
  bool _done = false;

  @override
  void initState() {
    super.initState();
    _pad.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _pad.dispose();
    _name.dispose();
    _reasons.dispose();
    super.dispose();
  }

  String get _statement => switch (_decision) {
        SignoffDecision.accepted =>
          'I confirm I have been given the handover documents listed above '
              '(pack reference ${widget.pack.shortHash}), and I accept the completed work.',
        SignoffDecision.declined =>
          'I confirm I have been shown the handover documents listed above '
              '(pack reference ${widget.pack.shortHash}). I do not accept the completed work yet, '
              'for the reasons below.',
        null => 'Choose whether you accept the completed work.',
      };

  bool get _canSign =>
      !_saving &&
      validateSignoff(
            decision: _decision,
            declineReasons: _reasons.text,
            signerName: _name.text,
            hasSignature: !_pad.isEmpty,
          ) ==
          null;

  @override
  Widget build(BuildContext context) {
    if (_done) return _thanks();
    final pack = widget.pack;
    return Scaffold(
      backgroundColor: Op.bg,
      appBar: AppBar(title: const Text('Final handover sign-off')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        children: [
          Text(widget.projectName,
              style: const TextStyle(color: Op.text, fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          const Text('Please read the list of documents you are receiving before you sign.',
              style: TextStyle(color: Op.muted, fontSize: 13.5)),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Op.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Op.border),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(
                  child: Text('Your handover pack (${pack.documentCount} documents)',
                      style: const TextStyle(color: Op.text, fontSize: 14.5, fontWeight: FontWeight.w800)),
                ),
              ]),
              const SizedBox(height: 6),
              for (final d in pack.manifest) _docRow(d),
              const Divider(height: 20),
              const Text('Pack reference', style: TextStyle(color: Op.muted, fontSize: 12)),
              const SizedBox(height: 4),
              _PackRef(pack.shortHash),
              const SizedBox(height: 6),
              SelectableText(pack.packHash,
                  style: const TextStyle(color: Op.muted, fontSize: 10.5, fontFamily: 'monospace')),
              const SizedBox(height: 4),
              const Text(
                  'This reference identifies exactly these documents. If any document changes, '
                  'the reference changes and you will be asked to sign again.',
                  style: TextStyle(color: Op.muted, fontSize: 12)),
            ]),
          ),
          const SizedBox(height: 18),
          const Text('Your decision',
              style: TextStyle(color: Op.text, fontSize: 15, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          SegmentedButton<SignoffDecision>(
            emptySelectionAllowed: true,
            segments: const [
              ButtonSegment(value: SignoffDecision.accepted, label: Text('I accept')),
              ButtonSegment(value: SignoffDecision.declined, label: Text('I don\'t accept yet')),
            ],
            selected: {?_decision},
            onSelectionChanged: (s) => setState(() => _decision = s.isEmpty ? null : s.first),
          ),
          if (_decision == SignoffDecision.declined) ...[
            const SizedBox(height: 12),
            TextField(
              controller: _reasons,
              maxLines: 4,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                labelText: 'What needs fixing? (required)',
                filled: true,
                fillColor: Op.surface,
              ),
            ),
          ],
          const SizedBox(height: 14),
          Text(_statement, style: const TextStyle(color: Op.text, fontSize: 13.5)),
          const SizedBox(height: 14),
          TextField(
            controller: _name,
            maxLength: 120, // client_signoffs.signer_name VARCHAR(120)
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
                labelText: 'Your full name', filled: true, fillColor: Op.surface),
          ),
          SignaturePad(controller: _pad),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
                onPressed: _pad.isEmpty ? null : _pad.clear, child: const Text('Clear signature')),
          ),
          FilledButton(
            onPressed: _canSign ? _sign : null,
            style: FilledButton.styleFrom(
                backgroundColor: Op.accent, minimumSize: const Size.fromHeight(56)),
            child: const Text('Sign', style: TextStyle(fontSize: 16)),
          ),
        ],
      ),
    );
  }

  Widget _thanks() => Scaffold(
        backgroundColor: Op.bg,
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              const Icon(Icons.check_circle_outline, color: Op.success, size: 72),
              const SizedBox(height: 16),
              const Text('Thank you. Your sign-off is recorded.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Op.text, fontSize: 18, fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              const Text('Please hand the device back to your project manager.',
                  textAlign: TextAlign.center, style: TextStyle(color: Op.muted, fontSize: 14)),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('Done'),
              ),
            ]),
          ),
        ),
      );

  Future<void> _sign() async {
    setState(() => _saving = true);
    final code = await ClientSignoffService.instance.recordAssisted(
      projectId: widget.projectId,
      pack: widget.pack,
      decision: _decision,
      declineReasons: _reasons.text,
      signerName: _name.text,
      signaturePng: await _pad.toPng(),
    );
    if (!mounted) return;
    if (code != null) {
      setState(() => _saving = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Couldn\'t record the sign-off ($code).')));
      return;
    }
    setState(() => _done = true);
  }
}
