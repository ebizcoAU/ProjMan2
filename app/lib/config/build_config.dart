/// Build-time configuration — environment (dev / preview / prod).
///
/// All values are set via --dart-define at compile time.
/// Running without --dart-define defaults to development (local LAN server).
///
/// Usage examples:
///   flutter run  --dart-define=BUILD_ENV=development
///   flutter run  --dart-define=BUILD_ENV=preview
///   flutter build ipa --dart-define=BUILD_ENV=production
///
/// Ported from ftpos `lib/config/build_config.dart`. The MAOI/BANOI variant axis
/// is gone — ProjMan2 is a single product — as are the MQTT F&B topics, the
/// Viettel eInvoice endpoints and the Vietnamese tax rates.
library;

// ── Environment ───────────────────────────────────────────────────────────────

/// Valid values: 'development', 'preview', 'production'
const String BUILD_ENV = String.fromEnvironment(
  'BUILD_ENV',
  defaultValue: 'development',
);

const bool IS_DEV = BUILD_ENV == 'development';
const bool IS_PREV = BUILD_ENV == 'preview';
const bool IS_PROD = BUILD_ENV == 'production';

// ── Region ────────────────────────────────────────────────────────────────────
//
// Australia, WA first. These are not user preferences — they are what the
// ledger, the BAS and every date on a site diary are denominated in.

const String APP_NAME = 'ProjMan2';
const String COUNTRY_CODE = 'AU';
const String CURRENCY_CODE = 'AUD';
const String CURRENCY_SYMBOL = r'$';
const String DEFAULT_TIMEZONE = 'Australia/Perth';
const String LOCALE = 'en_AU';

/// GST is 10% on both sides, reported quarterly on the BAS (development.md §5.9).
const double GST_RATE = 0.10;

// ── API ───────────────────────────────────────────────────────────────────────

// NOTE: the dev base URL is provisional — NEXUSPM-BRIEF.md §2 asks NexusPM to
// confirm it. Proposed there: http://10.1.1.21:4100/api/v1 (own service, own
// database `c1projman2`). Override with --dart-define until it is confirmed.

/// Nexus API base URL. Override with --dart-define=API_BASE_URL=...
const String API_BASE_URL = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: IS_DEV
      ? 'http://10.1.1.21:4100/api/v1'
      : 'https://ebizco.com.au/projman/api/v1',
);

/// Server origin (scheme+host+port) without the `/api/v1` suffix. Static assets
/// like uploaded photos are served from the origin root, not under /api/v1.
final String API_ORIGIN = API_BASE_URL.replaceFirst(RegExp(r'/api/v1/?$'), '');

/// Resolves an image reference that may be a server-relative path
/// (e.g. `/site_photos/org/photo.jpg`) into a full absolute URL. Absolute URLs
/// (http/https) and local file paths are returned unchanged. Image.network
/// cannot load a bare relative path, so callers must run URLs through this.
String? resolveImageUrl(String? url) {
  if (url == null || url.isEmpty) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return '$API_ORIGIN$url';
  return url;
}

// ── MQTT ──────────────────────────────────────────────────────────────────────
//
// Carries pairing, handoff and sync nudges — not orders. Same broker as ftpos.
//
// dev:           ws://10.1.1.21:9001/mqtt   — local Mosquitto, no auth, no TLS
// preview/prod:  wss://mqtt.ebizco.com.au:8884/mqtt — auth required, TLS

/// Hostname only (no ws:// prefix). Override with --dart-define=MQTT_BROKER_URL=...
const String MQTT_BROKER_URL = String.fromEnvironment(
  'MQTT_BROKER_URL',
  defaultValue: IS_DEV ? '10.1.1.21' : 'mqtt.ebizco.com.au',
);

/// WebSocket port: 9001 for dev Mosquitto, 8884 for preview/prod.
const int MQTT_BROKER_PORT = IS_DEV ? 9001 : 8884;

/// Use WSS (TLS). Dev broker runs plain ws://, preview/prod uses wss://.
const bool MQTT_USE_TLS = !IS_DEV;

// Credentials come from the environment. ftpos hard-coded the preview/prod MQTT
// password in this file; development.md §9 forbids repeating that here.
const String MQTT_USERNAME = String.fromEnvironment('MQTT_USERNAME');
const String MQTT_PASSWORD = String.fromEnvironment('MQTT_PASSWORD');

// ── Feature flags ─────────────────────────────────────────────────────────────

const Map<String, String> BUILD_INFO = {
  'app': APP_NAME,
  'env': BUILD_ENV,
  'region': COUNTRY_CODE,
};

class FeatureFlags {
  /// Secondary-device pairing with a bound role (development.md §3).
  static const bool PAIRING_ENABLED = true;

  /// Session handoff between devices.
  static const bool HANDOFF_ENABLED = true;

  static const bool SYNC_ENABLED = true;
  static const bool MQTT_ENABLED = true;

  /// IVR voice capture — a good fit for gloved, noisy sites, but deferred out
  /// of the port so it is not carried dead. Revisit after P5 (§8.4).
  static const bool IVR_ENABLED = false;
}
