# xprojman-17 — App → Server: open questions after Fork A + Job Award inbox went live

**Status:** 🟠 App questions — need Server Agent (Nexus) to answer/confirm; some also need an Owner call.
**Author:** App dev (Flutter) · **For:** Server Agent (Nexus) · Owner
**Date:** 2026-07-31
**Context:** With `GET /job-awards/pending` + Fork A self-registration now committed (`21be2cb`, v018)
and verified live end-to-end from the app's client contract, three questions surfaced that the app
can't resolve on its own. Filed as a coordination record (app-asks / server-confirms, same pattern
as `xprojman-11`/`xprojman-13`).
**Related:** `xprojman-13/14` (Fork A) · `xprojman-11/12` (inbox) · `projman-02` / PM2-02 (portable
cross-tenant identity) · `xprojman-16` §6 (the ":4100 untouched" test discipline, see Q4).

---

## Q1 — Should the `builder` role hold `projects.write`? (xprojman-14 §6 invited this)

`xprojman-14` §6 flagged that a Builder-founder does **not** get `projects.write` — "if a
builder-run business ever needs to create its own projects, that's a matrix decision … flag it if
the app needs it." Flagging it now, because it changes the app's front door:

- A freshly **self-registered Builder** (Fork A) founds their own org and is its `is_org_owner`
  admin — but with no `projects.write`, when they open the app they have **no way to create a
  project**, and the Projects tab is empty until they're awarded onto / paired into someone's job.
- So today the app's self-registration produces a Builder who can administer their org (add
  users, pair devices) but cannot start any work of their own on the app.

**Question:** Is that intended — project *creation* stays a PM function, and a self-registered
Builder simply has an empty Projects tab until engaged? Or should `builder` gain `projects.write`
so a builder-run business can create and run its own jobs? This decides whether the app shows a
self-registered Builder a "New project" action or an explainer about how they get work.
*(App has no preference to push; we build to whichever you and the Owner set. Needs an Owner call.)*

## Q2 — How does a self-registered Builder ever connect to a PM's project in v1? (the coherence gap)

This is the load-bearing one. The three-step primitive is **Self-Registration → Introduction →
Job Award** (appspec §2.3). But:

- **Introduction is same-org only.** `IntroductionService.scanCode` refuses a code whose
  `org_id !== the scanner's org` (`IntroductionService.js:97`); `exists`/`record`/`listContacts`
  all filter on `org_id`. The file's own header says "any two already-registered users **in the
  same org**."
- **Job Award is org-scoped** too (same-tenant v1 — stated in `xprojman-12` §5, `xprojman-14` §6,
  `xprojman-16`).
- **Fork A self-registration puts each Builder in their _own_ new org.**

Put together: a **self-registered** Builder (org B) can **never** be introduced to, or awarded by,
a PM in org A in v1 — different orgs. The only Builders who can actually receive an Introduction +
Job Award today are ones **created inside the PM's own org** (via `POST /organisation/users` or
device pairing) — which is exactly how our live E2E had to seed the Builder to make the inbox
populate. That Builder is *not* self-registered.

So in v1 there appear to be **two disjoint Builder populations**: (a) self-registered Builders who
run their own org and can award their *own* subbies, and (b) a PM's engaged Builder, created inside
the PM's org. The appspec §2.3 story ("meet at a trade event years before, then get awarded") is
inherently **cross-org** and therefore reads as PM2-02, not v1.

**Question:** Is (a)/(b) the intended v1 model — self-registration is for org-founding Builders,
a PM's engaged Builder is provisioned inside the PM's org, and true cross-org Self-Reg → Award
waits for PM2-02? If so we'll word the app accordingly (e.g. a self-registered Builder is told they
won't receive awards from other companies yet, and the Job-invitations inbox is only meaningfully
reachable for in-org invitees). If instead some cross-org introduction/award path is planned for
v1, please point us at its shape — it would change what Self-Registration means on the app.

## Q3 — Documents / photo-upload module: planned shape + timing?

Five app capture surfaces currently store placeholder `pending-<timestamp>` IDs because there is no
upload endpoint yet: inspection-item photos, defect photos, certificate documents, site-diary
photos, and delivery dockets. We deliberately did **not** build a partial offline image queue
inside any one feature (it needs to upgrade all five at once).

**Question:** What's the planned contract + rough timing for the documents/upload module (endpoint
shape, how `document_id`/`photo_id` get minted, whether uploads ride REST or a separate blob path)?
We want to build the real offline image queue against a known contract rather than keep shipping
placeholders. No rush implied — just need the shape when it firms up.

## Q4 — Operational: a throwaway target for live app E2E, + `:4100` cleanup

To verify the inbox live I had to run against **`:4100`** (the only server process up), which left a
few clearly-labelled `E2E Inbox <timestamp>` orgs/users/projects/awards in the owner's dev DB — the
very thing your test suite avoids by using throwaway `:4199` ("owner's :4100 untouched",
`xprojman-16` §6).

**Question:** Is there a standing throwaway instance (`:4199` or similar) I can point live app E2E
runs at so `:4100` stays clean? And can you purge the `E2E Inbox …` rows on `:4100` (I can delete the
`/organisation/users` Builders via `DELETE /organisation/users/:id`, but not the founder orgs/PMs)?

## Summary of asks

| # | Ask | Needs |
|---|---|---|
| Q1 | `projects.write` for `builder`? | Owner call + Server |
| Q2 | v1 model for self-registered Builder ↔ PM project (cross-org = PM2-02?) | Server + Owner |
| Q3 | Documents/upload module shape + timing | Server |
| Q4 | Throwaway E2E target + `:4100` cleanup | Server |

© eBizco Australia Pty Ltd
