// Geolocation — IP → City/Region/Country, resolved LOCALLY (dashboardspec §6.1).
//
// IP is personal information under the AU Privacy Act, and the platform commits to AU
// residency. So we never call an external IP-lookup API — that would ship PII offshore.
// Resolution is a **local MaxMind GeoLite2 file**, read at startup. If the file is not
// present (it is licence-gated and not committed), this degrades gracefully to
// { country: null, ... } — the login log still renders, just without a location column
// value — and logs a one-time notice. Drop the .mmdb in and set GEOLITE2_DB to enable.
//
// To enable: download GeoLite2-City.mmdb (free MaxMind licence), set
//   GEOLITE2_DB=/path/to/GeoLite2-City.mmdb
// and `npm i maxmind`. Until then resolve() returns nulls and nothing leaves the box.

const fs = require('fs');

let reader = null;      // the maxmind reader, if available
let attempted = false;  // load-once guard
let warned = false;

function load() {
  if (attempted) return;
  attempted = true;
  const dbPath = process.env.GEOLITE2_DB;
  if (!dbPath) return; // not configured — graceful fallback
  try {
    if (!fs.existsSync(dbPath)) {
      console.warn(`[GEO] GEOLITE2_DB set but file not found at ${dbPath} — geolocation disabled`);
      return;
    }
    // maxmind is an optional dependency; require lazily so the server runs without it.
    // eslint-disable-next-line global-require, import/no-unresolved
    const maxmind = require('maxmind');
    reader = maxmind.openSync(dbPath);
    console.log('[GEO] GeoLite2 loaded — local IP resolution enabled (no external calls)');
  } catch (err) {
    console.warn('[GEO] could not load GeoLite2 (npm i maxmind + set GEOLITE2_DB):', err.message);
  }
}

/**
 * Resolve an IP to a coarse location. Never throws, never calls out.
 * @returns {{ city:string|null, region:string|null, country:string|null }}
 */
function resolve(ip) {
  const empty = { city: null, region: null, country: null };
  if (!ip) return empty;
  load();
  if (!reader) {
    if (!warned) { warned = true; /* one-time: geolocation simply not configured */ }
    return empty;
  }
  try {
    const r = reader.get(ip);
    if (!r) return empty;
    return {
      city: r.city?.names?.en ?? null,
      region: r.subdivisions?.[0]?.names?.en ?? null,
      country: r.country?.names?.en ?? r.country?.iso_code ?? null,
    };
  } catch {
    return empty;
  }
}

/** True if local geolocation is actually available (for a /health-style report). */
function enabled() {
  load();
  return !!reader;
}

module.exports = { resolve, enabled };
