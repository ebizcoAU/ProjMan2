import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../config/app_theme.dart';
import '../../config/router.dart';
import '../../models/domain.dart';
import '../../services/project_service.dart';
import '../../services/permissions_service.dart';

/// Projects — the PM's jobs; tap one to open its 18-stage tracker. "New project"
/// starts Stage 1 (create). Light operational theme (appspec Decision 1). Costs
/// and the per-project programme live inside the detail screen.
class ProjectsTab extends StatefulWidget {
  final int subPage;
  const ProjectsTab({super.key, required this.subPage});

  @override
  State<ProjectsTab> createState() => _ProjectsTabState();
}

class _ProjectsTabState extends State<ProjectsTab> {
  List<Project> _projects = [];
  bool _loading = true;
  // Whether to show "New project". Gated on projects.write — PM always; builder
  // once the server grants it (xprojman-17 Q1, matrix v8). Defaults true so a cold
  // OFFLINE launch never strips create from a PM (Stage-1 is offline-first); we
  // only hide once permissions have loaded and confirm the role lacks it.
  bool _canCreate = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final p = await ProjectService.list();
    await PermissionsService.instance.ensureLoaded();
    final perms = PermissionsService.instance;
    // Unknown (offline / not yet loaded) → keep the button; known → honour
    // projects.write so crew who'd only get FORBIDDEN don't see a dead action.
    final canCreate = !perms.loaded || perms.has('projects.write');
    if (!mounted) return;
    setState(() {
      _projects = p;
      _canCreate = canCreate;
      _loading = false;
    });
  }

  Future<void> _newProject() async {
    await context.push(AppRoutes.projectCreate);
    if (mounted) _load(); // refresh on return
  }

  Future<void> _open(Project p) async {
    await context.push(AppRoutes.projectDetail, extra: p.id);
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Op.bg,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: Row(
              children: [
                const Text('Projects',
                    style: TextStyle(
                        color: Op.text,
                        fontSize: 20,
                        fontWeight: FontWeight.w800)),
                const Spacer(),
                if (_canCreate)
                  FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: Op.accent,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: _newProject,
                    icon: const Icon(Icons.add, size: 20),
                    label: const Text('New project'),
                  ),
              ],
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(
                    child: CircularProgressIndicator(color: Op.accent))
                : RefreshIndicator(
                    onRefresh: _load,
                    child: _projects.isEmpty ? _empty() : _list(),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _empty() {
    // canCreate (PM, or a Builder running their own business) → create your own
    // jobs. Otherwise (crew) work arrives when the company adds you to a project —
    // cross-company engagement is PM2-02, not v1 (xprojman-17 Q2).
    final hint = _canCreate
        ? 'Tap “New project” to create a job for your business.'
        : 'You’ll see jobs here once your company adds you to a project.';
    return ListView(
      children: [
        const SizedBox(height: 96),
        const Icon(Icons.folder_open_outlined, size: 56, color: Op.muted),
        const SizedBox(height: 12),
        const Center(
          child: Text('No projects yet',
              style: TextStyle(
                  color: Op.text, fontSize: 16, fontWeight: FontWeight.w700)),
        ),
        const SizedBox(height: 4),
        Center(
          child: Text(hint,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Op.muted, fontSize: 13)),
        ),
      ],
    );
  }

  Widget _list() {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      itemCount: _projects.length,
      itemBuilder: (_, i) => _card(_projects[i]),
    );
  }

  Widget _card(Project p) {
    return InkWell(
      onTap: () => _open(p),
      borderRadius: BorderRadius.circular(14),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Op.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Op.border),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    if (p.code != null) ...[
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 7, vertical: 2),
                        decoration: BoxDecoration(
                            color: Op.bg,
                            borderRadius: BorderRadius.circular(6)),
                        child: Text(p.code!,
                            style: const TextStyle(
                                color: Op.muted,
                                fontSize: 11,
                                fontWeight: FontWeight.w700)),
                      ),
                      const SizedBox(width: 8),
                    ],
                    Text((p.status ?? 'active').replaceAll('_', ' '),
                        style: const TextStyle(color: Op.muted, fontSize: 12)),
                  ]),
                  const SizedBox(height: 8),
                  Text(p.name,
                      style: const TextStyle(
                          color: Op.text,
                          fontSize: 15,
                          fontWeight: FontWeight.w700)),
                  if (p.customerName != null) ...[
                    const SizedBox(height: 2),
                    Text(p.customerName!,
                        style: const TextStyle(color: Op.muted, fontSize: 13)),
                  ],
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: Op.muted),
          ],
        ),
      ),
    );
  }
}
