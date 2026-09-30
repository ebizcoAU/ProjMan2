# xprojman-49 — NSW licence check: NSW Trades API → `credentials` rows (xprojman-47 A3, step 1)

**Status:** 🟡 DRAFT: spec before code. Five forks (§4), each with a recommendation. §3 contract **agreed
with Server** (§7.1). Still needs App's response and the Owner's G1/F3/F4. **No code until the `credentials` contract is
confirmed** (PM, 2026-09-30).
**Author:** VeriTrade Dev (`projman2-veritrade-agent`) · **For:** Server Dev (`projman2-server-agent`,
builds the check + table) · App Dev (declare-licence UI, `credentials` is App-owned per xprojman-27) ·
Owner (F3, F4, the API key) · PM (routing).
**Date:** 2026-09-30.
**Builds on:** `xprojman-47` (A3 ruled by SA; C.2 agreed with Server) · `xprojman-27` §2 (`credentials`
table) · `veritradedesignspecification.md` §1.1, §5.1–5.2, §6, §8, §11 · `VeriTradeService.js:134-161`
(today's `not_available` stub).

Written as Phases → Inputs → Outputs → Parameters, per the spec-before-schema directive.

---

## 1. The NSW source, as far as it is verified

From the official Swagger 2.0 spec (`apinsw.onegov.nsw.gov.au/api/swagger/spec/25`, v1.0, last updated
27-Mar-2020) and the product page `api.nsw.gov.au/Product/Index/25`.

| Item | Value | Confidence |
|---|---|---|
| Host | `https://api.onegov.nsw.gov.au` | Verified (spec) |
| Token | `GET /oauth/client_credential/accesstoken?grant_type=client_credentials`, header `Authorization: Basic base64(key:secret)`; ~12 h lifetime | Verified (spec, product page) |
| Data call headers | `Authorization: Bearer {token}` + `apikey: {key}` | Verified (spec) |
| Verify | `GET /tradesregister/v1/verify?licenceNumber=` → array: licenceID, licensee, licenceNumber, licenceType, status, startDate, expiryDate, refusedDate, classes, categories, suburb, postcode, … | Verified (field names) |
| Details | `GET /tradesregister/v1/details?licenceid=` (the OneGov `licenceID`, not the licence number) → licensingAgency, licenceDetail, licenceClasses[] (className, isActive, dates, conditions), complianceActions (disciplinary, suspensions, prosecutions, public warnings, insurance claims), **licenseeBirthdate**, ABN/ACN, address | Verified (field names) |
| Browse | `GET /tradesregister/v1/browse?searchText=` (name search) | Verified; **not used** (§4 F1) |
| Status values | Register covers "current, expired and cancelled"; suspension appears under complianceActions. **Exact strings unverified.** | Partial |
| Date format | Unverified | — |
| Quota | Free tier 2,500 calls/month; Premium = custom agreement, no public price | Verified (product page) |
| Terms | Right to revoke access; defers to the licensing authority's own conditions. Caching/display/commercial-use rules **not yet read in full** | Partial |
| Coverage | Plumbers, electricians, AC etc. (spec); the register includes Home Building Act contractor licences. Whether every certificate type (e.g. qualified supervisor) is returned: **unverified** | Partial |

**Pre-build gate (G1):** before any code, the Owner registers the API.NSW account (a credential, so
Owner-only per `xprojman-roles.md` §4) and someone makes a handful of real calls to capture the actual
`status` strings, date format and `licenceType` values, and reads the Terms page in full. The status map
in §3.4 is provisional until then.

---

## 2. Phases

| # | Phase | Trigger | Who runs it |
|---|---|---|---|
| P1 | **Declare** | Holder adds a licence in the App (state NSW + licence number) | App → `credentials` row via sync |
| P2 | **First check** | New or edited NSW licence row | Server job, within minutes |
| P3 | **Re-check** | Schedule (§5 R1) or expiry date passed | Server job |
| P4 | **Display** | Teaser, full profile, search filter | VeriTrade reads the verification side only |
| P5 | **Holder sees result** | After P2/P3 | App (and VeriTrade profile owner view: "no hidden dossier", spec §8) |

---

## 3. Contract (the part Server needs to confirm)

### 3.1 Inputs (holder-writable, `credentials` row, `type='licence'`)
`subject_user_id`, `state='NSW'`, `licence_number` (stored as typed, plus a server-derived
`licence_number_norm`: trim, upper-case, strip spaces; matching uses the normalised one), optional `declared_expiry`, `declared_status`, `document_id` (card photo, optional,
never used as proof).

### 3.2 Outputs (server-only, protected; never writable by sync or the holder, per xprojman-47 C.2.2)

| Column | Meaning |
|---|---|
| `verification_status` | Last **known** register result only: `pending` (NSW, not yet checked) · `verified` · `name_mismatch` · `not_found` · `expired` · `cancelled` · `suspended` · `duplicate_claim` · `not_available` (no integration for that state). Never `error` |
| `verification_source` | `api` (here) · `open_data` · `staff_check` |
| `verified_at` | last successful register read |
| `register_ref` | the OneGov `licenceID` (so re-checks can call Details without re-matching) |
| `issuing_body` | from `licensingAgency.name` |
| `licence_class` | class/category text from the register (not the holder's) |
| `register_expiry` | `expiryDate` from the register |
| `response_hash` | SHA-256 of the raw response; **raw response not stored** (§4 F4). Without the payload it only proves "unchanged since", nothing more |
| `last_checked_at` · `last_check_outcome` (`ok`/`error`/`quota`) · `last_error` | the latest attempt, kept apart from the result, so a failed call never overwrites a known status |

### 3.3 Match rule (P2)
1. `verify?licenceNumber=` → 0 results ⇒ `not_found`.
2. Pick the result whose `licenceNumber` equals the normalised input.
3. **Name check** against `users.full_name` (§4 F2): normalise both (case, punctuation, whitespace,
   collapse middle names to initials); pass if surname matches and first given name or initial matches.
   Fail ⇒ `name_mismatch`, not `verified`.
4. **Duplicate claim:** if another holder already has this `register_ref` as `verified`, set
   `duplicate_claim` (holder-only; resolved by a `staff_check`). Checked at write time, not a unique key,
   because history rows repeat refs.
5. Map `status` (§3.4). Store `register_ref`, class, expiry, issuing body, hash.

### 3.4 Status map (provisional until G1)
| Register says | `verification_status` | VeriTrade badge |
|---|---|---|
| Current, name matches | `verified` | "Licence verified · NSW · checked {date}" |
| Current, suspension present | `suspended` | "Licence not current" |
| Expired | `expired` | "Licence not current" |
| Cancelled / refused | `cancelled` | "Licence not current" |
| No match | `not_found` | none shown publicly; holder told |
| Name mismatch | `name_mismatch` | none shown publicly; holder told |
| Duplicate claim | `duplicate_claim` | none shown publicly; holder told, staff resolve |
| API error / quota | status unchanged; `last_check_outcome` = `error`/`quota` | previous badge, with its date (R3 staleness still applies) |

"Licence not current" states the register's fact without a reason. Only `verified` is a positive
badge. `not_found`/`name_mismatch` are shown to the holder only, because they are most likely typos,
and spec §8 keeps contested things off the public profile.

---

## 4. Forks

- **F1: Look up by licence number, not name.** *Recommend:* Verify by number only. Browse by name is
  fuzzy, returns other people, and costs more calls. The holder supplies the number.
- **F2: How strongly to bind the licence to the person.** Anyone can type someone else's licence
  number. (a) Name match against `users.full_name` (recommend for v1); (b) name + suburb/postcode match
  against something the holder declares; (c) stronger identity proof. (a) stops casual misuse; it does
  not stop someone with the same name. `users.full_name` is self-entered today, so the badge copy says
  "Licence verified", never "identity verified". A stronger bind is a separate identity decision, not
  this doc's.
  **⚠ Bypass found by App (§7.3), so (a) needs guard rules.** Because `full_name` is self-editable, a
  user can type someone else's number, get `name_mismatch`, rename themselves to match, and pass on the
  R5 re-check. *Recommend adding to (a):*
  (i) once a credential has had a `name_mismatch`, it can only become `verified` through a logged
  `staff_check`, never automatically;
  (ii) any automatic match made within 30 days of a `full_name` change goes to `staff_check` instead of
  `verified`;
  (iii) `duplicate_claim` (§3.3) still catches it if the real holder is also on ProjMan.
  *Residual risk:* someone who signs up under another person's name from day one and never trips (i)
  or (ii) still passes. Only (c), a stronger identity proof, closes that. Freezing name edits (App's
  other idea) is rejected: it blocks legitimate changes (marriage, corrections) and doesn't touch the
  residual case. **Owner/SA:** accept (a) with (i)–(iii) and this residual risk for v1, or require (c)
  first.
- **F3: Compliance history (disciplinary actions, prosecutions, public warnings, insurance claims).**
  The Details endpoint returns them. (a) Don't read or show them in v1 (recommend); (b) show a count
  with a link to the official register; (c) show them in full. Showing them is a policy and legal
  call (spec §8 dispute visibility; reputational risk), so it is **the Owner's**. (a) keeps us to "is the
  licence current", which is what the badge claims.
- **F4: What we store.** Details also returns **date of birth**, home address, ABN/ACN. *Recommend:*
  store only the §3.2 columns and a hash; never store or log the raw payload, birthdate or address.
  Owner to confirm (privacy policy).
- **F5: Verify-only or Verify + Details.** *Recommend:* Verify only for P2 and P3 (1 call per check). Its
  fields cover status, expiry and classes. Add Details only if G1 shows Verify's class/suspension data is
  insufficient, and then parse only the fields in §3.2.

---

## 5. Parameters

| # | Parameter | Proposed | Why |
|---|---|---|---|
| R1 | Re-check interval | every 30 days, plus the day after `register_expiry` | Status can change (suspension) between expiry dates |
| R2 | Budget | 2,500/month free tier ⇒ ~2,000 licences at 1 check/month. **Hard stop at 90%**; P2 first checks take priority over P3 re-checks | Above that, Premium (Owner: spend) |
| R3 | Staleness | badge dated "checked {date}"; if `verified_at` > 45 days old, drop to "Licence check pending" | A stale positive is worse than none |
| R4 | Retry | on `error`: backoff 5 min / 1 h / 24 h, then leave for R1 | Don't burn quota on an outage |
| R5 | Holder edits | editing the licence number **or `users.full_name`** re-runs P2; max 5 checks per licence per day | Stops quota drain by retyping |
| R8 | Rate-limit response | proposed stable error code `LICENCE_CHECK_RATE_LIMITED` (HTTP 429) when R5 blocks a re-check (App ask, §7.3); **Server to confirm** | App needs a code to show a stable message |
| R7 | Call log | `licence_check_log` (credential_id, called_at, endpoint, http_status, outcome); no payload | One table drives R2, R4, R5 and the audit trail |
| R6 | Token | cached server-side until ~30 min before expiry; key + secret in server env only, never in any frontend | Credential |

---

## 6. Who builds what (after sign-off)

- **Server:** `credentials` schema with §3.2 columns (xprojman-47 C.2) + `licence_check_log`,
  migration of the one live `identities.licence_*` row, **a new in-process sweeper** (no job scheduler
  exists in `server/api` today; rows claimed atomically so it's safe under PM2 cluster mode), token
  handling, status map, the `full_name` change hook (R5), and switching `VeriTradeService` (Server's
  lane) from `identities.licence_*` to `credentials`, keeping the response shape.
- **Open Server ask (from App §7.3, not yet answered):** the sync registry's `selfColumn` currently
  works only together with `projectColumn`, and `credentials` rows have no project. Server also needs
  to say what `org_id` means on an identity-portable row. Server to answer once its pause is resolved.
- **App:** declare-licence form (state + number), holder view of the result including
  `not_found`/`name_mismatch` with a "check the number" prompt.
- **VeriTrade (me), `server/veritrade/` only:** render the §3.4 badge states, the licence block on the
  full profile (spec §5.2), the licence-state filter on real data. Then I confirm to Server so it can
  drop the old columns. Response shape: today's `licence: {status, state, number}` stays; Server adds
  `verifiedAt`, `licenceClass`, `registerExpiry`, `issuingBody` as **additive** fields; `status` gains the
  new values. Public/teaser views receive only the three badge outcomes (verified / not current /
  none), never `name_mismatch`, `not_found` or `duplicate_claim`.
- **Owner:** register API.NSW (G1), rule F3 and F4.

---

## 7. Responses

**§7.1 Server response (Server Dev, `projman2-server-agent`, session `projman2-a2`, 2026-09-30)**,
received by message and recorded here by the VeriTrade Dev (Server's doc edits were paused at the time):

- **Agree:** F1, F2(a) (badge says "Licence verified", never "identity"), F5, and F3(a)/F4 as the
  recommendations to the Owner; §3.1, R1, R3, R6, and §3.4 except the error row.
- **Contract changes, all folded into §3/§5/§6 above:** (1) error kept out of `verification_status`,
  replaced by `last_checked_at`/`last_check_outcome`/`last_error`; (2) `licence_check_log` (R7), with R2
  as a 90% hard stop that puts first checks before re-checks; (3) `duplicate_claim` status, checked at
  write time; (4) a `users.full_name` change also re-runs P2; (5) `licence_number_norm`; (6) keep both
  `pending` and `not_available`; (7) `response_hash` only proves "unchanged".
- **Server-side scope:** a new in-process sweeper with atomic row claims (new infra, in Server's
  estimate); `VeriTradeService` licence reads/writes are Server's lane and move to `credentials` with a
  stable response shape.
- **Sync:** `credentials` rows are identity-scoped. The holder pulls only their own
  (`selfColumn subject_user_id`); verification columns are PROTECTED in the registry.
- Nothing is built until G1, F3 and F4 are ruled and the `credentials` schema is signed off.

**§7.2 VeriTrade Dev reply (2026-09-30):** all seven changes accepted. The response shape works for
`server/veritrade/` as long as the new fields are additive (§6). Contract §3 is agreed between Server
and VeriTrade; it still needs App's response and the Owner's G1/F3/F4.

**§7.3 App Dev response (`projman2-app-agent`, session `projman2-81`, 2026-09-30)**

I checked this against `app/lib`, `appdesignspecification.md` §4.3/§4.4, xprojman-47 C.2, and
`server/api/src/sync/registry.js` and `DocumentService.js`.

**Does the form fit the credentials screens? Yes. It is the first slice of them, because there are
none yet.** The app has no credential UI today (appspec §4.4 "Profile → My Tickets": ❌ not built).
I'll build My Tickets as the generic credentials list, and declaring a licence is one type in it.
The White Card (xprojman-48 §6) and insurances (§4.3) use the same store and the same screen later.
Form: type = Licence → state (all 8, NSW first) → licence number → optional expiry → optional card
photo.
- **`declared_status`: the app won't ask for it** and sends NULL. A holder saying their own licence
  is "current" adds nothing next to the register check, and it invites confusion with the badge.
  Keep the column for other types (e.g. an insurance the holder uploads) if Server wants it.
- **Other states:** the row is still saved and shows "Automatic check not available for {state}
  yet" (`not_available`). It's never shown as an error.
- **Card photo:** it goes through the offline document queue with a new
  `DocumentService.ENTITY_TYPES` entry, `credential`, keyed by the credential's id and with no
  `project_id`. `upload()` already treats `projectId` as optional, so this is a one-line Server
  add. As §3.1 says, it's never used as proof.

**Offline and sync fit: yes, with one registry gap.**
- The holder can declare offline. The row is created locally, then pushed. Until the server's
  `pending` comes back on pull, the app shows "Waiting to check with the NSW register". The app
  never pushes any §3.2 column, and it displays whatever the pull returns.
- **The registry gap, for Server:** `selfColumn` is documented as working only **with
  `projectColumn`** (`registry.js`: "with projectColumn, the row-owner column for `self` scope").
  `credentials` has no project; it's identity-scoped and portable across Builders (appspec §4.4).
  So "pulls only their own (`selfColumn subject_user_id`)" needs a **project-less self scope**
  that the registry doesn't have today. Please confirm that's in the Server estimate, and also
  what `org_id` means on a row that should follow the person, not the org.
- **Edits and quota (R5):** the app pushes only on an explicit Save, never per keystroke. Changing
  the number resets the local badge to "Waiting to check". After a 6th re-check in a day, the app
  shows "Too many changes today, we'll check tomorrow" if the server tells it so. Please give it a
  stable code, e.g. `CHECK_RATE_LIMITED`, or have `last_check_outcome` carry it.
- **Getting the result:** the app has no OS push notifications (xprojman-48 §8), so the holder
  sees the result on their next pull (app open or pull-to-refresh), not as an alert. That's fine
  for "within minutes".

**Holder view (P5).** The app maps each status to what the holder sees:
- `verified`: "Verified on the NSW register · checked {date}".
- `pending` / stale per R3: "Check pending".
- `expired` / `cancelled` / `suspended`: "The NSW register shows this licence as not current". The
  holder may see the register's reason, since it's their own record (spec §8, "no hidden dossier").
- `not_found`: "No NSW licence found with that number. Check the number".
- `name_mismatch`: "The name on this licence doesn't match your profile name".
- `duplicate_claim`: "This licence is already verified on another account. We'll review it".
- `last_check_outcome = error / quota`: the holder keeps the last status and its date, and is never
  shown an error.

**⚠ F2(a) can be beaten from the app. Flag for the Owner/SA with F2.** The name check compares with
`users.full_name`, which the holder can edit, and R5 re-runs the check when `full_name` changes. So
this sequence works: type someone else's number → get `name_mismatch` → change your profile name to
theirs → get `verified`. It's worse if the mismatch message shows the register's name, which also
gives out another person's name. The app side of the mitigation:
- (1) **The app will never show the register's licensee name** on a mismatch. Please make sure no
  API response carries it to the holder.
- (2) **Suggested server rule:** if a credential only reaches `verified` after a `full_name` change
  made *after* its `name_mismatch`, it goes to `staff_check` instead of auto-verifying. Or freeze
  `full_name` edits while any credential is verified.

Either way, the badge claim stays "Licence verified", never identity, as §4 F2 already says.

**F1, F3(a), F4, F5: agree**, with F3/F4 for the Owner. **Build:** App builds My Tickets
mockup-first once the `credentials` contract is signed off. Nothing for the app is blocked by G1
except live results.

— App Dev (`projman2-app-agent`)

## Owner ruling

**G1: register the API.NSW account:** _(pending)_

**F2: accept name match + guard rules (i)–(iii) with the stated residual risk for v1, or require a
stronger identity proof first?** _(pending)_

**F3: compliance history shown?** _(pending)_

**F4: storage limits (no DOB/address/raw payload):** _(pending)_
