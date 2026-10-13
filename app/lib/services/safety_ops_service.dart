import 'dart:async';
import 'dart:convert';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import 'db_service.dart';
import 'nexus_service.dart';
import 'permissions_service.dart';
import 'session_service.dart';
import 'sync_client.dart';

/// Safety → hazards, near misses and incidents. **Wired to sync** against
/// server migration v048 (xprojman-48). Same design as [ChecklistOpsService]:
/// local SQLite is the source of truth for reads, every write lands there
/// first, then rides `/sync/push`, and a pull brings back the server-stamped
/// columns (`raised_by`/`raised_at`, `closed_by`/`closed_at`, the status move
/// to in_progress when an action is added).
///
/// The xprojman-48 rules it relies on:
/// - **Raise:** anyone with `safety.report`. A new event is always pushed as
///   `open`. Every later change (edit, actions, close) needs `safety.manage`,
///   so the app offers those to managers only ([canManage]).
/// - **F2, injury details:** health information. They go to the
///   `incident_details` OUTBOX, are pushed create-only after the parent event
///   is accepted, and are then **deleted from the phone**. The server never
///   sends them back on a pull. They are never written to the event's
///   description.
/// - **F3, notifiable:** `is_notifiable` is sent on create only. After that the
///   event is append-only on the device: an edit gets `SAFETY_FROZEN`
///   (terminal); corrections and closing go through the Portal.
/// - **Close:** every action must be closed first, so action closures are
///   pushed before the event's closure. `SAFETY_OPEN_ACTIONS` is retryable.
/// - **Push order:** event creates/edits → actions → injury details → event
///   closures.
///
/// No location is captured: `lat`/`lng` stay null until point-of-capture
/// location is approved (appdesignspecification §11.4 A4).
enum SafetyKind {
  hazard('hazard', 'Hazard'),
  nearMiss('near_miss', 'Near miss'),
  incident('incident', 'Incident');

  final String wire;
  final String label;
  const SafetyKind(this.wire, this.label);

  static SafetyKind fromWire(Object? w) => SafetyKind.values
      .firstWhere((k) => k.wire == w, orElse: () => SafetyKind.hazard);
}

enum SafetySeverity {
  low,
  medium,
  high;

  static SafetySeverity fromWire(Object? w) => SafetySeverity.values
      .firstWhere((s) => s.name == w, orElse: () => SafetySeverity.medium);
}

enum SafetyStatus {
  open('open'),
  inProgress('in_progress'),
  closed('closed');

  final String wire;
  const SafetyStatus(this.wire);

  static SafetyStatus fromWire(Object? w) => SafetyStatus.values
      .firstWhere((s) => s.wire == w, orElse: () => SafetyStatus.open);
}

/// `incident_details.treatment` (v048 ENUM).
enum InjuryTreatment {
  none('none', 'No treatment'),
  firstAid('first_aid', 'First aid'),
  medical('medical', 'Medical treatment'),
  hospital('hospital', 'Hospital'),
  fatality('fatality', 'Fatality');

  final String wire;
  final String label;
  const InjuryTreatment(this.wire, this.label);
}

/// The private injury section of an incident. Exactly v048's columns. The
/// app adds no extra free-text injury fields.
class IncidentDetailsInput {
  final String? injuredName;
  final String? injuryType;
  final String? bodyPart;
  final InjuryTreatment? treatment;
  final bool? lostTime;
  final String? witnessNames;
  const IncidentDetailsInput({
    this.injuredName,
    this.injuryType,
    this.bodyPart,
    this.treatment,
    this.lostTime,
    this.witnessNames,
  });

  bool get isEmpty =>
      _blank(injuredName) &&
      _blank(injuryType) &&
      _blank(bodyPart) &&
      treatment == null &&
      lostTime == null &&
      _blank(witnessNames);

  static bool _blank(String? s) => s == null || s.trim().isEmpty;
}

/// Where this device's injury details for an event are.
enum DetailsState {
  /// None recorded on this device.
  none,

  /// Still on the phone, waiting for the event to sync.
  waiting,

