# xprojman-33 — App: role-by-role information needs, grounded in the 18-Stage task library

**Status:** 🟡 DRAFT — design exploration for owner review, not a build spec.
Nothing here is scoped/estimated; treat every "App should..." line as a
proposal, same review-gate convention as `xprojman-27`–`32`.
**Author:** App Agent (`projman2-app-agent`) · **For:** Owner · All Teams
**Date:** 2026-09-03
**Method:** put myself in each of the 5 roles the owner named (Project
Manager, Builder, Site Supervisor, Tradie, Client) and asked, stage by stage,
"what would I actually want on my phone here" — grounded in
`docs/researchPaper/18Stage_Tasks.md`'s 139-task library (the real
on-the-ground work, not just the software's sub-step codes) and
`docs/processmap.md`'s Definition-phase framing, cross-checked against what
`appdesignspecification.md` already locks in (nav model §3, role table §1,
stage-by-stage App surface §9).
**Related:** `appdesignspecification.md` (role model, nav, §9 table — this
doc proposes refinements, doesn't replace it), `docs/researchPaper/
18Stage_Tasks.md` (source of the per-stage detail below), `docs/processmap.md`
(Definition-phase, node A "capture enquiry"), `xprojman-27` (module split,
several modules referenced below).

---

## 0. One thing to flag before the role-by-role — Client

The owner asked me to consider 5 roles including Client. `appdesignspecification.md`
§1 currently locks Client as **Portal-only, never pairs a device** — a
deliberate decision (Client is the least sophisticated, least repeat-player
party; the App is the trust/identity root for VeriTrade and Job Award, and
Client isn't part of that trust graph at all). I haven't overridden that
lock — §5 below explores what a Client actually needs at one specific
moment (`S18.4`'s in-person walkthrough) where the current Portal-only design
creates a real friction, and proposes a narrow, non-identity answer rather
than "give Client an App account." Flagging up front so this doesn't read as
quietly relitigating a locked decision.

---

## 1. Project Manager

**Locked today:** sole App actor through Stage 8; read-only recall + notes
from Stage 9 on (`appdesignspecification.md` §4.1).

**What I'd want, stage by stage (from the task library):**
- **Stages 1–2 (land/hazard):** I'm often standing on the actual block, not
  at a desk, when I need to check turning radius (S1.6), HV clearance (S2.3),
  or whether the site's in a BAL zone (S2.5). I want these **auto-flagged and
  visible the moment I open the project on my phone** — not something I have
  to remember to check on Portal later. A "risk banner" (BAL/heritage/
  covenant/flood — whatever's flagged) pinned to the top of the project, on
  every screen, the way HV-line warnings are already speced to appear on
  every site diary entry (18Stage_Tasks S2.3).
- **Stages 1–8 generally:** most of my actual bottleneck is **external
  parties** — surveyor, town planner, architect, certifier — none of whom
  have a system login. I want push reminders on my phone for "surveyor
  quoted 2-3 weeks, that's up Friday" and the council response clock (60/75/
  90-day warnings), because I'm the one who has to chase, and I'm rarely
  sitting at my laptop when I remember to.
- **Stage 3/5 (concept/budget):** a one-glance "does this fit the budget"
  view — cost-per-m² vs the Stage 1 range, flagged red if the client's
  picked tier is out of range (S5.3) — so I can have that conversation on
  the spot, not after going back to the office.
- **Stage 9:** notification when Builder responds to Job Award (already
  built) — nothing more needed here, this is right.
- **Stages 10–18:** I genuinely don't want Portal functionality on my phone
  here (the lock is correct) — but I do want a **single glance-and-go
  status card** per project: current stage, next milestone + date, any open
  hold point, budget % used — because I'm visiting multiple sites in a day
  and I want to know "is anything on fire" before I even get out of the car.
- **Stage 18 — the sharpest gap:** `S18.4`'s Practical Completion walkthrough
  is PM-and-Client, standing together in the finished house, generating a
  defect list on the spot. This is already App-surfaced for me
  (`appdesignspecification.md` §9 row 18: "PM on App"), which is right — but
  see §5 below on what happens to the Client's half of that same moment.

**Information I want to see:** active risk flags per project, external-party
clock/reminders, cost-per-m² vs budget range at concept stage, Builder
response notifications, a per-project status card (stage / next milestone /
open hold points / budget %) for Stages 10–18, my own delivery-reliability
record.

---

## 2. Builder

**Locked today:** Introduction any time; Job Award accept/decline; Team
sub-page (crew read-view); site walkthrough capture; job-monitoring
notifications; explicitly NOT Cost Plan/Gantt/tender authoring
(`appdesignspecification.md` §4.2).

**What I'd want:** the task library confirms Builder is barely a *typical
actor* anywhere in Stages 10–18 (`18Stage_Tasks.md` — it's almost entirely
Foreperson/Tradie/Site Supervisor/Inspector doing the hands-on work). My App
role is oversight of a business, not on-site capture:
- **A morning "what needs me" digest**, not a raw activity feed — variance
  flags (cost/programme overrun), a hold point that's been open too long,
  a defect count climbing on a job — the things that need *my* decision, not
  every tick Foreperson makes. Job-monitoring says "App for notification"
  already (`appdesignspecification.md` §6); the ask here is that the
  notification be pre-filtered to what actually needs me, not everything.
- **Job Award review that shows what I'm actually saying yes to** — S9.7's
  `builder_engagement_type` choice and S9.8's locked Cost Plan are the real
  commercial weight behind my tap; even though I don't author them, I want
  the App's review screen to surface the project/price-ballpark/programme
  clearly before I tap Accept, not just "PM invited you."
- **Subcontractor register, read-only** — S9.10 has me engaging my own
  panel (Portal, desk work — correct), but once I'm on-site I want to glance
  at who's committed/owed on this job without going back to a screen built
  for authoring.
- **My own Verified Work History** — completed-project count, on-time
  delivery, dispute record — since a Builder can check a PM's reliability
  the same way a PM checks mine (§2 of appdesignspec), I want to see my own
  number building.

**Information I want to see:** a filtered "needs my decision" notification
feed (not a raw log), pending Job Award invitations with enough context to
decide, read-only subcontractor register per job, my own reliability record,
crew status across all my active jobs (already speced).

---

## 3. Site Supervisor — the daily driver

**Locked today:** the richest App role already — crew sign-in, toolbox talk,
hold-point-before-work check, deliveries, walkthrough, diary sign-off
(authoritative), verification, disputes queue (`appdesignspecification.md`
§4.3). The task library's Stage 10-17 rows put Site Supervisor in an
**independent-check** position constantly (S10.7 setout, S11.8 services,
S14.5 QA, S16.10 verify) — never reporting to Builder, always the PM's
independent eyes.

**What I'd want:** this role is already well-designed; the task library
mostly confirms it rather than surfacing gaps. Two things worth naming:
- **One "today" screen, not five separate ones.** Muster list (S10.1),
  today's hold-point status (is anything still blocking the crew from
  starting), and my pending-verification queue (everything Foreperson/
  Tradies ticked that needs my sign-off) should be **one landing screen**,
  since in practice I'm doing all three back-to-back every morning before
  anyone touches anything. Right now the nav model has these as separate
  Site/Quality tab destinations — worth a "Today" composite view rather than
  navigating between tabs to assemble the same picture.
- **Structured, not free-text, capture at specific moments.** S12.1 (pour
  weather conditions), S14.7 (weather-secure confirm) — these read as
  "log a note" today; the task library frames them as specific structured
  fields (temperature/humidity at pour time) worth a purpose-built capture
  form rather than a generic diary note, since they're the evidence trail
  for a defect claim later.

**Information I want to see:** unchanged from what's already speced — this
role's design holds up well against the task library. The "Today" composite
view is the one concrete proposal.

---

## 4. Tradie

**Locked today:** own assigned tasks, self check-in, raise hazard, own
certs/dockets, mark progress, portable Digital ID/Verified Work History,
raise a dispute (`appdesignspecification.md` §4.5). The task library shows
Tradie as the *typical actor* on nearly every hands-on Stage 11–17 task —
this is the highest-volume role by task count.

**What I'd want:**
- **A "my jobs today" list that already carries the warnings** — if S2.3
  flagged HV lines within 5m, or S2.5 flagged BAL, I want that surfaced
  **on the specific task I'm about to do**, not buried in a project-level
  risk screen I have to go find. I'm the one physically near the hazard.
- **One-tap tick, with the hold-point gate visible before I even try.**
  S15.8 (plasterboard) is explicitly gated on two hold points — I'd want the
  App to show me *why* a task is greyed out ("waiting on electrical +
  plumbing inspection") rather than a task that just won't tick, so I know
  whether to chase someone or wait.
- **My verification status visible per task, not just per day.** Did
  Foreperson/Site Supervisor sign off what I ticked yesterday? If declined,
  I want "raise a dispute" right there on that specific record — already
  speced (§2.7), the ask here is just that it's discoverable from the task
  itself, not a separate Disputes hunt.
- **Credential expiry reminders on my own profile** — this overlaps
  `xprojman-27` module #4 (Tickets), not yet built: I want my licence/ticket
  expiry to nudge me before it lapses, since it's portable and mine to keep
  current regardless of which Builder I'm working under this month.

**Information I want to see:** today's assigned tasks with any relevant
hazard flag attached at the task level, why a gated task is blocked (which
hold point, whose court it's in), my own verification status per task,
credential expiry countdown, my accumulating Verified Work History.

---

## 5. Client — the one that needs an owner decision, not a build

Per §0, Client is locked Portal-only today. Walking the task library as if I
were the Client:
- **S6.2 material selections, S7.2 DA sign-off, S18.7 survey, S18.11 final
  sign-off** — all genuinely fine, arguably *better*, on a bigger screen at
  home. A material-selection gallery or a legal document is not an on-site,
  time-pressured moment. No change proposed here — Portal is the right
  surface.
- **S18.4 — the one real mismatch.** This is a PM-and-Client walkthrough
  *of the physical, finished house*, generating a defect list on the spot.
  Today's design has the PM capturing it on the App while the Client's
  presence in that same room routes through... nothing specific — Client is
  Portal-only, and nobody stands in a house holding a laptop open to flag a
  scuff mark on a skirting board.

**Proposal — not "give Client an App account":** a Client account with a
paired identity would break the locked one-person/one-role/App-is-identity-
root model (`[[projman2-identity-role-model]]`, `appdesignspecification.md`
§1) for no real reason — Client isn't part of the Introduction/Job Award/
VeriTrade trust graph at all, and doesn't need to be. What's missing is
narrower: a **session-scoped, no-login mobile web view**, generated for the
specific S18.4 walkthrough — e.g. a link or QR the PM hands the Client at
the door, live only for that walkthrough session, letting the Client tap
"flag this" against the same defect list the PM is building, from their own
phone, in their own hands, standing in their own house. It expires with the
session; it's not a persistent Client account, not a paired device, not a
new identity in the trust graph — just a better way to co-author one list
in one room for twenty minutes.

**This needs an owner call, not App building ahead of one:** does this
belong in scope at all, and if so, is "PM's screen shows a QR, Client scans
with their phone's camera (no app install) into a plain web page" an
acceptable shape, or is something else preferred (e.g. PM simply reads the
Client's comments aloud and types them in himself, keeping the status quo
and treating this as a non-problem)? Flagging, not deciding.

---

## 6. Cross-cutting patterns that showed up in more than one role

- **"Today" / "what needs me" composite screens keep recurring** (PM's
  status card, Site Supervisor's Today view, Builder's filtered digest,
  Tradie's task list with warnings attached) — every role wants a single
  entry point that pre-assembles "what do I need to know/do right now"
  rather than making them navigate tab-by-tab to reconstruct the same
  picture. Worth considering as one design pattern applied per-role, not
  five separate asks.
- **Hazard/risk flags need to travel with the task, not just live on a
  project-level screen** — PM wants it at the project level, Tradie wants it
  at the specific task level. Same underlying data (Stage 2's hazard audit
  findings), different altitude of display per role.
- **External-party/clock tracking (council, surveyor, architect) is a
  recurring PM pain point across Stages 1, 2, 4, 6, 7** — appeared enough
  times in the task library's "PM's Reality Check" column that it reads as
  its own small feature (a generic "tracked external deliverable" with an
  expected date + reminder + document slot), not five one-off asks.

## 7. What's explicitly NOT proposed here

No schema, no new tables, no App code — this is the "what would I want"
exploration the owner asked for, ahead of anything getting scoped. Several
of the "ProjMan2 System Need" entries in `18Stage_Tasks.md` §Notes already
flag that things like the R-code lookup table, conditions register, and
council-response clock aren't in the schema yet — this doc doesn't
re-litigate that, it's naming which of those a role would actually want
surfaced on their phone, once/if they exist.

## 8. Open questions for owner

| # | Question | Why it matters |
|---|---|---|
| 1 | Is the Client walkthrough companion view (§5) worth scoping, or is the status quo (PM types the Client's comments) fine? | Only real Client-facing gap found; everything else Client does is legitimately desk-shaped |
| 2 | Is a per-role "Today"/composite landing screen (§6) worth a design pass, or should each role keep navigating tab-by-tab? | Recurring pattern across 4 of 5 roles, but a real nav-model change, not a small tweak |
| 3 | Risk-flag propagation to task level (§6) — does this wait for the schema gaps named in `18Stage_Tasks.md`'s own Notes section, or is there a cheaper interim version? | Depends on schema work not yet scoped |

---

## 9. Team contributions

*(Dated, initialled entry per contribution, same convention as
`xprojman-27`–`32` — don't silently overwrite, add below.)*

- 2026-09-03, App Agent: initial draft, all 5 roles, per owner request.

---

© eBizco Australia Pty Ltd
