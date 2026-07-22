import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../config/build_config.dart';
import '../config/router.dart';
import '../widgets/social_auth_buttons.dart';
import '../widgets/auth_extras.dart';

/// First-run welcome. Auth-strategy §UI: OAuth buttons prominent, email as the
/// subtle "or" below, an Australian signal. Tapping a provider (skin) or
/// "Sign up with email" leads into the account flow.
class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  static const _bg = Color(0xFF0A0F18);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 48),
              const Text(
                APP_NAME,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 48,
                  fontWeight: FontWeight.w800,
                  color: Colors.white,
                  letterSpacing: -1,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'On schedule, on budget, delivered.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14,
                  color: Colors.white.withValues(alpha: 0.55),
                ),
              ),
              const SizedBox(height: 48),
              SocialAuthButtons(onTap: (p) => handleOAuth(context, p)),
              const SizedBox(height: 20),
              const OrDivider(),
              const SizedBox(height: 20),
              SizedBox(
                height: 52,
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    side: BorderSide(
                        color: Colors.white.withValues(alpha: 0.25)),
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
              const SizedBox(height: 20),
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
              const SizedBox(height: 24),
              const AuBadge(),
            ],
          ),
        ),
      ),
    );
  }
}