  /// Sent to the server and removed from the phone.
  sent,
}

class SafetyAction {
  final String id;
  final String eventId;
  final String action;
  final String? assignedToName;
  final DateTime? dueDate;
  final bool isClosed;
  final bool isSynced;
  const SafetyAction({
    required this.id,
    required this.eventId,
    required this.action,
    this.assignedToName,
    this.dueDate,
    this.isClosed = false,
    this.isSynced = false,
  });
}

class SafetyEntry {
  final String id;
  final String projectId;
  final SafetyKind kind;
  final String description;
  final String? location;
  final SafetySeverity severity;
  final SafetyStatus status;
  final DateTime? occurredAt;
  final DateTime raisedAt;
  final String? raisedBy;
  final String? raisedByName;
  final bool isNotifiable;
  final String? closeNote;
  final List<String> photoIds;
  final List<SafetyAction> actions;
  final DetailsState details;
  final String? syncError;
  final bool everSynced;
  final bool isSynced;

  const SafetyEntry({
    required this.id,
    required this.projectId,
    required this.kind,
    required this.description,
    this.location,
    this.severity = SafetySeverity.medium,
    this.status = SafetyStatus.open,
    this.occurredAt,
    required this.raisedAt,
    this.raisedBy,
    this.raisedByName,
    this.isNotifiable = false,
    this.closeNote,
    this.photoIds = const [],
    this.actions = const [],
    this.details = DetailsState.none,
    this.syncError,
    this.everSynced = false,
    this.isSynced = false,
  });

  bool get hasPhoto => photoIds.isNotEmpty;
  int get openActions => actions.where((a) => !a.isClosed).length;

  /// A notifiable event the server has is append-only on the device (F3).
  bool get isFrozen => isNotifiable && everSynced;
}

class SafetyOpsService {
  SafetyOpsService._();
  static final SafetyOpsService instance = SafetyOpsService._();

  final DatabaseService _db = DatabaseService();
  final Map<String, List<SafetyEntry>> _byProject = {};

  /// Bumped whenever data changes, including in the background, so screens
  /// can rebuild.
  final ValueNotifier<int> changes = ValueNotifier(0);

  static const _pullTables = {'safety_events', 'safety_actions'};

  /// What this device may push. Server-stamped and Portal-only columns are
  /// never sent. `is_notifiable` goes on create only.
  static const _eventCols = [
    'project_id', 'stage_id', 'unit_id', 'kind', 'description', 'location',
    'severity', 'status', 'occurred_at', 'lat', 'lng', 'close_note',
    'is_deleted', 'updated_at',
  ];
  static const _actionCols = [
    'event_id', 'action', 'assigned_to', 'assigned_to_name', 'due_date',
    'status', 'is_deleted', 'updated_at',
  ];
  static const _detailCols = [
    'event_id', 'injured_user_id', 'injured_name', 'injury_type', 'body_part',
    'treatment', 'lost_time', 'witness_names', 'updated_at',
  ];

  /// Test seams: stand in for the sync transport.
  @visibleForTesting
  Future<ApiResult> Function(
      String table, String op, Map<String, Object?> data, String id)? pushForTest;
  @visibleForTesting
  Future<ApiResult> Function(int since)? pullForTest;

  bool _wired = false;
  bool _flushing = false;
  bool _flushAgain = false;
  Completer<void>? _inFlight;
  StreamSubscription<List<ConnectivityResult>>? _connSub;

  /// Edit, add actions and close (`safety.manage`: Site Supervisor, PM).
  bool get canManage => PermissionsService.instance.has('safety.manage');

  void ensureWired() {
    if (_wired) return;
    _wired = true;
    _connSub = Connectivity().onConnectivityChanged.listen((r) {
      if (r.any((x) => x != ConnectivityResult.none)) unawaited(sync());
    });
  }

  @visibleForTesting
  void resetForTest() {
    _byProject.clear();
    _connSub?.cancel();
    _wired = false;
    pushForTest = null;
    pullForTest = null;
  }

