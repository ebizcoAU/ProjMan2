import 'package:flutter/material.dart';
import '_stub_tab.dart';

/// Projects — assigned jobs; detail shows stages, tasks, % complete. Costs is
/// read-only on mobile (development.md §4). Built at P4.
class ProjectsTab extends StatelessWidget {
  final int subPage;
  const ProjectsTab({super.key, required this.subPage});

  @override
  Widget build(BuildContext context) {
    const labels = ['Projects', 'Programme', 'Costs'];
    return StubTabBody(
      icon: Icons.folder_outlined,
      heading: 'Projects',
      subPageLabel: labels[subPage % labels.length],
      phaseNote: 'P4',
    );
  }
}
