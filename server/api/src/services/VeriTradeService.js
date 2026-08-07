// VeriTradeService — V1 backend for veritradedesignspecification.md (scope locked with
// the owner 2026-08-06: publish opt-in, public teaser, gated full profile, search,
// Engage->Introduction; licence-verification integrations and subscription billing are
// OUT of this pass). Reads entirely off PM2-02's identity-scoped store (`identities`,
// `attestations`) — never queries a tenant's own org_id-scoped project data directly
// (spec §11), which is exactly what makes a profile assembleable regardless of which
// orgs the subject has ever worked for.

const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const IntroductionService = require('./IntroductionService');

// Decision (owner, 2026-08-06, spec §12 #4): a basic per-searcher daily cap, cheap to
// add now, expensive to retrofit once Engage is live and being abused.
const ENGAGE_DAILY_CAP = 20;

/** Core aggregate shared by teaser and full profile — verified-project count and a
 * years-active proxy, both computed from the existing evidence store, not cached. */
async function coreStats(userId) {
  const [[row]] = await pool.query(
    `SELECT
       COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.project_id'))) AS verified_projects,
       MIN(created_at) AS first_attestation_at
     FROM attestations WHERE subject_user_id = ?`,
    [userId]
  );
  const [[user]] = await pool.query(`SELECT created_at FROM users WHERE id = ? LIMIT 1`, [userId]);
  // "Years active" is a proxy — how long the person's evidence has existed on the
  // platform, not their real-world trade tenure (nothing in the payload shapes any
  // emitter writes today carries a career-start date). Anchors on the earlier of the
  // first attestation or account creation.
  const since = row.first_attestation_at && user?.created_at
    ? new Date(Math.min(new Date(row.first_attestation_at), new Date(user.created_at)))
    : (row.first_attestation_at ? new Date(row.first_attestation_at) : (user?.created_at ? new Date(user.created_at) : null));
  const yearsActive = since ? Math.max(0, (Date.now() - since.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : 0;
  return {
    verified_projects: Number(row.verified_projects) || 0,
    // Decision #5 (owner, 2026-08-06): internal only for V1 — no dispute mechanism
    // exists anywhere in the codebase yet to source this from, so 0 is the honest
    // figure, not a placeholder standing in for real data.
    unresolved_disputes: 0,
    years_active: Math.round(yearsActive * 10) / 10,
  };
}

async function loadPublished(userId) {
  const [[row]] = await pool.query(
    `SELECT u.id, u.full_name, u.role, u.is_deleted,
            i.veritrade_published, i.trade_classification, i.service_region,
            i.licence_number, i.licence_state, i.licence_status, i.veritrade_disclose_financials
       FROM identities i
       JOIN users u ON u.id = i.user_id
      WHERE i.user_id = ? LIMIT 1`,
    [userId]
  );
  if (!row || row.is_deleted || !row.veritrade_published) return null;
  return row;
}

/** GET /veritrade/profiles/:userId — public teaser (spec §5.1). No auth. */
async function publicTeaser(userId) {
  const profile = await loadPublished(userId);
  if (!profile) throw new ServiceError('NOT_FOUND', 'No published VeriTrade profile for this identity', 404);
  const stats = await coreStats(userId);
  return {
    user_id: profile.id,
    full_name: profile.full_name,
    trade_classification: profile.trade_classification,
    years_active: stats.years_active,
    licence: { status: profile.licence_status, state: profile.licence_state },
    headline: { verified_projects: stats.verified_projects, unresolved_disputes: stats.unresolved_disputes },
  };
}

/** GET /veritrade/profiles/:userId/full — gated full profile (spec §5.2). Any
 * authenticated App identity may view (V1: login-gated, not entitlement-gated — the
 * owner's "core loop only" scope defers the paid B2B subscription check). */
async function fullProfile(userId) {
  const profile = await loadPublished(userId);
  if (!profile) throw new ServiceError('NOT_FOUND', 'No published VeriTrade profile for this identity', 404);
  const stats = await coreStats(userId);

  const [rows] = await pool.query(
    `SELECT source_type, source_id, payload_json, created_at
       FROM attestations WHERE subject_user_id = ? ORDER BY created_at DESC`,
    [userId]
  );
  const showFinancials = !!profile.veritrade_disclose_financials;
  const projects = rows.map((r) => {
    const payload = typeof r.payload_json === 'string' ? JSON.parse(r.payload_json) : r.payload_json;
    // Decision #28 (carried from PM2-02): issuing org is NEVER shown to a third
    // party, only to the subject's own /identity/evidence read. Financial detail
    // (an invoice-matched amount) is a second, narrower opt-in — spec §5.2's "where
    // the worker has opted to disclose it" — separate from general publish.
    const { amount, ...rest } = payload || {};
    return {
      type: r.source_type,
      date: r.created_at,
      ...(rest.project_id ? { project_id: rest.project_id } : {}),
      detail: showFinancials ? payload : rest,
    };
  });

  return {
    user_id: profile.id,
    full_name: profile.full_name,
    trade_classification: profile.trade_classification,
    service_region: profile.service_region,
    years_active: stats.years_active,
    licence: { status: profile.licence_status, state: profile.licence_state, number: profile.licence_number },
    headline: { verified_projects: stats.verified_projects, unresolved_disputes: stats.unresolved_disputes },
    projects,
  };
}

/** GET /veritrade/profile — the caller's OWN settings, regardless of publish status.
 * Deliberately separate from `loadPublished`/`fullProfile`, which return null/404
 * for anyone unpublished — a person needs to see their own draft fields (and how
 * many verified projects they already have towards the NO_EVIDENCE bar) BEFORE
 * they've published anything, which those two can never serve. */
async function myProfile(userId) {
  await pool.query(`INSERT INTO identities (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id`, [userId]);
  const [[row]] = await pool.query(
    `SELECT veritrade_published, veritrade_published_at, trade_classification, service_region,
            licence_number, licence_state, licence_status, veritrade_disclose_financials
       FROM identities WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM attestations WHERE subject_user_id = ?`, [userId]);
  return { ...row, verified_projects: Number(n) || 0 };
}

/** PATCH /veritrade/profile — self-service publish toggle + profile fields. */
async function updateProfile({ userId, published, tradeClassification, serviceRegion, licenceNumber, licenceState, discloseFinancials }) {
  await pool.query(`INSERT INTO identities (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id`, [userId]);

  if (published === true) {
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM attestations WHERE subject_user_id = ?`, [userId]);
    if (Number(n) === 0) {
      // Spec §1: "every project on a profile is anchored to..." — an empty profile
      // has nothing to anchor, and publishing one would be indistinguishable from
      // the unverified directory listings this product exists to replace.
      throw new ServiceError('NO_EVIDENCE', 'Publish requires at least one verified project on your Verified Work History', 422);
    }
  }

  const sets = [];
  const params = [];
  if (published !== undefined) {
    sets.push('veritrade_published = ?', 'veritrade_published_at = ?');
    params.push(published ? 1 : 0, published ? new Date() : null);
  }
  if (tradeClassification !== undefined) { sets.push('trade_classification = ?'); params.push(tradeClassification || null); }
  if (serviceRegion !== undefined) { sets.push('service_region = ?'); params.push(serviceRegion || null); }
  if (discloseFinancials !== undefined) { sets.push('veritrade_disclose_financials = ?'); params.push(discloseFinancials ? 1 : 0); }
  if (licenceNumber !== undefined || licenceState !== undefined) {
    sets.push('licence_number = ?', 'licence_state = ?', 'licence_status = ?', 'licence_verified_at = NULL');
    // Spec §6's design consequence: never silently claim verified — no state
    // integration exists in this build, for any state, so submitting licence
    // details always lands as 'not_available', not a false positive.
    params.push(licenceNumber || null, licenceState || null, (licenceNumber || licenceState) ? 'not_available' : 'unverified');
  }
  if (sets.length) {
    await pool.query(`UPDATE identities SET ${sets.join(', ')} WHERE user_id = ?`, [...params, userId]);
  }

  const [[row]] = await pool.query(
    `SELECT veritrade_published, veritrade_published_at, trade_classification, service_region,
            licence_number, licence_state, licence_status, veritrade_disclose_financials
       FROM identities WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  return row;
}

/** GET /veritrade/search — demand side (spec §10). PUBLIC, teaser-level rows only
 * (spec §5.1/§11: indexable by design, same as the individual profile pages — V1
 * never confirms a subscription entitlement, so this simply never returns more than
 * teaser fields regardless of who's asking). */
async function search({ trade, licenceState, region, minVerifiedProjects }) {
  const min = Number.isFinite(Number(minVerifiedProjects)) ? Number(minVerifiedProjects) : null;
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, i.trade_classification, i.service_region,
            i.licence_state, i.licence_status,
            (SELECT COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(a.payload_json, '$.project_id')))
               FROM attestations a WHERE a.subject_user_id = u.id) AS verified_projects
       FROM identities i
       JOIN users u ON u.id = i.user_id AND u.is_deleted = 0
      WHERE i.veritrade_published = 1
        AND (? IS NULL OR i.trade_classification LIKE CONCAT('%', ?, '%'))
        AND (? IS NULL OR i.licence_state = ?)
        AND (? IS NULL OR i.service_region LIKE CONCAT('%', ?, '%'))
     HAVING (? IS NULL OR verified_projects >= ?)
      ORDER BY verified_projects DESC
      LIMIT 50`,
    [trade || null, trade || null, licenceState || null, licenceState || null,
     region || null, region || null, min, min]
  );
  return { results: rows.map((r) => ({
    user_id: r.id, full_name: r.full_name, trade_classification: r.trade_classification,
    licence: { status: r.licence_status, state: r.licence_state },
    headline: { verified_projects: Number(r.verified_projects) || 0 },
  })) };
}

/** POST /veritrade/profiles/:userId/engage — spec §7. The discovery-to-relationship
 * loop's first step: writes an Introduction (cross-org, via IntroductionService's
 * dedicated path), not a bypass of it. A Job Award still needs its own later step
 * through Portal, same as any contact sourced any other way. */
async function engage({ actorOrgId, actorUserId, targetUserId }) {
  const profile = await loadPublished(targetUserId);
  if (!profile) throw new ServiceError('NOT_FOUND', 'No published VeriTrade profile for this identity', 404);

  // Re-engaging an already-connected contact is a no-op read, not new outreach — it
  // must not burn the daily cap, or a searcher revisiting their own contact list
  // would eventually lock themselves out of making any NEW introductions.
  const already = await IntroductionService.crossOrgExists({ userAId: actorUserId, userBId: targetUserId });
  if (already) return IntroductionService.crossOrgEngage({ actorOrgId, actorUserId, targetUserId });

  const [[{ n }]] = await pool.query(
    `SELECT COUNT(*) AS n FROM introductions
      WHERE party_a_id = ? AND initiated_by = 'veritrade_engage' AND created_at > NOW() - INTERVAL 1 DAY`,
    [actorUserId]
  );
  if (Number(n) >= ENGAGE_DAILY_CAP) {
    throw new ServiceError('RATE_LIMITED', `Engage is capped at ${ENGAGE_DAILY_CAP} per day`, 429);
  }

  return IntroductionService.crossOrgEngage({ actorOrgId, actorUserId, targetUserId });
}

module.exports = { publicTeaser, fullProfile, updateProfile, search, engage, myProfile };
