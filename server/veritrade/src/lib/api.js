// veritrade/src/lib/api.js — same fetch-wrapper shape as Portal's lib/api.js
// (axios-style { data } response, session-expiry redirect), scoped to the VeriTrade
// endpoints only. VeriTrade has NO password login of its own (spec §4) — the only
// way a session gets minted here is loginApi.status() handing over a token pair
// after an App approval, so there's no authApi.login()/register() here at all.

const BASE = process.env.NEXT_PUBLIC_API_URL || '';

const TOKEN_KEY   = 'vtToken';
const REFRESH_KEY = 'vtRefresh';
const USER_KEY    = 'vtUser';

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

export function isLoggedIn() {
  return !!getToken();
}

// The access token is deliberately short-lived; the refreshToken setSession() already
// stores alongside it is what's SUPPOSED to renew it silently. Portal had this exact
// same gap (stored refreshToken, never used — owner-reported forced-relogin bug) and
// xprojman-36 §3 flagged that VeriTrade's api.js has the identical gap, unfixed. Fix
// ported from Portal's `lib/api.js`, adapted to this file's auth/allow401 option
// shape: a refresh is only attempted when the call actually carried a token — an
// `auth:false` public call's 401 means something else (e.g. an unapproved login poll),
// not an expired session, so it must not trigger a refresh.
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
      const res = await fetch(`${BASE}/api/v1/auth/refresh`, {
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

// `_retried` is internal-only (set solely on the one silent-refresh retry below) so a
// request that STILL 401s after a successful refresh falls straight through instead
// of looping.
async function request(method, path, body, { auth = true, allow401 = false, _retried = false } = {}) {
  const token = auth ? getToken() : null;
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
    // that ONCE before treating this as a real session expiry.
    if (res.status === 401 && auth && token && !_retried && typeof window !== 'undefined') {
      try {
        await refreshAccessToken();
        return request(method, path, body, { auth, allow401, _retried: true });
      } catch {
        // refresh token itself is missing/expired/revoked — fall through below,
        // same as the pre-refresh behaviour.
      }
    }
    const err = new Error(json.message || `API error ${res.status}`);
    err.response = { data: json, status: res.status };
    err.code = json.code;
    // A 401 on an intentionally-anonymous check (e.g. "am I logged in?") is an
    // expected outcome, not a session expiry — don't redirect for those.
    if (res.status === 401 && !allow401 && typeof window !== 'undefined'
        && !window.location.pathname.startsWith('/login')) {
      clearSession();
    }
    throw err;
  }

  return { data: json };
}

const http = {
  get:   (path, opts)       => request('GET',   path, undefined, opts),
  post:  (path, body, opts) => request('POST',  path, body, opts),
  patch: (path, body, opts) => request('PATCH', path, body, opts),
};

// Public: teaser profile, full profile (once logged in), and search — all
// unauthenticated calls degrade gracefully rather than redirect (a public,
// indexable page must render for a logged-out crawler).
export const profilesApi = {
  teaser:   (id)     => request('GET', `/veritrade/profiles/${id}`, undefined, { auth: false, allow401: true }),
  full:     (id)     => request('GET', `/veritrade/profiles/${id}/full`, undefined, { allow401: true }),
  search:   (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v))).toString();
    return request('GET', `/veritrade/search${qs ? `?${qs}` : ''}`, undefined, { auth: false });
  },
  engage:   (id) => request('POST', `/veritrade/profiles/${id}/engage`, {}, { allow401: true }),
  mySettings: () => request('GET', '/veritrade/profile', undefined, { allow401: true }),
  settings: (body) => request('PATCH', '/veritrade/profile', body, { allow401: true }),
};

// App-mediated login (spec §4). `code` travels in the QR/URL the phone scans; the
// browser holds onto it to poll status() until the phone resolves the request.
export const loginApi = {
  initiate: () => request('POST', '/veritrade/login/initiate', undefined, { auth: false }),
  status:   (sessionId, code) =>
    request('GET', `/veritrade/login/${sessionId}/status?code=${encodeURIComponent(code)}`, undefined, { auth: false, allow401: true }),
  // Dev-only convenience (NEXT_PUBLIC_VERITRADE_DEV_LOGIN): simulates the App's own
  // approve call using whatever ProjMan session the dev is already signed into on
  // this browser — real production approval only ever happens from the App.
  devApprove: (sessionId, code, devToken) =>
    fetch(`${BASE}/api/v1/veritrade/login/${sessionId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${devToken}` },
      body: JSON.stringify({ code }),
    }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) })),
};

export const meApi = {
  me: () => request('GET', '/auth/me', undefined, { allow401: true }),
};

// Dev-only: a plain ProjMan password login, used SOLELY to obtain a token for the
// /login dev-approve panel to stand in for "the App, already signed in." Never
// used for VeriTrade's own session (that only ever comes from loginApi.status()).
export const devAuthApi = {
  login: (email, password) => request('POST', '/auth/login', { email, password }, { auth: false }),
};

const api = { ...http, profiles: profilesApi, login: loginApi, me: meApi, devAuth: devAuthApi };
export default api;
