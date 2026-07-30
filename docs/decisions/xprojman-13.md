# xprojman-13 — Self-Registration (Step 1 of §2.3): role-at-registration, and how far v1 goes

**Status:** 🟢 Owner-approved 2026-07-30 — **Fork A**. Next: Server Agent confirms the §5 register shape; App builds the role step on that confirmation.
**Author:** App dev (Flutter) · **For:** Owner · Server Agent
**Date:** 2026-07-30

> ## 0. Owner decision (2026-07-30)
> **Fork A is approved** (§4): role-at-registration, v1 App self-register set = **Builder**
> founding their own org with role `builder` (not forced `projectManager`); crew (Site
> Supervisor / Foreperson / Tradie / Inspector) keep arriving via device pairing until
> **PM2-02**; PM / Property Developer self-register on the Portal. The register shape in §5
> is the sanctioned proposal (`POST /auth/register` accepts `role`, allow-list-enforced,
> registrant made `org_admin` of their own new org).
> **Ordering (per Manager's critical path):** the App does **not** wire the role into the
> register payload until the Server Agent confirms and *honours* it — today `/auth/register`
> hard-codes `projectManager` (`auth.js:172`) and would ignore an unknown `role`, making the
> UI claim "Builder" while the server silently creates a PM. So: **Server Agent confirms §5
> → App builds the role step.** Ball is with the Server Agent.
**Context:** the three-step primitive is `Self-Registration → Introduction → Job Award`
(`appdesignspecification.md` §2.3). Steps 2 and 3 are built and wired (Introduction —
`xprojman-03/04`; Job Award S9.7 accept/decline + discovery — `xprojman-11`/`xprojman-12`).
**Step 1 is the missing piece**, and it is not a screen tweak — it decides what an
*identity* is at birth, so it needs a nod before code.
**Related:** `xprojman-08` (ONE fixed role — the role chosen here is permanent) ·
`projman-02` / PM2-02 (portable cross-tenant identity — the deferred domain this brushes
up against) · `appspec` §1 (which roles self-register where), §2.3 Step 1, §9.

---

## 1. What "Self-Registration" means in the spec

§2.3 Step 1: a person "downloads the app, builds a profile independently — identity,
licence, quals — **unconnected to any peer, any Builder, any project**." §1 adds: the
field-primary roles (**Builder, Site Supervisor, Foreperson, Tradie, Inspector**)
self-register **on the App**; **PM and Property Developer** self-register through the
**Portal**; **Client never** touches the App. One identity model, role-appropriate
entry point, never two records for one person.

The role picked here is, per `xprojman-08`, **the one fixed role for the life of the
account** — not a per-project hat. That is the weight this step carries.

## 2. What exists today (and why it doesn't satisfy §2.3)

- `POST /auth/register` (`server/api/src/routes/auth.js:90`) **creates an organisation
  and its first user**, and hard-codes that user's role to **`projectManager`**
  (`auth.js:172`).
- `register_screen.dart` is a two-step form: (0) account, (1) **business** — org name +
  ABN + business type + GST — then `/auth/register` + `/auth/onboarding`.

Consequences that contradict §2.3 Step 1:

1. **No role choice.** Every self-registrant becomes a `projectManager`. A Tradie,
   Builder, Site Supervisor, or Inspector cannot self-register *as themselves*.
2. **Registration = founding a company.** You must name a business to exist at all — a
   tradie who works for other people is forced to invent an org and become its PM.
3. So today the only way a non-PM gets onto the platform is **device pairing into an
   existing org** — someone else creates them. That is the opposite of "unconnected to
   any peer, any Builder."

## 3. The real tension (why this is a fork, not just a form)

Full §2.3 Step 1 — every field role self-registers as an **independent identity that
later spans many Builders** — *is* the portable cross-tenant identity domain we already
deferred to **PM2-02** (`projman-02`). The platform's v1 invariant is **one org = one
tenant = one company**, and a session carries a single `org_id`. An identity that
belongs to no org, or floats between orgs, breaks that invariant.

So the question isn't "should we build Self-Registration" — it's **how much of it v1 can
deliver without opening PM2-02.** Two sub-populations pull differently:

- **Business-owning roles** (Builder, PM, Property Developer) *do* found an org — that
  org is their business. Self-registration for them is just "register with the right
  role instead of a forced `projectManager`." **No invariant broken.**
- **Crew roles** (Site Supervisor, Foreperson, Tradie, Inspector) are *engaged by* a
  business; they don't own one. A truly independent, org-less registration for them is
  the PM2-02 identity — not a v1-modest change.

## 4. Forks — v1 scope (Owner decides)

**Fork A — Role-at-registration for the business-owning case; crew stays via pairing (RECOMMENDED v1).**
Add a role picker to Self-Registration; the App-side self-register set for v1 is
**Builder** — the Job-Award counterpart we most need — founding their own org with role
`builder` instead of forced `projectManager`. PM/Property Developer self-register on the
Portal (server track). Site Supervisor / Foreperson / Tradie / Inspector keep arriving
via **device pairing into an existing org** (already built, same-tenant, works).
Independent registration for crew = PM2-02, sequenced after.
- *Server change:* `/auth/register` accepts a `role` from an allow-list, drops the
  hard-coded `projectManager`. Small.
- *Keeps* the one-org invariant intact; *honest about* what §1 fully wants vs what v1
  ships.

**Fork B — Full App self-registration for all five field roles now (org-less identity).**
Deliver §1 literally: Tradie/Foreperson/etc. self-register as bare identities with no
org, membership arriving only on Job-Award-accept / pairing. Matches §2.3 word for word.
- *Server change:* nullable `org_id` in the session + identity model, membership as a
  separate grant — **this is PM2-02**, not a small change. Rejected for v1 on scope.

**Fork C — Status quo, defer all of Step 1 to PM2-02.**
Build nothing now; keep pairing as the only non-PM entry. Rejected: it leaves the
three-step primitive with a permanently missing Step 1, and the Builder self-register
case (which Job Award depends on to have a counterpart) is genuinely v1-shaped.

**Recommendation: Fork A.** It ships the one self-registration case v1 actually needs
(Builder, so a PM has someone to award *to* who self-registered), leaves single-role and
one-org invariants untouched, and cleanly names the rest as PM2-02 rather than
half-building it.

## 5. If Fork A — the app-side build + the server ask

App-side (small, no new architecture):
- Add a **role step** to `register_screen.dart` for the App-eligible role(s) — v1 a
  single confirmed "I'm a Builder" path (extend the picker when PM2-02 opens crew
  registration). The role is shown as permanent (per `xprojman-08`).
- Make the **business step role-appropriate**: a sole-trader Builder shouldn't be forced
  to type a distinct "company name" — default the org name to their own name, ABN still
  optional in v1 (reuse existing onboarding fields, `businessTypeToEnum`).

**Server ask (please confirm / correct — same posture as `xprojman-04`/`xprojman-12`):**
- Should `POST /auth/register` take a **`role`** field validated against an
  App-self-register allow-list (v1: `builder`)? Or do you prefer a distinct
  `POST /auth/self-register` so the org-founding `/auth/register` stays PM-only?
- What is the **allow-list** you'll enforce, and the error code for a disallowed role
  (e.g. `ROLE_NOT_SELF_REGISTRABLE`)?
- Confirm the registrant is still made **org_admin of their own new org** when the role
  is `builder` (so they can run their business), or whether `builder` ≠ org_admin
  shifts any of your onboarding/permission wiring.

## 6. Boundaries (unchanged)

- Single-role model (`xprojman-08`) holds: one role, chosen once, permanent.
- Same-tenant v1; cross-company portable identity = **PM2-02**, explicitly not this.
- Client never self-registers on the App; PM/Property Developer self-register on the
  Portal (server/portal track, out of app scope).

## 7. Ask

Owner: pick the §4 v1 scope (recommend **Fork A**). Server Agent: on Fork A, confirm the
§5 register shape. On confirmation the app adds the role step with no new architecture;
everything beyond Builder self-registration is booked as PM2-02, not attempted here.

© eBizco Australia Pty Ltd
