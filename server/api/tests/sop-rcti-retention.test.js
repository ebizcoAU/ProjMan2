// SOP templates, RCTI agreements and retention (xprojman-43 R3, migration v054).
//
//   1. SOP rules as data: GET /sop-templates (NSW/QLD/ACT, all unverified); business-day maths.
//   2. Progress claim SOP: SOP_TEMPLATE_INCOMPLETE (NSW needs the supporting statement), the
//      statement rendered, due dates computed, SOP_PERIOD_UNVERIFIED + SOP_STATE_MISMATCH warn only;
//      an ordinary claim is untouched. Payment schedule: SCHEDULE_REASON_REQUIRED, recorded.
//   3. RCTI: RCTI_NO_AGREEMENT, agreement (supplier + claimant, exactly one), the flag on/off,
//      an expired/revoked agreement no longer counts, RCTI_AGREEMENT_NO_DOCUMENT warns.
//   4. Retention: default from retention_pct, CONTRACT_REQUIRED, pay is net, the summary,
//      partial releases + RETENTION_EXCEEDS_HELD, a TPAR payment row for the claimant.
//   5. Client claims: SOP_OWNER_OCCUPIER, SOP on a developer client at issue, retention on the
//      client contract (sole contract assumed).
//
// Run: DB_NAME=c1projman2_e2e DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &
//      DB_NAME=c1projman2_e2e BASE=http://localhost:4199 node tests/sop-rcti-retention.test.js
const crypto = require('crypto');
const pool = require('../src/db/pool');
const SopService = require('../src/services/SopService');
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';

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
async function postDoc(fields, token) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n', 'ascii'), crypto.randomBytes(64)]);
  fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'statement.pdf');
  const res = await fetch(`${BASE}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  return res.json();
}
async function pairAs(admin, userId, role, uid) {
  const init = await call('POST', '/pairing/initiate', { role, label: uid, assign_user_id: userId }, admin);
  const rid = init.json.data.request_id, nonce = init.json.data.qr_payload.nonce;
  await call('POST', '/pairing/request', { request_id: rid, nonce, device_uid: uid, platform: 'android' });
  await call('POST', '/pairing/confirm', { request_id: rid, role }, admin);
  const st = await call('GET', `/pairing/status/${rid}?device_uid=${uid}`);
  return st.json.data?.accessToken;
}
const codes = (r) => (r.json.warnings || []).map((w) => w.code);

(async () => {
  console.log(`SOP / RCTI / retention test → ${BASE}\n`);
  const s = Date.now();
  const reg = await call('POST', '/auth/register', {
    organisation: { name: `R3 ${s}` },
    user: { full_name: 'Pat PM', email: `r3pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `r3pm-${s}`, platform: 'web' },
  });
  const pm = reg.json.data.accessToken, pmUser = reg.json.data.user.id;
  const [[me]] = await pool.query('SELECT org_id FROM users WHERE id = ?', [pmUser]);
  await pool.query("UPDATE organisations SET state = 'NSW', gst_registered = 1 WHERE id = ?", [me.org_id]);
  const builder = await pairAs(pm, pmUser, 'builder', `r3b-${s}`);
  const tradie = await pairAs(pm, pmUser, 'tradie', `r3t-${s}`);
  const projId = (await call('POST', '/projects', { code: `R3-${s}`, name: 'Townhouses', contract_value: 800000 }, pm)).json.data.id;

  // ── 1. Rules as data ──
  const rules = await call('GET', '/sop-templates', undefined, pm);
  const st = rules.json.data?.sop_templates || [];
  ok('GET /sop-templates lists NSW, QLD and ACT, none verified, each with a period',
    rules.status === 200 && ['ACT', 'NSW', 'QLD'].every((x) => st.some((t) => t.state === x))
      && st.every((t) => t.verified === false && t.period && t.period.verified === false), JSON.stringify(rules.json).slice(0, 300));
  ok('NSW requires the s13(7) supporting statement', st.find((t) => t.state === 'NSW')?.required_fields.includes('supporting_statement'));
  ok('business days skip the weekend (Fri + 1 = Mon; Fri + 10 = Fri two weeks on)',
    SopService.addDays('2026-10-16 10:00:00', 1, true) === '2026-10-19 10:00:00'
      && SopService.addDays('2026-10-16 10:00:00', 10, true) === '2026-10-30 10:00:00'
      && SopService.addDays('2026-10-16 10:00:00', 3, false) === '2026-10-19 10:00:00');

  // ── 2. Progress claim SOP ──
  const plain = await call('POST', `/projects/${projId}/progress-claims`, { amount: 1000 }, builder);
  ok('an ordinary claim is unchanged: no SOP fields, no warnings',
    plain.status === 201 && plain.json.data.sop_state === null && plain.json.data.schedule_due_at === null && !plain.json.warnings,
    JSON.stringify(plain.json));
  const incomplete = await call('POST', `/projects/${projId}/progress-claims`,
    { amount: 5000, sop_state: 'NSW', work_description: 'Frame, units 1-4', reference_date: '2026-10-14' }, builder);
  ok('an NSW SOP claim without the supporting statement is refused (SOP_TEMPLATE_INCOMPLETE, missing listed)',
    incomplete.status === 409 && incomplete.json.code === 'SOP_TEMPLATE_INCOMPLETE'
      && JSON.stringify(incomplete.json.details?.missing) === '["supporting_statement"]', JSON.stringify(incomplete.json));
  const badState = await call('POST', `/projects/${projId}/progress-claims`, { amount: 5000, sop_state: 'VIC' }, builder);
  ok('a state with no template is a 400', badState.status === 400, JSON.stringify(badState.json));
  const doc = await postDoc({ client_ref: crypto.randomUUID(), entity_type: 'project', entity_id: projId, project_id: projId, kind: 'general' }, pm);
  const docId = doc.data?.document_id;
  ok('(setup) a supporting statement document is uploaded', !!docId, JSON.stringify(doc));
  const nsw = await call('POST', `/projects/${projId}/progress-claims`, {
    amount: 5000, sop_state: 'NSW', work_description: 'Frame, units 1-4', reference_date: '2026-10-14',
    supporting_statement_document_id: docId,
  }, builder);
  const nd = nsw.json.data || {};
  ok('a complete NSW SOP claim is accepted, with the Act statement rendered on',
    nsw.status === 201 && nd.sop_state === 'NSW' && /Security of Payment Act 1999 \(NSW\)/.test(nd.sop_statement || ''), JSON.stringify(nsw.json));
  ok('…the due dates are computed (schedule 10, payment 15 business days)',
    !!nd.schedule_due_at && !!nd.payment_due_at && nd.payment_due_at > nd.schedule_due_at, JSON.stringify(nd));
  ok('…and it warns, never blocks: SOP_TEMPLATE_UNVERIFIED + SOP_PERIOD_UNVERIFIED, no state mismatch (site is NSW)',
    codes(nsw).includes('SOP_PERIOD_UNVERIFIED') && codes(nsw).includes('SOP_TEMPLATE_UNVERIFIED') && !codes(nsw).includes('SOP_STATE_MISMATCH'),
    JSON.stringify(nsw.json.warnings));
  const qld = await call('POST', `/projects/${projId}/progress-claims`,
    { amount: 2500, sop_state: 'QLD', work_description: 'Roof', reference_date: '2026-10-14' }, builder);
  ok('a QLD claim on an NSW site warns SOP_STATE_MISMATCH and renders the payment request with the amount',
    qld.status === 201 && codes(qld).includes('SOP_STATE_MISMATCH') && /requests payment .*\$2,500\.00/.test(qld.json.data.sop_statement || ''),
    JSON.stringify(qld.json));

  const tooLow = await call('POST', `/projects/${projId}/progress-claims/${nd.id}/schedule`, { scheduled_amount: 4000 }, pm);
  ok('scheduling less than claimed needs a reason (SCHEDULE_REASON_REQUIRED)',
    tooLow.status === 400 && tooLow.json.code === 'SCHEDULE_REASON_REQUIRED', JSON.stringify(tooLow.json));
  const bSched = await call('POST', `/projects/${projId}/progress-claims/${nd.id}/schedule`, { scheduled_amount: 5000 }, builder);
  ok('the claimant cannot schedule their own claim (claims.approve)', bSched.status === 403);
  const sched = await call('POST', `/projects/${projId}/progress-claims/${nd.id}/schedule`,
    { scheduled_amount: 4000, schedule_reason: 'Unit 4 frame not inspected' }, pm);
  const [[schedRow]] = await pool.query('SELECT scheduled_amount, schedule_reason, scheduled_by FROM progress_claims WHERE id = ?', [nd.id]);
  ok('the PM records a payment schedule with the reason, on time (no late warning)',
    sched.status === 200 && Number(schedRow.scheduled_amount) === 4000 && schedRow.scheduled_by === pmUser && !sched.json.warnings,
    JSON.stringify(sched.json));

  // ── 3. RCTI ──
  const noAgr = await call('POST', `/projects/${projId}/progress-claims/${nd.id}/rcti`, { issued: true }, pm);
  ok('flagging an RCTI with no agreement is refused (RCTI_NO_AGREEMENT)', noAgr.status === 409 && noAgr.json.code === 'RCTI_NO_AGREEMENT', JSON.stringify(noAgr.json));
  const both = await call('POST', '/rcti-agreements', { party_user_id: pmUser, supplier_id: 'x', agreed_at: '2026-10-01' }, pm);
  ok('an agreement names exactly one counterparty (400)', both.status === 400);
  const tAgr = await call('POST', '/rcti-agreements', { party_user_id: pmUser, agreed_at: '2026-10-01' }, tradie);
  ok('a role without money.write cannot record a claimant agreement (403)', tAgr.status === 403);
  const agr = await call('POST', '/rcti-agreements', { party_user_id: pmUser, agreed_at: '2026-10-01' }, pm);
  ok('the PM records a claimant agreement; with no signed copy it warns RCTI_AGREEMENT_NO_DOCUMENT',
    agr.status === 201 && agr.json.data.rcti_agreement.is_current === true && codes(agr).includes('RCTI_AGREEMENT_NO_DOCUMENT'), JSON.stringify(agr.json));
  const on = await call('POST', `/projects/${projId}/progress-claims/${nd.id}/rcti`, { issued: true }, pm);
  ok('with a current agreement the claim is flagged rcti_issued, linked to the agreement',
    on.status === 200 && on.json.data.rcti_issued === true && on.json.data.rcti_agreement_id === agr.json.data.rcti_agreement.id, JSON.stringify(on.json));
  const off = await call('POST', `/projects/${projId}/progress-claims/${nd.id}/rcti`, { issued: false }, pm);
  ok('turning the flag off is always allowed', off.status === 200 && off.json.data.rcti_issued === false && off.json.data.rcti_agreement_id === null);
  const rev = await call('POST', `/rcti-agreements/${agr.json.data.rcti_agreement.id}/revoke`, undefined, pm);
  const afterRev = await call('POST', `/projects/${projId}/progress-claims/${nd.id}/rcti`, { issued: true }, pm);
  ok('a revoked agreement no longer counts (RCTI_NO_AGREEMENT)',
    rev.status === 200 && afterRev.status === 409 && afterRev.json.code === 'RCTI_NO_AGREEMENT', JSON.stringify([rev.json, afterRev.json]));
  await call('POST', '/rcti-agreements', { party_user_id: pmUser, agreed_at: '2025-01-01', ends_at: '2025-12-31' }, pm);
  const expired = await call('POST', `/projects/${projId}/progress-claims/${nd.id}/rcti`, { issued: true }, pm);
  ok('an expired agreement doesn\'t count either', expired.status === 409 && expired.json.code === 'RCTI_NO_AGREEMENT');

  const sup = (await call('POST', '/suppliers', { name: `Timber ${s}`, abn: '51824753556' }, pm)).json.data;
  const inv = (await call('POST', `/projects/${projId}/supplier-invoices`, { supplier_id: sup.id, invoice_number: `T-${s}`, amount: 700 }, pm)).json.data;
  const invNo = await call('POST', `/projects/${projId}/supplier-invoices/${inv.id}/rcti`, { issued: true }, pm);
  ok('a supplier invoice needs an agreement with that supplier (RCTI_NO_AGREEMENT)', invNo.status === 409 && invNo.json.code === 'RCTI_NO_AGREEMENT');
  const supAgr = await call('POST', '/rcti-agreements', { supplier_id: sup.id, agreed_at: '2026-10-01', document_id: docId }, pm);
  ok('a supplier agreement with the signed copy attached: no warning', supAgr.status === 201 && !supAgr.json.warnings, JSON.stringify(supAgr.json));
  const invOn = await call('POST', `/projects/${projId}/supplier-invoices/${inv.id}/rcti`, { issued: true }, pm);
  const [[invRow]] = await pool.query('SELECT rcti_issued FROM supplier_invoices WHERE id = ?', [inv.id]);
  ok('…and the invoice is flagged', invOn.status === 200 && invRow.rcti_issued === 1, JSON.stringify(invOn.json));
  const list = await call('GET', `/rcti-agreements?current=1`, undefined, pm);
  ok('GET /rcti-agreements?current=1 lists only the current one (the supplier\'s)',
    list.status === 200 && list.json.data.rcti_agreements.length === 1 && list.json.data.rcti_agreements[0].supplier_name === `Timber ${s}`,
    JSON.stringify(list.json).slice(0, 300));

  // ── 4. Retention ──
  const subC = (await call('POST', `/projects/${projId}/contracts`,
    { party_type: 'subcontractor', party_user_id: pmUser, title: 'Builder engagement', contract_value: 600000, retention_pct: 5 }, pm)).json.data;
  const noC = await call('POST', `/projects/${projId}/progress-claims`, { amount: 1000, retention_withheld: 50 }, builder);
  ok('retention without a contract is refused (CONTRACT_REQUIRED)', noC.status === 409 && noC.json.code === 'CONTRACT_REQUIRED', JSON.stringify(noC.json));
  const rc = await call('POST', `/projects/${projId}/progress-claims`, { amount: 20000, contract_id: subC.id }, builder);
  ok('retention defaults to the contract\'s 5% (20,000 → 1,000)', rc.status === 201 && rc.json.data.retention_withheld === 1000, JSON.stringify(rc.json));
  const over = await call('POST', `/projects/${projId}/progress-claims`, { amount: 100, contract_id: subC.id, retention_withheld: 200 }, builder);
  ok('retention can\'t exceed the claim (400)', over.status === 400);
  const ap = await call('POST', `/projects/${projId}/progress-claims/${rc.json.data.id}/approve`, { accept: true, retention_withheld: 1200 }, pm);
  ok('the approver can correct the retention (1,200)', ap.status === 200, JSON.stringify(ap.json));
  const pay = await call('POST', `/projects/${projId}/progress-claims/${rc.json.data.id}/pay`, { reference: 'EFT-R' }, pm);
  const [[payRow]] = await pool.query('SELECT amount FROM project_payments WHERE id = ?', [pay.json.data?.payment_id]);
  ok('the payment is net of retention (20,000 − 1,200 = 18,800)',
    pay.status === 201 && pay.json.data.paid_amount === 18800 && Number(payRow.amount) === 18800, JSON.stringify(pay.json));
  const sum1 = await call('GET', `/projects/${projId}/retention`, undefined, pm);
  const c1 = (sum1.json.data?.contracts || []).find((c) => c.contract_id === subC.id);
  ok('the summary shows 1,200 withheld and held on the contract', sum1.status === 200 && c1?.withheld === 1200 && c1.held === 1200, JSON.stringify(sum1.json));
  const tSum = await call('GET', `/projects/${projId}/retention`, undefined, tradie);
  ok('the summary needs money.read (403)', tSum.status === 403);
  const r1 = await call('POST', `/projects/${projId}/retention-releases`,
    { contract_id: subC.id, amount: 600, reason: 'practical_completion', released_at: '2026-10-14' }, pm);
  const [[relPay]] = await pool.query('SELECT amount, purpose, tpar_reportable FROM project_payments WHERE id = ?', [r1.json.data?.payment_id]);
  ok('half released at practical completion, with a TPAR payment row to the claimant',
    r1.status === 201 && r1.json.data.held === 600 && Number(relPay?.amount) === 600 && relPay.purpose === 'retention_release' && relPay.tpar_reportable === 1,
    JSON.stringify(r1.json));
  const tooMuch = await call('POST', `/projects/${projId}/retention-releases`, { contract_id: subC.id, amount: 600.01, reason: 'dlp_end' }, pm);
  ok('releasing more than is held is refused (RETENTION_EXCEEDS_HELD)',
    tooMuch.status === 409 && tooMuch.json.code === 'RETENTION_EXCEEDS_HELD' && tooMuch.json.details?.held === 600, JSON.stringify(tooMuch.json));
  const r2 = await call('POST', `/projects/${projId}/retention-releases`, { contract_id: subC.id, amount: 600, reason: 'dlp_end' }, pm);
  const sum2 = await call('GET', `/projects/${projId}/retention`, undefined, pm);
  ok('the balance released at DLP end leaves nothing held; both releases listed',
    r2.status === 201 && sum2.json.data.totals.held === 0 && sum2.json.data.releases.length === 2, JSON.stringify(sum2.json.data));

  // ── 5. Client claims ──
  const cc = (await call('POST', `/projects/${projId}/client-claims`, { milestone: 'base' }, pm)).json.data.client_claim;
  const oo = await call('PATCH', `/client-claims/${cc.id}`, { sop_state: 'NSW' }, pm);
  ok('an owner-occupier client can\'t get an SOP claim (SOP_OWNER_OCCUPIER, the default)',
    oo.status === 409 && oo.json.code === 'SOP_OWNER_OCCUPIER', JSON.stringify(oo.json));
  const flag = await call('PATCH', `/projects/${projId}`, { client_is_owner_occupier: false }, pm);
  const [[pf]] = await pool.query('SELECT client_is_owner_occupier FROM projects WHERE id = ?', [projId]);
  ok('the PM marks the client as a developer (client_is_owner_occupier = 0)', flag.status === 200 && pf.client_is_owner_occupier === 0, JSON.stringify(flag.json).slice(0, 200));
  const noClientC = await call('PATCH', `/client-claims/${cc.id}`, { retention_withheld: 100 }, pm);
  ok('client retention needs the client contract (CONTRACT_REQUIRED when there is none)',
    noClientC.status === 409 && noClientC.json.code === 'CONTRACT_REQUIRED', JSON.stringify(noClientC.json));
  const clientC = (await call('POST', `/projects/${projId}/contracts`, { party_type: 'client', title: 'Head contract', contract_value: 800000 }, pm)).json.data;
  const ed = await call('PATCH', `/client-claims/${cc.id}`,
    { sop_state: 'NSW', work_description: 'Base stage, all units', reference_date: '2026-10-14', retention_withheld: 100 }, pm);
  const edC = ed.json.data?.client_claim || {};
  ok('a developer-client draft takes the SOP fields and retention on the sole client contract',
    ed.status === 200 && edC.sop_state === 'NSW' && edC.retention_withheld === 100 && edC.contract_id === clientC.id, JSON.stringify(ed.json).slice(0, 400));
  const issNo = await call('POST', `/client-claims/${cc.id}/issue`, undefined, pm);
  ok('issuing checks the template (SOP_TEMPLATE_INCOMPLETE: NSW supporting statement)',
    issNo.status === 409 && issNo.json.code === 'SOP_TEMPLATE_INCOMPLETE', JSON.stringify(issNo.json));
  await call('PATCH', `/client-claims/${cc.id}`, { supporting_statement_document_id: docId }, pm);
  const iss = await call('POST', `/client-claims/${cc.id}/issue`, undefined, pm);
  const issC = iss.json.data?.client_claim || {};
  ok('issued: statement rendered, SOP due dates set, unverified warning',
    iss.status === 200 && !!issC.sop_statement && !!issC.payment_due_at && codes(iss).includes('SOP_PERIOD_UNVERIFIED'), JSON.stringify(iss.json).slice(0, 500));
  const sum3 = await call('GET', `/projects/${projId}/retention`, undefined, pm);
  const c3 = sum3.json.data.contracts.find((c) => c.contract_id === clientC.id);
  ok('the issued client claim\'s retention is held on the client contract', c3?.held === 100, JSON.stringify(sum3.json.data.contracts));
  const r3 = await call('POST', `/projects/${projId}/retention-releases`, { contract_id: clientC.id, amount: 100, reason: 'dlp_end' }, pm);
  ok('a client-side release records no contractor payment', r3.status === 201 && r3.json.data.payment_id === null, JSON.stringify(r3.json));

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async (err) => { console.error(err); try { await pool.end(); } catch {} process.exit(1); });
