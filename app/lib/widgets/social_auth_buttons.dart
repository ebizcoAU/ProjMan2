import 'package:flutter/material.dart';
import '../services/oauth_service.dart';

/// The three prominent OAuth buttons (Google · Microsoft · Facebook) shown at
/// the top of login and register (auth-strategy §UI). Brand marks are drawn
/// inline — no bundled logos — so the skin stays self-contained. Wired to
/// [OAuthService], which is skin-only until the server ships OAuth (see the
/// "coming soon" handler in the parent screens).
class SocialAuthButtons extends StatelessWidget {
  final Future<void> Function(OAuthProvider) onTap;

  const SocialAuthButtons({super.key, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _SocialButton(
          label: 'Continue with Google',
          background: Colors.white,
          foreground: const Color(0xFF1F1F1F),
          mark: const _GoogleMark(),
          onPressed: () => onTap(OAuthProvider.google),
        ),
        const SizedBox(height: 12),
        _SocialButton(
          label: 'Continue with Microsoft',
          background: Colors.white,
          foreground: const Color(0xFF1F1F1F),
          mark: const _MicrosoftMark(),
          onPressed: () => onTap(OAuthProvider.microsoft),
        ),
        const SizedBox(height: 12),
        _SocialButton(
          label: 'Continue with Facebook',
          background: const Color(0xFF1877F2),
          foreground: Colors.white,
          mark: const _FacebookMark(),
          onPressed: () => onTap(OAuthProvider.facebook),
        ),
      ],
    );
  }
}

class _SocialButton extends StatelessWidget {
  final String label;
  final Color background;
  final Color foreground;
  final Widget mark;
  final VoidCallback onPressed;

  const _SocialButton({
    required this.label,
    required this.background,
    required this.foreground,
    required this.mark,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 52,
      child: FilledButton(
        style: FilledButton.styleFrom(
          backgroundColor: background,
          foregroundColor: foreground,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
        onPressed: onPressed,
        child: Row(
          children: [
            SizedBox(width: 22, height: 22, child: Center(child: mark)),
            Expanded(
              child: Text(
                label,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    fontSize: 15, fontWeight: FontWeight.w600),
              ),
            ),
            const SizedBox(width: 22),
          ],
        ),
      ),
    );
  }
}

// ── Inline brand marks (approximate, self-contained) ──────────────────────────

class _GoogleMark extends StatelessWidget {
  const _GoogleMark();
  @override
  Widget build(BuildContext context) => const Text('G',
      style: TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w700,
          color: Color(0xFF4285F4)));
}

class _MicrosoftMark extends StatelessWidget {
  const _MicrosoftMark();
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 16,
      height: 16,
      child: Column(
        children: [
          Row(children: const [
            _Sq(Color(0xFFF25022)),
            SizedBox(width: 2),
            _Sq(Color(0xFF7FBA00)),
          ]),
          const SizedBox(height: 2),
          Row(children: const [
            _Sq(Color(0xFF00A4EF)),
            SizedBox(width: 2),
            _Sq(Color(0xFFFFB900)),
          ]),
        ],
      ),
    );
  }
}

class _Sq extends StatelessWidget {
  final Color color;
  const _Sq(this.color);
  @override
  Widget build(BuildContext context) =>
      Container(width: 7, height: 7, color: color);
}

class _FacebookMark extends StatelessWidget {
  const _FacebookMark();
  @override
  Widget build(BuildContext context) => const Text('f',
      style: TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w800,
          color: Colors.white,
          height: 1.0));
}
