import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import 'db_service.dart';
import 'document_queue_service.dart';
import 'sync_client.dart';

/// Sign-offs: the one place a person's signature against a subject lives.
/// It's backed by the shared `signoffs` table (xprojman-48 F6, created by
/// server migration v047). Every caller goes through this store and never
/// names the table, so v048's extra subject types (site inductions, SWMS)
/// land here without touching callers.
///
/// Contract with the server:
/// - The signature image is a `documents` row with `entity_type='signoff'`
///   (kind `signature`), keyed by [Signoff.id]. It rides the offline
///   document queue and is never a column on the row (xprojman-46 §7 #1).
/// - `signed_at` is client-writable: the moment of signing on site.
/// - Both `user_id` and `name` are sent, so the signer's name shows on every
///   device, including for a team member.
/// - A sign-off on a completed checklist is refused with `CHECKLIST_FROZEN`.
///   That's terminal: the row is dropped locally and the server copy wins.
enum SignoffSubject {
  checklistInstance('checklist_instance'),
  siteInduction('site_induction'),
  swms('swms');

  final String wire;
  const SignoffSubject(this.wire);

  static SignoffSubject fromWire(Object? w) => SignoffSubject.values
      .firstWhere((s) => s.wire == w, orElse: () => SignoffSubject.checklistInstance);
}

class Signoff {
  final String id;
  final SignoffSubject subjectType;
  final String subjectId;
  final String projectId;

  /// The signer: a user ([userId] set) or a visitor / non-user (name only).
  final String? userId;
  final String displayName;
  final DateTime signedAt;

  /// Local cache of the signature document: a `client_ref` until uploaded,
  /// then the `document_id`.
  final List<String> signatureIds;
  final bool isSynced;

  Signoff({
    required this.id,
    required this.subjectType,
    required this.subjectId,
    required this.projectId,
    this.userId,
    required this.displayName,
    required this.signedAt,
    this.signatureIds = const [],
    this.isSynced = false,
  });

  bool get isVisitor => userId == null;
  bool get hasSignature => signatureIds.isNotEmpty;

  static Signoff _fromRow(Map<String, Object?> r) => Signoff(
        id: r['id'] as String,
        subjectType: SignoffSubject.fromWire(r['subject_type']),
        subjectId: r['subject_id'] as String,
        projectId: (r['project_id'] as String?) ?? '',
        userId: r['user_id'] as String?,
        displayName: (r['name'] as String?) ?? 'Team member',
        signedAt: SignoffStore._parseDt(r['signed_at']) ?? DateTime.now(),
        signatureIds: SignoffStore._decIds(r['signature_ids']),
        isSynced: ((r['ever_synced'] as int?) ?? 0) == 1 &&
            ((r['is_dirty'] as int?) ?? 0) == 0,
      );
}

/// Outcome of pushing one sign-off, for the caller's flush bookkeeping.
enum SignoffPush { synced, retryLater, dropped }

class SignoffStore {
  SignoffStore._();
  static final SignoffStore instance = SignoffStore._();

  static const table = 'signoffs';
  final DatabaseService _db = DatabaseService();

  static const _wireCols = [
    'subject_type', 'subject_id', 'project_id', 'user_id', 'name',
    'signed_at', 'is_deleted', 'updated_at',
  ];

  Future<List<Signoff>> signoffsFor(
      SignoffSubject type, String subjectId) async {
    final rows = await _db.query(table,
        where: 'subject_type = ? AND subject_id = ? AND is_deleted = 0',
        whereArgs: [type.wire, subjectId],
        orderBy: 'signed_at ASC');
    return rows.map(Signoff._fromRow).toList();
  }

  /// Record a sign-off locally and queue its signature. The row itself is
  /// pushed by the owner's flush, after the subject exists server-side.
  Future<Signoff> add({
    required SignoffSubject subjectType,
    required String subjectId,
    required String projectId,
    String? userId,
    required String displayName,
    Uint8List? signaturePng,
  }) async {
    final id = const Uuid().v4();
    final now = DateTime.now();
    final refs = <String>[];
    if (signaturePng != null) {
      refs.add(await DocumentQueueService.instance.enqueue(
        entityType: 'signoff',
        entityId: id,
        bytes: signaturePng,
        projectId: projectId,
        originalFilename: 'signature.png',
        mimeType: 'image/png',
      ));
    }
    await _db.insert(table, {
      'id': id,
      'subject_type': subjectType.wire,
      'subject_id': subjectId,
      'project_id': projectId,
      'user_id': userId,
      'name': displayName,
      'signed_at': _dtStr(now),
      'signature_ids': refs.isEmpty ? null : jsonEncode(refs),
      'is_deleted': 0,
      'is_dirty': 1,
      'pending_op': 'create',
      'ever_synced': 0,
      'updated_at': now.millisecondsSinceEpoch,
    });
    return Signoff(
      id: id,
      subjectType: subjectType,
      subjectId: subjectId,
      projectId: projectId,
      userId: userId,
      displayName: displayName,
      signedAt: now,
      signatureIds: refs,
    );
  }

