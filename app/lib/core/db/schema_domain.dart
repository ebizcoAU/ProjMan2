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
      photo_ids         TEXT,
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
      photo_ids         TEXT,
      photo_after_ids   TEXT,
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
      document_ids      TEXT,
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
      counter_evidence_photo_ids TEXT,
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

  // ── upload_queue — the one offline document/image queue (xprojman-22 §2) ────
  // Files live on the filesystem (app-documents dir); this holds only metadata.
  // ONE queue behind all five capture surfaces (inspection_item / defect /
  // certificate / site_diary / delivery). `client_ref` is the app-minted uuid
  // that is BOTH the stable offline handle and the server's idempotency key
  // (xprojman-21/23: idempotent on (org_id, client_ref)); `document_id` is the
  // server-minted id, filled once uploaded. `(entity_type, entity_id, kind)`
  // mirrors the server's `documents` row exactly so enqueue → POST is a field
  // copy, and `entity_id` = the OWNING row's app UUID makes the link order-free.
  static const String uploadQueue = '''
    CREATE TABLE IF NOT EXISTS upload_queue (
      client_ref        TEXT PRIMARY KEY NOT NULL,
      local_path        TEXT NOT NULL,
      kind              TEXT NOT NULL,
      entity_type       TEXT NOT NULL,
      entity_id         TEXT NOT NULL,
      project_id        TEXT,
      original_filename TEXT,
      mime_type         TEXT,
      size_bytes        INTEGER,
      document_id       TEXT,
      status            TEXT DEFAULT 'pending',
      attempts          INTEGER DEFAULT 0,
      last_error        TEXT,
      created_at        INTEGER,
      uploaded_at       INTEGER,
      last_access_at    INTEGER
    )
  ''';

  // ── Checklists (migration_v047, xprojman-46) ────────────────────────────────
  // Templates are Portal-authored and PULL-ONLY here (owner `web`). The app lists
  // published ones only; unpublished rows still arrive so an unpublish is seen.
  static const String checklistTemplates = '''
    CREATE TABLE IF NOT EXISTS checklist_templates (
      id                TEXT PRIMARY KEY NOT NULL,
      org_id            TEXT,
      name              TEXT,
      category          TEXT,
      target_role       TEXT,
      description       TEXT,
      is_published      INTEGER DEFAULT 0,
      is_deleted        INTEGER DEFAULT 0,
      created_at        TEXT,
      updated_at        INTEGER,
      server_updated_at TEXT
    )
  ''';

  static const String checklistTemplateItems = '''
    CREATE TABLE IF NOT EXISTS checklist_template_items (
      id                TEXT PRIMARY KEY NOT NULL,
      org_id            TEXT,
      template_id       TEXT NOT NULL,
      seq               INTEGER DEFAULT 0,
      label             TEXT,
      is_required       INTEGER DEFAULT 1,
      photo_required    INTEGER DEFAULT 0,
      is_deleted        INTEGER DEFAULT 0,
      created_at        TEXT,
      updated_at        INTEGER,
      server_updated_at TEXT
    )
  ''';

  // An executed checklist. `template_name`/`category`/`result`/`started_by`/
  // `completed_by`/`completed_at` are server-stamped (never pushed), stored here
  // for display. Local-only: `completion_requested` (the user tapped Complete; the
  // `status='completed'` push waits until items, sign-offs and uploads have all
  // synced — xprojman-46 §7 #2), `sync_error` (last terminal/retryable code),
  // `started_by_name` (display only; the server stores ids, not names).
  static const String checklistInstances = '''
    CREATE TABLE IF NOT EXISTS checklist_instances (
      id                   TEXT PRIMARY KEY NOT NULL,
      org_id               TEXT,
      project_id           TEXT NOT NULL,
      template_id          TEXT NOT NULL,
      stage_id             TEXT,
      unit_id              TEXT,
      template_name        TEXT,
      category             TEXT,
      status               TEXT DEFAULT 'in_progress',
      result               TEXT DEFAULT 'pending',
      started_by           TEXT,
      started_by_name      TEXT,
      completed_by         TEXT,
      completed_at         TEXT,
      lat                  REAL,
      lng                  REAL,
      notes                TEXT,
      supersedes_id        TEXT,
      completion_requested INTEGER DEFAULT 0,
      sync_error           TEXT,
      device_id            TEXT,
      is_deleted           INTEGER DEFAULT 0,
      is_dirty             INTEGER DEFAULT 0,
      pending_op           TEXT,
      ever_synced          INTEGER DEFAULT 0,
      created_at           TEXT,
      updated_at           INTEGER,
      server_updated_at    TEXT
    )
  ''';

  // `photo_ids` is the local cache (client_refs → document_ids) the document
  // queue swaps into; photo evidence itself is a `documents` row keyed by this
  // item's id (entity_type 'checklist_item'), never a pushed column.
  static const String checklistInstanceItems = '''
    CREATE TABLE IF NOT EXISTS checklist_instance_items (
      id                TEXT PRIMARY KEY NOT NULL,
      org_id            TEXT,
      instance_id       TEXT NOT NULL,
      seq               INTEGER DEFAULT 0,
      label             TEXT,
      is_required       INTEGER DEFAULT 1,
      photo_required    INTEGER DEFAULT 0,
      result            TEXT DEFAULT 'pending',
      note              TEXT,
      photo_ids         TEXT,
      device_id         TEXT,
      is_deleted        INTEGER DEFAULT 0,
      is_dirty          INTEGER DEFAULT 0,
      pending_op        TEXT,
      ever_synced       INTEGER DEFAULT 0,
      created_at        TEXT,
      updated_at        INTEGER,
      server_updated_at TEXT
    )
  ''';

  // Shared sign-offs (xprojman-48 F6), owned by SignoffStore. `signature_ids` is
  // the local cache for the signature document (entity_type 'signoff').
  static const String signoffs = '''
    CREATE TABLE IF NOT EXISTS signoffs (
      id                TEXT PRIMARY KEY NOT NULL,
      org_id            TEXT,
      subject_type      TEXT NOT NULL,
      subject_id        TEXT NOT NULL,
      project_id        TEXT,
      user_id           TEXT,
      name              TEXT,
      signed_at         TEXT,
      signature_ids     TEXT,
      device_id         TEXT,
      is_deleted        INTEGER DEFAULT 0,
      is_dirty          INTEGER DEFAULT 0,
      pending_op        TEXT,
      ever_synced       INTEGER DEFAULT 0,
      created_at        TEXT,
      updated_at        INTEGER,
      server_updated_at TEXT
    )
  ''';

  // ── Safety/OHS (xprojman-48, server migration_v048) ──────────────────────
  // `raised_by`/`raised_at`/`closed_by`/`closed_at`/`notifiable_confirmed_by`/
  // `notified_at`/`regulator_reference` are server-stamped or Portal-only:
  // stored for display, never pushed. Local-only: `photo_ids` (the queue's
  // cache for `documents` rows with entity_type 'safety_event'), `sync_error`
  // (the last code that stopped this row syncing), `raised_by_name` (display),
  // `has_details` (this device recorded injury details for it, so the UI can
  // say where they went once the outbox row is gone).
  static const String safetyEvents = '''
    CREATE TABLE IF NOT EXISTS safety_events (
      id                      TEXT PRIMARY KEY NOT NULL,
      org_id                  TEXT,
      project_id              TEXT NOT NULL,
      stage_id                TEXT,
      unit_id                 TEXT,
      kind                    TEXT NOT NULL,
      description             TEXT NOT NULL,
      location                TEXT,
      severity                TEXT DEFAULT 'medium',
      status                  TEXT DEFAULT 'open',
      occurred_at             TEXT,
      lat                     REAL,
      lng                     REAL,
      is_notifiable           INTEGER DEFAULT 0,
      notifiable_confirmed_by TEXT,
      notified_at             TEXT,
      regulator_reference     TEXT,
      raised_by               TEXT,
      raised_by_name          TEXT,
      raised_at               TEXT,
      closed_by               TEXT,
      closed_at               TEXT,
      close_note              TEXT,
      photo_ids               TEXT,
      has_details             INTEGER DEFAULT 0,
      sync_error              TEXT,
      device_id               TEXT,
      is_deleted              INTEGER DEFAULT 0,
      is_dirty                INTEGER DEFAULT 0,
      pending_op              TEXT,
      ever_synced             INTEGER DEFAULT 0,
      created_at              TEXT,
      updated_at              INTEGER,
      server_updated_at       TEXT
    )
  ''';

  // Health information (Privacy Act sensitive, xprojman-48 F2). This is an
  // OUTBOX, not a mirror: a row lives here only until its create push is
  // accepted, then it is deleted. The server never sends it back on a pull.
  // Columns are exactly v048's; add no extra free-text injury fields.
  static const String incidentDetails = '''
    CREATE TABLE IF NOT EXISTS incident_details (
      id               TEXT PRIMARY KEY NOT NULL,
      event_id         TEXT NOT NULL,
      injured_user_id  TEXT,
      injured_name     TEXT,
      injury_type      TEXT,
      body_part        TEXT,
      treatment        TEXT,
      lost_time        INTEGER,
      witness_names    TEXT,
      updated_at       INTEGER
    )
  ''';

  static const String safetyActions = '''
    CREATE TABLE IF NOT EXISTS safety_actions (
      id                TEXT PRIMARY KEY NOT NULL,
      org_id            TEXT,
      event_id          TEXT NOT NULL,
      action            TEXT NOT NULL,
      assigned_to       TEXT,
      assigned_to_name  TEXT,
      due_date          TEXT,
      status            TEXT DEFAULT 'open',
      closed_by         TEXT,
      closed_at         TEXT,
      device_id         TEXT,
      is_deleted        INTEGER DEFAULT 0,
      is_dirty          INTEGER DEFAULT 0,
      pending_op        TEXT,
      ever_synced       INTEGER DEFAULT 0,
      created_at        TEXT,
      updated_at        INTEGER,
      server_updated_at TEXT
    )
  ''';

  // Site inductions (xprojman-48 F5, server v048). The inductee is `user_id`
  // (a project member) or `name` (a visitor). `inducted_by` is server-stamped.
  // Created by a safety.manage role; the server derives
  // site_attendance.induction_ok from these rows (warn, never block).
  static const String siteInductions = '''
    CREATE TABLE IF NOT EXISTS site_inductions (
      id                    TEXT PRIMARY KEY NOT NULL,
      org_id                TEXT,
      project_id            TEXT NOT NULL,
      user_id               TEXT,
      name                  TEXT,
      inducted_by           TEXT,
      inducted_at           TEXT NOT NULL,
      expires_at            TEXT,
      checklist_instance_id TEXT,
      sync_error            TEXT,
      device_id             TEXT,
      is_deleted            INTEGER DEFAULT 0,
      is_dirty              INTEGER DEFAULT 0,
      pending_op            TEXT,
      ever_synced           INTEGER DEFAULT 0,
      created_at            TEXT,
      updated_at            INTEGER,
      server_updated_at     TEXT
    )
  ''';

  // Local cache of the project's SWMS register (GET /documents?kind=swms), so
  // a worker can read and sign on at the gate with no signal. Not synced:
  // the documents themselves are Portal-uploaded. `local_path` is the
  // downloaded file, once opened.
  static const String swmsDocuments = '''
    CREATE TABLE IF NOT EXISTS swms_documents (
      id          TEXT PRIMARY KEY NOT NULL,
      project_id  TEXT NOT NULL,
      title       TEXT,
      mime_type   TEXT,
      uploaded_at TEXT,
      local_path  TEXT
    )
  ''';

  // S18.14 client final sign-off (xprojman-51, server migration_v050).
  // `handover_packs` is a pull-only mirror (one row per project, id = project
  // id). The app never computes `pack_hash`; `manifest` is the server's JSON.
  static const String handoverPacks = '''
    CREATE TABLE IF NOT EXISTS handover_packs (
      id                TEXT PRIMARY KEY NOT NULL,
      org_id            TEXT,
      project_id        TEXT NOT NULL,
      pack_hash         TEXT,
      manifest          TEXT,
      document_count    INTEGER DEFAULT 0,
      computed_at       TEXT,
      is_deleted        INTEGER DEFAULT 0,
      updated_at        INTEGER,
      server_updated_at TEXT
    )
  ''';

  // Create-only and frozen on arrival. `witnessed_by`/`frozen_at`/`counted`/
  // `method` are server-stamped (display only). Local-only: `signature_ids`
  // (the queue's cache for the signature document, entity_type
  // 'client_signoff'), `sync_error`.
  static const String clientSignoffs = '''
    CREATE TABLE IF NOT EXISTS client_signoffs (
      id                    TEXT PRIMARY KEY NOT NULL,
      org_id                TEXT,
      project_id            TEXT NOT NULL,
      step_code             TEXT DEFAULT 'S18.14',
      method                TEXT DEFAULT 'assisted_device',
      pack_hash             TEXT NOT NULL,
      manifest              TEXT,
      decision              TEXT NOT NULL,
      decline_reasons       TEXT,
      signer_user_id        TEXT,
      signer_name           TEXT NOT NULL,
      witnessed_by          TEXT,
      signature_document_id TEXT,
      signed_at             TEXT NOT NULL,
      counted               INTEGER,
      frozen_at             TEXT,
      supersedes_id         TEXT,
      signature_ids         TEXT,
      sync_error            TEXT,
      device_id             TEXT,
      is_deleted            INTEGER DEFAULT 0,
      is_dirty              INTEGER DEFAULT 0,
      pending_op            TEXT,
      ever_synced           INTEGER DEFAULT 0,
      created_at            TEXT,
      updated_at            INTEGER,
      server_updated_at     TEXT
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

  /// v5 upgrade step (xprojman-22/23 — the one offline document/image queue).
  /// Fresh installs get the plural cache columns directly (baked into the CREATE
  /// statements above); existing installs are ALTERed in DatabaseManager. This
  /// list only carries the net-new table; the singular→plural column moves are
  /// handled as ALTERs there (SQLite can add but not rename a column in-place).
  static const List<String> v5 = [uploadQueue];

  /// v6 upgrade step (xprojman-46, server migration_v047 — checklists).
  static const List<String> v6 = [
    checklistTemplates, checklistTemplateItems, checklistInstances,
    checklistInstanceItems, signoffs,
  ];

  /// v7 upgrade step (xprojman-48, server migration_v048 — safety/OHS).
  static const List<String> v7 = [safetyEvents, incidentDetails, safetyActions];

  /// v8 upgrade step (xprojman-48 F5/F6 — site inductions, SWMS sign-on).
  static const List<String> v8 = [siteInductions, swmsDocuments];

  /// v9 upgrade step (xprojman-51, server migration_v050 — S18.14 sign-off).
  static const List<String> v9 = [handoverPacks, clientSignoffs];

  static const List<String> all = [
    ...v2, ...v3, ...v4, ...v5, ...v6, ...v7, ...v8, ...v9,
  ];
}
