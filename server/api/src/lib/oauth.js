// OAuth token verification — Google, Microsoft, Facebook. Nothing else.
//
// The app runs the provider SDK on the device, gets a token, and hands it to us.
// Our job is to PROVE that token is genuine and for our app, then return a normalised
// identity `{ provider, sub, email, emailVerified, name }`. We never trust the app's
// claim about who the user is — only the token, checked against the provider.
//
// Google and Microsoft issue OIDC ID tokens (signed JWTs): verify the signature
// against the provider's JWKS, then the audience (it must be OUR client id) and the
// issuer. Facebook's classic flow issues an access token instead: we validate it via
// the Graph `debug_token` endpoint and read the profile from `/me`.
//
// Email is non-negotiable (the strategy doc): if a provider does not return one, the
// sign-in is refused with EMAIL_REQUIRED — the app tells the user to add an email to
// that account or use another method.

const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const config = require('../config');

class OAuthError extends Error {
  constructor(code, message, status = 401) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const PROVIDERS = ['google', 'microsoft', 'facebook'];

// ── JWKS cache ────────────────────────────────────────────────
// Providers rotate signing keys; we cache each JWKS for a few minutes rather than
// fetch on every sign-in. A cache miss on an unknown kid forces one refresh.
const jwksCache = new Map(); // url → { keys, fetchedAt }
const JWKS_TTL_MS = 5 * 60 * 1000;

async function getSigningKey(jwksUrl, kid, { forceRefresh = false } = {}) {
  const cached = jwksCache.get(jwksUrl);
  const fresh = cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS;

  if (!fresh || forceRefresh) {
    const resp = await fetch(jwksUrl, { signal: AbortSignal.timeout(config.oauth.timeoutMs) });
    if (!resp.ok) throw new OAuthError('PROVIDER_UNAVAILABLE', 'Could not reach the identity provider', 502);
    const body = await resp.json();
    jwksCache.set(jwksUrl, { keys: body.keys || [], fetchedAt: Date.now() });
  }

  const jwk = jwksCache.get(jwksUrl).keys.find((k) => k.kid === kid);
  if (!jwk && !forceRefresh) return getSigningKey(jwksUrl, kid, { forceRefresh: true });
  if (!jwk) throw new OAuthError('INVALID_OAUTH_TOKEN', 'Token signing key not found');

  // Node builds a public key straight from the JWK — no PEM conversion, no jwks-rsa.
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

/** Verify a signed OIDC ID token: signature, then issuer + audience. */
async function verifyIdToken(token, { jwksUrl, issuers, audiences }) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded?.header?.kid) throw new OAuthError('INVALID_OAUTH_TOKEN', 'Malformed token');

  const key = await getSigningKey(jwksUrl, decoded.header.kid);

  let claims;
  try {
    claims = jwt.verify(token, key, { algorithms: ['RS256'] });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new OAuthError('OAUTH_TOKEN_EXPIRED', 'Provider token expired');
    throw new OAuthError('INVALID_OAUTH_TOKEN', 'Token signature invalid');
  }

  const issuerOk = issuers.some((i) => (i instanceof RegExp ? i.test(claims.iss) : i === claims.iss));
  if (!issuerOk) throw new OAuthError('INVALID_OAUTH_TOKEN', 'Unexpected token issuer');

  // The audience MUST be our client id — this is what stops a token minted for some
  // other app being replayed against ours.
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.length) {
    throw new OAuthError('OAUTH_NOT_CONFIGURED', 'This provider is not configured on the server', 503);
  }
  if (!aud.some((a) => audiences.includes(a))) {
    throw new OAuthError('INVALID_OAUTH_TOKEN', 'Token was not issued for this app');
  }

  return claims;
}

// ── Google ────────────────────────────────────────────────────
async function verifyGoogle(token) {
  const claims = await verifyIdToken(token, {
    jwksUrl: config.oauth.google.jwksUrl,
    issuers: ['accounts.google.com', 'https://accounts.google.com'],
    audiences: config.oauth.google.clientIds,
  });
  if (!claims.email) throw new OAuthError('EMAIL_REQUIRED', 'Your Google account did not return an email address');
  return {
    provider: 'google',
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: claims.name || claims.given_name || null,
  };
}

