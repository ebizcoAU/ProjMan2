import 'dart:async';
import 'dart:io';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';
import 'db_service.dart';
import 'nexus_service.dart';
import 'permissions_service.dart';
import 'session_service.dart';
import 'signoff_store.dart';
import 'sync_client.dart';

/// Safety → Inductions: site-specific inductions and SWMS sign-on, against
/// server migration v048 (xprojman-48 F5/F6). This is a WHS site record, not a
/// roster or pay-hours record (Owner scope ruling, 2026-10-14).
///
/// - **Site induction:** a `safety.manage` role (Site Supervisor, PM) inducts
///   a project member or a visitor, and the inductee signs. The server stamps
///   `inducted_by` and derives `site_attendance.induction_ok` from these rows
///   at check-in. A missing or expired induction only **warns**, never blocks
///   sign-in (Owner, F5).
/// - **SWMS sign-on:** any `safety.report` worker reads a Portal-uploaded SWMS
///   (`documents.kind='swms'`) and signs it. The register is cached so this
///   works offline at the gate.
///
/// Sign-offs go through [SignoffStore]. Push order: inductions, then the
/// sign-offs of inductions the server has, then SWMS sign-offs (their subject
/// is a server document already).
enum InductionStatus { valid, expiringSoon, expired }

/// How close to expiry counts as "expiring soon".
const inductionWarnWindow = Duration(days: 14);

/// Pure status rule, kept separate so it can be tested without a database.
/// No expiry date means valid. An induction expiring today is still valid.
InductionStatus inductionStatus(DateTime? expiresAt, DateTime now) {
  if (expiresAt == null) return InductionStatus.valid;
  final today = DateTime(now.year, now.month, now.day);
  final expiry = DateTime(expiresAt.year, expiresAt.month, expiresAt.day);
  if (expiry.isBefore(today)) return InductionStatus.expired;
  if (!expiry.isAfter(today.add(inductionWarnWindow))) {
    return InductionStatus.expiringSoon;
  }
  return InductionStatus.valid;
}

class SiteInduction {
  final String id;
  final String projectId;
  final String? userId;
  final String name;
  final DateTime inductedAt;
  final DateTime? expiresAt;
  final Signoff? signoff;
  final String? syncError;
  final bool isSynced;
  const SiteInduction({
    required this.id,
    required this.projectId,
    this.userId,
    required this.name,
    required this.inductedAt,
    this.expiresAt,
    this.signoff,
    this.syncError,
    this.isSynced = false,
  });

  bool get isVisitor => userId == null;
  InductionStatus statusAt(DateTime now) => inductionStatus(expiresAt, now);
}

class SwmsDocument {
  final String id;
  final String projectId;
  final String title;
  final String? mimeType;
  final DateTime? uploadedAt;
  final String? localPath;

  /// Everyone who has signed on, and whether the current user has.
  final List<Signoff> signoffs;
  final Signoff? mine;
  const SwmsDocument({
    required this.id,
    required this.projectId,
    required this.title,
    this.mimeType,
    this.uploadedAt,
    this.localPath,
    this.signoffs = const [],
    this.mine,
  });
}

class InductionOpsService {
  InductionOpsService._();
  static final InductionOpsService instance = InductionOpsService._();

  final DatabaseService _db = DatabaseService();
  SignoffStore get _signoffs => SignoffStore.instance;

  final Map<String, List<SiteInduction>> _inductions = {};
  final Map<String, List<SwmsDocument>> _swms = {};
  String? _me;

  final ValueNotifier<int> changes = ValueNotifier(0);

  static const _inductionCols = [
    'project_id', 'user_id', 'name', 'inducted_at', 'expires_at',
    'checklist_instance_id', 'is_deleted', 'updated_at',
  ];

  /// Test seams: stand in for the network.
  @visibleForTesting
  Future<ApiResult> Function(String op, Map<String, Object?> data, String id)?
      pushForTest;
  @visibleForTesting
  Future<ApiResult> Function(int since)? pullForTest;
  @visibleForTesting
  Future<ApiResult> Function(String projectId)? swmsListForTest;

