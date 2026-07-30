import 'dart:async';
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../services/nexus_service.dart';
import '../../widgets/auth_scaffold.dart';
import '../../widgets/auth_extras.dart';

/// Introduction (appdesignspecification.md §2.2/§2.3, nav §3 "Profile →
/// Introduction (QR)"): a digital-business-card QR swap between two
/// already-self-registered users. No job is implied or created — this only
/// adds each party to the other's contact book, any time, independent of any
/// project. Distinct from `pair_device_screen.dart`/`join_device_screen.dart`,
/// which pair a NEW device into this org; here both parties already hold
/// their own session, so there is no device/role/confirm step, just
/// generate → scan → done.
class IntroductionScreen extends StatefulWidget {
  const IntroductionScreen({super.key});

  @override
  State<IntroductionScreen> createState() => _IntroductionScreenState();
}

enum _Phase { menu, showCode, scan, result }

class _IntroductionScreenState extends State<IntroductionScreen> {
  _Phase _phase = _Phase.menu;
  bool _busy = false;
  bool _handledScan = false;

  String? _qrData;
  DateTime? _expiresAt;

  List<IntroductionContact> _contacts = [];
  bool _loadingContacts = true;
  IntroductionContact? _lastResult;
  bool _alreadyIntroduced = false;

  @override
  void initState() {
    super.initState();
    _loadContacts();
  }

  Future<void> _loadContacts() async {
    setState(() => _loadingContacts = true);
    final res = await NexusService.introductionContacts();
    if (!mounted) return;
    setState(() {
      _contacts = res.success
          ? ((res.data['contacts'] as List?) ?? const [])
              .map((c) => IntroductionContact.fromJson(
                  Map<String, dynamic>.from(c as Map)))
              .toList()
          : const [];
      _loadingContacts = false;
    });
  }

  Future<void> _showCode() async {
    debugPrint('[Introduction] _showCode: requesting POST /introductions/code');
    final sw = Stopwatch()..start();
    setState(() {
      _busy = true;
      _phase = _Phase.showCode;
    });
    try {
      final res = await NexusService.introductionCode();
      debugPrint('[Introduction] _showCode: responded after ${sw.elapsedMilliseconds}ms '
          '— success=${res.success} status=${res.status} code=${res.code} '
          'message=${res.message} data=${res.data}');
      if (!mounted) return;
      setState(() => _busy = false);
      if (!res.success) {
        showAuthSnack(context, res.friendlyError);
        setState(() => _phase = _Phase.menu);
        return;
      }
      // The code is an opaque signed string (xprojman-04.md) — render it
      // as-is, never jsonEncode it as if it were a structured payload.
      final code = res.data['code']?.toString();
      final expiresIn = (res.data['expires_in'] as num?)?.toInt();
      setState(() {
        _qrData = code;
        _expiresAt = expiresIn == null
            ? null
            : DateTime.now().add(Duration(seconds: expiresIn));
      });
    } catch (e, st) {
      // Belt-and-braces: NexusService._post/_get already catch broadly, so
      // this should never fire — but if it ever does, surface it instead of
      // leaving the spinner stuck forever with no signal why.
      debugPrint('[Introduction] _showCode: UNCAUGHT error after '
          '${sw.elapsedMilliseconds}ms: $e\n$st');
      if (!mounted) return;
      setState(() {
        _busy = false;
        _phase = _Phase.menu;
      });
      showAuthSnack(context, 'Something went wrong: $e');
    }
  }

  void _startScan() {
    _handledScan = false;
    setState(() => _phase = _Phase.scan);
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_handledScan) return;
    final raw =
        capture.barcodes.isEmpty ? null : capture.barcodes.first.rawValue;
    if (raw == null || raw.isEmpty) return;

