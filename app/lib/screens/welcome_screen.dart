import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../config/router.dart';
import '../widgets/social_auth_buttons.dart';
import '../widgets/auth_extras.dart';

/// First-run welcome. A full-bleed hero photo (`assets/bgimage.jpeg`, whose top
/// ~15% carries the baked-in PROJMAN wordmark + tagline) with a dark scrim over
/// the lower half so the action group stays readable. Auth-strategy §UI: the
/// three OAuth providers sit prominent in a single row, email as the subtle
/// option below, an Australian signal at the foot.
class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  static const _bg = Color(0xFF0A0F18);

  @override
  Widget build(BuildContext context) {
    final h = MediaQuery.of(context).size.height;
    return Scaffold(
      backgroundColor: _bg,
      body: Stack(
        fit: StackFit.expand,
        children: [
          // Hero photo — its top ~15% holds the baked-in wordmark + tagline.
          // Nudged down 20px so the baked-in logo/wordmark sits lower.
          Transform.translate(
            offset: const Offset(0, 20),
            child: Image.asset('assets/bgimage2.jpeg', fit: BoxFit.cover),
          ),
          // Scrim: clear at the top (don't wash out the baked text), fading to
          // solid navy over the lower half so the controls read on any photo.
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                stops: [0.0, 0.34, 0.60, 1.0],
                colors: [
                  Colors.transparent,
                  Color(0x330A0F18),
                  Color(0xE60A0F18),
                  _bg,
                ],
              ),
            ),
          ),
          SafeArea(
            child: Column(
              children: [
                // Reserve the top 15% for the image's baked-in wordmark.
                SizedBox(height: h * 0.15),
                // Brand image — floorplan (max 500×300, scales down to fit width).
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 500, maxHeight: 300),
                  child: Image.asset('assets/floorplan.png', fit: BoxFit.contain),
                ),
                // Bottom-anchored actions; scrolls up on short screens.
                Expanded(
                  child: SingleChildScrollView(
                    reverse: true,
                    padding: const EdgeInsets.fromLTRB(24, 24, 24, 20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          'Sign up with',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.7),
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            letterSpacing: 0.2,
                          ),
                        ),
                        const SizedBox(height: 12),
                        SocialAuthButtons(onTap: (p) => handleOAuth(context, p)),
                        const SizedBox(height: 18),
                        const OrDivider(),
                        const SizedBox(height: 18),
                        SizedBox(
                          height: 52,
                          child: OutlinedButton(
                            style: OutlinedButton.styleFrom(
                              side: BorderSide(
                                  color: Colors.white.withValues(alpha: 0.28)),
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12)),
                            ),
                            onPressed: () => context.push(AppRoutes.register),
                            child: const Text('Sign up with email',
                                style: TextStyle(
                                    color: Colors.white,
                                    fontSize: 15,
                                    fontWeight: FontWeight.w600)),
                          ),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text('Already have an account?',
                                style: TextStyle(
                                    color: Colors.white.withValues(alpha: 0.6))),
                            TextButton(
                              onPressed: () => context.push(AppRoutes.login),
                              child: const Text('Sign in',
                                  style: TextStyle(color: Color(0xFF60A5FA))),
                            ),
                          ],
                        ),
                        TextButton.icon(
                          onPressed: () => context.push(AppRoutes.joinDevice),
                          icon: Icon(Icons.qr_code_scanner,
                              size: 18,
                              color: Colors.white.withValues(alpha: 0.6)),
                          label: Text('Join with a QR code',
                              style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.6))),
                        ),
                        const SizedBox(height: 10),
                        const Center(child: AuBadge()),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
