/// ProjMan2 core schema — identity, device, sync and settings infrastructure.
///
/// The three SYNCED tables (`organisations`, `users`, `devices`) are pinned to
/// the frozen wire contract in `docs/projman-01.md` §2.2 — same table and column
/// names as the server's MySQL `c1projman2`, so a row round-trips unchanged.
/// The remaining tables are **app-local only** (never synced) and follow the
/// ftpos infrastructure shapes.
///
/// Sync-column convention (projman-01 §2.1/§2.4) — every synced table carries:
///   org_id            — tenant scope (on `organisations` the row `id` IS the org)
///   device_id         — the writer's device_uid; drives the pull echo-skip
///   is_deleted        — tombstone; a synced row is never hard-deleted
///   updated_at        — INTEGER unix **milliseconds**, client clock (display/order)
///   server_updated_at — INTEGER unix ms, server clock; the pull cursor reads THIS
/// plus app-local bookkeeping the server drops on push (§3.4):
///   is_dirty          — local outbox flag (row needs pushing)
///   last_sync_at      — local, last successful sync of this row
///
/// The client generates the row `id` as a UUID on create (projman-01 §2.1) — there
/// is no separate `server_id`; the same id is authoritative on both sides.
///
/// Deliberately NOT here (recorded so nobody re-adds them): the CGPA/IVR meta
/// layer, `einvoice_*`, hotel `rooms`/`bookings`/`kit_items`,
/// `cccd_transaction_log`, `quick_receipts`/`web_menu_settings`, VN
/// `tax_declarations`. Server-only tables (`sessions`, `pairing_tokens`,
/// `recovery_tokens`, `audit_log`) are reached via the §1 endpoints, never mirrored.
class CoreSchema {
  // ══ SYNCED TABLES — must match projman-01 §2.2 exactly ═════════════════════

  // ── ORGANISATIONS — the tenant (builder company). Owner: WEB console ───────
  // Created at /auth/register only, never via sync. `abn_validated` records the
  // level that passed: 'no' | 'checksum' | 'abr' (drives TPAR/withholding later).
  static const String organisations = '''
    CREATE TABLE IF NOT EXISTS organisations (
      id                TEXT PRIMARY KEY NOT NULL,
      name              TEXT NOT NULL,
      abn               TEXT,
      abn_validated     TEXT DEFAULT 'no',
      address           TEXT,
      suburb            TEXT,
      state             TEXT DEFAULT 'WA',
      postcode          TEXT,
      phone             TEXT,
      email             TEXT,
      timezone          TEXT DEFAULT 'Australia/Perth',
      currency          TEXT DEFAULT 'AUD',
      -- AU onboarding (auth-strategy): business_type ∈ Sole Trader|Partnership|
      -- Company|Trust; gst_registered 0/1. Server must add matching columns —
      -- see the projman-01 §6 note; pull-populated once it does.
      business_type     TEXT,
      gst_registered    INTEGER DEFAULT 0,
      plan              TEXT,
      status            TEXT DEFAULT 'active',
      is_primary        INTEGER DEFAULT 0,
      device_id         TEXT,
      is_deleted        INTEGER DEFAULT 0,
      is_dirty          INTEGER DEFAULT 0,
      updated_at        INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      server_updated_at INTEGER,
      last_sync_at      INTEGER
    )
  ''';

  // ── USERS — a login inside one org. Owner: WEB console ─────────────────────
  // Device receives a PROJECTION only. `password_hash` NEVER leaves the server
  // (projman-01 §2.2) — the column does not exist here.
  static const String users = '''
    CREATE TABLE IF NOT EXISTS users (
      id                TEXT PRIMARY KEY NOT NULL,
      org_id            TEXT NOT NULL,
      email             TEXT,
      full_name         TEXT,
      mobile            TEXT,
      role              TEXT,
      status            TEXT DEFAULT 'active',
      security_version  INTEGER DEFAULT 1,
      last_login_at     INTEGER,
      device_id         TEXT,
      is_deleted        INTEGER DEFAULT 0,
      is_dirty          INTEGER DEFAULT 0,
      updated_at        INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      server_updated_at INTEGER,
      last_sync_at      INTEGER
    )
  ''';

