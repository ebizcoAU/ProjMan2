// ProjMan2 API — single source of truth for constants.
// Every secret comes from the environment. Nothing sensitive is hardcoded here.
require('dotenv').config();

// Fail loudly on boot rather than running with an undefined JWT secret, which
// would silently sign tokens that verify against `undefined`.
const REQUIRED_ENV = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DB_NAME'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`\n❌ Missing required environment variables: ${missing.join(', ')}`);
  console.error('   Copy .env.example to .env and fill in all required values.\n');
  process.exit(1);
}

module.exports = {
  server: {
    port:  parseInt(process.env.PORT, 10) || 4100,
    env:   process.env.NODE_ENV || 'development',
    isDev: process.env.NODE_ENV !== 'production',
    // Region is not configurable per-deployment — ProjMan2 is an Australian product.
    timezone: 'Australia/Perth',
    currency: 'AUD',
  },

  db: {
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT, 10) || 3306,
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    name:     process.env.DB_NAME,
  },

  jwt: {
    secret:           process.env.JWT_SECRET,
    expiresIn:        process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret:    process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    pairedExpiresIn:  process.env.PAIRED_JWT_EXPIRES_IN || '30d',
  },

  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max:      parseInt(process.env.RATE_LIMIT_MAX, 10) || 500,
  },

  // Password policy. Inherited shape from FTPOS, but not its 6-digit PIN — office
  // logins are typed on a keyboard, so length is the cheapest real defence.
  password: {
    minLength:      parseInt(process.env.PASSWORD_MIN_LENGTH, 10) || 10,
    bcryptCost:     12,
    maxFailures:    parseInt(process.env.LOGIN_MAX_FAILURES, 10) || 10,
    lockoutMs:      parseInt(process.env.LOGIN_LOCKOUT_MS, 10) || 15 * 60 * 1000,
  },

  recovery: {
    codeTtlSeconds: 15 * 60,   // longer than FTPOS's 5 min: recovery is email, not SMS
    maxAttempts:    5,
    tokenTtlSeconds: 10 * 60,  // recovery token → reset window
  },

  pairing: {
    nonceTtlSeconds: 5 * 60,
    maxTtlSeconds:   10 * 60,
  },

  // How long a new device waits for the old authoritative session to flush its
  // queue before the server force-grants authority. A lost site tablet never acks,
  // so without this ceiling the replacement device waits forever.
  handoff: {
    timeoutSeconds: 90,
  },

  email: {
    enabled: process.env.EMAIL_ENABLED === 'true',
    host:    process.env.EMAIL_HOST || 'smtp.gmail.com',
    port:    parseInt(process.env.EMAIL_PORT, 10) || 587,
    user:    process.env.EMAIL_USER,
    pass:    process.env.EMAIL_PASS,
    from:    process.env.EMAIL_FROM || 'ProjMan2 <noreply@ebizco.com.au>',
  },

  abn: {
    // ABR Web Services GUID. Without it we still run the modulus-89 checksum.
    abrGuid:  process.env.ABR_GUID || null,
    abrUrl:   'https://abr.business.gov.au/json/AbnDetails.aspx',
    timeoutMs: 5000,
  },

  // ── OAuth sign-in (Google / Microsoft / Facebook only) ──────────────────────
  // The app runs the provider SDK, obtains a provider token, and posts it to
  // /auth/oauth/:provider. The server VERIFIES that token with the provider and
  // issues our own session — the provider token never becomes our session.
  //
  // Client IDs are needed so we can check the token's audience is really ours.
  // Until they are set, only the dev bypass works (dev only), which lets the app
  // team build the login UI end to end before the OAuth apps are registered.
  oauth: {
    // dev-only shortcut: accept a token "dev:<provider>:<email>:<name>" so the full
    // sign-in→onboarding flow is testable without real Google/MS/FB apps.
    devBypass: process.env.OAUTH_DEV_BYPASS === 'true' && process.env.NODE_ENV !== 'production',
    // Email must come back from every provider — non-negotiable.
    google: {
      // Comma-separated: iOS, Android and web each have their own client id, and any
      // of them is a valid audience.
      clientIds: (process.env.GOOGLE_CLIENT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
      jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    },
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID || null,
      jwksUrl:  'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    },
    facebook: {
      appId:     process.env.FACEBOOK_APP_ID || null,
      appSecret: process.env.FACEBOOK_APP_SECRET || null,
      graphUrl:  'https://graph.facebook.com',
    },
    timeoutMs: 5000,
  },

  // ── SMS mobile verification (+61) ───────────────────────────────────────────
  // Verifies ownership of an Australian mobile during onboarding. NOT a login
  // method. Same abstraction as email: a real provider in prod, console in dev.
  // Provider is left as config — the deployment picks one (an AU-resident sender
  // such as MessageMedia or SNS Sydney is preferred given the data-residency rule).
  sms: {
    enabled:        process.env.SMS_ENABLED === 'true',
    provider:       process.env.SMS_PROVIDER || 'console', // console | messagemedia | twilio
    from:           process.env.SMS_FROM || 'ProjMan2',
    codeTtlSeconds: 10 * 60,
    maxAttempts:    5,
    // Provider creds (only the chosen provider's are read).
    messagemedia: { apiKey: process.env.MESSAGEMEDIA_API_KEY, apiSecret: process.env.MESSAGEMEDIA_API_SECRET },
    twilio:       { sid: process.env.TWILIO_SID, token: process.env.TWILIO_TOKEN, from: process.env.TWILIO_FROM },
  },
};
