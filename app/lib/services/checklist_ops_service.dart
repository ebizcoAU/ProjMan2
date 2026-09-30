import 'dart:async';
import 'dart:convert';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import 'db_service.dart';
import 'document_queue_service.dart';
import 'permissions_service.dart';
import 'session_service.dart';
import 'signoff_store.dart';
import 'sync_client.dart';

/// Quality → Checklists: generic checklists (internal QA, toolbox talks,
/// plant pre-starts). **Wired to sync** against server migration v047
/// (xprojman-46). It follows the [QualityOpsService] design: local SQLite is
/// the source of truth for reads, every write lands there first, then rides
/// `/sync/push`, and a pull brings back the server-stamped columns.
///
/// The xprojman-46 rules it relies on:
/// - **F2 snapshot:** starting a checklist copies each template item's
///   label / required / photo-required into the instance. The server fills
///   in `template_name`/`category` itself and ignores ours.
/// - **Push order (§7 #2):** instance, then items, then sign-offs. Tapping
///   Complete only sets a local flag. `status='completed'` is pushed last,
///   once every item and sign-off has synced and every photo and signature
///   upload is `stored`, because the server's completion check only counts
///   what it already has.
/// - **F5 codes:** `CHECKLIST_INCOMPLETE` is retryable, so completion stays
///   requested. `CHECKLIST_FROZEN` is terminal: stop and take the server's
///   copy.
/// - **F6:** a generic checklist never blocks a stage.
///
/// Sign-offs (toolbox attendees, plant operator) go through [SignoffStore],
/// the single seam for the shared `signoffs` table.
enum ChecklistCategory {
  internalQa('internal_qa', 'Internal QA'),
  toolboxTalk('toolbox_talk', 'Toolbox talk'),
  plantPrestart('plant_prestart', 'Plant pre-start'),
  other('other', 'Other');

  final String wire;
  final String label;
  const ChecklistCategory(this.wire, this.label);

  static ChecklistCategory fromWire(Object? w) => ChecklistCategory.values
      .firstWhere((c) => c.wire == w, orElse: () => ChecklistCategory.other);

  /// What the sign-off section is called for this category (appspec §4.2):
  /// toolbox talks collect attendees, plant pre-starts an operator.
  String get signoffHeading => switch (this) {
        ChecklistCategory.toolboxTalk => 'Attendees',
        ChecklistCategory.plantPrestart => 'Operator sign-off',
        _ => 'Sign-off',
      };
}

enum ChecklistStatus { inProgress, completed }

enum ChecklistResult { pending, pass, fail }

enum ChecklistItemResult { pending, pass, fail, na }

class ChecklistTemplateItem {
  final String id;
  final int seq;
  final String label;
  final bool isRequired;
  final bool photoRequired;
  const ChecklistTemplateItem({
    required this.id,
    required this.seq,
    required this.label,
    this.isRequired = true,
    this.photoRequired = false,
  });
}

class ChecklistTemplate {
  final String id;
  final String name;
  final ChecklistCategory category;
  final String? description;
  final String? targetRole;
  final List<ChecklistTemplateItem> items;
  const ChecklistTemplate({
    required this.id,
    required this.name,
    required this.category,
    this.description,
    this.targetRole,
    required this.items,
  });
}

/// One executed item. [label], [isRequired] and [photoRequired] are the F2
/// snapshot, frozen at start.
class ChecklistItem {
  final String id;
  final int seq;
  final String label;
  final bool isRequired;
  final bool photoRequired;
  ChecklistItemResult result;
  String? note;

  /// Local cache of this item's photo evidence: `client_ref`s until
  /// uploaded, then `document_id`s. The evidence itself is a `documents` row
  /// with `entity_type='checklist_item'` keyed by [id] (xprojman-46 §7 #1).
  final List<String> photoIds;

  ChecklistItem({
    String? id,
    required this.seq,
    required this.label,
    required this.isRequired,
    required this.photoRequired,
    this.result = ChecklistItemResult.pending,
    this.note,
    List<String>? photoIds,
  })  : id = id ?? const Uuid().v4(),
        photoIds = photoIds ?? [];

  int get photoCount => photoIds.length;

