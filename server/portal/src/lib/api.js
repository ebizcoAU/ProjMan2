// dashboard/src/lib/api.js
// Ported from Nexus dashboard `lib/api.js`: the same fetch wrapper with the
// axios-shaped `{ data }` response and session-expiry redirect. Changed for
// ProjMan2: base URL (Next rewrite → :5100), token keys, /login redirect, and the
// endpoint namespaces are the ProjMan2 surface, not FTPOS admin.

// Empty BASE = same-origin; next.config.js rewrites /api/* to the API service.
// Set NEXT_PUBLIC_API_URL only when the dashboard is served from another origin.
const BASE = process.env.NEXT_PUBLIC_API_URL || '';

const TOKEN_KEY   = 'pm2Token';
const REFRESH_KEY = 'pm2Refresh';
const USER_KEY    = 'pm2User';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession({ accessToken, refreshToken, user }) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getSavedUser() {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
  catch { return null; }
}

// A stable per-browser id so the console's sessions are attributable in the device
// list and the audit log. It is a web surface, not a paired field device.
export function webDeviceUid() {
  if (typeof window === 'undefined') return null;
  let uid = localStorage.getItem('pm2WebUid');
  if (!uid) {
    uid = 'web-' + crypto.randomUUID();
    localStorage.setItem('pm2WebUid', uid);
  }
  return uid;
}

// The access token is deliberately short-lived (15min, config.js JWT_EXPIRES_IN) —
// the 30-day refreshToken already stored by setSession is what's SUPPOSED to renew
// it silently. Before this, a 401 went straight to clearSession()+redirect, so the
// refresh token sat in localStorage completely unused and the Portal bounced to
// /login every 15 minutes of use (owner-reported, 2026-09-05: "forcing portal
// re-login so often"). Single-flight: concurrent 401s across in-flight requests
// share one refresh call rather than each firing their own POST /auth/refresh (the
// server doesn't rotate the refresh token on use, so this is purely to avoid a
// request storm, not a correctness issue).
const REFRESH_PATH = '/auth/refresh';
let refreshPromise = null;

function getRefreshToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_KEY);
}

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) throw new Error('No refresh token');
      const res = await fetch(`${BASE}/api/v1${REFRESH_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || 'Refresh failed');
      localStorage.setItem(TOKEN_KEY, json.data.accessToken);
      return json.data.accessToken;
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

// Builds a `?a=b&c=d` query string, dropping null/undefined/'' values — for
// endpoints with several optional filters (financeApi's report date ranges).
function qs(params) {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries).toString()}`;
}

// ── Core fetch ────────────────────────────────────────────────────────────────
// Always returns { data: <parsed json> } to match the axios response shape.
// Throws on non-2xx with err.response = { data, status } like axios does.
// `_retried` is internal — set only on the one silent-refresh retry below, so a
// request that STILL 401s after a successful refresh falls straight through to
// the redirect instead of looping.
async function request(method, path, body, _retried = false) {
  const token = getToken();
  const url = `${BASE}/api/v1${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  let json;
  try { json = await res.json(); }
  catch { json = {}; }

  if (!res.ok) {
    // A still-valid refresh token can renew an expired access token silently — try
    // that ONCE before giving up. Never for the refresh call itself, and never
    // twice for the same original request.
    if (res.status === 401 && path !== REFRESH_PATH && !_retried && typeof window !== 'undefined') {
      try {
        await refreshAccessToken();
        return request(method, path, body, true);
      } catch {
        // refresh token itself is missing/expired/revoked — fall through to the
        // redirect below, same as the pre-refresh behaviour.
      }
    }
    const err = new Error(json.message || `API error ${res.status}`);
    err.response = { data: json, status: res.status };
    err.code = json.code;
    // Auto-redirect to login on auth failures — except on the login page itself.
    if (res.status === 401 && typeof window !== 'undefined'
        && !window.location.pathname.startsWith('/login')) {
      clearSession();
      window.location.replace('/login');
    }
    throw err;
  }

  return { data: json };
}

// A multipart sibling of request() — the Documents upload endpoint (xprojman-21)
// takes `multipart/form-data`, not JSON, so it can't go through the JSON-only
// helper above. Never set Content-Type here: fetch derives the multipart boundary
// itself from the FormData body, and a manual header would omit it.
async function uploadMultipart(path, formData) {
  const token = getToken();
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  let json;
  try { json = await res.json(); }
  catch { json = {}; }
  if (!res.ok) {
    const err = new Error(json.message || `API error ${res.status}`);
    err.response = { data: json, status: res.status };
    err.code = json.code;
    throw err;
  }
  return { data: json };
}

// GET /documents/:id streams raw bytes, not JSON — the bearer token has to travel as
// an Authorization header (the endpoint is authenticated), so a plain <img src=...>/
// <a href=...> can't reach it. Fetch with auth and hand back a Blob the caller turns
// into an object URL.
async function fetchAuthedBlob(path) {
  const token = getToken();
  const res = await fetch(`${BASE}/api/v1${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    // Error responses here are JSON ({message, code}, same shape as request()'s),
    // unlike the success case which is raw bytes — read it for a real message/code
    // (e.g. SiteMapService's SITE_MAP_NOT_CONFIGURED/NO_SITE_ADDRESS) instead of
    // just the HTTP status.
    let body = {};
    try { body = await res.json(); } catch { /* non-JSON error body, fall through */ }
    const err = new Error(body.message || `Could not load file (${res.status})`);
    err.code = body.code;
    err.status = res.status;
    throw err;
  }
  return res.blob();
}

