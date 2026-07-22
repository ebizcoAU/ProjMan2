import 'package:flutter/material.dart';
import '_stub_tab.dart';

/// Site — the daily driver. Today = attendance + what's programmed + deliveries.
/// Site Diary is the end-of-day entry, the app's most important feature
/// (development.md §4). Built at P5.
class SiteTab extends StatelessWidget {
  final int subPage;
  const SiteTab({super.key, required this.subPage});

  @override
  Widget build(BuildContext context) {
    const labels = ['Today', 'Site Diary', 'Attendance'];
    return StubTabBody(
      icon: Icons.today_outlined,
      heading: 'Site',
      subPageLabel: labels[subPage % labels.length],
      phaseNote: 'P5',
    );
  }
}
