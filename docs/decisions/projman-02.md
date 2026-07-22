# ProjMan-02 — Cross-tenant engagement & Verified Work History (architecture decision)

**Status:** 🟢 APPROVED — signed off 2026-07-22 (owner + NexusPM). Forks **A1**,
**A1+B2 synthesis**, **C1+C2** chosen; `/identity/share` added (§5). Build proceeds
per §9; NexusPM confirms feasibility and drafts `projman-03` (domain tables) against
this scoping model.
**Date:** 2026-07-22
**Maintained by:** App team (FtposPM) · **Counterpart:** Server dev (NexusPM)
**Series note:** `projman-01` (identity) forward-referenced "projman-02 = domain
tables." That is **renumbered to `projman-03`** — the cross-tenant model below must
be settled *first*, because it decides how every domain table is scoped (by `org_id`
alone, or by project-grant). projman-01 §scope updated to match.

**Why this record exists.** ProjMan2's differentiator is that a **tradie is
independent and works across many builders at once**, and that **every interaction
becomes portable, verifiable evidence** (development.md §10). Both collide head-on
with the platform's hardest guarantee — **tenant isolation** — which projman-01
proved with 16/16 tests. This record decides how to have both. It **gates**: the
Inspector role, "Join Project" via QR, tradie cross-org sharing, and the trust
score (appdesignspecification §1, §5.6, §8). It runs **in parallel with P3**.

---

## 1. The tension, precisely

- **Isolation (must keep):** "nothing crosses the tenant boundary" (development.md
  §0). Every row carries `org_id`; every server query filters on the token's org
  (projman-01 §1.7, §3.3). Builder A must never see Builder B.
- **Portability (must add):** a tradie's evidence — completion rate, inspection
  pass rate, safety record — must **span many builders** and be **owned by the
  tradie** (development.md §11.2), so they carry it when they change who they work
  for. That is a cross-tenant flow isolation otherwise forbids.

These reconcile only if we stop treating "the tenant" as the single scoping unit.

## 2. Three scoping domains (the core idea)

| Domain | Scopes | Who sees it | Status |
|---|---|---|---|
| **Org (tenant)** | a builder's project data | that org's members | **exists** (projman-01) |
| **Engagement** | one external party granted a **scoped slice of one project** | that party, for that project only | **new** |
| **Identity (evidence)** | a person's portable Verified Work History | that person (owner); others by consent | **new** |

The QR trust exchange creates an **engagement**. Working an engagement **emits
signed attestations** into the party's **identity-scoped evidence store**, which
lives *outside any builder's tenant*. Builder A's project detail never reaches
Builder B — only an abstracted, signed attestation reaches the tradie's own record.

## 3. Model

### 3.1 Entities (proposed)
```
engagements        id, owner_org_id, project_id, grantee_identity_id,
                   role (tradie|subcontractor|inspector), scope_json (surfaces/tasks),
                   status (pending|active|expired|revoked), granted_by, granted_at,
                   expires_at, revoked_at, qr_nonce, signed_by_device_key
                   -- the QR trust-exchange result; the cross-tenant grant

attestations       id, subject_identity_id, engagement_id, kind (task_complete|
                   inspection_pass|attendance|safety_event|completion|…),
                   outcome, project_complexity, occurred_at,
                   issuer_org_id, issuer_signature, counterparty_visibility
                   -- identity-scoped, signed; the portable evidence unit

identities         id, kind (org_member|sole_trader|external_party),
                   home_org_id?, display_name, trust_score_cache
                   -- a person; a tradie is a sole_trader identity with its own store
```
`scope_json` is what makes isolation hold at the engagement level: it names exactly
which surfaces (their tasks, the stage programme, site capture) and never costs,
rates, or other trades.