  // ── Reads (from the in-memory cache, refreshed by [reload]) ─────────────

  List<SafetyEntry> entries(String projectId,
      {Set<SafetyKind>? kinds, SafetyStatus? status}) {
    final list = _byProject[projectId] ?? const [];
    return list
        .where((e) => kinds == null || kinds.contains(e.kind))
        .where((e) => status == null || e.status == status)
        .toList();
  }

  SafetyEntry? byId(String projectId, String id) {
    for (final e in _byProject[projectId] ?? const <SafetyEntry>[]) {
      if (e.id == id) return e;
    }
    return null;
  }

  // ── Hydration ────────────────────────────────────────────────────────────

  Future<void> hydrateProject(String projectId) async {
    ensureWired();
    await _pullAndApply();
    await reload(projectId);
    unawaited(sync(projectId: projectId));
  }

  Future<void> reload(String projectId) async {
    final rows = await _db.query('safety_events',
        where: 'project_id = ? AND is_deleted = 0', whereArgs: [projectId]);
    final list = <SafetyEntry>[];
    for (final r in rows) {
      final id = r['id'] as String;
      final actionRows = await _db.query('safety_actions',
          where: 'event_id = ? AND is_deleted = 0',
          whereArgs: [id],
          orderBy: 'created_at ASC');
      final waiting = await _db.query('incident_details',
          columns: ['id'], where: 'event_id = ?', whereArgs: [id], limit: 1);
      list.add(_entryFromRow(r, actionRows.map(_actionFromRow).toList(),
          waiting.isNotEmpty));
    }
    list.sort((a, b) => b.raisedAt.compareTo(a.raisedAt));
    _byProject[projectId] = list;
    changes.value++;
  }

  // ── Writes (local first, then sync) ─────────────────────────────────────

  /// Raise a hazard, near miss or incident. Pass [id] when photos were
  /// captured against it before saving (compose-then-save, xprojman-21).
  /// [details] only applies to incidents and never touches [description].
  Future<SafetyEntry> raise({
    String? id,
    required String projectId,
    required SafetyKind kind,
    required String description,
    String? location,
    SafetySeverity severity = SafetySeverity.medium,
    DateTime? occurredAt,
    bool isNotifiable = false,
    IncidentDetailsInput? details,
    List<String> photoIds = const [],
  }) async {
    final user = await SessionService.currentUser();
    final eventId = id ?? const Uuid().v4();
    final now = DateTime.now();
    final ms = now.millisecondsSinceEpoch;
    final isIncident = kind == SafetyKind.incident;
    final withDetails = isIncident && details != null && !details.isEmpty;
    await _db.insert('safety_events', {
      'id': eventId,
      'project_id': projectId,
      'kind': kind.wire,
      'description': description.trim(),
      'location': _nullIfBlank(location),
      'severity': severity.name,
      'status': SafetyStatus.open.wire,
      'occurred_at': occurredAt == null ? null : _dtStr(occurredAt),
      'is_notifiable': isIncident && isNotifiable ? 1 : 0,
      'raised_by': user?['id']?.toString(),
      'raised_by_name':
          (user?['fullName'] ?? user?['full_name'] ?? user?['name']) as String?,
      'photo_ids': photoIds.isEmpty ? null : jsonEncode(photoIds),
      'has_details': withDetails ? 1 : 0,
      'is_deleted': 0,
      'is_dirty': 1,
      'pending_op': 'create',
      'ever_synced': 0,
      'created_at': _dtStr(now),
      'updated_at': ms,
    });
    if (withDetails) {
      await _db.insert('incident_details', {
        'id': const Uuid().v4(),
        'event_id': eventId,
        'injured_name': _nullIfBlank(details.injuredName),
        'injury_type': _nullIfBlank(details.injuryType),
        'body_part': _nullIfBlank(details.bodyPart),
        'treatment': details.treatment?.wire,
        'lost_time': details.lostTime == null ? null : (details.lostTime! ? 1 : 0),
        'witness_names': _nullIfBlank(details.witnessNames),
        'updated_at': ms,
      });
    }
    await reload(projectId);
    unawaited(sync(projectId: projectId));
    return byId(projectId, eventId)!;
  }

