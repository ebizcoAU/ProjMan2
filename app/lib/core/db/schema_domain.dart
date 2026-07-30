/// ProjMan2 domain schema — P5 site operations, local mirror of migration_v008
/// (servdesignspecification.md §11). Column names match the server's MySQL
/// tables exactly (projman-01 §3.2 tolerant-reader convention) so a pulled row
/// applies via `DatabaseService.filterToTableColumns` with no translation.
///
/// Extra local-only bookkeeping beyond the wire columns (schema_core.dart's
/// is_dirty/last_sync_at convention, plus two site-ops-specific additions):
///   is_dirty     — this row has app-side changes not yet acknowledged by the server
///   pending_op   — 'create' | 'update' queued for the next push (retry after is_dirty)
///   ever_synced  — this id has been successfully created server-side at least once,
///                  so a later edit must push as 'update', never 'create' (NOT_FOUND)
class DomainSchema {
  // ── site_diary — the legal record (append-only; §11.4) ─────────────────────
  static const String siteDiary = '''
    CREATE TABLE IF NOT EXISTS site_diary (
      id                TEXT PRIMARY KEY NOT NULL,
      org_id            TEXT,
      project_id        TEXT NOT NULL,
      entry_date        TEXT NOT NULL,
      version           INTEGER DEFAULT 1,
      supersedes_id     TEXT,
      is_current        INTEGER DEFAULT 1,
      status            TEXT DEFAULT 'draft',
      weather           TEXT,
      temp_c            REAL,
      headcount         INTEGER,
      work_done         TEXT,
      delays            TEXT,
      delay_cause       TEXT,
      notes             TEXT,
      photo_ids         TEXT,
      author_id         TEXT,
      finalised_at      TEXT,
      finalised_by      TEXT,
      device_id         TEXT,
      is_deleted        INTEGER DEFAULT 0,
      is_dirty          INTEGER DEFAULT 0,
      pending_op        TEXT,
      ever_synced       INTEGER DEFAULT 0,
      created_at        INTEGER,
      updated_at        INTEGER,
      server_updated_at INTEGER,
      last_sync_at      INTEGER
    )
  ''';

  // ── site_attendance — one-tap muster + server-derived geofence verdict ─────
  static const String siteAttendance = '''
    CREATE TABLE IF NOT EXISTS site_attendance (
      id                TEXT PRIMARY KEY NOT NULL,
      org_id            TEXT,
      project_id        TEXT NOT NULL,
      person_id         TEXT,
      person_name       TEXT,
      person_type       TEXT DEFAULT 'staff',
      trade             TEXT,
      check_in_at       TEXT,
      check_out_at      TEXT,
      check_in_lat      REAL,
      check_in_lng      REAL,
      method            TEXT DEFAULT 'self',
      geo_verified      INTEGER,
      induction_ok      INTEGER,
      device_id         TEXT,
      is_deleted        INTEGER DEFAULT 0,
      is_dirty          INTEGER DEFAULT 0,
      pending_op        TEXT,
      ever_synced       INTEGER DEFAULT 0,
      created_at        INTEGER,
      updated_at        INTEGER,
      server_updated_at INTEGER,
      last_sync_at      INTEGER
    )
  ''';

  // ── deliveries — the delivery-proof evidence record ─────────────────────────
  static const String deliveries = '''
    CREATE TABLE IF NOT EXISTS deliveries (
      id                TEXT PRIMARY KEY NOT NULL,
      org_id            TEXT,
      project_id        TEXT NOT NULL,
      supplier_id       TEXT,
      supplier_name     TEXT,
      po_id             TEXT,
      po_reference      TEXT,
      received_at       TEXT NOT NULL,
      docket_no         TEXT,
      photo_ids         TEXT,
      notes             TEXT,
      received_by       TEXT,
      device_id         TEXT,
      is_deleted        INTEGER DEFAULT 0,
      is_dirty          INTEGER DEFAULT 0,
      pending_op        TEXT,
      ever_synced       INTEGER DEFAULT 0,
      created_at        INTEGER,
      updated_at        INTEGER,
      server_updated_at INTEGER,
      last_sync_at      INTEGER
    )
  ''';

  // ── inspections — a checklist run against a stage (P6a, servdesignspec §12) ─
  // Completing a HOLD-POINT inspection with a pass drives the stage's
  // is_validated via the existing StageProgressionService.validate — that flip
  // is REST-only (POST …/complete); `inspector_id`/`completed_at` are
  // PROTECTED and only ever arrive back here via a pull, never a local write.
  static const String inspections = '''
    CREATE TABLE IF NOT EXISTS inspections (
      id                TEXT PRIMARY KEY NOT NULL,
      org_id            TEXT,
      project_id        TEXT NOT NULL,
      stage_id          TEXT,
      type              TEXT,
      is_hold_point     INTEGER DEFAULT 0,
      scheduled_at      TEXT,
      inspector_id      TEXT,
      result            TEXT DEFAULT 'pending',
      completed_at      TEXT,
      reference         TEXT,
      document_id       TEXT,
      notes             TEXT,
      device_id         TEXT,
      is_deleted        INTEGER DEFAULT 0,
      is_dirty          INTEGER DEFAULT 0,
      pending_op        TEXT,
      ever_synced       INTEGER DEFAULT 0,
      created_at        INTEGER,
      updated_at        INTEGER,
      server_updated_at INTEGER,
      last_sync_at      INTEGER
    )
  ''';

