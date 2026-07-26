import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import 'db_service.dart';
import 'nexus_service.dart';
import 'sync_client.dart';

/// Quality-module client — inspections · defects · certificates (P6a,
/// servdesignspec §12, projman-05 §6/§10.1). Same architecture as
/// [SiteOpsService] (a separate file on purpose — different domain, different
/// gate): local SQLite is the source of truth for reads; every write lands
/// there first, then rides `/sync/push` and immediately pulls to reconcile the
/// PROTECTED columns this device never writes (`inspector_id`/`completed_at`,
/// `raised_by`/`raised_at`/`closed_at`/`closed_by`).
///
/// One deliberate deviation from "everything rides sync": **completing an
/// inspection is REST-only** (`POST …/inspections/:iid/complete`) — the one
/// server-mediated action that can flip a hold-point stage's `is_validated`
/// through the existing `StageProgressionService.validate` (§12.4). The app
/// never pushes `inspections.result` through `/sync/push` at all — even though
/// the registry technically allows a QA/fail write that way — so there is
/// exactly one path a verdict can arrive by, matching the build directive.
class QualityOpsService {
  QualityOpsService._();
  static final QualityOpsService instance = QualityOpsService._();

  final DatabaseService _db = DatabaseService();

  final Map<String, List<InspectionEntry>> _inspections = {};
  final Map<String, List<DefectEntry>> _defects = {};
  final Map<String, List<CertificateEntry>> _certificates = {};

  static const _ourTables = {
    'inspections', 'inspection_items', 'defects', 'certificates',
  };

  /// What this device may PUSH per table — excludes every PROTECTED column
  /// (projman-05 §6.2, servdesignspec §12.9): `inspector_id`/`completed_at`
  /// (inspections — REST-only, see class doc), `raised_by`/`raised_at`/
  /// `closed_at`/`closed_by` (defects). `inspections.result` is deliberately
  /// excluded too (see class doc) even though the registry allows a bare
  /// QA/fail write — [completeInspection] is the only path a verdict travels.
  /// `inspection_items` carries no `project_id` (§12.9 — parent-scoped).
  static const _writableCols = {
    'inspections': [
      'project_id', 'stage_id', 'type', 'is_hold_point', 'scheduled_at',
      'reference', 'document_id', 'notes', 'is_deleted',
    ],
    'inspection_items': [
      'inspection_id', 'seq', 'description', 'result', 'note', 'photo_id',
      'is_deleted',
    ],
    'defects': [
      'project_id', 'stage_id', 'location', 'trade', 'description',
      'assigned_to', 'assigned_to_name', 'due_date', 'severity', 'status',
      'photo_id', 'photo_after_id', 'is_deleted',
    ],
    'certificates': [
      'project_id', 'stage_id', 'type', 'reference', 'issued_by', 'issued_at',
      'expires_at', 'document_id', 'notes', 'is_deleted',
    ],
  };

  // ── Hydration ────────────────────────────────────────────────────────────
  Future<void> hydrateProject(String projectId) async {
    await _pullAndApply();
    await _reload(projectId);
    unawaited(_flushPending());
  }

  Future<void> _reload(String projectId) async {
    await Future.wait([
      _loadInspections(projectId),
      _loadDefects(projectId),
      _loadCertificates(projectId),
    ]);
  }

  Future<void> _loadInspections(String projectId) async {
    final rows = await _db.query('inspections',
        where: 'project_id = ? AND is_deleted = 0',
        whereArgs: [projectId],
        orderBy: 'scheduled_at DESC, created_at DESC');
    final inspections = rows.map(InspectionEntry._fromRow).toList();
    if (inspections.isEmpty) {
      _inspections[projectId] = inspections;
      return;
    }
    final ids = inspections.map((i) => i.id).toList();
    final placeholders = List.filled(ids.length, '?').join(', ');
    final itemRows = await _db.rawQuery(
        'SELECT * FROM inspection_items '
        'WHERE inspection_id IN ($placeholders) AND is_deleted = 0 '
        'ORDER BY seq ASC',
        ids);
    final byInspection = <String, List<InspectionItemEntry>>{};
    for (final r in itemRows) {
      final item = InspectionItemEntry._fromRow(r);
      (byInspection[item.inspectionId] ??= []).add(item);
    }
    for (final i in inspections) {
      i.items
        ..clear()
        ..addAll(byInspection[i.id] ?? const []);
    }
    _inspections[projectId] = inspections;
  }

