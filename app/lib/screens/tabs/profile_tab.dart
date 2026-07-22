import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../config/build_config.dart';
import '../../config/router.dart';
import '../../services/session_service.dart';
import '../../services/nexus_service.dart';
import '../../services/device_service.dart';
import '../../services/db_service.dart';

/// Profile — who this device is, what role it holds, sync state (development.md
/// §4). Closes the P2 identity loop: sign in → see your identity → sign out.
/// Two sub-pages cycled by the header title: Profile · Device & Sync.
///
/// Note: the hybrid dark/light theme (appdesignspecification §3 — Profile is dark)
/// is applied at the shell level when the operational tabs are styled (P4); this
/// renders theme-aware so it reads correctly under whichever theme is active now.
class ProfileTab extends StatefulWidget {
  final int subPage;
  const ProfileTab({super.key, required this.subPage});

  @override
  State<ProfileTab> createState() => _ProfileTabState();
}

class _ProfileTabState extends State<ProfileTab> {
  Map<String, dynamic>? _user;
  Map<String, dynamic>? _org;
  Map<String, dynamic>? _device;
  int _pending = 0;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final user = await SessionService.currentUser();
    final org = await SessionService.currentOrg();
    final device = await DeviceService.describe();
    int pending = 0;
    try {
      final rows = await DatabaseService().rawQuery(
        "SELECT COUNT(*) AS n FROM sync_queue WHERE status = 'pending'",
      );
      pending = (rows.first['n'] as int?) ?? 0;
    } catch (_) {}
    if (!mounted) return;
    setState(() {
      _user = user;
      _org = org;
      _device = device;
      _pending = pending;
      _loading = false;
    });
  }

  static String _roleLabel(String? role) {
    switch (role) {
      case 'org_admin':
        return 'Org Admin';
      case 'project_developer':
        return 'Project Developer';
      case 'project_manager':
        return 'Project Manager';
      case 'supervisor':
        return 'Supervisor';
      case 'tradie':
        return 'Tradie';
      case 'inspector':
        return 'Inspector';
      case 'customer':
        return 'Customer';
      default:
        return role == null || role.isEmpty ? '—' : role;
    }
  }

  Future<void> _signOut() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text(
            'You can sign back in any time. Unsynced changes stay queued on '
            'this device.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Sign out')),
        ],
      ),
    );
    if (confirm != true) return;
    await NexusService.logout();
    if (!mounted) return;
    context.go(AppRoutes.welcome);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    return widget.subPage == 0 ? _buildProfile() : _buildDeviceSync();
  }

  // ── Sub-page 0 — Profile ────────────────────────────────────────────────────
  Widget _buildProfile() {
    final name = _user?['full_name'] as String? ??
        _user?['fullName'] as String? ??
        'Signed in';
    final email = _user?['email'] as String? ?? '';
    final mobile = _user?['mobile'] as String? ?? '';
    final role = _roleLabel(_user?['role'] as String?);
    final orgName = _org?['name'] as String? ?? '—';
    final abn = _org?['abn'] as String?;
    final state = _org?['state'] as String?;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _Header(name: name, role: role),
        const SizedBox(height: 16),
        _Section(title: 'You', rows: [
          _InfoRow(Icons.email_outlined, 'Email', email),
          if (mobile.isNotEmpty)
            _InfoRow(Icons.phone_outlined, 'Mobile', mobile),
          _InfoRow(Icons.badge_outlined, 'Role', role),
        ]),
        const SizedBox(height: 12),
        _Section(title: 'Organisation', rows: [
          _InfoRow(Icons.business_outlined, 'Business', orgName),
          if (abn != null && abn.isNotEmpty)
            _InfoRow(Icons.numbers_outlined, 'ABN', abn),
          if (state != null && state.isNotEmpty)
            _InfoRow(Icons.map_outlined, 'State', state),
        ]),
        const SizedBox(height: 24),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(
            foregroundColor: Theme.of(context).colorScheme.error,
            minimumSize: const Size.fromHeight(48),
          ),
          icon: const Icon(Icons.logout),
          label: const Text('Sign out'),
          onPressed: _signOut,
        ),
      ],
    );
  }

  // ── Sub-page 1 — Device & Sync ──────────────────────────────────────────────
  Widget _buildDeviceSync() {
    final deviceName = _device?['device_name'] as String? ?? 'This device';
    final platform = _device?['platform'] as String? ?? '';
    final model = _device?['model'] as String? ?? '';
    final appVersion = _device?['app_version'] as String? ?? '';
    final role = _roleLabel(_user?['role'] as String?);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _SyncChip(pending: _pending),
        const SizedBox(height: 16),
        _Section(title: 'This device', rows: [
          _InfoRow(Icons.smartphone_outlined, 'Name', deviceName),
          if (platform.isNotEmpty)
            _InfoRow(Icons.devices_outlined, 'Platform',
                model.isEmpty ? platform : '$platform · $model'),
          _InfoRow(Icons.badge_outlined, 'Device role', role),
          _InfoRow(Icons.info_outline, 'App', '$APP_NAME $appVersion'),
        ]),
        const SizedBox(height: 16),
        FilledButton.icon(
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          icon: const Icon(Icons.qr_code_2),
          label: const Text('Pair a device'),
          // Intra-org device pairing (projman-01 §1.3) — buildable now
          // (projman-02 §9). The pairing flow lands in the next increment.
          onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Device pairing arrives in the next update.'),
              behavior: SnackBarBehavior.floating,
            ),
          ),
        ),
      ],
    );
  }
}

