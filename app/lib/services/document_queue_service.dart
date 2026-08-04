import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';
import 'db_service.dart';
import 'nexus_service.dart';

/// The ONE offline document/image queue behind all five capture surfaces
/// (inspection-item photo · defect photo · certificate document · site-diary
/// photo · delivery docket) — xprojman-22, built on the server `/documents`
/// contract locked in xprojman-21 and shipped in xprojman-23.
///
/// Files live on the filesystem (`<appdocs>/uploads/<client_ref>`); metadata
/// lives in the `upload_queue` table. `client_ref` (a v4 uuid) is BOTH the
/// stable offline handle and the server's idempotency key — retries never
/// duplicate (idempotent on `(org_id, client_ref)`; a repeat returns the
/// original `document_id` with `duplicate:true`, treated as success).
///
/// Capture is offline-first: write the bytes, insert a queue row, hand the
/// caller the `client_ref` to drop into the owning row's local cache — the UI
/// renders from the local file immediately, no network needed. The worker
/// uploads on connectivity-regained / app-foreground / post-capture.
class DocumentQueueService {
  DocumentQueueService._();
  static final DocumentQueueService instance = DocumentQueueService._();

  final DatabaseService _db = DatabaseService();
  static const _uuid = Uuid();

  /// Server ceiling (xprojman-23 §4): a file over this is rejected 413, so we
  /// refuse it at capture rather than queue a doomed upload.
  static const int maxUploadBytes = 25 * 1024 * 1024;

  /// Local retention cap (decision #3): keep uploaded files as an offline
  /// display cache, size-bounded, evicting oldest-accessed first. A pruned file
  /// re-fetches losslessly from `GET /documents/:id`.
  static const int lruCapBytes = 300 * 1024 * 1024;

  /// entity_type → default `kind` (mirrors the server's mapping, xprojman-23 §4;
  /// the server derives the same default when `kind` is omitted).
  static const Map<String, String> _defaultKind = {
    'inspection_item': 'inspection_photo',
    'defect': 'defect_photo',
    'certificate': 'certificate',
    'site_diary': 'site_diary_photo',
    'delivery': 'delivery_docket',
  };

  /// entity_type → (owning table, id column, the plural cache columns that may
  /// hold this ref). Defects carry two slots (before/after) — the swap lands in
  /// whichever column actually holds the `client_ref`, so the caller never has
  /// to tell the queue which slot a capture belongs to.
  static const Map<String, (String, String, List<String>)> _cacheTarget = {
    'inspection_item': ('inspection_items', 'id', ['photo_ids']),
    'defect': ('defects', 'id', ['photo_ids', 'photo_after_ids']),
    'certificate': ('certificates', 'id', ['document_ids']),
    'site_diary': ('site_diary', 'id', ['photo_ids']),
    'delivery': ('deliveries', 'id', ['photo_ids']),
  };

  bool _flushing = false;
  bool _started = false;
  Directory? _uploadsDir;
  StreamSubscription<List<ConnectivityResult>>? _connSub;

  /// Wire the connectivity trigger + kick a first flush. Idempotent; call once
  /// at app boot after the DB is up.
  Future<void> start() async {
    if (_started) return;
    _started = true;
    _connSub = Connectivity().onConnectivityChanged.listen((results) {
      final online = results.any((r) => r != ConnectivityResult.none);
      if (online) unawaited(flush());
    });
    unawaited(flush());
  }

  Future<Directory> _dir() async {
    if (_uploadsDir != null) return _uploadsDir!;
    final base = await getApplicationDocumentsDirectory();
    final d = Directory('${base.path}/uploads');
    if (!await d.exists()) await d.create(recursive: true);
    _uploadsDir = d;
    return d;
  }

  // ── Capture ────────────────────────────────────────────────────────────────

  /// Persist [bytes] locally and queue them for upload against the owning row
  /// [entityId] (its app-minted UUID, held at capture — so the document
  /// self-describes its owner and neither side waits on the other, xprojman-21
  /// §P1). Returns the `client_ref` for the caller to append to the owning
  /// row's local cache. Throws [DocumentTooLargeException] if over the server
  /// ceiling — the caller should down-scale or warn.
  Future<String> enqueue({
    required String entityType,
    required String entityId,
    required Uint8List bytes,
    String? kind,
    String? projectId,
    String? originalFilename,
    String? mimeType,
  }) async {
    if (bytes.length > maxUploadBytes) {
      throw DocumentTooLargeException(bytes.length);
    }
    final clientRef = _uuid.v4();
    final dir = await _dir();
    final path = '${dir.path}/$clientRef${_extFor(originalFilename)}';
    await File(path).writeAsBytes(bytes, flush: true);
    final now = DateTime.now().millisecondsSinceEpoch;
    await _db.insert('upload_queue', {
      'client_ref': clientRef,
      'local_path': path,
      'kind': kind ?? _defaultKind[entityType] ?? 'general',
      'entity_type': entityType,
      'entity_id': entityId,
      'project_id': projectId,
      'original_filename': originalFilename,
      'mime_type': mimeType,
      'size_bytes': bytes.length,
      'status': 'pending',
      'attempts': 0,
      'created_at': now,
      'last_access_at': now,
    });
    unawaited(flush());
    return clientRef;
  }

