# VeriTrade — Product & Functional Specification

**Status:** Functional specification of record — new product
**Date:** 27 July 2026
**Owner:** eBizco Australia (Vince Phan)
**Relationship to ProjMan:** A genuinely separate, standalone public product,
fed by evidence ProjMan captures. Not a page inside Portal, not a "public
portal" — see `portaldesignspecification.md` §0 for why that distinction matters.
**Source of truth for evidence architecture:** *ProjMan — The 18-Stage
Construction Lifecycle, Fully Decomposed*, v3.4, §1.7 and Part 4 (Ethical
Safeguards) — the internal engine this product is the public face of.
**Companion docs:** `appdesignspecification.md` §2, §8 (the App is VeriTrade's
identity root) · `devroadmap.md` §7 (the identity-scoped evidence domain
prerequisite) · `serverdesignspecification.md`

---

## 1. What VeriTrade is

**Australia's premier professional network for the trade industry — an
integrity-first "LinkedIn for Tradies."** Unlike standard directories built on
unverified reviews, VeriTrade replaces gossip with ironclad proof of skill: every
project on a profile is anchored to an active state licence, backed by geotagged
site metadata, and verified by digital sign-offs from the people who supervised
the work.

**Built exclusively for B2B.** VeriTrade is for commercial builders, tier-1
contractors, and specialised trade businesses vetting talent — not a
consumer-facing, homeowner-review product. There is no star-rating layer, no
open comment section, no anonymous review. Everything on a profile traces to a
specific, checkable project record.

### 1.1 The differentiator, stated precisely

A generic trade directory has one evidence type: **someone said something.**
VeriTrade has four, and none of them is a review:

| Evidence type | What it actually is | Why it beats a review |
|---|---|---|
| **Financial/contractual** | Purchase orders and supplier invoices matched to a specific job, payment records tied to the engagement | A review can be invented in five minutes; a matched invoice trail can't |
| **Statutory/inspection** | Hold-point inspection pass/fail records, Occupation Certificates, structural/electrical/plumbing sign-offs, jurisdiction-specific certificates (e.g. the mains energisation certificate — named COES/CCEW/CoT&C/CoC/CES depending on state) | Independently produced by a licensed third party, not the platform or the worker |
| **Supervisory sign-off** | A geofenced, timestamped digital sign-off from the Site Supervisor or Foreperson who actually oversaw the work | Corroborated in the moment, not recalled later |
| **Licence/credential** | Live cross-check against the relevant state licensing database, refreshed, not a photograph of a card | Can't be faked by uploading an old or borrowed certificate |

This is a direct extension of the Evidentiary Weight rule already built into
ProjMan's Verified Work History engine (`appdesignspecification.md` §2.4): a
claim only carries weight if it anchors to an independently checkable record.
VeriTrade is that rule, productised and made public.

---

## 2. The hard prerequisite — read this before building anything else

VeriTrade cannot be honestly described as "immutable" or "tamper-proof" until
the platform resolves how a person's evidence crosses tenant boundaries. Project
data lives locked inside each Builder's own organisation (`org_id` isolation);
a Tradie's or Builder's career, by definition, spans many organisations.

This is decision record **`PM2-02` — the identity-scoped evidence domain**,
detailed in `devroadmap.md` §7.3. In outline: each qualifying interaction inside
any ProjMan tenant emits a **signed attestation** into a person-owned evidence
store that lives outside any one tenant's boundary — a third isolation domain,
identity-scoped rather than org-scoped. **VeriTrade is not buildable, even at a
prototype level, until this is resolved** — an assembled-at-read-time profile
can't make the tamper-proof claim this product's entire positioning rests on.

---

## 3. Two-sided model

| Side | Who | What they do | Cost |
|---|---|---|---|
| **Supply** | Tradies, Foreperson, Builders, Site Supervisors, Inspectors — anyone with a ProjMan Verified Work History | Build/maintain a profile, opt in to public visibility, respond to engagement interest | Free |
| **Demand** | Commercial builders, tier-1 contractors, specialised trade businesses | Search, filter, view full gated profiles, contact/engage | Paid subscription |

Both sides authenticate through the same mechanism (§4) — there is no
password-based account of any kind on VeriTrade, for either side.

---

## 4. Authentication — every login goes through the ProjMan App

**There is no VeriTrade password, for anyone, on either side of the
marketplace.** This is a deliberate, load-bearing decision, not a convenience:

