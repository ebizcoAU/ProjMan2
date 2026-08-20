import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import '../services/nexus_service.dart';
import '../widgets/auth_scaffold.dart';
import '../widgets/auth_extras.dart';

/// Forgot password. Three phases against projman-01 §1.2:
///   request (email → code) → verify (code → recovery token) → reset (new pwd).
/// The email path is wired to the live server. An SMS-to-mobile path is shown as
/// a disabled option (skin) — it is a Phase-2 server ask (see the projman-01 note).
class RecoveryScreen extends StatefulWidget {
  const RecoveryScreen({super.key});

  @override
  State<RecoveryScreen> createState() => _RecoveryScreenState();
}

enum _Phase { request, verify, reset, done }

class _RecoveryScreenState extends State<RecoveryScreen> {
  _Phase _phase = _Phase.request;
  bool _busy = false;

  final _email = TextEditingController();
  final _code = TextEditingController();
  final _newPassword = TextEditingController();
  String? _recoveryToken;
  bool _obscure = true;

  // 6-digit OTP entry, split into two boxes of 3 (see docs/assets/RecoveryScreen.png).
  final _otpDigits = List.generate(6, (_) => TextEditingController());
  final _otpFocus = List.generate(6, (_) => FocusNode());
  // Separate nodes for the backspace-key listeners — must NOT be the same
  // FocusNode as _otpFocus (KeyboardListener is TextFormField's ancestor;
  // sharing one node makes it try to reparent under itself and crashes).
  final _otpKeyFocus = List.generate(6, (_) => FocusNode());
  Timer? _resendTimer;
  int _resendSeconds = 0;

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    _newPassword.dispose();
    for (final c in _otpDigits) {
      c.dispose();
    }
    for (final f in _otpFocus) {
      f.dispose();
    }
    for (final f in _otpKeyFocus) {
      f.dispose();
    }
    _resendTimer?.cancel();
    super.dispose();
  }

  void _startResendTimer() {
    _resendTimer?.cancel();
    setState(() => _resendSeconds = 30);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (_resendSeconds <= 1) {
        t.cancel();
        setState(() => _resendSeconds = 0);
      } else {
        setState(() => _resendSeconds -= 1);
      }
    });
  }

  void _syncOtpCode() {
    _code.text = _otpDigits.map((c) => c.text).join();
    setState(() {});
  }

  void _onOtpChanged(int i, String v) {
    if (v.isNotEmpty && i < 5) _otpFocus[i + 1].requestFocus();
    _syncOtpCode();
    if (_code.text.length == 6) FocusScope.of(context).unfocus();
  }

  static String _maskEmail(String email) {
    final at = email.indexOf('@');
    if (at <= 0) return email;
    final local = email.substring(0, at);
    final domain = email.substring(at);
    final keep = local.length >= 2 ? local.substring(0, 2) : local;
    final maskLen = (local.length - keep.length).clamp(3, 8);
    return '$keep${'*' * maskLen}$domain';
  }

  Future<void> _request() async {
    if (validateEmail(_email.text) != null) {
      showAuthSnack(context, 'Enter the email on your account');
      return;
    }
    setState(() => _busy = true);
    final res = await NexusService.recoveryRequest(email: _email.text.trim());
    if (!mounted) return;
    setState(() => _busy = false);
    // The server always returns 200 here (does not reveal whether the email
    // exists), so advance to code entry regardless.
    if (res.success || res.status == 200) {
      for (final c in _otpDigits) {
        c.clear();
      }
      _code.clear();
      setState(() => _phase = _Phase.verify);
      _startResendTimer();
    } else {
      showAuthSnack(context, res.friendlyError);
    }
  }

  Future<void> _verify() async {
    if (_code.text.trim().isEmpty) {
      showAuthSnack(context, 'Enter the code we sent you');
      return;
    }
    setState(() => _busy = true);
    final res = await NexusService.recoveryVerify(
      email: _email.text.trim(),
      code: _code.text.trim(),
    );
    if (!mounted) return;
    setState(() => _busy = false);
    final token = res.data['recoveryToken']?.toString();
    if (res.success && token != null) {
      setState(() {
        _recoveryToken = token;
        _phase = _Phase.reset;
      });
    } else {
      // TOO_MANY_ATTEMPTS burns the code server-side — waiting out the
      // cooldown is pointless, so let the user request a fresh one now.
      if (res.code == 'TOO_MANY_ATTEMPTS') {
        _resendTimer?.cancel();
        setState(() => _resendSeconds = 0);
      }
      showAuthSnack(context, res.friendlyError);
    }
  }

  Future<void> _reset() async {
    if (validatePassword(_newPassword.text) != null) {
      showAuthSnack(context, 'Use at least 10 characters');
      return;
    }
    setState(() => _busy = true);
    final res = await NexusService.recoveryReset(
      recoveryToken: _recoveryToken!,
      newPassword: _newPassword.text,
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (res.success) {
      setState(() => _phase = _Phase.done);
    } else if (res.code == 'INVALID_RECOVERY_TOKEN') {
      // The verify→reset token expired or was already spent — start over.
      _resendTimer?.cancel();
      for (final c in _otpDigits) {
        c.clear();
      }
      _code.clear();
      _newPassword.clear();
      _recoveryToken = null;
      setState(() => _phase = _Phase.request);
      showAuthSnack(context, res.friendlyError);
    } else {
      showAuthSnack(context, res.friendlyError);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      title: 'Reset your password',
      subtitle: switch (_phase) {
        _Phase.request => 'We\'ll send a code to your email.',
        _Phase.verify => null,
        _Phase.reset => 'Choose a new password.',
        _Phase.done => 'All done.',
      },
      child: switch (_phase) {
        _Phase.request => _buildRequest(),
        _Phase.verify => _buildVerify(),
        _Phase.reset => _buildReset(),
        _Phase.done => _buildDone(),
      },
    );
  }

  Widget _buildRequest() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AuthField(
          controller: _email,
          label: 'Email',
          hint: 'you@builder.com.au',
          keyboardType: TextInputType.emailAddress,
          validator: validateEmail,
        ),
        const SizedBox(height: 20),
        AuthButton(label: 'Send code', busy: _busy, onPressed: _request),
        const SizedBox(height: 16),
        // SMS path — skin only (server ask pending). Disabled with a hint.
        Opacity(
          opacity: 0.5,
          child: OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
              side: BorderSide(color: Colors.white.withValues(alpha: 0.2)),
            ),
            icon: const Icon(Icons.sms_outlined, color: Colors.white70),
            label: const Text('Send code by SMS instead  ·  coming soon',
                style: TextStyle(color: Colors.white70)),
            onPressed: () => showAuthSnack(
                context, 'SMS reset is coming soon — use email for now.'),
          ),
        ),
      ],
    );
  }

  Widget _buildVerify() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Enter the 6-digit code we sent to ${_maskEmail(_email.text.trim())}.',
          style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 13),
        ),
        const SizedBox(height: 20),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (var i = 0; i < 3; i++) ...[
              if (i > 0) const SizedBox(width: 8),
              _otpBox(i),
            ],
            const SizedBox(width: 14),
            Text('—', style: TextStyle(color: Colors.white.withValues(alpha: 0.3), fontSize: 20)),
            const SizedBox(width: 14),
            for (var i = 3; i < 6; i++) ...[
              if (i > 3) const SizedBox(width: 8),
              _otpBox(i),
            ],
          ],
        ),
        const SizedBox(height: 10),
        Text('Code sent to your email.',
            style: TextStyle(color: Colors.white.withValues(alpha: 0.45), fontSize: 12)),
        const SizedBox(height: 24),
        AuthButton(label: 'Verify', busy: _busy, onPressed: _verify),
        const SizedBox(height: 16),
        SizedBox(
          height: 44,
          child: OutlinedButton(
            style: OutlinedButton.styleFrom(
              side: BorderSide(color: Colors.white.withValues(alpha: 0.2)),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
            ),
            onPressed: (_busy || _resendSeconds > 0) ? null : _request,
            child: Text(
              _resendSeconds > 0 ? 'Resend in ${_resendSeconds}s' : 'Resend code',
              style: TextStyle(
                  color: _resendSeconds > 0
                      ? Colors.white.withValues(alpha: 0.35)
                      : Colors.white),
            ),
          ),
        ),
      ],
    );
  }

  Widget _otpBox(int i) {
    return SizedBox(
      width: 44,
      height: 52,
      child: KeyboardListener(
        focusNode: _otpKeyFocus[i],
        onKeyEvent: (event) {
          if (event is KeyDownEvent &&
              event.logicalKey == LogicalKeyboardKey.backspace &&
              _otpDigits[i].text.isEmpty &&
              i > 0) {
            _otpDigits[i - 1].clear();
            _otpFocus[i - 1].requestFocus();
            _syncOtpCode();
          }
        },
        child: TextFormField(
          controller: _otpDigits[i],
          focusNode: _otpFocus[i],
          textAlign: TextAlign.center,
          keyboardType: TextInputType.number,
          maxLength: 1,
          style: const TextStyle(
              color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700),
          decoration: InputDecoration(
            counterText: '',
            filled: true,
            fillColor: const Color(0xFF141B29),
            contentPadding: EdgeInsets.zero,
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: AuthScaffold.accent, width: 1.5),
            ),
          ),
          onChanged: (v) => _onOtpChanged(i, v),
        ),
      ),
    );
  }

  Widget _buildReset() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AuthField(
          controller: _newPassword,
          label: 'New password',
          hint: 'At least 10 characters',
          obscure: _obscure,
          validator: validatePassword,
          suffix: IconButton(
            icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility,
                color: Colors.white54),
            onPressed: () => setState(() => _obscure = !_obscure),
          ),
        ),
        const SizedBox(height: 20),
        AuthButton(
            label: 'Set new password', busy: _busy, onPressed: _reset),
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
        Text('Your password has been reset.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white.withValues(alpha: 0.8))),
        const SizedBox(height: 24),
        AuthButton(
            label: 'Back to sign in',
            onPressed: () => context.pop()),
      ],
    );
  }
}