// ── Axios-style HTTP verbs ────────────────────────────────────────────────────
const http = {
  get:    (path)       => request('GET',    path),
  post:   (path, body) => request('POST',   path, body),
  patch:  (path, body) => request('PATCH',  path, body),
  put:    (path, body) => request('PUT',    path, body),
  delete: (path)       => request('DELETE', path),
};

// ── ProjMan2 namespaces ───────────────────────────────────────────────────────
export const authApi = {
  login: (email, password) =>
    request('POST', '/auth/login', {
      email, password,
      device: { device_uid: webDeviceUid(), device_name: 'Office console', platform: 'web' },
    }),
  logout:      () => request('POST', '/auth/logout'),
  me:          () => request('GET',  '/auth/me'),
  permissions: () => request('GET',  '/auth/permissions'),
  // OAuth token-exchange (migration_v002): the web gets a provider ID token (Google via
  // GIS, or a dev-bypass token in dev) and the server verifies it and returns a session —
  // the SAME user the app created, matched by provider sub or email. This is how a user who
  // signed up on the app with Google (no password) signs into the Portal.
  oauth: (provider, token) => request('POST', `/auth/oauth/${provider}`, {
    token, device: { device_uid: webDeviceUid(), device_name: 'Office console', platform: 'web' },
  }),
  // Self-Registration (xprojman-14 Fork A). `user.role` optional; the server allow-list is
  // {projectManager, builder, developer}. A registrant founds their org → isOrgOwner: true.
  register: (body) => request('POST', '/auth/register', {
    ...body, device: { device_uid: webDeviceUid(), device_name: 'Office console', platform: 'web' },
  }),
};

// App-mediated login (xprojman-31) — generalized off VeriTrade's own "Scan to sign
// in" (xprojman-25). `code` travels in the QR/deep-link the ProjMan App scans; the
// browser holds it to poll status() until the App user approves/denies. Unlike
// VeriTrade, Portal already has a password/Google path — this is an additional
// option on /login, not a replacement (xprojman-31 §3/§4 item 3).
export const appLoginApi = {
  initiate: () => request('POST', '/auth/app-login/initiate', { product: 'portal' }),
  status:   (sessionId, code) =>
    request('GET', `/auth/app-login/${sessionId}/status?code=${encodeURIComponent(code)}`),
};

// Forgot-password (xprojman-26): request a 6-digit email code, verify it for a
// short-lived recoveryToken, then reset. Same 3-endpoint shape the app uses.
export const recoveryApi = {
  request: (email)                => request('POST', '/auth/recovery/request', { email, purpose: 'password_reset' }),
  verify:  (email, code)          => request('POST', '/auth/recovery/verify',  { email, code, purpose: 'password_reset' }),
  reset:   (recoveryToken, newPassword) => request('POST', '/auth/recovery/reset', { recoveryToken, newPassword }),
};

// Job Awards — the Builder's identity-level invitation inbox (xprojman-12). Not
// project-scoped: an invitee can't reach the project until they accept, so the list is
// GET /job-awards/pending; accept/decline is the project-scoped respond endpoint.
export const jobAwardsApi = {
  pending: ()                        => request('GET',  '/job-awards/pending'),
  respond: (projectId, jaId, accept) => request('POST', `/projects/${projectId}/job-awards/${jaId}/respond`, { accept }),
};

