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

// ── Core fetch ────────────────────────────────────────────────────────────────
// Always returns { data: <parsed json> } to match the axios response shape.
// Throws on non-2xx with err.response = { data, status } like axios does.
async function request(method, path, body) {
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
  if (!res.ok) throw new Error(`Could not load file (${res.status})`);
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
  // Office-side task edit (xprojman-32 §5, TaskProgressService.updateOfficeFields) —
  // `projects.write`, deliberately NOT the progress.tick/verify chain. Currently just
  // `output_note`; the route validates it as a required string.
  patchTask: (id, taskId, outputNote) => request('PATCH', `/projects/${id}/tasks/${taskId}`, { output_note: outputNote }),
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
  upload: ({ file, entityType, entityId, projectId, kind }) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('client_ref', crypto.randomUUID());
    fd.append('entity_type', entityType);
    fd.append('entity_id', entityId);
    if (projectId) fd.append('project_id', projectId);
    if (kind) fd.append('kind', kind);
    fd.append('original_filename', file.name);
    return uploadMultipart('/documents', fd);
  },
  // Bytes, not JSON — see fetchAuthedBlob's own note above.
  fetchBlob: (id) => fetchAuthedBlob(`/documents/${id}`),
  remove: (id) => request('DELETE', `/documents/${id}`),
};

export const customersApi = {
  list:   ()         => request('GET',   '/customers'),
  create: (body)     => request('POST',  '/customers', body),
  patch:  (id, body) => request('PATCH', `/customers/${id}`, body),
};

// NOTE: the platform-admin API surface (`adminApi`, `/admin/*`) deliberately does NOT
// live here. Platform management is a SEPARATE application (`server/dashboard`, port 5110)
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
};

export default api;