### 3.2 The QR trust exchange (one primitive, whole chain)
Same handshake client→builder→subcontractor→tradie (development.md §10.1):
1. **Principal** (engaging party's primary device) generates a signed QR
   `{v, org, project, id, nonce, role, expires}` — signed by the device key.
2. Other party scans → **shares their verified profile** (identity + trust score).
3. Principal **reviews → accepts/declines**, choosing `scope_json`.
4. On accept: an **engagement** row is created; project data flows scoped;
   attestations begin accruing on both sides.

Distinct from projman-01 device pairing: pairing binds *one device to one org* with
a role (intra-org, exists); the trust exchange grants a *cross-org project
engagement* and is *bidirectional* (a profile is exchanged, not just a role set).

---

## 4. Decisions needed

> **RESOLVED 2026-07-22:** **A → A1** (own account) · **B → A1+B2 synthesis**
> (one owned account tying together single-org session-contexts; isolation core
> untouched) · **C → both** (C1 external + C2 in-house). Rationale below stands.

### Decision A — tradie identity ✅ A1
- **A1 (recommend): own account.** A tradie registers once (a `sole_trader`
  identity) and **owns** their evidence store; engagements link builders' projects
  to this identity. One login, portable across builders, survives changing who they
  work for — matches how a subbie actually operates.
- **A2: read-time assembly.** No standing owned store; evidence assembled on demand
  across engagements. Lighter storage, but "tradie owns their history" (dev.md
  §11.2) is hard to honour, and cross-engagement queries need an identity index
  anyway. **Weaker.**

### Decision B — multi-builder session model ⟨choose; the consequential one⟩
- **B1: one session, many grants.** The token identifies the *person*; the server
  scopes each request to `home_org ∪ engaged-project-slices`. Best UX (no
  switching) — **but it changes the proven single-`org_id` isolation filter** (the
  thing that passed 16/16), so it carries the most server risk.
- **B2: many session-contexts, device switches.** The device holds one context per
  builder (each single-org), switched like MAOI's profile switcher. **Preserves the
  isolation core untouched** — each session stays single-tenant — at the cost of a
  switcher UX.
- **Recommended synthesis — A1 + B2:** the tradie has **one owned account** (A1)
  that **ties together per-builder session-contexts** (B2); each context stays
  single-org so NexusPM's isolation core is **not touched**, and the
  **identity-scoped evidence store** is fed by attestations regardless of which
  context produced them. Best risk/UX balance. (Pure B1 remains an option if we
  later want seamless multi-org in one view.)

### Decision C — inspector engagement ⟨choose; likely "both"⟩
- **C1: external engaged party** (uses the engagement mechanism, like a tradie) —
  matches real independent certifiers/surveyors who inspect for many builders.
- **C2: intra-org paired device** ("Inspector — [Project]", reuses projman-01
  pairing) — for a builder's in-house inspector.
- **Recommend: support both.** In-house = C2 (buildable now); external certifier =
  C1 (this record). The app's Inspector role (appspec §1) renders the same Quality-
  only surface either way.

---

## 5. Server impact (for NexusPM to react to)

The heart of it: **sync scoping generalises from "filter by token.org_id" to
"filter by the caller's scope set."** Under the recommended A1+B2, each session is
still single-org, so **the existing filter is reused per context** — the new work is:

- **`engagements`** table + resolution: given a session context, the server already
  knows its org; for an *engaged* context, pull returns the `scope_json` slice of
  `project_id`, not the whole org. Isolation still enforced server-side.
- **Attestation emission:** on qualifying writes (task complete, inspection result,
  attendance, completion), the server appends a **signed** attestation to the
  subject identity's store. Issuer signs; counterparty visibility per consent.
- **The identity-scoped store** is a new isolation domain — queryable by the owning
  identity; never by a builder org except for attestations that org issued.

Proposed endpoints (shapes NexusPM's call, mirroring projman-01 style):
```
POST /engagements/initiate   (Principal) → signed QR payload {v,org,project,id,nonce,role,expires}
POST /engagements/request    (party, scans) → shares verified profile
GET  /engagements/pending    (Principal) → inbound requests
POST /engagements/confirm    (Principal) → engagement active, scope_json set
POST /engagements/:id/revoke → revoke a grant (kills the scoped access)
GET  /identity/evidence      (owner) → their attestation set + trust score
GET  /identity/:id/profile   (with consent) → verified profile for the QR exchange
POST /identity/share         (owner) → grant a named party/engagement a consented,
                             time-boxed read of the owner's verified profile /
                             evidence subset; the consent record the QR exchange and
                             /identity/:id/profile check. (NexusPM addition, approved.)
```
Sync (`/sync/pull`) stays the same envelope; only the server-side scope resolution
changes for engaged contexts. **Isolation invariants of projman-01 §3.3 hold
unchanged** — this adds domains, it does not weaken the boundary.

## 6. Privacy (development.md §11, non-negotiable)
- The **tradie owns** their evidence; they control what a QR exchange reveals.
- **Counterparties anonymised** in reputation scores unless named by consent; a
  builder's project detail never rides an attestation into another builder's view.
- **AU data residency** applies to the evidence store as to everything else.
- Geofenced attendance (appspec §5.3) is the anti-fraud input that keeps
  attestations trustworthy.

## 7. What stays unchanged
projman-01 identity, the sync envelope (§3), the single-writer ownership matrix
(§4), and — critically — **tenant isolation**. This record adds engagement- and
identity-scoping *alongside* org-scoping; it does not relax org isolation.

## 8. Decision checklist — SIGNED OFF 2026-07-22
- [x] **A** — tradie identity: **A1 own account**
- [x] **B** — session model: **A1+B2 synthesis** (session-context switching)
- [x] **C** — inspector: **both** (C1 external + C2 in-house)
- [x] NexusPM: endpoint shapes (§5) accepted; **one addition — `POST /identity/share`**
- [x] Confirmed this is `projman-02`; domain tables move to `projman-03`

## 9. Sequencing (refined, signed off)

Runs **parallel with P3**. Build order:

| Step | Deliverable | Depends on |
|---|---|---|
| 1 | `engagements` table + QR `initiate`/`request`/`confirm` endpoints | this sign-off |
| 2 | Scoped pull resolution (sync pulls engaged rows) | Step 1 |
| 3 | Attestation emission from domain modules | P4/P5/P6 domain modules |
| 4 | `identities` table + evidence store API (`/identity/*` incl. `/identity/share`) | Step 3 |
| 5 | Trust-score calculation | Step 4 |
| 6 | App UI: Inspector, Join Project, verified badge | Step 5 |

**Note:** Profile → **Pair Device** (intra-org, projman-01 §1.3) already exists and
does **not** wait for this record. Project → **Join Project** (cross-org) waits for
**Step 2**. Gates appdesignspecification §1, §5.6, §8.

---

## 10. NexusPM responses to the open items (server dev, 2026-07-22)

**Feasibility: confirmed.** A1+B2 is buildable on the current core without touching
the isolation filter — each session-context stays single-org, so projman-01 §3.3
holds unchanged. The clean seam is already in place: I extracted `SyncService`
(`pullDeltas`) this turn, so scoped resolution for an engaged context is an extension
of one method, not a rewrite of the sync route. `engagements`/`identities`/
`attestations` land in `projman-03` alongside the domain tables, registered the same
way (one `sync/registry.js` entry each, per projman-01 §2.4).

**1. Org signing keys → server-generated, encrypted at rest. Agreed, with a split.**
There are **two** key types and they live in different places:
- **Org issuer key (attestations):** the server signs attestations on qualifying
  writes (§5), so it must hold this private key. **Server-generates an Ed25519
  keypair at org creation** (small signatures — ideal for QR payloads and attestation
  rows), private key **encrypted at rest via envelope encryption** (per-org data key
  wrapped by a master key from KMS; in the AU deploy → AWS KMS `ap-southeast-2`). The
  public key is freely distributable for verification.
- **Device key (QR signing):** the QR is signed by the **device** (§3.2), so for
  non-repudiation the **private key never touches the server** — the app generates it
  on-device and registers only the **public key** (exactly Nexus's
  `device_registry.device_key_pub`, ES256). So: refine the recommendation — org key
  server-generated+held; device key app-generated, server stores public only.

**2. Attestation signatures → verify on presentation AND at the trust-score job.
Agreed, refined.** Store the signature always; it is valid by construction at
emission (the server issued it). **Verify** — cheap with Ed25519 — on every read that
feeds a *trust decision*: the trust-score calculation and the `/identity/*` profile
share. Cache the result on the row (`signature_valid`, `verified_at`) so repeated
reads don't re-verify; re-verify on issuer-key rotation. A forged or tampered
attestation is **excluded from the score**, not just flagged.

**3. Trust score → on-demand + 24h cache + event invalidation. Agreed, refined.**
`identities.trust_score_cache` already anticipates this. Compute on demand, cache 24h
— **but bust the cache when a new attestation lands** for that identity (null the
cache on attestation insert; next read recomputes). That gives near-immediate
freshness after a meaningful event (a pass, a completion) without a batch job, and
without the thrash of recompute-on-every-write during an attestation burst. Not
real-time; on-demand + cache + event-invalidate is the balance.

**4. Engagement revocation → server-driven tombstone, not client-memory. Agreed,
strengthened.** The app checking status each pull is the *trigger*, but the **server
makes it deterministic**:
- On revoke, scope resolution **immediately stops serving** that engagement's rows,
  and the engaged context's **sessions are invalidated** (reusing projman-01's
  session-revocation — the party can't pull even the stale slice).
- The next scoped pull returns an explicit **`engagement_revoked` tombstone** for that
  engagement (the same soft-delete-tombstone pattern as projman-01 §3.3), instructing
  the app to delete the local slice — so removal doesn't depend on the client
  remembering to check. Locally-captured evidence the party legitimately authored
  still flows to *their own* identity store (it's theirs); only the builder's scoped
  project data is torn down.

None of these block `projman-03` drafting — they are the `engagements`/`identities`
mechanics, which I'll spec into projman-03 §(engagement) with these decisions baked in.
