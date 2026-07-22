import 'package:flutter/material.dart';
import '_stub_tab.dart';

/// Quality — inspection checklists and hold points, defect list with photos,
/// certificate upload. An open hold point blocks its stage (development.md §4,
/// §5.6). Built at P6.
class QualityTab extends StatelessWidget {
  final int subPage;
  const QualityTab({super.key, required this.subPage});

  @override
  Widget build(BuildContext context) {
    const labels = ['Inspections', 'Defects', 'Certificates'];
    return StubTabBody(
      icon: Icons.fact_check_outlined,
      heading: 'Quality',
      subPageLabel: labels[subPage % labels.length],
      phaseNote: 'P6',
    );
  }
}
