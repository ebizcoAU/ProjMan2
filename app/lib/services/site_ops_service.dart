import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import 'db_service.dart';
import 'sync_client.dart';

/// Site-operations client — diary · attendance · deliveries (P5, appspec §5.3,
/// servdesignspec §11). Local SQLite is the source of truth for the UI (reads
/// are synchronous cache lookups so the screens don't need a FutureBuilder
/// rewrite); every write lands there first (offline-safe), then pushes through
/// the generic `/sync/push` (no bespoke REST writers exist for these tables —
/// §11.7/§11.8) and immediately pulls to pick up server-derived provenance
/// (`geo_verified`, diary `author_id`/`is_current`, `received_by` — all
/// PROTECTED, §11.4–11.5). A push that fails (offline, permission) leaves the
/// row `is_dirty` for [hydrateProject] to retry next time the screen opens.
///
/// Keyed by projectId so switching sub-pages (Today ↔ Diary ↔ Attendance) keeps
/// the muster and today's draft without re-reading the DB on every rebuild.
class SiteOpsService {
  SiteOpsService._();
  static final SiteOpsService instance = SiteOpsService._();

  final DatabaseService _db = DatabaseService();

  final Map<String, List<AttendanceEntry>> _attendance = {};
  final Map<String, DiaryEntry> _draftDiary = {}; // one live draft per project/day
  final Map<String, List<DeliveryEntry>> _deliveries = {};

  static const _ourTables = {'site_diary', 'site_attendance', 'deliveries'};

  /// What this device may PUSH per table — deliberately excludes every
  /// PROTECTED column (projman-05 §6.2): `is_current`/`author_id`/
  /// `finalised_at`/`finalised_by` (site_diary), `geo_verified`
  /// (site_attendance — server-derives it from `check_in_lat`/`lng` against
  /// the project geofence), `received_by` (deliveries). Sending one would be
  /// silently dropped server-side anyway (`sanitise()` in sync/registry.js),
  /// but keeping the wire payload to exactly what the app owns means a
  /// `_pullAndApply` afterwards can never be mistaken for an echo of our own
  /// (unwritten) guess at those fields.
  static const _writableCols = {
    'site_diary': [
      'project_id', 'entry_date', 'status', 'weather', 'temp_c', 'headcount',
      'work_done', 'delays', 'delay_cause', 'notes', 'photo_ids',
      'version', 'supersedes_id', 'is_deleted',
    ],
    'site_attendance': [
      'project_id', 'person_id', 'person_name', 'person_type', 'trade',
      'check_in_at', 'check_out_at', 'check_in_lat', 'check_in_lng', 'method',
      'induction_ok', 'is_deleted',
    ],
    'deliveries': [
      'project_id', 'supplier_id', 'supplier_name', 'po_id', 'po_reference',
      'received_at', 'docket_no', 'photo_ids', 'notes', 'is_deleted',
    ],
  };

  // ── Hydration — call from a screen's initState / project switch ────────────

  /// Pulls remote changes, applies them locally, reloads this project's caches,
  /// then flushes any rows still queued from a previous failed push. Best-effort
  /// throughout (network errors are swallowed) — the UI always has *something*
  /// to show from the local DB even offline.
  Future<void> hydrateProject(String projectId) async {
    await _pullAndApply();
    await _reload(projectId);
    unawaited(_flushPending());
  }

  Future<void> _reload(String projectId) async {
    await Future.wait([
      _loadAttendance(projectId),
      _loadDeliveries(projectId),
      _loadDiary(projectId),
    ]);
  }

  Future<void> _loadAttendance(String projectId) async {
    final rows = await _db.query('site_attendance',
        where: 'project_id = ? AND is_deleted = 0',
        whereArgs: [projectId],
        orderBy: 'check_in_at ASC');
    _attendance[projectId] = rows.map(AttendanceEntry._fromRow).toList();
  }

  Future<void> _loadDeliveries(String projectId) async {
    final rows = await _db.query('deliveries',
        where: 'project_id = ? AND is_deleted = 0',
        whereArgs: [projectId],
        orderBy: 'received_at DESC');
    _deliveries[projectId] = rows.map(DeliveryEntry._fromRow).toList();
  }