  Future<void> _loadDefects(String projectId) async {
    final rows = await _db.query('defects',
        where: 'project_id = ? AND is_deleted = 0',
        whereArgs: [projectId],
        orderBy: 'raised_at DESC');
    _defects[projectId] = rows.map(DefectEntry._fromRow).toList();
  }

  Future<void> _loadCertificates(String projectId) async {
    final rows = await _db.query('certificates',
        where: 'project_id = ? AND is_deleted = 0',
        whereArgs: [projectId],
        orderBy: 'expires_at ASC, issued_at DESC');
    _certificates[projectId] = rows.map(CertificateEntry._fromRow).toList();
  }

  // ── Inspections ──────────────────────────────────────────────────────────
  List<InspectionEntry> inspections(String projectId) =>
      List.unmodifiable(_inspections[projectId] ?? const []);

  /// [isHoldPoint] should mirror the selected stage's `isHoldPoint` (computed
  /// by the caller from the already-cached `ProjectStage` list — Decision 3)
  /// — `false` for a stand-alone QA inspection with no stage.
  Future<InspectionEntry> createInspection(
    String projectId, {
    required String type,
    String? stageId,
    required bool isHoldPoint,
    DateTime? scheduledAt,
    String? notes,
  }) async {
    final entry = InspectionEntry(
      projectId: projectId,
      stageId: stageId,
      type: type,
      isHoldPoint: isHoldPoint,
      scheduledAt: scheduledAt,
      notes: notes ?? '',
    );
    await _writeInspection(entry);
    await _reload(projectId);
    return entry;
  }

  Future<void> _writeInspection(InspectionEntry e) async {
    final row = <String, Object?>{
      'id': e.id,
      'project_id': e.projectId,
      'stage_id': e.stageId,
      'type': e.type,
      'is_hold_point': e.isHoldPoint ? 1 : 0,
      'scheduled_at': e.scheduledAt == null ? null : _dtStr(e.scheduledAt!),
      'reference': e.reference,
      'document_id': e.documentId,
      'notes': e.notes,
      'is_deleted': 0,
      'created_at': DateTime.now().millisecondsSinceEpoch,
      'updated_at': DateTime.now().millisecondsSinceEpoch,
    };
    await _upsertAndPush('inspections', e.id, row);
  }

  Future<void> addInspectionItem(
    String projectId,
    String inspectionId, {
    required int seq,
    required String description,
  }) async {
    final item = InspectionItemEntry(
      inspectionId: inspectionId,
      seq: seq,
      description: description,
    );
    await _writeInspectionItem(item);
    await _reload(projectId);
  }

  Future<void> updateInspectionItem(
    String projectId,
    InspectionItemEntry item, {
    ItemResult? result,
    String? note,
    String? photoId,
  }) async {
    if (result != null) item.result = result;
    if (note != null) item.note = note;
    if (photoId != null) item.photoId = photoId;
    await _writeInspectionItem(item);
    await _reload(projectId);
  }

  Future<void> _writeInspectionItem(InspectionItemEntry e) async {
    final row = <String, Object?>{
      'id': e.id,
      'inspection_id': e.inspectionId,
      'seq': e.seq,
      'description': e.description,
      'result': e.result.name,
      'note': e.note,
      'photo_id': e.photoId,
      'is_deleted': 0,
      'created_at': DateTime.now().millisecondsSinceEpoch,
      'updated_at': DateTime.now().millisecondsSinceEpoch,
    };
    await _upsertAndPush('inspection_items', e.id, row);
  }