  /// Why this item blocks completion, or null if it doesn't. This matches
  /// the server rule (xprojman-46 §7, Server 2026-09-30): a required item
  /// can't be pending, and photo evidence is checked only on an answered
  /// Pass/Fail. N/A and an unanswered optional item never need a photo.
  String? get blocker {
    if (isRequired && result == ChecklistItemResult.pending) return 'Not answered';
    final answered = result == ChecklistItemResult.pass ||
        result == ChecklistItemResult.fail;
    if (photoRequired && answered && photoCount == 0) return 'Photo required';
    return null;
  }
}

class ChecklistInstance {
  final String id;
  final String projectId;
  final String templateId;
  final String templateName; // snapshot
  final ChecklistCategory category; // snapshot
  final String? supersedesId;
  final String? startedBy;
  final String? startedByName;
  final DateTime startedAt;
  final List<ChecklistItem> items;
  ChecklistStatus status;
  ChecklistResult result;
  String? completedBy;
  DateTime? completedAt;
  String? notes;

  /// The user tapped Complete. The push waits for everything else to sync.
  bool completionRequested;

  /// The last code that stopped this checklist syncing, if any.
  String? syncError;
  bool isSynced;

  ChecklistInstance({
    String? id,
    required this.projectId,
    required this.templateId,
    required this.templateName,
    required this.category,
    required this.items,
    this.supersedesId,
    this.startedBy,
    this.startedByName,
    DateTime? startedAt,
    this.status = ChecklistStatus.inProgress,
    this.result = ChecklistResult.pending,
    this.completedBy,
    this.completedAt,
    this.notes,
    this.completionRequested = false,
    this.syncError,
    this.isSynced = false,
  })  : id = id ?? const Uuid().v4(),
        startedAt = startedAt ?? DateTime.now();

  bool get isCompleted => status == ChecklistStatus.completed;

  /// No more edits: either completed on the server, or completion has been
  /// requested and is waiting to sync.
  bool get isFrozen => isCompleted || completionRequested;
  int get answered =>
      items.where((i) => i.result != ChecklistItemResult.pending).length;
}

/// The outcome of tapping Complete. `CHECKLIST_INCOMPLETE` comes from the
/// local check, before anything is sent. A success means completion is
/// queued; it becomes final once the server stamps the result.
class ChecklistCompletion {
  final bool success;
  final String? code;
  final List<ChecklistItem> blockers;
  const ChecklistCompletion.ok()
      : success = true,
        code = null,
        blockers = const [];
  const ChecklistCompletion.fail(this.code, [this.blockers = const []])
      : success = false;
}

/// Pure completion-readiness rule, kept separate so it can be tested
/// without a database: the `status='completed'` push may go only when
/// nothing the server's check depends on is still local.
enum CompletionGate { ready, waitingForSync, uploadFailed }

CompletionGate completionGate({
  required bool instanceSynced,
  required bool childrenClean,
  required int uploadsWaiting,
  required int uploadsFailed,
}) {
  if (uploadsFailed > 0) return CompletionGate.uploadFailed;
  if (!instanceSynced || !childrenClean || uploadsWaiting > 0) {
    return CompletionGate.waitingForSync;
  }
  return CompletionGate.ready;
}

class ChecklistOpsService {
  ChecklistOpsService._();
  static final ChecklistOpsService instance = ChecklistOpsService._();

  final DatabaseService _db = DatabaseService();
  SignoffStore get _signoffs => SignoffStore.instance;

  final Map<String, List<ChecklistInstance>> _byProject = {};
  final Map<String, List<Signoff>> _signoffsBySubject = {};
  List<ChecklistTemplate> _templates = const [];

  /// Bumped whenever data changes, including in the background (e.g. a
  /// completion that lands once signal returns), so screens can rebuild.
  final ValueNotifier<int> changes = ValueNotifier(0);

  static const _pullTables = {
    'checklist_templates', 'checklist_template_items', 'checklist_instances',
    'checklist_instance_items', SignoffStore.table,
  };

  /// What this device may push. Server-stamped columns (`template_name`,
  /// `category`, `result`, `started_by`, `completed_by`/`at`) are never sent.
  static const _instanceCols = [
    'project_id', 'template_id', 'stage_id', 'unit_id', 'status', 'lat', 'lng',
    'notes', 'supersedes_id', 'is_deleted', 'updated_at',
  ];
  static const _itemCols = [
    'instance_id', 'seq', 'label', 'is_required', 'photo_required', 'result',
    'note', 'is_deleted', 'updated_at',
  ];

