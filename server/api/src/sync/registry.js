// The sync table registry.
//
// Nexus's sync.js was 3281 lines, and most of that length was per-table special
// cases inlined into the push handler — VN field aliases, VAT blocking, POS-specific
// guards. The registry pattern is the same one that file was reaching for; pulling it
// out is what lets Phase 2 add `projects`, `site_diary` and `attendance` by adding
// entries here rather than by growing a handler.
//
// Each entry declares:
//   table      MySQL table
//   columns    what a device push may WRITE. Anything absent is silently dropped.
//   owner      who is the system of record (ftpos XF-27)
//   pull       whether the delta pull returns it
//   orgColumn  the column carrying the tenant id. 'org_id' for every domain table;
//              'id' for `organisations`, because the org IS the tenant — it has no
//              org_id pointing at itself.
//   scope      'org'  → rows filtered by the tenant
//              'self' → additionally filtered to the calling user
//   unprotect  (optional) columns exempted from PROTECTED_COLUMNS for THIS table
//              only. Exists for exactly one case so far: `project_stages.status` is
//              site progress the app must push, while `status` stays protected
//              everywhere else (user/device/org status are admin actions).
//   financialColumns  (optional) columns stripped from pull payloads for sessions
//              whose role is not in FINANCIAL_ROLES. A supervisor runs the site and
//              never sees what it costs — that rule has to hold on the wire, not
//              just in the app's UI.
//
// Phase 1 synced organisations, users and devices. v003 adds the construction core
// (customers, projects, project_stages, tasks) — PROPOSED to the app team in
// projman-01 §2.2, built ahead of schema v1 sign-off on the owner's instruction.

const TABLES = {
  // The org profile is edited at a desk, deliberately, by someone who knows what an
  // ABN is — the web console owns it. The field app reads it.
  organisations: {
    table: 'organisations',
    owner: 'web',
    pull: true,
    scope: 'org',
    orgColumn: 'id',
    idColumn: 'id',
    columns: new Set([
      'name', 'address', 'suburb', 'state', 'postcode', 'phone', 'email',
      'is_deleted', 'updated_at',
    ]),
  },

  // HR configuration. The console creates people and assigns roles; the app renders
  // the resulting list. Letting a site tablet write a role would make pairing's
  // role-assignment guard meaningless.
  users: {
    table: 'users',
    owner: 'web',
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    columns: new Set(['full_name', 'mobile', 'is_deleted', 'updated_at']),
  },

  // The device knows its own name, OS and app version better than the server does,
  // so those it may write. Role and status it may not — those are what the server is
  // for.
  devices: {
    table: 'devices',
    owner: 'app',
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    columns: new Set([
      'device_name', 'platform', 'model', 'os_version', 'app_version',
      'last_seen_at', 'is_deleted', 'updated_at',
    ]),
  },

  // ── Construction core (migration_v003) ── proposed in projman-01 §2.2 ──────

  // Customers are desk work: the console creates them, the field app rings them.
  customers: {
    table: 'customers',
    owner: 'web',
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    columns: new Set([
      'name', 'abn', 'contact_name', 'phone', 'email', 'address', 'notes',
      'is_deleted', 'updated_at',
    ]),
  },

  // A project is created and budgeted at a desk by someone who can see money.
  // The app reads it; contract_value never reaches a non-financial device.
  projects: {
    table: 'projects',
    owner: 'web',
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    columns: new Set([
      'customer_id', 'code', 'name', 'site_address', 'lot_plan',
      'contract_value', 'contract_type', 'start_date', 'due_date',
      'template_id', 'pm_user_id', 'is_deleted', 'updated_at',
    ]),
    financialColumns: new Set(['contract_value']),
  },

  // Split-by-field (projman-01 §4): the office draws the programme (seq, codes,
  // names, budgets — via the REST route), the site marks progress. So the app owns
  // the sync surface but may push only the progress fields.
  project_stages: {
    table: 'project_stages',
    owner: 'app',
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    columns: new Set(['status', 'start_date', 'end_date', 'is_deleted', 'updated_at']),
    unprotect: new Set(['status']),
    financialColumns: new Set(['budget_amount']),
  },

  // Tasks are the PM's working tool in the field — the app owns them outright,
  // budgets excepted (web-written, financially redacted).
  tasks: {
    table: 'tasks',
    owner: 'app',
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    columns: new Set([
      'project_id', 'stage_id', 'parent_id', 'name', 'completion',
      'start_date', 'end_date', 'assigned_to', 'predecessor_id',
      'is_deleted', 'updated_at',
    ]),
    financialColumns: new Set(['budget_hours', 'budget_amount']),
  },
};

// Never writable by a device push, on any table, whatever the registry says.
// `org_id` heads the list on purpose: accepting it from the wire would let a client
// bug — or a client that had been tampered with — write into another builder's data.
const PROTECTED_COLUMNS = new Set([
  'id',
  'org_id',
  'user_id',
  'role',
  'status',
  'password_hash',
  'security_version',
  'created_at',
  'server_updated_at',
  'paired_at',
  'paired_by',
  'revoked_at',
  'abn',
  'abn_validated',
  'plan',
]);

// Masked in log output. Not blocked — just never printed.
const SENSITIVE_COLUMNS = new Set(['email', 'mobile', 'phone']);

const ALLOWED_OPERATIONS = ['create', 'update', 'delete'];

/** camelCase / PascalCase → snake_case, matching what the app sends. */
function toSnakeCase(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Reduce a device-supplied object to the columns it is actually allowed to set.
 * Unknown keys are dropped in silence: the app ships ahead of the server routinely,
 * and a 400 on an unrecognised field would wedge the whole queue behind one row.
 */
function sanitise(data, entry) {
  const safe = {};
  if (!data || typeof data !== 'object') return safe;

  for (const [rawKey, value] of Object.entries(data)) {
    const key = toSnakeCase(rawKey);
    if (PROTECTED_COLUMNS.has(key) && !entry.unprotect?.has(key)) continue;
    if (!entry.columns.has(key)) continue;
    if (value !== undefined) safe[key] = value;
  }
  return safe;
}

function maskSensitive(data) {
  if (!data || typeof data !== 'object') return data;
  const masked = { ...data };
  for (const col of SENSITIVE_COLUMNS) {
    if (col in masked) masked[col] = '***';
  }
  return masked;
}

module.exports = {
  TABLES,
  PROTECTED_COLUMNS,
  SENSITIVE_COLUMNS,
  ALLOWED_OPERATIONS,
  toSnakeCase,
  sanitise,
  maskSensitive,
};