// ── Microsoft ─────────────────────────────────────────────────
async function verifyMicrosoft(token) {
  if (!config.oauth.microsoft.clientId) {
    throw new OAuthError('OAUTH_NOT_CONFIGURED', 'Microsoft sign-in is not configured on the server', 503);
  }
  const claims = await verifyIdToken(token, {
    jwksUrl: config.oauth.microsoft.jwksUrl,
    // v2 tokens: https://login.microsoftonline.com/{tenant}/v2.0
    issuers: [/^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]+\/v2\.0$/i,
              /^https:\/\/sts\.windows\.net\/[0-9a-f-]+\/$/i],
    audiences: [config.oauth.microsoft.clientId],
  });
  // Work/school accounts put the address in `email`; some in `preferred_username`.
  const email = claims.email || claims.preferred_username;
  if (!email || !email.includes('@')) {
    throw new OAuthError('EMAIL_REQUIRED', 'Your Microsoft account did not return an email address');
  }
  return {
    provider: 'microsoft',
    sub: claims.oid || claims.sub,
    email: email.toLowerCase(),
    emailVerified: true, // MS work/school + personal emails are provider-verified
    name: claims.name || null,
  };
}

// ── Facebook ──────────────────────────────────────────────────
// Classic access-token flow (what flutter_facebook_auth returns by default).
async function verifyFacebook(token) {
  const { appId, appSecret, graphUrl } = config.oauth.facebook;
  if (!appId || !appSecret) {
    throw new OAuthError('OAUTH_NOT_CONFIGURED', 'Facebook sign-in is not configured on the server', 503);
  }

  // 1. Validate the access token really belongs to OUR app and is live.
  const appToken = `${appId}|${appSecret}`;
  const dbgResp = await fetch(
    `${graphUrl}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`,
    { signal: AbortSignal.timeout(config.oauth.timeoutMs) }
  );
  if (!dbgResp.ok) throw new OAuthError('PROVIDER_UNAVAILABLE', 'Could not reach Facebook', 502);
  const dbg = (await dbgResp.json()).data || {};
  if (!dbg.is_valid || String(dbg.app_id) !== String(appId)) {
    throw new OAuthError('INVALID_OAUTH_TOKEN', 'Facebook token is not valid for this app');
  }

  // 2. Read the profile. `email` is only present if the user granted it.
  const meResp = await fetch(
    `${graphUrl}/me?fields=id,name,email&access_token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(config.oauth.timeoutMs) }
  );
  if (!meResp.ok) throw new OAuthError('PROVIDER_UNAVAILABLE', 'Could not read the Facebook profile', 502);
  const me = await meResp.json();
  if (!me.email) {
    throw new OAuthError('EMAIL_REQUIRED', 'Your Facebook account did not share an email address');
  }
  return {
    provider: 'facebook',
    sub: me.id,
    email: me.email.toLowerCase(),
    emailVerified: true, // Facebook only returns confirmed emails
    name: me.name || null,
  };
}

// ── Dev bypass ────────────────────────────────────────────────
// Dev only, behind OAUTH_DEV_BYPASS. Lets the app team drive the whole
// sign-in→onboarding flow before the real OAuth apps exist. Token shape:
//   "dev:google:sam@example.com:Sam Builder"
function verifyDevBypass(provider, token) {
  const parts = String(token).split(':');
  if (parts[0] !== 'dev' || parts[1] !== provider || !parts[2]) {
    throw new OAuthError('INVALID_OAUTH_TOKEN', 'Malformed dev bypass token');
  }
  return {
    provider,
    sub: `dev-${provider}-${parts[2]}`,
    email: parts[2].toLowerCase(),
    emailVerified: true,
    name: parts[3] || null,
    _dev: true,
  };
}

/**
 * Verify a provider token → normalised identity, or throw OAuthError.
 * @param {'google'|'microsoft'|'facebook'} provider
 * @param {string} token  ID token (Google/MS) or access token (Facebook)
 */
async function verify(provider, token) {
  if (!PROVIDERS.includes(provider)) {
    throw new OAuthError('UNSUPPORTED_PROVIDER', `Only ${PROVIDERS.join(', ')} are supported`, 400);
  }
  if (!token) throw new OAuthError('NO_OAUTH_TOKEN', 'A provider token is required', 400);

  if (config.oauth.devBypass && String(token).startsWith('dev:')) {
    return verifyDevBypass(provider, token);
  }

  if (provider === 'google')    return verifyGoogle(token);
  if (provider === 'microsoft') return verifyMicrosoft(token);
  return verifyFacebook(token);
}

module.exports = { verify, PROVIDERS, OAuthError };