  bool _wired = false;
  bool _flushing = false;
  bool _flushAgain = false;
  StreamSubscription<List<ConnectivityResult>>? _connSub;

  /// Wire the background triggers: signal returning, and each upload
  /// landing, since a queued completion may be waiting on either.
  /// Idempotent.
  void ensureWired() {
    if (_wired) return;
    _wired = true;
    _connSub = Connectivity().onConnectivityChanged.listen((r) {
      if (r.any((x) => x != ConnectivityResult.none)) unawaited(sync());
    });
    DocumentQueueService.instance.addUploadListener((type) {
      if (type == 'checklist_item' || type == 'signoff') unawaited(sync());
    });
  }

  @visibleForTesting
  void resetForTest() {
    _byProject.clear();
    _signoffsBySubject.clear();
    _templates = const [];
    _connSub?.cancel();
    _wired = false;
  }

  // ── Reads (from the in-memory cache, refreshed by [reload]) ─────────────

  /// Published templates this user may start. A `target_role` template is
  /// shown only to that role or to a manager, matching the server guard.
  List<ChecklistTemplate> templates() => _templates;

  List<ChecklistInstance> instances(String projectId,
      {ChecklistStatus? status}) {
    final list = _byProject[projectId] ?? const [];
    return list.where((i) => status == null || i.status == status).toList();
  }

  ChecklistInstance? byId(String projectId, String id) {
    for (final i in _byProject[projectId] ?? const <ChecklistInstance>[]) {
      if (i.id == id) return i;
    }
    return null;
  }

  List<Signoff> signoffs(ChecklistInstance inst) =>
      _signoffsBySubject[inst.id] ?? const [];

  // ── Hydration ────────────────────────────────────────────────────────────

  /// Pull, show, then push anything waiting. That's the same order as
  /// QualityOpsService, but pull never overwrites a row with unpushed
  /// changes.
  Future<void> hydrateProject(String projectId) async {
    ensureWired();
    await _pullAndApply();
    await reload(projectId);
    unawaited(sync(projectId: projectId));
  }

  Future<void> reload(String projectId) async {
    await _loadTemplates();
    final rows = await _db.query('checklist_instances',
        where: 'project_id = ? AND is_deleted = 0',
        whereArgs: [projectId],
        orderBy: 'created_at DESC');
    final list = <ChecklistInstance>[];
    for (final r in rows) {
      final id = r['id'] as String;
      final itemRows = await _db.query('checklist_instance_items',
          where: 'instance_id = ? AND is_deleted = 0',
          whereArgs: [id],
          orderBy: 'seq ASC');
      list.add(_instanceFromRow(r, itemRows.map(_itemFromRow).toList()));
      _signoffsBySubject[id] =
          await _signoffs.signoffsFor(SignoffSubject.checklistInstance, id);
    }
    list.sort((a, b) => b.startedAt.compareTo(a.startedAt));
    _byProject[projectId] = list;
    changes.value++;
  }

  Future<void> _loadTemplates() async {
    final role = PermissionsService.instance.role;
    final manager = role == 'projectManager' || role == 'siteSupervisor';
    final rows = await _db.query('checklist_templates',
        where: 'is_published = 1 AND is_deleted = 0', orderBy: 'name ASC');
    final out = <ChecklistTemplate>[];
    for (final t in rows) {
      final target = t['target_role'] as String?;
      if (target != null && target != role && !manager) continue;
      final items = await _db.query('checklist_template_items',
          where: 'template_id = ? AND is_deleted = 0',
          whereArgs: [t['id']],
          orderBy: 'seq ASC');
      if (items.isEmpty) continue;
      out.add(ChecklistTemplate(
        id: t['id'] as String,
        name: (t['name'] as String?) ?? 'Checklist',
        category: ChecklistCategory.fromWire(t['category']),
        description: t['description'] as String?,
        targetRole: target,
        items: [
          for (final i in items)
            ChecklistTemplateItem(
              id: i['id'] as String,
              seq: (i['seq'] as int?) ?? 0,
              label: (i['label'] as String?) ?? '',
              isRequired: _bool(i['is_required'], true),
              photoRequired: _bool(i['photo_required'], false),
            ),
        ],
      ));
    }
    _templates = out;
  }

