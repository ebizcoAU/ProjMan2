import 'nexus_service.dart';

/// Thin client over the generic sync transport (projman-01 §3, routes/sync.js):
///   push  { table_name, operation, data, local_id }  →  { server_id, applied }
///   pull  ?since=`unix ms`                             →  { last_sync_at, changes[] }
///
/// Reuses [NexusService]'s bearer-attach + 401-refresh-and-retry plumbing rather
/// than re-implementing HTTP — this is the missing client half of the sync
/// contract the P5 site-ops tables (`site_diary`/`site_attendance`/`deliveries`,
/// servdesignspec §11.9) are built against; no REST writers exist for them.
class SyncClient {
  static Future<ApiResult> push({
    required String table,
    required String operation,
    required Map<String, dynamic> data,
    required String localId,
  }) =>
      NexusService.authedPost('/sync/push', {
        'table_name': table,
        'operation': operation,
        'data': data,
        'local_id': localId,
      });

  /// [since] is the last cursor (unix ms) this device applied; 0 pulls everything
  /// the session can see. The response spans every pull-enabled table, not just
  /// the caller's — callers filter to the tables they mirror locally.
  static Future<ApiResult> pull({int since = 0}) =>
      NexusService.authedGet('/sync/pull?since=$since');
}
