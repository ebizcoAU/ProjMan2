import 'package:flutter/material.dart';
import 'auth_scaffold.dart';

/// AU onboarding constants + shared field widgets, used by both the email
/// register flow and the OAuth onboarding screen (projman-01 §1.8).

const auStates = ['WA', 'NSW', 'VIC', 'QLD', 'SA', 'TAS', 'NT', 'ACT'];

/// Display label → server enum. The server's `business_type` is snake_case
/// (`sole_trader|partnership|company|trust`); the UI shows friendly labels.
const businessTypeToEnum = <String, String>{
  'Sole Trader': 'sole_trader',
  'Partnership': 'partnership',
  'Company': 'company',
  'Trust': 'trust',
};

List<String> get businessTypeLabels => businessTypeToEnum.keys.toList();

class AppDropdownField extends StatelessWidget {
  final String label;
  final String value;
  final List<String> items;
  final ValueChanged<String?> onChanged;

  const AppDropdownField({
    super.key,
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 6),
          child: Text(label,
              style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.75),
                  fontSize: 13,
                  fontWeight: FontWeight.w600)),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            color: const Color(0xFF141B29),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: value,
              isExpanded: true,
              dropdownColor: const Color(0xFF141B29),
              style: const TextStyle(color: Colors.white, fontSize: 15),
              items: [
                for (final i in items)
                  DropdownMenuItem(value: i, child: Text(i)),
              ],
              onChanged: onChanged,
            ),
          ),
        ),
      ],
    );
  }
}

class GstToggle extends StatelessWidget {
  final bool value;
  final ValueChanged<bool> onChanged;

  const GstToggle({super.key, required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFF141B29),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Registered for GST',
                    style: TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w600)),
                Text('You can change this later',
                    style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.45),
                        fontSize: 12)),
              ],
            ),
          ),
          Switch(
            value: value,
            activeThumbColor: AuthScaffold.accent,
            onChanged: onChanged,
          ),
        ],
      ),
    );
  }
}
