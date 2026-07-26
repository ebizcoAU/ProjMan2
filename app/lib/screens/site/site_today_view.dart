import 'package:flutter/material.dart';
import '../../config/app_theme.dart';
import '../../models/domain.dart';
import '../../services/project_service.dart';
import '../../services/site_ops_service.dart';
import 'site_deliveries_screen.dart';

/// Today (appspec §5.3) — the Site tab landing: who's on site, what's programmed
/// for the active stage (ties to the 18-stage spine), and one-tap into the day's
/// capture surfaces. Deliveries opens from here (the 4th surface, §5.3).
class SiteTodayView extends StatefulWidget {
  final Project project;
  const SiteTodayView({super.key, required this.project});

  @override
  State<SiteTodayView> createState() => _SiteTodayViewState();
}

class _SiteTodayViewState extends State<SiteTodayView> {
  SiteOpsService get _svc => SiteOpsService.instance;
  ProjectStage? _activeStage;
  bool _loadingStage = true;

  @override
  void initState() {
    super.initState();
    _loadStage();
    _hydrate();
  }

  @override
  void didUpdateWidget(covariant SiteTodayView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.project.id != widget.project.id) {
      _loadStage();
      _hydrate();
    }
  }

  Future<void> _hydrate() async {
    await _svc.hydrateProject(widget.project.id);
    if (mounted) setState(() {});
  }

  Future<void> _loadStage() async {
    final d = await ProjectService.detail(widget.project.id);
    if (!mounted) return;
    setState(() {
      _activeStage = d.stages
          .where((s) => s.isActive)
          .cast<ProjectStage?>()
          .firstWhere((_) => true, orElse: () => null);
      _loadingStage = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final onSite = _svc.onSite(widget.project.id);
    final deliveries = _svc.deliveries(widget.project.id).length;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      children: [
        _programmedCard(),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: _statTile('$onSite', 'on site', Icons.groups, Op.accent)),
          const SizedBox(width: 12),
          Expanded(child: _statTile('$deliveries', 'deliveries', Icons.local_shipping_outlined, Op.muted)),
        ]),
        const SizedBox(height: 20),
        const Text('Today’s capture',
            style: TextStyle(
                color: Op.text, fontSize: 14, fontWeight: FontWeight.w700)),
        const SizedBox(height: 10),
        _actionTile(Icons.edit_note, 'Site diary',
            'Log work done, delays and photos', () => _cycleHint('Site Diary')),
        _actionTile(Icons.how_to_reg, 'Attendance',
            'Muster the crew — check in / out', () => _cycleHint('Attendance')),
        _actionTile(Icons.local_shipping_outlined, 'Log a delivery',
            'Photograph a docket against this job', _openDeliveries),
      ],
    );
  }

  Widget _programmedCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Op.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Op.border),
      ),
      child: Row(children: [
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
              color: Op.accent.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(10)),
          child: const Icon(Icons.flag_outlined, color: Op.accent),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Programmed now',
                  style: TextStyle(color: Op.muted, fontSize: 12)),
              const SizedBox(height: 2),
              if (_loadingStage)
                const Text('…', style: TextStyle(color: Op.muted))
              else
                Text(
                    _activeStage == null
                        ? 'No stage in progress'
                        : 'Stage ${_activeStage!.seq} · ${_activeStage!.name}',
                    style: const TextStyle(
                        color: Op.text,
                        fontSize: 15,
                        fontWeight: FontWeight.w700)),
            ],
          ),
        ),
      ]),
    );
  }

  Widget _statTile(String value, String label, IconData icon, Color tint) =>
      Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Op.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Op.border),
        ),
        child: Row(children: [
          Icon(icon, color: tint, size: 26),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(value,
                  style: const TextStyle(
                      color: Op.text,
                      fontSize: 22,
                      fontWeight: FontWeight.w800)),
              Text(label, style: const TextStyle(color: Op.muted, fontSize: 12)),
            ],
          ),
        ]),
      );

  Widget _actionTile(
          IconData icon, String title, String subtitle, VoidCallback onTap) =>
      InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Op.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Op.border),
          ),
          child: Row(children: [
            Icon(icon, color: Op.accent, size: 22),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: const TextStyle(
                          color: Op.text,
                          fontSize: 15,
                          fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(subtitle,
                      style: const TextStyle(color: Op.muted, fontSize: 12.5)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: Op.muted),
          ]),
        ),
      );

  Future<void> _openDeliveries() async {
    await Navigator.push(
      context,
      MaterialPageRoute(
          builder: (_) => SiteDeliveriesScreen(project: widget.project)),
    );
    if (mounted) setState(() {});
  }

  // Site Diary / Attendance live as sibling sub-pages; the header title cycles
  // to them (development.md §4). A hint keeps the affordance discoverable.
  void _cycleHint(String page) => ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text('Tap the “Site” title up top to switch to $page'),
            duration: const Duration(seconds: 2)),
      );
}