  /// The local file for a cache id — a `client_ref` (pre-upload) or a
  /// `document_id` (post-upload) — if it is still on disk. Null if never local
  /// or evicted by the LRU prune (re-fetch with [bytesFor] in that case).
  Future<File?> localFile(String idOrRef) async {
    final rows = await _db.query('upload_queue',
        columns: ['local_path'],
        where: 'client_ref = ? OR document_id = ?',
        whereArgs: [idOrRef, idOrRef],
        limit: 1);
    if (rows.isEmpty) return null;
    final path = rows.first['local_path'] as String?;
    if (path == null) return null;
    final f = File(path);
    if (!await f.exists()) return null;
    unawaited(_touch(idOrRef));
    return f;
  }

  /// Bytes for an uploaded document — the local file if present, else streamed
  /// from `GET /documents/:id` (the LRU re-fetch, decision #3). For a
  /// `document_id`; a not-yet-uploaded `client_ref` only exists locally.
  Future<Uint8List?> bytesFor(String documentId) async {
    final f = await localFile(documentId);
    if (f != null) return f.readAsBytes();
    final res = await NexusService.authedGetBytes('/documents/$documentId');
    return res.ok ? res.bytes : null;
  }

  // ── Upload worker ───────────────────────────────────────────────────────────

  /// Flush the queue: upload pending/failed rows oldest-first. A transient
  /// (network / 5xx) failure stops the pass — we are offline, retry later. A
  /// permanent failure (4xx) parks the row as `error` and the pass continues.
  /// Serialised by [_flushing] so overlapping triggers don't double-upload.
  Future<void> flush() async {
    if (_flushing) return;
    _flushing = true;
    try {
      while (true) {
        final rows = await _db.query('upload_queue',
            where: "status IN ('pending','failed')",
            orderBy: 'attempts ASC, created_at ASC',
            limit: 1);
        if (rows.isEmpty) break;
        final outcome = await _uploadOne(rows.first);
        if (outcome == _Outcome.retryLater) break;
      }
      await _pruneLru();
    } finally {
      _flushing = false;
    }
  }

  Future<_Outcome> _uploadOne(Map<String, Object?> row) async {
    final clientRef = row['client_ref'] as String;
    final localPath = row['local_path'] as String;
    if (!await File(localPath).exists()) {
      await _db.update('upload_queue',
          {'status': 'error', 'last_error': 'local file missing'},
          where: 'client_ref = ?', whereArgs: [clientRef]);
      return _Outcome.permanent;
    }
    await _db.update('upload_queue', {'status': 'uploading'},
        where: 'client_ref = ?', whereArgs: [clientRef]);

    final res = await NexusService.authedMultipart('/documents',
      fields: {
        'client_ref': clientRef,
        'entity_type': row['entity_type'] as String,
        'entity_id': row['entity_id'] as String,
        if (row['kind'] != null) 'kind': row['kind'] as String,
        if (row['project_id'] != null) 'project_id': row['project_id'] as String,
        if (row['original_filename'] != null)
          'original_filename': row['original_filename'] as String,
      },
      filePath: localPath,
    );

    if (res.success) {
      // 200 (duplicate:true) and 201 both mean "stored, here is the id" —
      // treated identically apart from telemetry (xprojman-23 §1).
      final docId = res.data['document_id']?.toString();
      await _db.update('upload_queue', {
        'status': 'stored',
        'document_id': docId,
        'last_error': null,
        'uploaded_at': DateTime.now().millisecondsSinceEpoch,
        'mime_type': res.data['mime_type']?.toString() ?? row['mime_type'],
        'size_bytes': res.data['size_bytes'] ?? row['size_bytes'],
      }, where: 'client_ref = ?', whereArgs: [clientRef]);
      if (docId != null && docId != clientRef) {
        await _swapCacheId(row, clientRef, docId);
      }
      return _Outcome.uploaded;
    }

    // A status of 0 = transport failure (offline/timeout); 429/5xx = retry
    // later; any other 4xx is permanent (e.g. 413 FILE_TOO_LARGE — shouldn't
    // occur, we pre-check — or a validation error). 401 never lands here: the
    // transport already refreshed-and-retried it.
    final transient = res.status == 0 || res.status == 429 || res.status >= 500;
    await _db.update('upload_queue', {
      'status': transient ? 'failed' : 'error',
      'attempts': (row['attempts'] as int? ?? 0) + 1,
      'last_error': '${res.status} ${res.code ?? ''} ${res.message ?? ''}'.trim(),
    }, where: 'client_ref = ?', whereArgs: [clientRef]);
    return transient ? _Outcome.retryLater : _Outcome.permanent;
  }

