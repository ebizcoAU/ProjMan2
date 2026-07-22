// ProjMan2 API — entry point.
//
// Ported from Nexus `src/index.js`, minus everything that belonged to the sell side:
// the eInvoice worker, MQTT broker client, Skills Server proxy, CGPA compile proxy,
// the billing and auto-overdue crons, the velo storefront, and the ~20 POS route
// modules. What remains is identity, devices, pairing, sync and the org surface.
//
// Base URL: /api/v1  ·  dev http://localhost:4100/api/v1

require('dotenv').config();

const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config');

const authRoutes     = require('./routes/auth');
const oauthRoutes    = require('./routes/oauth');
const recoveryRoutes = require('./routes/recovery');
const devicesRoutes  = require('./routes/devices');
const pairingRoutes  = require('./routes/pairing');
const syncRoutes     = require('./routes/sync');
const orgRoutes      = require('./routes/organisation');
const projectsRoutes = require('./routes/projects');
const customersRoutes = require('./routes/customers');

const app = express();

app.set('trust proxy', 1); // behind nginx in production — req.ip must be the real client

app.use(helmet());
app.use(cors({ origin: config.cors.origins, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
if (config.server.env !== 'test') app.use(morgan('dev'));

// ── Rate limiting ─────────────────────────────────────────────
// Nexus learned the hard way (O-050) that one global IP bucket does not work when
// devices poll. A tablet on a 30-second sync cycle fires ~36 requests in 18 minutes;
// share that bucket with login and a correct password gets refused on site WiFi.
//
// So: a generous global limit that skips the polling endpoints, and a tight one on
// the endpoints that actually accept credentials.
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const path = req.originalUrl.split('?')[0];
    return (
      path.startsWith('/api/v1/sync/') ||
      path.startsWith('/api/v1/auth/session/') ||
      path.startsWith('/api/v1/pairing/status/') ||
      path === '/api/v1/pairing/pending' ||
      path === '/api/v1/auth/refresh' ||
      path === '/api/v1/auth/me'
    );
  },
  handler: (req, res) => {
    console.warn(`[RATE LIMIT] 429 path=${req.originalUrl} ip=${req.ip}`);
    res.status(429).json({ success: false, message: 'Too many requests', code: 'RATE_LIMITED' });
  },
});
app.use('/api/', globalLimiter);

// Credential and code-bearing endpoints only. Everything under /auth/session and
// /auth/refresh is deliberately NOT here — they are polled.
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[AUTH RATE LIMIT] 429 path=${req.originalUrl} ip=${req.ip}`);
    res.status(429).json({
      success: false, message: 'Too many attempts. Try again later.', code: 'RATE_LIMITED',
    });
  },
});
app.use('/api/v1/auth/login',            credentialLimiter);
app.use('/api/v1/auth/register',         credentialLimiter);
app.use('/api/v1/auth/recovery',         credentialLimiter);
app.use('/api/v1/auth/change-password',  credentialLimiter);
app.use('/api/v1/auth/oauth',            credentialLimiter);
app.use('/api/v1/auth/sms',              credentialLimiter);
app.use('/api/v1/pairing/request',       credentialLimiter);

// ── Health ────────────────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({
    status: 'ok',
    service: 'projman2-api',
    version: require('../package.json').version,
    environment: config.server.env,
    timestamp: new Date().toISOString(),
  })
);

app.get('/internal/health', async (req, res) => {
  try {
    await require('./db/pool').execute('SELECT 1');
    res.json({ status: 'healthy', mysql: 'ok', ts: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'degraded', mysql: 'error', ts: new Date().toISOString() });
  }
});

// ── Routes ────────────────────────────────────────────────────
// oauthRoutes and authRoutes share the /auth mount — Express runs both routers, so
// /auth/oauth/*, /auth/onboarding and /auth/sms/* live beside /auth/login etc.
app.use('/api/v1/auth',          authRoutes);
app.use('/api/v1/auth',          oauthRoutes);
app.use('/api/v1/auth/recovery', recoveryRoutes);
app.use('/api/v1/devices',       devicesRoutes);
app.use('/api/v1/pairing',       pairingRoutes);
app.use('/api/v1/sync',          syncRoutes);
app.use('/api/v1/organisation',  orgRoutes);
app.use('/api/v1/projects',      projectsRoutes);
app.use('/api/v1/customers',     customersRoutes);

// ── 404 / error ───────────────────────────────────────────────
app.use((req, res) =>
  res.status(404).json({ success: false, message: `${req.method} ${req.path} not found`, code: 'NOT_FOUND' })
);

app.use((err, req, res, _next) => {
  console.error('Unhandled:', err);
  res.status(500).json({
    success: false,
    message: config.server.isDev ? err.message : 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
});

app.listen(config.server.port, '0.0.0.0', () => {
  console.log(`\n🏗  ProjMan2 API → http://localhost:${config.server.port}/api/v1`);
  console.log(`   DB:  ${config.db.name} on ${config.db.host}`);
  console.log(`   ENV: ${config.server.env}  ·  ${config.server.timezone}  ·  ${config.server.currency}`);
  console.log(`   Email: ${config.email.enabled ? 'enabled' : 'DISABLED (codes log to console in dev)'}`);
  console.log(`   ABN:   ${config.abn.abrGuid ? 'checksum + ABR lookup' : 'checksum only (no ABR_GUID)'}\n`);
});

module.exports = app;