  Future<void> _loadDiary(String projectId) async {
    final today = _dateStr(DateTime.now());
    final rows = await _db.query('site_diary',
        where: 'project_id = ? AND entry_date = ? AND is_current = 1 AND is_deleted = 0',
        whereArgs: [projectId, today],
        limit: 1);
    if (rows.isNotEmpty) _draftDiary[projectId] = DiaryEntry._fromRow(rows.first);
  }

  // ── Attendance ───────────────────────────────────────────────────────────────
  List<AttendanceEntry> attendance(String projectId) =>
      List.unmodifiable(_attendance[projectId] ?? const []);

  int onSite(String projectId) => (_attendance[projectId] ?? const [])
      .where((a) => a.checkInAt != null && a.checkOutAt == null)
      .length;

  Future<void> addPerson(String projectId, AttendanceEntry e) async {
    await _writeAttendance(projectId, e);
    await _reload(projectId);
  }

  Future<void> toggleCheck(String projectId, AttendanceEntry e) async {
    final now = DateTime.now();
    if (e.checkInAt == null) {
      e.checkInAt = now;
    } else if (e.checkOutAt == null) {
      e.checkOutAt = now;
    } else {
      e.checkOutAt = null; // re-open (correction)
    }
    await _writeAttendance(projectId, e);
    await _reload(projectId);
  }

  /// "All Out" — bulk end-of-day sign-out + evacuation muster (§11.5). Composed
  /// client-side as N pushes; no special server verb.
  Future<void> allOut(String projectId) async {
    final now = DateTime.now();
    for (final e in List.of(_attendance[projectId] ?? const [])) {
      if (e.checkInAt != null && e.checkOutAt == null) {
        e.checkOutAt = now;
        await _writeAttendance(projectId, e);
      }
    }
    await _reload(projectId);
  }

  Future<void> _writeAttendance(String projectId, AttendanceEntry e) async {
    final row = <String, Object?>{
      'id': e.id,
      'project_id': projectId,
      'person_id': e.personId,
      'person_name': e.personName,
      'person_type': e.personType.name,
      'trade': e.trade,
      'check_in_at': e.checkInAt == null ? null : _dtStr(e.checkInAt!),
      'check_out_at': e.checkOutAt == null ? null : _dtStr(e.checkOutAt!),
      'check_in_lat': e.checkInLat,
      'check_in_lng': e.checkInLng,
      'method': e.method,
      'is_deleted': 0,
      'created_at': DateTime.now().millisecondsSinceEpoch,
      'updated_at': DateTime.now().millisecondsSinceEpoch,
    };
    await _upsertAndPush('site_attendance', e.id, row);
  }

  // ── Site diary ───────────────────────────────────────────────────────────────
  DiaryEntry todayDraft(String projectId) =>
      _draftDiary[projectId] ??= DiaryEntry(headcount: onSite(projectId));

  Future<void> saveDraft(String projectId, DiaryEntry e) async {
    e.status = DiaryStatus.draft;
    _draftDiary[projectId] = e;
    await _writeDiary(projectId, e);
  }

  /// Finalise → legal record. The server stamps finalised_at/by and freezes the
  /// row (§11.4, `DIARY_FINAL` on any later edit attempt); a correction pushes a
  /// NEW row (version+1, supersedes_id) via [DiaryEntry]'s constructor params —
  /// see `_newVersion` at the call site.
  Future<void> finalise(String projectId, DiaryEntry e) async {
    e.status = DiaryStatus.finalised;
    _draftDiary[projectId] = e;
    await _writeDiary(projectId, e);
  }

  Future<void> _writeDiary(String projectId, DiaryEntry e) async {
    final row = <String, Object?>{
      'id': e.id,
      'project_id': projectId,
      'entry_date': _dateStr(e.date),
      'version': e.version,
      'supersedes_id': e.supersedesId,
      'status': e.status == DiaryStatus.finalised ? 'final' : 'draft',
      'weather': _nullIfEmpty(e.weather),
      'temp_c': e.tempC,
      'headcount': e.headcount,
      'work_done': e.workDone.join('\n'),
      'delays': e.delays,
      'delay_cause': _nullIfEmpty(e.delayCause),
      'notes': e.notes,
      'photo_ids': jsonEncode(e.photoIds),
      'is_deleted': 0,
      'created_at': DateTime.now().millisecondsSinceEpoch,
      'updated_at': DateTime.now().millisecondsSinceEpoch,
    };
    await _upsertAndPush('site_diary', e.id, row);
  }

