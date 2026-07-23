import 'package:flutter/material.dart';
import '../services/oauth_service.dart';

/// The three OAuth providers (Google · Microsoft · Facebook) as a single tidy
/// row of equal-width chips (auth-strategy §UI — exactly these three, never a
/// fourth). Brand marks are drawn inline; no bundled logos, so the skin stays
/// self-contained. Wired to [OAuthService] via [onTap] (skin / dev-bypass until
/// the real provider SDKs land).
class SocialAuthButtons extends StatelessWidget {
  final Future<void> Function(OAuthProvider) onTap;

  const SocialAuthButtons({super.key, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _SocialButton(
            tooltip: 'Continue with Google',
            mark: const _GoogleMark(),
            onPressed: () => onTap(OAuthProvider.google),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _SocialButton(
            tooltip: 'Continue with Microsoft',
            mark: const _MicrosoftMark(),
            onPressed: () => onTap(OAuthProvider.microsoft),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _SocialButton(
            tooltip: 'Continue with Facebook',
            mark: const _FacebookMark(),
            onPressed: () => onTap(OAuthProvider.facebook),
          ),
        ),
      ],
    );
  }
}

class _SocialButton extends StatelessWidget {
  final String tooltip;
  final Widget mark;
  final VoidCallback onPressed;

  const _SocialButton({
    required this.tooltip,
    required this.mark,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: SizedBox(
        height: 52,
        child: Semantics(
          label: tooltip,
          button: true,
          child: FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Colors.white,
              padding: EdgeInsets.zero,
              elevation: 0,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12)),
            ),
            onPressed: onPressed,
            child: Center(child: mark),
          ),
        ),
      ),
    );
  }
}

// ── Inline brand marks (approximate, self-contained; all on a white chip) ─────

class _GoogleMark extends StatelessWidget {
  const _GoogleMark();
  @override
  Widget build(BuildContext context) => const Text('G',
      style: TextStyle(
          fontSize: 21,
          fontWeight: FontWeight.w700,
          color: Color(0xFF4285F4)));
}

class _MicrosoftMark extends StatelessWidget {
  const _MicrosoftMark();
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 18,
      height: 18,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(mainAxisSize: MainAxisSize.min, children: const [
            _Sq(Color(0xFFF25022)),
            SizedBox(width: 2),
            _Sq(Color(0xFF7FBA00)),
          ]),
          const SizedBox(height: 2),
          Row(mainAxisSize: MainAxisSize.min, children: const [
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
      Container(width: 8, height: 8, color: color);
}

class _FacebookMark extends StatelessWidget {
  const _FacebookMark();
  @override
  Widget build(BuildContext context) => const Text('f',
      style: TextStyle(
          fontSize: 23,
          fontWeight: FontWeight.w800,
          color: Color(0xFF1877F2),
          height: 1.0));
}
