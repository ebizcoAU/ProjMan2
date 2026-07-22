import 'package:flutter/material.dart';
import '_stub_tab.dart';

/// Profile — who this device is, what role it holds, sync state
/// (development.md §4). The device identity + sync surface ports from MAOI at P2.
class ProfileTab extends StatelessWidget {
  final int subPage;
  const ProfileTab({super.key, required this.subPage});

  @override
  Widget build(BuildContext context) {
    const labels = ['Profile', 'Device & Sync'];
    return StubTabBody(
      icon: Icons.person_outline,
      heading: 'Profile',
      subPageLabel: labels[subPage % labels.length],
      phaseNote: 'P2',
    );
  }
}