  /// Record a captured photo (its queue `client_ref`) against the event. The
  /// caller has already queued the upload with entity_type 'safety_event'.
  /// The photo reaches the server as a document, so the row isn't dirtied.
  Future<void> attachPhoto(SafetyEntry e, String clientRef) async {
    await _db.update('safety_events',
        {'photo_ids': jsonEncode([...e.photoIds, clientRef])},
        where: 'id = ?', whereArgs: [e.id]);
    await reload(e.projectId);
  }

  /// Manager edit. Returns a refusal code, or null when queued.
  Future<String?> update(
    SafetyEntry e, {
    required String description,
    String? location,
    required SafetySeverity severity,
  }) async {
    final refusal = _editRefusal(e);
    if (refusal != null) return refusal;
    if (description.trim().isEmpty) return 'VALIDATION_ERROR';
    await _touchEvent(e, {
      'description': description.trim(),
      'location': _nullIfBlank(location),
      'severity': severity.name,
    });
    return null;
  }

  /// Close the event. Every action must be closed first (the server checks
  /// the same rule), so this refuses locally rather than after a round trip.
  Future<String?> close(SafetyEntry e, {String? note}) async {
    final refusal = _editRefusal(e);
    if (refusal != null) return refusal;
    if (e.openActions > 0) return 'SAFETY_OPEN_ACTIONS';
    await _touchEvent(e, {
      'status': SafetyStatus.closed.wire,
      'close_note': _nullIfBlank(note),
    });
    return null;
  }

  Future<String?> addAction(
    SafetyEntry e, {
    required String action,
    String? assignedToName,
    DateTime? dueDate,
  }) async {
    if (!canManage) return 'FORBIDDEN';
    if (e.status == SafetyStatus.closed) return 'SAFETY_CLOSED';
    if (action.trim().isEmpty) return 'VALIDATION_ERROR';
    final now = DateTime.now();
    await _db.insert('safety_actions', {
      'id': const Uuid().v4(),
      'event_id': e.id,
      'action': action.trim(),
      'assigned_to_name': _nullIfBlank(assignedToName),
      'due_date': dueDate == null ? null : _dateStr(dueDate),
      'status': 'open',
      'is_deleted': 0,
      'is_dirty': 1,
      'pending_op': 'create',
      'ever_synced': 0,
      'created_at': _dtStr(now),
      'updated_at': now.millisecondsSinceEpoch,
    });
    await reload(e.projectId);
    unawaited(sync(projectId: e.projectId));
    return null;
  }

  Future<String?> closeAction(SafetyEntry e, SafetyAction a) async {
    if (!canManage) return 'FORBIDDEN';
    if (a.isClosed) return null;
    final rows = await _db.query('safety_actions',
        columns: ['ever_synced'], where: 'id = ?', whereArgs: [a.id], limit: 1);
    final synced = rows.isNotEmpty && ((rows.first['ever_synced'] as int?) ?? 0) == 1;
    await _db.update('safety_actions', {
      'status': 'closed',
      'is_dirty': 1,
      'pending_op': synced ? 'update' : 'create',
      'updated_at': DateTime.now().millisecondsSinceEpoch,
    }, where: 'id = ?', whereArgs: [a.id]);
    await reload(e.projectId);
    unawaited(sync(projectId: e.projectId));
    return null;
  }

  String? _editRefusal(SafetyEntry e) {
    if (!canManage) return 'FORBIDDEN';
    if (e.isFrozen) return 'SAFETY_FROZEN';
    if (e.status == SafetyStatus.closed) return 'SAFETY_CLOSED';
    return null;
  }

  Future<void> _touchEvent(SafetyEntry e, Map<String, Object?> fields) async {
    await _db.update('safety_events', {
      ...fields,
      'is_dirty': 1,
      'pending_op': e.everSynced ? 'update' : 'create',
      'sync_error': null,
      'updated_at': DateTime.now().millisecondsSinceEpoch,
    }, where: 'id = ?', whereArgs: [e.id]);
    await reload(e.projectId);
    unawaited(sync(projectId: e.projectId));
  }

