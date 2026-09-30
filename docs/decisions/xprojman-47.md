# xprojman-47 — VeriTrade: licence-verification state order + B2B billing model (for Owner ruling)

**Status:** 🟢 **RULED** (fully, 2026-09-30). A3 + B2 with seat terms, the WA staff-checked badge (after
NSW + QLD are live) and the data-request letters (Owner sends) are all ruled; see Owner ruling. Nothing
built yet: licences wait on xprojman-49 and Server's `credentials` migration; seats wait on Server's C.1.
**Author:** VeriTrade Dev (`projman2-veritrade-agent`) · **Requested by:** PM (2026-09-30).
**For:** Owner (both rulings) · SA (review) · Server Dev (§C asks) · Product Manager (§B consistency check, §D).
**Date:** 2026-09-30.
**Resolves:** `veritradedesignspecification.md` §12 open decisions #2 (state order) and #3 (pricing/tiering);
`xprojman-roles.md` Owner queue §6 #4.
**Related:** `veritradedesignspecification.md` §3, §5, §6, §9, §10 · `migration_v028_veritrade.sql` ·
`migration_v007_admin_billing.sql` · `product/lib/data.ts` (pricing tiers) · `product/app/pricing/page.tsx`,
`product/app/veritrade/page.tsx`.

---

## 0. Where things stand today (checked against code, 2026-09-30)

- **Licence:** `identities` carries `licence_number`, `licence_state` (free text), `licence_status`
  (`unverified`/`verified`/`not_available`), `licence_verified_at` (v028). No class, no expiry, no issuing
  body, one licence per person. `VeriTradeService` sets `not_available` whenever a licence is entered;
  nothing ever sets `verified`. The frontend already renders the three badge states, including
  "Licence check not yet available in {state}" (spec §6 design consequence is met).
- **Entitlement:** the gated full profile is **login-gated only**. Any App-authenticated identity can open
  it (`routes/veritrade.js:5-7`: "subscription entitlement deferred"). Search returns teaser fields only,
  `LIMIT 50`. Engage is hard-capped at 20/searcher/day.
- **Billing infrastructure:** `subscriptions` + `payments` (v007) are **one row per org**, plan enum
  `trial/starter/builder/enterprise`, manual reconciliation, no payment gateway anywhere in the repo.
  No seats table, no link from a person to an employer's entitlement (spec §4 requires that link).
- **Public claims already live** (product site): "VeriTrade is free forever for tradespeople and workers
  on the supply side. Builders and recruiters on the demand side pay for search and direct engagement."
  No dollar figure is published for the demand side.

---

## Part A — Licence verification: which state goes first

### A.1 Findings per state

Research 2026-09-30 against regulators' own pages and open-data portals. "Unverified" = inferred or
secondary source; confirm before build (spec §6 already says "confirm before build").

| | **NSW** | **QLD** | **VIC** | **WA** |
|---|---|---|---|---|
| Regulator(s) | NSW Fair Trading / Building Commission NSW (one contractor-licence system covers building, electrical, plumbing, gas) | QBCC (building + plumbing); Electrical Safety Office (electrical) | Building and Plumbing Commission (BPC, replaced VBA 1 Jul 2025); Energy Safe Victoria (electrical) | Building and Energy (LGIRS); one search covers building, electrical, plumbing, gas |
| Access route | **Official API**: api.nsw "Trades API" (Verify / Browse / Details), OAuth 2.0 key, free tier 2,500 calls/month | **Open data**: QBCC Licensed Contractors Register CSV, weekly, **CC-BY 4.0**, CKAN datastore API | **Open data (builders only)**: BPR.csv weekly; plumbers web search only; ESV electrical search behind a **CAPTCHA** | **Scrape-only**: JS web search + daily PDF registers; no API, no dataset |
| Reuse terms / legal risk | **Low.** Sanctioned API. Terms reserve the right to revoke access and defer to the licensing authority's own conditions; no commercial-use prohibition found | **Low** for building/plumbing (CC-BY: attribution only). Electrical: no dataset, terms unverified | **Medium–High.** Dataset licence is `other-closed` (not open) → needs BPC written OK for commercial reuse. ESV CAPTCHA = automated checks not intended | **Medium–High.** No stated terms, no sanctioned automated route; would need a written arrangement with Building and Energy |
| Fields | Number, name, class, status, expiry expected via Details (schema behind sandbox, unverified) | Number, name, ABN, licence type/grade/class. **No status or expiry column**; suspended included, cancelled excluded (dataset note: use QBCC search for current status) | Accreditation ID, status, limitation, commenced, expires. **Name blank for individuals** → match on number only | Unverified (page not inspectable) |
| Trades covered by the automated route | Building, electrical, plumbing, gas | Building, plumbing (not electrical) | Builders only | None automated |
| Effort | **Low** | **Low–Medium** | **Medium** (+ licensing clearance) | **High** |
| Share of AU construction businesses (ABS 8165.0, Jun 2025) | **33.7%** | **19.3%** | **27.4%** | **9.9%** |

