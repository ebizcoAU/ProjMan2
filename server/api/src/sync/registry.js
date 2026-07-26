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
//              without the `money.read` permission. A supervisor runs the site and
//              never sees what it costs — that rule has to hold on the wire, not
//              just in the app's UI.
//   projectColumn  (optional) the column carrying the project id, for RESOURCE
//              scoping (§9.4). Present → an `assigned`/`self` session pulls only the
//              rows whose project it is a member of, and a push into a non-member
//              project is refused. 'id' on `projects` itself. Absent → the table is
//              not project-scoped (org-scope only, as before).
//   selfColumn  (optional) with projectColumn, the row-owner column for `self`
//              scope (e.g. 'assigned_to' on tasks) — a tradie sees only own rows.
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

  // Web owns edits; the field app may CREATE (Stage 1 captures the customer profile
  // on-site alongside the project — projman-01 §4 change). Same reasoning as projects.
  customers: {
    table: 'customers',
    owner: 'web',
    appCreate: true,
    createPermission: 'customers.write',
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    columns: new Set([
      'name', 'abn', 'contact_name', 'phone', 'email', 'address', 'notes',
      'is_deleted', 'updated_at',
    ]),
  },

  // Web owns UPDATE/DELETE (single-writer for edits), but the field app may CREATE —
  // 18-Stage Matrix Stage 1: a projectManager creates a project on-site, offline,
  // from land documents (projman-01 §4 change, 2026-07-23). A create is a brand-new
  // row with a client UUID, so there is no single-writer conflict to protect; edits,
  // where the conflict lives, stay WEB-only. appCreate is gated by createPermission.
  projects: {
    table: 'projects',
    owner: 'web',
    appCreate: true,
    createPermission: 'projects.write',
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    projectColumn: 'id', // a project row IS its own project, for membership scoping
    columns: new Set([
      'customer_id', 'code', 'name', 'site_address', 'lot_plan',
      'contract_value', 'contract_type', 'start_date', 'due_date',
      'template_id', 'pm_user_id', 'is_deleted', 'updated_at',
    ]),
    financialColumns: new Set(['contract_value']),
  },

  // Membership itself is web-owned and pulled (the app renders "who's on this job")
  // AND it is the scope source, so it is deliberately NOT project-scoped on pull —
  // a device must receive its own membership rows to know what it may reach.
  project_members: {
    table: 'project_members',
    owner: 'web',
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    columns: new Set(['is_deleted', 'updated_at']),
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
    projectColumn: 'project_id',
    columns: new Set(['status', 'milestone', 'start_date', 'end_date', 'is_deleted', 'updated_at']),
    unprotect: new Set(['status']),
    // Money on a stage — redacted on pull for roles without money.read (§9, §10.3).
    financialColumns: new Set([
      'budget_amount', 'estimated_amount', 'committed_amount', 'actual_amount', 'claimed_amount',
    ]),
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
    projectColumn: 'project_id',
    selfColumn: 'assigned_to', // a `self`-scope tradie pulls only own tasks
    columns: new Set([
      'project_id', 'stage_id', 'parent_id', 'name', 'completion',
      'start_date', 'end_date', 'assigned_to', 'predecessor_id',
      'is_deleted', 'updated_at',
    ]),
    financialColumns: new Set(['budget_hours', 'budget_amount']),
  },

  // ── Site operations (migration_v008) ── servdesignspec §11 ─────────────────
  // App-authored AND app-owned: the site CREATES this data and pushes it through
  // /sync/push (offline-first). The rules the generic writer can't do — the
  // append-only diary invariant, the geofence verdict, provenance stamping — live in
  // SiteOpsService, invoked from pushRecord on BOTH write intents. No financial
  // columns (a delivery has no value in v1). Project-scoped, so an assigned/self role
  // pulls/pushes only its member projects.

  // The legal record. `status` (draft/final) is globally protected — the app must push
  // it, so it is unprotected here (like project_stages.status). Provenance columns
  // (is_current/author_id/finalised_*) are server-set (PROTECTED) — see SiteOpsService.
  site_diary: {
    table: 'site_diary',
    owner: 'app',
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    projectColumn: 'project_id',
    columns: new Set([
      'project_id', 'entry_date', 'status', 'weather', 'temp_c', 'headcount',
      'work_done', 'delays', 'delay_cause', 'notes', 'photo_ids',
      'version', 'supersedes_id', 'is_deleted', 'updated_at',
    ]),
    unprotect: new Set(['status']),
  },

  // One-tap muster. `person_id` is app-written (who checked in); `geo_verified` is
  // server-derived (PROTECTED). `self`-scope (a tradie) additionally sees only its own
  // rows on pull via selfColumn.
  site_attendance: {
    table: 'site_attendance',
    owner: 'app',
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    projectColumn: 'project_id',
    selfColumn: 'person_id',
    columns: new Set([
      'project_id', 'person_id', 'person_name', 'person_type', 'trade',
      'check_in_at', 'check_out_at', 'check_in_lat', 'check_in_lng', 'method',
      'induction_ok', 'is_deleted', 'updated_at',
    ]),
  },

  // Delivery-proof evidence. `received_by` is server-stamped (PROTECTED); supplier/PO
  // ids are nullable free-coupled until P7.
  deliveries: {
    table: 'deliveries',
    owner: 'app',
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    projectColumn: 'project_id',
    columns: new Set([
      'project_id', 'supplier_id', 'supplier_name', 'po_id', 'po_reference',
      'received_at', 'docket_no', 'photo_ids', 'notes', 'is_deleted', 'updated_at',
    ]),
  },

  // ── Quality (migration_v009) ── servdesignspec §12 ─────────────────────────
  // App-authored: the inspector's checklist and the site's punch-list are captured
  // offline and ride /sync/push, same as site-ops (§11). The one server-mediated act
  // — a hold-point inspection's `complete` driving the stage's is_validated — is a
  // REST call to InspectionService, not a sync write (§12.4). No financial columns.

  // A bare hold-point `result='pass'` pushed here is a QA record only — it does NOT
  // flip is_validated; only InspectionService.complete does that (§12.9). Server-
  // stamped provenance (`inspector_id`, `completed_at`) is PROTECTED.
  inspections: {
    table: 'inspections',
    owner: 'app',
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    projectColumn: 'project_id',
    columns: new Set([
      'project_id', 'stage_id', 'type', 'is_hold_point', 'scheduled_at',
      'result', 'reference', 'document_id', 'notes', 'is_deleted', 'updated_at',
    ]),
  },

  // Child-scoped: carries no project_id of its own — its project is resolved from
  // its parent `inspections` row via `projectViaTable`/`projectViaColumn` (the same
  // parent-derivation Nexus's cook_session_lines uses; see SyncService).
  inspection_items: {
    table: 'inspection_items',
    owner: 'app',
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    projectViaTable: 'inspections',
    projectViaColumn: 'inspection_id',
    columns: new Set([
      'inspection_id', 'seq', 'description', 'result', 'note', 'photo_id',
      'is_deleted', 'updated_at',
    ]),
  },

  // The punch-list. `raised_by`/`closed_at`/`closed_by` are server-stamped
  // (PROTECTED, stamped by QualityOpsService.afterPush). Open defects do not gate
  // stage completion in v1 (§12.5). `status` is globally protected — unprotect it
  // here (like `site_diary`/`project_stages`) so the app can push open/in_progress/
  // closed transitions; the closed provenance is what QualityOpsService adds.
  defects: {
    table: 'defects',
    owner: 'app',
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    projectColumn: 'project_id',
    columns: new Set([
      'project_id', 'stage_id', 'location', 'trade', 'description',
      'assigned_to', 'assigned_to_name', 'due_date', 'severity', 'status',
      'photo_id', 'photo_after_id', 'is_deleted', 'updated_at',
    ]),
    unprotect: new Set(['status']),
  },

  // App + web owned (§12.7): the office often uploads the surveyor's signed BA2/BA3,
  // but an inspector may attach one on-site. No money columns in P6.
  certificates: {
    table: 'certificates',
    owner: ['app', 'web'],
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    projectColumn: 'project_id',
    columns: new Set([
      'project_id', 'stage_id', 'type', 'reference', 'issued_by', 'issued_at',
      'expires_at', 'document_id', 'notes', 'is_deleted', 'updated_at',
    ]),
  },

  // ── Compliance (migration_v010) ── servdesignspec §12.10, projman-03 R2/R3 ──────
  // An open item here BLOCKS its stage's completion (ComplianceService, wired into
  // StageProgressionService.checkTransition — same gate on REST /advance and
  // sync-push). Same posture as defects: app-owned, quality.write gated
  // (QualityOpsService), `raised_by`/`raised_at`/`closed_at`/`closed_by`
  // server-stamped. `status` unprotected like every other app-driven status column.
  ncc_register: {
    table: 'ncc_register',
    owner: 'app',
    pull: true,
    scope: 'org',
    orgColumn: 'org_id',
    idColumn: 'id',
    projectColumn: 'project_id',
    columns: new Set([
      'project_id', 'stage_id', 'ncc_class', 'building_type', 'cpc_unit',
      'reference', 'notes', 'status', 'is_deleted', 'updated_at',
    ]),
    unprotect: new Set(['status']),
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
  // A device advances a stage's `status`, but never flips its own hold point —
  // validation is the inspector's server-mediated action only (§10.4/§10.5).
  'is_validated',
  'validated_by',
  'validated_at',
  // Site-ops provenance — server-owned, never a device write (§11.4/§11.5/§11.8).
  // The tablet writes the diary body / the attendance tap; the server names who it
  // authenticated (author/finalised/received) and computes the geofence verdict.
  'is_current',
  'author_id',
  'finalised_at',
  'finalised_by',
  'geo_verified',
  'received_by',
  // Quality provenance (§12.9) — server-owned, same principle. `inspector_id`/
  // `completed_at` are set only via InspectionService.complete (never a bare sync
  // write, §12.4); `raised_by`/`closed_at`/`closed_by` are stamped by
  // QualityOpsService.afterPush on the defect's sync-push path.
  'inspector_id',
  'completed_at',
  'raised_by',
  'closed_at',
  'closed_by',
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