// ── Small building blocks ─────────────────────────────────────────────────────

class _Header extends StatelessWidget {
  final String name;
  final String role;
  const _Header({required this.name, required this.role});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final initials = name.trim().isEmpty
        ? '?'
        : name.trim().split(RegExp(r'\s+')).take(2).map((w) => w[0]).join();
    return Row(
      children: [
        CircleAvatar(
          radius: 28,
          backgroundColor: scheme.primary.withValues(alpha: 0.15),
          child: Text(initials.toUpperCase(),
              style: TextStyle(
                  color: scheme.primary,
                  fontWeight: FontWeight.w800,
                  fontSize: 18)),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(name,
                  style: Theme.of(context).textTheme.titleLarge,
                  overflow: TextOverflow.ellipsis),
              const SizedBox(height: 2),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: scheme.primary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(role,
                    style: TextStyle(
                        color: scheme.primary,
                        fontSize: 12,
                        fontWeight: FontWeight.w600)),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  final String title;
  final List<Widget> rows;
  const _Section({required this.title, required this.rows});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 6),
          child: Text(title.toUpperCase(),
              style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.5,
                  color: Theme.of(context)
                      .colorScheme
                      .onSurface
                      .withValues(alpha: 0.5))),
        ),
        Card(
          margin: EdgeInsets.zero,
          child: Column(children: rows),
        ),
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  const _InfoRow(this.icon, this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return ListTile(
      dense: true,
      leading: Icon(icon, size: 20),
      title: Text(label,
          style: TextStyle(
              fontSize: 13,
              color:
                  Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6))),
      trailing: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 200),
        child: Text(value,
            textAlign: TextAlign.right,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w600)),
      ),
    );
  }
}

class _SyncChip extends StatelessWidget {
  final int pending;
  const _SyncChip({required this.pending});

  @override
  Widget build(BuildContext context) {
    final synced = pending == 0;
    final color = synced ? const Color(0xFF34D399) : const Color(0xFFF59E0B);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Icon(synced ? Icons.cloud_done_outlined : Icons.cloud_upload_outlined,
              color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              synced
                  ? 'All changes synced'
                  : '$pending change${pending == 1 ? '' : 's'} waiting to sync',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}