  bool _wired = false;
  bool _flushing = false;
  bool _flushAgain = false;
  Completer<void>? _inFlight;
  StreamSubscription<List<ConnectivityResult>>? _connSub;

  /// Induct people (`safety.manage`).
  bool get canInduct => PermissionsService.instance.has('safety.manage');

  /// Sign on to a SWMS (`safety.report`).
  bool get canSignSwms => PermissionsService.instance.has('safety.report');

  void ensureWired() {
    if (_wired) return;
    _wired = true;
    _connSub = Connectivity().onConnectivityChanged.listen((r) {
      if (r.any((x) => x != ConnectivityResult.none)) unawaited(sync());
    });
  }

  @visibleForTesting
  void resetForTest() {
    _inductions.clear();
    _swms.clear();
    _me = null;
    _connSub?.cancel();
    _wired = false;
    pushForTest = null;
    pullForTest = null;
    swmsListForTest = null;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  List<SiteInduction> inductions(String projectId) =>
      _inductions[projectId] ?? const [];

  List<SwmsDocument> swms(String projectId) => _swms[projectId] ?? const [];

  /// The current user's best induction on this project: the one that
  /// expires last. Null if they have none.
  SiteInduction? myInduction(String projectId) {
    final mine = inductions(projectId).where((i) => i.userId != null && i.userId == _me);
    SiteInduction? best;
    for (final i in mine) {
      if (best == null ||
          i.expiresAt == null ||
          (best.expiresAt != null && i.expiresAt!.isAfter(best.expiresAt!))) {
        best = i;
      }
    }
    return best;
  }

  // ── Hydration ────────────────────────────────────────────────────────────

  Future<void> hydrateProject(String projectId) async {
    ensureWired();
    await _pullAndApply();
    await refreshSwmsRegister(projectId);
    await reload(projectId);
    unawaited(sync(projectId: projectId));
  }

  Future<void> reload(String projectId) async {
    _me = (await SessionService.currentUser())?['id']?.toString();
    final rows = await _db.query('site_inductions',
        where: 'project_id = ? AND is_deleted = 0',
        whereArgs: [projectId],
        orderBy: 'inducted_at DESC');
    final list = <SiteInduction>[];
    for (final r in rows) {
      final id = r['id'] as String;
      final sigs = await _signoffs.signoffsFor(SignoffSubject.siteInduction, id);
      list.add(SiteInduction(
        id: id,
        projectId: projectId,
        userId: r['user_id'] as String?,
        name: (r['name'] as String?) ?? (sigs.isNotEmpty ? sigs.first.displayName : 'Team member'),
        inductedAt: _parseDt(r['inducted_at']) ?? DateTime.now(),
        expiresAt: _parseDt(r['expires_at']),
        signoff: sigs.isEmpty ? null : sigs.last,
        syncError: r['sync_error'] as String?,
        isSynced: _bool(r['ever_synced']) && !_bool(r['is_dirty']),
      ));
    }
    _inductions[projectId] = list;

    final docs = await _db.query('swms_documents',
        where: 'project_id = ?', whereArgs: [projectId], orderBy: 'title ASC');
    final out = <SwmsDocument>[];
    for (final d in docs) {
      final id = d['id'] as String;
      final sigs = await _signoffs.signoffsFor(SignoffSubject.swms, id);
      Signoff? mine;
      for (final s in sigs) {
        if (s.userId != null && s.userId == _me) mine = s;
      }
      out.add(SwmsDocument(
        id: id,
        projectId: projectId,
        title: (d['title'] as String?) ?? 'SWMS',
        mimeType: d['mime_type'] as String?,
        uploadedAt: _parseDt(d['uploaded_at']),
        localPath: d['local_path'] as String?,
        signoffs: sigs,
        mine: mine,
      ));
    }
    _swms[projectId] = out;
    changes.value++;
  }

  /// Refresh the cached SWMS register when online. Offline, the last copy
  /// stays, so sign-on still works at the gate.
  Future<void> refreshSwmsRegister(String projectId) async {
    try {
      final res = swmsListForTest != null
          ? await swmsListForTest!(projectId)
          : await NexusService.authedGet(
              '/documents?project_id=$projectId&kind=swms');
      if (!res.success) return;
      final raw = res.data['documents'];
      final rows = raw is List ? raw : const [];
      final keep = <String>{};
      for (final r in rows) {
        final m = Map<String, dynamic>.from(r as Map);
        final id = (m['document_id'] ?? m['id'])?.toString();
        if (id == null) continue;
        keep.add(id);
        final values = {
          'id': id,
          'project_id': projectId,
          'title': (m['original_filename'] as String?) ?? 'SWMS',
          'mime_type': m['mime_type'] as String?,
          'uploaded_at': m['created_at']?.toString(),
        };
        final existing = await _db.query('swms_documents',
            columns: ['id'], where: 'id = ?', whereArgs: [id], limit: 1);
        if (existing.isEmpty) {
          await _db.insert('swms_documents', values);
        } else {
          await _db.update('swms_documents', values, where: 'id = ?', whereArgs: [id]);
        }
      }
      // A SWMS withdrawn in the Portal leaves the register.
      final cached = await _db.query('swms_documents',
          columns: ['id'], where: 'project_id = ?', whereArgs: [projectId]);
      for (final c in cached) {
        if (!keep.contains(c['id'])) {
          await _db.delete('swms_documents', where: 'id = ?', whereArgs: [c['id']]);
        }
      }
    } catch (e) {
      debugPrint('[Inductions] SWMS register refresh failed: $e');
    }
  }

  /// The SWMS file on this phone, downloading it first if needed. Null when
  /// it isn't cached and can't be fetched.
  Future<File?> swmsFile(SwmsDocument d) async {
    if (d.localPath != null && await File(d.localPath!).exists()) {
      return File(d.localPath!);
    }
    final res = await NexusService.authedGetBytes('/documents/${d.id}');
    if (!res.ok) return null;
    final dir = Directory('${(await getApplicationDocumentsDirectory()).path}/swms');
    await dir.create(recursive: true);
    final safe = d.title.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
    final file = File('${dir.path}/${d.id}-$safe');
    await file.writeAsBytes(res.bytes!);
    await _db.update('swms_documents', {'local_path': file.path},
        where: 'id = ?', whereArgs: [d.id]);
    await reload(d.projectId);
    return file;
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  /// Induct a member ([userId]) or a visitor (name only), with the
  /// inductee's signature. Returns a refusal code, or null when queued.
  Future<String?> induct({
    required String projectId,
    String? userId,
    required String name,
    DateTime? expiresAt,
    Uint8List? signaturePng,
  }) async {
    if (!canInduct) return 'FORBIDDEN';
    if (name.trim().isEmpty) return 'VALIDATION_ERROR';
    final id = const Uuid().v4();
    final now = DateTime.now();
    await _db.insert('site_inductions', {
      'id': id,
      'project_id': projectId,
      'user_id': userId,
      'name': name.trim(),
      'inducted_at': _dtStr(now),
      'expires_at': expiresAt == null ? null : _dateStr(expiresAt),
      'is_deleted': 0,
      'is_dirty': 1,
      'pending_op': 'create',
      'ever_synced': 0,
      'created_at': _dtStr(now),
      'updated_at': now.millisecondsSinceEpoch,
    });
    await _signoffs.add(
      subjectType: SignoffSubject.siteInduction,
      subjectId: id,
      projectId: projectId,
      userId: userId,
      displayName: name.trim(),
      signaturePng: signaturePng,
    );
    await reload(projectId);
    unawaited(sync(projectId: projectId));
    return null;
  }

  /// The current user signs on to a SWMS. One sign-on per person per
  /// document: a second tap is a no-op.
  Future<String?> signSwms(SwmsDocument d, {Uint8List? signaturePng}) async {
    if (!canSignSwms) return 'FORBIDDEN';
    if (d.mine != null) return null;
    final user = await SessionService.currentUser();
    final me = user?['id']?.toString();
    if (me == null) return 'FORBIDDEN';
    await _signoffs.add(
      subjectType: SignoffSubject.swms,
      subjectId: d.id,
      projectId: d.projectId,
      userId: me,
      displayName: ((user?['fullName'] ?? user?['full_name'] ?? user?['name']) as String?) ??
          'Team member',
      signaturePng: signaturePng,
    );
    await reload(d.projectId);
    unawaited(sync(projectId: d.projectId));
    return null;
  }

  // ── Sync ─────────────────────────────────────────────────────────────────

  Future<void> sync({String? projectId}) async {
    if (_flushing) {
      _flushAgain = true;
      return _inFlight!.future;
    }
    _flushing = true;
    final done = _inFlight = Completer<void>();
    try {
      do {
        _flushAgain = false;
        final online = await _pushPending();
        if (online) await _pullAndApply();
        for (final p in {?projectId, ..._inductions.keys}) {
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
    for (final r in await _db.query('site_inductions', where: 'is_dirty = 1')) {
      final id = r['id'] as String;
      final op = (r['pending_op'] as String?) ?? 'update';
      final data = {for (final c in _inductionCols) c: r[c]};
      ApiResult res;
      try {
        res = pushForTest != null
            ? await pushForTest!(op, data, id)
            : await SyncClient.push(
                table: 'site_inductions', operation: op, data: data, localId: id);
      } catch (e) {
        debugPrint('[Inductions] push $id failed: $e — kept queued');
        return false;
      }
      if (res.success) {
        await _db.update('site_inductions',
            {'is_dirty': 0, 'pending_op': null, 'ever_synced': 1, 'sync_error': null},
            where: 'id = ?', whereArgs: [id]);
      } else if (res.status == 0 || res.status == 429 || res.status >= 500) {
        return false;
      } else {
        await _db.update('site_inductions',
            {'is_dirty': 0, 'pending_op': null, 'sync_error': res.code ?? 'ERROR'},
            where: 'id = ?', whereArgs: [id]);
      }
    }
    final synced = (await _db.query('site_inductions',
            columns: ['id'], where: 'ever_synced = 1'))
        .map((r) => r['id'] as String);
    final swmsIds = (await _db.rawQuery(
            "SELECT DISTINCT subject_id FROM signoffs WHERE subject_type = 'swms' AND is_dirty = 1"))
        .map((r) => r['subject_id'] as String);
    await _signoffs.flushFor([...synced, ...swmsIds]);
    return true;
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
        final data = Map<String, Object?>.from(c['data'] as Map? ?? const {});
        data['id'] ??= c['local_id']?.toString();
        if (data['id'] == null) continue;
        if (table == 'site_inductions') {
          await applyPulledInduction(data);
        } else if (table == SignoffStore.table &&
            (data['subject_type'] == 'site_induction' || data['subject_type'] == 'swms')) {
          await _signoffs.applyPulled(data);
        }
      }
      final lastSync = res.data['last_sync_at'];
      final next = lastSync is int
          ? lastSync
          : int.tryParse(lastSync?.toString() ?? '') ?? since;
      await _setCursor(next);
    } catch (e) {
      debugPrint('[Inductions] pull failed: $e');
    }
  }

  @visibleForTesting
  Future<void> applyPulledInduction(Map<String, Object?> data) async {
    final id = data['id'].toString();
    final existing = await _db.query('site_inductions',
        where: 'id = ?', whereArgs: [id], limit: 1);
    if (existing.isNotEmpty && _bool(existing.first['is_dirty'])) return;
    final filtered = await _db.filterToTableColumns('site_inductions', data)
      ..remove('sync_error');
    filtered
      ..['id'] = id
      ..['is_dirty'] = 0
      ..['pending_op'] = null
      ..['ever_synced'] = 1;
    if (existing.isEmpty) {
      await _db.insert('site_inductions', filtered);
    } else {
      await _db.update('site_inductions', filtered, where: 'id = ?', whereArgs: [id]);
    }
  }

  static const _cursorKey = 'induction_pull_cursor';

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

  static bool _bool(Object? v) =>
      v == 1 || v == true || v?.toString() == '1' || v?.toString() == 'true';

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
}
