import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../config/router.dart';
import '../services/nexus_service.dart';
import '../services/session_service.dart';

/// Minimal landing for a `client` (customer) user — xprojman-50 §10/§11 F7(b).
/// Clients never see the five staff tabs; the router sends every client
/// session here (see [homeRouteForRole]). Progress sharing comes later.
class ClientHomeScreen extends StatefulWidget {
  const ClientHomeScreen({super.key});

  @override
  State<ClientHomeScreen> createState() => _ClientHomeScreenState();
}

class _ClientHomeScreenState extends State<ClientHomeScreen> {
  Map<String, dynamic>? _user;
  Map<String, dynamic>? _org;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final user = await SessionService.currentUser();
    final org = await SessionService.currentOrg();
    if (!mounted) return;
    setState(() {
      _user = user;
      _org = org;
    });
  }

  Future<void> _signOut() async {
    await NexusService.logout();
    if (!mounted) return;
    context.go(AppRoutes.login);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = _user?['full_name'] as String? ??
        _user?['fullName'] as String? ??
        _user?['name'] as String?;
    final orgName = _org?['name'] as String?;

    return Scaffold(
      appBar: AppBar(title: const Text('ProjMan')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(name == null ? 'Welcome' : 'Welcome, $name',
                  style: theme.textTheme.headlineSmall),
              if (orgName != null) ...[
                const SizedBox(height: 8),
                Text('Your builder: $orgName',
                    style: theme.textTheme.titleMedium),
              ],
              const SizedBox(height: 24),
              Text('Your builder will share progress here soon.',
                  style: theme.textTheme.bodyLarge),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: _signOut,
                  child: const Text('Sign out'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
