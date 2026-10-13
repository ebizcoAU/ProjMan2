import 'dart:convert';

/// What a QR scanned on "Join with a QR code" is for (xprojman-50 §10/§11 F4).
enum JoinQrKind {
  /// Staff device pairing — `typ:"device_pair"`, or no `typ` at all (QRs
  /// minted before Server added the field must keep working).
  devicePair,

  /// A customer invite (`typ:"client_invite"`), redeemed via
  /// `/client-invites/preview` + `/redeem` — never via `/pairing/request`.
  clientInvite,

  /// Valid JSON with a `typ` this screen doesn't handle (e.g. a business card).
  otherType,

  /// Not one of our QRs at all — keep scanning silently.
  notOurs,
}

class JoinQrPayload {
  final JoinQrKind kind;
  final String? id;
  final String? nonce;
  final String? typ;

  const JoinQrPayload._(this.kind, {this.id, this.nonce, this.typ});

  /// Classifies a raw scan. Before this, any JSON with `id` + `nonce` went to
  /// `/pairing/request`, so a customer invite was misrouted as staff pairing.
  static JoinQrPayload parse(String? raw) {
    if (raw == null || raw.isEmpty) return const JoinQrPayload._(JoinQrKind.notOurs);
    Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } catch (_) {
      return const JoinQrPayload._(JoinQrKind.notOurs);
    }
    if (decoded is! Map) return const JoinQrPayload._(JoinQrKind.notOurs);

    final typ = decoded['typ']?.toString();
    final id = decoded['id']?.toString();
    final nonce = decoded['nonce']?.toString();
    final hasCredential =
        id != null && id.isNotEmpty && nonce != null && nonce.isNotEmpty;

    switch (typ) {
      case null:
      case 'device_pair':
        return hasCredential
            ? JoinQrPayload._(JoinQrKind.devicePair, id: id, nonce: nonce, typ: typ)
            : const JoinQrPayload._(JoinQrKind.notOurs);
      case 'client_invite':
        return hasCredential
            ? JoinQrPayload._(JoinQrKind.clientInvite, id: id, nonce: nonce, typ: typ)
            : const JoinQrPayload._(JoinQrKind.notOurs);
      default:
        return JoinQrPayload._(JoinQrKind.otherType, typ: typ);
    }
  }
}