The four states are 90.3% of Australian construction businesses. Source cube:
`https://www.abs.gov.au/statistics/economy/business-indicators/counts-australian-businesses-including-entries-and-exits/jul2021-jun2025/8165DC02.xlsx`.
Key sources: `api.nsw.gov.au/Product/Index/25` · `data.qld.gov.au/dataset/qbcc-licensed-contractors-register` ·
`discover.data.vic.gov.au/dataset/bpc-building-practitioner-register` ·
`energysafe.vic.gov.au/licensing/search-public-register` · `ols.demirs.wa.gov.au/search`.

### A.2 The tension the Owner needs to rule on

The data points one way; the likely home market points the other. Nothing in the repo names a launch
state or pilot customers, but every hint says **WA** (org default timezone `Australia/Perth`,
`projman-01.md:233`; the 18-stage research notes are WA-specific). WA is also the **hardest** state to
verify automatically and the smallest of the four by market.

### A.3 Forks

- **A1: Easiest route first (NSW, then QLD, then VIC, then WA).** Ship NSW via its API (all four trade
  types in one integration), then QLD building/plumbing from the CC-BY CSV. VIC once BPC clears reuse.
  WA last or on a manual track. Covers ~53% of the market with two low-risk integrations.
  *Cost:* if the early users are in WA, the badge they see says "not yet available in WA" for the
  longest.
- **A2: Home market first (WA, then NSW, QLD, VIC).** Open a written data arrangement with Building and
  Energy (LGIRS) before any build; build against the search/PDF only once that's granted.
  *Cost:* slowest and least certain start; weeks of lead time on an agreement we don't control; scraping
  without one is a legal and reliability risk we should not take.