  // ── Writes (local first, then sync) ─────────────────────────────────────

  /// Start a checklist from a template, taking the F2 snapshot.
  Future<ChecklistInstance> start(String projectId, ChecklistTemplate t,
          {String? supersedesId}) =>
      _create(projectId, t.id, t.name, t.category, [
        for (final ti in t.items)
          (ti.seq, ti.label, ti.isRequired, ti.photoRequired),
      ], supersedesId: supersedesId);

  /// Start a correction of a completed checklist: a fresh instance that
  /// supersedes it, reusing its snapshot rather than the live template.
  Future<ChecklistInstance> startCorrection(ChecklistInstance old) =>
      _create(old.projectId, old.templateId, old.templateName, old.category, [
        for (final i in old.items) (i.seq, i.label, i.isRequired, i.photoRequired),
      ], supersedesId: old.id);

  Future<ChecklistInstance> _create(
    String projectId,
    String templateId,
    String templateName,
    ChecklistCategory category,
    List<(int, String, bool, bool)> items, {
    String? supersedesId,
  }) async {
    final user = await SessionService.currentUser();
    final id = const Uuid().v4();
    final now = DateTime.now();
    final ms = now.millisecondsSinceEpoch;
    await _db.insert('checklist_instances', {
      'id': id,
      'project_id': projectId,
      'template_id': templateId,
      'template_name': templateName,
      'category': category.wire,
      'status': 'in_progress',
      'result': 'pending',
      'started_by': user?['id']?.toString(),
      'started_by_name': user?['fullName'] as String?,
      'supersedes_id': supersedesId,
      'is_deleted': 0,
      'is_dirty': 1,
      'pending_op': 'create',
      'ever_synced': 0,
      'created_at': _dtStr(now),
      'updated_at': ms,
    });
    for (final (seq, label, req, photo) in items) {
      await _db.insert('checklist_instance_items', {
        'id': const Uuid().v4(),
        'instance_id': id,
        'seq': seq,
        'label': label,
        'is_required': req ? 1 : 0,
        'photo_required': photo ? 1 : 0,
        'result': 'pending',
        'is_deleted': 0,
        'is_dirty': 1,
        'pending_op': 'create',
        'ever_synced': 0,
        'updated_at': ms,
      });
    }
    await reload(projectId);
    unawaited(sync(projectId: projectId));
    return byId(projectId, id)!;
  }

  Future<bool> setResult(
      ChecklistInstance inst, ChecklistItem item, ChecklistItemResult r) async {
    if (inst.isFrozen) return false;
    item.result = r;
    await _touchItem(inst, item, {'result': r.name});
    return true;
  }

  Future<bool> setNote(
      ChecklistInstance inst, ChecklistItem item, String? note) async {
    if (inst.isFrozen) return false;
    item.note = (note == null || note.trim().isEmpty) ? null : note.trim();
    await _touchItem(inst, item, {'note': item.note});
    return true;
  }

  /// Record a captured photo (its queue `client_ref`) against the item. The
  /// caller has already queued the upload (`captureAndEnqueue`).
  Future<bool> attachPhoto(
      ChecklistInstance inst, ChecklistItem item, String clientRef) async {
    if (inst.isFrozen) return false;
    item.photoIds.add(clientRef);
    // Local cache only: evidence reaches the server as a document, not as a
    // pushed column, so the row isn't marked dirty for this.
    await _db.update('checklist_instance_items',
        {'photo_ids': jsonEncode(item.photoIds)},
        where: 'id = ?', whereArgs: [item.id]);
    changes.value++;
    return true;
  }

  Future<void> _touchItem(ChecklistInstance inst, ChecklistItem item,
      Map<String, Object?> fields) async {
    final rows = await _db.query('checklist_instance_items',
        columns: ['ever_synced'], where: 'id = ?', whereArgs: [item.id], limit: 1);
    final synced = rows.isNotEmpty && ((rows.first['ever_synced'] as int?) ?? 0) == 1;
    await _db.update('checklist_instance_items', {
      ...fields,
      'is_dirty': 1,
      'pending_op': synced ? 'update' : 'create',
      'updated_at': DateTime.now().millisecondsSinceEpoch,
    }, where: 'id = ?', whereArgs: [item.id]);
    changes.value++;
    unawaited(sync(projectId: inst.projectId));
  }

