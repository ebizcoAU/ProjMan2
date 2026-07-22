import 'dart:async';

/// App-level broadcast channels for cross-widget data-change notifications.
/// Emitted after a successful incremental sync pull; UI layers subscribe and
/// reload on receipt. Ported from ftpos `services/sync_events.dart`; the F&B
/// `roomsUpdated` channel is dropped, `businessUpdated` becomes `orgUpdated`.
class SyncEvents {
  SyncEvents._();

  /// Fires when a sync pull writes updated rows to `organisations`.
  static final StreamController<void> orgUpdated =
      StreamController<void>.broadcast();

  /// Fires when project/stage/task rows change — the Projects tab reloads.
  static final StreamController<void> projectsUpdated =
      StreamController<void>.broadcast();
}
