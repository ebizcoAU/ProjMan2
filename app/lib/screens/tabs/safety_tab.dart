import 'package:flutter/material.dart';
import '_stub_tab.dart';

/// Safety — toolbox talks, inductions, hazard and incident capture. Incident
/// entry must be reachable in two taps from anywhere (development.md §4).
/// Built at P6.
class SafetyTab extends StatelessWidget {
  final int subPage;
  const SafetyTab({super.key, required this.subPage});

  @override
  Widget build(BuildContext context) {
    const labels = ['Safety', 'Incidents', 'Inductions'];
    return StubTabBody(
      icon: Icons.health_and_safety_outlined,
      heading: 'Safety',
      subPageLabel: labels[subPage % labels.length],
      phaseNote: 'P6',
    );
  }
}