  Future<Signoff?> addSignoff(ChecklistInstance inst,
      {String? userId,
      required String displayName,
      Uint8List? signaturePng}) async {
    if (inst.isFrozen) return null;
    final s = await _signoffs.add(
      subjectType: SignoffSubject.checklistInstance,
      subjectId: inst.id,
      projectId: inst.projectId,
      userId: userId,
      displayName: displayName,
      signaturePng: signaturePng,
    );
    await reload(inst.projectId);
    unawaited(sync(projectId: inst.projectId));
    return s;
  }

  Future<bool> removeSignoff(ChecklistInstance inst, Signoff s) async {
    if (inst.isFrozen) return false;
    await _signoffs.remove(s);
    await reload(inst.projectId);
    unawaited(sync(projectId: inst.projectId));
    return true;
  }

  /// Tap Complete. The local check mirrors the server's F5 rule, so the
  /// person fixes gaps now rather than after a round trip. Passing it locks
  /// the checklist and queues the completion push (see the class doc).
  Future<ChecklistCompletion> complete(ChecklistInstance inst) async {
    if (inst.isFrozen) {
      return const ChecklistCompletion.fail('CHECKLIST_FROZEN');
    }
    final blockers = inst.items.where((i) => i.blocker != null).toList();
    if (blockers.isNotEmpty) {
      return ChecklistCompletion.fail('CHECKLIST_INCOMPLETE', blockers);
    }
    inst.completionRequested = true;
    await _db.update('checklist_instances',
        {'completion_requested': 1, 'sync_error': null},
        where: 'id = ?', whereArgs: [inst.id]);
    changes.value++;
    unawaited(sync(projectId: inst.projectId));
    return const ChecklistCompletion.ok();
  }

  // ── Sync ─────────────────────────────────────────────────────────────────

  /// Push in dependency order, then pull. Serialised: a call that arrives
  /// mid-flush schedules exactly one more pass.
  Future<void> sync({String? projectId}) async {
    if (_flushing) {
      _flushAgain = true;
      return;
    }
    _flushing = true;
    try {
      do {
        _flushAgain = false;
        final online = await _pushPending();
        if (online) await _pullAndApply();
      } while (_flushAgain);
    } finally {
      _flushing = false;
    }
    final pids = projectId != null ? [projectId] : _byProject.keys.toList();
    for (final p in pids) {
      await reload(p);
    }
  }

  /// Returns false when a transport failure says we're offline.
  Future<bool> _pushPending() async {
    // 1. Instances: creates and edits. Completion is step 4, so the status
    //    sent here is always in_progress.
    for (final r
        in await _db.query('checklist_instances', where: 'is_dirty = 1')) {
      final out = await _push('checklist_instances', r, _instanceCols,
          override: const {'status': 'in_progress'});
      if (out == _Push.offline) return false;
    }
    final syncedIds = (await _db.query('checklist_instances',
            columns: ['id'], where: 'ever_synced = 1'))
        .map((r) => r['id'] as String)
        .toList();
    if (syncedIds.isEmpty) return true;
    final ph = List.filled(syncedIds.length, '?').join(', ');

    // 2. Items whose parent the server already has.
    for (final r in await _db.rawQuery(
        'SELECT * FROM checklist_instance_items '
        'WHERE is_dirty = 1 AND instance_id IN ($ph)',
        syncedIds)) {
      final out = await _push('checklist_instance_items', r, _itemCols);
      if (out == _Push.offline) return false;
    }

    // 3. Sign-offs, through the one seam.
    await _signoffs.flushFor(syncedIds);

    // 4. Completions whose evidence is all server-side.
    for (final r in await _db.query('checklist_instances',
        where: "completion_requested = 1 AND status != 'completed' "
            'AND ever_synced = 1')) {
      if (!await _pushCompletion(r)) return false;
    }
    return true;
  }

