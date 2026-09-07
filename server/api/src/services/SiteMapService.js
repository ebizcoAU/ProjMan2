// SiteMapService — server-mediated Google Static Map for a project's site
// address (xprojman-40 §2, Portal Agent request, 2026-09-07). The owner was
// explicit the API key must never reach the browser — this service is the
// ONLY place `config.googleMaps.apiKey` is ever read, and the route handler
// (routes/projects.js) proxies the resulting image bytes straight through
// (Content-Type: image/png), the same "authenticated blob, not a public URL"
// shape `GET /documents/:id` already uses (Portal's own `fetchAuthedBlob`) —
// no new signed-URL mechanism invented for a problem that pattern already
// solves.
//
// Cached to disk by a hash of the address: Maps Static API is metered/billed
// and a site's address essentially never changes once set, so there is no
// reason to re-fetch on every page load. This is a content-addressable
// lookup-by-key cache, deliberately NOT `lib/storage.js` (that driver always
// writes a fresh random-uuid file for a tenant upload — write-only, no way to
// ask "have I already fetched this address" — a different problem shape).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const config = require('../config');

const CACHE_DIR = process.env.SITE_MAP_CACHE_DIR || path.join(__dirname, '..', '..', 'var', 'site-maps');

function cachePathFor(address) {
  const hash = crypto.createHash('sha256').update(address).digest('hex');
  return path.join(CACHE_DIR, `${hash}.png`);
}

/**
 * @returns {Promise<Buffer>} PNG bytes for the project's site address, fetched
 * from Google (and cached) or served from cache.
 */
async function getSiteMap({ orgId, projectId }) {
  // Project/address checked BEFORE the key-configured check on purpose: a
  // missing project or address is the caller's own data problem (fixable by
  // them — add an address), not a server configuration problem (fixable only
  // by whoever holds the Google Cloud credentials) — surfacing the more
  // actionable, cheaper-to-check problem first. Also matches every other
  // project sub-resource's 404-before-anything-else posture (no existence
  // leak to a caller in the wrong org).
  const [[project]] = await pool.query(
    'SELECT site_address FROM projects WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [projectId, orgId]
  );
  if (!project) throw new ServiceError('NOT_FOUND', 'Project not found', 404);
  const address = (project.site_address || '').trim();
  if (!address) {
    throw new ServiceError('NO_SITE_ADDRESS', 'This project has no site address on file', 404);
  }
  if (!config.googleMaps.apiKey) {
    throw new ServiceError('SITE_MAP_NOT_CONFIGURED',
      'The site map is not configured yet — set GOOGLE_MAPS_API_KEY on the server', 503);
  }

  const cachePath = cachePathFor(address);
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath);
  }

  const url = 'https://maps.googleapis.com/maps/api/staticmap'
    + `?center=${encodeURIComponent(address)}&zoom=16&size=640x400&scale=2`
    + `&markers=${encodeURIComponent(address)}&key=${config.googleMaps.apiKey}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch (err) {
    throw new ServiceError('SITE_MAP_UPSTREAM_ERROR', 'Could not reach the map service', 502);
  }
  if (!res.ok) {
    throw new ServiceError('SITE_MAP_UPSTREAM_ERROR', 'Could not fetch the site map', 502);
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, buffer);
  return buffer;
}

module.exports = { getSiteMap };