  /// `POST /projects/:id/inspections/:iid/complete` — REST-only (class doc).
  /// A hold-point PASS additionally needs `quality.validate` server-side
  /// (`StageProgressionService.validate`); a non-inspector attempt comes back
  /// `FORBIDDEN` here rather than silently no-op-ing, so gate the UI with
  /// `PermissionsService.has('quality.validate')` but still let the call
  /// surface the server's own refusal as the source of truth.
  Future<QualityActionResult> completeInspection(
    String projectId,
    String inspectionId, {
    required InspectionResult result,
    String? reference,
    String? documentId,
  }) async {
    final res = await NexusService.authedPost(
      '/projects/$projectId/inspections/$inspectionId/complete',
      {
        'result': result.name,
        'reference': ?reference,
        'document_id': ?documentId,
      },
    );
    if (res.success) {
      await _pullAndApply();
      await _reload(projectId);
    }
    return QualityActionResult(
        success: res.success, code: res.code, message: res.message);
  }

  // ── Defects ──────────────────────────────────────────────────────────────
  List<DefectEntry> defects(String projectId, {DefectStatus? status}) {
    final all = _defects[projectId] ?? const [];
    if (status == null) return List.unmodifiable(all);
    return List.unmodifiable(all.where((d) => d.status == status));
  }

  Future<void> raiseDefect(String projectId, DefectEntry d) async {
    await _writeDefect(d);
    await _reload(projectId);
  }

  /// Mutate [d]'s fields (status, assignment, …) before calling — mirrors
  /// `AttendanceEntry`'s mutate-then-persist shape in `SiteOpsService`.
  Future<void> updateDefect(String projectId, DefectEntry d) async {
    await _writeDefect(d);
    await _reload(projectId);
  }

  Future<void> _writeDefect(DefectEntry e) async {
    final row = <String, Object?>{
      'id': e.id,
      'project_id': e.projectId,
      'stage_id': e.stageId,
      'location': e.location,
      'trade': e.trade,
      'description': e.description,
      'assigned_to': e.assignedTo,
      'assigned_to_name': e.assignedToName,
      'due_date': e.dueDate == null ? null : _dateStr(e.dueDate!),
      'severity': e.severity.name,
      'status': _defectStatusWire(e.status),
      'photo_id': e.photoId,
      'photo_after_id': e.photoAfterId,
      'is_deleted': 0,
      'created_at': DateTime.now().millisecondsSinceEpoch,
      'updated_at': DateTime.now().millisecondsSinceEpoch,
    };
    await _upsertAndPush('defects', e.id, row);
  }

  // ── Certificates ─────────────────────────────────────────────────────────
  List<CertificateEntry> certificates(String projectId) =>
      List.unmodifiable(_certificates[projectId] ?? const []);

  Future<void> recordCertificate(String projectId, CertificateEntry c) async {
    await _writeCertificate(c);
    await _reload(projectId);
  }

  Future<void> _writeCertificate(CertificateEntry e) async {
    final row = <String, Object?>{
      'id': e.id,
      'project_id': e.projectId,
      'stage_id': e.stageId,
      'type': e.type,
      'reference': e.reference,
      'issued_by': e.issuedBy,
      'issued_at': e.issuedAt == null ? null : _dateStr(e.issuedAt!),
      'expires_at': e.expiresAt == null ? null : _dateStr(e.expiresAt!),
      'document_id': e.documentId,
      'notes': e.notes,
      'is_deleted': 0,
      'created_at': DateTime.now().millisecondsSinceEpoch,
      'updated_at': DateTime.now().millisecondsSinceEpoch,
    };
    await _upsertAndPush('certificates', e.id, row);
  }

  // ── Project team (defect-assignee autocomplete, Decision 2) ────────────────
  /// `GET /projects/:id/members` — a plain REST read, no local cache; the
  /// punch-list's "assign" field autocompletes against this when reachable,
  /// falling back to free text (`assigned_to_name`) when it isn't.
  Future<List<TeamMember>> fetchProjectMembers(String projectId) async {
    final res = await NexusService.authedGet('/projects/$projectId/members');
    if (!res.success) return const [];
    final rows = (res.data['members'] as List?) ?? const [];
    return rows
        .map((r) => TeamMember.fromJson(Map<String, dynamic>.from(r as Map)))
        .toList();
  }

  // ── Persistence + sync plumbing (mirrors SiteOpsService) ────────────────