  // ── Sync ─────────────────────────────────────────────────────────────────

  /// Push in dependency order, then pull. Serialised: a call that arrives
  /// mid-flush schedules exactly one more pass and waits for it, so a caller
  /// (pull-to-refresh) never returns before its changes have been tried.
  Future<void> sync({String? projectId}) async {
    if (_flushing) {
      _flushAgain = true;
      return _inFlight!.future;
    }
    _flushing = true;
    final done = _inFlight = Completer<void>();
    try {
      // The reload is inside the loop so a call that lands during it still
      // gets its extra pass.
      do {
        _flushAgain = false;
        final online = await _pushPending();
        if (online) await _pullAndApply();
        for (final p in {?projectId, ..._byProject.keys}) {
          await reload(p);
        }
      } while (_flushAgain);
    } finally {
      _flushing = false;
      done.complete();
    }
  }

  /// Returns false when a transport failure says we're offline.
  Future<bool> _pushPending() async {
    // 1. Event creates, and edits that aren't a closure. A create always goes
    //    as `open`; a closure queued before the first sync follows in step 4.
    for (final r in await _db.query('safety_events',
        where: "is_dirty = 1 AND (pending_op = 'create' OR status != 'closed')")) {
      if (await _pushEvent(r) == _Push.offline) return false;
    }
    final synced = (await _db.query('safety_events',
            columns: ['id'], where: 'ever_synced = 1'))
        .map((r) => r['id'] as String)
        .toList();
    if (synced.isEmpty) return true;
    final ph = List.filled(synced.length, '?').join(', ');

    // 2. Actions (creates and closures) whose event the server has.
    for (final r in await _db.rawQuery(
        'SELECT * FROM safety_actions WHERE is_dirty = 1 AND event_id IN ($ph)',
        synced)) {
      if (await _pushAction(r) == _Push.offline) return false;
    }

    // 3. Injury details, create-only, then off the phone.
    for (final r in await _db.rawQuery(
        'SELECT * FROM incident_details WHERE event_id IN ($ph)', synced)) {
      if (await _pushDetails(r) == _Push.offline) return false;
    }

    // 4. Closures, after their actions' closures.
    for (final r in await _db.query('safety_events',
        where: "is_dirty = 1 AND ever_synced = 1 AND status = 'closed'")) {
      if (await _pushEvent(r) == _Push.offline) return false;
    }
    return true;
  }

  Future<_Push> _pushEvent(Map<String, Object?> r) async {
    final id = r['id'] as String;
    final op = (r['pending_op'] as String?) ?? 'update';
    final create = op == 'create';
    final data = {
      for (final c in _eventCols) c: r[c],
      if (create) 'is_notifiable': r['is_notifiable'],
      if (create) 'status': SafetyStatus.open.wire,
      if (create) 'close_note': null,
    };
    final res = await _send('safety_events', op, data, id);
    if (res.$1 == _Push.ok) {
      // A closure queued before the first sync still has to go (step 4).
      final closeQueued = create && r['status'] == SafetyStatus.closed.wire;
      await _db.update('safety_events', {
        'is_dirty': closeQueued ? 1 : 0,
        'pending_op': closeQueued ? 'update' : null,
        'ever_synced': 1,
        'sync_error': null,
      }, where: 'id = ?', whereArgs: [id]);
    } else if (res.$1 == _Push.refused) {
      final code = res.$2;
      if (code == 'SAFETY_OPEN_ACTIONS') {
        // Retryable: someone else's action is still open. Keep it queued.
        await _db.update('safety_events', {'sync_error': code},
            where: 'id = ?', whereArgs: [id]);
        return _Push.refused;
      }
      // Terminal (SAFETY_FROZEN, FORBIDDEN, VALIDATION_ERROR…): stop retrying
      // and surface the code. A pull can then bring the server copy.
      await _db.update('safety_events',
          {'is_dirty': 0, 'pending_op': null, 'sync_error': code},
          where: 'id = ?', whereArgs: [id]);
    }
    return res.$1;
  }

