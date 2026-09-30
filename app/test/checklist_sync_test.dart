import 'package:flutter_test/flutter_test.dart';
import 'package:projman2/core/db/database.dart';
import 'package:projman2/services/checklist_ops_service.dart';
import 'package:projman2/services/db_service.dart';
import 'package:projman2/services/signoff_store.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Quality → Checklists, wired to sync (xprojman-46, server v047). These run
/// against a real SQLite database (ffi) with no server: every push fails as
/// "offline", which is exactly the site case the local rules must hold for.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;

  final svc = ChecklistOpsService.instance;
  final db = DatabaseService();

  Future<ChecklistTemplate> seedTemplate({
    String id = 'tpl-1',
    List<(String, bool, bool)> items = const [
      ('Walk-around done', true, true),
      ('Fluids at correct levels', true, false),
      ('Hour meter recorded', false, false),
    ],
    int published = 1,
  }) async {
    await db.insert('checklist_templates', {
      'id': id,
      'name': 'Plant pre-start',
      'category': 'plant_prestart',
      'is_published': published,
      'is_deleted': 0,
    });
    var seq = 1;
    for (final (label, req, photo) in items) {
      await db.insert('checklist_template_items', {
        'id': '$id-$seq',
        'template_id': id,
        'seq': seq++,
        'label': label,
        'is_required': req ? 1 : 0,
        'photo_required': photo ? 1 : 0,
        'is_deleted': 0,
      });
    }
    await svc.reload('p1');
    return svc.templates().firstWhere((t) => t.id == id,
        orElse: () => const ChecklistTemplate(
            id: '', name: '', category: ChecklistCategory.other, items: []));
  }

  setUp(() async {
    SharedPreferences.setMockInitialValues({
      'projman2_user_json': '{"id":"u1","fullName":"Test Tradie"}',
    });
    svc.resetForTest();
    await DatabaseManager.clearAllData();
  });

  test('only published templates with items are offered', () async {
    await seedTemplate();
    await seedTemplate(id: 'tpl-draft', published: 0);
    expect(svc.templates().map((t) => t.id), ['tpl-1']);
  });

  test('start snapshots the template and queues a create (F2)', () async {
    final t = await seedTemplate();
    final c = await svc.start('p1', t);
    expect(c.items.map((i) => i.label), t.items.map((i) => i.label));
    expect(c.status, ChecklistStatus.inProgress);
    final row = (await db.query('checklist_instances',
            where: 'id = ?', whereArgs: [c.id]))
        .single;
    expect(row['is_dirty'], 1);
    expect(row['pending_op'], 'create');
    expect(row['template_name'], 'Plant pre-start');
  });

  test('complete is refused locally while items are outstanding', () async {
    final c = await svc.start('p1', await seedTemplate());
    var res = await svc.complete(c);
    expect(res.code, 'CHECKLIST_INCOMPLETE');

    for (final i in c.items.where((i) => i.isRequired)) {
      await svc.setResult(c, i, ChecklistItemResult.pass);
    }
    res = await svc.complete(c);
    expect(res.code, 'CHECKLIST_INCOMPLETE');
    expect(res.blockers.single.photoRequired, isTrue);

    await svc.attachPhoto(c, res.blockers.single, 'client-ref-1');
    res = await svc.complete(c);
    expect(res.success, isTrue);
  });

  test('N/A and unanswered optional items never need a photo (§7)', () async {
    final c = await svc.start('p1', await seedTemplate());
    await svc.setResult(c, c.items[0], ChecklistItemResult.na); // photo item
    await svc.setResult(c, c.items[1], ChecklistItemResult.fail);
    expect((await svc.complete(c)).success, isTrue);
  });

  test('requesting completion locks the checklist until it syncs', () async {
    final c = await svc.start('p1', await seedTemplate());
    await svc.setResult(c, c.items[0], ChecklistItemResult.na);
    await svc.setResult(c, c.items[1], ChecklistItemResult.pass);
    expect((await svc.complete(c)).success, isTrue);

    final fresh = svc.byId('p1', c.id)!;
    expect(fresh.completionRequested, isTrue);
    expect(fresh.isFrozen, isTrue);
    expect(fresh.isCompleted, isFalse); // the server hasn't stamped it yet
    expect(await svc.setResult(fresh, fresh.items[1], ChecklistItemResult.fail),
        isFalse);
    expect(await svc.addSignoff(fresh, displayName: 'Late'), isNull);
    expect((await svc.complete(fresh)).code, 'CHECKLIST_FROZEN');
  });

  test('pull never overwrites a row with unpushed changes', () async {
    final c = await svc.start('p1', await seedTemplate());
    await svc.setResult(c, c.items[1], ChecklistItemResult.pass);
    await svc.applyPulledRow('checklist_instance_items', {
      'id': c.items[1].id,
      'instance_id': c.id,
      'result': 'fail',
    });
    await svc.reload('p1');
    expect(svc.byId('p1', c.id)!.items[1].result, ChecklistItemResult.pass);
  });

  test('a pulled completion stamps the result and clears the request',
      () async {
    final c = await svc.start('p1', await seedTemplate());
    await db.update('checklist_instances',
        {'is_dirty': 0, 'ever_synced': 1, 'completion_requested': 1},
        where: 'id = ?', whereArgs: [c.id]);
    await svc.applyPulledRow('checklist_instances', {
      'id': c.id,
      'project_id': 'p1',
      'template_id': 'tpl-1',
      'status': 'completed',
      'result': 'fail',
      'completed_at': '2026-09-30 17:05:00',
    });
    await svc.reload('p1');
    final done = svc.byId('p1', c.id)!;
    expect(done.isCompleted, isTrue);
    expect(done.result, ChecklistResult.fail);
    expect(done.completionRequested, isFalse);
  });

  test('correction supersedes and re-snapshots from the old record', () async {
    final c = await svc.start('p1', await seedTemplate());
    final fix = await svc.startCorrection(c);
    expect(fix.supersedesId, c.id);
    expect(fix.items.map((i) => i.label), c.items.map((i) => i.label));
    expect(fix.items.every((i) => i.result == ChecklistItemResult.pending),
        isTrue);
  });

  test('sign-offs go through SignoffStore, keyed to the instance', () async {
    final c = await svc.start('p1', await seedTemplate());
    await svc.addSignoff(c, displayName: 'Visitor Vic');
    await svc.addSignoff(c, userId: 'u2', displayName: 'Tradie Tom');
    final s = svc.signoffs(svc.byId('p1', c.id)!);
    expect(s.length, 2);
    expect(s.first.isVisitor, isTrue);
    expect(s.every((x) => x.subjectType == SignoffSubject.checklistInstance),
        isTrue);

    // A never-synced sign-off is deleted outright on remove.
    await svc.removeSignoff(svc.byId('p1', c.id)!, s.first);
    expect(svc.signoffs(svc.byId('p1', c.id)!).length, 1);
  });

  group('completion gate (the push waits for everything else)', () {
    test('ready only when synced, clean and all uploads stored', () {
      expect(
          completionGate(
              instanceSynced: true,
              childrenClean: true,
              uploadsWaiting: 0,
              uploadsFailed: 0),
          CompletionGate.ready);
      expect(
          completionGate(
              instanceSynced: true,
              childrenClean: true,
              uploadsWaiting: 1,
              uploadsFailed: 0),
          CompletionGate.waitingForSync);
      expect(
          completionGate(
              instanceSynced: true,
              childrenClean: false,
              uploadsWaiting: 0,
              uploadsFailed: 0),
          CompletionGate.waitingForSync);
      expect(
          completionGate(
              instanceSynced: false,
              childrenClean: true,
              uploadsWaiting: 0,
              uploadsFailed: 0),
          CompletionGate.waitingForSync);
      expect(
          completionGate(
              instanceSynced: true,
              childrenClean: true,
              uploadsWaiting: 0,
              uploadsFailed: 1),
          CompletionGate.uploadFailed);
    });
  });
}
