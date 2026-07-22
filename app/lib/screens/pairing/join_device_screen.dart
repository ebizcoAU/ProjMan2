import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../config/router.dart';
import '../../services/nexus_service.dart';
import '../../services/session_service.dart';
import '../../widgets/auth_scaffold.dart';
import '../../widgets/auth_extras.dart';

/// Joining-device side of pairing (projman-01 §1.3). This device has no session
/// yet — the scanned nonce is its credential. Scan the primary's QR → POST
/// `/pairing/request` → poll `/pairing/status` until confirmed → receive the
/// role (and tokens, or a prompt to log in). Reached from Welcome → "Join with a
/// QR code".
class JoinDeviceScreen extends StatefulWidget {
  const JoinDeviceScreen({super.key});

  @override
  State<JoinDeviceScreen> createState() => _JoinDeviceScreenState();
}

enum _Phase { scan, waiting, confirmed }

class _JoinDeviceScreenState extends State<JoinDeviceScreen> {
  _Phase _phase = _Phase.scan;
  bool _handled = false;
  String? _requestId;
  String? _role;
  Timer? _poll;

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_handled) return;
    final raw = capture.barcodes.isEmpty ? null : capture.barcodes.first.rawValue;
    if (raw == null || raw.isEmpty) return;

    Map<String, dynamic>? payload;
    try {
      payload = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return; // not our QR — keep scanning
    }
    final id = payload['id']?.toString();
    final nonce = payload['nonce']?.toString();
    if (id == null || nonce == null) return;

    _handled = true;
    setState(() => _phase = _Phase.waiting);
    final res = await NexusService.pairingRequest(requestId: id, nonce: nonce);
    if (!mounted) return;
    if (!res.success) {
      _handled = false;
      showAuthSnack(context, res.friendlyError);
      setState(() => _phase = _Phase.scan);
      return;
    }
    _requestId = id;
    _startPolling();
  }

  void _startPolling() {
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(seconds: 2), (_) => _pollStatus());
  }

  Future<void> _pollStatus() async {
    if (_requestId == null) return;
    final res = await NexusService.pairingStatus(requestId: _requestId!);
    if (!mounted) return;
    final role = res.data['role']?.toString();
    final confirmed =
        role != null || res.data['status']?.toString() == 'confirmed';
    if (!confirmed) return;

    _poll?.cancel();
    setState(() {
      _role = role;
      _phase = _Phase.confirmed;
    });

    // If the server issued tokens, pairingStatus already persisted them.
    final hasSession = await SessionService.hasSession();
    if (!mounted) return;
    if (hasSession) {
      context.go(AppRoutes.home);
    } else {
      // requiresLogin — the device is trusted but the user must authenticate.
      context.go(AppRoutes.login);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      title: 'Join with a QR code',
      subtitle: switch (_phase) {
        _Phase.scan => 'Point the camera at the code on the primary device.',
        _Phase.waiting => 'Waiting for approval…',
        _Phase.confirmed => 'Approved.',
      },
      child: switch (_phase) {
        _Phase.scan => _buildScanner(),
        _Phase.waiting => _buildWaiting(),
        _Phase.confirmed => _buildConfirmed(),
      },
    );
  }

  Widget _buildScanner() {
    return AspectRatio(
      aspectRatio: 1,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: MobileScanner(onDetect: _onDetect),
      ),
    );
  }

  Widget _buildWaiting() {
    return Column(
      children: [
        const SizedBox(height: 24),
        const CircularProgressIndicator(),
        const SizedBox(height: 20),
        Text('Ask the primary device to approve this tablet.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white.withValues(alpha: 0.7))),
      ],
    );
  }

  Widget _buildConfirmed() {
    return Column(
      children: [
        const Icon(Icons.check_circle_outline,
            color: Color(0xFF34D399), size: 64),
        const SizedBox(height: 16),
        Text(
          _role == null ? 'This device is paired.' : 'Paired as $_role.',
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.white.withValues(alpha: 0.8)),
        ),
      ],
    );
  }
}