  Future<_Push> _pushAction(Map<String, Object?> r) async {
    final id = r['id'] as String;
    final op = (r['pending_op'] as String?) ?? 'update';
    final res = await _send(
        'safety_actions', op, {for (final c in _actionCols) c: r[c]}, id);
    if (res.$1 == _Push.ok) {
      await _db.update('safety_actions',
          {'is_dirty': 0, 'pending_op': null, 'ever_synced': 1},
          where: 'id = ?', whereArgs: [id]);
    } else if (res.$1 == _Push.refused) {
      await _db.update('safety_actions', {'is_dirty': 0, 'pending_op': null},
          where: 'id = ?', whereArgs: [id]);
      await _db.update('safety_events', {'sync_error': res.$2},
          where: 'id = ?', whereArgs: [r['event_id']]);
    }
    return res.$1;
  }

  /// Accepted, or `CREATE_ONLY` (the server already has them): delete the
  /// local copy either way. Any other refusal keeps them and flags the event.
  Future<_Push> _pushDetails(Map<String, Object?> r) async {
    final id = r['id'] as String;
    final res = await _send(
        'incident_details', 'create', {for (final c in _detailCols) c: r[c]}, id);
    if (res.$1 == _Push.ok ||
        (res.$1 == _Push.refused && res.$2 == 'CREATE_ONLY')) {
      await _db.delete('incident_details', where: 'id = ?', whereArgs: [id]);
    } else if (res.$1 == _Push.refused) {
      await _db.update('safety_events', {'sync_error': 'DETAILS_${res.$2}'},
          where: 'id = ?', whereArgs: [r['event_id']]);
    }
    return res.$1;
  }

  Future<(_Push, String?)> _send(
      String table, String op, Map<String, Object?> data, String id) async {
    try {
      final res = pushForTest != null
          ? await pushForTest!(table, op, data, id)
          : await SyncClient.push(
              table: table, operation: op, data: data, localId: id);
      if (res.success) return (_Push.ok, null);
      if (res.status == 0 || res.status == 429 || res.status >= 500) {
        return (_Push.offline, null);
      }
      final code = res.code ?? 'ERROR';
      debugPrint('[Safety] $table/$id refused: $code');
      return (_Push.refused, code);
    } catch (e) {
      debugPrint('[Safety] push $table/$id failed: $e — kept queued');
      return (_Push.offline, null);
    }
  }

  Future<void> _pullAndApply() async {
    try {
      final since = await _getCursor();
      final res = pullForTest != null
          ? await pullForTest!(since)
          : await SyncClient.pull(since: since);
      if (!res.success) return;
      for (final raw in (res.data['changes'] as List?) ?? const []) {
        final c = Map<String, dynamic>.from(raw as Map);
        final table = c['table_name']?.toString();
        if (table == null || !_pullTables.contains(table)) continue;
        final data = Map<String, Object?>.from(c['data'] as Map? ?? const {});
        data['id'] ??= c['local_id']?.toString();
        if (data['id'] == null) continue;
        await applyPulledRow(table, data);
      }
      final lastSync = res.data['last_sync_at'];
      final next = lastSync is int
          ? lastSync
          : int.tryParse(lastSync?.toString() ?? '') ?? since;
      await _setCursor(next);
    } catch (e) {
      debugPrint('[Safety] pull failed: $e');
    }
  }

