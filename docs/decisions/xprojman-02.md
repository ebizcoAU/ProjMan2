# xprojman-02 — App Team Assessment: current implementation vs. 18-Stage Spec v3.4

**Status:** 🟡 Assessment delivered · **Author:** App dev (Flutter) · **For:** Manager
**Date:** 2026-07-27
**Directive:** DIRECTIVE 1 — App Team (Manager → App Agent)
**Required reading completed:** `ProjMan_18Stage_Specification_v3.4.pdf` (read in full,
35 pages) · `devroadmap.md` · `appdesignspecification.md` · `serverdesignspecification.md`
**Naming note:** filed under the `xprojman-NN` series (see `xprojman-01.md`, the Server
Team's companion assessment) to avoid clashing with the existing `projman-01`–`projman-05`
decision-record series, which predates this v3.4 pass and covers different content
(`projman-02.md` in particular is the earlier, still-DRAFT cross-tenant architecture record
— unrelated to this report).

---

### App Team Assessment — 2026-07-27

#### Summary
- **Roles found in codebase:** old 6-role set only, hard-coded in two places —
  `pair_device_screen.dart:26-30` (5-role pairing fallback) and `profile_tab.dart:60-77`
  (6-role label switch: `projectManager`, `siteSupervisor`, `foreperson`, `tradie`,
  `inspector`, `client`). `builder` does not exist anywhere in `app/lib/`. The app is
  otherwise architected to consume roles/permissions as server data (`PermissionsService`),
  not to hard-code a role list — these two spots are the exception.
- **Identity flow implemented:** two steps (Register → Pair Device), not three. No
  Introduction, no Job Award.
- **Permission checks in UI:** almost none. Stage/programme advancement
  (`project_detail_screen.dart._advance()`) is ungated by any permission check. The one real
  split that exists is scoped to Quality only: `quality.write` vs `quality.validate`
  (`inspection_detail_screen.dart:39-40`).

---

#### A1 — Role Enumeration
**Status:** Missing (`builder`) / Partially (old set present but outdated)
**Details:** Current coded set is the old 6 roles (`projectManager`, `siteSupervisor`,
`foreperson`, `tradie`, `inspector`, `client`), hard-coded in a pairing-screen fallback list
and a profile-tab label switch.
**Gap:** v3.4 requires 9 roles including `builder` as "the single biggest correction in this
framework" — not present at all, not even as a stub.

#### A2 — Identity Model
**Status:** Missing
**Details:** `router.dart` routes are `welcome, login, register, recovery, onboarding,
pairDevice, joinDevice, home, ...` — exactly the old two-step Register→Pair-Device shape.
**Gap:** No Introduction step (project-independent QR business-card swap between two
self-registered users) and no Job Award (PM-sourced-from-contact-book invitation +
deposit). Zero hits for "introduction," "contact book," "job award," or "award" anywhere
in `app/lib/`.

#### A3 — Tick-Verify Split
**Status:** Partially
**Details:** `progress.tick`/`progress.verify`/`progress.write` don't exist as strings
anywhere in the app. A structurally similar split exists, but only for Quality:
`quality.write` (Tradie/Foreperson-shaped write) vs `quality.validate` (Inspector-only),
checked via `PermissionsService.has(...)` in the inspection screens.
**Gap:** Generic task/stage progress has no tick/verify separation at all — `_advance()` on
the project tracker isn't gated by any permission. The v3.4 spec wants this split applied to
all progress, chained Tradie-ticks→Foreperson-verifies→Site-Supervisor-oversees.

#### A4 — PM Programme Wall
**Status:** Missing (as a *concern* — there's nothing to wall off yet)
**Details:** `project_detail_screen.dart` is a flat, non-editable vertical stage list with one
button (`_advance()`) that only moves the single current stage forward. No Gantt, no
per-stage date/task editing exists for *any* role, PM included.
**Gap:** Not "PM has edit access it shouldn't" — rather, no Programme/Gantt UI exists yet at
all, so the read-only wall (and the underlying Builder-authored schedule it's meant to
protect) hasn't been built either. Nothing to correct yet, but nothing to build the wall
around yet.

#### A5 — Builder Engagement Mode
**Status:** Missing
**Details:** Zero hits for `engagement_mode`, `independent_fixed`, `independent_cost_plus`,
or `employee`-as-engagement-concept.
**Gap:** No representation of the three engagement modes or their visibility implications.

#### A6 — Job Award Flow
**Status:** Missing (in both directions — neither shape exists)
**Details:** No "Job Award," "deposit," or contact-book invitation code. The only
engagement-like mechanic in the app is the QR device-pairing pair (`pair_device_screen.dart`
/ `join_device_screen.dart`), which is intra-org device pairing, not Job Award.
**Gap:** Job Award (PM's Portal-side invitation + Builder's in-app accept tap + deposit
transaction) doesn't exist. Note per spec, `S9.6` (the invitation) is Portal-only anyway —
app's slice is only the `S9.7` accept/decline tap + notification, which also isn't built.

#### A7 — VeriTrade Login
**Status:** Missing
**Details:** Zero hits for "veritrade" anywhere in `app/lib/`. No "scan to sign in" or
session-approval flow under Profile.
**Gap:** Entire §8 flow (QR session approval, Approve/Deny, signed-device-key response)
absent. Expected — this is explicitly the last build phase (P12), gated on `PM2-02`.

#### A8 — Introduction Flow
**Status:** Missing
**Details:** Confirms A2 — the only QR generate/scan code that exists is the pairing pair,
which is always tied to becoming a paired device under an org/role. No project-independent,
org-independent "digital business card" exchange exists.
**Gap:** Full §2.3/§2.2 Introduction mechanic absent.

#### A9 — Geo-Fence Safeguard
**Status:** Partially (informational only, not a false-positive risk — but no explicit
human-verify step either)
**Details:** `site_attendance_view.dart:6-10` explicitly documents geofence as **never
blocking**: permission-denied still checks in, geofence result shows as an "illustrative"
chip. Check-in itself is a single tap (`_toggle()` → `SiteOpsService.toggleCheck()`) with no
confirmation step.
**Gap:** The app correctly avoids treating geofence-match as *sufficient proof* (good —
matches the spec's anti-fraud warning), but there's also no explicit tick-then-verify chain
wrapped around attendance the way Quality has one. The spec's mitigation
("Foreperson/Site Supervisor separately verifies the work was done") isn't yet wired to
attendance specifically — the Site Diary sign-off is the closest analog but isn't
structurally linked to individual check-ins as a verification step.

#### A10 — Dispute Mechanism
**Status:** Missing
**Details:** Zero hits for "dispute" anywhere in `app/lib/`. No reject/contest/appeal path
exists on the inspection or quality screens.
**Gap:** Full §2.7 Escalation & Dispute mechanism (Tradie→Site Supervisor first, never
Builder, append-only counter-evidence) absent.

---

#### Root Cause Analysis
This is not a misread of the design — it's a **sequencing gap, not a defect**. Every app
increment that exists (P2 identity 2026-07-22, P4 projects 2026-07-24, P5 site ops + P6a
quality 2026-07-26) was built and committed against the **older framework**
(`development.md`, the old `appdesignspecification.md`/`servdesignspecification.md` now
moved to `docs/old/`, and the 6-role model with no `builder`). The v3.4 18-Stage spec and its
three companion docs (`devroadmap.md`, the current `appdesignspecification.md`,
`serverdesignspecification.md`) are dated **26–27 July 2026** — i.e., they superseded the
framework the app team was building against on the same day or the day after the last app
commit. `devroadmap.md` itself frames this correctly: it names the missing `builder` role
and the ungated `programme.write` as corrections to a previously-built matrix, and schedules
the fix as a **server-side corrective migration first** (its own §11 Phase P10,
`serverdesignspecification.md` §9 Step A), not an app defect to silently patch around.

One encouraging signal: the app is already architected to receive server-declared
permissions generically (`PermissionsService.has(permission)`, roles-as-data, no hard-coded
enforcement) rather than branching on role names. The one place a tick/verify-shaped split
already exists — Quality's `quality.write`/`quality.validate` — is structurally exactly the
pattern the new spec wants generalized. Catching up should mostly be additive, not a
rewrite, once the server ships its side.

#### Recommended Corrections
1. **Blocked on server first** (per `serverdesignspecification.md` §9 Steps A/A2/B — do not
   build app-side ahead of these): add `builder` to role handling (A1), generalize
   `progress.tick`/`progress.verify` off the Quality pattern for stage/task advancement
   (A3), `engagement_mode`-aware Cost/Programme visibility (A5), Job Award data model
   consumption (A6).
2. **Can start now, independent of the server corrective migration:**
   - Introduction QR flow (A2/A8) — needs only the `introductions` table + endpoint (server
     Step B), a smaller lift than the full corrective migration.
   - Dispute mechanism UI shell (A10) — the spec itself recommends building this *alongside*
     the tick/verify chain, not after.
   - Programme/Gantt view (A4) — currently doesn't exist for anyone; worth scoping now since
     `S1.3`'s renderer-selection logic is already resolved in the spec.
3. **Gated on decisions outside the app team's control:** VeriTrade login (A7) — blocked on
   `PM2-02` (identity-scoped evidence domain), explicitly the platform's last build phase.
   Job Award's legal validity (in-app tap + deposit as contract execution) needs solicitor
   confirmation before that UI is treated as final, not just built.
4. **No action needed:** A9's current behavior (geofence never sufficient alone) already
   matches the spec's intent — just needs an explicit verification-step tie-in once the
   tick/verify generalization (item 1) lands, rather than being a standalone fix.

#### Team Readiness
**Partial — cannot proceed on the core items until server ships its corrective migration.**
A1/A3(generalized)/A5/A6 all depend on server-side schema/permission work that hasn't landed
(`serverdesignspecification.md` §9, Steps A–B, confirmed not yet built per the companion
Server Team assessment, `xprojman-01.md`). App team can start now on Introduction (A2/A8)
and the Dispute mechanism shell (A10) without waiting. Recommend NOT starting Job Award UI
or VeriTrade until, respectively, the legal question (open decision #14 in `devroadmap.md`)
and `PM2-02` are resolved — building ahead of either risks visible rework.

**Aside, not one of the ten directive items:** `docs/decisions/projman-05.md` — the prior PM
status doc — reports "merged to main," "deployed to staging," and full sign-off on this same
P5/Quality work; `git status`/`git log` on this branch show none of that has actually
happened — everything is still uncommitted or on `server/p5-site-ops`, unpushed. Recommend
treating that doc's operational claims as unverified until confirmed against git/deploy
state directly, independent of this assessment.

---

### Timeline

| Item | Timeline |
|---|---|
| Assessment completion | Within 24 hours of receipt — met, delivered same day |
| Report submission | This document |
| Review by Manager | Within 12 hours of receipt |

© eBizco Australia Pty Ltd