  // ── Display / source of truth ────────────────────────────────────────────────

  /// The documents for an owning row, merging local-pending queue rows with the
  /// server's authoritative list (`GET /documents?entity_type=&entity_id=`,
  /// xprojman-21 §P2). Un-uploaded captures show from the local file; uploaded
  /// ones prefer the local cache and fall back to a stream. Offline, this
  /// returns just the local queue rows. Ordered newest-first to match the
  /// server's stable `created_at DESC, id DESC` (xprojman-23 §3b).
  Future<List<DocRef>> listFor(String entityType, String entityId) async {
    final local = await _db.query('upload_queue',
        where: 'entity_type = ? AND entity_id = ?',
        whereArgs: [entityType, entityId],
        orderBy: 'created_at DESC');

    final byDocId = <String, Map<String, Object?>>{
      for (final r in local)
        if (r['document_id'] != null) r['document_id'] as String: r,
    };

    final out = <DocRef>[];
    final seen = <String>{};

    // Server list first (authoritative + newest-first). A doc we uploaded shows
    // from its cached local file; anyone else's streams on demand.
    final res = await NexusService.authedGet(
        '/documents?entity_type=$entityType&entity_id=$entityId');
    if (res.success) {
      final docs = (res.data['documents'] as List?) ?? const [];
      for (final d in docs.cast<Map<String, dynamic>>()) {
        final id = d['document_id']?.toString();
        if (id == null) continue;
        seen.add(id);
        final localRow = byDocId[id];
        out.add(DocRef(
          documentId: id,
          clientRef: localRow?['client_ref'] as String?,
          localPath: localRow?['local_path'] as String?,
          kind: d['kind']?.toString(),
          mimeType: d['mime_type']?.toString(),
          status: 'stored',
        ));
      }
    }

    // Then queue rows the server list didn't cover: still-pending captures, and
    // (when offline) everything we hold locally.
    for (final r in local) {
      final docId = r['document_id'] as String?;
      final ref = r['client_ref'] as String;
      if (docId != null && seen.contains(docId)) continue;
      out.add(DocRef(
        documentId: docId,
        clientRef: ref,
        localPath: r['local_path'] as String?,
        kind: r['kind']?.toString(),
        mimeType: r['mime_type']?.toString(),
        status: r['status'] as String? ?? 'pending',
      ));
    }
    return out;
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  /// Delete a document by cache id (`client_ref` or `document_id`). A
  /// not-yet-uploaded capture drops locally (queue row + file). An uploaded one
  /// soft-deletes server-side (`DELETE /documents/:id`) then drops the local
  /// row/file. The owning-row cache entry is removed either way. Returns false
  /// if the server delete was attempted and failed (caller may keep the entry).
  Future<bool> deleteDoc({
    required String entityType,
    required String entityId,
    required String idOrRef,
  }) async {
    final rows = await _db.query('upload_queue',
        where: 'client_ref = ? OR document_id = ?',
        whereArgs: [idOrRef, idOrRef],
        limit: 1);
    final row = rows.isEmpty ? null : rows.first;

    // The server id to soft-delete: the queue row's `document_id`, or — when
    // there is no local row at all — `idOrRef` itself (a doc uploaded on the web
    // / another device that only appears via the server list).
    final docId = (row?['document_id'] as String?) ?? (row == null ? idOrRef : null);

    if (docId != null) {
      final res = await NexusService.authedDelete('/documents/$docId');
      // 404 = already gone → treat as deleted, drop it locally too.
      if (!res.success && res.status != 404) return false;
    }

    if (row != null) {
      final path = row['local_path'] as String?;
      if (path != null) {
        final f = File(path);
        if (await f.exists()) await f.delete();
      }
      await _db.delete('upload_queue',
          where: 'client_ref = ?', whereArgs: [row['client_ref']]);
    }
    await _removeCacheId(
        entityType, entityId, (row?['client_ref'] as String?) ?? idOrRef, docId);
    return true;
  }

  // ── Owning-row cache helpers (denormalised display cache) ─────────────────────
  // These keep the plural cache columns coherent so quick counts/thumbnails read
  // right. They are a LOCAL cache only — the server list is the source of truth
  // (xprojman-21 §P2) — so they never set is_dirty (a cache swap is not a
  // domain edit to push).

  Future<void> _swapCacheId(
      Map<String, Object?> row, String clientRef, String docId) async {
    final target = _cacheTarget[row['entity_type']];
    if (target == null) return;
    final (table, idCol, cols) = target;
    await _rewriteCache(table, idCol, row['entity_id'] as String, cols,
        (list) => list.map((e) => e == clientRef ? docId : e).toList());
  }

  Future<void> _removeCacheId(
      String entityType, String entityId, String clientRef, String? docId) async {
    final target = _cacheTarget[entityType];
    if (target == null) return;
    final (table, idCol, cols) = target;
    await _rewriteCache(table, idCol, entityId, cols,
        (list) => list.where((e) => e != clientRef && e != docId).toList());
  }

  Future<void> _rewriteCache(String table, String idCol, String entityId,
      List<String> cols, List<String> Function(List<String>) transform) async {
    final rows = await _db.query(table,
        columns: cols, where: '$idCol = ?', whereArgs: [entityId], limit: 1);
    if (rows.isEmpty) return;
    final update = <String, Object?>{};
    for (final col in cols) {
      final raw = rows.first[col] as String?;
      if (raw == null || raw.isEmpty) continue;
      final list = (jsonDecode(raw) as List).map((e) => e.toString()).toList();
      final next = transform(list);
      if (!listEquals(next, list)) update[col] = jsonEncode(next);
    }
    if (update.isNotEmpty) {
      await _db.update(table, update, where: '$idCol = ?', whereArgs: [entityId]);
    }
  }

  // ── LRU prune (decision #3) ───────────────────────────────────────────────────

  Future<void> _touch(String idOrRef) => _db.update(
        'upload_queue',
        {'last_access_at': DateTime.now().millisecondsSinceEpoch},
        where: 'client_ref = ? OR document_id = ?',
        whereArgs: [idOrRef, idOrRef],
      );

  /// Evict oldest-accessed UPLOADED files until the on-disk cache is under
  /// [lruCapBytes]. Only `stored` rows are eligible — a pending/failed capture's
  /// file is the only copy and must never be pruned. The queue row survives the
  /// eviction (keeps the `document_id`); only the file is removed, and it
  /// re-fetches on demand.
  Future<void> _pruneLru() async {
    final rows = await _db.query('upload_queue',
        columns: ['client_ref', 'local_path', 'size_bytes'],
        where: "status = 'stored' AND local_path IS NOT NULL",
        orderBy: 'last_access_at DESC');
    var total = 0;
    for (final r in rows) {
      total += (r['size_bytes'] as int?) ?? 0;
    }
    if (total <= lruCapBytes) return;
    // Walk oldest-first (reverse of the DESC scan) evicting until under cap.
    for (final r in rows.reversed) {
      if (total <= lruCapBytes) break;
      final path = r['local_path'] as String?;
      if (path == null) continue;
      final f = File(path);
      if (await f.exists()) await f.delete();
      await _db.update('upload_queue', {'local_path': null},
          where: 'client_ref = ?', whereArgs: [r['client_ref']]);
      total -= (r['size_bytes'] as int?) ?? 0;
    }
  }

  String _extFor(String? filename) {
    if (filename == null) return '';
    final dot = filename.lastIndexOf('.');
    return dot >= 0 ? filename.substring(dot) : '';
  }

  @visibleForTesting
  void disposeForTest() {
    _connSub?.cancel();
    _connSub = null;
    _started = false;
  }
}

enum _Outcome { uploaded, retryLater, permanent }

/// A displayable document reference — the merge of the local queue and the
/// server list from [DocumentQueueService.listFor]. Render [localPath] when it
/// is non-null and on disk; otherwise stream by [documentId].
class DocRef {
  final String? documentId;
  final String? clientRef;
  final String? localPath;
  final String? kind;
  final String? mimeType;
  final String status; // pending | uploading | stored | failed | error

  const DocRef({
    this.documentId,
    this.clientRef,
    this.localPath,
    this.kind,
    this.mimeType,
    required this.status,
  });

  bool get isUploaded => status == 'stored' && documentId != null;
  bool get isPending => status == 'pending' || status == 'uploading';
  String get id => documentId ?? clientRef ?? '';
}

/// Thrown by [DocumentQueueService.enqueue] when a capture exceeds the server's
/// 25 MB ceiling (xprojman-23 §4) — refused at the door rather than queued to
/// fail with a 413.
class DocumentTooLargeException implements Exception {
  final int sizeBytes;
  const DocumentTooLargeException(this.sizeBytes);
  @override
  String toString() =>
      'DocumentTooLargeException: ${(sizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB '
      'exceeds the ${DocumentQueueService.maxUploadBytes ~/ (1024 * 1024)} MB limit';
}
