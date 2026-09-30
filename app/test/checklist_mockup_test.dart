import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:projman2/models/domain.dart';
import 'package:projman2/screens/quality/checklist_run_screen.dart';
import 'package:projman2/services/checklist_ops_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Quality → Checklists mockup: the xprojman-46 rules the in-memory store
/// mirrors (F2 snapshot, F5 completion/derive/freeze), plus a render check.
void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({
      'projman2_user_json': '{"fullName":"Test Tradie"}',
    });
  });

  final svc = ChecklistOpsService.instance;
  ChecklistTemplate tpl(String id) =>
      svc.templates().firstWhere((t) => t.id == id);

  test('start snapshots the template items (F2)', () async {
    final t = tpl('tpl-plant');
    final c = await svc.start('p-snap', t);
    expect(c.items.length, t.items.length);
    expect(c.items.map((i) => i.label), t.items.map((i) => i.label));
    expect(c.templateName, t.name);
    expect(c.category, ChecklistCategory.plantPrestart);
    expect(c.status, ChecklistStatus.inProgress);
  });

  test('completion refused while required/photo items outstanding (F5)', () async {
    final c = await svc.start('p-incomplete', tpl('tpl-plant'));
    var res = await svc.complete(c);
    expect(res.success, isFalse);
    expect(res.code, 'CHECKLIST_INCOMPLETE');

    // Answer everything required as pass — the photo-required item still blocks.
    for (final i in c.items.where((i) => i.isRequired)) {
      svc.setResult(c, i, ChecklistItemResult.pass);
    }
    res = await svc.complete(c);
    expect(res.code, 'CHECKLIST_INCOMPLETE');
    expect(res.blockers.single.photoRequired, isTrue);

    svc.addMockPhoto(c, res.blockers.single);
    res = await svc.complete(c);
    expect(res.success, isTrue);
    expect(c.result, ChecklistResult.pass);
  });

  test('result derives fail from any failed item, N/A ignored', () async {
    final c = await svc.start('p-derive', tpl('tpl-toolbox'));
    for (final i in c.items) {
      svc.setResult(c, i, ChecklistItemResult.na);
    }
    svc.setResult(c, c.items.first, ChecklistItemResult.fail);
    final res = await svc.complete(c);
    expect(res.success, isTrue);
    expect(c.result, ChecklistResult.fail);
  });

  test('completed checklist is frozen; correction supersedes it', () async {
    final c = await svc.start('p-frozen', tpl('tpl-toolbox'));
    for (final i in c.items) {
      svc.setResult(c, i, ChecklistItemResult.pass);
    }
    expect((await svc.complete(c)).success, isTrue);

    expect(svc.setResult(c, c.items.first, ChecklistItemResult.fail), isFalse);
    expect(svc.addSignoff(c, displayName: 'Late', signed: true), isNull);
    expect((await svc.complete(c)).code, 'CHECKLIST_FROZEN');
    expect(c.items.first.result, ChecklistItemResult.pass);

    final fix = await svc.startCorrection(c);
    expect(fix.supersedesId, c.id);
    expect(fix.items.every((i) => i.result == ChecklistItemResult.pending), isTrue);
  });

  test('sign-offs go through the shared store, keyed to the instance', () async {
    final c = await svc.start('p-sign', tpl('tpl-toolbox'));
    svc.addSignoff(c, displayName: 'Visitor Vic', signed: true);
    svc.addSignoff(c, userId: 'u1', displayName: 'Tradie Tom', signed: true);
    final s = svc.signoffs(c);
    expect(s.length, 2);
    expect(s.first.isVisitor, isTrue);
    expect(s.every((x) => x.projectId == 'p-sign'), isTrue);
  });

  testWidgets('run screen renders explicit Pass/Fail/N/A buttons', (tester) async {
    final c = await svc.start('p-ui', tpl('tpl-toolbox'));
    await tester.pumpWidget(MaterialApp(
      home: ChecklistRunScreen(
          project: Project(id: 'p-ui', name: 'Test job'), instance: c),
    ));
    expect(find.text('Toolbox talk'), findsWidgets); // title + category row
    expect(find.text('Pass'), findsWidgets);
    expect(find.text('Fail'), findsWidgets);
    expect(find.text('N/A'), findsWidgets);
    expect(find.text('Complete checklist'), findsOneWidget);

    await tester.tap(find.text('Pass').first);
    await tester.pump();
    expect(c.items.first.result, ChecklistItemResult.pass);

    // Sign-off section sits below the items; the ListView builds it lazily.
    await tester.scrollUntilVisible(find.text('Add attendee'), 300);
    expect(find.text('Attendees'), findsOneWidget);
  });
}