  // ── Deliveries ───────────────────────────────────────────────────────────────
  List<DeliveryEntry> deliveries(String projectId) =>
      List.unmodifiable(_deliveries[projectId] ?? const []);

  Future<void> addDelivery(String projectId, DeliveryEntry e) async {
    final row = <String, Object?>{
      'id': e.id,
      'project_id': projectId,
      'supplier_name': _nullIfEmpty(e.supplierName),
      'po_reference': _nullIfEmpty(e.poReference),
      'received_at': _dtStr(e.receivedAt),
      'docket_no': _nullIfEmpty(e.docketNo),
      'photo_ids': jsonEncode(e.photoIds),
      'notes': e.notes,
      'is_deleted': 0,
      'created_at': DateTime.now().millisecondsSinceEpoch,
      'updated_at': DateTime.now().millisecondsSinceEpoch,
    };
    await _upsertAndPush('deliveries', e.id, row);
    await _reload(projectId);
  }

  // ── Persistence + sync plumbing ─────────────────────────────────────────────

  /// Writes [row] locally (marking it dirty), then attempts an immediate push.
  /// The push operation is 'create' unless this id has synced successfully
  /// before (tracked via `ever_synced` — a retried create would 500 as a
  /// duplicate; a premature 'update' before the first create lands would 404).
  /// On success, pulls once to pick up server-stamped columns this device may
  /// not write (geo_verified, author/finalise provenance, received_by).
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
        debugPrint('[SiteOps] push $table/$id ($op) rejected: '
            '${res.code} ${res.message} — kept queued for retry');
      }
    } catch (e) {
      debugPrint('[SiteOps] push $table/$id ($op) failed: $e — kept queued');
    }
  }

  /// Retries every row still marked dirty (a previous push never acknowledged —
  /// offline at the time, or a transient failure). Best-effort; a row that
  /// fails again just stays queued for the next hydrate.
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

  /// Pulls deltas since this device's last cursor and applies the ones for the
  /// three site-ops tables to the local mirror (the pull response spans every
  /// synced table; everything else is ignored here — this service only owns
  /// site ops). Returns the touched project ids so callers could target a
  /// reload, though [hydrateProject] just reloads its own project regardless.
  Future<Set<String>> _pullAndApply() async {
    final touched = <String>{};
    try {
      final since = await _getCursor();
      final res = await SyncClient.pull(since: since);
      if (!res.success) return touched;
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
        final pid = data['project_id']?.toString();
        if (pid != null) touched.add(pid);
      }
      final lastSync = res.data['last_sync_at'];
      final nextCursor = lastSync is int
          ? lastSync
          : int.tryParse(lastSync?.toString() ?? '') ?? since;
      await _setCursor(nextCursor);
    } catch (e) {
      debugPrint('[SiteOps] pull failed: $e');
    }
    return touched;
  }

  Map<String, dynamic> _wireDataFor(String table, Map<String, Object?> row) {
    final cols = _writableCols[table]!;
    return {for (final c in cols) if (row.containsKey(c)) c: row[c]};
  }

  static const _cursorKey = 'site_ops_pull_cursor';

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

  static String? _nullIfEmpty(String? s) =>
      (s == null || s.trim().isEmpty) ? null : s;

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

// ── Local shapes (mirror servdesignspec §11.3; tolerant, additive-ready) ───────

enum PersonType { staff, subcontractor, visitor }

enum GeoState { unknown, verified, offsite } // maps to server geo_verified (NULL/1/0)

class AttendanceEntry {
  final String id;
  final String personName;
  final PersonType personType;
  final String? trade;
  final String method; // self | supervisor | qr
  /// users.id when the person is paired staff (resolves attendance.write.own
  /// server-side); null for a free-text subbie/visitor (§11.2).
  final String? personId;
  DateTime? checkInAt;
  DateTime? checkOutAt;
  double? checkInLat;
  double? checkInLng;
  GeoState geo; // server-derived on the wire; app only stamps lat/lng

  AttendanceEntry({
    String? id,
    required this.personName,
    required this.personType,
    this.trade,
    this.method = 'supervisor',
    this.personId,
    this.checkInAt,
    this.checkOutAt,
    this.checkInLat,
    this.checkInLng,
    this.geo = GeoState.unknown,
  }) : id = id ?? const Uuid().v4();

  bool get present => checkInAt != null && checkOutAt == null;

