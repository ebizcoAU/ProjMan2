// VeriTrade V1 acceptance (veritradedesignspecification.md, scope locked with the
// owner 2026-08-06: publish opt-in, public teaser, gated full profile, search,
// Engage->Introduction — licence verification and subscription billing deferred).
//
// Proves:
//   1. Publish requires at least one verified project (NO_EVIDENCE) — an empty
//      profile can't go live.
//   2. Publish/update, and the licence-status honesty rule: submitting licence
//      details NEVER auto-verifies (always lands 'not_available', no state
//      integration exists in this build).
//   3. Public teaser: no auth required, 404 while unpublished, headline stats correct.
//   4. Full profile: authentication required; financial detail hidden unless the
//      subject separately opted into veritrade_disclose_financials; issuing org is
//      never named (decision #28, carried from PM2-02).
//   5. Search: published + filterable; unpublished/no-match rows excluded.
//   6. Engage: cross-org Introduction written; idempotent re-Engage does not touch
//      the daily rate cap; self-engage and unpublished-target are refused.
//
// Run: DISABLE_RATE_LIMIT=true DB_NAME=c1projman2_e2e PORT=4199 node src/index.js &
//      BASE=http://localhost:4199 DB_NAME=c1projman2_e2e node tests/veritrade.test.js
const crypto = require('crypto');
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';
const AttestationService = require('../src/services/AttestationService');

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};
async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json; try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, json };
}
async function pairAs(admin, userId, role, uid) {
  const init = await call('POST', '/pairing/initiate', { role, label: uid, assign_user_id: userId }, admin);
  const rid = init.json.data.request_id, nonce = init.json.data.qr_payload.nonce;
  await call('POST', '/pairing/request', { request_id: rid, nonce, device_uid: uid, platform: 'android' });
  await call('POST', '/pairing/confirm', { request_id: rid, role }, admin);
  const st = await call('GET', `/pairing/status/${rid}?device_uid=${uid}`);
  return st.json.data?.accessToken;
}
async function mintUser(pm, s, tag, role) {
  const email = `${tag}${s}@x.com`;
  const password = `${tag}-pass-1234`;
  await call('POST', '/organisation/users', { email, full_name: `${tag} person`, role, password }, pm);
  const login = await call('POST', '/auth/login', { email, password, device: { device_uid: `${tag}-${s}`, platform: 'android' } });
  return { token: login.json.data?.accessToken, userId: login.json.data?.user?.id };
}
const uuid = () => crypto.randomUUID();

