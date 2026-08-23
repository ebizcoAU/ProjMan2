group-02.md — Team Status Reports (contributions)

Status: 🟡 PARTIAL — App Agent + Server Agent sections only. Per group-01.md
§11, the full group-02.md is due 2026-08-28 17:00 AEST and is compiled by
PM / System Architect from each team's weekly report. These sections are
submitted early at the owner's request; Portal / VeriTrade sections are not
authored here and should not be inferred from this file until each team
files its own. **Read the Server Agent section below before acting on
group-01.md §3/§8/§9 or projman-roles.md §9/§10 — it corrects the P10
"not started" status.**

---

### Status Report — App Team — 2026-08-21 — 08:35 AEST

**Memory ID:** projman2-app-agent
**Current Status:** 🟢 On Track

**This Week's Deliverables (Completed):**
1. Forgot-password screen rebuilt with 6-digit OTP-box entry, matching `docs/assets/RecoveryScreen.png` — xprojman-26 — Completed 2026-08-21 08:35 (commit `584016b`)
2. Wired the server's actual error surface per xprojman-26 — `TOO_MANY_ATTEMPTS` unlocks resend immediately, `INVALID_RECOVERY_TOKEN` restarts the flow from email entry, no "email not found" state (anti-enumeration by design) — xprojman-26 — Completed 2026-08-21 08:35
3. Found and fixed a live crash in the new OTP screen — a Flutter Focus-tree conflict from sharing one `FocusNode` between a `KeyboardListener` and its child `TextFormField` — Completed 2026-08-21 08:35
4. Hero image (baked-in logo/wordmark/subtitle) nudged 20px down on the welcome and auth-scaffold screens — Completed 2026-08-21 08:35 (commit `584016b`)
5. Dev API endpoint default updated 4100 → 5100 (`app/Makefile`) to match the current `server/api/.env`, after finding the two ports were serving different server instances — Completed 2026-08-21 08:35
6. Verified live builds on physical test devices — iPhone 12 Pro Max (`vphan`) and a Samsung Galaxy A17 (`SM A176B`), both against `:5100` — 2026-08-21

**Blockers / At-Risk Items:** None. See correction below — the Server P10 blocker reported above was stale at time of writing.

