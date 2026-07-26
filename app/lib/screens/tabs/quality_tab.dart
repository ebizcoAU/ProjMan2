import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../config/app_theme.dart';
import '../../config/providers.dart';
import '../../models/domain.dart';
import '../../services/project_service.dart';
import '../quality/quality_inspections_view.dart';
import '../quality/quality_defects_view.dart';
import '../quality/quality_certificates_view.dart';

/// Quality — inspections · defects · certificates (P6a, appspec §5.5,
/// servdesignspec §12). Project-scoped, same pattern as [SiteTab]: pick a job,
/// then work Inspections · Defects · Certificates (the header cycles the
/// three via [subPage]). This is the Inspector's only tab (appspec §5.5) —
/// enforcement is by permission (`quality.write`/`quality.validate` via
/// `PermissionsService`), this shell is just the shared shape.
class QualityTab extends ConsumerStatefulWidget {
  final int subPage;
  const QualityTab({super.key, required this.subPage});

  @override
  ConsumerState<QualityTab> createState() => _QualityTabState();
}

class _QualityTabState extends ConsumerState<QualityTab> {
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
    final active = ref.read(activeQualityProjectProvider);
    final stillValid = active != null && p.any((x) => x.id == active.id);
    if (!stillValid) {
      ref.read(activeQualityProjectProvider.notifier).state =
          p.length == 1 ? p.first : null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final active = ref.watch(activeQualityProjectProvider);

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
        return QualityDefectsView(project: p);
      case 2:
        return QualityCertificatesView(project: p);
      default:
        return QualityInspectionsView(project: p);
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
          const Icon(Icons.fact_check_outlined, size: 20, color: Op.accent),
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
                              color: Op.text,
                              fontSize: 15,
                              fontWeight: FontWeight.w700)),
                    ),
                ],
                onChanged: (id) {
                  final p = _projects.firstWhere((x) => x.id == id);
                  ref.read(activeQualityProjectProvider.notifier).state = p;
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
          Icon(Icons.fact_check_outlined, size: 56, color: Op.muted),
          SizedBox(height: 12),
          Center(
            child: Text('Pick a job',
                style: TextStyle(
                    color: Op.text, fontSize: 16, fontWeight: FontWeight.w700)),
          ),
          SizedBox(height: 4),
          Center(
            child: Text(
                'Choose a job above to run inspections, track defects\n'
                'and manage certificates.',
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
