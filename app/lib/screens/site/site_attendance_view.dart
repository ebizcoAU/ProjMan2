import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../config/app_theme.dart';
import '../../models/domain.dart';
import '../../services/site_ops_service.dart';

/// Attendance (appspec §5.3) — one-tap check-in/out muster. Geofence-stamped
/// (Decision 4: anti-fraud, feeds trust-score) but **never blocks** — permission
/// denied → still checks in, geo shows "unknown". "All Out" = bulk sign-out +
/// evacuation muster. `geo_verified` is server-derived (§11.5) — the app only
/// stamps location; here the chip is illustrative until the wire lands.
class SiteAttendanceView extends StatefulWidget {
  final Project project;
  const SiteAttendanceView({super.key, required this.project});

  @override
  State<SiteAttendanceView> createState() => _SiteAttendanceViewState();
}

class _SiteAttendanceViewState extends State<SiteAttendanceView> {
  SiteOpsService get _svc => SiteOpsService.instance;
  String get _pid => widget.project.id;

  @override
  void initState() {
    super.initState();
    _hydrate();
  }

  @override
  void didUpdateWidget(covariant SiteAttendanceView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.project.id != widget.project.id) _hydrate();
  }

  Future<void> _hydrate() async {
    await _svc.hydrateProject(_pid);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final roster = _svc.attendance(_pid);
    final onSite = _svc.onSite(_pid);
    return Column(
      children: [
        _header(onSite),
        Expanded(
          child: roster.isEmpty
              ? _empty()
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                  itemCount: roster.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (_, i) => _personCard(roster[i]),
                ),
        ),
        _actionBar(roster.isNotEmpty && onSite > 0),
      ],
    );
  }

  Widget _header(int onSite) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
        child: Row(
          children: [
            const Text('Attendance',
                style: TextStyle(
                    color: Op.text, fontSize: 18, fontWeight: FontWeight.w800)),
            const Spacer(),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                  color: onSite > 0
                      ? Op.success.withValues(alpha: 0.15)
                      : Op.bg,
                  borderRadius: BorderRadius.circular(20)),
              child: Text('on site: $onSite',
                  style: TextStyle(
                      color: onSite > 0 ? Op.successText : Op.muted,
                      fontSize: 13,
                      fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      );

  Widget _personCard(AttendanceEntry e) {
    final (icon, tint, label) = _status(e);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Op.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Op.border),
      ),
      child: Row(
        children: [
          Icon(icon, color: tint, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(e.personName,
                    style: const TextStyle(
                        color: Op.text,
                        fontSize: 15,
                        fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Row(children: [
                  Text(e.trade ?? _typeLabel(e.personType),
                      style: const TextStyle(color: Op.muted, fontSize: 12)),
                  const SizedBox(width: 8),
                  Text(label,
                      style: TextStyle(
                          color: tint,
                          fontSize: 12,
                          fontWeight: FontWeight.w600)),
                  if (e.present) _geoChip(e.geo),
                ]),
              ],
            ),
          ),
          // Was a bare TextButton — the lowest-emphasis style for what this
          // whole screen exists to do ("one-tap check-in/out", audit finding
          // B5). Promoted to a tonal fill so it reads as the row's primary
          // action, not incidental text.
          FilledButton.tonal(
            onPressed: () => _toggle(e),
            style: FilledButton.styleFrom(
              backgroundColor: Op.accent.withValues(alpha: 0.12),
              foregroundColor: Op.accent,
              padding: const EdgeInsets.symmetric(horizontal: 14),
            ),
            child: Text(
                e.checkInAt == null
                    ? 'Check in'
                    : e.checkOutAt == null
                        ? 'Check out'
                        : 'Re-open',
                style: const TextStyle(fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }

  Widget _geoChip(GeoState g) {
    if (g == GeoState.unknown) return const SizedBox.shrink();
    final ok = g == GeoState.verified;
    return Padding(
      padding: const EdgeInsets.only(left: 8),
      child: Row(children: [
        Icon(ok ? Icons.place : Icons.wrong_location,
            size: 13, color: ok ? Op.successText : Op.warningText),
        const SizedBox(width: 2),
        Text(ok ? 'Site' : 'off-site',
            style: TextStyle(
                color: ok ? Op.successText : Op.warningText,
                fontSize: 11,
                fontWeight: FontWeight.w600)),
      ]),
    );
  }

  // Used as both an icon and small-label text colour below — needs the dark
  // *Text variant, not the vivid badge colour (audit A3: 1.92:1 on white).
  (IconData, Color, String) _status(AttendanceEntry e) {
    if (e.present) return (Icons.check_circle, Op.successText, 'present');
    if (e.checkOutAt != null) return (Icons.logout, Op.muted, 'signed out');
    return (Icons.circle_outlined, Op.muted, 'not checked in');
  }

  Widget _actionBar(bool canAllOut) => Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 20),
        decoration: const BoxDecoration(
          color: Op.surface,
          border: Border(top: BorderSide(color: Op.border)),
        ),
        child: Row(children: [
          // "Scan QR" (self-check-in) removed — it was a permanently disabled
          // button with no path to ever being enabled yet, just dead-looking
          // UI on the row (audit finding E2). Re-add when that ships in P5;
          // "Add person" now gets the room it always needed as the sole
          // secondary action.
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _addPerson,
              icon: const Icon(Icons.person_add_alt, size: 18),
              style: OutlinedButton.styleFrom(
                  foregroundColor: Op.accent,
                  side: const BorderSide(color: Op.accent)),
              label: const Text('Add person'),
            ),
          ),
          const SizedBox(width: 10),
          FilledButton(
            onPressed: canAllOut ? _allOut : null,
            // Dark fill, not the vivid Op.warning — white label text on the
            // light amber measured 2.15:1 (audit finding B).
            style: FilledButton.styleFrom(
                backgroundColor: Op.warningText,
                disabledBackgroundColor: Op.border),
            child: const Text('All Out'),
          ),
        ]),
      );

  Future<void> _addPerson() async {
    final e = await showModalBottomSheet<AttendanceEntry>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Op.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (_) => const _AddPersonSheet(),
    );
    if (e != null && mounted) {
      await _svc.addPerson(_pid, e);
      if (mounted) {
        setState(() {});
        _toast('${e.personName} added to the muster');
      }
    }
  }

  // No haptic/toast on every toggle here — the row itself changes state
  // instantly (icon/status/button label), and a supervisor musters many
  // people back to back; a snackbar per tap would be noise, not feedback
  // (audit E4 asked for consistency, not a toast on literally everything).
  // A light tap still confirms the press registered.
  Future<void> _toggle(AttendanceEntry e) async {
    HapticFeedback.lightImpact();
    await _svc.toggleCheck(_pid, e);
    if (mounted) setState(() {});
  }

  Future<void> _allOut() async {
    HapticFeedback.mediumImpact();
    await _svc.allOut(_pid);
    if (mounted) {
      setState(() {});
      _toast('Everyone signed out');
    }
  }

  void _toast(String m) => ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(content: Text(m), duration: const Duration(seconds: 2)));

  Widget _empty() => ListView(children: const [
        SizedBox(height: 72),
        Icon(Icons.groups_outlined, size: 52, color: Op.muted),
        SizedBox(height: 10),
        Center(
            child: Text('No one on the muster yet',
                style: TextStyle(
                    color: Op.text, fontSize: 15, fontWeight: FontWeight.w700))),
        SizedBox(height: 4),
        Center(
            child: Text('Add the crew as they arrive on site.',
                style: TextStyle(color: Op.muted, fontSize: 13))),
      ]);

  static String _typeLabel(PersonType t) => switch (t) {
        PersonType.staff => 'Staff',
        PersonType.subcontractor => 'Subcontractor',
        PersonType.visitor => 'Visitor',
      };
}