  // ── DEVICES — a paired handset/tablet. Owner: APP for name/OS; role+status ─
  // server-only. `role` lives HERE (not just on the user) so a shared site
  // tablet holds a role without a shared password (projman-01 §2.2, dev.md §3).
  // `device_uid` is the device's own identity; `device_id` is the sync writer.
  static const String devices = '''
    CREATE TABLE IF NOT EXISTS devices (
      id                TEXT PRIMARY KEY NOT NULL,
      org_id            TEXT NOT NULL,
      user_id           TEXT,
      device_uid        TEXT UNIQUE,
      device_name       TEXT,
      platform          TEXT,
      model             TEXT,
      os_version        TEXT,
      app_version       TEXT,
      role              TEXT,
      is_primary        INTEGER DEFAULT 0,
      status            TEXT DEFAULT 'active',
      paired_at         INTEGER,
      paired_by         TEXT,
      last_seen_at      INTEGER,
      revoked_at        INTEGER,
      device_id         TEXT,
      is_deleted        INTEGER DEFAULT 0,
      is_dirty          INTEGER DEFAULT 0,
      updated_at        INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      server_updated_at INTEGER,
      last_sync_at      INTEGER
    )
  ''';

  // ══ APP-LOCAL TABLES — never synced ════════════════════════════════════════

  // ── SYNC QUEUE — offline write outbox (ftpos, unchanged) ───────────────────
  static const String syncQueue = '''
    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY NOT NULL,
      operation TEXT,
      table_name TEXT,
      endpoint TEXT,
      method TEXT,
      payload TEXT NOT NULL,
      idempotency_key TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 5,
      last_error TEXT,
      synced_at TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  ''';

  // ── AUTH SESSION — local token cache. Server `sessions` is separate & ──────
  // server-only (projman-01 §2.3). Access TTL 15m, refresh 30d (§1.7); the
  // refresh token is the opaque session UUID.
  static const String authSession = '''
    CREATE TABLE IF NOT EXISTS auth_session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      exp_time INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_activity TIMESTAMP
    )
  ''';

  // ── DEVICE STATE — this device's live status (app-local) ───────────────────
  static const String deviceState = '''
    CREATE TABLE IF NOT EXISTS device_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT UNIQUE NOT NULL,
      device_name TEXT,
      device_type TEXT,
      is_primary INTEGER DEFAULT 0,
      last_heartbeat TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'offline'
    )
  ''';

  // ── SETTINGS — synced key/value ────────────────────────────────────────────
  static const String settings = '''
    CREATE TABLE IF NOT EXISTS settings (
      key          TEXT PRIMARY KEY NOT NULL,
      value        TEXT,
      is_dirty     INTEGER DEFAULT 0,
      is_deleted   INTEGER DEFAULT 0,
      updated_at   INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      last_sync_at INTEGER
    )
  ''';

  // ── SETTING CACHE — local-only cache ───────────────────────────────────────
  static const String settingCache = '''
    CREATE TABLE IF NOT EXISTS setting_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  ''';

  // ── SYNC METADATA — cursor / checkpoint store (holds last_sync_at) ─────────
  static const String syncMetadata = '''
    CREATE TABLE IF NOT EXISTS sync_metadata (
      key        TEXT PRIMARY KEY NOT NULL,
      value      TEXT,
      updated_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    )
  ''';

  // ── SYNC CONFLICTS ─────────────────────────────────────────────────────────
  static const String syncConflicts = '''
    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name    TEXT NOT NULL,
      record_id     TEXT NOT NULL,
      local_data    TEXT,
      remote_data   TEXT,
      resolution    TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      created_at    INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      resolved_at   INTEGER
    )
  ''';

  // ── SYNC LOG ───────────────────────────────────────────────────────────────
  static const String syncLog = '''
    CREATE TABLE IF NOT EXISTS sync_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    TEXT,
      direction     TEXT,
      table_name    TEXT,
      record_id     TEXT,
      operation     TEXT,
      status        TEXT NOT NULL DEFAULT 'ok',
      error_message TEXT,
      created_at    INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    )
  ''';

  // ── SECURITY LOG — local evidentiary audit (server owns durable audit_log) ─
  static const String securityLog = '''
    CREATE TABLE IF NOT EXISTS security_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      event     TEXT,
      details   TEXT,
      timestamp INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      synced    INTEGER DEFAULT 0
    )
  ''';

  // ── ERROR LOG ──────────────────────────────────────────────────────────────
  static const String errorLog = '''
    CREATE TABLE IF NOT EXISTS error_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      error_message TEXT NOT NULL,
      stack_trace TEXT,
      severity TEXT,
      context TEXT,
      logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  ''';

  /// Creation order. `organisations` first — `users`/`devices` reference org_id.
  static const List<String> all = [
    // synced (projman-01 §2.2)
    organisations,
    users,
    devices,
    // app-local
    syncQueue,
    authSession,
    deviceState,
    settings,
    settingCache,
    syncMetadata,
    syncConflicts,
    syncLog,
    securityLog,
    errorLog,
  ];
}
