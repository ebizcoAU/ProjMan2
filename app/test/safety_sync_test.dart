import 'package:flutter_test/flutter_test.dart';
import 'package:projman2/core/db/database.dart';
import 'package:projman2/services/db_service.dart';
import 'package:projman2/services/nexus_service.dart';
import 'package:projman2/services/permissions_service.dart';
import 'package:projman2/services/safety_ops_service.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Safety hazards/incidents wired to sync (xprojman-48, server v048). Real
/// SQLite (ffi); the sync transport is a fake that records each push and
/// answers with whatever the test sets.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;

  final svc = SafetyOpsService.instance;
  final db = DatabaseService();
  final perms = PermissionsService.instance;

  late List<(String table, String op, Map<String, Object?> data)> pushed;
  // table -> response for the next pushes to that table (default: accepted).
  late Map<String, ApiResult> answers;
  late bool online;

  const ok = ApiResult(success: true, status: 200, data: {});
  ApiResult refused(String code) =>
      ApiResult(success: false, status: 409, data: const {}, code: code);
  const offline = ApiResult(success: false, status: 0, data: {});

  setUp(() async {
    SharedPreferences.setMockInitialValues({
      'projman2_user_json': '{"id":"u1","fullName":"Test Tradie"}',
    });
    svc.resetForTest();
    await DatabaseManager.clearAllData();
    perms.setForTest(role: 'tradie', permissions: {'safety.report'});
    pushed = [];
    answers = {};
    online = true;
    svc.pushForTest = (table, op, data, id) async {
      pushed.add((table, op, Map.of(data)));
      if (!online) return offline;
      return answers[table] ?? ok;
    };
    svc.pullForTest = (_) async =>
        const ApiResult(success: true, status: 200, data: {'changes': [], 'last_sync_at': 1});
  });

  Future<int> count(String table) async =>
      (await db.rawQuery('SELECT COUNT(*) AS n FROM $table')).first['n'] as int;

  const injury = IncidentDetailsInput(
    injuredName: 'Sam Worker',
    injuryType: 'Laceration',
    bodyPart: 'Left hand',
    treatment: InjuryTreatment.firstAid,
    lostTime: false,
  );

  test('a raise is pushed as an open create, without server-stamped columns', () async {
    online = false;
    final e = await svc.raise(
        projectId: 'p1', kind: SafetyKind.nearMiss, description: 'Pallet fell from hoist');
    expect(e.status, SafetyStatus.open);
    expect(e.isSynced, isFalse);

    online = true;
    await svc.sync(projectId: 'p1');
    final (table, op, data) = pushed.last;
    expect(table, 'safety_events');
    expect(op, 'create');
    expect(data['kind'], 'near_miss');
    expect(data['status'], 'open');
    expect(data['is_notifiable'], 0);
    for (final c in ['raised_by', 'raised_at', 'closed_by', 'closed_at', 'notified_at',
        'notifiable_confirmed_by', 'regulator_reference', 'photo_ids', 'sync_error']) {
      expect(data.containsKey(c), isFalse, reason: c);
    }
    expect(svc.byId('p1', e.id)!.isSynced, isTrue);
  });

  test('injury details stay out of the event and leave the phone once accepted (F2)', () async {
    online = false;
    final e = await svc.raise(
      projectId: 'p1',
      kind: SafetyKind.incident,
      description: 'Cut on sheet metal edge at the roof',
      details: injury,
    );
    expect(await count('incident_details'), 1);
    expect(svc.byId('p1', e.id)!.details, DetailsState.waiting);

    online = true;
    await svc.sync(projectId: 'p1');
    final tables = pushed.map((p) => p.$1).toList();
    // Parent first, then the details.
    expect(tables.indexOf('safety_events'), lessThan(tables.indexOf('incident_details')));
    final details = pushed.firstWhere((p) => p.$1 == 'incident_details');
    expect(details.$2, 'create');
    expect(details.$3['injured_name'], 'Sam Worker');
    expect(details.$3['treatment'], 'first_aid');
    final event = pushed.firstWhere((p) => p.$1 == 'safety_events');
    expect(event.$3.values.whereType<String>().any((v) => v.contains('Sam Worker')), isFalse);

    expect(await count('incident_details'), 0);
    expect(svc.byId('p1', e.id)!.details, DetailsState.sent);
  });

  test('injury details are never sent before their event is accepted', () async {
    answers['safety_events'] = refused('FORBIDDEN');
    await svc.raise(
        projectId: 'p1', kind: SafetyKind.incident, description: 'Fall', details: injury);
    await svc.sync(projectId: 'p1');
    expect(pushed.any((p) => p.$1 == 'incident_details'), isFalse);
    expect(await count('incident_details'), 1);
  });

  test('CREATE_ONLY on details also clears the local copy', () async {
    answers['incident_details'] = refused('CREATE_ONLY');
    await svc.raise(
        projectId: 'p1', kind: SafetyKind.incident, description: 'Fall', details: injury);
    await svc.sync(projectId: 'p1');
    expect(await count('incident_details'), 0);
  });

  test('empty injury section, or a hazard, writes no details row', () async {
    online = false;
    await svc.raise(projectId: 'p1', kind: SafetyKind.incident, description: 'Fall',
        details: const IncidentDetailsInput(injuredName: '  '));
    await svc.raise(projectId: 'p1', kind: SafetyKind.hazard, description: 'Open trench',
        details: injury);
    expect(await count('incident_details'), 0);
  });

  test('pulled rows never bring back incident_details', () async {
    await svc.applyPulledRow('incident_details', {'id': 'x', 'event_id': 'e1', 'injured_name': 'A'});
    expect(await count('incident_details'), 0);
  });

  test('only managers edit, add actions or close', () async {
    final e = await svc.raise(projectId: 'p1', kind: SafetyKind.hazard, description: 'Loose rail');
    expect(await svc.update(e, description: 'x', severity: SafetySeverity.high), 'FORBIDDEN');
    expect(await svc.addAction(e, action: 'Fix rail'), 'FORBIDDEN');
    expect(await svc.close(e), 'FORBIDDEN');
  });

  test('close is refused while an action is open, and pushed after action closures', () async {
    perms.setForTest(role: 'siteSupervisor', permissions: {'safety.report', 'safety.manage'});
    online = false;
    var e = await svc.raise(projectId: 'p1', kind: SafetyKind.hazard, description: 'Loose rail');
    await svc.addAction(e, action: 'Re-fix the handrail', assignedToName: 'Chris');
    e = svc.byId('p1', e.id)!;
    expect(await svc.close(e), 'SAFETY_OPEN_ACTIONS');

    await svc.closeAction(e, e.actions.single);
    e = svc.byId('p1', e.id)!;
    expect(await svc.close(e, note: 'Rail re-fixed and checked'), isNull);

    online = true;
    pushed.clear();
    await svc.sync(projectId: 'p1');
    final order = pushed.map((p) => '${p.$1}:${p.$3['status']}').toList();
    // The create goes open; the action (already closed) before the closure.
    expect(order, ['safety_events:open', 'safety_actions:closed', 'safety_events:closed']);
    expect(pushed.last.$2, 'update');
    expect(pushed.last.$3['close_note'], 'Rail re-fixed and checked');
    expect(svc.byId('p1', e.id)!.isSynced, isTrue);
  });

  test('SAFETY_OPEN_ACTIONS keeps the closure queued; SAFETY_FROZEN stops it', () async {
    perms.setForTest(role: 'projectManager', permissions: {'safety.report', 'safety.manage'});
    var e = await svc.raise(projectId: 'p1', kind: SafetyKind.hazard, description: 'Trip hazard');
    await svc.sync(projectId: 'p1');
    e = svc.byId('p1', e.id)!;

    answers['safety_events'] = refused('SAFETY_OPEN_ACTIONS');
    await svc.close(e);
    await svc.sync(projectId: 'p1');
    var row = (await db.query('safety_events', where: 'id = ?', whereArgs: [e.id])).single;
    expect(row['is_dirty'], 1);
    expect(row['sync_error'], 'SAFETY_OPEN_ACTIONS');

    answers['safety_events'] = refused('SAFETY_FROZEN');
    await svc.sync(projectId: 'p1');
    row = (await db.query('safety_events', where: 'id = ?', whereArgs: [e.id])).single;
    expect(row['is_dirty'], 0);
    expect(row['sync_error'], 'SAFETY_FROZEN');
  });

  test('a synced notifiable incident is frozen on the device (F3)', () async {
    perms.setForTest(role: 'projectManager', permissions: {'safety.report', 'safety.manage'});
    final e = await svc.raise(
        projectId: 'p1', kind: SafetyKind.incident, description: 'Scaffold collapse',
        isNotifiable: true);
    await svc.sync(projectId: 'p1');
    expect(pushed.first.$3['is_notifiable'], 1);
    final synced = svc.byId('p1', e.id)!;
    expect(synced.isFrozen, isTrue);
    expect(await svc.update(synced, description: 'edit', severity: SafetySeverity.low),
        'SAFETY_FROZEN');
    expect(await svc.close(synced), 'SAFETY_FROZEN');
  });

  test('is_notifiable is only sent on create', () async {
    perms.setForTest(role: 'projectManager', permissions: {'safety.report', 'safety.manage'});
    final e = await svc.raise(projectId: 'p1', kind: SafetyKind.incident, description: 'Minor slip');
    await svc.sync(projectId: 'p1');
    await svc.update(svc.byId('p1', e.id)!, description: 'Slip on wet ramp', severity: SafetySeverity.low);
    await svc.sync(projectId: 'p1');
    final update = pushed.lastWhere((p) => p.$1 == 'safety_events');
    expect(update.$2, 'update');
    expect(update.$3.containsKey('is_notifiable'), isFalse);
  });

  test('a pull fills server stamps but never overwrites unpushed edits or local columns', () async {
    online = false;
    final e = await svc.raise(projectId: 'p1', kind: SafetyKind.hazard, description: 'Mine',
        photoIds: ['ref-1']);
    await svc.applyPulledRow('safety_events', {
      'id': e.id, 'project_id': 'p1', 'kind': 'hazard', 'description': 'Theirs',
    });
    expect(svc.byId('p1', e.id)!.description, 'Mine'); // still dirty, push decides

    await db.update('safety_events', {'is_dirty': 0}, where: 'id = ?', whereArgs: [e.id]);
    await svc.applyPulledRow('safety_events', {
      'id': e.id, 'project_id': 'p1', 'kind': 'hazard', 'description': 'Mine',
      'status': 'in_progress', 'raised_by': 'u1', 'photo_ids': null,
    });
    await svc.reload('p1');
    final after = svc.byId('p1', e.id)!;
    expect(after.status, SafetyStatus.inProgress);
    expect(after.photoIds, ['ref-1']);
  });

  test('hazard and near-miss lists exclude incidents', () async {
    online = false;
    await svc.raise(projectId: 'p1', kind: SafetyKind.hazard, description: 'a');
    await svc.raise(projectId: 'p1', kind: SafetyKind.nearMiss, description: 'b');
    await svc.raise(projectId: 'p1', kind: SafetyKind.incident, description: 'c');
    expect(svc.entries('p1', kinds: {SafetyKind.hazard, SafetyKind.nearMiss}).length, 2);
    expect(svc.entries('p1', kinds: {SafetyKind.incident}).single.description, 'c');
  });
}