  Future<void> _upsertAndPush(
      String table, String id, Map<String, Object?> row) async {
    final existing = await _db.query(table,
        columns: ['ever_synced'], where: 'id = ?', whereArgs: [id], limit: 1);
    final everSynced =
        existing.isNotEmpty && (existing.first['ever_synced'] as int? ?? 0) == 1;
    final op = everSynced ? 'update' : 'create';
    final toStore = {...row, 'is_dirty': 1, 'pending_op': op};
    if (existing.isEmpty) {
      await _db.insert(table, toStore);
    } else {
      await _db.update(table, toStore, where: 'id = ?', whereArgs: [id]);
    }

    final wireData = _wireDataFor(table, row);
    try {
      final res = await SyncClient.push(
          table: table, operation: op, data: wireData, localId: id);
      if (res.success) {
        await _db.update(
            table, {'is_dirty': 0, 'pending_op': null, 'ever_synced': 1},
            where: 'id = ?', whereArgs: [id]);
        await _pullAndApply();
      } else {
        debugPrint('[QualityOps] push $table/$id ($op) rejected: '
            '${res.code} ${res.message} — kept queued for retry');
      }
    } catch (e) {
      debugPrint('[QualityOps] push $table/$id ($op) failed: $e — kept queued');
    }
  }

  Future<void> _flushPending() async {
    for (final table in _ourTables) {
      final rows = await _db.query(table, where: 'is_dirty = 1');
      for (final row in rows) {
        final id = row['id'] as String;
        final op = (row['pending_op'] as String?) ?? 'update';
        final wireData = _wireDataFor(table, row);
        try {
          final res = await SyncClient.push(
              table: table, operation: op, data: wireData, localId: id);
          if (res.success) {
            await _db.update(
                table, {'is_dirty': 0, 'pending_op': null, 'ever_synced': 1},
                where: 'id = ?', whereArgs: [id]);
          }
        } catch (_) {
          // Still offline — leave it queued.
        }
      }
    }
  }

  Future<void> _pullAndApply() async {
    try {
      final since = await _getCursor();
      final res = await SyncClient.pull(since: since);
      if (!res.success) return;
      final changes = (res.data['changes'] as List?) ?? const [];
      for (final raw in changes) {
        final c = Map<String, dynamic>.from(raw as Map);
        final table = c['table_name']?.toString();
        if (table == null || !_ourTables.contains(table)) continue;
        final data = Map<String, Object?>.from(c['data'] as Map? ?? const {});
        final id = data['id']?.toString() ?? c['local_id']?.toString();
        if (id == null) continue;
        final filtered = await _db.filterToTableColumns(table, data);
        if (filtered.isEmpty) continue;
        filtered['id'] = id;
        filtered['is_dirty'] = 0;
        filtered['pending_op'] = null;
        filtered['ever_synced'] = 1;
        final exists =
            await _db.query(table, where: 'id = ?', whereArgs: [id], limit: 1);
        if (exists.isEmpty) {
          await _db.insert(table, filtered);
        } else {
          await _db.update(table, filtered, where: 'id = ?', whereArgs: [id]);
        }
      }
      final lastSync = res.data['last_sync_at'];
      final nextCursor = lastSync is int
          ? lastSync
          : int.tryParse(lastSync?.toString() ?? '') ?? since;
      await _setCursor(nextCursor);
    } catch (e) {
      debugPrint('[QualityOps] pull failed: $e');
    }
  }

  Map<String, dynamic> _wireDataFor(String table, Map<String, Object?> row) {
    final cols = _writableCols[table]!;
    return {for (final c in cols) if (row.containsKey(c)) c: row[c]};
  }

  static const _cursorKey = 'quality_pull_cursor';

  Future<int> _getCursor() async {
    final rows = await _db.query('sync_metadata',
        where: 'key = ?', whereArgs: [_cursorKey], limit: 1);
    if (rows.isEmpty) return 0;
    return int.tryParse(rows.first['value']?.toString() ?? '0') ?? 0;
  }