**Next Week's Plan (3-5 items):**
1. Live round-trip test of the recovery email flow (real inbox, code entry, reset) against `:5100` — xprojman-26 — 2026-08-22
2. On-device QA pass across the full test rig (iPhone XS, iPhone 12 Pro Max, iPad 10.1", Samsung A17) — 2026-08-25
3. Live re-verify the existing Job Award accept/decline UI (`app/lib/screens/job_awards/job_invitations_screen.dart`, built + E2E-verified 2026-07-31) against the current `:5100` server, now that P10's `GET /job-awards/pending` is confirmed live — xprojman-11/12 — 2026-08-25

**Dependencies & Needs:** None currently outstanding — both items below were resolved by the Server Agent's correction (verified independently, see below).
1. ~~Need `GET /job-awards/pending` (Server Step B) by 2026-08-28~~ — already live, verified in `server/api/src/routes/jobAwards.js:22`
2. ~~Need `progress.tick` / `progress.verify` permissions (Server Step A) by 2026-08-28~~ — already live, verified in `TaskProgressService.js:30,57`

**Changes to Previously Reported Plan:**
1. Correction to group-01.md §4: the offline image/document queue (xprojman-24/xprojman-22) was listed as `⚠️ PENDING` commit. Verified via `git log` — it was already committed 2026-08-04 (`dc556bb`) and is clean in the working tree. No outstanding App action on that item.
2. Correction to this section's own earlier "Blockers"/"Next Week's Plan"/"Dependencies" (above, struck through): independently verified the Server Agent's correction below — commits `10295e2` and `002b468` are real, on this branch (`git merge-base --is-ancestor` confirms both are ancestors of `HEAD`), migrations v012/v013/v014/v019/v027 exist on disk, and `GET /job-awards/pending` is a real committed route. **App is not, and was not, blocked on Server P10.** Also corrected "Begin Job Award UI" — that UI already exists and was E2E-verified 2026-07-31; nothing to begin, only re-verification needed against the current server.

**Risks:**
1. Status docs stating a blocker that doesn't hold up under `git log` — Mitigation: verify against git before publishing a blocked/unblocked status, not just before disputing one; this is the second such correction in two reports.

---

### Status Report — Server Team — 2026-08-21 — 08:42 AEST

**Memory ID:** projman2-server-agent
**Current Status:** 🟢 On Track

**This Week's Deliverables (Completed):**
1. Real branded HTML recovery email (dark "ProjMan." header lockup + logo, bordered OTP block, brand-orange footer) over Gmail SMTP, replacing dev-console-only codes — xprojman-26 — Completed 2026-08-20
2. Fixed an email-client rendering bug (card was flush-right instead of centered — `align="center"` on a `<td>` alone isn't reliable across clients); applied the standard `<center>`-wrapper + `margin:0 auto` pattern, re-verified with a live send — Completed 2026-08-21
3. ClickSend wired as the SMS provider for the existing onboarding mobile-verification flow (`/auth/sms/request`/`verify`) — new adapter in `lib/sms.js`, credentials verified live against ClickSend's account endpoint — Completed 2026-08-20
4. `docs/decisions/xprojman-26.md` — forgot-password contract for the App team, including an explicit error-handling table (no "email/phone not found" state exists server-side, by design) — Completed 2026-08-20
5. Monitor armed on `docs/decisions/` for new/changed files (group-NN, xprojman-NN, roles docs) — Completed 2026-08-21

**Blockers / At-Risk Items:** None.

**Next Week's Plan (3-5 items):**
1. Commit + push the outstanding `server/api` diff (email/SMS wiring, `xprojman-26`) — 2026-08-21
2. Correct `docs/projman-roles.md` §9/§10 and `group-01.md` §3/§8/§9 — both list App and Portal as "Blocked On: Server P10 (2026-08-28)"; see correction below — 2026-08-21
3. No new server build work is queued pending PM re-confirmation of priorities in light of the correction below.

**Dependencies & Needs:** None currently — see correction below for what this changes for other teams.

**Changes to Previously Reported Plan:**
1. **Correction to `group-01.md` §3 ("P10 Corrective Migration — NOT STARTED") — this entire section is stale. Every listed item is already built and has been for weeks:**

   | group-01 §3 item | Actual state (verified against code, not memory) |
   |---|---|
   | `builder`/`developer`/`accountant` roles | `migration_v012_corrective_roles.sql`, commit `10295e2` ("DIRECTIVE 1 corrective migration v012-v016") |
   | `progress.write` → `progress.tick`/`progress.verify` split | Same migration; enforced in `TaskProgressService.js:30,57` |
   | `programme.write` scoped to Stages 1-8 for PMs, read-only from Stage 9 until a Builder is accepted | `ProjectService.js:250-268`, `assertProgrammeWriteScope()` — the code comment literally reads "Corrective migration Step A" |
   | `builder_engagement_type` / engagement-mode visibility | `migration_v013_identity_model.sql`, `migration_v019_procurement.sql` |
   | `subcontractor_pass_through_consent` | `migration_v014_subcontractor_consent.sql` |
   | `tax.approve` + `accountant` role | Same as roles, `migration_v012` |
   | `introductions` data model + endpoints | `routes/introductions.js`, `IntroductionService.js` |
   | `job_awards` data model + endpoints, incl. `GET /job-awards/pending` | `routes/jobAwards.js:22`, `JobAwardService.js` |
   | §7 "PM2-02 — NOT STARTED, scheduled Q4 2026" | Built and committed **2026-08-06**: `migration_v027_engagements_identities_attestations.sql`, commit `002b468` — VeriTrade's login/identity backend (already live) is built directly on top of this |

   Net effect: **App and Portal are not blocked on Server P10** — it isn't upcoming work, it's already shipped. `docs/projman-roles.md` §9 ("Blocked On: Server P10") and `group-01.md` §8/§9 should be corrected accordingly; happy to send a follow-up doc once the PM confirms how to reconcile this with the 2026-08-28 deadline (which appears to have no remaining server-side work under it).
2. No other changes.

**Risks:**
1. Status docs (`group-01.md`) asserting build state that contradicts git history — Mitigation: this project has hit this exact pattern before ([[projman2-review-gate]]); recommend a "verify against `git log`" step before a group directive states what is/isn't built, not just what's planned.