  /// Remove a sign-off before the subject is completed. A row the server has
  /// never seen is deleted outright, along with its unsent signature. A
  /// synced row is soft-deleted and pushed.
  Future<void> remove(Signoff s) async {
    final rows = await _db.query(table,
        columns: ['ever_synced'], where: 'id = ?', whereArgs: [s.id], limit: 1);
    if (rows.isEmpty) return;
    if (((rows.first['ever_synced'] as int?) ?? 0) == 0) {
      await DocumentQueueService.instance.discardUnsentFor('signoff', s.id);
      await _db.delete(table, where: 'id = ?', whereArgs: [s.id]);
      return;
    }
    await _db.update(table, {
      'is_deleted': 1,
      'is_dirty': 1,
      'pending_op': 'update',
      'updated_at': DateTime.now().millisecondsSinceEpoch,
    }, where: 'id = ?', whereArgs: [s.id]);
  }

  /// True when no sign-off for these subjects is waiting to be pushed.
  Future<bool> isCleanFor(List<String> subjectIds) async {
    if (subjectIds.isEmpty) return true;
    final ph = List.filled(subjectIds.length, '?').join(', ');
    final rows = await _db.rawQuery(
        'SELECT COUNT(*) AS n FROM $table WHERE is_dirty = 1 '
        'AND subject_id IN ($ph)',
        subjectIds);
    return ((rows.first['n'] as int?) ?? 0) == 0;
  }

  /// The ids of live sign-offs for these subjects. Used to check that their
  /// signature uploads have landed before a completion push.
  Future<List<String>> idsFor(List<String> subjectIds) async {
    if (subjectIds.isEmpty) return const [];
    final ph = List.filled(subjectIds.length, '?').join(', ');
    final rows = await _db.rawQuery(
        'SELECT id FROM $table WHERE is_deleted = 0 AND subject_id IN ($ph)',
        subjectIds);
    return rows.map((r) => r['id'] as String).toList();
  }

  /// Push the dirty sign-offs whose subject is in [subjectIds]. The caller
  /// passes only subjects the server already has, so the guard can find the
  /// parent.
  Future<void> flushFor(List<String> subjectIds) async {
    if (subjectIds.isEmpty) return;
    final ph = List.filled(subjectIds.length, '?').join(', ');
    final rows = await _db.rawQuery(
        'SELECT * FROM $table WHERE is_dirty = 1 AND subject_id IN ($ph)',
        subjectIds);
    for (final r in rows) {
      if (await _pushOne(r) == SignoffPush.retryLater) return;
    }
  }

  Future<SignoffPush> _pushOne(Map<String, Object?> r) async {
    final id = r['id'] as String;
    final op = (r['pending_op'] as String?) ?? 'update';
    try {
      final res = await SyncClient.push(
        table: table,
        operation: op,
        data: {for (final c in _wireCols) if (r.containsKey(c)) c: r[c]},
        localId: id,
      );
      if (res.success) {
        await _db.update(table,
            {'is_dirty': 0, 'pending_op': null, 'ever_synced': 1},
            where: 'id = ?', whereArgs: [id]);
        return SignoffPush.synced;
      }
      if (_isTransient(res.status)) return SignoffPush.retryLater;
      // Terminal (CHECKLIST_FROZEN, NOT_FOUND, VALIDATION_ERROR, FORBIDDEN):
      // stop retrying. The server's copy, if any, arrives on the next pull.
      debugPrint('[Signoffs] push $id refused: ${res.code} — dropped locally');
      if (((r['ever_synced'] as int?) ?? 0) == 0) {
        await _db.delete(table, where: 'id = ?', whereArgs: [id]);
      } else {
        await _db.update(table, {'is_dirty': 0, 'pending_op': null},
            where: 'id = ?', whereArgs: [id]);
      }
      return SignoffPush.dropped;
    } catch (e) {
      debugPrint('[Signoffs] push $id failed: $e — kept queued');
      return SignoffPush.retryLater;
    }
  }

  /// Apply one pulled `signoffs` row. A row with local changes still waiting
  /// to be pushed is left alone. Local-only columns (`signature_ids`) are
  /// kept.
  Future<void> applyPulled(Map<String, Object?> data) async {
    final id = data['id']?.toString();
    if (id == null) return;
    final existing = await _db.query(table,
        columns: ['is_dirty'], where: 'id = ?', whereArgs: [id], limit: 1);
    if (existing.isNotEmpty && ((existing.first['is_dirty'] as int?) ?? 0) == 1) {
      return;
    }
    final filtered = await _db.filterToTableColumns(table, data)
      ..remove('signature_ids');
    filtered
      ..['id'] = id
      ..['is_dirty'] = 0
      ..['pending_op'] = null
      ..['ever_synced'] = 1;
    if (existing.isEmpty) {
      await _db.insert(table, filtered);
    } else {
      await _db.update(table, filtered, where: 'id = ?', whereArgs: [id]);
    }
  }

  static bool _isTransient(int status) =>
      status == 0 || status == 429 || status >= 500;

  static String _dtStr(DateTime d) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${d.year.toString().padLeft(4, '0')}-${two(d.month)}-${two(d.day)} '
        '${two(d.hour)}:${two(d.minute)}:${two(d.second)}';
  }

  static DateTime? _parseDt(Object? v) {
    if (v == null) return null;
    return DateTime.tryParse(v.toString().replaceFirst(' ', 'T'));
  }

  static List<String> _decIds(Object? raw) {
    if (raw == null || (raw is String && raw.isEmpty)) return [];
    try {
      return (jsonDecode(raw as String) as List).map((e) => e.toString()).toList();
    } catch (_) {
      return [];
    }
  }
}