  Future<void> _setCursor(int ms) async {
    final rows = await _db.query('sync_metadata',
        where: 'key = ?', whereArgs: [_cursorKey], limit: 1);
    final values = {
      'key': _cursorKey,
      'value': ms.toString(),
      'updated_at': DateTime.now().millisecondsSinceEpoch,
    };
    if (rows.isEmpty) {
      await _db.insert('sync_metadata', values);
    } else {
      await _db.update('sync_metadata', values,
          where: 'key = ?', whereArgs: [_cursorKey]);
    }
  }

  static String _defectStatusWire(DefectStatus s) => switch (s) {
        DefectStatus.open => 'open',
        DefectStatus.inProgress => 'in_progress',
        DefectStatus.closed => 'closed',
      };

  static DefectStatus _defectStatusFromWire(Object? s) => switch (s) {
        'in_progress' => DefectStatus.inProgress,
        'closed' => DefectStatus.closed,
        _ => DefectStatus.open,
      };

  static String _dateStr(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';

  static String _dtStr(DateTime d) =>
      '${_dateStr(d)} '
      '${d.hour.toString().padLeft(2, '0')}:'
      '${d.minute.toString().padLeft(2, '0')}:'
      '${d.second.toString().padLeft(2, '0')}';

  static DateTime? _parseDt(Object? v) {
    if (v == null) return null;
    return DateTime.tryParse(v.toString().replaceFirst(' ', 'T'));
  }
}

/// Result of a REST quality action (currently just [completeInspection]) —
/// mirrors `ProjectService.MutateResult`'s shape so the UI branches on a
/// stable `code`, never a message string.
class QualityActionResult {
  final bool success;
  final String? code;
  final String? message;
  const QualityActionResult({required this.success, this.code, this.message});
}

/// A project team member, for the defect-assignee autocomplete (Decision 2).
class TeamMember {
  final String userId;
  final String name;
  final String? role;
  const TeamMember({required this.userId, required this.name, this.role});

  static TeamMember fromJson(Map<String, dynamic> j) => TeamMember(
        userId: j['user_id'].toString(),
        name: (j['full_name'] as String?) ?? (j['email'] as String?) ?? '—',
        role: j['role'] as String?,
      );
}

// ── Local shapes (mirror servdesignspec §12.3; tolerant, additive-ready) ──────

enum InspectionResult { pending, pass, fail }
enum ItemResult { pending, pass, fail, na }
enum DefectSeverity { low, medium, high }
enum DefectStatus { open, inProgress, closed }

class InspectionEntry {
  final String id;
  final String projectId;
  final String? stageId;
  final String type;
  final bool isHoldPoint;
  final DateTime? scheduledAt;
  final String? inspectorId; // server-stamped (PROTECTED)
  InspectionResult result; // server-writable only via completeInspection
  final DateTime? completedAt; // server-stamped (PROTECTED)
  String? reference;
  String? documentId;
  String notes;
  final List<InspectionItemEntry> items;

  InspectionEntry({
    String? id,
    required this.projectId,
    this.stageId,
    required this.type,
    required this.isHoldPoint,
    this.scheduledAt,
    this.inspectorId,
    this.result = InspectionResult.pending,
    this.completedAt,
    this.reference,
    this.documentId,
    this.notes = '',
    List<InspectionItemEntry>? items,
  })  : id = id ?? const Uuid().v4(),
        items = items ?? [];

  bool get isComplete => result != InspectionResult.pending;

  static InspectionEntry _fromRow(Map<String, Object?> r) => InspectionEntry(
        id: r['id'] as String,
        projectId: r['project_id'] as String,
        stageId: r['stage_id'] as String?,
        type: (r['type'] as String?) ?? '',
        isHoldPoint: (r['is_hold_point'] as int? ?? 0) == 1,
        scheduledAt: QualityOpsService._parseDt(r['scheduled_at']),
        inspectorId: r['inspector_id'] as String?,
        result: InspectionResult.values.firstWhere(
            (v) => v.name == r['result'], orElse: () => InspectionResult.pending),
        completedAt: QualityOpsService._parseDt(r['completed_at']),
        reference: r['reference'] as String?,
        documentId: r['document_id'] as String?,
        notes: (r['notes'] as String?) ?? '',
      );
}

class InspectionItemEntry {
  final String id;
  final String inspectionId;
  int seq;
  String description;
  ItemResult result;
  String? note;
  String? photoId;

