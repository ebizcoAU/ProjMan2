import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../config/app_theme.dart';
import '../../models/domain.dart';
import '../../services/dispute_service.dart';
import '../../services/permissions_service.dart';

/// Disputes queue (appdesignspecification.md §2.7 · nav §3 "Quality →
/// Disputes (Site Supervisor)"): review escalations from Tradies/Foreperson
/// contesting a verification decision. Reviewing/resolving is gated behind
/// `disputes.review` (serverdesignspecification.md §7.2) — that permission
/// isn't wired server-side yet, so `has()` returns false for everyone until
/// it ships; this screen still lists every dispute so the queue itself is
/// visible and testable ahead of the permission landing.
class DisputesQueueView extends StatefulWidget {
  final Project project;
  const DisputesQueueView({super.key, required this.project});

  @override
  State<DisputesQueueView> createState() => _DisputesQueueViewState();
}

class _DisputesQueueViewState extends State<DisputesQueueView> {
  DisputeStatus? _filter; // null = all
  List<DisputeEntry> _disputes = [];
  bool _canReview = false;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _hydrate();
  }

  @override
  void didUpdateWidget(covariant DisputesQueueView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.project.id != widget.project.id) _hydrate();
  }

  Future<void> _hydrate() async {
    setState(() => _loading = true);
    await PermissionsService.instance.ensureLoaded();
    final list = await DisputeService.instance
        .list(projectId: widget.project.id, status: _filter);
    if (!mounted) return;
    setState(() {
      _disputes = list;
      _canReview = PermissionsService.instance.has('disputes.review');
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: Op.accent));
    }
    return Column(
      children: [
        _filterBar(),
        Expanded(child: _disputes.isEmpty ? _empty() : _list()),
      ],
    );
  }

  Widget _filterBar() {
    final options = <(String, DisputeStatus?)>[
      ('All', null),
      ('Open', DisputeStatus.open),
      ('Reviewing', DisputeStatus.reviewing),
      ('Resolved', DisputeStatus.resolved),
    ];
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: const BoxDecoration(
        color: Op.surface,
        border: Border(bottom: BorderSide(color: Op.border)),
      ),
      child: Row(
        children: [
          for (final o in options)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Text(o.$1),
                selected: _filter == o.$2,
                onSelected: (_) {
                  setState(() => _filter = o.$2);
                  _hydrate();
                },
                selectedColor: Op.accent.withValues(alpha: 0.18),
                labelStyle: TextStyle(
                    color: _filter == o.$2 ? Op.accent : Op.muted,
                    fontWeight: FontWeight.w600,
                    fontSize: 12.5),
                backgroundColor: Op.bg,
                side: BorderSide(color: _filter == o.$2 ? Op.accent : Op.border),
              ),
            ),
        ],
      ),
    );
  }

  Widget _list() => ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
        itemCount: _disputes.length,
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (_, i) => _card(_disputes[i]),
      );

  Widget _card(DisputeEntry d) {
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => _open(d),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Op.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Op.border),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(d.subjectLabel?.isNotEmpty == true
                          ? d.subjectLabel!
                          : '${d.subjectType} · ${d.subjectId}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: Op.text,
                          fontSize: 15,
                          fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(d.reason,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Op.muted, fontSize: 12.5)),
                  if (d.raisedByName != null)
                    Text('raised by ${d.raisedByName}',
                        style: TextStyle(
                            color: Op.muted.withValues(alpha: 0.7), fontSize: 11)),
                ],
              ),
            ),
            const SizedBox(width: 8),
            _statusChip(d.status),
          ],
        ),
      ),
    );
  }

  Widget _statusChip(DisputeStatus s) {
    // fill = pale vivid tint for the chip; ink = dark *Text variant for the
    // label drawn on top — the vivid hue alone fails contrast at 11px (audit A3).
    final (fill, ink, label) = switch (s) {
      DisputeStatus.open => (Op.warning, Op.warningText, 'Open'),
      DisputeStatus.reviewing => (Op.accent, Op.accent, 'Reviewing'),
      DisputeStatus.resolved => (Op.success, Op.successText, 'Resolved'),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
          color: fill.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(8)),
      child: Text(label,
          style:
              TextStyle(color: ink, fontSize: 11, fontWeight: FontWeight.w700)),
    );
  }

  Widget _empty() => ListView(children: [
        const SizedBox(height: 96),
        const Icon(Icons.gavel_outlined, size: 52, color: Op.muted),
        const SizedBox(height: 10),
        const Center(
            child: Text('No disputes',
                style: TextStyle(
                    color: Op.text, fontSize: 15, fontWeight: FontWeight.w700))),
        const SizedBox(height: 4),
        const Center(
            child: Text('Nothing raised for this job yet.',
                style: TextStyle(color: Op.muted, fontSize: 13))),
      ]);

  Future<void> _open(DisputeEntry d) async {
    // The sheet pops a reason string, not a bare bool, so this can show the
    // right confirmation instead of a generic one (audit E4).
    final changed = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Op.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (_) => _DisputeDetailSheet(dispute: d, canReview: _canReview),
    );
    if (changed != null && mounted) {
      _hydrate();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(changed == 'resolved'
              ? 'Dispute resolved'
              : 'Marked as reviewing'),
          duration: const Duration(seconds: 2)));
    }
  }
}

