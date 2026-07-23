// dashboard/src/lib/api.js
// Ported from Nexus dashboard `lib/api.js`: the same fetch wrapper with the
// axios-shaped `{ data }` response and session-expiry redirect. Changed for
// ProjMan2: base URL (Next rewrite → :4100), token keys, /login redirect, and the
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
};

export const stageTemplatesApi = {
  list:   ()   => request('GET', '/stage-templates'),
  detail: (id) => request('GET', `/stage-templates/${id}`),
};

export const customersApi = {
  list:   ()         => request('GET',   '/customers'),
  create: (body)     => request('POST',  '/customers', body),
  patch:  (id, body) => request('PATCH', `/customers/${id}`, body),
};

// ── System Admin dashboard (platform-admin allowlist; account + billing only) ──
export const adminApi = {
  stats:   ()           => request('GET', '/admin/stats'),
  health:  ()           => request('GET', '/admin/system/health'),
  users:   (params={})  => request('GET', `/admin/users${qs(params)}`),
  userAction: (id, act) => request('POST', `/admin/users/${id}/${act}`),
  devices: (params={})  => request('GET', `/admin/devices${qs(params)}`),
  orgs:    (params={})  => request('GET', `/admin/orgs${qs(params)}`),
  loginLog:(params={})  => request('GET', `/admin/logs/login${qs(params)}`),
  billing: {
    subscriptions: (params={}) => request('GET', `/admin/billing/subscriptions${qs(params)}`),
    revenue:       ()          => request('GET', '/admin/billing/revenue'),
    recordPayment: (body)      => request('POST', '/admin/billing/payments', body),
    changePlan:    (orgId, body) => request('PATCH', `/admin/orgs/${orgId}/plan`, body),
  },
};
function qs(params) {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  return s ? `?${s}` : '';
}

// ── Default export ────────────────────────────────────────────────────────────
const api = {
  ...http,
  auth:           authApi,
  devices:        devicesApi,
  sync:           syncApi,
  organisation:   organisationApi,
  projects:       projectsApi,
  customers:      customersApi,
  stageTemplates: stageTemplatesApi,
  admin:          adminApi,
};

export default api;