- **A Tradie/Builder/etc. building a profile** already has the App (they had to
  download it to build their Verified Work History in the first place). Logging
  into VeriTrade uses the exact flow specced in `appdesignspecification.md` §8:
  scan a session QR with the App, review the request, approve.
- **A B2B searcher at a commercial builder or tier-1 contractor** also
  authenticates through the App — even if their employer has never run a
  project through ProjMan. They complete a lightweight Self-Registration (an
  identity, not a full Verified Work History profile is required) and their
  employer's VeriTrade subscription entitlement attaches to that identity.
  **One auth model, no exception, no separate "business login."**
- **First-time visitor with no app:** VeriTrade prompts a download and
  Self-Registration before anything past the public teaser layer (§5.1) is
  reachable. This is deliberate: VeriTrade is **the public face of ProjMan**,
  not a separate identity system that happens to share a brand.

This means the App is the identity root for two products, not one — see
`appdesignspecification.md` §0 principle 8 and §8 for the full mechanic
(session QR → App approval → signed session grant, reusing the same
signed-reference primitive already built for Introduction).

---

## 5. Profile anatomy

### 5.1 Public teaser (indexable, no login required)

- Name, trade/classification, years active
- Licence-verified badge (live status, not a static claim)
- Headline metric — e.g. "42 verified projects · 0 unresolved disputes"
- A single "View full profile" call to action → gates into §5.2

This layer is deliberately thin: enough for a search engine to index and for a
prospective employer to recognise a name, not enough to substitute for the
verification that sits behind the login wall.

### 5.2 Full profile (gated — B2B login required)

- **Project-by-project evidence:** each entry shows the job type, dates,
  geotagged location, the supervising party who signed off, and — where the
  worker has opted to disclose it — the invoice/PO trail confirming the
  engagement actually occurred commercially, not just operationally.
- **Licence detail:** classification, expiry, issuing state authority, live
  cross-check status.
- **Dispute record:** shown transparently, but only **resolved** disputes with
  their outcome — an unresolved, contested verification does not surface
  publicly (§8) until §2.7's dispute mechanism has run its course.
- **Engage** — the discovery-to-relationship loop (§7).

### 5.3 What never appears, on either layer

- Any Builder or PM's margins/rates (the commercial-visibility wall extends
  here unchanged).
- Client identity or client-side commercial detail from any project.
- Raw, uncorroborated capture — everything shown has passed the evidentiary
  weight bar (`appdesignspecification.md` §2.4).

---

## 6. Licence verification

Government trade-licence verification is **state-by-state**, not a single
national API. This is a legal/technical confirmation item, not an architecture
decision, and must be resolved per jurisdiction before the "licence-verified"
badge is turned on for that state's tradies:

| State | Licensing body (indicative, confirm before build) |
|---|---|
| WA | DMIRS / Building Services Board |
| NSW | NSW Fair Trading |
| VIC | VBA (Victorian Building Authority) |
| QLD | QBCC |
| Other states/territories | per-jurisdiction, TBD |

**Design consequence:** the licence-verified badge must be able to say "not yet
available in [state]" rather than silently showing a false negative, since
coverage will roll out state by state.

---

## 7. Discovery → Introduction → Job Award — VeriTrade feeds the core loop

VeriTrade is not just a lookup tool — it's the top of the same funnel that ends
in a Job Award inside ProjMan:

1. A tier-1 contractor searches VeriTrade, finds a Tradie or Builder.
2. **"Engage"** on the profile triggers an **Introduction** (the QR
   business-card-equivalent handshake, `appdesignspecification.md` §2.3) — except
   here it's initiated from a profile view rather than an in-person QR scan,
   since the two parties may never have physically met. Both are already
   App-authenticated, so the identity-proving work Introduction normally does
   via QR is already satisfied; VeriTrade's Engage action is Introduction's
   remote equivalent, not a bypass of it.
3. Once Introduced, a **Job Award** can be issued for a specific project through
   Portal, exactly as it would be for any contact sourced any other way.

This is why VeriTrade sits downstream of the identity model rather than beside
it: it's a new *discovery* channel into the same three-step relationship
primitive every other engagement in this system already uses, not a fourth,
different mechanic.

---

## 8. Ethical safeguards carried into VeriTrade

Full detail lives in `appdesignspecification.md` §2.7–2.12; VeriTrade's specific
obligations:

