import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../config/app_theme.dart';
import '../../config/router.dart';
import '../../services/project_service.dart';

/// Stage 1 — Project Creation & Land Ingestion (the PM's front door, appspec
/// §5.2). Capture-first order: documents → site → customer. Creating a project
/// also stamps the 18-stage WA programme so the tracker is populated at once.
///
/// Document capture / OCR is server/Python-side and deferred (shown disabled),
/// so v1 collects the fields and creates online via REST (projman-04 §4). The
/// offline Draft/Submit queue rides on projman-01 §10 and lands later.
class CreateProjectScreen extends StatefulWidget {
  const CreateProjectScreen({super.key});

  @override
  State<CreateProjectScreen> createState() => _CreateProjectScreenState();
}

class _CreateProjectScreenState extends State<CreateProjectScreen> {
  final _form = GlobalKey<FormState>();

  final _code = TextEditingController(
      text: 'P-${DateTime.now().millisecondsSinceEpoch.toString().substring(7)}');
  final _custName = TextEditingController();
  final _custEmail = TextEditingController();
  final _custPhone = TextEditingController();
  final _address = TextEditingController();
  final _suburb = TextEditingController();
  final _postcode = TextEditingController();
  final _lotPlan = TextEditingController();
  String _state = 'WA';
  bool _busy = false;

  static const _states = ['WA', 'NSW', 'VIC', 'QLD', 'SA', 'TAS', 'NT', 'ACT'];

  @override
  void dispose() {
    for (final c in [
      _code, _custName, _custEmail, _custPhone,
      _address, _suburb, _postcode, _lotPlan,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  String get _projectName {
    final s = _suburb.text.trim();
    final c = _custName.text.trim();
    if (s.isEmpty && c.isEmpty) return 'New project';
    if (s.isEmpty) return c;
    if (c.isEmpty) return s;
    return '$s — $c';
  }

  Future<void> _create() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);

    // 1) customer
    final cust = await ProjectService.createCustomer(
      name: _custName.text.trim(),
      email: _custEmail.text.trim(),
      phone: _custPhone.text.trim(),
      address: _address.text.trim(),
      suburb: _suburb.text.trim(),
      state: _state,
      postcode: _postcode.text.trim(),
    );
    if (!mounted) return;
    if (cust.id == null) return _fail(cust, 'Could not create the customer');

    // 2) project
    final proj = await ProjectService.createProject(
      name: _projectName,
      code: _code.text.trim(),
      customerId: cust.id!,
      siteAddress: _address.text.trim(),
      lotPlan: _lotPlan.text.trim(),
      templateId: ProjectService.wa18TemplateId,
    );
    if (!mounted) return;
    if (proj.id == null) {
      if (proj.code == 'DUPLICATE_CODE') {
        setState(() => _busy = false);
        return _snack('That job code is already used — pick another.');
      }
      return _fail(proj, 'Could not create the project');
    }

    // 3) stamp the 18-stage programme
    await ProjectService.instantiateProgramme(proj.id!);
    if (!mounted) return;

    setState(() => _busy = false);
    // Replace this screen with the new project's tracker.
    context.pushReplacement(AppRoutes.projectDetail, extra: proj.id);
  }

  void _fail(MutateResult r, String fallback) {
    setState(() => _busy = false);
    _snack(r.message ?? fallback);
  }

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Op.bg,
      appBar: AppBar(
        backgroundColor: Op.surface,
        foregroundColor: Op.text,
        elevation: 0,
        title: const Text('New project',
            style: TextStyle(fontWeight: FontWeight.w700)),
      ),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 120),
          children: [
            // Documents — capture-first, but OCR is server-side & deferred.
            _card('Site documents', [
              Opacity(
                opacity: 0.55,
                child: Row(children: const [
                  Icon(Icons.photo_camera_outlined, color: Op.muted),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Photograph the land title, survey & contour — OCR fills '
                      'the fields below. Coming soon.',
                      style: TextStyle(color: Op.muted, fontSize: 13),
                    ),
                  ),
                ]),
              ),
            ]),
            _card('Site & land', [
              _field(_address, 'Site address', hint: '42 River View Ave'),
              Row(children: [
                Expanded(child: _field(_suburb, 'Suburb', hint: 'Rivervale')),
                const SizedBox(width: 12),
                SizedBox(width: 110, child: _stateField()),
              ]),
              Row(children: [
                Expanded(
                    child: _field(_postcode, 'Postcode',
                        hint: '6103', keyboard: TextInputType.number)),
                const SizedBox(width: 12),
                Expanded(child: _field(_lotPlan, 'Lot / plan', hint: 'Lot 42 DP12345')),
              ]),
            ]),
            _card('Customer', [
              _field(_custName, 'Name', required: true, hint: 'D. Smith'),
              _field(_custEmail, 'Email',
                  hint: 'dave@smith.com.au', keyboard: TextInputType.emailAddress),
              _field(_custPhone, 'Phone',
                  hint: '0400 123 456', keyboard: TextInputType.phone),
            ]),
            _card('Job code', [
              _field(_code, 'Code', required: true, hint: 'P-001'),
              const Text('Auto-suggested — unique per organisation.',
                  style: TextStyle(color: Op.muted, fontSize: 12)),
            ]),
          ],
        ),
      ),
      bottomNavigationBar: _bottomBar(),
    );
  }

  Widget _bottomBar() {
    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      child: SizedBox(
        height: 52,
        child: FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: Op.accent,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
          onPressed: _busy ? null : _create,
          child: _busy
              ? const SizedBox(
                  width: 22, height: 22,
                  child: CircularProgressIndicator(
                      strokeWidth: 2.5, color: Colors.white))
              : const Text('Create project',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        ),
      ),
    );
  }

  Widget _card(String title, List<Widget> children) {
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Op.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Op.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title,
              style: const TextStyle(
                  color: Op.text, fontSize: 15, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          ...children,
        ],
      ),
    );
  }

  Widget _field(
    TextEditingController c,
    String label, {
    String? hint,
    bool required = false,
    TextInputType? keyboard,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: c,
        keyboardType: keyboard,
        style: const TextStyle(color: Op.text),
        onChanged: required ? (_) => setState(() {}) : null,
        validator: required
            ? (v) => (v == null || v.trim().isEmpty) ? 'Required' : null
            : null,
        decoration: _dec(label, hint),
      ),
    );
  }

  Widget _stateField() {
    return DropdownButtonFormField<String>(
      initialValue: _state,
      isExpanded: true,
      style: const TextStyle(color: Op.text),
      decoration: _dec('State', null),
      items: _states
          .map((s) => DropdownMenuItem(value: s, child: Text(s)))
          .toList(),
      onChanged: (v) => setState(() => _state = v ?? 'WA'),
    );
  }

  InputDecoration _dec(String label, String? hint) => InputDecoration(
        labelText: label,
        hintText: hint,
        labelStyle: const TextStyle(color: Op.muted),
        hintStyle: TextStyle(color: Op.muted.withValues(alpha: 0.5)),
        isDense: true,
        filled: true,
        fillColor: Op.bg,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Op.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Op.accent, width: 1.5),
        ),
      );
}
