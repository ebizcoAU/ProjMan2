import 'package:flutter_test/flutter_test.dart';
import 'package:projman2/screens/pairing/join_qr_payload.dart';

// xprojman-50 §10/§11 F4: the Join scanner routes by `typ` before pairing.
void main() {
  test('legacy staff QR (no typ) stays on device pairing', () {
    final p = JoinQrPayload.parse('{"id":"r1","nonce":"n1"}');
    expect(p.kind, JoinQrKind.devicePair);
    expect(p.id, 'r1');
    expect(p.nonce, 'n1');
  });

  test('typ device_pair is device pairing', () {
    final p = JoinQrPayload.parse('{"typ":"device_pair","id":"r1","nonce":"n1"}');
    expect(p.kind, JoinQrKind.devicePair);
  });

  test('client_invite is NOT sent to device pairing', () {
    final p = JoinQrPayload.parse('{"typ":"client_invite","id":"i1","nonce":"n1"}');
    expect(p.kind, JoinQrKind.clientInvite);
    expect(p.id, 'i1');
  });

  test('unknown typ is reported as not for this screen', () {
    final p = JoinQrPayload.parse('{"typ":"intro_card","id":"x","nonce":"y"}');
    expect(p.kind, JoinQrKind.otherType);
    expect(p.typ, 'intro_card');
  });

  test('non-JSON, non-object and incomplete payloads are ignored', () {
    for (final raw in [
      null,
      '',
      'https://example.com',
      '[1,2]',
      '{"id":"r1"}',
      '{"typ":"device_pair","nonce":"n1"}',
      '{"typ":"client_invite","id":"","nonce":"n1"}',
    ]) {
      expect(JoinQrPayload.parse(raw).kind, JoinQrKind.notOurs, reason: '$raw');
    }
  });
}
