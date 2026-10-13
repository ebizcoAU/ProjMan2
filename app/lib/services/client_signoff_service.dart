import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import 'permissions_service.dart';

/// S18.14 — client final sign-off of the handover pack (xprojman-51; Server
/// §6 2026-10-14, migration v050). **UI MOCKUP ONLY: in-memory, fixture pack,
/// no sync.** Built mockup-first (Owner preference) against the agreed shapes,
/// so wiring v050 later swaps this service's internals, not the screens.
///
/// The contract it is shaped to:
/// - `handover_packs` is pull-only, one row per project, present once the
///   project has any handover document. Signing is gated on Stage 18's
///   S18.3 (Occupation Certificate) being validated. The app **never computes the
///   hash**; it shows the server's, with the first 8 hex characters as the
///   short reference.
/// - `client_signoffs` is create-only. The app pushes `method
///   'assisted_device'` only; `paper_upload` is a Portal upload and
///   `client_self` needs customer accounts (xprojman-50). The server stamps
///   `witnessed_by`, `frozen_at` and `counted`.
/// - Signature first: upload the image (`entity_type 'client_signoff'`), then
///   push the row (`SIGNATURE_MISSING` is retryable).
/// - `PACK_CHANGED`: the row is stored but not counted. The app asks for a
///   new signature with `supersedes_id` and **never re-signs silently**.
///
/// Legal: which method is used is still with the solicitor (xprojman-51 F1,
/// devroadmap §13 L2), so no method is presented as the default.
enum SignoffMethod {
  assistedDevice('assisted_device', 'Client signs on this device'),
  paperUpload('paper_upload', 'Paper form'),
  clientSelf('client_self', 'Client signs in their own app');

  final String wire;
  final String label;
  const SignoffMethod(this.wire, this.label);
}

enum SignoffDecision { accepted, declined }

class PackDocument {
  final String documentId;
  final String kind;
  final String fileName;
  final String sha256;
  const PackDocument({
    required this.documentId,
    required this.kind,
    required this.fileName,
    required this.sha256,
  });

  /// Plain-English label for the handover kinds (x51 F3).
  String get kindLabel => switch (kind) {
        'occupation_certificate' => 'Occupation Certificate',
        'ba3' => 'Certificate of Compliance (BA3)',
        'certificate' => 'Compliance certificate',
        'manual' => 'Manual',
        'warranty' => 'Warranty',
        'as_built' => 'As-built record',
        _ => 'Document',
      };
}

class HandoverPack {
  final String projectId;
  final String packHash;
  final List<PackDocument> manifest;
  final DateTime computedAt;
  const HandoverPack({
    required this.projectId,
    required this.packHash,
    required this.manifest,
    required this.computedAt,
  });

  int get documentCount => manifest.length;
  String get shortHash => shortPackHash(packHash);
}

/// The first 8 hex characters, the reference printed on paper forms.
String shortPackHash(String hash) =>
    hash.length <= 8 ? hash.toUpperCase() : hash.substring(0, 8).toUpperCase();

class ClientSignoff {
  final String id;
  final String projectId;
  final SignoffMethod method;
  final String packHash;
  final List<PackDocument> manifest;
  final SignoffDecision decision;
  final String? declineReasons;
  final String signerName;
  final DateTime signedAt;
  final String? supersedesId;
  final bool hasSignature;
  const ClientSignoff({
    required this.id,
    required this.projectId,
    required this.method,
    required this.packHash,
    required this.manifest,
    required this.decision,
    this.declineReasons,
    required this.signerName,
    required this.signedAt,
    this.supersedesId,
    this.hasSignature = false,
  });

  String get shortHash => shortPackHash(packHash);
}

/// Pure validation, mirroring the server's 400s so the client fixes gaps on
/// the spot. Returns a code, or null when the sign-off can be recorded.
String? validateSignoff({
  required SignoffDecision? decision,
  required String? declineReasons,
  required String signerName,
  required bool hasSignature,
}) {
  if (decision == null) return 'DECISION_REQUIRED';
  if (decision == SignoffDecision.declined &&
      (declineReasons == null || declineReasons.trim().isEmpty)) {
    return 'REASONS_REQUIRED';
  }
  if (signerName.trim().isEmpty) return 'NAME_REQUIRED';
  if (!hasSignature) return 'SIGNATURE_MISSING';
  return null;
}

class ClientSignoffService {
  ClientSignoffService._();
  static final ClientSignoffService instance = ClientSignoffService._();

  final Map<String, HandoverPack> _packs = {};
  final Map<String, List<ClientSignoff>> _signoffs = {};
  final ValueNotifier<int> changes = ValueNotifier(0);

  @visibleForTesting
  void resetForTest() {
    _packs.clear();
    _signoffs.clear();
  }

