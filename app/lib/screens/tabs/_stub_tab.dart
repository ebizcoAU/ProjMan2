import 'package:flutter/material.dart';

/// Shared placeholder body for the P1 tab stubs. Each real tab replaces this
/// with its capture-first UI in the phase noted on the card (development.md §7).
class StubTabBody extends StatelessWidget {
  final IconData icon;
  final String heading;
  final String subPageLabel;
  final String phaseNote;

  const StubTabBody({
    super.key,
    required this.icon,
    required this.heading,
    required this.subPageLabel,
    required this.phaseNote,
  });

  @override
  Widget build(BuildContext context) {
    final muted =
        Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.55);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 56, color: muted),
            const SizedBox(height: 16),
            Text(subPageLabel,
                style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 6),
            Text('$heading — coming in $phaseNote',
                textAlign: TextAlign.center,
                style: TextStyle(color: muted)),
          ],
        ),
      ),
    );
  }
}
