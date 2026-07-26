import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../config/app_theme.dart';
import '../../config/providers.dart';
import '../../models/domain.dart';
import '../../services/project_service.dart';
import '../site/site_today_view.dart';
import '../site/site_diary_view.dart';
import '../site/site_attendance_view.dart';

/// Site — the daily driver (appspec §5.3). Project-scoped: the supervisor picks
/// today's job, then works Today · Site Diary · Attendance (the header cycles the
/// three via [subPage]). Light operational theme (Decision 1).
///
/// P5 parallel-prep UI: fully interactive in-session via [SiteOpsService]; the
/// sync-push wiring lands once `servdesignspec §11` (migration v008) is signed
/// off (see the service SEAM note).
class SiteTab extends ConsumerStatefulWidget {
  final int subPage;
  const SiteTab({super.key, required this.subPage});

  @override
  ConsumerState<SiteTab> createState() => _SiteTabState();
}

class _SiteTabState extends ConsumerState<SiteTab> {
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
    // Auto-select when there's exactly one job, or keep a valid prior selection.
    final active = ref.read(activeSiteProjectProvider);
    final stillValid = active != null && p.any((x) => x.id == active.id);
    if (!stillValid) {
      ref.read(activeSiteProjectProvider.notifier).state =
          p.length == 1 ? p.first : null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final active = ref.watch(activeSiteProjectProvider);

    if (_loading) {
      return Container(
        color: Op.bg,
        child: const Center(child: CircularProgressIndicator(color: Op.accent)),
      );
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
        return SiteDiaryView(project: p);
      case 2:
        return SiteAttendanceView(project: p);
      default:
        return SiteTodayView(project: p);
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
          const Icon(Icons.location_on_outlined, size: 20, color: Op.accent),
          const SizedBox(width: 8),
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                isExpanded: true,
                value: active?.id,
                hint: const Text('Select today’s site',
                    style: TextStyle(color: Op.muted, fontSize: 15)),
                icon: const Icon(Icons.expand_more, color: Op.muted),
                items: [
                  for (final p in _projects)
                    DropdownMenuItem(
                      value: p.id,
                      child: Text(p.name,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              color: Op.text,
                              fontSize: 15,
                              fontWeight: FontWeight.w700)),
                    ),
                ],
                onChanged: (id) {
                  final p = _projects.firstWhere((x) => x.id == id);
                  ref.read(activeSiteProjectProvider.notifier).state = p;
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
          Icon(Icons.today_outlined, size: 56, color: Op.muted),
          SizedBox(height: 12),
          Center(
            child: Text('Pick today’s site',
                style: TextStyle(
                    color: Op.text, fontSize: 16, fontWeight: FontWeight.w700)),
          ),
          SizedBox(height: 4),
          Center(
            child: Text(
                'Choose a job above to log attendance, deliveries and\n'
                'the site diary.',
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
                  style: TextStyle(
                      color: Op.text,
                      fontSize: 16,
                      fontWeight: FontWeight.w700)),
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