/// Add a person to the muster — free-text name (no `persons` table yet, §11.2),
/// type staff/subbie/visitor, optional trade. Paired staff would resolve to a
/// `person_id` once an HR roster lands.
class _AddPersonSheet extends StatefulWidget {
  const _AddPersonSheet();

  @override
  State<_AddPersonSheet> createState() => _AddPersonSheetState();
}

class _AddPersonSheetState extends State<_AddPersonSheet> {
  final _name = TextEditingController();
  final _trade = TextEditingController();
  PersonType _type = PersonType.subcontractor;

  @override
  void dispose() {
    _name.dispose();
    _trade.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
          20, 18, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Add person',
              style: TextStyle(
                  color: Op.text, fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 16),
          _field(_name, 'Name', autofocus: true),
          const SizedBox(height: 12),
          SegmentedButton<PersonType>(
            segments: const [
              ButtonSegment(value: PersonType.staff, label: Text('Staff')),
              ButtonSegment(
                  value: PersonType.subcontractor, label: Text('Subbie')),
              ButtonSegment(value: PersonType.visitor, label: Text('Visitor')),
            ],
            selected: {_type},
            onSelectionChanged: (s) => setState(() => _type = s.first),
          ),
          const SizedBox(height: 12),
          _field(_trade, 'Trade (optional)'),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Op.accent),
              onPressed: _name.text.trim().isEmpty
                  ? null
                  : () => Navigator.pop(
                        context,
                        AttendanceEntry(
                          personName: _name.text.trim(),
                          personType: _type,
                          trade: _trade.text.trim().isEmpty
                              ? null
                              : _trade.text.trim(),
                          method: 'supervisor',
                        ),
                      ),
              child: const Text('Add to muster'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _field(TextEditingController c, String label,
          {bool autofocus = false}) =>
      TextField(
        controller: c,
        autofocus: autofocus,
        onChanged: (_) => setState(() {}),
        style: const TextStyle(color: Op.text),
        decoration: InputDecoration(
          labelText: label,
          labelStyle: const TextStyle(color: Op.muted),
          filled: true,
          fillColor: Op.bg,
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: Op.border)),
          enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: Op.border)),
        ),
      );
}