  /// `handover.witness` (projectManager in v050). **Mockup:** v050 isn't
  /// built, so no session holds it yet; a PM is let through until it is.
  bool get canWitness {
    final p = PermissionsService.instance;
    return p.has('handover.witness') || p.role == 'projectManager';
  }

  /// The project's pack, or null while it has no handover documents. The
  /// pack is NOT gated on S18.3; the screen gates signing on Stage 18
  /// being validated (Server, x51 2026-10-14). **Mockup:** a fixture pack.
  HandoverPack? packFor(String projectId) =>
      _packs[projectId] ??= _fixturePack(projectId, 0);

  /// Newest first.
  List<ClientSignoff> signoffs(String projectId) =>
      List.unmodifiable((_signoffs[projectId] ?? const []).reversed);

  /// The sign-off that currently satisfies S18.14, if any: accepted, not
  /// superseded, and signed against the current pack (x51 §6 trigger).
  ClientSignoff? current(String projectId) {
    final pack = packFor(projectId);
    final list = _signoffs[projectId] ?? const [];
    final superseded = {for (final s in list) ?s.supersedesId};
    for (final s in list.reversed) {
      if (superseded.contains(s.id)) continue;
      return s.decision == SignoffDecision.accepted && s.packHash == pack?.packHash
          ? s
          : null;
    }
    return null;
  }

  /// The latest sign-off, if the pack has changed since it was signed. The
  /// app then asks for a new signature that supersedes it.
  ClientSignoff? staleSignoff(String projectId) {
    final list = _signoffs[projectId] ?? const [];
    if (list.isEmpty) return null;
    final last = list.last;
    return last.packHash == packFor(projectId)?.packHash ? null : last;
  }

  /// Record an assisted sign-off (client signs on this device, the PM
  /// witnesses). Returns a refusal code, or null when recorded. Real wiring:
  /// upload the signature, then push the row create-only.
  Future<String?> recordAssisted({
    required String projectId,
    required HandoverPack pack,
    required SignoffDecision? decision,
    String? declineReasons,
    required String signerName,
    Uint8List? signaturePng,
  }) async {
    if (!canWitness) return 'FORBIDDEN';
    final invalid = validateSignoff(
      decision: decision,
      declineReasons: declineReasons,
      signerName: signerName,
      hasSignature: signaturePng != null && signaturePng.isNotEmpty,
    );
    if (invalid != null) return invalid;
    final list = _signoffs[projectId] ??= [];
    list.add(ClientSignoff(
      id: const Uuid().v4(),
      projectId: projectId,
      method: SignoffMethod.assistedDevice,
      packHash: pack.packHash,
      manifest: pack.manifest, // what the signer saw, as pulled
      decision: decision!,
      declineReasons:
          decision == SignoffDecision.declined ? declineReasons!.trim() : null,
      signerName: signerName.trim(),
      signedAt: DateTime.now(),
      supersedesId: list.isEmpty ? null : list.last.id,
      hasSignature: true,
    ));
    changes.value++;
    return null;
  }

  /// **Mockup only:** stand in for a handover document being added or
  /// removed in the Portal, which changes the server's pack hash.
  void mockChangePack(String projectId) {
    final hasExtra = (_packs[projectId]?.manifest.length ?? 6) > 6;
    _packs[projectId] = _fixturePack(projectId, hasExtra ? 0 : 1);
    changes.value++;
  }

  static HandoverPack _fixturePack(String projectId, int extra) {
    const docs = [
      ('occupation_certificate', 'Occupation Certificate.pdf'),
      ('ba3', 'Form BA3 - Certificate of Compliance.pdf'),
      ('certificate', 'Electrical safety certificate.pdf'),
      ('certificate', 'Plumbing compliance certificate.pdf'),
      ('manual', 'Appliance manuals.pdf'),
      ('warranty', 'Home warranty insurance.pdf'),
    ];
    final manifest = [
      for (var i = 0; i < docs.length; i++)
        PackDocument(
          documentId: 'sample-doc-$i',
          kind: docs[i].$1,
          fileName: docs[i].$2,
          sha256: _fakeHex(i * 31 + 7),
        ),
      if (extra > 0)
        PackDocument(
          documentId: 'sample-doc-asbuilt',
          kind: 'as_built',
          fileName: 'As-built drawings.pdf',
          sha256: _fakeHex(991),
        ),
    ];
    return HandoverPack(
      projectId: projectId,
      // Sample value: the real hash always comes from the server.
      packHash: _fakeHex(extra == 0 ? 12345 : 54321),
      manifest: manifest,
      computedAt: DateTime.now(),
    );
  }

  static String _fakeHex(int seed) {
    final b = StringBuffer();
    var x = seed;
    while (b.length < 64) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      b.write((x % 16).toRadixString(16));
    }
    return b.toString();
  }
}