- **A3: NSW + QLD automated now, plus a WA "staff-checked" track in parallel.** As A1, but WA
  identities get a *distinct*, weaker badge ("Licence checked by ProjMan staff against the WA register
  · {date}"), produced by a platform-ops person looking up the public register by hand, logged with
  who/when. The Building and Energy data request goes in at the same time; WA moves to automated when
  (if) it is granted.
  *Caveat:* spec §1.1 says the licence evidence is a "live cross-check … not a photograph of a card". A
  hand check against the official register is not a photograph, but it is not live either; it **must
  not** display as the same "Licence verified" badge. Needs an Owner/SA call on whether that weaker
  badge is acceptable at all.

### A.4 Recommendation

**A3.** Build NSW (API) first, QLD (CSV) second: cheapest, lowest legal risk, biggest coverage, and
NSW alone covers electrical and plumbing, which the others don't. Run the WA manual track only if the
Owner confirms WA is where the first users are, and only with a visibly different badge. In parallel,
the Owner (as the licensable business entity) sends written data-reuse requests to BPC (VIC) and
Building and Energy (WA); those are the long-lead items. VIC plumbers/electricians and QLD electricians
stay "not yet available" until a sanctioned route exists.

Whatever order: no state is switched on until its route is confirmed first-hand (API key obtained,
field schema seen). The unverified cells above get re-checked at build time.

---

## Part B — B2B billing (demand side)

Fixed by spec and by what's already live on the product site, so not reopened here:
**supply side free forever** (spec §9, product site); **demand side paid**, "tiered by search
volume/seats", gating the full profile + search/filter/shortlist (spec §9, §10); **every demand user
authenticates via the App, and the employer's entitlement attaches to that person's identity** (spec §4).

### B.1 Forks

- **B1: Standalone VeriTrade seats.** A separate VeriTrade subscription bought by an employer org,
  priced per searcher seat per month, tiers by seat count (e.g. 1 / up to 5 / custom). Nothing bundled
  into ProjMan plans.
  *For:* simplest to explain; fits tier-1 contractors who will never run ProjMan (spec §4 anticipates
  them). *Against:* a Professional ProjMan customer pays twice to search for crew; wastes the upsell.
  *Server:* entitlements + seat assignment (C.1), a subscription row that is not the org's ProjMan plan.
  *Product:* a new VeriTrade price block on /veritrade and /pricing.

- **B2: Bundled seats + standalone plan (hybrid).** ProjMan Professional includes N VeriTrade demand
  seats, Enterprise includes a negotiated number; firms that don't use ProjMan buy the standalone
  VeriTrade plan from B1. Extra seats are an add-on.
  *For:* makes ProjMan Professional stickier; one entitlement model serves both kinds of customer;
  consistent with the live copy. *Against:* two ways into the same entitlement; needs a seat count per
  plan.
  *Server:* same as B1 plus "plan grants N seats" (C.1).
  *Product:* one Professional/Enterprise feature line, plus the standalone block.

- **B3: Metered (free search, pay per full-profile unlock / Engage credits).** Teaser search stays free
  for any logged-in identity; each full-profile view or Engage spends a credit from a prepaid pack.
  *For:* lowest barrier; directly prices the spam risk in spec §12 #4. *Against:* doesn't match the spec's
  "subscription tiered by seats/volume"; per-view pricing works against due diligence (a vetting buyer
  should look at many profiles); more complex ledger; weakest recurring revenue.
  *Server:* credit ledger + decrement on view/Engage, on top of C.1. *Product:* different story from the
  "subscription" wording now live.

Prices are the Owner's call. For scale only: Professional ProjMan is $189/user/month today, so a
standalone VeriTrade seat priced well below that (so it isn't a back door to buying ProjMan) is the
natural band. No figure is proposed here.

### B.2 Recommendation

**B2.** It keeps to the spec (subscription, seat-tiered), keeps supply free, matches the live copy, and
the entitlement model is the same whichever way a firm arrives. Keep the existing Engage daily cap (20)
as the anti-spam guard (spec §12 #4) rather than pricing it (B3).

Payment collection: v1 can follow the existing platform billing (manual invoice + reconciliation,
v007 `payments`). A card gateway for self-serve standalone sign-up is a separate, later Owner decision,
not a precondition.

---

## Part C — Asks (nothing here is built; I won't touch code outside `server/veritrade/`)

### C.1 Server Dev (`projman2-server-agent`), needed for any B fork
1. **Entitlement record**: an org-level VeriTrade entitlement (plan / seat count / status / period),
   separate from or extending the per-org `subscriptions` row (it is keyed one-per-org with a ProjMan
   plan enum, so a standalone VeriTrade buyer doesn't fit it as is).
2. **Seat assignment**: identity ↔ entitled org, managed by that org's admin (spec §4: "the employer's
   entitlement attaches to that identity").
3. **Enforcement**: gate the full profile, filters beyond the teaser set, shortlist, and Engage on an
   active seat; return a distinct "no entitlement" response the frontend can turn into an upsell.
4. **Plan naming**: DB enum says `builder`, site says "Professional". Worth aligning before a plan
   starts granting seats.
5. B3 only: a credit ledger.

### C.2 Server Dev, needed for Part A
1. **Licences are `credentials` rows with `type='licence'`**, not a new `licences` table and not
   four columns on `identities`. This is the identity-level `credentials` table already agreed by App
   and Server in `xprojman-27` §2 (`subject_user_id`, `type`, `status`, `expires_at`, `document_id`;
   App owns the upload/display UI). `xprojman-48` §6 puts the White Card there too, so it is one store,
   not three. One person can hold several (e.g. plumbing + gas). Add per-row verification columns:
   state, issuing body, class, verification source (`api`/`open_data`/`staff_check`),
   `last_verified_at`, raw response hash. *(Agreed with Server Dev, 2026-09-30.)*
2. **Two different statuses, kept apart.** The credential's own `status`/`expires_at` (what the holder
   declared or uploaded) is not the same as the register verification result. A holder upload must
   never set the verification to verified; only the server-side register check (or a logged
   `staff_check`, if A3 is ruled in) can. VeriTrade's badge reads the verification result only.
3. **The v028 `identities.licence_*` columns are superseded.** Server will migrate only rows with a
   `licence_number` (1 of 6 live rows today), carrying the existing status across as-is, and create no
   empty rows for the others. The columns stay until VeriTrade's reads have switched to `credentials`,
   then a follow-up migration drops them, so there is never a window with nothing to read.
   *(Server Dev, 2026-09-30.)* The holder writes `declared_status`/`declared_expiry`;
   `verification_status`, `verified_at`, source and response hash are server-only (protected, never
   writable by sync or the holder).
4. A scheduled re-check (spec §11: cached with a visible "last verified", not one-off), and a
   `staff_check` path + audit fields (who/when) if A3 is ruled in.
5. Keeping the NSW API key server-side (it's a per-account OAuth credential; the Owner registers it).

### C.3 VeriTrade Dev (me), once rulings land
Badge variants (verified / staff-checked / not available / expired), licence detail block on the full
profile (spec §5.2), entitlement-aware gating and upsell state, seat-management screen if the org admin
manages seats in VeriTrade rather than Portal (open, see D).

---

## Part D — Product consistency check (with Product Manager, `projman2-product-agent`)

To be confirmed before this draft is finalised:
1. The Professional tier lists **"VeriTrade publishing for your crew"** as a paid feature. Publishing is
   supply side, which the site (and spec §9) say is free forever. Suggest rewording to what the paid
   tier actually adds on the demand side (e.g. "VeriTrade search seats included"), or confirming it
   means something else.
2. Is Product planning to publish a VeriTrade demand-side price, and on which page?
3. Does B2's "included seats" fit the Professional/Enterprise copy?
4. Where does seat management live, VeriTrade or Portal? (Owner/SA call; noted for Product's copy.)

**Product response (Product Manager, `projman2-product-agent`, 2026-09-30)**, checked against the live
copy in `product/lib/data.ts` (pricingTiers), `product/app/veritrade/page.tsx` (#pricing) and
`product/app/pricing/page.tsx` (FAQ):

1. **"VeriTrade publishing for your crew" is not deliberate. It is a live inconsistency, and I agree with
   the reword.** The Professional card's description ("…and a public VeriTrade presence") has the same
   problem. Both read as if the supply side needs a paid plan, which contradicts "Free forever" on
   /veritrade and the /pricing FAQ. Proposed copy once Part B is ruled:
   - B2: Professional feature line becomes "VeriTrade search seats included (N per plan)". The description
     becomes "The full lifecycle, unlimited projects, and built-in access to VeriTrade's verified trades".
   - Before any ruling, the smallest true wording I could use is "Your crew's verified work flows to their
     free VeriTrade profiles". I'll only change it after a PM claim-check and Owner OK, because the site is live.
2. **No demand-side price will be published until the Owner rules on Part B and sets a figure.** Today
   /veritrade#pricing says only "Paid subscription" for the demand side. With B2, I would publish in two places:
   - the Professional and Enterprise cards on /pricing (a feature line, from `pricingTiers`);
   - a standalone "VeriTrade for employers" price block on /veritrade#pricing, replacing "Paid subscription",
     with a short matching line in the /pricing FAQ.
   With B1, there would be no card changes, only the standalone block. B3 would mean rewriting the
   "subscription" wording on both pages.
3. **Yes, B2 fits the current copy.** Professional gets the swap in (1). Enterprise gets a new line,
   "Negotiated VeriTrade seat allocation". Starter gets nothing, and the site will stay silent about it
   rather than list a negative. Two things to settle so the copy stays honest:
   - **N must be a concrete number** if we print "N seats". Otherwise the line becomes "VeriTrade search
     seats included".
   - **Seat unit:** the Professional price is *per user / month*. A reader will assume every Professional
     user can search VeriTrade. If N is a per-org pool that is smaller than the org's user count, the copy
     has to say "per organisation". Owner to confirm per-user vs per-org.
   - Minor: I agree with C.1 #4. The site says "Professional", so the DB `builder` enum should get the same
     name before plans grant seats.
4. **Seat management location** doesn't change the public copy. The marketing site won't name the screen,
   so either answer works for Product.

---

## Owner ruling

**Part A (state order):** ☑ **A3** (SA ruling relayed by PM, 2026-09-30).

**Part B (billing model):** ☑ **B2** (SA ruling relayed by PM, 2026-09-30). Publishing stays free.
☑ **Owner-approved, 2026-09-30** (`xprojman-roles.md` §8 #6).

**WA staff-checked badge (A3) acceptable?** ☑ **Approved**, with its own visibly weaker badge (A3). **Build the
WA manual track only after NSW + QLD automation is live.** (Owner, 2026-09-30.)

**Who sends the BPC / Building and Energy data requests:** ☑ **The Owner signs and sends them**; the VeriTrade
Dev drafts both letters (Owner, 2026-09-30). Drafts: Claude Doc "VeriTrade licence data-reuse requests (VIC BPC,
WA Building and Energy)", https://claude.ai/code/artifact/7c9d07f3-57cf-4cec-999c-1fb95d044bf3 (Owner's
workspace).

**If B2: seats included in Professional (a concrete N, or no number printed):** ☑ **3** included in
Professional; Enterprise negotiated. Public copy: "includes 3 VeriTrade search seats". **No prices
yet.** (Owner-approved, 2026-09-30, `xprojman-roles.md` §8 #6.)

**If B2: are seats per user or a per-org pool?** (Professional is priced per user / month; see D.3)
☑ **Per-org pool** (Owner-approved, 2026-09-30, `xprojman-roles.md` §8 #6).

**OK to change the live Professional-tier line now, before the Part B ruling (D.1 interim wording)?** ☑ **Yes** (SA ruling relayed by PM, 2026-09-30). Use the minimal fix: delete data.ts:462 and trim the :457 description. Make no new claim.
