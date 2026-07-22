import 'package:flutter/material.dart';
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

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    _newPassword.dispose();
    super.dispose();
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
      setState(() => _phase = _Phase.verify);
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
        _Phase.verify => 'Enter the 6-digit code we sent.',
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
        AuthField(
          controller: _code,
          label: 'Verification code',
          hint: '6 digits',
          keyboardType: TextInputType.number,
        ),
        const SizedBox(height: 20),
        AuthButton(label: 'Verify', busy: _busy, onPressed: _verify),
        const SizedBox(height: 12),
        TextButton(
          onPressed: _busy ? null : _request,
          child: const Text('Resend code',
              style: TextStyle(color: Color(0xFF60A5FA))),
        ),
      ],
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
