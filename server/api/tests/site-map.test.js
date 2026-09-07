// projects.description + server-mediated site map (xprojman-40, Portal Agent
// request, 2026-09-07).
//
// Proves:
//   1. description rides the existing generic PATCH /projects/:id path (and
//      POST /projects at creation) — no new endpoint, matches every other
//      free-text project field.
//   2. GET /projects/:id/site-map: a project with no site_address is refused
//      with a clear NO_SITE_ADDRESS (never calls Google with nothing to
//      geocode); the same read gate (org isolation, auth) as the project
//      itself applies.
//   3. Without GOOGLE_MAPS_API_KEY configured, the endpoint reports
//      SITE_MAP_NOT_CONFIGURED (503) rather than a fake/placeholder image —
//      this is the actual, expected state in every dev/test environment
//      today (no real key provisioned yet, per the doc's own §2 "waiting on
//      the owner" note). The real fetch-from-Google-and-cache path can only
//      be verified once a real key exists; not something this suite can
//      cover.
//
// Run: DISABLE_RATE_LIMIT=true DB_NAME=c1projman2_e2e PORT=4199 node src/index.js &
//      BASE=http://localhost:4199 DB_NAME=c1projman2_e2e node tests/site-map.test.js
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};
async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json; try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, json };
}

(async () => {
  console.log(`Site map / project description test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `SiteMap ${s}` },
    user: { full_name: 'Pat PM', email: `sitemap${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;

  const regB = await call('POST', '/auth/register', {
    organisation: { name: `SiteMapB ${s}` },
    user: { full_name: 'Other Org PM', email: `sitemapb${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pmb-${s}`, platform: 'android' },
  });
  const pmB = regB.json.data.accessToken;

  // ── 1. description at creation and via PATCH ──
  const proj = await call('POST', '/projects',
    { code: `SM-${s}`, name: 'Site map test', description: 'A test dwelling for the site-map feature' }, pm);
  ok('project created with a description', proj.status === 201, JSON.stringify(proj.json));
  const projId = proj.json.data.id;

  const detail = await call('GET', `/projects/${projId}`, undefined, pm);
  ok('description persisted at creation, readable via GET', detail.json.data.project.description === 'A test dwelling for the site-map feature',
    JSON.stringify(detail.json.data.project.description));

  const patch = await call('PATCH', `/projects/${projId}`, { description: 'Updated description' }, pm);
  ok('description updatable via the existing PATCH path', patch.status === 200, JSON.stringify(patch.json));
  const afterPatch = await call('GET', `/projects/${projId}`, undefined, pm);
  ok('updated description persisted', afterPatch.json.data.project.description === 'Updated description');

  // ── 2. site-map: no address on file ──
  const noAddr = await call('GET', `/projects/${projId}/site-map`, undefined, pm);
  ok('no site_address on file -> 404 NO_SITE_ADDRESS (never calls Google with nothing to geocode)',
    noAddr.status === 404 && noAddr.json.code === 'NO_SITE_ADDRESS', JSON.stringify(noAddr.json));

  await call('PATCH', `/projects/${projId}`, { site_address: '1 Example St, Perth WA 6000' }, pm);

  // ── 3. site-map: no API key configured (the real state of every dev/test env) ──
  const notConfigured = await call('GET', `/projects/${projId}/site-map`, undefined, pm);
  ok('no GOOGLE_MAPS_API_KEY configured -> 503 SITE_MAP_NOT_CONFIGURED, not a fake image',
    notConfigured.status === 503 && notConfigured.json.code === 'SITE_MAP_NOT_CONFIGURED', JSON.stringify(notConfigured.json));

  // ── Same read gate as the project itself ──
  const crossOrg = await call('GET', `/projects/${projId}/site-map`, undefined, pmB);
  ok('a different org cannot reach this project\'s site-map (404, not 403 — no existence leak)',
    crossOrg.status === 404, JSON.stringify(crossOrg.json));

  const noAuth = await call('GET', `/projects/${projId}/site-map`, undefined, undefined);
  ok('no auth refused (401)', noAuth.status === 401);

  const unknownProject = await call('GET', '/projects/00000000-0000-0000-0000-000000000000/site-map', undefined, pm);
  ok('unknown project refused (404)', unknownProject.status === 404);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
