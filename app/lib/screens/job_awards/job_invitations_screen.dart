import 'package:flutter/material.dart';
import '../../services/nexus_service.dart';
import '../../widgets/auth_scaffold.dart';
import '../../widgets/auth_extras.dart';

/// Job invitations — the S9.7 accept/decline tap (appdesignspecification.md
/// §4.2 / §2.3). A PM (from their Portal contact book) formally invites this
/// person onto a project with a role; here they receive it and accept or
/// decline. Identity-level, cross-project (you aren't a member of the project
/// until you accept) — so it lives under Profile alongside Introduction, not
/// inside any one project.
///
/// The invitation LIST rides a proposed `GET /job-awards/pending` that isn't
/// built yet (see `NexusService.pendingJobAwards`); until the Server Agent ships
/// it the inbox reads empty. The accept/decline action rides the real,
/// confirmed `.../respond` endpoint.
class JobInvitationsScreen extends StatefulWidget {
  const JobInvitationsScreen({super.key});

  @override
  State<JobInvitationsScreen> createState() => _JobInvitationsScreenState();
}

class _JobInvitationsScreenState extends State<JobInvitationsScreen> {
  List<JobInvitation> _pending = [];
  bool _loading = true;
  String? _busyId; // the award currently being responded to

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final res = await NexusService.pendingJobAwards();
    if (!mounted) return;
    setState(() {
      _pending = res.success
          ? ((res.data['pending'] as List?) ?? const [])
              .map((j) => JobInvitation.fromJson(Map<String, dynamic>.from(j as Map)))
              .toList()
          : const [];
      _loading = false;
    });
  }

  Future<void> _respond(JobInvitation inv, bool accept) async {
    setState(() => _busyId = inv.id);
    final res = await NexusService.respondJobAward(
      projectId: inv.projectId,
      jobAwardId: inv.id,
      accept: accept,
    );
    if (!mounted) return;
    setState(() => _busyId = null);
    if (!res.success) {
      showAuthSnack(context, res.friendlyError);
      return;
    }
    showAuthSnack(
      context,
      accept
          ? 'Accepted — you\'re now on ${inv.projectName ?? 'the project'} as ${inv.roleLabel}.'
          : 'Declined.',
    );
    setState(() => _pending.removeWhere((p) => p.id == inv.id));
  }

  @override
  Widget build(BuildContext context) {
    return AuthScaffold(
      title: 'Job invitations',
      subtitle:
          'Projects a manager has invited you to join. Accepting adds you to '
          'the project team.',
      child: _loading
          ? const Center(
              child: Padding(
              padding: EdgeInsets.all(32),
              child: CircularProgressIndicator(),
            ))
          : _pending.isEmpty
              ? _empty()
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final inv in _pending) _card(inv),
                  ],
                ),
    );
  }

  Widget _empty() => Padding(
        padding: const EdgeInsets.only(top: 24),
        child: Column(
          children: [
            Icon(Icons.mark_email_read_outlined,
                size: 56, color: Colors.white.withValues(alpha: 0.3)),
            const SizedBox(height: 12),
            Text('No pending invitations',
                style: TextStyle(color: Colors.white.withValues(alpha: 0.8))),
            const SizedBox(height: 4),
            Text('When a manager invites you to a project, it shows up here.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white.withValues(alpha: 0.45), fontSize: 12)),
          ],
        ),
      );

  Widget _card(JobInvitation inv) {
    final busy = _busyId == inv.id;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF141B29),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(inv.projectName ?? 'A project',
              style: const TextStyle(
                  color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(
            '${inv.fromName ?? 'A manager'} invited you as ${inv.roleLabel}'
            '${inv.engagementLabel != null ? ' · ${inv.engagementLabel}' : ''}',
            style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 13),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.white,
                    side: BorderSide(color: Colors.white.withValues(alpha: 0.25)),
                    minimumSize: const Size.fromHeight(48),
                  ),
                  onPressed: busy ? null : () => _respond(inv, false),
                  child: const Text('Decline'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: AuthButton(
                  label: 'Accept',
                  busy: busy,
                  onPressed: () => _respond(inv, true),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A pending Job Award addressed to this user (tolerant reader — the discovery
/// endpoint's exact fields are proposed, not yet confirmed, so every display
/// field degrades gracefully if absent).
class JobInvitation {
  final String id;
  final String projectId;
  final String? projectName;
  final String? fromName;
  final String roleOffered;
  final String? builderEngagementType;

  const JobInvitation({
    required this.id,
    required this.projectId,
    this.projectName,
    this.fromName,
    required this.roleOffered,
    this.builderEngagementType,
  });

  String get roleLabel => switch (roleOffered) {
        'builder' => 'Builder',
        'tradie' => 'Tradie',
        'foreperson' => 'Foreman',
        'subcontractor' => 'Subcontractor',
        _ => roleOffered,
      };

  String? get engagementLabel => switch (builderEngagementType) {
        'employee' => 'Employee',
        'independent_fixed' => 'Fixed price',
        'independent_cost_plus' => 'Cost plus',
        _ => null,
      };

  static JobInvitation fromJson(Map<String, dynamic> j) => JobInvitation(
        id: (j['id'] ?? '').toString(),
        projectId: (j['project_id'] ?? '').toString(),
        projectName: j['project_name']?.toString(),
        fromName: (j['from_name'] ?? j['from_full_name'])?.toString(),
        roleOffered: (j['role_offered'] ?? '').toString(),
        builderEngagementType: j['builder_engagement_type']?.toString(),
      );
}
