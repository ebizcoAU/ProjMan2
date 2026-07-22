import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../config/router.dart';
import '../services/nexus_service.dart';
import '../widgets/auth_scaffold.dart';
import '../widgets/social_auth_buttons.dart';
import '../widgets/auth_extras.dart';

/// Sign in. Auth-strategy §UI: the three OAuth buttons are prominent; email +
/// password sits below a subtle "or". MAOI logged in by 6-digit PIN — ProjMan2
/// uses email + password (projman-01 §6), so that pattern is intentionally not
/// carried.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _obscure = true;
  bool _busy = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final res = await NexusService.login(
      email: _email.text.trim(),
      password: _password.text,
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (res.success) {
      context.go(AppRoutes.home);
    } else {
      showAuthSnack(context, res.friendlyError);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      title: 'Welcome back',
      subtitle: 'Sign in to your ProjMan2 site.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SocialAuthButtons(onTap: (p) => handleOAuth(context, p)),
          const SizedBox(height: 20),
          const OrDivider(),
          const SizedBox(height: 20),
          Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AuthField(
                  controller: _email,
                  label: 'Email',
                  hint: 'you@builder.com.au',
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  validator: validateEmail,
                ),
                const SizedBox(height: 16),
                AuthField(
                  controller: _password,
                  label: 'Password',
                  obscure: _obscure,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _login(),
                  suffix: IconButton(
                    icon: Icon(
                        _obscure ? Icons.visibility_off : Icons.visibility,
                        color: Colors.white54),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                  validator: (v) => (v == null || v.isEmpty)
                      ? 'Enter your password'
                      : null,
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () => context.push(AppRoutes.recovery),
                    child: const Text('Forgot password?',
                        style: TextStyle(color: Color(0xFF60A5FA))),
                  ),
                ),
                const SizedBox(height: 8),
                AuthButton(label: 'Sign in', busy: _busy, onPressed: _login),
              ],
            ),
          ),
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('New to ProjMan2?',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.6))),
              TextButton(
                onPressed: () => context.push(AppRoutes.register),
                child: const Text('Create an account',
                    style: TextStyle(color: Color(0xFF60A5FA))),
              ),
            ],
          ),
          const SizedBox(height: 8),
          const AuBadge(),
        ],
      ),
    );
  }
}