    // The code is an opaque signed string (xprojman-04.md), not JSON — send
    // exactly what was read off the QR, no decode/re-encode round trip.
    _handledScan = true;
    debugPrint('[Introduction] _onDetect: requesting POST /introductions/scan');
    final sw = Stopwatch()..start();
    setState(() => _busy = true);
    try {
      final res = await NexusService.introductionScan(raw);
      debugPrint('[Introduction] _onDetect: responded after ${sw.elapsedMilliseconds}ms '
          '— success=${res.success} status=${res.status} code=${res.code} '
          'message=${res.message} data=${res.data}');
      if (!mounted) return;
      setState(() => _busy = false);
      if (!res.success) {
        showAuthSnack(context, res.friendlyError);
        _handledScan = false;
        setState(() => _phase = _Phase.menu);
        return;
      }
      final contact = res.data['contact'];
      setState(() {
        _lastResult = contact is Map
            ? IntroductionContact.fromJson(Map<String, dynamic>.from(contact))
            : null;
        _alreadyIntroduced = res.data['alreadyIntroduced'] == true;
        _phase = _Phase.result;
      });
      unawaited(_loadContacts());
    } catch (e, st) {
      debugPrint('[Introduction] _onDetect: UNCAUGHT error after '
          '${sw.elapsedMilliseconds}ms: $e\n$st');
      if (!mounted) return;
      _handledScan = false;
      setState(() {
        _busy = false;
        _phase = _Phase.menu;
      });
      showAuthSnack(context, 'Something went wrong: $e');
    }
  }

  void _backToMenu() => setState(() => _phase = _Phase.menu);

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      title: 'Introduction',
      subtitle: switch (_phase) {
        _Phase.menu =>
          'Swap a digital business card. No job is implied or created — you can meet years before either of you has a project to offer.',
        _Phase.showCode => 'Have the other person scan this code.',
        _Phase.scan => 'Point the camera at their code.',
        _Phase.result => 'Added to your contacts.',
      },
      child: switch (_phase) {
        _Phase.menu => _buildMenu(),
        _Phase.showCode => _buildShowCode(),
        _Phase.scan => _buildScan(),
        _Phase.result => _buildResult(),
      },
    );
  }

  Widget _buildMenu() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AuthButton(label: 'Show my code', onPressed: _showCode),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(
            foregroundColor: Colors.white,
            side: BorderSide(color: Colors.white.withValues(alpha: 0.25)),
            minimumSize: const Size.fromHeight(48),
          ),
          icon: const Icon(Icons.qr_code_scanner),
          label: const Text('Scan a code'),
          onPressed: _startScan,
        ),
        const SizedBox(height: 28),
        Text('YOUR CONTACTS',
            style: TextStyle(
                color: Colors.white.withValues(alpha: 0.5),
                fontSize: 12,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.5)),
        const SizedBox(height: 8),
        if (_loadingContacts)
          const Center(
              child: Padding(
            padding: EdgeInsets.only(top: 16),
            child: CircularProgressIndicator(strokeWidth: 2),
          ))
        else if (_contacts.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('No contacts yet — show or scan a code to add one.',
                style: TextStyle(color: Colors.white.withValues(alpha: 0.5))),
          )
        else
          ..._contacts.map((c) => _ContactRow(contact: c)),
      ],
    );
  }

  Widget _buildShowCode() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_busy || _qrData == null)
          const Center(
              child: Padding(
            padding: EdgeInsets.all(32),
            child: CircularProgressIndicator(),
          ))
        else ...[
          Center(
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
              ),
              child: QrImageView(data: _qrData!, size: 220, backgroundColor: Colors.white),
            ),
          ),
          const SizedBox(height: 12),
          if (_expiresAt != null)
            Center(
              child: Text('Expires ${_expiresAt!.toLocal().hour}:${_expiresAt!.toLocal().minute.toString().padLeft(2, '0')}',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.5))),
            ),
        ],
        const SizedBox(height: 24),
        AuthButton(label: 'Done', onPressed: _backToMenu),
      ],
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
            child: _busy
                ? const ColoredBox(
                    color: Colors.black,
                    child: Center(
                        child: CircularProgressIndicator(color: Colors.white)))
                : MobileScanner(onDetect: _onDetect),
          ),
        ),
        const SizedBox(height: 16),
        TextButton(onPressed: _backToMenu, child: const Text('Cancel')),
      ],
    );
  }

  Widget _buildResult() {
    final c = _lastResult;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(Icons.check_circle_outline,
            color: Color(0xFF34D399), size: 64),
        const SizedBox(height: 16),
        Text(
          c == null
              ? 'Contact added.'
              : _alreadyIntroduced
                  ? '${c.name} is already in your contacts.'
                  : '${c.name} is now in your contacts.',
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.white.withValues(alpha: 0.8)),
        ),
        const SizedBox(height: 24),
        AuthButton(label: 'Done', onPressed: _backToMenu),
      ],
    );
  }
}

class _ContactRow extends StatelessWidget {
  final IntroductionContact contact;
  const _ContactRow({required this.contact});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF141B29),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 18,
            backgroundColor: Colors.white.withValues(alpha: 0.08),
            child: Text(
              contact.name.trim().isEmpty ? '?' : contact.name.trim()[0].toUpperCase(),
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(contact.name,
                    style: const TextStyle(
                        color: Colors.white, fontWeight: FontWeight.w700)),
                if (contact.role != null || contact.orgName != null)
                  Text(
                      [contact.role, contact.orgName]
                          .whereType<String>()
                          .join(' · '),
                      style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.5),
                          fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A contact-book entry (server ask — shape not yet finalised; tolerant of
/// missing fields the same way `models/domain.dart` readers are).
class IntroductionContact {
  final String userId;
  final String name;
  final String? role;
  final String? orgName;
  final DateTime? introducedAt;

  const IntroductionContact({
    required this.userId,
    required this.name,
    this.role,
    this.orgName,
    this.introducedAt,
  });

  static IntroductionContact fromJson(Map<String, dynamic> j) =>
      IntroductionContact(
        userId: (j['user_id'] ?? j['id'] ?? '').toString(),
        name: (j['full_name'] ?? j['name'] ?? j['email'] ?? 'Contact').toString(),
        role: j['role']?.toString(),
        orgName: (j['org_name'] ?? j['organisation_name'])?.toString(),
        introducedAt: j['introduced_at'] == null
            ? null
            : DateTime.tryParse(j['introduced_at'].toString()),
      );
}
