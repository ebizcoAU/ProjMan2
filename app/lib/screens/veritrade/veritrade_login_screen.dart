import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../services/nexus_service.dart';
import '../../widgets/auth_scaffold.dart';
import '../../widgets/auth_extras.dart';

/// VeriTrade "Scan to sign in" (appdesignspecification.md §8, xprojman-25).
/// This app is VeriTrade's sole identity root — there is no VeriTrade
/// password, for anyone. A browser shows a session-bound QR; this screen
/// scans it, shows who's asking, and approves/denies using this device's own
/// existing App session (the same signed-reference primitive already built
/// for Introduction, reused, not reinvented). Entry point only: this app
/// never displays a VeriTrade QR of its own, so there is no "menu" phase like
/// Introduction has — scanning starts immediately.
class VeritradeLoginScreen extends StatefulWidget {
  const VeritradeLoginScreen({super.key});

  @override
  State<VeritradeLoginScreen> createState() => _VeritradeLoginScreenState();
}

enum _Phase { scan, loading, review, result }

class _VeritradeLoginScreenState extends State<VeritradeLoginScreen> {
  _Phase _phase = _Phase.scan;
  bool _handledScan = false;
  bool _busy = false;

  String? _sessionId;
  String? _code;
  Map<String, dynamic> _context = const {};

  IconData _resultIcon = Icons.check_circle_outline;
  Color _resultColor = const Color(0xFF34D399);
  String _resultMessage = '';

  void _resetToScan() {
    _handledScan = false;
    setState(() => _phase = _Phase.scan);
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_handledScan) return;
    final raw =
        capture.barcodes.isEmpty ? null : capture.barcodes.first.rawValue;
    if (raw == null || raw.isEmpty) return;
    _handledScan = true;

    // Current placeholder shape (xprojman-25):
    // projman://veritrade-login?session_id=<uuid>&code=<jwt>
    final uri = Uri.tryParse(raw);
    final sessionId = uri?.queryParameters['session_id'];
    final code = uri?.queryParameters['code'];
    if (uri == null ||
        uri.scheme != 'projman' ||
        sessionId == null ||
        sessionId.isEmpty ||
        code == null ||
        code.isEmpty) {
      showAuthSnack(context, 'That doesn\'t look like a VeriTrade sign-in code.');
      _resetToScan();
      return;
    }

    _sessionId = sessionId;
    _code = code;
    setState(() => _phase = _Phase.loading);

    final res = await NexusService.veritradeLoginContext(sessionId, code);
    if (!mounted) return;

    if (!res.success) {
      if (res.code == 'ALREADY_RESOLVED') {
        final status = res.data['status']?.toString();
        setState(() {
          _resultIcon = Icons.info_outline;
          _resultColor = Colors.white.withValues(alpha: 0.6);
          _resultMessage = status == 'approved'
              ? 'This sign-in was already approved from another device.'
              : status == 'denied'
                  ? 'This sign-in was already denied from another device.'
                  : 'This sign-in request was already handled.';
          _phase = _Phase.result;
        });
        return;
      }
      setState(() {
        _resultIcon = Icons.error_outline;
        _resultColor = const Color(0xFFEF4444);
        _resultMessage = res.code == 'INVALID_CODE'
            ? 'This code is no longer valid.'
            : res.friendlyError;
        _phase = _Phase.result;
      });
      return;
    }

    setState(() {
      _context = res.data;
      _phase = _Phase.review;
    });
  }

  Future<void> _respond(bool approve) async {
    final sessionId = _sessionId;
    final code = _code;
    if (sessionId == null || code == null) return;
    HapticFeedback.mediumImpact(); // granting/denying access to your own identity — critical
    setState(() => _busy = true);
    final res = approve
        ? await NexusService.veritradeLoginApprove(sessionId, code)
        : await NexusService.veritradeLoginDeny(sessionId, code);
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (res.success) {
        _resultIcon = approve ? Icons.check_circle_outline : Icons.block;
        _resultColor =
            approve ? const Color(0xFF34D399) : Colors.white.withValues(alpha: 0.6);
        _resultMessage =
            approve ? 'Signed in — you can return to the browser.' : 'Sign-in denied.';
      } else {
        _resultIcon = Icons.error_outline;
        _resultColor = const Color(0xFFEF4444);
        _resultMessage = res.friendlyError;
      }
      _phase = _Phase.result;
    });
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      title: 'Scan to sign in',
      subtitle: switch (_phase) {
        _Phase.scan =>
          'Point your camera at the sign-in code shown on VeriTrade.',
        _Phase.loading => 'Checking the code…',
        _Phase.review => 'Review the request before approving.',
        _Phase.result => '',
      },
      child: switch (_phase) {
        _Phase.scan => _buildScan(),
        _Phase.loading => const Center(
            child: Padding(
            padding: EdgeInsets.all(32),
            child: CircularProgressIndicator(),
          )),
        _Phase.review => _buildReview(),
        _Phase.result => _buildResult(),
      },
    );
  }

  Widget _buildScan() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AspectRatio(
          aspectRatio: 1,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: MobileScanner(onDetect: _onDetect),
          ),
        ),
        const SizedBox(height: 16),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
      ],
    );
  }

  Widget _buildReview() {
    final ip = _context['requested_ip']?.toString();
    final agent = _context['requested_user_agent']?.toString();
    final requestedAt = DateTime.tryParse(_context['requested_at']?.toString() ?? '');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFF141B29),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Someone is trying to sign in to VeriTrade',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              if (agent != null && agent.isNotEmpty)
                Text(agent,
                    style:
                        TextStyle(color: Colors.white.withValues(alpha: 0.7))),
              if (ip != null && ip.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text('from $ip',
                      style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.5),
                          fontSize: 12)),
                ),
              if (requestedAt != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                      'Requested at ${requestedAt.toLocal().hour.toString().padLeft(2, '0')}:'
                      '${requestedAt.toLocal().minute.toString().padLeft(2, '0')}',
                      style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.5),
                          fontSize: 12)),
                ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        Text(
          'If this wasn\'t you, deny it — nobody signs into your VeriTrade identity without this approval.',
          style: TextStyle(color: Colors.white.withValues(alpha: 0.5), fontSize: 12),
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white,
                  side: BorderSide(color: Colors.white.withValues(alpha: 0.25)),
                  minimumSize: const Size.fromHeight(48),
                ),
                onPressed: _busy ? null : () => _respond(false),
                child: const Text('Deny'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: AuthButton(
                label: 'Approve',
                busy: _busy,
                onPressed: () => _respond(true),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildResult() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Icon(_resultIcon, color: _resultColor, size: 64),
        const SizedBox(height: 16),
        Text(
          _resultMessage,
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.white.withValues(alpha: 0.8)),
        ),
        const SizedBox(height: 24),
        AuthButton(label: 'Done', onPressed: () => Navigator.of(context).pop()),
      ],
    );
  }
}
