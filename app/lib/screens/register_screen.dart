import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../config/router.dart';
import '../services/nexus_service.dart';
import '../widgets/auth_scaffold.dart';
import '../widgets/social_auth_buttons.dart';
import '../widgets/auth_extras.dart';
import '../widgets/onboarding_fields.dart';

/// Create an account (email path). Two steps: (1) the account — OAuth or email;
/// (2) the business — AU onboarding (ABN optional in v1, state, business type,
/// GST). Submits `/auth/register` then `/auth/onboarding` (projman-01 §1.1/§1.8).
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  int _step = 0; // 0 = account, 1 = role, 2 = business
  bool _busy = false;
  // v1 App self-registration surfaces one self-registrable role: Builder
  // (xprojman-13/14 Fork A). Sent as user.role on /auth/register; the server's
  // allow-list also permits projectManager/developer, but those register on the
  // web Portal, not here.
  final String _role = 'builder';

  // Step 1 — account
  final _accountForm = GlobalKey<FormState>();
  final _fullName = TextEditingController();
  final _email = TextEditingController();
  final _mobile = TextEditingController();
  final _password = TextEditingController();
  bool _obscure = true;

  // Step 2 — business
  final _businessForm = GlobalKey<FormState>();
  final _orgName = TextEditingController();
  final _abn = TextEditingController();
  String _state = 'WA';
  String _businessType = 'Sole Trader';
  bool _gstRegistered = false;

  @override
  void dispose() {
    for (final c in [_fullName, _email, _mobile, _password, _orgName, _abn]) {
      c.dispose();
    }
    super.dispose();
  }

  void _next() {
    if (_accountForm.currentState!.validate()) {
      setState(() => _step = 1); // account → role
    }
  }

  void _toBusiness() {
    // Default the business name to the person's own name — a sole-trader Builder
    // shouldn't have to invent a separate company name (xprojman-13 §5).
    if (_orgName.text.trim().isEmpty) {
      _orgName.text = _fullName.text.trim();
    }
    setState(() => _step = 2); // role → business
  }

  Future<void> _submit() async {
    if (!_businessForm.currentState!.validate()) return;
    setState(() => _busy = true);

    // 1. Create org + first user → session (§1.1).
    final reg = await NexusService.register(
      organisation: {
        'name': _orgName.text.trim(),
        if (_abn.text.trim().isNotEmpty)
          'abn': _abn.text.replaceAll(RegExp(r'\s'), ''),
        'state': _state,
      },
      user: {
        'full_name': _fullName.text.trim(),
        'email': _email.text.trim(),
        'password': _password.text,
        'mobile': _mobile.text.replaceAll(RegExp(r'\s'), ''),
        // Fork A — self-register with the chosen fixed role (xprojman-14 §2).
        // Omitting it would default to projectManager server-side.
        'role': _role,
      },
    );
    if (!mounted) return;
    if (!reg.success) {
      setState(() => _busy = false);
      showAuthSnack(context, reg.friendlyError);
      if (reg.code == 'DUPLICATE_EMAIL') setState(() => _step = 0);
      return;
    }

    // 2. Complete AU onboarding — business_type mapped to the server enum (§1.8).
    final ob = await NexusService.onboarding(
      state: _state,
      businessType: businessTypeToEnum[_businessType]!,
      gstRegistered: _gstRegistered,
      abn: _abn.text,
    );
    if (!mounted) return;
    setState(() => _busy = false);
    // The session is live either way; if onboarding hiccups, proceed and let the
    // user finish it later rather than trapping them at signup.
    if (!ob.success) showAuthSnack(context, ob.friendlyError);
    context.go(AppRoutes.home);
  }

  @override
  Widget build(BuildContext context) {
    const titles = ['Create your account', 'Your role', 'About your business'];
    const subtitles = [
      'Sign up in a minute. Your details stay in Australia.',
      'This is the role you hold on ProjMan. It stays with your account.',
      'A few Australian basics. ABN is optional for now.',
    ];
    return AuthScaffold(
      title: titles[_step],
      // Business-step heading: 1px smaller, not bold (owner request).
      titleStyle: _step == 2
          ? const TextStyle(
              color: Colors.white,
              fontSize: 27,
              fontWeight: FontWeight.w500,
              letterSpacing: -0.3)
          : null,
      // Back steps one page; on the first step it exits (pop → welcome/login).
      onBack: _step == 0 ? null : () => setState(() => _step -= 1),
      subtitle: subtitles[_step],
      child: _step == 0
          ? _buildAccountStep()
          : _step == 1
              ? _buildRoleStep()
              : _buildBusinessStep(),
    );
  }

  Widget _buildAccountStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SocialAuthButtons(onTap: (p) => handleOAuth(context, p)),
        const SizedBox(height: 20),
        const OrDivider(),
        const SizedBox(height: 20),
        Form(
          key: _accountForm,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AuthField(
                controller: _fullName,
                label: 'Full name',
                hint: 'Dave Nguyen',
                textInputAction: TextInputAction.next,
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Enter your name' : null,
              ),
              const SizedBox(height: 16),
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
                controller: _mobile,
                label: 'Mobile',
                hint: '+61 4xx xxx xxx',
                keyboardType: TextInputType.phone,
                textInputAction: TextInputAction.next,
                validator: (v) => validateAuMobile(v),
              ),
              const SizedBox(height: 16),
              AuthField(
                controller: _password,
                label: 'Password',
                hint: 'At least 10 characters',
                obscure: _obscure,
                validator: validatePassword,
                suffix: IconButton(
                  icon: Icon(
                      _obscure ? Icons.visibility_off : Icons.visibility,
                      color: Colors.white54),
                  onPressed: () => setState(() => _obscure = !_obscure),
                ),
              ),
              const SizedBox(height: 20),
              AuthButton(label: 'Continue', onPressed: _next),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text('Already have an account?',
                style: TextStyle(color: Colors.white.withValues(alpha: 0.6))),
            TextButton(
              onPressed: () => context.pushReplacement(AppRoutes.login),
              child: const Text('Sign in',
                  style: TextStyle(color: Color(0xFF60A5FA))),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildRoleStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Single self-registrable App role in v1 — Builder. Crew (site supervisor /
        // foreperson / tradie / inspector) join a builder's team by pairing a
        // device and are not self-registrable yet (PM2-02); PMs use the Portal.
        const _RoleCard(
          icon: Icons.construction,
          title: "I'm a Builder",
          subtitle: 'You run your own building business and take on projects. '
              'Registering creates your business and makes you its admin.',
        ),
        const SizedBox(height: 16),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.info_outline,
                size: 18, color: Colors.white.withValues(alpha: 0.5)),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'Site supervisors, forepersons, tradies and inspectors join a '
                "builder's team by pairing a device. Project managers register on "
                'the web portal.',
                style: TextStyle(
                    fontSize: 12.5,
                    height: 1.35,
                    color: Colors.white.withValues(alpha: 0.6)),
              ),
            ),
          ],
        ),
        const SizedBox(height: 24),
        AuthButton(label: 'Continue', onPressed: _toBusiness),
      ],
    );
  }

  Widget _buildBusinessStep() {
    return Form(
      key: _businessForm,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AuthField(
            controller: _orgName,
            label: 'Business name',
            hint: 'Nguyen Building Co',
            textInputAction: TextInputAction.next,
            validator: (v) => (v == null || v.trim().isEmpty)
                ? 'Enter your business name'
                : null,
          ),
          const SizedBox(height: 16),
          AuthField(
            controller: _abn,
            label: 'ABN (optional)',
            hint: '11 digits',
            keyboardType: TextInputType.number,
            validator: validateAbnOptional,
          ),
          const SizedBox(height: 16),
          AppDropdownField(
            label: 'State',
            value: _state,
            items: auStates,
            onChanged: (v) => setState(() => _state = v!),
          ),
          const SizedBox(height: 16),
          AppDropdownField(
            label: 'Business type',
            value: _businessType,
            items: businessTypeLabels,
            onChanged: (v) => setState(() => _businessType = v!),
          ),
          const SizedBox(height: 16),
          GstToggle(
            value: _gstRegistered,
            onChanged: (v) => setState(() => _gstRegistered = v),
          ),
          const SizedBox(height: 24),
          AuthButton(
              label: 'Create account', busy: _busy, onPressed: _submit),
        ],
      ),
    );
  }
}

/// A single, pre-selected role option on the dark auth scaffold. v1 shows only
/// one (Builder), so it's presentational — it states the role rather than
/// offering a choice. When PM2-02 opens crew self-registration this becomes a
/// selectable list.
class _RoleCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  const _RoleCard(
      {required this.icon, required this.title, required this.subtitle});

  @override
  Widget build(BuildContext context) {
    const accent = Color(0xFF60A5FA);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: accent, width: 1.5),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: accent.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: accent),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                Text(subtitle,
                    style: TextStyle(
                        fontSize: 13,
                        height: 1.35,
                        color: Colors.white.withValues(alpha: 0.7))),
              ],
            ),
          ),
          const SizedBox(width: 8),
          const Icon(Icons.check_circle, color: accent, size: 22),
        ],
      ),
    );
  }
}
