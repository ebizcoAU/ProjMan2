# xprojman-49 — NSW licence check: NSW Trades API → `credentials` rows (xprojman-47 A3, step 1)

**Status:** 🟡 DRAFT: spec before code. Five forks (§4), each with a recommendation. Needs Server's
response on the contract (§3) and an Owner call on F3/F4. **No code until the `credentials` contract is
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
`subject_user_id`, `state='NSW'`, `licence_number` (as typed; server normalises: trim, upper-case,
strip spaces), optional `declared_expiry`, `declared_status`, `document_id` (card photo, optional,
never used as proof).

### 3.2 Outputs (server-only, protected; never writable by sync or the holder, per xprojman-47 C.2.2)

| Column | Meaning |
|---|---|
| `verification_status` | `pending` · `verified` · `name_mismatch` · `not_found` · `expired` · `cancelled` · `suspended` · `error` · `not_available` |
| `verification_source` | `api` (here) · `open_data` · `staff_check` |
| `verified_at` | last successful register read |
| `register_ref` | the OneGov `licenceID` (so re-checks can call Details without re-matching) |
| `issuing_body` | from `licensingAgency.name` |
| `licence_class` | class/category text from the register (not the holder's) |
| `register_expiry` | `expiryDate` from the register |
| `response_hash` | SHA-256 of the raw response, for audit; **raw response not stored** (§4 F4) |
| `last_error` | for `error` only |

### 3.3 Match rule (P2)
1. `verify?licenceNumber=` → 0 results ⇒ `not_found`.
2. Pick the result whose `licenceNumber` equals the normalised input.
3. **Name check** against `users.full_name` (§4 F2): normalise both (case, punctuation, whitespace,
   collapse middle names to initials); pass if surname matches and first given name or initial matches.
   Fail ⇒ `name_mismatch`, not `verified`.
4. Map `status` (§3.4). Store `register_ref`, class, expiry, issuing body, hash.

### 3.4 Status map (provisional until G1)
| Register says | `verification_status` | VeriTrade badge |
|---|---|---|
| Current, name matches | `verified` | "Licence verified · NSW · checked {date}" |
| Current, suspension present | `suspended` | "Licence not current" |
| Expired | `expired` | "Licence not current" |
| Cancelled / refused | `cancelled` | "Licence not current" |
| No match | `not_found` | none shown publicly; holder told |
| Name mismatch | `name_mismatch` | none shown publicly; holder told |
| API error / quota | `error` (keep previous status and `verified_at`) | previous badge, with its date |

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
| R2 | Budget | 2,500/month free tier ⇒ ~2,000 licences at 1 check/month with 20% headroom | Above that, Premium (Owner: spend) |
| R3 | Staleness | badge dated "checked {date}"; if `verified_at` > 45 days old, drop to "Licence check pending" | A stale positive is worse than none |
| R4 | Retry | on `error`: backoff 5 min / 1 h / 24 h, then leave for R1 | Don't burn quota on an outage |
| R5 | Holder edits | editing number or name re-runs P2; max 5 checks per licence per day | Stops quota drain by retyping |
| R6 | Token | cached server-side until ~30 min before expiry; key + secret in server env only, never in any frontend | Credential |

---

## 6. Who builds what (after sign-off)

- **Server:** `credentials` schema with §3.2 columns (xprojman-47 C.2), migration of the one live
  `identities.licence_*` row, the check job (P2/P3), token handling, status map, a read endpoint
  exposing only the verification side to VeriTrade.
- **App:** declare-licence form (state + number), holder view of the result including
  `not_found`/`name_mismatch` with a "check the number" prompt.
- **VeriTrade (me):** switch reads from `identities.licence_*` to the new endpoint, render §3.4 badges,
  the licence block on the full profile (spec §5.2), the licence-state filter on real data. Then I
  confirm to Server so it can drop the old columns.
- **Owner:** register API.NSW (G1), rule F3 and F4.

---

## 7. Responses

*(Server response goes here.)*

*(App response goes here.)*

## Owner ruling

**G1: register the API.NSW account:** _(pending)_

**F3: compliance history shown?** _(pending)_

**F4: storage limits (no DOB/address/raw payload):** _(pending)_
