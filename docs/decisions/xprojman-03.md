# xprojman-03 — App Team: P0 items complete (Introduction, Disputes, Programme)

**Status:** 🟢 Complete · **Author:** App dev (Flutter) · **For:** Manager
**Date:** 2026-07-28
**Directive:** DIRECTIVE 2 — App Agent (Manager → App Agent), items A/B/C
**Verification:** `flutter analyze` — no issues. `flutter build macos --debug` — succeeds.
**Not yet done:** run on-device against a live server (A/C need endpoints that don't exist
yet server-side — see scope notes below).

---

## A — Introduction QR Flow

**Built:**
- `NexusService.introductionCode()` / `.introductionScan()` / `.introductionContacts()` —
  three new REST calls (`nexus_service.dart`), mirroring the existing pairing-call
  convention.
- `screens/introduction/introduction_screen.dart` — show-my-code / scan / contacts list,
  phase-based like `pair_device_screen.dart` but with no device/role/confirm step, since
  both parties already hold their own session.
- Route `/introduction` + entry point: Profile tab → "Introduction" button.

**Scope note — server dependency, flagged not hidden:** `serverdesignspecification.md` §7.3
specifies the `introductions` table shape but no REST contract. I invented one
(`POST /introductions/code`, `POST /introductions/scan`, `GET /introductions`) matching this
codebase's existing pairing-endpoint naming, so there's an obvious shape for the server side
to land against. Until that ships, these calls fail gracefully (`NETWORK`/404) exactly like
any other not-yet-built endpoint — same posture P2's OAuth buttons had before real provider
SDKs existed. **Recommend Server Agent confirm or correct this endpoint shape before
building it**, rather than me guessing twice.

## B — Dispute Mechanism UI Shell

**Built:**
- `disputes` local SQLite table (schema bump v3→v4, `schema_domain.dart` + `database.dart`).
- `dispute_service.dart` — raise / markReviewing / resolve, append-only (original `reason`
  never touched by `resolve`).
- `screens/quality/raise_dispute_screen.dart` — reusable bottom sheet (reason + optional
  counter-evidence photo placeholder).
- `screens/quality/disputes_queue_view.dart` — filterable queue (Open/Reviewing/Resolved),
  resolve/mark-reviewing gated behind `disputes.review`.
- Wired in: Quality tab gained a 4th sub-page ("Disputes", cycled via the header-title tap
  like the other three); `inspection_detail_screen.dart` items get a flag icon once they
  carry a result, opening the raise-dispute sheet.

**Scope notes:**
1. **Local-only, deliberately.** No `disputes` table/endpoint exists server-side (confirmed
   against `xprojman-01.md` S1–S15 — not listed as built, and `serverdesignspecification.md`
   §7.2's `disputes.read`/`disputes.review` permissions aren't wired to any route yet). Rows
   don't ride `/sync/push`; `is_dirty`/`pending_op`/`ever_synced` are carried on the row so
   wiring sync later is a registry change, not a schema rework — same convention as every
   other domain table here.
2. **Entry point is Quality/inspections, not Verified Work History.** The spec places "Raise
   a dispute" under Profile → Verified Work History, which doesn't exist as a screen yet.
   I attached it to the one concrete "verification decision" surface that does exist today
   (an inspection item's pass/fail) rather than build a placeholder VWH screen just to hang
   a button on it. Worth a Profile → Verified Work History entry point once that module
   lands.
3. **`disputes.review` always resolves false right now** — the permission isn't server-side
   yet, so the queue is visible (so it's testable) but nobody can resolve/mark-reviewing
   until the permission ships. This is the same honest-gating posture as `quality.validate`
   before it existed.

## C — Programme/Gantt View

**Built:**
- `screens/projects/programme_screen.dart` — new screen, new route `/project/programme`,
  entry point: an icon action on `project_detail_screen.dart`'s app bar.
- Groups the 18 stages by Part A–E, renders each as a horizontal, sequence-ordered timeline
  of stage bars (colour-coded by the same gate states as the existing tracker).
- A `_isMultiUnit` stub (currently always `false`) selects between this standard view and a
  Line-of-Balance placeholder panel — the `S1.3` conditional-renderer logic devroadmap.md §6
  describes, wired to a variable rather than hard-coded, so plugging in real data is meant to
  be a one-line change.

**Scope notes, stated plainly rather than overclaimed:**
1. **Read-only for everyone, not just PM.** Neither `builder` nor `programme.write`'s
   per-stage scoping exists server-side yet, so there is no permission model to grant Builder
   an edit path against — building one now would mean nobody-in-particular holds write
   access, or worse, holding it open to whoever happens to hold `projectManager` today. A
   banner states this plainly rather than silently having no edit UI at all.
2. **No date-scaled bars.** `ProjectStage` carries no start/end date fields (only `seq`), and
   `S1.3`'s unit-count declaration isn't captured anywhere yet — so bars are sequence-ordered,
   not date-scaled, and the Line-of-Balance renderer is a labelled placeholder, not a fake
   implementation. Both gaps are the same ones flagged in `xprojman-02.md`'s A4/A5 entries;
   this doesn't resolve them, it gives them a real screen to land in once the underlying data
   exists.

---

## What's still blocked (unchanged from `xprojman-02.md`)

`builder` role handling, tick/verify generalisation, engagement-mode visibility, and Job
Award consumption still wait on Server Steps A/A2/B per the original build-order table — none
of today's work started on those, per the directive's own sequencing.

## Team Readiness

**P0 done.** Recommend Server Agent's next report confirm (or correct) the `/introductions/*`
endpoint shape in §A before that flow is built out further, since I had to choose it
unilaterally in the absence of a spec'd contract.

© eBizco Australia Pty Ltd
