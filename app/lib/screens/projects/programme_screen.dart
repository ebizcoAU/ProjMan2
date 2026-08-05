import 'package:flutter/material.dart';
import '../../config/app_theme.dart';
import '../../models/domain.dart';
import '../../services/project_service.dart';

/// Programme (appdesignspecification.md §3/§4, devroadmap.md §6): the
/// schedule view, distinct from `project_detail_screen.dart`'s stage tracker
/// (which only ever advances the single current stage). This is the surface
/// that eventually becomes editable for Builder and read-only for PM from
/// Stage 9 on — **read-only for every role today**, since neither the
/// `builder` role nor `programme.write`'s per-stage scoping exists server-side
/// yet (serverdesignspecification.md §7.2, Step A). Building an edit path
/// ahead of that would grant nobody-in-particular write access to a schedule
/// the spec is explicit no one should touch unconditionally.
///
/// `S1.3` (devroadmap.md §6) declares building type/unit count at project
/// creation and conditionally selects the renderer: one unit → standard
/// Gantt, more than one → Line-of-Balance. That declaration isn't captured
/// anywhere yet (client or server) — `_isMultiUnit` below is a placeholder
/// that always resolves to the standard view until `modular_units`/`S1.3`
/// data exists to condition on. Swapping in a real Line-of-Balance renderer
/// once that lands is meant to be a one-line change at [_body].
class ProgrammeScreen extends StatefulWidget {
  final String projectId;
  const ProgrammeScreen({super.key, required this.projectId});

  @override
  State<ProgrammeScreen> createState() => _ProgrammeScreenState();
}

class _ProgrammeScreenState extends State<ProgrammeScreen> {
  Project? _project;
  List<ProjectStage> _stages = [];
  bool _loading = true;

  // Placeholder for S1.3's unit-count declaration — always false (single
  // dwelling → standard Gantt) until that data exists. See class doc.
  bool get _isMultiUnit => false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final d = await ProjectService.detail(widget.projectId);
    if (!mounted) return;
    setState(() {
      _project = d.project;
      _stages = d.stages..sort((a, b) => a.seq.compareTo(b.seq));
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Op.bg,
      appBar: AppBar(
        backgroundColor: Op.surface,
        foregroundColor: Op.text,
        elevation: 0,
        title: Text(_project == null ? 'Programme' : '${_project!.name} — Programme',
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w700)),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Op.accent))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
                children: [
                  _readOnlyBanner(),
                  const SizedBox(height: 16),
                  if (_stages.isEmpty)
                    _empty()
                  else if (_isMultiUnit)
                    _lineOfBalanceStub()
                  else
                    _body(),
                ],
              ),
            ),
    );
  }

  Widget _readOnlyBanner() => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: Op.accent.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: Op.accent.withValues(alpha: 0.25)),
        ),
        child: const Row(children: [
          Icon(Icons.lock_outline, size: 16, color: Op.accent),
          SizedBox(width: 8),
          Expanded(
            child: Text(
                'Read-only. Full Programme editing belongs to Builder once '
                'engagement mode ships — no one holds a write path here yet.',
                style: TextStyle(color: Op.accent, fontSize: 12.5)),
          ),
        ]),
      );

  // No empty-state existed before (audit finding C1) — an empty _stages list
  // rendered a blank Column with no indication anything was wrong.
  Widget _empty() => Container(
        padding: const EdgeInsets.symmetric(vertical: 48),
        alignment: Alignment.center,
        child: Column(
          children: [
            const Icon(Icons.timeline_outlined, size: 52, color: Op.muted),
            const SizedBox(height: 12),
            const Text('No programme yet',
                style: TextStyle(
                    color: Op.text, fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            const Text(
                'This project has no stages loaded. Pull to refresh, or check '
                'back once the 18-stage schedule has been set up.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Op.muted, fontSize: 13)),
          ],
        ),
      );

  Widget _lineOfBalanceStub() => Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: Op.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Op.border),
        ),
        child: const Column(
          children: [
            Icon(Icons.stacked_line_chart, size: 40, color: Op.muted),
            SizedBox(height: 12),
            Text('Line-of-Balance view',
                style: TextStyle(
                    color: Op.text, fontSize: 15, fontWeight: FontWeight.w700)),
            SizedBox(height: 6),
            Text(
                'Multi-unit repetitive-scheduling view — not yet built '
                '(18-Stage spec §1.8/Part 3). Showing the standard timeline '
                'below in the meantime.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Op.muted, fontSize: 12.5)),
          ],
        ),
      );

  /// Standard single-dwelling Gantt-shaped view: a horizontal timeline of
  /// stage bars, grouped by Part A–E. No per-stage start/end dates exist in
  /// [ProjectStage] yet, so bars are sequence-ordered rather than date-scaled
  /// — an honest placeholder for the real date-scaled renderer once task-level
  /// scheduling data lands.
  Widget _body() {
    final byPart = <String, List<ProjectStage>>{};
    for (final s in _stages) {
      final part = s.part ?? '—';
      (byPart[part] ??= []).add(s);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final part in byPart.keys) ...[
          Padding(
            padding: const EdgeInsets.only(bottom: 8, top: 8),
            child: Text(_partLabel(part),
                style: const TextStyle(
                    color: Op.muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.5)),
          ),
          _timelineRow(byPart[part]!),
          const SizedBox(height: 12),
        ],
      ],
    );
  }

  Widget _timelineRow(List<ProjectStage> stages) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final s in stages) _bar(s),
        ],
      ),
    );
  }

  Widget _bar(ProjectStage s) {
    // fill drives the pale tile tint/border (fine vivid); ink is the dark
    // *Text variant for the "S{seq}" label drawn on top (audit A3).
    final fill = _gateColor(s);
    final ink = _gateTextColor(s);
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Tooltip(
        message: s.name,
        child: Container(
          width: 96,
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
          decoration: BoxDecoration(
            color: fill.withValues(alpha: 0.14),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: fill.withValues(alpha: 0.4)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('S${s.seq}',
                  style: TextStyle(
                      color: ink, fontSize: 11, fontWeight: FontWeight.w800)),
              const SizedBox(height: 2),
              Text(s.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      color: Op.text, fontSize: 11, fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      ),
    );
  }

  Color _gateColor(ProjectStage s) {
    switch (s.status) {
      case 'complete':
        return Op.success;
      case 'in_progress':
        return Op.accent;
      case 'blocked':
        return Op.warning;
      case 'skipped':
        return Op.muted;
      default:
        return Op.muted;
    }
  }

  /// Dark-text counterpart to [_gateColor] — the vivid colour is only safe as
  /// a pale tile tint, not as the label text drawn on top (audit A3).
  Color _gateTextColor(ProjectStage s) {
    switch (s.status) {
      case 'complete':
        return Op.successText;
      case 'in_progress':
        return Op.accent;
      case 'blocked':
        return Op.warningText;
      default:
        return Op.muted;
    }
  }

  static String _partLabel(String part) => switch (part) {
        'A' => 'A — PRE-DESIGN & FEASIBILITY',
        'B' => 'B — APPROVALS & CONTRACT',
        'C' => 'C — SITE & STRUCTURE',
        'D' => 'D — FIT-OUT & FINISHES',
        'E' => 'E — COMPLETION & HANDOVER',
        _ => part,
      };
}
