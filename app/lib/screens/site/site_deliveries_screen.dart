import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../../config/app_theme.dart';
import '../../models/domain.dart';
import '../../services/site_ops_service.dart';
import '../../widgets/photo_capture.dart';

/// Deliveries (appspec §5.3) — photograph a docket against the job; the delivery
/// *proof* record. v1 captures supplier/PO as free text (no commercial module
/// yet, §11.2) — the FKs wire in at P7. Evidence for the trust-score (§8).
class SiteDeliveriesScreen extends StatefulWidget {
  final Project project;
  const SiteDeliveriesScreen({super.key, required this.project});

  @override
  State<SiteDeliveriesScreen> createState() => _SiteDeliveriesScreenState();
}

class _SiteDeliveriesScreenState extends State<SiteDeliveriesScreen> {
  SiteOpsService get _svc => SiteOpsService.instance;
  String get _pid => widget.project.id;

  @override
  void initState() {
    super.initState();
    _hydrate();
  }

  Future<void> _hydrate() async {
    await _svc.hydrateProject(_pid);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final list = _svc.deliveries(_pid);
    return Scaffold(
      backgroundColor: Op.bg,
      appBar: AppBar(
        backgroundColor: Op.surface,
        foregroundColor: Op.text,
        elevation: 0,
        title: const Text('Deliveries',
            style: TextStyle(fontWeight: FontWeight.w800)),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(20),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Padding(
              padding: const EdgeInsets.only(left: 16, bottom: 10),
              child: Text(widget.project.name,
                  style: const TextStyle(color: Op.muted, fontSize: 13)),
            ),
          ),
        ),
      ),
      body: list.isEmpty ? _empty() : _list(list),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: Op.accent,
        onPressed: _add,
        icon: const Icon(Icons.add),
        label: const Text('Record delivery'),
      ),
    );
  }

  Widget _list(List<DeliveryEntry> list) => ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
        itemCount: list.length,
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (_, i) => _card(list[i]),
      );

  Widget _card(DeliveryEntry d) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Op.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Op.border),
        ),
        child: Row(children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
                color: Op.border, borderRadius: BorderRadius.circular(8)),
            child: Icon(
                d.photoIds.isEmpty ? Icons.receipt_long : Icons.image,
                color: Op.muted),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(d.supplierName?.isNotEmpty == true
                    ? d.supplierName!
                    : 'Delivery',
                    style: const TextStyle(
                        color: Op.text,
                        fontSize: 15,
                        fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text([
                  if (d.docketNo?.isNotEmpty == true) 'Docket ${d.docketNo}',
                  if (d.poReference?.isNotEmpty == true) 'PO ${d.poReference}',
                  _time(d.receivedAt),
                ].join(' · '),
                    style: const TextStyle(color: Op.muted, fontSize: 12.5)),
              ],
            ),
          ),
        ]),
      );

  Future<void> _add() async {
    final d = await showModalBottomSheet<DeliveryEntry>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Op.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (_) => _AddDeliverySheet(projectId: _pid),
    );
    if (d != null && mounted) {
      await _svc.addDelivery(_pid, d);
      if (mounted) setState(() {});
    }
  }

  Widget _empty() => ListView(children: const [
        SizedBox(height: 96),
        Icon(Icons.local_shipping_outlined, size: 52, color: Op.muted),
        SizedBox(height: 10),
        Center(
            child: Text('No deliveries logged',
                style: TextStyle(
                    color: Op.text, fontSize: 15, fontWeight: FontWeight.w700))),
        SizedBox(height: 4),
        Center(
            child: Text('Photograph a docket as goods arrive at the gate.',
                style: TextStyle(color: Op.muted, fontSize: 13))),
      ]);

  static String _time(DateTime d) {
    final h = d.hour.toString().padLeft(2, '0');
    final m = d.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }
}

class _AddDeliverySheet extends StatefulWidget {
  final String projectId;
  const _AddDeliverySheet({required this.projectId});

  @override
  State<_AddDeliverySheet> createState() => _AddDeliverySheetState();
}

class _AddDeliverySheetState extends State<_AddDeliverySheet> {
  final _supplier = TextEditingController();
  final _docket = TextEditingController();
  final _po = TextEditingController();
  final _notes = TextEditingController();
  final _photoIds = <String>[];
  // Mint the delivery's id up front so a docket photo can be queued against it
  // before the row is saved (order-free link, xprojman-21 §P1).
  final String _deliveryId = const Uuid().v4();

  @override
  void dispose() {
    _supplier.dispose();
    _docket.dispose();
    _po.dispose();
    _notes.dispose();
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
          const Text('Record delivery',
              style: TextStyle(
                  color: Op.text, fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 16),
          _docketPhoto(),
          const SizedBox(height: 14),
          _field(_supplier, 'Supplier (optional)'),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: _field(_docket, 'Docket no.')),
            const SizedBox(width: 12),
            Expanded(child: _field(_po, 'PO ref (optional)')),
          ]),
          const SizedBox(height: 12),
          _field(_notes, 'Notes (optional)'),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Op.accent),
              onPressed: () => Navigator.pop(
                context,
                DeliveryEntry(
                  id: _deliveryId,
                  supplierName: _supplier.text.trim(),
                  docketNo: _docket.text.trim(),
                  poReference: _po.text.trim(),
                  notes: _notes.text.trim(),
                  photoIds: List.of(_photoIds),
                ),
              ),
              child: const Text('Save delivery'),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _captureDocket() async {
    final ref = await captureAndEnqueue(context,
        entityType: 'delivery',
        entityId: _deliveryId,
        projectId: widget.projectId);
    if (ref != null && mounted) setState(() => _photoIds.add(ref));
  }

  Widget _docketPhoto() => InkWell(
        onTap: _captureDocket,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          height: 90,
          decoration: BoxDecoration(
            color: Op.bg,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: Op.accent),
          ),
          child: Center(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Icon(
                  _photoIds.isEmpty
                      ? Icons.add_a_photo_outlined
                      : Icons.check_circle,
                  color: Op.accent),
              const SizedBox(height: 4),
              Text(
                  _photoIds.isEmpty
                      ? 'Photograph the docket'
                      : '${_photoIds.length} photo(s)',
                  style: const TextStyle(color: Op.accent, fontSize: 13)),
            ]),
          ),
        ),
      );

  Widget _field(TextEditingController c, String label) => TextField(
        controller: c,
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