  static AttendanceEntry _fromRow(Map<String, Object?> r) => AttendanceEntry(
        id: r['id'] as String,
        personName: (r['person_name'] as String?) ?? '',
        personType: PersonType.values.firstWhere(
            (t) => t.name == r['person_type'],
            orElse: () => PersonType.subcontractor),
        trade: r['trade'] as String?,
        method: (r['method'] as String?) ?? 'supervisor',
        personId: r['person_id'] as String?,
        checkInAt: SiteOpsService._parseDt(r['check_in_at']),
        checkOutAt: SiteOpsService._parseDt(r['check_out_at']),
        checkInLat: (r['check_in_lat'] as num?)?.toDouble(),
        checkInLng: (r['check_in_lng'] as num?)?.toDouble(),
        geo: switch (r['geo_verified'] as int?) {
          null => GeoState.unknown,
          1 => GeoState.verified,
          _ => GeoState.offsite,
        },
      );
}

enum DiaryStatus { draft, finalised }

class DiaryEntry {
  final String id;
  final DateTime date;
  DiaryStatus status;
  String? weather; // app-cached; never blocks (appspec §5.3)
  double? tempC;
  int headcount; // advisory — server derives from attendance
  List<String> workDone;
  String delays;
  String? delayCause;
  String notes;
  final List<String> photoIds;
  /// Append-only versioning (§11.4): a correction to a finalised day is a NEW
  /// row with `version` bumped and `supersedesId` pointing at the row it
  /// replaces — never an edit of the final row (server enforces `409 DIARY_FINAL`).
  final int version;
  final String? supersedesId;

  DiaryEntry({
    String? id,
    DateTime? date,
    this.status = DiaryStatus.draft,
    this.weather,
    this.tempC,
    this.headcount = 0,
    List<String>? workDone,
    this.delays = '',
    this.delayCause,
    this.notes = '',
    List<String>? photoIds,
    this.version = 1,
    this.supersedesId,
  })  : id = id ?? const Uuid().v4(),
        date = date ?? DateTime.now(),
        workDone = workDone ?? [],
        photoIds = photoIds ?? [];

  bool get isFinal => status == DiaryStatus.finalised;

  static DiaryEntry _fromRow(Map<String, Object?> r) {
    final photoRaw = r['photo_ids'] as String?;
    final workRaw = r['work_done'] as String?;
    return DiaryEntry(
      id: r['id'] as String,
      date: DateTime.tryParse(r['entry_date'] as String? ?? '') ?? DateTime.now(),
      status: r['status'] == 'final' ? DiaryStatus.finalised : DiaryStatus.draft,
      weather: r['weather'] as String?,
      tempC: (r['temp_c'] as num?)?.toDouble(),
      headcount: (r['headcount'] as int?) ?? 0,
      workDone: workRaw == null || workRaw.isEmpty ? [] : workRaw.split('\n'),
      delays: (r['delays'] as String?) ?? '',
      delayCause: r['delay_cause'] as String?,
      notes: (r['notes'] as String?) ?? '',
      photoIds: photoRaw == null
          ? []
          : List<String>.from(jsonDecode(photoRaw) as List),
      version: (r['version'] as int?) ?? 1,
      supersedesId: r['supersedes_id'] as String?,
    );
  }
}

class DeliveryEntry {
  final String id;
  final String? supplierName;
  final String? poReference;
  final DateTime receivedAt;
  final String? docketNo;
  final String notes;
  final List<String> photoIds;

  DeliveryEntry({
    String? id,
    this.supplierName,
    this.poReference,
    DateTime? receivedAt,
    this.docketNo,
    this.notes = '',
    List<String>? photoIds,
  })  : id = id ?? const Uuid().v4(),
        receivedAt = receivedAt ?? DateTime.now(),
        photoIds = photoIds ?? [];

  static DeliveryEntry _fromRow(Map<String, Object?> r) {
    final photoRaw = r['photo_ids'] as String?;
    return DeliveryEntry(
      id: r['id'] as String,
      supplierName: r['supplier_name'] as String?,
      poReference: r['po_reference'] as String?,
      receivedAt:
          SiteOpsService._parseDt(r['received_at']) ?? DateTime.now(),
      docketNo: r['docket_no'] as String?,
      notes: (r['notes'] as String?) ?? '',
      photoIds: photoRaw == null
          ? []
          : List<String>.from(jsonDecode(photoRaw) as List),
    );
  }
}
