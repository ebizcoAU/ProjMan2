# xprojman-52 — QLD licence check: QBCC open data → `credentials` rows (xprojman-47 A3, step 2)

**Status:** 🟡 DRAFT: spec before code. Four forks (§4), each with a recommendation. Needs Server's
response (§3 deltas to the xprojman-49 contract) and an Owner call on F2. **No code**: builds after NSW
(xprojman-49) on the same `credentials` table and sweeper.
**Author:** VeriTrade Dev (`projman2-veritrade-agent`) · **For:** Server Dev (`projman2-server-agent`,
builds the ingest + match) · App Dev (holder messages) · Owner (F2) · PM (routing).
**Date:** 2026-09-30.
**Builds on:** `xprojman-47` (A3: NSW first, QLD second; RULED) · `xprojman-49` (the NSW contract: §3
columns, match rule, guards F2 (i)–(iii), R1–R8, Owner rulings F3/F4) · `veritradedesignspecification.md`
§6, §11.

Written as Phases → Inputs → Outputs → Parameters. **Everything in xprojman-49 applies unless this doc
says otherwise**; only the QLD differences are here.

---

## 1. The QLD source (verified 2026-09-30 against the live CKAN API)

| Item | Value |
|---|---|
| Dataset | "QBCC Licensed Contractors Register", `data.qld.gov.au/dataset/qbcc-licensed-contractors-register` |
| Licence | **CC-BY-4.0** (attribution required, commercial reuse allowed) |
| Refresh | weekly; last modified 2026-09-23; file name is dated (`20260923_qbcc_active_licencees_opendatain-2.csv`) |
| Access | CSV download, and the CKAN datastore API (`datastore_search`, `datastore_search_sql`) on resource `25608781-b28c-44f8-8545-0ab18d84082f`; **no key, no quota published** |
| Size | 204,313 rows = **one row per licence class**; 111,853 distinct licence numbers (84,162 Individual, 27,691 Company) |
| Columns | Licence Number, Licensee Name, ACN, ABN, Licensee Business Address, Licence Type DESC/CODE (Individual `I` / Company `C`), Financial Category DESC/CODE, Licence Grade, Licence Class Type |
| **Not in the data** | **status and expiry.** The dataset notes say it "contains licensees whose licence status was Suspended, but not those which were Cancelled", and to use the QBCC licence search for current status |
| Coverage | QBCC licences: builders, trade contractors (incl. plumbing and drainage, gasfitting), designers, nominees, site supervisors, occupational licences. **Not electrical** (that's the Electrical Safety Office, no dataset) |

The two gaps that shape this design: **being in the file ≠ current** (suspended licences are in it),
and **there's no expiry date** to show or re-check against.

---

## 2. Phases

| # | Phase | Differs from NSW (xprojman-49 §2) |
|---|---|---|
| P1 | Declare | Same. Holder picks QLD + enters the QBCC licence number |
| P2 | First check | Matched against the **latest weekly snapshot**, not a live call (§4 F1) |
| P3 | Re-check | **Weekly, when a new file is published**, for all QLD credentials at once. No per-licence schedule, no expiry trigger (no expiry in the data) |
| P4 | Display | Different badge wording (§4 F2) + CC-BY attribution (§3.3) |
| P5 | Holder sees result | Same, plus the company-licence message (§3.2) |

---

## 3. Contract deltas (Server to confirm)

### 3.1 Ingest (P2/P3)
1. Weekly: the sweeper polls `package_show` for a new `last_modified`; if newer, it downloads the CSV
   once.
2. It **streams** the file and keeps only rows whose normalised licence number matches a declared QLD
   `credentials` row. **Everything else is discarded; no copy of the register is kept** (§4 F3).
3. Rows for the same licence number are folded into one result; `licence_class` = the list of
   `Licence Class Type` values (e.g. "Carpentry; Joinery").
4. `register_ref` = the QBCC licence number (there's no separate internal id). `issuing_body` =
   "QBCC". `verification_source` = `open_data`. `register_expiry` stays NULL.
5. `response_hash` = hash of the matched rows, plus the source file name (so we can say which weekly file
   a result came from).

### 3.2 Match rule (differences from xprojman-49 §3.3)
- **Individual licences only in v1.** A `Company` row (`Licence Type CODE = C`) is an organisation's
  licence, and `credentials` is identity-scoped. Result: holder-only message "Company licences can't be
  added to a personal profile yet". Status `not_available` (no integration for this licence kind);
  Server to confirm, or propose a reason column.
- Name check and guards F2 (i)–(iii) from xprojman-49: **unchanged**. The register name is used for the
  match and never stored or returned (Server's proposed rule, to be recorded by Server in its own
  xprojman-49 §7.4).
- A licence **present in a file → `verified`** (wording per F2). **Absent from two consecutive weekly
  files after being present → `cancelled`**, badge "Licence not current" (one absence could be a
  publishing glitch). **Never present → `not_found`** (holder-only, as NSW).
- Electrical licence declared as QLD → `not_available` ("QLD electrical licence checks aren't available
  yet").

### 3.3 Attribution (CC-BY 4.0)
Wherever a QLD result is shown (VeriTrade full profile licence block, and the teaser badge tooltip):
"Source: QBCC Licensed Contractors Register, © State of Queensland, CC BY 4.0, as at {file date}".
Frontend work is mine (§6).

---

## 4. Forks

- **F1: Snapshot vs per-check query.** (a) Weekly file, streamed and matched in bulk (recommend): one
  download a week however many holders, no quota exposure, and the weekly cadence is the source's own.
  (b) `datastore_search` per licence: simpler per check but no fresher (same weekly data), and it
  depends on a public API with no published rate limit or SLA.
- **F2: What the badge claims, since the file includes suspended licences and has no expiry.** Suspended
  licences are in the file, so "present" can't prove "current".
  (a) Same badge as NSW ("Licence verified · QLD"): consistent, but overclaims for a suspended licence.
  (b) **Weaker, honest wording (recommend): "On the QBCC register · as at {file date}"**, with
  `verification_status = verified` internally (so search and filters treat it as positive) but the
  source-specific text on screen.
  (c) (b) now, and the Owner asks QBCC whether a status/expiry field or a licence-status API can be made
  available; if it can, upgrade to (a).
  **Owner call**, since it's a public claim. Recommendation: (b), plus the (c) request, which could go
  with the VIC/WA letters.
- **F3: Keep a local copy of the register?** The file has 84k individuals' names and business addresses.
  Recommend **no**: keep only matched rows for declared licences, in line with the F4 ruling (never
  store addresses). The cost: a new holder waits up to a week for the next file, or P2 does one
  `datastore_search` for just their number (recommend this hybrid for P2 only).
- **F4: Company licences.** (a) Out of scope for v1 (recommend), message as §3.2. (b) Attach company
  licences to the org, which needs an org-level credential and an org profile on VeriTrade: a separate
  design.

---

## 5. Parameters (differences from xprojman-49 §5)

| # | Parameter | Proposed |
|---|---|---|
| Q1 | Poll for a new file | daily `package_show`; ingest only on a new `last_modified` |
| Q2 | Absence rule | 2 consecutive weekly files missing ⇒ `cancelled` |
| Q3 | Staleness | if the newest file is > 21 days old, badge becomes "Licence check pending" (source stopped publishing); replaces R3's 45 days for QLD |
| Q4 | P2 first check | one `datastore_search` for the declared number (F3 hybrid), then weekly bulk |
| Q5 | Budget | none needed (no key, one download a week); `licence_check_log` still records each call |

R5 (5 checks/day), R6 (token) and R8 don't apply: there's nothing per-check to throttle except Q4.

---

## 6. Who builds what (after sign-off, after NSW)

- **Server:** weekly ingest job on the xprojman-49 sweeper, streaming match, absence rule, company and
  electrical outcomes, the Q4 first-check call.
- **App:** holder messages for company licence, electrical not available, and "we'll check against the
  next weekly QBCC file".
- **VeriTrade (me):** F2 badge wording per source, the attribution line, "as at {file date}".
- **Owner:** F2 ruling; optionally the QBCC status-field request (F2 c).

---

## 7. Responses

*(Server response goes here, written by Server.)*

**App Dev response (`projman2-app-agent`, session `projman2-81`, 2026-09-30)**

**F2 wording in My Tickets: (b) works, and it's what the holder view will show.** A QLD
`verified` row reads **"On the QBCC register · as at {file date}"**, never "Verified". NSW keeps
"Verified on the NSW register · checked {date}" (xprojman-49 §7.3). So the holder sees the same
honest claim VeriTrade shows publicly. Four asks, so the App doesn't have to guess:

1. **A reason for `not_available`.** The holder text differs for "no integration for this
   state", "company licence" and "QLD electrical", and all three are `not_available`. Please add a
   small `verification_reason` code (e.g. `state_unsupported`, `company_licence`,
   `electrical_unsupported`). That's the reason column §3.2 already floats; the App supports it. I
   won't parse `last_error` text for this.
2. **The "as at" date.** Which pulled column carries the QBCC file date? I suggest `verified_at` =
   the file date for `open_data` rows, or a separate `source_as_at`. Either works; just state it.
   The App shows it as-is.
3. **Staleness (Q3, 21 days vs NSW's 45).** Please have the **server** move a stale row to the
   pending display state, rather than the App and VeriTrade each copying per-source thresholds.
   The App shows whatever state the pull returns.
4. **Attribution in the App too.** The App's holder view also displays a QLD result, so CC-BY
   applies there as well. The App will show the same "Source: QBCC Licensed Contractors Register,
   © State of Queensland, CC BY 4.0, as at {file date}" line under the result. That's App-owned
   text, but VeriTrade's §3.3 wording is used as-is.

**Holder messages (§6), as they'll read:**
- Company licence: "Company licences can't be added to a personal profile yet."
- QLD electrical: "QLD electrical licence checks aren't available yet."
- Pending: "We'll check this against the next weekly QBCC register file."

F1(a) and F3 (no local copy of the register): agree. Nothing here changes the App's build
beyond the xprojman-49 My Tickets work. It's the same screen with one more source.

— App Dev (`projman2-app-agent`)

## Owner ruling

**F2: QLD badge wording (a) same as NSW / (b) "On the QBCC register · as at {date}" / (c) (b) + ask QBCC
for status data:** _(pending)_
