import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../../services/nexus_service.dart';
import '../../services/permissions_service.dart';
import '../../widgets/auth_scaffold.dart';
import '../../widgets/auth_extras.dart';
import '../../widgets/onboarding_fields.dart';

/// Primary side of device pairing (projman-01 §1.3): pick a role → show a QR →
/// poll `/pairing/pending` → confirm the joining device with that role. Intra-org
/// (buildable now — projman-02 §9). Reached from Profile → "Pair a device".
class PairDeviceScreen extends StatefulWidget {
  const PairDeviceScreen({super.key});

  @override
  State<PairDeviceScreen> createState() => _PairDeviceScreenState();
}

/// Fallback shown only if `GET /auth/permissions` hasn't returned yet (e.g. no
/// network on first open) — never the source of truth. The real list is
/// [PermissionsService.pairableRoles] (projman-05 §6.3/§10.1 item 2); the
/// server, not the app, decides which roles are device-pairable.
const _fallbackRoles = <RoleOption>[
  RoleOption(role: 'projectManager', label: 'Project Manager'),
  RoleOption(role: 'siteSupervisor', label: 'Site Manager'),
  RoleOption(role: 'foreperson', label: 'Foreman'),
  RoleOption(role: 'tradie', label: 'Tradie'),
  RoleOption(role: 'inspector', label: 'Inspector'),
];

enum _Phase { pickRole, showQr, done }

class _PairDeviceScreenState extends State<PairDeviceScreen> {
  _Phase _phase = _Phase.pickRole;
  List<RoleOption> _roles = _fallbackRoles;
  late String _roleEnum = _roles.first.role;
  bool _busy = false;

  String? _requestId;
  String? _qrData;
  Map<String, dynamic>? _incoming; // the pending join request, once it appears
  Timer? _poll;

  String get _roleLabel =>
      _roles.firstWhere((r) => r.role == _roleEnum, orElse: () => _roles.first).label;

  @override
  void initState() {
    super.initState();
    _loadRoles();
  }

  Future<void> _loadRoles() async {
    await PermissionsService.instance.ensureLoaded();
    final server = PermissionsService.instance.pairableRoles;
    if (!mounted || server.isEmpty) return;
    setState(() {
      _roles = server;
      _roleEnum = server.first.role;
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _generate() async {
    setState(() => _busy = true);
    final res = await NexusService.pairingInitiate(role: _roleEnum);
    if (!mounted) return;
    setState(() => _busy = false);
    if (!res.success) {
      showAuthSnack(context, res.friendlyError);
      return;
    }
    final requestId = res.data['request_id']?.toString();
    final payload = res.data['qr_payload'];
    if (requestId == null || payload == null) {
      showAuthSnack(context, 'The server did not return a pairing code.');
      return;
    }
    setState(() {
      _requestId = requestId;
      _qrData = jsonEncode(payload); // the new device scans exactly this
      _phase = _Phase.showQr;
    });
    _startPolling();
  }

  void _startPolling() {
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(seconds: 2), (_) => _pollPending());
  }

  Future<void> _pollPending() async {
    final res = await NexusService.pairingPending();
    if (!mounted || _requestId == null) return;
    final list = (res.data['pending'] as List?) ?? const [];
    final match = list.cast<Map<String, dynamic>>().where(
        (r) => r['request_id']?.toString() == _requestId);
    if (match.isNotEmpty) {
      setState(() => _incoming = match.first);
    }
  }

  Future<void> _confirm() async {
    if (_requestId == null) return;
    setState(() => _busy = true);
    final res =
        await NexusService.pairingConfirm(requestId: _requestId!, role: _roleEnum);
    if (!mounted) return;
    setState(() => _busy = false);
    if (res.success) {
      _poll?.cancel();
      setState(() => _phase = _Phase.done);
    } else {
      showAuthSnack(context, res.friendlyError);
    }
  }

  Future<void> _reject() async {
    if (_requestId == null) return;
    await NexusService.pairingReject(requestId: _requestId!);
    if (!mounted) return;
    setState(() => _incoming = null); // keep the QR up for another try
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      title: 'Pair a device',
      subtitle: switch (_phase) {
        _Phase.pickRole => 'Choose the role for the device you\'re adding.',
        _Phase.showQr => 'Have the new device scan this code.',
        _Phase.done => 'Device paired.',
      },
      child: switch (_phase) {
        _Phase.pickRole => _buildPickRole(),
        _Phase.showQr => _buildShowQr(),
        _Phase.done => _buildDone(),
      },
    );
  }

  Widget _buildPickRole() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AppDropdownField(
          label: 'Role',
          value: _roleLabel,
          items: _roles.map((r) => r.label).toList(),
          onChanged: (v) => setState(
              () => _roleEnum = _roles.firstWhere((r) => r.label == v).role),
        ),
        const SizedBox(height: 24),
        AuthButton(label: 'Generate code', busy: _busy, onPressed: _generate),
      ],
    );
  }

  Widget _buildShowQr() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
            ),
            child: QrImageView(
              data: _qrData!,
              size: 220,
              backgroundColor: Colors.white,
            ),
          ),
        ),
        const SizedBox(height: 12),
        Center(
          child: Text('Adding as $_roleLabel',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.6))),
        ),
        const SizedBox(height: 24),
        if (_incoming == null)
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2)),
              const SizedBox(width: 12),
              Text('Waiting for the device to scan…',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.6))),
            ],
          )
        else
          _IncomingRequestCard(
            request: _incoming!,
            roleLabel: _roleLabel,
            busy: _busy,
            onConfirm: _confirm,
            onReject: _reject,
          ),
      ],
    );
  }

  Widget _buildDone() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(Icons.check_circle_outline,
            color: Color(0xFF34D399), size: 64),
        const SizedBox(height: 16),
        Text('The device is now paired as $_roleLabel.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white.withValues(alpha: 0.8))),
        const SizedBox(height: 24),
        AuthButton(
            label: 'Done', onPressed: () => Navigator.of(context).maybePop()),
      ],
    );
  }
}

class _IncomingRequestCard extends StatelessWidget {
  final Map<String, dynamic> request;
  final String roleLabel;
  final bool busy;
  final VoidCallback onConfirm;
  final VoidCallback onReject;

  const _IncomingRequestCard({
    required this.request,
    required this.roleLabel,
    required this.busy,
    required this.onConfirm,
    required this.onReject,
  });

  @override
  Widget build(BuildContext context) {
    final name = request['device_name']?.toString() ?? 'A device';
    final uid = request['device_uid']?.toString() ?? '';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF141B29),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(name,
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w700)),
          if (uid.isNotEmpty)
            Text(uid,
                style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.4), fontSize: 11)),
          const SizedBox(height: 4),
          Text('wants to join as $roleLabel',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.7))),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    side: BorderSide(
                        color: Colors.white.withValues(alpha: 0.25)),
                    minimumSize: const Size.fromHeight(48),
                  ),
                  onPressed: busy ? null : onReject,
                  child: const Text('Reject',
                      style: TextStyle(color: Colors.white)),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: AuthButton(
                    label: 'Confirm', busy: busy, onPressed: onConfirm),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
