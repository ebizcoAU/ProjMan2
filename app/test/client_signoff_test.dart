import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:projman2/screens/projects/client_signoff_screen.dart';
import 'package:projman2/services/client_signoff_service.dart';
import 'package:projman2/services/permissions_service.dart';

/// S18.14 client final sign-off, mockup against the xprojman-51 / v050 shapes.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final svc = ClientSignoffService.instance;
  final perms = PermissionsService.instance;
  final sig = Uint8List.fromList([1, 2, 3]);

  setUp(() {
    svc.resetForTest();
    perms.setForTest(role: 'projectManager', permissions: {'handover.witness'});
  });

  group('validateSignoff', () {
    test('needs a decision, a name and a signature', () {
      expect(validateSignoff(decision: null, declineReasons: null, signerName: 'A', hasSignature: true),
          'DECISION_REQUIRED');
      expect(
          validateSignoff(
              decision: SignoffDecision.accepted, declineReasons: null, signerName: ' ', hasSignature: true),
          'NAME_REQUIRED');
      expect(
          validateSignoff(
              decision: SignoffDecision.accepted, declineReasons: null, signerName: 'A', hasSignature: false),
          'SIGNATURE_MISSING');
      expect(
          validateSignoff(
              decision: SignoffDecision.accepted, declineReasons: null, signerName: 'A', hasSignature: true),
          isNull);
    });
    test('a decline needs reasons', () {
      expect(
          validateSignoff(
              decision: SignoffDecision.declined, declineReasons: '  ', signerName: 'A', hasSignature: true),
          'REASONS_REQUIRED');
    });
  });

  test('the short reference is the first 8 hex characters', () {
    expect(shortPackHash('abcdef0123456789'), 'ABCDEF01');
  });

  test('only a witness can take an assisted sign-off', () async {
    perms.setForTest(role: 'siteSupervisor', permissions: {});
    final pack = svc.packFor('p1')!;
    expect(
        await svc.recordAssisted(
            projectId: 'p1', pack: pack, decision: SignoffDecision.accepted, signerName: 'Cara Client', signaturePng: sig),
        'FORBIDDEN');
    expect(svc.signoffs('p1'), isEmpty);
  });

  test('an accepted sign-off on the current pack satisfies S18.14', () async {
    final pack = svc.packFor('p1')!;
    expect(svc.current('p1'), isNull);
    expect(
        await svc.recordAssisted(
            projectId: 'p1', pack: pack, decision: SignoffDecision.accepted, signerName: 'Cara Client', signaturePng: sig),
        isNull);
    final s = svc.current('p1')!;
    expect(s.method, SignoffMethod.assistedDevice);
    expect(s.packHash, pack.packHash);
    expect(s.manifest.length, pack.documentCount);
  });

  test('a pack change un-satisfies it, keeps what was signed, and the re-sign supersedes', () async {
    final before = svc.packFor('p1')!;
    await svc.recordAssisted(
        projectId: 'p1', pack: before, decision: SignoffDecision.accepted, signerName: 'Cara Client', signaturePng: sig);
    final first = svc.signoffs('p1').single;

    svc.mockChangePack('p1');
    final after = svc.packFor('p1')!;
    expect(after.packHash, isNot(before.packHash));
    expect(svc.current('p1'), isNull);
    expect(svc.staleSignoff('p1')!.id, first.id);
    // The old row still records exactly what the client saw.
    expect(first.manifest.length, before.documentCount);

    await svc.recordAssisted(
        projectId: 'p1', pack: after, decision: SignoffDecision.accepted, signerName: 'Cara Client', signaturePng: sig);
    final second = svc.signoffs('p1').first;
    expect(second.supersedesId, first.id);
    expect(svc.current('p1')!.id, second.id);
    expect(svc.staleSignoff('p1'), isNull);
  });

  test('a decline is recorded with reasons and does not satisfy S18.14', () async {
    final pack = svc.packFor('p1')!;
    expect(
        await svc.recordAssisted(
            projectId: 'p1', pack: pack, decision: SignoffDecision.declined, signerName: 'Cara Client', signaturePng: sig),
        'REASONS_REQUIRED');
    await svc.recordAssisted(
        projectId: 'p1',
        pack: pack,
        decision: SignoffDecision.declined,
        declineReasons: 'Back door sticks',
        signerName: 'Cara Client',
        signaturePng: sig);
    expect(svc.signoffs('p1').single.declineReasons, 'Back door sticks');
    expect(svc.current('p1'), isNull);
  });

  testWidgets('the client sees every document and the pack reference before signing', (t) async {
    final pack = svc.packFor('p1')!;
    await t.pumpWidget(MaterialApp(
        home: ClientHandoverScreen(projectId: 'p1', projectName: '12 Smith St', pack: pack)));
    for (final d in pack.manifest) {
      expect(find.text(d.fileName), findsOneWidget);
    }
    expect(find.text(pack.shortHash), findsOneWidget);
    expect(find.text(pack.packHash), findsOneWidget);

    // No decision is preselected, and Sign stays disabled until everything is filled in.
    final sign = find.widgetWithText(FilledButton, 'Sign');
    await t.dragUntilVisible(sign, find.byType(ListView), const Offset(0, -300));
    expect(t.widget<FilledButton>(sign).onPressed, isNull);
  });

  testWidgets('no signing method is preselected', (t) async {
    await t.pumpWidget(const MaterialApp(
        home: ClientSignoffScreen(projectId: 'p1', projectName: 'P', ocValidated: true)));
    await t.dragUntilVisible(
        find.text('Client signs in their own app'), find.byType(ListView), const Offset(0, -300));
    expect(find.text('Client signs on this device'), findsOneWidget);
    expect(find.byIcon(Icons.radio_button_checked), findsNothing);
    expect(find.text('Hand the device to the client'), findsNothing);
  });

  testWidgets('signing is gated on S18.3 being validated', (t) async {
    await t.pumpWidget(const MaterialApp(
        home: ClientSignoffScreen(projectId: 'p1', projectName: 'P', ocValidated: false)));
    expect(find.text('Available once the Occupation Certificate (S18.3) is validated.'), findsOneWidget);
    expect(find.text('Client signs on this device'), findsNothing);
  });
}