  /// Returns false when offline.
  Future<bool> _pushCompletion(Map<String, Object?> r) async {
    final id = r['id'] as String;
    final itemIds = (await _db.query('checklist_instance_items',
            columns: ['id'],
            where: 'instance_id = ? AND is_deleted = 0',
            whereArgs: [id]))
        .map((x) => x['id'] as String)
        .toList();
    final dirtyItems = await _db.rawQuery(
        'SELECT COUNT(*) AS n FROM checklist_instance_items '
        'WHERE instance_id = ? AND is_dirty = 1',
        [id]);
    final signoffIds = await _signoffs.idsFor([id]);
    final photos = await DocumentQueueService.instance
        .uploadStateFor('checklist_item', itemIds);
    final sigs = await DocumentQueueService.instance
        .uploadStateFor('signoff', signoffIds);
    final gate = completionGate(
      instanceSynced: ((r['is_dirty'] as int?) ?? 0) == 0,
      childrenClean: ((dirtyItems.first['n'] as int?) ?? 0) == 0 &&
          await _signoffs.isCleanFor([id]),
      uploadsWaiting: photos.waiting + sigs.waiting,
      uploadsFailed: photos.failed + sigs.failed,
    );
    if (gate == CompletionGate.uploadFailed) {
      await _setError(id, 'UPLOAD_FAILED');
      return true;
    }
    if (gate == CompletionGate.waitingForSync) return true;

    final out = await _push('checklist_instances', r, _instanceCols,
        override: const {'status': 'completed'}, completion: true);
    return out != _Push.offline;
  }

  Future<_Push> _push(String table, Map<String, Object?> r, List<String> cols,
      {Map<String, Object?> override = const {}, bool completion = false}) async {
    final id = r['id'] as String;
    final op =
        completion ? 'update' : ((r['pending_op'] as String?) ?? 'update');
    final data = {
      for (final c in cols)
        if (r.containsKey(c)) c: r[c],
      ...override,
    };
    try {
      final res = await SyncClient.push(
          table: table, operation: op, data: data, localId: id);
      if (res.success) {
        await _db.update(table, {
          'is_dirty': 0,
          'pending_op': null,
          'ever_synced': 1,
          if (table == 'checklist_instances') 'sync_error': null,
        }, where: 'id = ?', whereArgs: [id]);
        return _Push.ok;
      }
      if (res.status == 0 || res.status == 429 || res.status >= 500) {
        return _Push.offline;
      }
      await _handleRefusal(table, r, res.code ?? 'ERROR', completion);
      return _Push.refused;
    } catch (e) {
      debugPrint('[Checklists] push $table/$id failed: $e — kept queued');
      return _Push.offline;
    }
  }

  Future<void> _handleRefusal(String table, Map<String, Object?> r,
      String code, bool completion) async {
    final id = r['id'] as String;
    debugPrint('[Checklists] $table/$id refused: $code');
    final instanceId =
        table == 'checklist_instances' ? id : r['instance_id'] as String?;
    if (completion && code == 'CHECKLIST_INCOMPLETE') {
      // Retryable: the server doesn't have everything yet. Keep the request,
      // and record why.
      await _setError(id, code);
      return;
    }
    // Everything else is terminal for this row. CHECKLIST_FROZEN means
    // completed elsewhere; FORBIDDEN / VALIDATION_ERROR / NOT_FOUND won't fix
    // themselves. Stop retrying, un-dirty so the next pull can bring the
    // server copy, and surface the code on the checklist.
    await _db.update(table, {'is_dirty': 0, 'pending_op': null},
        where: 'id = ?', whereArgs: [id]);
    if (instanceId != null) {
      await _db.update('checklist_instances',
          {'completion_requested': 0, 'sync_error': code},
          where: 'id = ?', whereArgs: [instanceId]);
    }
  }

  Future<void> _setError(String instanceId, String code) => _db.update(
      'checklist_instances', {'sync_error': code},
      where: 'id = ?', whereArgs: [instanceId]);

  Future<void> _pullAndApply() async {
    try {
      final since = await _getCursor();
      final res = await SyncClient.pull(since: since);
      if (!res.success) return;
      for (final raw in (res.data['changes'] as List?) ?? const []) {
        final c = Map<String, dynamic>.from(raw as Map);
        final table = c['table_name']?.toString();
        if (table == null || !_pullTables.contains(table)) continue;
        final data = Map<String, Object?>.from(c['data'] as Map? ?? const {});
        data['id'] ??= c['local_id']?.toString();
        if (data['id'] == null) continue;
        if (table == SignoffStore.table) {
          await _signoffs.applyPulled(data);
        } else {
          await applyPulledRow(table, data);
        }
      }
      final lastSync = res.data['last_sync_at'];
      final next = lastSync is int
          ? lastSync
          : int.tryParse(lastSync?.toString() ?? '') ?? since;
      await _setCursor(next);
    } catch (e) {
      debugPrint('[Checklists] pull failed: $e');
    }
  }

