// server/shared/constants.js — the ONE place every ProjMan2 service (api,
// dashboard, portal, veritrade — all Node/Next.js, all inside this monorepo)
// reads its default URLs from, instead of each service hardcoding the same
// `http://localhost:5100` (or drifting out of sync with each other) independently.
//
// These are DEFAULTS ONLY — every value here is overridable by an env var, and
// every consuming file does `process.env.X || CONSTANTS.<env>.X`, never the
// constant alone. Secrets (passwords, JWT secrets, API keys) never live here —
// this file is meant to be readable/committed, same posture as an `.env.example`.
//
// Selected by `NODE_ENV`: 'production' picks the `production` block, anything
// else (including unset) picks `development` — same default-to-dev posture
// `api/src/config.js` already uses elsewhere in this codebase.
//
// PRODUCTION VALUES BELOW ARE PLACEHOLDERS except where noted "real" — ProjMan2
// has no deployed production environment yet (everything built and tested this
// session has been local dev only). Don't treat an unmarked production URL here
// as a live endpoint; it's a slot to fill in when deployment actually happens.

const development = {
  // Renumbered 2026-09-06 (owner directive) into one contiguous 51xx block —
  // was 5100/5110/5220/5330, an arbitrary spread with no visible relationship
  // between the services. SKILLS_URL is a reserved slot: server/skills/ has no
  // code yet (just .env + .gitignore), nothing actually listens on 5104 today.
  API_URL:        'http://localhost:5100',
  DASHBOARD_URL:  'http://localhost:5101',
  PORTAL_URL:     'http://localhost:5102',
  VERITRADE_URL:  'http://localhost:5103',
  SKILLS_URL:     'http://localhost:5104', // reserved — nothing built here yet
  PRODUCT_URL:    'http://localhost:5105',

  DB_HOST: 'localhost',
  DB_PORT: 3306,

  // Mosquitto, local — mirrors nexus/api/scripts/mosquitto/mosquitto.dev.conf
  // exactly (same two-listener shape: plain TCP for server/Node, WebSocket for
  // any browser client). See server/api/scripts/mosquitto/ (ported alongside).
  MQTT_BROKER_URL: 'mqtt://localhost:1883',   // server-side (Node) connection
  MQTT_WS_URL:     'ws://localhost:9001/mqtt', // browser-side connection
};

const production = {
  // PLACEHOLDER — no ProjMan2 production deployment exists yet. Fill in when a
  // real domain/hosting decision is made; do not assume these resolve to anything.
  API_URL:       'https://api.projman2.ebizco.com.au',
  DASHBOARD_URL: 'https://dashboard.projman2.ebizco.com.au',
  PORTAL_URL:    'https://portal.projman2.ebizco.com.au',
  VERITRADE_URL: 'https://veritrade.ebizco.com.au',

  // PLACEHOLDER — production DB host/port, not yet provisioned for ProjMan2.
  DB_HOST: 'PLACEHOLDER-not-yet-provisioned',
  DB_PORT: 3306,

  // REAL — this is eBizco's own existing broker. Confirmed (owner, 2026-09-03):
  // production uses MQTTS on :8883 (TLS) — that's ozkit/SIMLOCK's own connection
  // (`mqtts://mqtt.ebizco.com.au:8883`), not Nexus's older plain `:1883`, which
  // is dev/legacy-only. ProjMan2's server connects here too, own topic prefix
  // (`projman2/...`), own MQTT username/password — provision separately, do not
  // reuse `talkpos`'s or ozkit's `simlock` credentials.
  MQTT_BROKER_URL: 'mqtts://mqtt.ebizco.com.au:8883',
  // UNCONFIRMED — the browser-facing WebSocket listener port. Checked Nexus's
  // dashboard and ozkey's locksim (both browser MQTT clients); both only had a
  // LOCAL dev value (`ws://localhost:9001` / `ws://10.1.1.21:9001`), neither had
  // a production one set. Confirm the actual WSS port with whoever runs the
  // broker before wiring a browser client (Dashboard/Portal/VeriTrade) at this
  // value — it's a placeholder, not a verified endpoint like the line above.
  MQTT_WS_URL: 'wss://mqtt.ebizco.com.au:8083/mqtt',
};

const CONSTANTS = { development, production };

module.exports = CONSTANTS[process.env.NODE_ENV === 'production' ? 'production' : 'development'];
module.exports.all = CONSTANTS; // escape hatch for anything that needs both blocks at once