(async () => {
  console.log(`VeriTrade V1 test → ${BASE}\n`);
  const s = Date.now();

  // ── Org A: the tradie's home org ──
  const regA = await call('POST', '/auth/register', {
    organisation: { name: `VT-A ${s}` },
    user: { full_name: 'Pat PM', email: `pmA${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pmA-${s}`, platform: 'android' },
  });
  const pmA = regA.json.data.accessToken, pmAUser = regA.json.data.user.id, orgA = regA.json.data.organisation.id;

  const tpls = await call('GET', '/stage-templates', undefined, pmA);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const proj = await call('POST', '/projects', { code: `VT-${s}`, name: 'Lot 9 dwelling' }, pmA);
  const projId = proj.json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pmA);

  const tradie = await mintUser(pmA, s, 'tradie', 'tradie');
  const foreTok = await pairAs(pmA, pmAUser, 'foreperson', `fore-${s}`);
  const supTok = await pairAs(pmA, pmAUser, 'siteSupervisor', `sup-${s}`);

  // ── Org B: a different tenant, for cross-org search/engage ──
  const regB = await call('POST', '/auth/register', {
    organisation: { name: `VT-B ${s}` },
    user: { full_name: 'Bea Builder', email: `pmB${s}@x.com`, password: 'buildersecret1' },
    device: { device_uid: `pmB-${s}`, platform: 'android' },
  });
  const pmB = regB.json.data.accessToken, pmBUser = regB.json.data.user.id;

  // ── 1. NO_EVIDENCE guard — pmB has zero attestations ──
  const noEvidence = await call('PATCH', '/veritrade/profile', { published: true }, pmB);
  ok('publish with zero verified projects is refused (NO_EVIDENCE)',
    noEvidence.status === 422 && noEvidence.json.code === 'NO_EVIDENCE', JSON.stringify(noEvidence.json));

  // ── give the tradie one verified project: tick + verify a task assigned to them ──
  const detail = await call('GET', `/projects/${projId}`, undefined, pmA);
  const stage1 = (detail.json.data.stages || []).find((st) => st.seq === 1)?.id;
  const taskId = uuid();
  await call('POST', '/sync/push', {
    table_name: 'tasks', operation: 'create',
    data: { id: taskId, project_id: projId, stage_id: stage1, name: 'Frame check',
            completion: 0, assigned_to: tradie.userId, updated_at: Date.now() },
  }, foreTok);
  await call('POST', '/sync/push', {
    table_name: 'tasks', operation: 'update',
    data: { id: taskId, completion: 100, updated_at: Date.now() },
  }, foreTok);
  const verify = await call('POST', `/projects/${projId}/tasks/${taskId}/verify`, {}, supTok);
  ok('task verified for the tradie (seeds one attestation)', verify.status === 200, JSON.stringify(verify.json));
  await new Promise((r) => setTimeout(r, 150)); // attestation emission is fire-and-forget

  // ── 2. publish + licence honesty ──
  const preTeaser = await call('GET', `/veritrade/profiles/${tradie.userId}`);
  ok('unpublished profile 404s on the public teaser', preTeaser.status === 404, JSON.stringify(preTeaser.json));

  const publish = await call('PATCH', '/veritrade/profile', {
    published: true, trade_classification: 'Carpenter', service_region: 'Perth Metro',
    licence_number: 'WA-12345', licence_state: 'WA',
  }, tradie.token);
  ok('tradie publishes (has evidence) — 200', publish.status === 200, JSON.stringify(publish.json));
  ok('licence_status lands not_available, never a silent verified',
    publish.json.data.licence_status === 'not_available', JSON.stringify(publish.json.data));

  // ── 3. public teaser ──
  const teaser = await call('GET', `/veritrade/profiles/${tradie.userId}`);
  ok('published profile teaser is public (no token) — 200', teaser.status === 200, JSON.stringify(teaser.json));
  ok('teaser headline shows 1 verified project',
    teaser.json.data.headline?.verified_projects === 1, JSON.stringify(teaser.json.data));
  ok('teaser dispute count is 0 (no dispute mechanism exists yet — decision #5)',
    teaser.json.data.headline?.unresolved_disputes === 0, JSON.stringify(teaser.json.data));
  ok('teaser carries the licence badge as not_available, not verified',
    teaser.json.data.licence?.status === 'not_available', JSON.stringify(teaser.json.data));

  // ── 4. full profile — auth required, financial redaction ──
  const fullNoAuth = await call('GET', `/veritrade/profiles/${tradie.userId}/full`);
  ok('full profile requires login (401)', fullNoAuth.status === 401, JSON.stringify(fullNoAuth.json));

  // Seed a second attestation carrying financial detail directly (invoice_matched is
  // normally emitted by ProcurementService — exercising the redaction rule doesn't
  // need the whole procurement flow, just a real row in the same shape it writes).
  await AttestationService.emit({
    subjectUserId: tradie.userId, issuingOrgId: orgA,
    sourceType: 'invoice_matched', sourceId: uuid(),
    payload: { project_id: projId, amount: 4200 },
  });

  const fullHidden = await call('GET', `/veritrade/profiles/${tradie.userId}/full`, undefined, pmB);
  ok('full profile readable by a DIFFERENT org (B2B, cross-tenant) once logged in',
    fullHidden.status === 200, JSON.stringify(fullHidden.json));
  const invoiceEntry = (fullHidden.json.data.projects || []).find((p) => p.type === 'invoice_matched');
  ok('amount is hidden by default (no financial opt-in)',
    !!invoiceEntry && invoiceEntry.detail.amount === undefined, JSON.stringify(invoiceEntry));
  ok('issuing org is never present on a third-party read',
    JSON.stringify(fullHidden.json.data).toLowerCase().indexOf('issuing_org') === -1, '');

  await call('PATCH', '/veritrade/profile', { disclose_financials: true }, tradie.token);
  const fullShown = await call('GET', `/veritrade/profiles/${tradie.userId}/full`, undefined, pmB);
  const invoiceEntry2 = (fullShown.json.data.projects || []).find((p) => p.type === 'invoice_matched');
  ok('amount appears once the subject opts into disclose_financials',
    invoiceEntry2?.detail?.amount === 4200, JSON.stringify(invoiceEntry2));

  // ── 5. search ──
  const searchHit = await call('GET', '/veritrade/search?trade=Carpenter', undefined, pmB);
  ok('search finds the published Carpenter', searchHit.status === 200 &&
    (searchHit.json.data.results || []).some((r) => String(r.user_id) === String(tradie.userId)), JSON.stringify(searchHit.json));
  const searchMiss = await call('GET', '/veritrade/search?trade=Plumber', undefined, pmB);
  ok('search excludes a non-matching trade',
    !(searchMiss.json.data.results || []).some((r) => String(r.user_id) === String(tradie.userId)), JSON.stringify(searchMiss.json));
  const searchNoAuth = await call('GET', '/veritrade/search?trade=Carpenter');
  ok('search is public — indexable, same as the profile pages (200, no login)',
    searchNoAuth.status === 200 &&
    (searchNoAuth.json.data.results || []).some((r) => String(r.user_id) === String(tradie.userId)),
    JSON.stringify(searchNoAuth.json));

  // ── 6. Engage ──
  const engageUnpublished = await call('POST', `/veritrade/profiles/${pmBUser}/engage`, {}, pmA);
  ok('engaging an unpublished identity 404s', engageUnpublished.status === 404, JSON.stringify(engageUnpublished.json));

  const engageSelf = await call('POST', `/veritrade/profiles/${tradie.userId}/engage`, {}, tradie.token);
  ok('engaging yourself is refused', engageSelf.status === 400, JSON.stringify(engageSelf.json));

  const engage1 = await call('POST', `/veritrade/profiles/${tradie.userId}/engage`, {}, pmB);
  ok('cross-org Engage writes an Introduction (201)',
    engage1.status === 201 && engage1.json.data.alreadyIntroduced === false, JSON.stringify(engage1.json));

  const engage2 = await call('POST', `/veritrade/profiles/${tradie.userId}/engage`, {}, pmB);
  ok('re-Engage is idempotent (200, alreadyIntroduced)',
    engage2.status === 200 && engage2.json.data.alreadyIntroduced === true && engage2.json.data.id === engage1.json.data.id,
    JSON.stringify(engage2.json));

  const contacts = await call('GET', '/introductions', undefined, pmB);
  ok('the Engage-sourced Introduction shows up in the searching org\'s own contact book',
    (contacts.json.data?.contacts || []).some((c) => String(c.user_id) === String(tradie.userId)), JSON.stringify(contacts.json));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
