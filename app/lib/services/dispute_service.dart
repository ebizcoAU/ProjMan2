import 'package:uuid/uuid.dart';
import 'db_service.dart';
import 'session_service.dart';

/// Escalation & dispute mechanism (appdesignspecification.md §2.7): "a Tradie
/// (or any verified party) who wishes to contest a verification decision
/// escalates to Site Supervisor first, decisively — not Builder." This client
/// is deliberately **local-only** — there is no server table/endpoint for
/// disputes yet (unlike [QualityOpsService], which rides `/sync/push` against
/// a real registry entry), so raising or resolving a dispute here does not
/// leave the device. Wiring sync later is a registry change against this same
/// shape, not a rewrite — `is_dirty`/`pending_op`/`ever_synced` are already
/// carried on the row.
///
/// Append-only per §2.7: resolving never deletes or overwrites the original
/// call — [resolve] only ever adds `resolution_note`/`resolved_*` alongside
/// the untouched `reason`/`raised_by` fields already on the row.
class DisputeService {
  DisputeService._();
  static final DisputeService instance = DisputeService._();

  final DatabaseService _db = DatabaseService();

  Future<List<DisputeEntry>> list({String? projectId, DisputeStatus? status}) async {
    final where = <String>['is_deleted = 0'];
    final args = <Object?>[];
    if (projectId != null) {
      where.add('project_id = ?');
      args.add(projectId);
    }
    if (status != null) {
      where.add('status = ?');
      args.add(_statusWire(status));
    }
    final rows = await _db.query('disputes',
        where: where.join(' AND '),
        whereArgs: args,
        orderBy: 'created_at DESC');
    return rows.map(DisputeEntry._fromRow).toList();
  }

  /// Raise a dispute against a specific record — [subjectType]/[subjectId]
  /// identify what's being contested (e.g. `'inspection_item'` + the item's
  /// id); [subjectLabel] is a human-readable summary shown in the queue.
  Future<DisputeEntry> raise({
    String? projectId,
    required String subjectType,
    required String subjectId,
    String? subjectLabel,
    required String reason,
    String? counterEvidencePhotoId,
  }) async {
    final user = await SessionService.currentUser();
    final entry = DisputeEntry(
      projectId: projectId,
      subjectType: subjectType,
      subjectId: subjectId,
      subjectLabel: subjectLabel,
      raisedBy: user?['id']?.toString(),
      raisedByName: (user?['full_name'] ?? user?['fullName'])?.toString(),
      reason: reason,
      counterEvidencePhotoId: counterEvidencePhotoId,
    );
    await _write(entry);
    return entry;
  }

  /// Site Supervisor's (or, if unavailable/conflicted, PM's) resolution —
  /// append-only: the original [DisputeEntry.reason] stays on the row
  /// unchanged, this only sets the resolution fields.
  Future<void> resolve(
    DisputeEntry d, {
    required String resolutionNote,
    bool upheld = true,
  }) async {
    final user = await SessionService.currentUser();
    d.status = DisputeStatus.resolved;
    d.resolutionNote = resolutionNote;
    d.resolvedBy = user?['id']?.toString();
    d.resolvedByName = (user?['full_name'] ?? user?['fullName'])?.toString();
    d.resolvedAt = DateTime.now();
    await _write(d);
  }

  Future<void> markReviewing(DisputeEntry d) async {
    d.status = DisputeStatus.reviewing;
    await _write(d);
  }

  Future<void> _write(DisputeEntry e) async {
    final row = <String, Object?>{
      'id': e.id,
      'project_id': e.projectId,
      'subject_type': e.subjectType,
      'subject_id': e.subjectId,
      'subject_label': e.subjectLabel,
      'raised_by': e.raisedBy,
      'raised_by_name': e.raisedByName,
      'reason': e.reason,
      'counter_evidence_photo_id': e.counterEvidencePhotoId,
      'status': _statusWire(e.status),
      'resolution_note': e.resolutionNote,
      'resolved_by': e.resolvedBy,
      'resolved_by_name': e.resolvedByName,
      'resolved_at': e.resolvedAt?.toIso8601String(),
      'is_deleted': 0,
      'is_dirty': 1,
      'pending_op': 'create', // never pushed today — see class doc
      'created_at': e.createdAtMs,
      'updated_at': DateTime.now().millisecondsSinceEpoch,
    };
    final existing = await _db.query('disputes',
        columns: ['id'], where: 'id = ?', whereArgs: [e.id], limit: 1);
    if (existing.isEmpty) {
      await _db.insert('disputes', row);
    } else {
      await _db.update('disputes', row, where: 'id = ?', whereArgs: [e.id]);
    }
  }

  static String _statusWire(DisputeStatus s) => switch (s) {
        DisputeStatus.open => 'open',
        DisputeStatus.reviewing => 'reviewing',
        DisputeStatus.resolved => 'resolved',
      };

  static DisputeStatus _statusFromWire(Object? s) => switch (s) {
        'reviewing' => DisputeStatus.reviewing,
        'resolved' => DisputeStatus.resolved,
        _ => DisputeStatus.open,
      };
}

enum DisputeStatus { open, reviewing, resolved }

class DisputeEntry {
  final String id;
  final String? projectId;
  final String subjectType;
  final String subjectId;
  final String? subjectLabel;
  final String? raisedBy;
  final String? raisedByName;
  final String reason;
  final String? counterEvidencePhotoId;
  DisputeStatus status;
  String? resolutionNote;
  String? resolvedBy;
  String? resolvedByName;
  DateTime? resolvedAt;
  final int createdAtMs;

  DisputeEntry({
    String? id,
    this.projectId,
    required this.subjectType,
    required this.subjectId,
    this.subjectLabel,
    this.raisedBy,
    this.raisedByName,
    required this.reason,
    this.counterEvidencePhotoId,
    this.status = DisputeStatus.open,
    this.resolutionNote,
    this.resolvedBy,
    this.resolvedByName,
    this.resolvedAt,
    int? createdAtMs,
  })  : id = id ?? const Uuid().v4(),
        createdAtMs = createdAtMs ?? DateTime.now().millisecondsSinceEpoch;

  static DisputeEntry _fromRow(Map<String, Object?> r) => DisputeEntry(
        id: r['id'] as String,
        projectId: r['project_id'] as String?,
        subjectType: (r['subject_type'] as String?) ?? '',
        subjectId: (r['subject_id'] as String?) ?? '',
        subjectLabel: r['subject_label'] as String?,
        raisedBy: r['raised_by'] as String?,
        raisedByName: r['raised_by_name'] as String?,
        reason: (r['reason'] as String?) ?? '',
        counterEvidencePhotoId: r['counter_evidence_photo_id'] as String?,
        status: DisputeService._statusFromWire(r['status']),
        resolutionNote: r['resolution_note'] as String?,
        resolvedBy: r['resolved_by'] as String?,
        resolvedByName: r['resolved_by_name'] as String?,
        resolvedAt: r['resolved_at'] == null
            ? null
            : DateTime.tryParse(r['resolved_at'].toString()),
        createdAtMs: (r['created_at'] as int?) ??
            DateTime.now().millisecondsSinceEpoch,
      );
}