export const devicesApi = {
  list:   ()           => request('GET',  '/devices'),
  detail: (id)         => request('GET',  `/devices/${id}`),
  revoke: (id)         => request('POST', `/devices/${id}/revoke`),
  setRole:(id, role)   => request('POST', `/devices/${id}/role`, { role }),
};

export const syncApi = {
  status: () => request('GET', '/sync/status'),
};

export const organisationApi = {
  get:        ()          => request('GET',   '/organisation'),
  patch:      (body)      => request('PATCH', '/organisation', body),
  users:      ()          => request('GET',   '/organisation/users'),
  createUser: (body)      => request('POST',  '/organisation/users', body),
  patchUser:  (id, body)  => request('PATCH', `/organisation/users/${id}`, body),
  audit:      (params={}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/organisation/audit${qs ? `?${qs}` : ''}`);
  },
  // Skill-rate card (xprojman-39 §1) — 4 fixed tiers, money.read/money.write.
  // PUT is per-tier (Settings saves one row's rate at a time), not a bulk replace.
  getRateCard: ()                        => request('GET', '/organisation/rate-card'),
  setRate:     (skillLevel, hourlyRate)  => request('PUT', '/organisation/rate-card', { skill_level: skillLevel, hourly_rate: hourlyRate }),
};

// Cost centres (xprojman-39 §2) — org-shared fixed list, same shape as `suppliers`.
// List needs no permission (a code/name pair isn't sensitive); create is money.write.
export const costCentresApi = {
  list:   ()       => request('GET',  '/cost-centres'),
  create: (body)   => request('POST', '/cost-centres', body),
};

// Per-org chart of accounts (xprojman-42 §2, migration v042) — NOT the same
// as `/admin/finance` (eBizco's own single-tenant books). Read: money.read.
// Write (create/rename/re-parent/activate): finance.manage.
// Reports (xprojman-42 §3, migration v044) — org_journal-backed, money.read.
// pnl/expenses/sales default to the current month server-side when from/to
// are omitted; balanceSheet defaults to today when asOf is omitted.
export const financeApi = {
  accounts:       ()               => request('GET',   '/finance/accounts'),
  createAccount:  (body)           => request('POST',  '/finance/accounts', body),
  patchAccount:   (id, body)       => request('PATCH', `/finance/accounts/${id}`, body),
  pnl:            (from, to)       => request('GET', `/finance/reports/pnl${qs({ from, to })}`),
  balanceSheet:   (asOf)           => request('GET', `/finance/reports/balance-sheet${qs({ as_of: asOf })}`),
  expenses:       (from, to)       => request('GET', `/finance/reports/expenses${qs({ from, to })}`),
  sales:          (from, to)       => request('GET', `/finance/reports/sales${qs({ from, to })}`),
};

export const projectsApi = {
  list:   (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/projects${qs ? `?${qs}` : ''}`);
  },
  detail: (id)        => request('GET',   `/projects/${id}`),
  // The console landing aggregate. ONE call, permission-aware server-side: `money` comes back
  // null (not zero) when the caller lacks money.read, so the UI hides the block rather than
  // rendering a false $0. Deliberately not assembled client-side from per-project reads — that
  // was the N+1 the endpoint replaces.
  dashboardSummary: () => request('GET', '/projects/dashboard-summary'),
  create: (body)      => request('POST',  '/projects', body),
  patch:  (id, body)  => request('PATCH', `/projects/${id}`, body),
  // Cancel = plain status flip, keeps every row (xprojman-35 §0/§1) — a project that
  // did real work (invoices/POs) but was called off. Same PATCH shape as patch() above,
  // named separately since callers reach for intent, not the wire shape.
  cancel: (id)        => request('PATCH', `/projects/${id}`, { status: 'cancelled' }),
  // Delete = daisy-chain cascade purge, only for a draft project with zero progress
  // claims/job awards/engagements (xprojman-35 §2/§3, enforced server-side — this call
  // can 409 with code NOT_DRAFT | HAS_PROGRESS_CLAIMS | HAS_JOB_AWARDS | HAS_ENGAGEMENTS;
  // callers read err.code off the thrown error, per request()'s err.code convention).
  remove: (id)        => request('DELETE', `/projects/${id}`),

  // Programme (18-stage engine)
  instantiate: (id, templateId) => request('POST', `/projects/${id}/programme`, { template_id: templateId }),
  advanceStage: (id, stageId, toStatus, milestone) =>
    request('POST', `/projects/${id}/stages/${stageId}/advance`, { to_status: toStatus, milestone }),
  validateStage: (id, stageId, result, reference) =>
    request('POST', `/projects/${id}/stages/${stageId}/validate`, { result, reference }),
  // Cost plan — per-stage structure/cost edit (programme.write)
  patchStage: (id, stageId, body) => request('PATCH', `/projects/${id}/stages/${stageId}`, body),
  // Builder Programme/Line-of-Balance authoring (portaldesignspec §4.3/§1.3) — same
  // programme.write permission, scoped server-side to seq>=9 + the accepted engagement
  // (assertProgrammeWriteScope, ProjectService.js:259). PM's own create path (Stage
  // instantiation) uses `instantiate` above; this is the raw per-stage add a Builder
  // uses to break down his own Stages 9-18.
  createStage: (id, body) => request('POST', `/projects/${id}/stages`, body),
  // Office-side task edit (xprojman-32 §5 / xprojman-38 §1, TaskProgressService.
  // updateOfficeFields) — `projects.write`, deliberately NOT the progress.tick/verify
  // chain. Widened past just `output_note` once `status` became office-settable
  // (N/A, cancelled, and reversing either) — takes a fields object now rather than a
  // single positional string, since there's more than one settable field.
  patchTask: (id, taskId, fields) => request('PATCH', `/projects/${id}/tasks/${taskId}`, fields),
  // Custom/ad-hoc task creation (xprojman-38 §3) — `programme.write`, same
  // Stage-1-8-vs-engaged-Builder-Stage-9-18 scope as createStage. Server assigns
  // `seq`/`code` (`S{stage.seq}.{seq}`) and echoes both back, so callers don't
  // compute the code client-side.
  createTask: (id, body) => request('POST', `/projects/${id}/tasks`, body),
  // Server-mediated Google Static Map (xprojman-40 §2, SiteMapService) — bytes,
  // not JSON, same auth-header-required shape as documentsApi.fetchBlob. 503
  // SITE_MAP_NOT_CONFIGURED (no Google Maps key yet) / 404 NO_SITE_ADDRESS are
  // real, expected states here, not just error noise — callers read err.code.
  siteMap: (id) => fetchAuthedBlob(`/projects/${id}/site-map`),
  // Project Brief snapshots (xprojman-41 §3/§9/§10, ProjectBriefService) — an
  // append-only history, one PDF per "Formalize Brief"/"Re-issue" click or
  // approved variation. `create` is projects.write, `list`/`fetchPdf` are
  // projects.read, same tier as the project fields the brief is built from.
  createBriefSnapshot: (id)        => request('POST', `/projects/${id}/brief-snapshots`),
  listBriefSnapshots:  (id)        => request('GET',  `/projects/${id}/brief-snapshots`),
  fetchBriefSnapshot:  (id, sid)   => fetchAuthedBlob(`/projects/${id}/brief-snapshots/${sid}`),
};

