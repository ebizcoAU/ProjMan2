import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../config/build_config.dart';
import '../config/router.dart';
import '../services/nexus_service.dart';
import '../services/oauth_service.dart';
import 'auth_scaffold.dart';

// ── Validators ────────────────────────────────────────────────────────────────

String? validateEmail(String? v) {
  final s = (v ?? '').trim();
  if (s.isEmpty) return 'Enter your email';
  final ok = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(s);
  return ok ? null : 'That email does not look right';
}

/// Password policy mirrors the server (projman-01 §6): minimum 10 characters.
String? validatePassword(String? v) {
  final s = v ?? '';
  if (s.isEmpty) return 'Choose a password';
  if (s.length < 10) return 'Use at least 10 characters';
  return null;
}

/// Australian mobile: +61 4xx xxx xxx, or 04xx xxx xxx. Optional in some flows.
String? validateAuMobile(String? v, {bool required = true}) {
  final s = (v ?? '').replaceAll(RegExp(r'[\s-]'), '');
  if (s.isEmpty) return required ? 'Enter your mobile' : null;
  final ok = RegExp(r'^(\+?61|0)4\d{8}$').hasMatch(s);
  return ok ? null : 'Enter a valid Australian mobile (+61 4xx xxx xxx)';
}

/// ABN is optional in v1 (required for invoicing later). If present, it must be
/// 11 digits — the server does the authoritative checksum/ABR check.
String? validateAbnOptional(String? v) {
  final s = (v ?? '').replaceAll(RegExp(r'\s'), '');
  if (s.isEmpty) return null;
  return RegExp(r'^\d{11}$').hasMatch(s) ? null : 'An ABN is 11 digits';
}

// ── Shared bits ───────────────────────────────────────────────────────────────

void showAuthSnack(BuildContext context, String message) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
  );
}

/// Runs the OAuth token-exchange flow (projman-01 §1.8): obtain a provider token,
/// POST it to `/auth/oauth/:provider`, then route to onboarding (new user) or home.
///
/// Real provider SDKs aren't integrated yet. In **dev** we use the server's
/// dev-bypass: a small dialog collects a simulated provider email + name and we
/// send `dev:<provider>:<email>:<name>` — so the whole flow is testable against
/// the live server today. In prod, until the SDKs land, we steer to email.
Future<void> handleOAuth(BuildContext context, OAuthProvider provider) async {
  String token;
  if (IS_DEV) {
    final sim = await _promptDevProvider(context, provider);
    if (sim == null) return; // cancelled
    token = OAuthService.devToken(provider, email: sim.$1, name: sim.$2);
  } else {
    showAuthSnack(
      context,
      '${provider.label} sign-in isn\'t configured yet — use email for now.',
    );
    return;
  }

  final res = await NexusService.oauth(provider.slug, token: token);
  if (!context.mounted) return;
  if (!res.success) {
    showAuthSnack(context, res.friendlyError);
    return;
  }
  final needsOnboarding = res.data['onboardingRequired'] == true;
  context.go(needsOnboarding ? AppRoutes.onboarding : AppRoutes.home);
}

/// Dev-only: simulate what a provider SDK would return (email + name), so the
/// dev-bypass token can be built. Never shown in production builds.
Future<(String, String)?> _promptDevProvider(
  BuildContext context,
  OAuthProvider provider,
) {
  final email = TextEditingController(text: 'dave@builder.com.au');
  final name = TextEditingController(text: 'Dave Nguyen');
  return showDialog<(String, String)>(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: const Color(0xFF141B29),
      title: Text('${provider.label} (dev bypass)',
          style: const TextStyle(color: Colors.white, fontSize: 16)),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Simulating a ${provider.label} sign-in. In production this comes '
            'from the provider SDK.',
            style: TextStyle(
                color: Colors.white.withValues(alpha: 0.6), fontSize: 12),
          ),
          const SizedBox(height: 12),
          AuthField(controller: email, label: 'Email', keyboardType: TextInputType.emailAddress),
          const SizedBox(height: 12),
          AuthField(controller: name, label: 'Name'),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx),
          child: const Text('Cancel'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: AuthScaffold.accent),
          onPressed: () {
            final e = email.text.trim();
            final n = name.text.trim();
            if (e.isEmpty || n.isEmpty) return;
            Navigator.pop(ctx, (e, n));
          },
          child: const Text('Continue'),
        ),
      ],
    ),
  );
}

class OrDivider extends StatelessWidget {
  const OrDivider({super.key});

  @override
  Widget build(BuildContext context) {
    final line = Colors.white.withValues(alpha: 0.12);
    return Row(
      children: [
        Expanded(child: Divider(color: line)),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Text('or',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.45))),
        ),
        Expanded(child: Divider(color: line)),
      ],
    );
  }
}

/// Subtle "made for Australia" signal (auth-strategy §UI).
class AuBadge extends StatelessWidget {
  const AuBadge({super.key});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Text('🇦🇺', style: TextStyle(fontSize: 39)),
        const SizedBox(width: 6),
        Text('Built for Australian builders',
            style: TextStyle(
                color: Colors.white.withValues(alpha: 0.4), fontSize: 12)),
      ],
    );
  }
}
