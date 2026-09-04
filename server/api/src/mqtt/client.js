// src/mqtt/client.js — MQTT signalling for ProjMan2 (2026-09-03, owner directive).
//
// Modelled directly on Nexus's own src/mqtt/client.js (../nexus/api). Same posture,
// carried over deliberately: MQTT is SIGNALLING ONLY, never a data-transport channel.
// REST + the existing poll-based /sync/pull|push stay the single source of truth for
// every byte of actual data; every publish here is a thin {table, action, id}-shaped
// nudge whose entire job is "something changed, go pull now" — collapsing the wait
// from the next poll interval down to near-zero, nothing more.
//
// Broker: Mosquitto locally (server/api/scripts/mosquitto/, ported from Nexus's dev
// config), eBizco's own shared broker in production — MQTTS on :8883 (confirmed by
// the owner 2026-09-03; NOT Nexus's older plain :1883, that's dev/legacy-only).
//
// Topics: `{prefix}/{orgId}/{domain}/{event}` — org-scoped, same shape as Nexus's
// `talkpos/{businessId}/...`. `prefix` defaults to `projman2` (config.mqtt.topicPrefix)
// so this can share eBizco's one broker cleanly alongside Nexus/TalkPOS and ozkit,
// each in its own namespace.

let mqtt;
try {
  mqtt = require('mqtt');
} catch {
  console.warn('[MQTT] mqtt package not installed — client disabled. Run: npm install mqtt');
}

const config = require('../config');

const CLIENT_ID = `projman2-server-${process.env.HOSTNAME || 'local'}-${Date.now()}`;

let client = null;

function connect() {
  if (!config.mqtt.enabled) {
    console.log('[MQTT] disabled (MQTT_ENABLED=false) — running without real-time signalling, sync stays poll-only');
    return null;
  }
  if (!mqtt) return null;
  if (client?.connected) return client;

  client = mqtt.connect(config.mqtt.url, {
    clientId:        CLIENT_ID,
    username:        config.mqtt.username,
    password:        config.mqtt.password,
    clean:           true,
    reconnectPeriod: 5000,
    connectTimeout:  30_000,
    keepalive:       60,
  });

  client.on('connect',   () => console.log(`[MQTT] Connected to ${config.mqtt.url} as ${CLIENT_ID}`));
  client.on('reconnect', () => console.log('[MQTT] Reconnecting...'));
  client.on('error',     (err) => console.error('[MQTT] Error:', err.message || err.code || err));
  client.on('offline',   () => console.warn('[MQTT] Client offline'));

  return client;
}

function disconnect() {
  if (client) { client.end(); client = null; }
}

function isConnected() {
  return client?.connected === true;
}

// Fire-and-forget by design (mirrors Nexus): a nudge that never arrives just means
// the receiving client finds out on its next scheduled poll instead of instantly —
// never a data-loss risk, so a broker outage must never fail or slow the caller's
// own request. Never awaited, never throws.
function publish(topic, payload) {
  if (!client?.connected) {
    console.warn(`[MQTT] Cannot publish to ${topic} — not connected`);
    return;
  }
  const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
  client.publish(topic, message, { qos: 1 });
}

// ── sync/nudge — the one real use case wired in so far ────────────────────────
// Tell every device/browser watching this org that fresh data is available.
// Called from SyncService.pushRecord after a write is applied. `table`/`action`/
// `recordId` are metadata for client-side filtering ONLY — never enough to act on
// without the client then calling GET /sync/pull itself, same as Nexus's own
// publishTableUpdate.
function nudgeSync(orgId, { table, action, recordId } = {}) {
  if (!orgId) return;
  const topic = `${config.mqtt.topicPrefix}/${orgId}/sync/nudge`;
  publish(topic, { table, action, record_id: recordId, ts: Date.now() });
}

module.exports = { connect, disconnect, isConnected, publish, nudgeSync };