  /// Apply one pulled row. A row with unpushed local changes is left alone,
  /// and its push decides. Local-only columns are never overwritten.
  @visibleForTesting
  Future<void> applyPulledRow(String table, Map<String, Object?> data) async {
    final id = data['id'].toString();
    final existing =
        await _db.query(table, where: 'id = ?', whereArgs: [id], limit: 1);
    final hasSyncCols = table == 'checklist_instances' ||
        table == 'checklist_instance_items';
    if (hasSyncCols &&
        existing.isNotEmpty &&
        ((existing.first['is_dirty'] as int?) ?? 0) == 1) {
      return;
    }
    final filtered = await _db.filterToTableColumns(table, data);
    for (final local in const [
      'photo_ids', 'completion_requested', 'sync_error', 'started_by_name',
    ]) {
      filtered.remove(local);
    }
    filtered['id'] = id;
    if (hasSyncCols) {
      filtered
        ..['is_dirty'] = 0
        ..['pending_op'] = null
        ..['ever_synced'] = 1;
    }
    if (table == 'checklist_instances' && data['status'] == 'completed') {
      filtered['completion_requested'] = 0;
      filtered['sync_error'] = null;
    }
    if (existing.isEmpty) {
      await _db.insert(table, filtered);
    } else {
      await _db.update(table, filtered, where: 'id = ?', whereArgs: [id]);
    }
  }

  static const _cursorKey = 'checklist_pull_cursor';

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

  static ChecklistInstance _instanceFromRow(
          Map<String, Object?> r, List<ChecklistItem> items) =>
      ChecklistInstance(
        id: r['id'] as String,
        projectId: r['project_id'] as String,
        templateId: r['template_id'] as String,
        templateName: (r['template_name'] as String?) ?? 'Checklist',
        category: ChecklistCategory.fromWire(r['category']),
        supersedesId: r['supersedes_id'] as String?,
        startedBy: r['started_by'] as String?,
        startedByName: r['started_by_name'] as String?,
        startedAt: _parseDt(r['created_at']) ?? DateTime.now(),
        status: r['status'] == 'completed'
            ? ChecklistStatus.completed
            : ChecklistStatus.inProgress,
        result: switch (r['result']) {
          'pass' => ChecklistResult.pass,
          'fail' => ChecklistResult.fail,
          _ => ChecklistResult.pending,
        },
        completedBy: r['completed_by'] as String?,
        completedAt: _parseDt(r['completed_at']),
        notes: r['notes'] as String?,
        completionRequested: ((r['completion_requested'] as int?) ?? 0) == 1,
        syncError: r['sync_error'] as String?,
        isSynced: ((r['ever_synced'] as int?) ?? 0) == 1 &&
            ((r['is_dirty'] as int?) ?? 0) == 0,
        items: items,
      );

  static ChecklistItem _itemFromRow(Map<String, Object?> r) => ChecklistItem(
        id: r['id'] as String,
        seq: (r['seq'] as int?) ?? 0,
        label: (r['label'] as String?) ?? '',
        isRequired: _bool(r['is_required'], true),
        photoRequired: _bool(r['photo_required'], false),
        result: switch (r['result']) {
          'pass' => ChecklistItemResult.pass,
          'fail' => ChecklistItemResult.fail,
          'na' => ChecklistItemResult.na,
          _ => ChecklistItemResult.pending,
        },
        note: r['note'] as String?,
        photoIds: _decIds(r['photo_ids']),
      );

  static bool _bool(Object? v, bool dflt) {
    if (v == null) return dflt;
    if (v is int) return v == 1;
    if (v is bool) return v;
    return v.toString() == '1' || v.toString() == 'true';
  }

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
      return (jsonDecode(raw as String) as List)
          .map((e) => e.toString())
          .toList();
    } catch (_) {
      return [];
    }
  }
}

enum _Push { ok, offline, refused }
