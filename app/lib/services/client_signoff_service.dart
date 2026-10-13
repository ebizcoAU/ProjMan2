import 'dart:async';
import 'dart:convert';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import 'db_service.dart';
import 'document_queue_service.dart';
import 'nexus_service.dart';
import 'permissions_service.dart';
import 'sync_client.dart';

/// S18.14 — client final sign-off of the handover pack (xprojman-51; Server
/// §6 and its v050 build note). **Wired to sync** against server v050.
///
/// - `handover_packs` is pull-only, one row per project, present once the
///   project has any handover document. The app **never computes the hash**:
///   it shows the server's, with the first 8 hex characters as the reference.
///   Signing is gated on Stage 18's S18.3 being validated (the screen checks;
///   the server answers `OC_NOT_VALIDATED`).
/// - `client_signoffs` is create-only and frozen on arrival. The app pushes
///   `assisted_device` only (paper is a Portal upload; `client_self` needs
///   customer accounts). The server stamps `witnessed_by`, `frozen_at`,
///   `counted`, `method`.
/// - **Signature first:** the image uploads (`entity_type 'client_signoff'`),
///   then the row is pushed with `signature_document_id`.
/// - `PACK_CHANGED`: the server stores the row uncounted. The app shows that
///   the pack changed and asks for a new signature with `supersedes_id`. It
///   **never re-signs silently**. A retried create that already landed is
///   acknowledged (`applied: false`), so it counts as success.
///
/// Legal: which method is used is still with the solicitor (xprojman-51 F1,
/// devroadmap §13 L2), so the screens present no method as the default.
enum SignoffMethod {
  assistedDevice('assisted_device', 'Client signs on this device'),
  paperUpload('paper_upload', 'Paper form'),
  clientSelf('client_self', 'Client signs in their own app');

  final String wire;
  final String label;
  const SignoffMethod(this.wire, this.label);

  static SignoffMethod fromWire(Object? w) => SignoffMethod.values
      .firstWhere((m) => m.wire == w, orElse: () => SignoffMethod.assistedDevice);
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

  Map<String, Object?> toJson() =>
      {'document_id': documentId, 'kind': kind, 'file_name': fileName, 'sha256': sha256};

  static PackDocument fromJson(Map<String, dynamic> j) => PackDocument(
        documentId: j['document_id']?.toString() ?? '',
        kind: j['kind']?.toString() ?? '',
        fileName: j['file_name']?.toString() ?? 'Document',
        sha256: j['sha256']?.toString() ?? '',
      );
}

