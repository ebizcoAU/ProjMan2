import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../config/app_theme.dart';
import '../../config/providers.dart';
import '../../models/domain.dart';
import '../../services/project_service.dart';
import '../../services/safety_ops_service.dart';
import '../safety/safety_entries_view.dart';

/// Safety — hazard capture, incident capture, inductions (development.md §4:
/// incident entry must be reachable in two taps from anywhere — the tab
/// itself + Raise is exactly two). **Hazards/Incidents subpages are a UI
/// mockup** (`SafetyOpsService`, in-memory, no schema/API) per the owner's
/// 2026-09-03 "mockup before wiring" directive — see that service's header
/// and `appdesignspecification.md` §9 module 5 / `xprojman-28.md` §5 for why
/// (no `hazards`/`incidents` table exists anywhere yet). Inductions
/// (toolbox talks / JSA / SWMS sign-on) is a separate, still-unscoped concept
/// — left as a placeholder, not part of this pass. Same project-scoped shell
/// pattern as [QualityTab]/[SiteTab].
class SafetyTab extends ConsumerStatefulWidget {
  final int subPage;
  const SafetyTab({super.key, required this.subPage});

  @override
  ConsumerState<SafetyTab> createState() => _SafetyTabState();
}

class _SafetyTabState extends ConsumerState<SafetyTab> {
  List<Project> _projects = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final p = await ProjectService.list();
    if (!mounted) return;
    setState(() {
      _projects = p;
      _loading = false;
    });
    final active = ref.read(activeSafetyProjectProvider);
    final stillValid = active != null && p.any((x) => x.id == active.id);
    if (!stillValid) {
      ref.read(activeSafetyProjectProvider.notifier).state =
          p.length == 1 ? p.first : null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final active = ref.watch(activeSafetyProjectProvider);

    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: Op.accent));
    }
    if (_projects.isEmpty) return _noProjects();

    return Container(
      color: Op.bg,
      child: Column(
        children: [
          _projectSelector(active),
          if (active == null)
            Expanded(child: _pickPrompt())
          else
            Expanded(child: _subPage(active)),
        ],
      ),
    );
  }

  Widget _subPage(Project p) {
    switch (widget.subPage % 3) {
      case 1:
        return SafetyEntriesView(project: p, kind: SafetyKind.incident);
      case 2:
        return const _InductionsPlaceholder();
      default:
        return SafetyEntriesView(project: p, kind: SafetyKind.hazard);
    }
  }

  Widget _projectSelector(Project? active) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      decoration: const BoxDecoration(
        color: Op.surface,
        border: Border(bottom: BorderSide(color: Op.border)),
      ),
      child: Row(
        children: [
          const Icon(Icons.health_and_safety_outlined, size: 20, color: Op.accent),
          const SizedBox(width: 8),
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                isExpanded: true,
                value: active?.id,
                hint: const Text('Select a job',
                    style: TextStyle(color: Op.muted, fontSize: 15)),
                icon: const Icon(Icons.expand_more, color: Op.muted),
                items: [
                  for (final p in _projects)
                    DropdownMenuItem(
                      value: p.id,
                      child: Text(p.name,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              color: Op.text, fontSize: 15, fontWeight: FontWeight.w700)),
                    ),
                ],
                onChanged: (id) {
                  final p = _projects.firstWhere((x) => x.id == id);
                  ref.read(activeSafetyProjectProvider.notifier).state = p;
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _pickPrompt() => ListView(
        children: const [
          SizedBox(height: 96),
          Icon(Icons.health_and_safety_outlined, size: 56, color: Op.muted),
          SizedBox(height: 12),
          Center(
            child: Text('Pick a job',
                style: TextStyle(color: Op.text, fontSize: 16, fontWeight: FontWeight.w700)),
          ),
          SizedBox(height: 4),
          Center(
            child: Text('Choose a job above to log hazards and incidents.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Op.muted, fontSize: 13)),
          ),
        ],
      );

  Widget _noProjects() => Container(
        color: Op.bg,
        child: ListView(
          children: const [
            SizedBox(height: 96),
            Icon(Icons.folder_open_outlined, size: 56, color: Op.muted),
            SizedBox(height: 12),
            Center(
              child: Text('No projects yet',
                  style: TextStyle(color: Op.text, fontSize: 16, fontWeight: FontWeight.w700)),
            ),
            SizedBox(height: 4),
            Center(
              child: Text('Create a job in the Projects tab first.',
                  style: TextStyle(color: Op.muted, fontSize: 13)),
            ),
          ],
        ),
      );
}

class _InductionsPlaceholder extends StatelessWidget {
  const _InductionsPlaceholder();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: const [
        SizedBox(height: 72),
        Icon(Icons.groups_outlined, size: 52, color: Op.muted),
        SizedBox(height: 12),
        Center(
          child: Text('Inductions',
              style: TextStyle(color: Op.text, fontSize: 16, fontWeight: FontWeight.w700)),
        ),
        SizedBox(height: 8),
        Center(
          child: Text(
            'Toolbox talks, JSA/SWMS sign-on. Not scoped yet — a separate '
            'design pass from hazard/incident capture, out of this mockup.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Op.muted, fontSize: 13),
          ),
        ),
      ],
    );
  }
}
