import 'package:flutter_test/flutter_test.dart';
import 'package:projman2/core/db/database.dart';
import 'package:projman2/services/db_service.dart';
import 'package:projman2/services/induction_ops_service.dart';
import 'package:projman2/services/nexus_service.dart';
import 'package:projman2/services/permissions_service.dart';
import 'package:projman2/services/signoff_store.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Safety → Inductions: site inductions + SWMS sign-on (xprojman-48 F5/F6,
/// server v048). Real SQLite (ffi) with fake transports.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;

  final svc = InductionOpsService.instance;
  final store = SignoffStore.instance;
  final db = DatabaseService();
  final perms = PermissionsService.instance;

  late List<(String table, String op, Map<String, Object?> data)> pushed;
  late bool online;
  late ApiResult inductionAnswer;
  late List<Map<String, Object?>> serverSwms;

  const ok = ApiResult(success: true, status: 200, data: {});
  const offline = ApiResult(success: false, status: 0, data: {});

  setUp(() async {
    SharedPreferences.setMockInitialValues({
      'projman2_user_json': '{"id":"u1","fullName":"Sam Supervisor"}',
    });
    svc.resetForTest();
    await DatabaseManager.clearAllData();
    perms.setForTest(role: 'siteSupervisor', permissions: {'safety.report', 'safety.manage'});
    pushed = [];
    online = true;
    inductionAnswer = ok;
    serverSwms = [];
    svc.pushForTest = (op, data, id) async {
      pushed.add(('site_inductions', op, Map.of(data)));
      return online ? inductionAnswer : offline;
    };
    store.pushForTest = (op, data, id) async {
      pushed.add(('signoffs', op, Map.of(data)));
      return online ? ok : offline;
    };
    svc.pullForTest = (_) async =>
        const ApiResult(success: true, status: 200, data: {'changes': [], 'last_sync_at': 1});
    svc.swmsListForTest = (_) async => online
        ? ApiResult(success: true, status: 200, data: {'documents': serverSwms})
        : offline;
  });

  tearDown(() => store.pushForTest = null);

  group('inductionStatus', () {
    final now = DateTime(2026, 10, 14, 9);
    test('no expiry is valid', () => expect(inductionStatus(null, now), InductionStatus.valid));
    test('past is expired',
        () => expect(inductionStatus(DateTime(2026, 10, 13), now), InductionStatus.expired));
    test('today and the next 14 days are expiring soon', () {
      expect(inductionStatus(DateTime(2026, 10, 14), now), InductionStatus.expiringSoon);
      expect(inductionStatus(DateTime(2026, 10, 28), now), InductionStatus.expiringSoon);
    });
    test('later is valid',
        () => expect(inductionStatus(DateTime(2026, 10, 29), now), InductionStatus.valid));
  });

  test('only safety.manage can induct', () async {
    perms.setForTest(role: 'tradie', permissions: {'safety.report'});
    expect(await svc.induct(projectId: 'p1', name: 'Visitor Vic'), 'FORBIDDEN');
    expect(await db.query('site_inductions'), isEmpty);
  });

  test('inducting writes the induction and the inductee\'s sign-off', () async {
    online = false;
    expect(
        await svc.induct(
            projectId: 'p1', userId: 'u7', name: 'Tess Tradie', expiresAt: DateTime(2027, 4, 14)),
        isNull);
    final i = svc.inductions('p1').single;
    expect(i.name, 'Tess Tradie');
    expect(i.userId, 'u7');
    expect(i.expiresAt, DateTime(2027, 4, 14));
    expect(i.signoff, isNotNull);
    expect(i.signoff!.subjectType, SignoffSubject.siteInduction);
    expect(i.signoff!.userId, 'u7');
    expect(i.isSynced, isFalse);
  });

  test('a visitor is inducted by name only', () async {
    online = false;
    await svc.induct(projectId: 'p1', name: 'Vic Visitor');
    final i = svc.inductions('p1').single;
    expect(i.isVisitor, isTrue);
    expect(i.signoff!.displayName, 'Vic Visitor');
  });

  test('the induction is pushed before its sign-off, without inducted_by', () async {
    online = false;
    await svc.induct(projectId: 'p1', userId: 'u7', name: 'Tess Tradie');
    online = true;
    pushed.clear();
    await svc.sync(projectId: 'p1');
    expect(pushed.map((p) => p.$1).toList(), ['site_inductions', 'signoffs']);
    final ind = pushed.first.$3;
    expect(ind['user_id'], 'u7');
    expect(ind.containsKey('inducted_by'), isFalse);
    expect(pushed.last.$3['subject_type'], 'site_induction');
    expect(svc.inductions('p1').single.isSynced, isTrue);
  });

  test('a refused induction keeps its sign-off off the wire', () async {
    inductionAnswer =
        const ApiResult(success: false, status: 403, data: {}, code: 'FORBIDDEN');
    await svc.induct(projectId: 'p1', name: 'Vic Visitor');
    await svc.sync(projectId: 'p1');
    expect(pushed.where((p) => p.$1 == 'signoffs'), isEmpty);
    expect(svc.inductions('p1').single.syncError, 'FORBIDDEN');
  });

  test('the SWMS register is cached, and kept when offline', () async {
    serverSwms = [
      {'document_id': 'd1', 'original_filename': 'Working at heights.pdf', 'mime_type': 'application/pdf'},
      {'document_id': 'd2', 'original_filename': 'Excavation.pdf'},
    ];
    await svc.refreshSwmsRegister('p1');
    await svc.reload('p1');
    expect(svc.swms('p1').map((d) => d.title), ['Excavation.pdf', 'Working at heights.pdf']);

    online = false;
    await svc.refreshSwmsRegister('p1');
    await svc.reload('p1');
    expect(svc.swms('p1').length, 2);

    online = true;
    serverSwms = [serverSwms.first]; // d2 withdrawn in the Portal
    await svc.refreshSwmsRegister('p1');
    await svc.reload('p1');
    expect(svc.swms('p1').map((d) => d.id), ['d1']);
  });

  test('a worker signs on to a SWMS once, offline, as themselves', () async {
    perms.setForTest(role: 'tradie', permissions: {'safety.report'});
    SharedPreferences.setMockInitialValues({
      'projman2_user_json': '{"id":"u9","fullName":"Tess Tradie"}',
    });
    serverSwms = [
      {'document_id': 'd1', 'original_filename': 'Working at heights.pdf'},
    ];
    await svc.refreshSwmsRegister('p1');
    online = false;
    await svc.reload('p1');
    var d = svc.swms('p1').single;
    expect(d.mine, isNull);

    expect(await svc.signSwms(d), isNull);
    d = svc.swms('p1').single;
    expect(d.mine, isNotNull);
    expect(d.mine!.userId, 'u9');
    expect(d.mine!.displayName, 'Tess Tradie');

    await svc.signSwms(d); // second tap: no new row
    expect((await db.query('signoffs', where: "subject_type = 'swms'")).length, 1);

    online = true;
    pushed.clear();
    await svc.sync(projectId: 'p1');
    expect(pushed.single.$1, 'signoffs');
    expect(pushed.single.$3['subject_id'], 'd1');
    expect(pushed.single.$3['user_id'], 'u9');
  });

  test('signing a SWMS needs safety.report', () async {
    perms.setForTest(role: 'client', permissions: {});
    serverSwms = [{'document_id': 'd1', 'original_filename': 'SWMS.pdf'}];
    await svc.refreshSwmsRegister('p1');
    await svc.reload('p1');
    expect(await svc.signSwms(svc.swms('p1').single), 'FORBIDDEN');
  });

  test('my induction is the one that expires last', () async {
    SharedPreferences.setMockInitialValues({
      'projman2_user_json': '{"id":"u7","fullName":"Tess Tradie"}',
    });
    for (final (id, exp) in [('i1', '2026-01-01'), ('i2', '2027-06-01'), ('i3', '2026-12-01')]) {
      await svc.applyPulledInduction(
          {'id': id, 'project_id': 'p1', 'user_id': 'u7', 'inducted_at': '2025-12-01 08:00:00', 'expires_at': exp});
    }
    await svc.applyPulledInduction(
        {'id': 'other', 'project_id': 'p1', 'user_id': 'u8', 'inducted_at': '2026-10-01 08:00:00'});
    await svc.reload('p1');
    expect(svc.myInduction('p1')!.id, 'i2');
  });

  test('a pull never overwrites an unpushed induction', () async {
    online = false;
    await svc.induct(projectId: 'p1', name: 'Mine');
    final id = svc.inductions('p1').single.id;
    await svc.applyPulledInduction(
        {'id': id, 'project_id': 'p1', 'name': 'Theirs', 'inducted_at': '2026-10-14 08:00:00'});
    await svc.reload('p1');
    expect(svc.inductions('p1').single.name, 'Mine');
  });
}
