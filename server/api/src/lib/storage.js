// Storage abstraction for document bytes (xprojman-21: "local disk in dev, object store in prod").
//
// The point of this seam is that NOTHING above it knows where bytes live. DocumentService deals in
// an opaque `storage_key`; swapping disk for S3/GCS is implementing one more driver here, with no
// change to the service, the routes, or the client contract.
//
// The two-phase upload shape from xprojman-21 is preserved deliberately: today `put()` takes the
// bytes the server already received, but a presigned direct-to-blob driver can later answer the
// same call with a URL for the client to PUT to — the app keeps calling init and never rewrites.
//
//   put(buf, {orgId, ext})  → storage_key
//   getStream(key)          → Readable            (for GET /documents/:id)
//   remove(key)             → void                (best-effort; soft delete is the record)
//
// Driver is chosen by STORAGE_DRIVER (default 'disk'). Disk root is STORAGE_DIR, defaulting to
// <api>/var/documents — outside src/, gitignored, and created on demand.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DRIVER = process.env.STORAGE_DRIVER || 'disk';
const ROOT = process.env.STORAGE_DIR || path.join(__dirname, '..', '..', 'var', 'documents');

// ── disk driver ──────────────────────────────────────────────────────────────────────────────
// Keys are `<org>/<yyyy>/<mm>/<uuid><ext>`: org-partitioned so a tenant's bytes can be located or
// removed wholesale, date-partitioned so no single directory grows unbounded.
const disk = {
  put(buf, { orgId, ext = '' }) {
    const now = new Date();
    const rel = path.join(
      orgId,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      crypto.randomUUID() + ext
    );
    const abs = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    return rel;
  },

  // `path.resolve` + prefix check: a storage_key is server-minted, but this is the one place a
  // traversal would turn into reading an arbitrary file, so it is verified rather than trusted.
  resolve(key) {
    const abs = path.resolve(ROOT, key);
    if (!abs.startsWith(path.resolve(ROOT) + path.sep)) {
      throw new Error('storage key escapes the storage root');
    }
    return abs;
  },

  exists(key) { try { return fs.existsSync(disk.resolve(key)); } catch { return false; } },
  getStream(key) { return fs.createReadStream(disk.resolve(key)); },
  remove(key) { try { fs.unlinkSync(disk.resolve(key)); } catch { /* already gone — fine */ } },
};

const drivers = { disk };

function driver() {
  const d = drivers[DRIVER];
  if (!d) throw new Error(`Unknown STORAGE_DRIVER '${DRIVER}' (have: ${Object.keys(drivers).join(', ')})`);
  return d;
}

module.exports = {
  put: (buf, opts) => driver().put(buf, opts),
  getStream: (key) => driver().getStream(key),
  exists: (key) => driver().exists(key),
  remove: (key) => driver().remove(key),
  driverName: () => DRIVER,
  root: () => ROOT,
};
