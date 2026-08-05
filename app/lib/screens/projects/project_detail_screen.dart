import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../config/app_theme.dart';
import '../../config/router.dart';
import '../../models/domain.dart';
import '../../services/project_service.dart';

/// Project detail = the 18-stage lifecycle tracker (appspec §5.2, the Projects-
/// tab backbone). Shows every stage's gate state (active / blocked-awaiting-
/// inspection / complete / not-started) and lets the PM advance the current
/// stage (Decision b: manual "Complete & Next", server validates and may block).
class ProjectDetailScreen extends StatefulWidget {
  final String projectId;
  const ProjectDetailScreen({super.key, required this.projectId});

  @override
  State<ProjectDetailScreen> createState() => _ProjectDetailScreenState();
}

class _ProjectDetailScreenState extends State<ProjectDetailScreen> {
  Project? _project;
  List<ProjectStage> _stages = [];
  bool _loading = true;
  bool _advancing = false;

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

  ProjectStage? get _current {
    for (final s in _stages) {
      if (!s.isComplete && s.status != 'skipped') return s;
    }
    return null;
  }

  Future<void> _advance(ProjectStage s) async {
    // not_started → in_progress (Start); in_progress → complete (Complete & Next).
    final to = s.status == 'in_progress' ? 'complete' : 'in_progress';
    setState(() => _advancing = true);
    final r = await ProjectService.advanceStage(
      projectId: widget.projectId,
      stageId: s.id,
      toStatus: to,
    );
    if (!mounted) return;
    setState(() => _advancing = false);
    if (r.code != null) {
      final msg = switch (r.code) {
        'STAGE_NOT_VALIDATED' =>
          'Blocked — an inspector must validate this hold point first.',
        'STAGE_GATE_PREV' => 'Finish the previous stage first.',
        _ => r.message ?? 'Could not advance the stage.',
      };
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(msg)));
    } else {
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final done = _stages.where((s) => s.isComplete).length;
    return Scaffold(
      backgroundColor: Op.bg,
      appBar: AppBar(
        backgroundColor: Op.surface,
        foregroundColor: Op.text,
        elevation: 0,
        title: Text(_project?.name ?? 'Project',
            style: const TextStyle(fontWeight: FontWeight.w700)),
        actions: [
          IconButton(
            tooltip: 'Programme',
            icon: const Icon(Icons.view_timeline_outlined),
            onPressed: () => context.push(AppRoutes.projectProgramme,
                extra: widget.projectId),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Op.accent))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 120),
                children: [
                  _overview(done),
                  const SizedBox(height: 16),
                  const Text('Programme',
                      style: TextStyle(
                          color: Op.text,
                          fontSize: 16,
                          fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  // No indication before this if _stages came back empty —
                  // just the label above and nothing underneath (audit finding).
                  if (_stages.isEmpty) _emptyStages() else ..._stages.map(_stageRow),
                ],
              ),
            ),
      bottomNavigationBar: _loading ? null : _bottomBar(),
    );
  }

  Widget _overview(int done) {
    final p = _project;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Op.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Op.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            if (p?.code != null)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                    color: Op.bg, borderRadius: BorderRadius.circular(6)),
                child: Text(p!.code!,
                    style: const TextStyle(
                        color: Op.muted,
                        fontWeight: FontWeight.w700,
                        fontSize: 12)),
              ),
            const Spacer(),
            Text((p?.status ?? 'active').replaceAll('_', ' '),
                style: const TextStyle(color: Op.muted, fontSize: 12)),
          ]),
          const SizedBox(height: 10),
          if (p?.customerName != null)
            _kv(Icons.person_outline, p!.customerName!),
          if (p?.siteAddress != null && p!.siteAddress!.isNotEmpty)
            _kv(Icons.place_outlined, p.siteAddress!),
          const SizedBox(height: 12),
          _progress(done),
        ],
      ),
    );
  }

  Widget _kv(IconData icon, String v) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(children: [
          Icon(icon, size: 16, color: Op.muted),
          const SizedBox(width: 8),
          Expanded(
              child: Text(v, style: const TextStyle(color: Op.text, fontSize: 14))),
        ]),
      );

  Widget _progress(int done) {
    final total = _stages.isEmpty ? 18 : _stages.length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(children: [
          Text('$done of $total stages complete',
              style: const TextStyle(
                  color: Op.text, fontSize: 13, fontWeight: FontWeight.w600)),
        ]),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: total == 0 ? 0 : done / total,
            minHeight: 7,
            backgroundColor: Op.border,
            valueColor: const AlwaysStoppedAnimation(Op.success),
          ),
        ),
      ],
    );
  }

  Widget _emptyStages() => Container(
        padding: const EdgeInsets.symmetric(vertical: 32),
        alignment: Alignment.center,
        child: Column(
          children: const [
            Icon(Icons.playlist_add_check_circle_outlined,
                size: 44, color: Op.muted),
            SizedBox(height: 10),
            Text('No stages loaded',
                style: TextStyle(
                    color: Op.text, fontSize: 14, fontWeight: FontWeight.w700)),
            SizedBox(height: 4),
            Text('Pull to refresh, or check back shortly.',
                style: TextStyle(color: Op.muted, fontSize: 12.5)),
          ],
        ),
      );

  Widget _stageRow(ProjectStage s) {
    final g = _gate(s);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Op.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
            color: s.isActive ? Op.accent : Op.border,
            width: s.isActive ? 1.5 : 1),
      ),
      child: Row(
        children: [
          Container(
            width: 26, height: 26,
            alignment: Alignment.center,
            decoration: BoxDecoration(
                color: g.$1.withValues(alpha: 0.14), shape: BoxShape.circle),
            child: Text('${s.seq}',
                style: TextStyle(
                    color: g.$1, fontSize: 12, fontWeight: FontWeight.w800)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(s.name,
                    style: const TextStyle(
                        color: Op.text,
                        fontSize: 14,
                        fontWeight: FontWeight.w600)),
                const SizedBox(height: 3),
                Row(children: [
                  Icon(g.$2, size: 13, color: g.$1),
                  const SizedBox(width: 4),
                  Text(g.$3,
                      style: TextStyle(
                          color: g.$1,
                          fontSize: 12,
                          fontWeight: FontWeight.w600)),
                  if (s.milestone != null && s.milestone!.isNotEmpty) ...[
                    const Text('  ·  ',
                        style: TextStyle(color: Op.muted, fontSize: 12)),
                    Flexible(
                      child: Text(s.milestone!.replaceAll('_', ' '),
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Op.muted, fontSize: 12)),
                    ),
                  ],
                ]),
              ],
            ),
          ),
          if (s.isHoldPoint)
            Tooltip(
              message: s.isValidated
                  ? 'Hold point — validated'
                  : 'Hold point — needs inspector',
              child: Icon(
                s.isValidated ? Icons.verified_outlined : Icons.lock_outline,
                size: 18,
                color: s.isValidated ? Op.successText : Op.warningText,
              ),
            ),
        ],
      ),
    );
  }

  /// (colour, icon, label) for a stage's gate status. The colour drives the
  /// badge circle's pale fill (`.withValues(alpha: 0.14)`, still fine with the
  /// dark variant) AND the digit/icon/label text drawn on top of it — so it
  /// must be a *Text variant, not the vivid badge hue (audit A3).
  (Color, IconData, String) _gate(ProjectStage s) {
    switch (s.status) {
      case 'complete':
        return (Op.successText, Icons.check_circle, 'Complete');
      case 'in_progress':
        return (Op.accent, Icons.play_circle_fill, 'In progress');
      case 'blocked':
        return (Op.warningText, Icons.lock, 'Blocked');
      case 'skipped':
        return (Op.muted, Icons.remove_circle_outline, 'Skipped');
      default:
        return (Op.muted, Icons.circle_outlined, 'Not started');
    }
  }

  Widget? _bottomBar() {
    final s = _current;
    if (s == null) {
      return const SafeArea(
        minimum: EdgeInsets.all(16),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(Icons.verified, color: Op.success, size: 18),
          SizedBox(width: 8),
          Text('All stages complete',
              style: TextStyle(color: Op.text, fontWeight: FontWeight.w600)),
        ]),
      );
    }
    final label = s.status == 'in_progress'
        ? 'Complete & next stage'
        : 'Start: ${s.name}';
    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      child: SizedBox(
        height: 52,
        child: FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: Op.accent,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
          onPressed: _advancing ? null : () => _advance(s),
          child: _advancing
              ? const SizedBox(
                  width: 22, height: 22,
                  child: CircularProgressIndicator(
                      strokeWidth: 2.5, color: Colors.white))
              : Text(label,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontSize: 15, fontWeight: FontWeight.w700)),
        ),
      ),
    );
  }
}