// Commercial (P7a Cost Plan + Progress Claims, P7b Procurement) — read model for the
// Portal Cost Plan tab. The stage cost columns come off projectsApi.detail(id) as derived
// roll-ups (never hand-edited — xprojman-10 §5); these expose the source documents behind
// each column. Engagement-mode redaction is enforced server-side (a Builder's PO/invoice
// rows simply don't come back to a PM under independent_fixed).
export const commercialApi = {
  costPlan:         (id) => request('GET', `/projects/${id}/cost-plan`),
  purchaseOrders:   (id) => request('GET', `/projects/${id}/purchase-orders`),
  // Task-level PO raising (xprojman-29 §3 / v030, ProcurementService.createPurchaseOrder) —
  // task_id is optional server-side (a PO can still be stage-level-only) but this call always
  // carries one, since it's only ever used from the Task drill-down's "outsourced" flow.
  createPurchaseOrder: (id, body) => request('POST', `/projects/${id}/purchase-orders`, body),
  supplierInvoices: (id) => request('GET', `/projects/${id}/supplier-invoices`),
  progressClaims:   (id) => request('GET', `/projects/${id}/progress-claims`),
  suppliers:        ()   => request('GET', '/suppliers'),
  // Progress-claim workflow (P7a §7.2/§10.6): Builder submits (claims.submit); PM
  // approves/declines then pays (claims.approve). Submit runs the §10.6 claim-freeze.
  submitClaim:  (id, body)            => request('POST', `/projects/${id}/progress-claims`, body),
  approveClaim: (id, claimId, accept) => request('POST', `/projects/${id}/progress-claims/${claimId}/approve`, { accept }),
  payClaim:     (id, claimId, reference) => request('POST', `/projects/${id}/progress-claims/${claimId}/pay`, { reference }),
};

