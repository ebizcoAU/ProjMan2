import 'package:uuid/uuid.dart';

/// Sign-offs: the one place a person's signature against a subject lives.
/// **UI MOCKUP ONLY, in-memory, no schema/API.**
///
/// Shaped on purpose as the shared `signoffs` table proposed in xprojman-48
/// F6. That table generalises xprojman-46's `checklist_signoffs` and adds
/// `subject_type` + `subject_id`. Both docs are still drafts, so every
/// caller goes through this adapter and never names a table. If the rename
/// lands (or doesn't), this file is the only thing that changes when the
/// store is swapped for sync.
///
/// Later, this adapter's contract with the server:
/// - The signature image is a `documents` row with `entity_type='signoff'`,
///   keyed by [Signoff.id]. It's never a column on the sign-off
///   (xprojman-46 §7 #1).
/// - `signed_at` is client-writable: the moment of signing on site
///   (xprojman-46 §7).
/// - A sign-off on a completed checklist is refused (`CHECKLIST_FROZEN`,
///   xprojman-48 §8).
enum SignoffSubject {
  checklistInstance('checklist_instance'),
  siteInduction('site_induction'),
  swms('swms');

  final String wire;
  const SignoffSubject(this.wire);
}

class Signoff {
  final String id;
  final SignoffSubject subjectType;
  final String subjectId;
  final String projectId;

  /// Exactly one of [userId] / [name] identifies the signer. A visitor or
  /// another non-user on site has only a typed name.
  final String? userId;
  final String displayName;
  final DateTime signedAt;

  /// Mock stand-in for the signature document (see the class doc).
  final bool hasSignature;

  Signoff({
    String? id,
    required this.subjectType,
    required this.subjectId,
    required this.projectId,
    this.userId,
    required this.displayName,
    DateTime? signedAt,
    this.hasSignature = false,
  })  : id = id ?? const Uuid().v4(),
        signedAt = signedAt ?? DateTime.now();

  bool get isVisitor => userId == null;
}

class SignoffStore {
  SignoffStore._();
  static final SignoffStore instance = SignoffStore._();

  final List<Signoff> _rows = [];

  List<Signoff> signoffsFor(SignoffSubject type, String subjectId) => _rows
      .where((s) => s.subjectType == type && s.subjectId == subjectId)
      .toList()
    ..sort((a, b) => a.signedAt.compareTo(b.signedAt));

  Signoff add({
    required SignoffSubject subjectType,
    required String subjectId,
    required String projectId,
    String? userId,
    required String displayName,
    required bool hasSignature,
  }) {
    final s = Signoff(
      subjectType: subjectType,
      subjectId: subjectId,
      projectId: projectId,
      userId: userId,
      displayName: displayName,
      hasSignature: hasSignature,
    );
    _rows.add(s);
    return s;
  }

  void remove(String id) => _rows.removeWhere((s) => s.id == id);
}
