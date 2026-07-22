import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../config/router.dart';
import '../services/nexus_service.dart';
import '../widgets/auth_scaffold.dart';
import '../widgets/auth_extras.dart';
import '../widgets/onboarding_fields.dart';

/// AU onboarding after a first sign-in (projman-01 §1.8). Shown when the server
/// returns `onboardingRequired: true` — chiefly the OAuth-new-user path, where the
/// org was auto-created and needs its Australian basics. Posts `/auth/onboarding`.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _formKey = GlobalKey<FormState>();
  final _orgName = TextEditingController();
  final _abn = TextEditingController();
  String _state = 'WA';
  String _businessType = 'Sole Trader';
  bool _gstRegistered = false;
  bool _busy = false;

  @override
  void dispose() {
    _orgName.dispose();
    _abn.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final res = await NexusService.onboarding(
      organisationName: _orgName.text,
      state: _state,
      businessType: businessTypeToEnum[_businessType]!,
      gstRegistered: _gstRegistered,
      abn: _abn.text,
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
      title: 'About your business',
      subtitle: 'A few Australian basics. ABN is optional for now.',
      showBack: false,
      child: Form(
        key: _formKey,
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
            AuthButton(label: 'Finish setup', busy: _busy, onPressed: _submit),
          ],
        ),
      ),
    );
  }
}
