import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:projman2/core/db/database.dart';
import 'package:projman2/screens/projects/client_signoff_screen.dart';
import 'package:projman2/services/client_signoff_service.dart';
import 'package:projman2/services/db_service.dart';
import 'package:projman2/services/nexus_service.dart';
import 'package:projman2/services/permissions_service.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// S18.14 client final sign-off, wired to server v050 (xprojman-51). Real
/// SQLite (ffi); fake transport and upload queue.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;

  final svc = ClientSignoffService.instance;
  final perms = PermissionsService.instance;
  final db = DatabaseService();
  final sig = Uint8List.fromList([1, 2, 3]);

  const hashA = 'aaaaaaaa1111111111111111111111111111111111111111111111111111111a';
  const hashB = 'bbbbbbbb2222222222222222222222222222222222222222222222222222222b';
  final manifest = [
    {'document_id': 'd1', 'kind': 'occupation_certificate', 'file_name': 'OC.pdf', 'sha256': 'x1'},
    {'document_id': 'd2', 'kind': 'warranty', 'file_name': 'Warranty.pdf', 'sha256': 'x2'},
  ];

  late List<(String op, Map<String, Object?> data)> pushed;
  late ApiResult answer;
  late String? storedDoc;
  late int failedUploads;

  const ok = ApiResult(success: true, status: 200, data: {});
  ApiResult refused(String code) => ApiResult(success: false, status: 409, data: const {}, code: code);

  Future<void> pullPack(String hash, {List<Map<String, Object?>>? docs}) =>
      svc.applyPulledRow('handover_packs', {
        'id': 'p1',
        'project_id': 'p1',
        'pack_hash': hash,
        'manifest': docs ?? manifest, // the server sends JSON, not a string
        'document_count': (docs ?? manifest).length,
      });

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    svc.resetForTest();
    await DatabaseManager.clearAllData();
    perms.setForTest(role: 'projectManager', permissions: {'handover.witness'});
    pushed = [];
    answer = ok;
    storedDoc = 'doc-sig-1';
    failedUploads = 0;
    svc.pushForTest = (op, data, id) async {
      pushed.add((op, Map.of(data)));
      return answer;
    };
    svc.pullForTest = (_) async =>
        const ApiResult(success: true, status: 200, data: {'changes': [], 'last_sync_at': 1});
    svc.enqueueForTest = (id, png, pid) async => 'ref-$id';
    svc.storedDocForTest = (id) async => storedDoc;
    svc.uploadStateForTest = (id) async => (waiting: storedDoc == null ? 1 : 0, failed: failedUploads);
  });

  Future<String?> sign({SignoffDecision d = SignoffDecision.accepted, String? reasons}) async {
    await svc.reload('p1');
    return svc.recordAssisted(
        projectId: 'p1',
        pack: svc.packFor('p1')!,
        decision: d,
        declineReasons: reasons,
        signerName: 'Cara Client',
        signaturePng: sig);
  }

  group('validateSignoff', () {
    test('needs a decision, a name and a signature; a decline needs reasons', () {
      expect(validateSignoff(decision: null, declineReasons: null, signerName: 'A', hasSignature: true),
          'DECISION_REQUIRED');
      expect(validateSignoff(decision: SignoffDecision.accepted, declineReasons: null, signerName: ' ', hasSignature: true),
          'NAME_REQUIRED');
      expect(validateSignoff(decision: SignoffDecision.accepted, declineReasons: null, signerName: 'A', hasSignature: false),
          'SIGNATURE_MISSING');
      expect(validateSignoff(decision: SignoffDecision.declined, declineReasons: ' ', signerName: 'A', hasSignature: true),
          'REASONS_REQUIRED');
      expect(validateSignoff(decision: SignoffDecision.accepted, declineReasons: null, signerName: 'A', hasSignature: true),
          isNull);
    });
  });

  test('the short reference is the first 8 hex characters', () {
    expect(shortPackHash('abcdef0123456789'), 'ABCDEF01');
  });

  test('a pulled pack is shown as the server sent it; an empty pack is no pack', () async {
    await pullPack(hashA);
    await svc.reload('p1');
    final pack = svc.packFor('p1')!;
    expect(pack.packHash, hashA);
    expect(pack.manifest.map((d) => d.fileName), ['OC.pdf', 'Warranty.pdf']);

    await svc.applyPulledRow('handover_packs',
        {'id': 'p1', 'project_id': 'p1', 'pack_hash': null, 'manifest': jsonEncode([])});
    await svc.reload('p1');
    expect(svc.packFor('p1'), isNull);
  });

  test('only handover.witness can take an assisted sign-off', () async {
    await pullPack(hashA);
    perms.setForTest(role: 'siteSupervisor', permissions: {});
    expect(await sign(), 'FORBIDDEN');
    expect(await db.query('client_signoffs'), isEmpty);
  });

  test('the signature uploads first, then the row is pushed create-only', () async {
    await pullPack(hashA);
    storedDoc = null; // signature not uploaded yet
    expect(await sign(), isNull);
    await svc.sync(projectId: 'p1');
    expect(pushed, isEmpty);

    storedDoc = 'doc-sig-1';
    await svc.sync(projectId: 'p1');
    final (op, data) = pushed.single;
    expect(op, 'create');
    expect(data['signature_document_id'], 'doc-sig-1');
    expect(data['pack_hash'], hashA);
    expect(data['step_code'], 'S18.14');
    expect((jsonDecode(data['manifest'] as String) as List).length, 2);
    for (final c in ['witnessed_by', 'frozen_at', 'counted', 'method', 'signature_ids', 'sync_error']) {
      expect(data.containsKey(c), isFalse, reason: c);
    }
    expect(svc.current('p1')!.isSynced, isTrue);
  });

  test('a failed signature upload is surfaced', () async {
    await pullPack(hashA);
    storedDoc = null;
    failedUploads = 1;
    await sign();
    await svc.sync(projectId: 'p1');
    expect(svc.signoffs('p1').single.syncError, 'UPLOAD_FAILED');
  });

  test('PACK_CHANGED: stored uncounted, shown as stale, and the re-sign supersedes it', () async {
    await pullPack(hashA);
    answer = refused('PACK_CHANGED');
    await sign();
    await svc.sync(projectId: 'p1');
    final first = svc.signoffs('p1').single;
    expect(first.counted, isFalse);
    expect(first.isSynced, isTrue);
    expect(svc.current('p1'), isNull);
    expect(svc.staleSignoff('p1')!.id, first.id);

    await pullPack(hashB);
    answer = ok;
    await sign();
    await svc.sync(projectId: 'p1');
    final second = svc.signoffs('p1').first;
    expect(second.supersedesId, first.id);
    expect(pushed.last.$2['supersedes_id'], first.id);
    expect(pushed.last.$2['pack_hash'], hashB);
    expect(svc.current('p1')!.id, second.id);
    expect(svc.staleSignoff('p1'), isNull);
  });

  test('a pack change after signing makes the sign-off stale', () async {
    await pullPack(hashA);
    await sign();
    await svc.sync(projectId: 'p1');
    expect(svc.current('p1'), isNotNull);
    await pullPack(hashB);
    await svc.reload('p1');
    expect(svc.current('p1'), isNull);
    expect(svc.staleSignoff('p1'), isNotNull);
  });

  test('OC_NOT_VALIDATED keeps the row queued; FORBIDDEN stops it', () async {
    await pullPack(hashA);
    answer = refused('OC_NOT_VALIDATED');
    await sign();
    await svc.sync(projectId: 'p1');
    var row = (await db.query('client_signoffs')).single;
    expect(row['is_dirty'], 1);
    expect(row['sync_error'], 'OC_NOT_VALIDATED');

    answer = refused('FORBIDDEN');
    await svc.sync(projectId: 'p1');
    row = (await db.query('client_signoffs')).single;
    expect(row['is_dirty'], 0);
    expect(row['sync_error'], 'FORBIDDEN');
  });

  test('a decline is recorded with reasons and does not satisfy S18.14', () async {
    await pullPack(hashA);
    expect(await sign(d: SignoffDecision.declined), 'REASONS_REQUIRED');
    expect(await sign(d: SignoffDecision.declined, reasons: 'Back door sticks'), isNull);
    expect(svc.signoffs('p1').single.declineReasons, 'Back door sticks');
    expect(svc.current('p1'), isNull);
  });

  test('a pulled counted row settles the state; a pull never overwrites an unsent row', () async {
    await pullPack(hashA);
    answer = refused('OC_NOT_VALIDATED');
    await sign();
    final id = svc.signoffs('p1').single.id;
    await svc.applyPulledRow('client_signoffs', {
      'id': id, 'project_id': 'p1', 'pack_hash': hashB, 'decision': 'declined',
      'signer_name': 'Someone', 'signed_at': '2026-10-14 10:00:00',
    });
    await svc.reload('p1');
    expect(svc.signoffs('p1').single.decision, SignoffDecision.accepted); // still unsent, ours wins

    await db.update('client_signoffs', {'is_dirty': 0}, where: 'id = ?', whereArgs: [id]);
    await svc.applyPulledRow('client_signoffs', {
      'id': id, 'project_id': 'p1', 'pack_hash': hashA, 'decision': 'accepted',
      'signer_name': 'Cara Client', 'signed_at': '2026-10-14 10:00:00', 'counted': true,
      'manifest': manifest,
    });
    await svc.reload('p1');
    final s = svc.signoffs('p1').single;
    expect(s.counted, isTrue);
    expect(s.syncError, isNull);
    expect(svc.current('p1')!.id, id);
  });

  group('screens', () {
    setUp(() => ClientSignoffScreen.hydrateOnOpen = false);
    tearDown(() => ClientSignoffScreen.hydrateOnOpen = true);

    HandoverPack seeded() {
      final pack = HandoverPack(
          projectId: 'p1',
          packHash: hashA,
          manifest: [for (final m in manifest) PackDocument.fromJson(m)]);
      svc.seedForTest(pack);
      return pack;
    }

    testWidgets('the client sees every document and the pack reference before signing', (t) async {
      final pack = seeded();
      await t.pumpWidget(MaterialApp(
          home: ClientHandoverScreen(projectId: 'p1', projectName: '12 Smith St', pack: pack)));
      for (final d in pack.manifest) {
        expect(find.text(d.fileName), findsOneWidget);
      }
      expect(find.text(pack.shortHash), findsOneWidget);
      expect(find.text(pack.packHash), findsOneWidget);

      final signBtn = find.widgetWithText(FilledButton, 'Sign');
      await t.dragUntilVisible(signBtn, find.byType(ListView), const Offset(0, -300));
      expect(t.widget<FilledButton>(signBtn).onPressed, isNull);
    });

    testWidgets('no signing method is preselected', (t) async {
      seeded();
      await t.pumpWidget(const MaterialApp(
          home: ClientSignoffScreen(projectId: 'p1', projectName: 'P', ocValidated: true)));
      await t.dragUntilVisible(
          find.text('Client signs in their own app'), find.byType(ListView), const Offset(0, -300));
      expect(find.text('Client signs on this device'), findsOneWidget);
      expect(find.byIcon(Icons.radio_button_checked), findsNothing);
      expect(find.text('Hand the device to the client'), findsNothing);
    });

    testWidgets('signing is gated on S18.3 being validated', (t) async {
      seeded();
      await t.pumpWidget(const MaterialApp(
          home: ClientSignoffScreen(projectId: 'p1', projectName: 'P', ocValidated: false)));
      expect(find.text('Available once the Occupation Certificate (S18.3) is validated.'), findsOneWidget);
      expect(find.text('Client signs on this device'), findsNothing);
    });
  });
}