  InspectionItemEntry({
    String? id,
    required this.inspectionId,
    this.seq = 0,
    required this.description,
    this.result = ItemResult.pending,
    this.note,
    this.photoId,
  }) : id = id ?? const Uuid().v4();

  static InspectionItemEntry _fromRow(Map<String, Object?> r) =>
      InspectionItemEntry(
        id: r['id'] as String,
        inspectionId: r['inspection_id'] as String,
        seq: (r['seq'] as int?) ?? 0,
        description: (r['description'] as String?) ?? '',
        result: ItemResult.values.firstWhere((v) => v.name == r['result'],
            orElse: () => ItemResult.pending),
        note: r['note'] as String?,
        photoId: r['photo_id'] as String?,
      );
}

class DefectEntry {
  final String id;
  final String projectId;
  final String? stageId;
  final String? raisedBy; // server-stamped (PROTECTED)
  final DateTime? raisedAt; // server-stamped (PROTECTED)
  String? location;
  String? trade;
  String description;
  String? assignedTo; // users.id when staff
  String? assignedToName; // free text otherwise
  DateTime? dueDate;
  DefectSeverity severity;
  DefectStatus status;
  final DateTime? closedAt; // server-stamped (PROTECTED)
  final String? closedBy; // server-stamped (PROTECTED)
  String? photoId;
  String? photoAfterId;

  DefectEntry({
    String? id,
    required this.projectId,
    this.stageId,
    this.raisedBy,
    this.raisedAt,
    this.location,
    this.trade,
    required this.description,
    this.assignedTo,
    this.assignedToName,
    this.dueDate,
    this.severity = DefectSeverity.medium,
    this.status = DefectStatus.open,
    this.closedAt,
    this.closedBy,
    this.photoId,
    this.photoAfterId,
  }) : id = id ?? const Uuid().v4();

  static DefectEntry _fromRow(Map<String, Object?> r) => DefectEntry(
        id: r['id'] as String,
        projectId: r['project_id'] as String,
        stageId: r['stage_id'] as String?,
        raisedBy: r['raised_by'] as String?,
        raisedAt: QualityOpsService._parseDt(r['raised_at']),
        location: r['location'] as String?,
        trade: r['trade'] as String?,
        description: (r['description'] as String?) ?? '',
        assignedTo: r['assigned_to'] as String?,
        assignedToName: r['assigned_to_name'] as String?,
        dueDate: QualityOpsService._parseDt(r['due_date']),
        severity: DefectSeverity.values.firstWhere(
            (v) => v.name == r['severity'], orElse: () => DefectSeverity.medium),
        status: QualityOpsService._defectStatusFromWire(r['status']),
        closedAt: QualityOpsService._parseDt(r['closed_at']),
        closedBy: r['closed_by'] as String?,
        photoId: r['photo_id'] as String?,
        photoAfterId: r['photo_after_id'] as String?,
      );
}

class CertificateEntry {
  final String id;
  final String projectId;
  final String? stageId;
  String type;
  String? reference;
  String? issuedBy;
  DateTime? issuedAt;
  DateTime? expiresAt;
  String? documentId;
  String notes;

  CertificateEntry({
    String? id,
    required this.projectId,
    this.stageId,
    required this.type,
    this.reference,
    this.issuedBy,
    this.issuedAt,
    this.expiresAt,
    this.documentId,
    this.notes = '',
  }) : id = id ?? const Uuid().v4();

  bool get lapsingSoon =>
      expiresAt != null &&
      expiresAt!.difference(DateTime.now()).inDays <= 30;

  static CertificateEntry _fromRow(Map<String, Object?> r) => CertificateEntry(
        id: r['id'] as String,
        projectId: r['project_id'] as String,
        stageId: r['stage_id'] as String?,
        type: (r['type'] as String?) ?? '',
        reference: r['reference'] as String?,
        issuedBy: r['issued_by'] as String?,
        issuedAt: QualityOpsService._parseDt(r['issued_at']),
        expiresAt: QualityOpsService._parseDt(r['expires_at']),
        documentId: r['document_id'] as String?,
        notes: (r['notes'] as String?) ?? '',
      );
}