// Quality (P6a) — review reads only; writes ride /sync/push from the field app.
export const qualityApi = {
  inspections:  (id)             => request('GET', `/projects/${id}/inspections`),
  defects:      (id, status)     => request('GET', `/projects/${id}/defects${status ? `?status=${status}` : ''}`),
  certificates: (id)             => request('GET', `/projects/${id}/certificates`),
};

// Field / Team (DIRECTIVE 1 Steps A + D2) — the office watches what the app pushes
// (stage progress, task tick/verify, hold-point checklists) and drives the two
// server-mediated actions: verify a ticked task, satisfy a hold-point requirement.
// Tasks + stages come off projectsApi.detail(id); these add the per-stage checklist
// read and the two writes.
export const fieldApi = {
  holdPoints:      (id, stageId)        => request('GET',  `/projects/${id}/stages/${stageId}/hold-points`),
  satisfyHoldPoint:(id, stageId, reqId) => request('POST', `/projects/${id}/stages/${stageId}/hold-points/${reqId}/satisfy`, {}),
  verifyTask:      (id, taskId)         => request('POST', `/projects/${id}/tasks/${taskId}/verify`, {}),
};

export const stageTemplatesApi = {
  list:   ()   => request('GET', '/stage-templates'),
  detail: (id) => request('GET', `/stage-templates/${id}`),
};

// Documents (xprojman-21, `entity_type='task'` added v030 / xprojman-29) — the Task
// drill-down's attachments (drawings/reports/photos/video). REST-mediated, not a
// sync-registry table (it carries bytes), so this talks to /documents directly
// rather than riding projectsApi.detail(id).
export const documentsApi = {
  list: (entityType, entityId) =>
    request('GET', `/documents?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`),
  // Repository view (xprojman-28 §2, DocumentService.listByProject) — every
  // document on a project, every entity_type, for the Documents tab.
  listByProject: (projectId) => request('GET', `/documents?project_id=${encodeURIComponent(projectId)}`),
  // entityType/entityId are optional server-side (DocumentService.upload) — an
  // office-side "attach a surveyor's cert" style upload with no owning entity
  // resolves to kind 'general' and is a real, supported shape, not a workaround.
  upload: ({ file, entityType, entityId, projectId, kind }) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('client_ref', crypto.randomUUID());
    if (entityType) fd.append('entity_type', entityType);
    if (entityId) fd.append('entity_id', entityId);
    if (projectId) fd.append('project_id', projectId);
    if (kind) fd.append('kind', kind);
    fd.append('original_filename', file.name);
    return uploadMultipart('/documents', fd);
  },
  // Bytes, not JSON — see fetchAuthedBlob's own note above.
  fetchBlob: (id) => fetchAuthedBlob(`/documents/${id}`),
  // Soft-delete (DocumentService.softDelete) — quality.write or documents.write,
  // not uploader-only. Server already had this; the client just never exposed it.
  remove: (id) => request('DELETE', `/documents/${id}`),
};

export const customersApi = {
  list:   ()         => request('GET',   '/customers'),
  create: (body)     => request('POST',  '/customers', body),
  patch:  (id, body) => request('PATCH', `/customers/${id}`, body),
};

// NOTE: the platform-admin API surface (`adminApi`, `/admin/*`) deliberately does NOT
// live here. Platform management is a SEPARATE application (`server/dashboard`, port 5101)
// with no access to app-user content. This Portal is app-users-only. See §0 of
// portaldesignspecification.md.

// ── Default export ────────────────────────────────────────────────────────────
const api = {
  ...http,
  auth:           authApi,
  recovery:       recoveryApi,
  devices:        devicesApi,
  sync:           syncApi,
  organisation:   organisationApi,
  projects:       projectsApi,
  customers:      customersApi,
  stageTemplates: stageTemplatesApi,
  documents:      documentsApi,
  quality:        qualityApi,
  commercial:     commercialApi,
  costCentres:    costCentresApi,
};

export default api;