- **B2B-gated, not open-public — now confirmed at the source.** The 18-Stage
  spec's own Part 4.2 originally reasoned about this platform as if it were an
  open, consumer-facing directory (any homeowner browsing) and has since been
  corrected once VeriTrade's actual B2B-gated model was named. This is a
  materially lower exposure profile than an open internet listing — but lower
  is not zero: a wrongly-declined verification visible to a pool of
  prospective commercial employers is still real reputational risk, which is
  exactly why the dispute-visibility rule below has to hold.
- **Dispute visibility:** an unresolved or contested verification is never
  shown publicly. Only a resolved outcome surfaces, and the append-only
  original-plus-resolution record is preserved internally even when the public
  view shows a clean result.
- **Opt-in, revocable, immediate:** publishing to VeriTrade is the individual's
  explicit choice (§2.8); un-publishing removes the profile from VeriTrade
  immediately and unconditionally — the private, portable ProjMan record is
  unaffected either way.
- **Deactivation, not erasure:** account deactivation (§2.10) pulls a profile
  off VeriTrade at once; already-relied-upon project evidence is retained
  internally under policy, never surfaced again publicly.
- **No hidden dossier, extended:** what a B2B viewer can see on a full profile
  is exactly what the profile owner can see was shown — no version of a
  VeriTrade profile is more revealing to a stranger than it is to its own
  owner.
- **Named, not yet resolved:** VeriTrade inherits the commercial-visibility
  asymmetry named in `appdesignspecification.md` §2.12 — its protective
  architecture is built around the worker's and Builder's interests; a Client
  browsing VeriTrade to vet a Builder gets less structural protection than a
  Builder vetting a Tradie, since Client-side asymmetry was never fully
  designed for.

---

## 9. Monetisation

- **Supply side:** free, always — charging a tradie to be found would
  undermine the exact inclusion goal (`appdesignspecification.md` §2.6, §2.11)
  this whole evidence architecture is meant to serve.
- **Demand side:** paid B2B subscription, tiered by search volume/seats,
  gating §5.2's full-profile view and search/filter/shortlist functionality.
  Pricing model is a commercial decision outside this spec's scope.

---

## 10. Search & vetting features (demand side)

- Filter by trade/classification, licence status, location/region, verified
  project count, years active.
- Shortlist/save candidates.
- "Engage" (§7) to initiate contact through the Introduction mechanic — no
  freeform messaging outside that flow, which keeps every contact attributable
  and consistent with the rest of the platform's identity model.
- Search results always show the public teaser layer only until the searcher's
  subscription entitlement is confirmed.

---

## 11. Tech architecture (outline)

- **Separate frontend/deploy target** from Portal and Dashboard — its own
  domain, its own brand surface, publicly reachable and partially indexable
  (§5.1), unlike Portal or Dashboard which are never public.
- **Backend depends on `PM2-02`'s identity-scoped evidence store** (§2) as its
  primary data source — VeriTrade reads from that store, it does not query
  individual tenants' `org_id`-scoped data directly.
- **Auth delegates entirely to the App** (§4) — VeriTrade's own service holds no
  password credentials for anyone.
- **Licence verification integrations** are external, state-by-state calls
  (§6), cached with a visible "last verified" timestamp rather than treated as
  a one-time check.
- Public teaser pages (§5.1) are cacheable/CDN-servable; gated full profiles
  and search are behind the authenticated API.

---

## 12. Open decisions

| # | Decision | Status |
|---|---|---|
| 1 | `PM2-02` — identity-scoped evidence domain | **Blocking — must resolve before any VeriTrade build work** |
| 2 | State-by-state licence-verification integration order and legal confirmation | Open |
| 3 | Exact B2B subscription pricing/tiering | Commercial decision, outside this spec |
| 4 | Whether "Engage" should be rate-limited or otherwise guarded against cold-outreach spam toward Tradies who've opted in | Not designed here |
| 5 | Whether a resolved-but-negative dispute outcome (verifier upheld) should be visible on the public profile, or only internally | Leaning toward visible — transparency is the product's whole value proposition — but not finally decided |
| 6 | Client-side protection asymmetry (inherited, §8) | Flagged, not designed |

---

© eBizco Australia Pty Ltd — prepared against the 18-Stage Construction Lifecycle
Specification v3.4, 26 July 2026.