class HandoverPack {
  final String projectId;
  final String packHash;
  final List<PackDocument> manifest;
  final DateTime? computedAt;
  const HandoverPack({
    required this.projectId,
    required this.packHash,
    required this.manifest,
    this.computedAt,
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

  /// Server-set once it has the row: did `pack_hash` match on arrival?
  /// Null while the row is still on this device.
  final bool? counted;
  final bool isSynced;
  final String? syncError;
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
    this.counted,
    this.isSynced = false,
    this.syncError,
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

/// Codes after which the row stays queued and is tried again.
const _retryCodes = {'SIGNATURE_MISSING', 'OC_NOT_VALIDATED', 'PACK_EMPTY'};

class ClientSignoffService {
  ClientSignoffService._();
  static final ClientSignoffService instance = ClientSignoffService._();

  final DatabaseService _db = DatabaseService();
  final Map<String, HandoverPack?> _packs = {};
  final Map<String, List<ClientSignoff>> _signoffs = {};
  final ValueNotifier<int> changes = ValueNotifier(0);

  static const _pushCols = [
    'project_id', 'step_code', 'pack_hash', 'manifest', 'decision',
    'decline_reasons', 'signer_name', 'signed_at', 'signature_document_id',
    'supersedes_id', 'updated_at',
  ];

  /// Test seams: stand in for the network and the upload queue.
  @visibleForTesting
  Future<ApiResult> Function(String op, Map<String, Object?> data, String id)? pushForTest;
  @visibleForTesting
  Future<ApiResult> Function(int since)? pullForTest;
  @visibleForTesting
  Future<String> Function(String signoffId, Uint8List png, String projectId)? enqueueForTest;
  @visibleForTesting
  Future<String?> Function(String signoffId)? storedDocForTest;
  @visibleForTesting
  Future<({int waiting, int failed})> Function(String signoffId)? uploadStateForTest;

  bool _wired = false;
  bool _flushing = false;
  bool _flushAgain = false;
  Completer<void>? _inFlight;
  StreamSubscription<List<ConnectivityResult>>? _connSub;

  /// `handover.witness` (projectManager, server v050).
  bool get canWitness => PermissionsService.instance.has('handover.witness');

  void ensureWired() {
    if (_wired) return;
    _wired = true;
    _connSub = Connectivity().onConnectivityChanged.listen((r) {
      if (r.any((x) => x != ConnectivityResult.none)) unawaited(sync());
    });
    DocumentQueueService.instance.addUploadListener((type) {
      if (type == 'client_signoff') unawaited(sync());
    });
  }

  @visibleForTesting
  void resetForTest() {
    _packs.clear();
    _signoffs.clear();
    _connSub?.cancel();
    _wired = false;
    pushForTest = null;
    pullForTest = null;
    enqueueForTest = null;
    storedDocForTest = null;
    uploadStateForTest = null;
  }

  /// For widget tests: put a pack in the cache without a database.
  @visibleForTesting
  void seedForTest(HandoverPack pack) {
    _packs[pack.projectId] = pack;
    _signoffs[pack.projectId] ??= [];
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /// The project's pack, or null while it has no handover documents.
  HandoverPack? packFor(String projectId) => _packs[projectId];

  /// Newest first.
  List<ClientSignoff> signoffs(String projectId) =>
      List.unmodifiable((_signoffs[projectId] ?? const []).reversed);

  /// The latest sign-off that nothing supersedes.
  ClientSignoff? _latest(String projectId) {
    final list = _signoffs[projectId] ?? const [];
    final superseded = {for (final s in list) ?s.supersedesId};
    for (final s in list.reversed) {
      if (!superseded.contains(s.id)) return s;
    }
    return null;
  }

  /// The sign-off that satisfies S18.14: the latest one, accepted, against
  /// the current pack, and not refused as stale by the server (x51 trigger).
  ClientSignoff? current(String projectId) {
    final s = _latest(projectId);
    final pack = packFor(projectId);
    if (s == null || pack == null) return null;
    if (s.decision != SignoffDecision.accepted) return null;
    if (s.packHash != pack.packHash || s.counted == false) return null;
    return s;
  }

  /// The latest sign-off, when the pack changed after it was signed (here
  /// or as `PACK_CHANGED` from the server). The client must sign again.
  ClientSignoff? staleSignoff(String projectId) {
    final s = _latest(projectId);
    final pack = packFor(projectId);
    if (s == null || pack == null) return null;
    return (s.packHash != pack.packHash || s.counted == false) ? s : null;
  }

  // ── Hydration ────────────────────────────────────────────────────────────

  Future<void> hydrateProject(String projectId) async {
    ensureWired();
    await _pullAndApply();
    await reload(projectId);
    unawaited(sync(projectId: projectId));
  }

  Future<void> reload(String projectId) async {
    final packRows = await _db.query('handover_packs',
        where: 'project_id = ? AND is_deleted = 0', whereArgs: [projectId], limit: 1);
    final p = packRows.isEmpty ? null : packRows.first;
    final hash = p?['pack_hash'] as String?;
    _packs[projectId] = (p == null || hash == null || hash.isEmpty)
        ? null
        : HandoverPack(
            projectId: projectId,
            packHash: hash,
            manifest: _decManifest(p['manifest']),
            computedAt: _parseDt(p['computed_at']),
          );
    final rows = await _db.query('client_signoffs',
        where: 'project_id = ? AND is_deleted = 0',
        whereArgs: [projectId],
        orderBy: 'signed_at ASC, created_at ASC');
    _signoffs[projectId] = rows.map(_fromRow).toList();
    changes.value++;
  }

  // ── Write ────────────────────────────────────────────────────────────────

  /// Record an assisted sign-off: the client signs on this device and the
  /// PM witnesses. Returns a refusal code, or null when queued. The new row
  /// supersedes the previous one, if any.
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
    final id = const Uuid().v4();
    final ref = enqueueForTest != null
        ? await enqueueForTest!(id, signaturePng!, projectId)
        : await DocumentQueueService.instance.enqueue(
            entityType: 'client_signoff',
            entityId: id,
            bytes: signaturePng!,
            projectId: projectId,
            originalFilename: 'client-signature.png',
            mimeType: 'image/png',
          );
    final now = DateTime.now();
    await _db.insert('client_signoffs', {
      'id': id,
      'project_id': projectId,
      'step_code': 'S18.14',
      'method': SignoffMethod.assistedDevice.wire,
      'pack_hash': pack.packHash,
      // What the client saw, as pulled. The server keeps it if the pack has
      // moved on, so the record shows exactly what was signed.
      'manifest': jsonEncode([for (final d in pack.manifest) d.toJson()]),
      'decision': decision!.name,
      'decline_reasons':
          decision == SignoffDecision.declined ? declineReasons!.trim() : null,
      'signer_name': signerName.trim(),
      'signed_at': _dtStr(now),
      'supersedes_id': _latest(projectId)?.id,
      'signature_ids': jsonEncode([ref]),
      'is_deleted': 0,
      'is_dirty': 1,
      'pending_op': 'create',
      'ever_synced': 0,
      'created_at': _dtStr(now),
      'updated_at': now.millisecondsSinceEpoch,
    });
    await reload(projectId);
    unawaited(sync(projectId: projectId));
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
        for (final p in {?projectId, ..._signoffs.keys}) {
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
    for (final r in await _db.query('client_signoffs',
        where: 'is_dirty = 1', orderBy: 'signed_at ASC')) {
      final id = r['id'] as String;

      // 1. The signature document must be on the server first.
      final docId = storedDocForTest != null
          ? await storedDocForTest!(id)
          : await DocumentQueueService.instance
              .storedDocumentIdFor('client_signoff', id);
      if (docId == null) {
        final st = uploadStateForTest != null
            ? await uploadStateForTest!(id)
            : await DocumentQueueService.instance.uploadStateFor('client_signoff', [id]);
        if (st.failed > 0) await _setError(id, 'UPLOAD_FAILED');
        continue; // waiting for the upload; its listener re-runs sync
      }

      // 2. Then the row, create-only.
      final data = {
        for (final c in _pushCols) c: r[c],
        'signature_document_id': docId,
      };
      ApiResult res;
      try {
        res = pushForTest != null
            ? await pushForTest!('create', data, id)
            : await SyncClient.push(
                table: 'client_signoffs', operation: 'create', data: data, localId: id);
      } catch (e) {
        debugPrint('[ClientSignoff] push $id failed: $e — kept queued');
        return false;
      }
      if (res.success) {
        await _db.update('client_signoffs', {
          'is_dirty': 0,
          'pending_op': null,
          'ever_synced': 1,
          'signature_document_id': docId,
          'sync_error': null,
        }, where: 'id = ?', whereArgs: [id]);
        continue;
      }
      if (res.status == 0 || res.status == 429 || res.status >= 500) return false;
      final code = res.code ?? 'ERROR';
      debugPrint('[ClientSignoff] $id refused: $code');
      if (code == 'PACK_CHANGED') {
        // Stored on the server, but not counted. Show it as stale and ask the
        // client to sign the new pack. Never re-sign silently.
        await _db.update('client_signoffs', {
          'is_dirty': 0,
          'pending_op': null,
          'ever_synced': 1,
          'counted': 0,
          'signature_document_id': docId,
          'sync_error': code,
        }, where: 'id = ?', whereArgs: [id]);
      } else if (_retryCodes.contains(code)) {
        await _setError(id, code);
      } else {
        // Terminal (SIGNOFF_FROZEN, FORBIDDEN, VALIDATION_ERROR…).
        await _db.update('client_signoffs',
            {'is_dirty': 0, 'pending_op': null, 'sync_error': code},
            where: 'id = ?', whereArgs: [id]);
      }
    }
    return true;
  }

  Future<void> _setError(String id, String code) => _db.update(
      'client_signoffs', {'sync_error': code}, where: 'id = ?', whereArgs: [id]);

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
        if (table != 'handover_packs' && table != 'client_signoffs') continue;
        final data = Map<String, Object?>.from(c['data'] as Map? ?? const {});
        data['id'] ??= c['local_id']?.toString();
        if (data['id'] == null) continue;
        await applyPulledRow(table!, data);
      }
      final lastSync = res.data['last_sync_at'];
      final next = lastSync is int
          ? lastSync
          : int.tryParse(lastSync?.toString() ?? '') ?? since;
      await _setCursor(next);
    } catch (e) {
      debugPrint('[ClientSignoff] pull failed: $e');
    }
  }

  @visibleForTesting
  Future<void> applyPulledRow(String table, Map<String, Object?> data) async {
    final id = data['id'].toString();
    final existing = await _db.query(table, where: 'id = ?', whereArgs: [id], limit: 1);
    if (table == 'client_signoffs' &&
        existing.isNotEmpty &&
        ((existing.first['is_dirty'] as int?) ?? 0) == 1) {
      return;
    }
    final m = data['manifest'];
    if (m != null && m is! String) data['manifest'] = jsonEncode(m);
    for (final k in const ['counted', 'is_deleted']) {
      final v = data[k];
      if (v is bool) data[k] = v ? 1 : 0;
    }
    final filtered = await _db.filterToTableColumns(table, data);
    filtered.remove('signature_ids');
    filtered['id'] = id;
    if (table == 'client_signoffs') {
      filtered
        ..['is_dirty'] = 0
        ..['pending_op'] = null
        ..['ever_synced'] = 1;
      // The server's copy settles it: a counted row clears a stale code.
      if (data['counted'] == 1) filtered['sync_error'] = null;
    }
    if (existing.isEmpty) {
      await _db.insert(table, filtered);
    } else {
      await _db.update(table, filtered, where: 'id = ?', whereArgs: [id]);
    }
  }

  static const _cursorKey = 'handover_pull_cursor';

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

  static ClientSignoff _fromRow(Map<String, Object?> r) => ClientSignoff(
        id: r['id'] as String,
        projectId: r['project_id'] as String,
        method: SignoffMethod.fromWire(r['method']),
        packHash: (r['pack_hash'] as String?) ?? '',
        manifest: _decManifest(r['manifest']),
        decision: r['decision'] == 'declined'
            ? SignoffDecision.declined
            : SignoffDecision.accepted,
        declineReasons: r['decline_reasons'] as String?,
        signerName: (r['signer_name'] as String?) ?? '',
        signedAt: _parseDt(r['signed_at']) ?? DateTime.now(),
        supersedesId: r['supersedes_id'] as String?,
        counted: r['counted'] == null ? null : (r['counted'] as int) == 1,
        isSynced: ((r['ever_synced'] as int?) ?? 0) == 1 &&
            ((r['is_dirty'] as int?) ?? 0) == 0,
        syncError: r['sync_error'] as String?,
      );

  static List<PackDocument> _decManifest(Object? raw) {
    if (raw == null) return const [];
    try {
      final list = raw is String ? jsonDecode(raw) : raw;
      return [
        for (final e in list as List) PackDocument.fromJson(Map<String, dynamic>.from(e as Map)),
      ];
    } catch (_) {
      return const [];
    }
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
}