  /// Apply one pulled row. A row with unpushed local changes is left alone,
  /// and its push decides. Local-only columns are never overwritten.
  @visibleForTesting
  Future<void> applyPulledRow(String table, Map<String, Object?> data) async {
    if (!_pullTables.contains(table)) return; // never incident_details
    final id = data['id'].toString();
    final existing =
        await _db.query(table, where: 'id = ?', whereArgs: [id], limit: 1);
    if (existing.isNotEmpty &&
        ((existing.first['is_dirty'] as int?) ?? 0) == 1) {
      return;
    }
    final filtered = await _db.filterToTableColumns(table, data);
    for (final local in const [
      'photo_ids', 'sync_error', 'raised_by_name', 'has_details',
    ]) {
      filtered.remove(local);
    }
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

  static const _cursorKey = 'safety_pull_cursor';

  Future<int> _getCursor() async {
    final rows = await _db.query('sync_metadata',
        where: 'key = ?', whereArgs: [_cursorKey], limit: 1);
    if (rows.isEmpty) return 0;
    return int.tryParse(rows.first['value']?.toString() ?? '0') ?? 0;
  }

  Future<void> _setCursor(int ms) async {
    final values = {
      'key': _cursorKey,
      'value': ms.toString(),
      'updated_at': DateTime.now().millisecondsSinceEpoch,
    };
    final rows = await _db.query('sync_metadata',
        where: 'key = ?', whereArgs: [_cursorKey], limit: 1);
    if (rows.isEmpty) {
      await _db.insert('sync_metadata', values);
    } else {
      await _db.update('sync_metadata', values,
          where: 'key = ?', whereArgs: [_cursorKey]);
    }
  }

  // ── Row mapping ──────────────────────────────────────────────────────────

  static SafetyEntry _entryFromRow(
          Map<String, Object?> r, List<SafetyAction> actions, bool waiting) =>
      SafetyEntry(
        id: r['id'] as String,
        projectId: r['project_id'] as String,
        kind: SafetyKind.fromWire(r['kind']),
        description: (r['description'] as String?) ?? '',
        location: r['location'] as String?,
        severity: SafetySeverity.fromWire(r['severity']),
        status: SafetyStatus.fromWire(r['status']),
        occurredAt: _parseDt(r['occurred_at']),
        raisedAt: _parseDt(r['raised_at']) ??
            _parseDt(r['created_at']) ??
            DateTime.now(),
        raisedBy: r['raised_by'] as String?,
        raisedByName: r['raised_by_name'] as String?,
        isNotifiable: _bool(r['is_notifiable']),
        closeNote: r['close_note'] as String?,
        photoIds: _decIds(r['photo_ids']),
        actions: actions,
        details: waiting
            ? DetailsState.waiting
            : (_bool(r['has_details']) ? DetailsState.sent : DetailsState.none),
        syncError: r['sync_error'] as String?,
        everSynced: _bool(r['ever_synced']),
        isSynced: _bool(r['ever_synced']) && !_bool(r['is_dirty']),
      );

  static SafetyAction _actionFromRow(Map<String, Object?> r) => SafetyAction(
        id: r['id'] as String,
        eventId: r['event_id'] as String,
        action: (r['action'] as String?) ?? '',
        assignedToName: r['assigned_to_name'] as String?,
        dueDate: _parseDt(r['due_date']),
        isClosed: r['status'] == 'closed',
        isSynced: _bool(r['ever_synced']) && !_bool(r['is_dirty']),
      );

  static bool _bool(Object? v) =>
      v == 1 || v == true || v?.toString() == '1' || v?.toString() == 'true';

  static String? _nullIfBlank(String? s) =>
      (s == null || s.trim().isEmpty) ? null : s.trim();

  static String _dtStr(DateTime d) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${_dateStr(d)} ${two(d.hour)}:${two(d.minute)}:${two(d.second)}';
  }

  static String _dateStr(DateTime d) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${d.year.toString().padLeft(4, '0')}-${two(d.month)}-${two(d.day)}';
  }

  static DateTime? _parseDt(Object? v) {
    if (v == null) return null;
    return DateTime.tryParse(v.toString().replaceFirst(' ', 'T'));
  }

  static List<String> _decIds(Object? raw) {
    if (raw == null || (raw is String && raw.isEmpty)) return [];
    try {
      return (jsonDecode(raw as String) as List)
          .map((e) => e.toString())
          .toList();
    } catch (_) {
      return [];
    }
  }
}

enum _Push { ok, offline, refused }