  // ── inspection_items — checklist lines. NO project_id (§12.9): scopes ──────
  // through the parent `inspections` row — the server resolves it, the client
  // never sends one.
  static const String inspectionItems = '''
    CREATE TABLE IF NOT EXISTS inspection_items (
      id                TEXT PRIMARY KEY NOT NULL,
      org_id            TEXT,
      inspection_id     TEXT NOT NULL,
      seq               INTEGER DEFAULT 0,
      description       TEXT,
      result            TEXT DEFAULT 'pending',
      note              TEXT,
      photo_id          TEXT,
      device_id         TEXT,
      is_deleted        INTEGER DEFAULT 0,
      is_dirty          INTEGER DEFAULT 0,
      pending_op        TEXT,
      ever_synced       INTEGER DEFAULT 0,
      created_at        INTEGER,
      updated_at        INTEGER,
      server_updated_at INTEGER,
      last_sync_at      INTEGER
    )
  ''';

  // ── defects — the punch-list (P6a) ──────────────────────────────────────────
  // `raised_by`/`raised_at`/`closed_at`/`closed_by` are PROTECTED (server-stamped
  // by QualityOpsService.afterPush); `status` is unprotected (the app pushes
  // open/in_progress/closed transitions).
  static const String defects = '''
    CREATE TABLE IF NOT EXISTS defects (
      id                TEXT PRIMARY KEY NOT NULL,
      org_id            TEXT,
      project_id        TEXT NOT NULL,
      stage_id          TEXT,
      raised_by         TEXT,
      raised_at         TEXT,
      location          TEXT,
      trade             TEXT,
      description       TEXT,
      assigned_to       TEXT,
      assigned_to_name  TEXT,
      due_date          TEXT,
      severity          TEXT DEFAULT 'medium',
      status            TEXT DEFAULT 'open',
      closed_at         TEXT,
      closed_by         TEXT,
      photo_id          TEXT,
      photo_after_id    TEXT,
      device_id         TEXT,
      is_deleted        INTEGER DEFAULT 0,
      is_dirty          INTEGER DEFAULT 0,
      pending_op        TEXT,
      ever_synced       INTEGER DEFAULT 0,
      created_at        INTEGER,
      updated_at        INTEGER,
      server_updated_at INTEGER,
      last_sync_at      INTEGER
    )
  ''';

  // ── certificates — statutory documents + expiry (P6a). App + web owned; no ──
  // protected columns — the app writes every field (servdesignspec §12.7).
  static const String certificates = '''
    CREATE TABLE IF NOT EXISTS certificates (
      id                TEXT PRIMARY KEY NOT NULL,
      org_id            TEXT,
      project_id        TEXT NOT NULL,
      stage_id          TEXT,
      type              TEXT,
      reference         TEXT,
      issued_by         TEXT,
      issued_at         TEXT,
      expires_at        TEXT,
      document_id       TEXT,
      notes             TEXT,
      device_id         TEXT,
      is_deleted        INTEGER DEFAULT 0,
      is_dirty          INTEGER DEFAULT 0,
      pending_op        TEXT,
      ever_synced       INTEGER DEFAULT 0,
      created_at        INTEGER,
      updated_at        INTEGER,
      server_updated_at INTEGER,
      last_sync_at      INTEGER
    )
  ''';

  // ── disputes — escalation & dispute mechanism (appdesignspecification.md §2.7)
  // Local-only for now: no server table/endpoint exists yet (the `disputes`
  // permission strings in serverdesignspecification.md §7.2 are speculative,
  // not yet wired to any route), so this does NOT ride `/sync/push` — writes
  // stay on-device until the server ships a registry entry for this table.
  // `is_dirty`/`pending_op`/`ever_synced` are carried anyway so wiring sync
  // later is a registry change, not a schema rework — same convention as
  // every other domain table.
  static const String disputes = '''
    CREATE TABLE IF NOT EXISTS disputes (
      id                      TEXT PRIMARY KEY NOT NULL,
      project_id              TEXT,
      subject_type            TEXT NOT NULL,
      subject_id               TEXT NOT NULL,
      subject_label            TEXT,
      raised_by                TEXT,
      raised_by_name           TEXT,
      reason                   TEXT NOT NULL,
      counter_evidence_photo_id TEXT,
      status                   TEXT DEFAULT 'open',
      resolution_note          TEXT,
      resolved_by              TEXT,
      resolved_by_name         TEXT,
      resolved_at              TEXT,
      device_id                TEXT,
      is_deleted               INTEGER DEFAULT 0,
      is_dirty                 INTEGER DEFAULT 0,
      pending_op               TEXT,
      ever_synced              INTEGER DEFAULT 0,
      created_at               INTEGER,
      updated_at                INTEGER,
      server_updated_at         INTEGER,
      last_sync_at              INTEGER
    )
  ''';

  /// v2 upgrade step (P5, servdesignspec §11).
  static const List<String> v2 = [siteDiary, siteAttendance, deliveries];

  /// v3 upgrade step (P6a, servdesignspec §12).
  static const List<String> v3 = [
    inspections, inspectionItems, defects, certificates,
  ];

  /// v4 upgrade step (appdesignspecification.md §2.7 — dispute mechanism).
  static const List<String> v4 = [disputes];

  static const List<String> all = [...v2, ...v3, ...v4];
}