class _DisputeDetailSheet extends StatefulWidget {
  final DisputeEntry dispute;
  final bool canReview;
  const _DisputeDetailSheet({required this.dispute, required this.canReview});

  @override
  State<_DisputeDetailSheet> createState() => _DisputeDetailSheetState();
}

class _DisputeDetailSheetState extends State<_DisputeDetailSheet> {
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _resolve() async {
    HapticFeedback.mediumImpact(); // closes out the dispute — critical
    setState(() => _busy = true);
    await DisputeService.instance
        .resolve(widget.dispute, resolutionNote: _note.text.trim());
    if (mounted) Navigator.pop(context, 'resolved');
  }

  Future<void> _markReviewing() async {
    HapticFeedback.lightImpact();
    setState(() => _busy = true);
    await DisputeService.instance.markReviewing(widget.dispute);
    if (mounted) Navigator.pop(context, 'reviewing');
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.dispute;
    final resolved = d.status == DisputeStatus.resolved;
    return Padding(
      padding: EdgeInsets.fromLTRB(
          20, 18, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
                d.subjectLabel?.isNotEmpty == true
                    ? d.subjectLabel!
                    : '${d.subjectType} · ${d.subjectId}',
                style: const TextStyle(
                    color: Op.text, fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            if (d.raisedByName != null)
              Text('Raised by ${d.raisedByName}',
                  style: const TextStyle(color: Op.muted, fontSize: 12)),
            const SizedBox(height: 12),
            const Text('ORIGINAL CALL',
                style: TextStyle(
                    color: Op.muted, fontSize: 11, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(d.reason, style: const TextStyle(color: Op.text, fontSize: 14)),
            if (resolved) ...[
              const SizedBox(height: 16),
              const Text('RESOLUTION',
                  style: TextStyle(
                      color: Op.muted, fontSize: 11, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text(d.resolutionNote ?? '—',
                  style: const TextStyle(color: Op.text, fontSize: 14)),
              if (d.resolvedByName != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text('by ${d.resolvedByName}',
                      style: const TextStyle(color: Op.muted, fontSize: 11)),
                ),
            ] else if (widget.canReview) ...[
              const SizedBox(height: 16),
              TextField(
                controller: _note,
                maxLines: 3,
                style: const TextStyle(color: Op.text),
                decoration: InputDecoration(
                  labelText: 'Resolution note',
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
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 12),
              Row(children: [
                if (d.status == DisputeStatus.open)
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _busy ? null : _markReviewing,
                      child: const Text('Mark reviewing'),
                    ),
                  ),
                if (d.status == DisputeStatus.open) const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    // Dark fill — white label text on the vivid Op.success
                    // measured 1.92:1 (audit finding B).
                    style: FilledButton.styleFrom(backgroundColor: Op.successText),
                    onPressed: _note.text.trim().isEmpty || _busy ? null : _resolve,
                    child: _busy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white))
                        : const Text('Resolve'),
                  ),
                ),
              ]),
            ] else ...[
              const SizedBox(height: 16),
              const Text(
                  'Only Site Supervisor (or PM if unavailable/conflicted) can '
                  'review this.',
                  style: TextStyle(color: Op.muted, fontSize: 12)),
            ],
          ],
        ),
      ),
    );
  }
}
