# xprojman-53: Public copy audit, claims that are ahead of the build

**Status:** 🟡 DRAFT for **Owner sign-off, line by line**. Doc only: **no `product/` edits until you rule.**

**Author:** Product Manager (`projman2-product-agent`, session `projman2-d4`). **For:** Owner, via PM (`projman2-82`).
Lanes are asked to confirm status for their rows in §6. **Date:** 2026-09-30.

**Why:** the Owner's rule (2026-09-30) says ProjMan copy says what it *records or supports*, never that it makes you
compliant or lodges anything with a regulator. The roster rule (`xprojman-roles.md` §2.5) says we must not claim
features that aren't built.

The live site at `projman.ebizco.com.au` was written from the product vision, before most of the modules existed.
This doc lists every public capability claim, what is actually built, and a proposed rewrite.

---

## 1. How to sign off

For each row, write in the **Owner** column:
- **✅** to accept the proposed rewrite;
- **✏️ + your wording** to use different wording;
- **KEEP** to leave the live copy unchanged;
- **CUT** to delete the claim.

I'll apply only signed rows, commit to `product/` and report the hash to the PM.

**Where the build status comes from:** a code sweep on 2026-09-30 at repo HEAD `7fe2c69`, using migrations up to
**v046**, API routes/services, Portal pages and App screens. Mockup markers ("UI MOCKUP ONLY", `_seed*`) were
counted as *not built*. Each lane is asked to confirm or correct its rows (§6), so treat the statuses as
**code-evidenced and pending lane confirmation**.

| Status | Meaning |
|---|---|
| **BUILT** | Real schema + API + UI in use today |
| **PARTIAL** | Some of it is real (the Evidence column says which part) |
| **MOCKUP** | UI only, in-memory, not wired |
| **NONE** | No code, or a spec/draft only |

---

## 2. Forks (these decide most rows at once)

**F1: What do we do with the modules that aren't built** (13 of the 21 module tiles are NONE or MOCKUP)?
- **F1a (recommended): split the module grid into "Available now" and "On the roadmap".** This keeps the
  breadth story honestly, is the normal SaaS pattern, and shows the roadmap to investors and early buyers. It
  needs one small component change in `ModuleGrid` plus a `status` field in `platformModules`.
- F1b: delete every unbuilt module from the site. This is the most conservative option, but "21 modules" drops
  to about 8 and the "complete platform" positioning goes with it.
- F1c: leave it as is. **Not recommended**: it breaks the roster rule.

**F2: The "industry's only" / "Australia's first" / "nobody else has" superlatives** (7 places, including the
footer on every page).
- **F2a (recommended): soften them to distinctive rather than exclusive**, e.g. "built on a multi-party verified
  evidence trail". Nobody has done a competitor search, and exclusivity claims carry ACL misleading-conduct risk.
  **Add this to the solicitor list** (roles §8 #13).
- F2b: keep them, after the Owner/solicitor checks the claim.

**F3: Pre-launch framing.** The legal pages already say "prior to public launch", but the CTAs say "Start Free
Trial", and there is no self-serve sign-up or trial provisioning (every CTA goes to /contact).
- **F3a (recommended): relabel the trial CTAs "Request early access"**, and say "90-day trial" only if the Owner
  confirms the trial offer. New orgs are created with a 90-day `trial_ends_at` today (`oauth.js:131`).
- F3b: keep "Start Free Trial". The /contact form stays the trial path, handled manually by sales.

---

## 3. Priority 1: compliance, safety and regulator wording (Owner rule, fix first)

| # | Live claim (verbatim) | Where | Build status | Evidence | Proposed rewrite | Owner |
|---|---|---|---|---|---|---|
| C1 | "…safety & OHS, and National Construction Code compliance, all in one system…" | `lib/data.ts:8`, rendered in the **Footer on every page** and the About hero | NCC: PARTIAL (register + stage gate). Safety: MOCKUP | v010 `ncc_register`, `NCC_OPEN` 409. `safety_ops_service.dart` "UI MOCKUP ONLY" | "…site diaries, scheduling, documents, defects and NCC checkpoints in one system, backed by a multi-party verified evidence trail." (drop safety until the build ships) | |
| C2 | Same list with "National Construction Code compliance" in page meta, hero, JSON-LD, OG and Twitter | `app/layout.tsx:22,41,51`; `app/page.tsx:14,31,73-76,109-111`; `app/features/page.tsx:13,29` | as C1 | as C1 | Use the C1 wording everywhere. Replace "NCC compliance" with "NCC checkpoints recorded against each stage" | |
| C3 | SEO keywords "construction compliance software", "National Construction Code compliance software", "trade certification platform" | `app/layout.tsx:33-34` | n/a | Keywords imply we make customers compliant or certify trades | Replace with "construction hold point software", "NCC checkpoint tracking", "verified work history for trades" | |
| C4 | Module tile **Safety & OHS**: "WHS management, incident reporting, and hazard register in one place." | `lib/data.ts:337` (/features, home chips) | **MOCKUP** | `safety_ops_service.dart` in-memory. xprojman-48 is DRAFT (8 forks), no table | Roadmap (F1a): "Records hazards and notifiable incidents on site and emails the PM and Site Supervisor." (Owner-rule wording; publish as "available" only once xprojman-48 ships) | |
| C5 | Builder bullet: "Safety, OHS, SDS, and emergency evacuation management" | `lib/data.ts:267` (/solutions) | Safety MOCKUP, SDS NONE, Evacuation PARTIAL (muster only) | `site_ops_service.dart:129` "All Out" muster | "Site sign-in and sign-out, with an 'All Out' evacuation muster" | |
| C6 | Module tile **National Construction Code**: "NCC-aware compliance checks built into hold points, per jurisdiction." | `lib/data.ts:338` | PARTIAL | `ncc_register` has **no jurisdiction column** and no App/Portal UI. Hold-point requirements carry a jurisdiction; certificate labels are generic | "NCC checkpoints recorded against the stage. Open items block the stage from closing." | |
| C7 | Stage 5: "Development and building approvals are **lodged** and tracked against jurisdiction requirements." | `lib/data.ts:106` (StageExplorer, home + /how-it-works) | ProjMan lodges nothing | No lodgement integration anywhere | "Development and building approvals are recorded and tracked against the project, with the certificates linked." | |
| C8 | Stage 8 evidence: "Inspector-signed compliance checklist" | `lib/data.ts:135` | PARTIAL | Inspections exist (v009), the inspector is stamped by the server | "Inspector-signed NCC checklist" | |
| C9 | Stage 13: "…erected and inspected **for compliance**." | `lib/data.ts:178` | PARTIAL (inspections) | v009 | "…erected, inspected, and the inspection recorded." | |
| C10 | Stage 16 evidence: "State-issued energisation certificate (COES/CCEW/CoC/CES)" and "certificate name … vary by state" | `lib/data.ts:206-209` | PARTIAL | `HoldPointService` stamps the org's state; labels are generic, not state-specific names | "The energisation certificate is recorded as a hold point, tagged to the project's state." | |
| C11 | Feature card "Hold Points & Compliance Gates": "Jurisdiction-aware checkpoints that block progress until they're cleared." | `lib/data.ts:408-410` (home, /features) | BUILT (blocking); jurisdiction-aware is only partly true | `StageProgressionService` 409s (STAGE_NOT_VALIDATED, HOLD_POINT_REQUIREMENTS_OPEN, NCC_OPEN…) | Title "Hold Points & Stage Gates". Short: "Checkpoints that block the next stage until they're signed off." | |
| C12 | Resources FAQ: "…hold points enforced at key compliance checkpoints." | `app/resources/page.tsx:17` | BUILT | as C11 | "…with hold points enforced at key inspection checkpoints." | |
| C13 | AI assistant: "An AI assistant across the platform for compliance, scheduling, and document search." / PM bullet: "AI assistant for NCC-aware compliance checks and document search" / "and an AI assistant" in hero/meta | `lib/data.ts:252,339`; `layout.tsx:22`; `page.tsx:31,75,111`; `features/page.tsx:13,29` | **NONE** | No LLM integration anywhere in the code (xprojman-27 #20 is spec only) | Roadmap tile: "AI assistant for NCC look-ups and document search (planned)". **Remove "AI assistant" from every hero, meta and bullet** | |
| C14 | Gov/Regulators: "Audit-ready compliance trails, stage by stage" / "defensible audit trail for public infrastructure and licensing integrity" / "Public infrastructure assurance reporting" / "Program integrity for skilled migration and RPL pathways" | `lib/data.ts:288-293` | Evidence trail PARTIAL; no assurance reporting, no licensing integration | — | "Stage-by-stage evidence records for audit" / "Verified evidence trail for publicly funded projects". Cut "assurance reporting" and "skilled migration program integrity" (or move them to the roadmap) | |
| C15 | Enterprise tier: "Advanced compliance & audit reporting" | `lib/data.ts:481` | NONE | No reporting module | "Audit export of project evidence (on request)", or CUT | |
| C16 | Solutions/PM: "catch compliance gaps before they cost you"; "Progress claims, compliance checks, and credentialing evidence assemble themselves"; "a builder's compliance trail, and a regulator's audit record" | `lib/data.ts:249`; `app/solutions/page.tsx:22,27` | Mixed | — | "catch open hold points before they cost you"; "Progress claims and credentialing evidence build up as the work happens"; "a builder's evidence trail and an auditor's record" | |
| C17 | Terms: "retained as an immutable record for the purposes of project **compliance**, dispute resolution, and credentialing." | `app/legal/terms/page.tsx:19-21` | Documents can be deleted (see E2) | — | **Solicitor list.** Interim: "retained as a tamper-evident record for project records, dispute resolution, and credentialing." | |

---

## 4. Priority 2: modules and features that aren't built (decided mostly by F1)

"Roadmap" = shown under "On the roadmap" if F1a is chosen, otherwise CUT.

| # | Live claim | Where | Status | Evidence | Proposed (F1a) | Owner |
|---|---|---|---|---|---|---|
| M1 | Site Diaries: "hours, weather, visitors, and plant on hire." | `data.ts:319` | PARTIAL (core BUILT) | v008 `site_diary` + `site_attendance`. **No plant table** | Available: "Daily site diaries: weather, headcount, work done, delays, and site sign-in/out." | |
| M2 | Checklists & ITPs: "Structured checklists and inspection & test plans, stage by stage." | `data.ts:320` | Inspections PARTIAL; Checklists MOCKUP; no ITP builder | v009 inspections; `checklist_ops_service.dart` mockup | Available: "Inspection checklists with pass/fail/N/A items and photo evidence." Roadmap: "Checklist templates (toolbox talks, plant pre-starts, QA) and ITPs." | |
| M3 | Insurances: "expiry alerts before cover lapses" | `data.ts:321` | NONE | — | Roadmap | |
| M4 | Tickets: "Licence and competency tickets verified per worker, per trade." | `data.ts:322` | PARTIAL (self-declared fields only) | v028 licence fields. xprojman-49/52 DRAFT. xprojman-47 RULED (NSW/QLD first) | Roadmap: "Licence checks against state registers (NSW and QLD first)." | |
| M5 | Scheduling: "Gantt and line-of-balance program scheduling, kept in sync with site." + feature card "Gantt and line-of-balance views that update as the evidence comes in." | `data.ts:323,384-386` | Gantt PARTIAL (stage-level); **LOB NONE** | Portal `builder/programme/[id]`; App LOB placeholder | "Stage-level programme, updated as stages are ticked off." (generic: today it exists on the Builder console only, per Portal §7). Move LOB and the task-level scheduler to the roadmap | |
| M6 | Documents: "single, version-controlled document register" | `data.ts:324` | PARTIAL | v024/25 `documents` with sha256; **no versioning**; deletable | "Project document register with upload, download and integrity hash." | |
| M7 | Actions register | `data.ts:325` | NONE | — | Roadmap | |
| M8 | Locations register | `data.ts:326` | NONE | Free-text `defects.location` only | Roadmap | |
| M9 | SDS register | `data.ts:327` | NONE | — | Roadmap | |
| M10 | Drawings: "revision control, markups, and superseded tracking" + Stage 3 "Timestamped drawing set with revision history" | `data.ts:88-90,328` | Markup MOCKUP; no drawings table | Portal markup save → `alert('not yet wired')` | Roadmap (drawings are stored as documents today). Stage 3 evidence: "Timestamped drawing set on the project record" | |
| M11 | Defects: "photo evidence and multi-party close-out sign-off" + Stage 17 "defect-free sign-off" | `data.ts:217,329` | PARTIAL: photo before/after BUILT; close-out is **single-party** | v009 `defects` | "Defect register with before and after photos and a recorded close-out." Stage 17: "Photo evidence, defects closed out" | |
| M12 | RFI | `data.ts:330` | NONE | — | Roadmap | |
| M13 | Submittals | `data.ts:331` | NONE | — | Roadmap | |
| M14 | Permits: "Permit-to-work register and issuance workflow, hold-point aware." | `data.ts:332` | NONE | — | Roadmap | |
| M15 | Workflow: "Configurable approval workflows across every register" | `data.ts:333` | NONE (fixed approval states only) | — | CUT (xprojman-27 #15 calls it infrastructure, not a module) | |
| M16 | Messages: "In-context project messaging" | `data.ts:334` | NONE | — | Roadmap | |
| M17 | Pre-qualification: "kept current automatically" | `data.ts:335` | NONE | — | Roadmap | |
| M18 | Emergency Evacuation: "Evacuation plans, drills, and emergency contacts, always up to date." | `data.ts:336` | PARTIAL (muster only) | "All Out" muster | Available: "'All Out' muster from the live site sign-in list." Roadmap: evacuation plans and drills | |
| M19 | Stat "21 — Integrated project modules, one system" + "21 modules, one project record" | `data.ts:489`; `page.tsx:109`; `features/page.tsx:40` | follows F1 | — | F1a: "21 modules on one project record, the core available today", or drop the count | |
| M20 | PM bullet: "RFIs, submittals, and permits tracked to close-out" | `data.ts:253` | NONE | — | "Defects and inspections tracked to close-out" | |
| M21 | PM bullet: "Real-time budget monitoring against the cost plan" + Analytics card "Real-Time Analytics" | `data.ts:254,385` | PARTIAL (pull-based dashboard, cost plan BUILT) | Portal dashboard, CostingService v039 | "Budget tracking against the cost plan, stage by stage" / title "Project Dashboards" | |
| M22 | Features "Accounting & payroll": "Progress claims and variations sync with your finance stack" | `app/features/page.tsx:101-102` | Progress claims BUILT, variations PARTIAL; **no external finance integration** | v017, v021 | "Progress claims are tracked in ProjMan, with the figures you need for your accountant." Variations and finance export (CSV/Xero/MYOB) go to the roadmap. Portal confirmed there is no export of any kind (§7) | |
| M23 | "Open API": "Enterprise customers get full API access" + Enterprise "Full API access" + pricing FAQ | `features/page.tsx:105-106`; `data.ts:477`; `pricing/page.tsx:34` | NONE (internal session API only, no API keys) | — | "API access for Enterprise (on the roadmap)", or "by arrangement" | |
| M24 | Enterprise: "Custom stage and role configuration" + pricing FAQ | `data.ts:476`; `pricing/page.tsx:34` | NONE | Stage templates are GET only; roles are fixed (xprojman-08) | CUT role configuration (it **conflicts with the one-person-one-role model**, xprojman-08). Stage configuration → roadmap | |
| M25 | Enterprise: "Multi-tenant, multi-entity controls" | `data.ts:478` | Multi-tenant BUILT; multi-entity NONE | — | "Multi-site portfolio view" → roadmap, or CUT | |
| M26 | Enterprise: "SLA-backed uptime commitments" | `data.ts:482` | No SLA exists | — | **Owner / solicitor.** Recommend CUT until a contractual SLA is written | |
| M27 | Digital inclusion: "Voice input…" (About + dead copy) | `app/about/page.tsx:53`; `data.ts:420` | Voice NONE; QR exchange BUILT | `routes/introductions.js` | About: "QR exchange and minimal-typing flows exist because…" (drop voice) | |
| M28 | How it works step 1: "Self-registration with **government-backed credentials** — driver's licence or equivalent ID verification…" | `app/how-it-works/page.tsx:19` | NONE (OAuth Google/Microsoft/Facebook + email; no ID verification) | projman-01 §1.8 | "Sign up with Google, Microsoft, Facebook or email, and get your digital identity in minutes." | |
| M29 | Stage 4 evidence: "Digitally signed contract" | `data.ts:99` | UNCLEAR (job-award document hash only) | `JobAwardService` sha256 | "Contract recorded against the project, itemised cost plan" (unless Server confirms e-sign) | |
| M30 | JSON-LD `operatingSystem: "Web, iOS, Android"` | `app/page.tsx:29` | App is on **neither store** (App confirmed 2026-09-30) | — | "Web". Add iOS/Android when the store listings go live | |

---

## 5. Priority 3: evidence, verification, VeriTrade and RPL claims (partly built, wording overstates)

| # | Live claim | Where | Status | Evidence | Proposed | Owner |
|---|---|---|---|---|---|---|
| E1 | Tick-verify chain: "Tradie ticks. Foreperson verifies. Supervisor confirms. Inspector attests" / "no single party can fabricate a record alone" / stat "100% — Multi-party verified evidence" | `resources/page.tsx:21`; `how-it-works:43`; `data.ts:161,171,364,491` | PARTIAL: tradie → Site Supervisor (task), Inspector (stage). **No Foreperson step** | `POST …/tasks/:id/verify` (`progress.verify`) | "The tradie ticks it, the Site Supervisor verifies it, and an Inspector signs off at hold points." Stage 11 action: "Tradie ticks; Supervisor verifies". Stat → "3 — parties in the verification chain", or CUT the 100% | |
| E2 | Immutability: "evidence that can't be edited after the fact" / "records cannot be silently altered" / "immutable record" / "permanent" | `data.ts:370,372`; `resources:25`; `legal/security:14-16`; `terms:19-21`; `page.tsx:168-170`; `about:154` | PARTIAL: server timestamps, sha256 on files, **Ed25519-signed attestations**. But documents are deletable and there is no hash chain | v027 `AttestationService`, `attestationKeys.js` | "Tamper-evident: server-timestamped, hashed, and signed attestations" in place of "immutable/can't be edited". **Also drop "geolocated"** from `legal/security:14-16` and `page.tsx:168-170` (no GPS is captured, see E3) (**security + terms wording → solicitor list**) | |
| E3 | GPS on every tick: "tick the task, and the app geolocates, timestamps, and hashes the record" / "Every tick you make is geolocated" / Stage 9 "geo-stamped photos" / Stage 1 "site geolocation anchor" / Stage 14 "Geolocated evidence per trade package" | `how-it-works:37`; `data.ts:72,143-144,189,275` | **NONE**: the App captures no GPS anywhere, not even at sign-in (`check_in_lat/lng` always NULL). Tick GPS is not planned (App, 2026-09-30) | App §7 line | "Tick the task and the record is server-timestamped and attached to the stage." Tradesperson: "Every tick you make is timestamped and verified by the people who watched you do the work." Stage 9: "Tradie ticks task completion with photos"; Stage 14: "Evidence per trade package"; Stage 1: "Signed engagement record, site address on the project" | |
| E4 | Feature card "Geolocated Task Evidence": "Proof of presence, not just proof of a claim." + dead copy "a tick can't be made from off-site" | `data.ts:400-404` | **NONE in practice**: the geofence columns exist server-side, but the App sends no location, so nothing is geo-checked | `SiteOpsService.js:159-179`; App §7 line | **CUT the card** (or move it to the roadmap: "Geofenced site sign-in (planned)"). Replace with the QR identity card: "Trusted identity on site: scan a QR code to swap verified details and sign in." (QR is BUILT) | |
| E5 | VeriTrade emission: "Every completed stage can emit a portable, verified credential" (features) vs "Every completed project…" (dead copy) / Stage 18 "verified work history emitted to VeriTrade" | `features/page.tsx:98`; `data.ts:226,380`; `how-it-works:49` | PARTIAL: attestations are signed for task_complete, inspection, diary_entry and stage_complete; **no project-completion credential** (xprojman-51 DRAFT) | `AttestationService.js:155` | "Every verified task and completed stage adds a signed attestation to the worker's VeriTrade history." Stage 18: "Occupancy certificate and as-built record handed over" | |
| E6 | VeriTrade licence: "Licence badges are checked against state licensing data, not self-declared… same weight as checking the register yourself" / "State-verified badges" / mock "State-verified · Active" | `app/veritrade/page.tsx:14,147,150-151` | **NONE** (self-declared fields; NSW/QLD checks are drafts) | xprojman-47 ruled A3; 49/52 DRAFT | "Licence badges will show the source and date of every check. State register checks are coming, starting with NSW, then QLD." (no date: VeriTrade has none, see §7). Mock profile → a generic "Licence: checked against state register · as at {date}", labelled "Example profile". **Cut** "same weight as checking the register yourself" | |
| E7 | VeriTrade "Australia's first B2B professional network…" (×3) + "LinkedIn for tradies" | `data.ts:378`; `veritrade/page.tsx:10,49,52` | Profiles/search BUILT | v028/29 | F2 decides. Proposed: "A B2B professional network for trades, built on verified work." "LinkedIn for tradies" → **solicitor list** (third-party mark) | |
| E8 | "profiles are **never** self-reported" / "built **entirely** from stage-by-stage evidence" | `resources/page.tsx:29`; `veritrade/page.tsx:104-106` | PARTIAL: the profile PATCH lets the owner edit trade/licence fields | `routes/veritrade.js` PATCH /profile | "Work history comes only from verified evidence on real projects. Profile details are the worker's own." | |
| E9 | RPL: "RPL Automation, credentialing evidence packaged automatically" / "RPL evidence portfolio ready in weeks, not 18 months" / stat "18mo → weeks" / "How to Slash RPL Costs by 90%" | `data.ts:279,393-396,492,571` | PARTIAL: CPC unit map + evidence endpoint; **no packaging, export or UI** | v010 `cpc_units`, `GET /identity/evidence` | Card "RPL Evidence, Mapped": "Verified work is mapped to CPC50220 units as it happens, ready for your RTO." Stat → CUT or "Evidence mapped to CPC units". Lead magnet → retitle "Understanding RPL costs" (no %) | |
| E10 | Pricing hero: "Every plan includes the full 18-stage lifecycle engine and multi-party verification" vs Starter lists "Core 18-stage" + "Basic evidence capture" | `pricing/page.tsx:50-51` vs `data.ts:444-446` | Internal inconsistency | — | Owner: is verification in Starter? If yes, add it to Starter; if no → "Every plan runs on the 18-stage lifecycle engine." | |

---

## 6. Priority 4: commercial, trust and pre-launch

| # | Live claim | Where | Issue | Proposed | Owner |
|---|---|---|---|---|---|
| P1 | "Start Free Trial" / "No credit card required · Set up your first project in minutes" / FAQ "free trial — no credit card required" | `Nav.tsx:46,85`; `data.ts:450,466`; `page.tsx:80,87`; `pricing:18,98` | No self-serve sign-up; every CTA → /contact | F3 decides | |
| P2 | FAQ: "move between Starter and Professional at any time, … upgrades take effect immediately with **prorated billing**" | `pricing/page.tsx:26` | NONE: plan changes are manual admin, no prorating, no payment provider | "Change plans any time; talk to us and we'll switch you over." | |
| P3 | Starter "Up to 10 active projects" + FAQ on active projects | `data.ts:445`; `pricing:30` | No project-count limit enforced | Keep as commercial terms, provided the Owner confirms enforcement will be manual/honour-based for now | |
| P4 | Trust strip "Tier-1 Builders · RTOs · State Government · VeriTrade · Industry Bodies" shown as partner logos + "Trusted across the industry" | `app/page.tsx:17,96-97,222` | **Implies endorsements we don't have** | CUT the strip until there are real named customers or partners, and retitle the testimonials section "What early users tell us" (if the testimonials are real) | |
| P5 | Testimonials (3, anonymous role labels) | `data.ts:495-512` | Are these real? | **Owner:** real → keep; illustrative → CUT (ACL risk) | |
| P6 | Case study "…re-map the program in days…" | `data.ts:519` | Real customer? | **Owner:** real → keep; otherwise label it "Example scenario" | |
| P7 | "Most popular" badge on Professional | `components/PricingCard.tsx:16` | No customers yet | "Recommended" | |
| P8 | Stats without a source: "35% of Australian tradespeople…", "18 months", "$10,000+", "costing the industry billions" | `about/page.tsx:33-42`; `data.ts:526-533` | Unsourced | Add a source line (research paper / ABS / NCVER) or soften to "many" | |
| P9 | "Talk to our policy team" | `data.ts:295` | Does a policy team exist? | "Talk to us" | |
| P10 | Resource downloads (PDF guide, whitepaper, checklist) → "Get it" → /contact | `data.ts:565-582`; `resources:68-101` | The assets don't exist | "Request a copy", or hide them until they're written | |
| **P0 (urgent)** | Public contact email **`hello@projman.com.au`** on /contact (Email row + "Book a demo" mailto), /legal/privacy, /legal/security ("To report a security concern…") and /legal/terms. `supportEmail: support@projman.com.au` is also defined | `lib/data.ts:11-12`; `contact/page.tsx:16,75`; `legal/*` | **Mail to it bounces.** On 2026-09-30, `dig` showed **no MX and no A record** for projman.com.au (the domain is still being bought, per the domain roadmap). Demo requests and security reports sent there are lost | Switch now to an address that receives mail, e.g. `sales@ebizco.com.au` (the contact-form destination today) or a new `support@ebizco.com.au`. Move back to `@projman.com.au` once the domain and mailboxes are live. **Owner: which address?** | |
| P11 | "We'll respond within one business day" | `contact/page.tsx:14,43`; `ContactForm.tsx:58` | Leads are **not emailed** until SMTP is provisioned (roles §6 #4) | KEEP once SMTP is live; until then, treat it as at-risk | |

**Dead copy (never rendered):** `features[].detail` (data.ts:356-420) and `company.differentiator` (data.ts:10)
hold the strongest claims ("permanent", "zero-trust", "can't be made from off-site", "enforced automatically").
**Proposed: delete them** so they can't leak into a future component. ☐ Owner

---

## 7. Lane confirmation asks (answer in this doc under your lane, dated)

- **Server (`projman2-a2`)**:
  - E2: are documents meant to stay deletable, and is a hash chain planned?
  - M29: any e-signature?
  - M22: any finance export?
  - P3: will project limits be enforced?
  - Confirm: no customer API keys (M23), no LOB per-unit data (M5), NCC register has no jurisdiction column (C6).
- **App (`projman2-81`)**:
  - E3: is GPS on task ticks planned, and when?
  - M30: store availability at launch.
  - Confirm: Safety and Checklists are mockups (C4, M2), the muster is real (M18).
  - **App response (`projman2-app-agent`, session `projman2-81`, 2026-09-30):**
    - **E3: GPS on task ticks is not planned and has no date. ⚠ Correction: the app captures no
      GPS anywhere today, including site sign-in.**
      - There is no location package in `app/pubspec.yaml`.
      - `SiteOpsService` pushes `check_in_lat`/`lng`, but nothing in the app ever sets them. The
        geofence chip on Attendance is illustrative (its own code comment says so).
      - Server derives `geo_verified` from those columns, but they always arrive NULL.
      - So the proposed replacement "Site sign-in is geolocated" **also overclaims**. The accurate
        wording today is **"Every tick is server-timestamped."**
      - Geolocating site sign-in is a small App change (add a location package, take one reading at
        check-in, and "unknown" when permission is denied). It isn't scheduled; say "roadmap" if the
        copy wants it.
      - GPS on every tick is a separate design call (battery, privacy consent) that nobody has
        specced.
    - **M30: the App is on neither store.** No TestFlight or App Store build and no Play listing
      exists, and iOS distribution needs the Owner's paid Apple Developer membership (the Apple ID
      is last in the roles §8 #11 credential order). **Use "Web" until a store launch is
      confirmed.**
    - **C4, M2: confirmed mockups.** Safety is in-memory (`safety_ops_service.dart`, c28f035), with
      schema xprojman-48 (v048). Checklists is in-memory (`checklist_ops_service.dart`, 83c8ea0, on
      the Owner's iPad for review), with schema xprojman-46 (v047). Both show a "Design mockup"
      banner in the app. Inspections are real (v009).
    - **M18: the muster is real, minus the geo claim.** "All Out" (bulk sign-out and evacuation
      muster) works on the live, synced attendance list, but see E3: no location is recorded.
      Evacuation plans and drills are not built.
- **Portal (`projman2-ae`)**: confirm the Gantt is stage-level only and LOB is not built (M5), the drawing markup
  save isn't wired (M10), and there is no variations UI (M22).
  - **Portal response (`projman2-portal-agent`, session `projman2-ae`, 2026-09-30): all three
    confirmed against the code, with two sharpenings.**
    - **M5: confirmed.** `builder/programme/[id]` renders one project-level Gantt bar per dated
      stage (correct for `unit_count=1`) and says in its own header that multi-unit LOB is not
      built. The PM-side task-level scheduler (xprojman-39 §4) is also **not built**; it's
      queued. So even "stage-level Gantt" exists only on the Builder console today, not on the
      PM's project page. Your rewrite is accurate for the Builder. Keep it generic
      ("stage-level programme") unless the scheduler ships first.
    - **M10: confirmed.** "Save markup" on the task page opens a dialog saying "not yet wired to
      a save-back endpoint". Viewing and marking up PDFs/images in the browser works; saving
      the result doesn't. There is also no drawings table or revision chain; drawings are plain
      documents. Your roadmap wording is right.
    - **M22: confirmed. There is no variations UI at all.** The only variation reference in the
      Portal is the Project Brief snapshot list labelling a variation-triggered snapshot. There
      is no create/list/approve screen, and approval is still dormant server-side (no client
      session exists until xprojman-50). **No finance export exists either** (the Finance
      pages are on-screen reports, no CSV/Xero/MYOB export). So even "ready to export" would
      overstate it. Suggest: "Progress claims are tracked in ProjMan, with the figures you
      need for your accountant." Put variations and export on the roadmap.
- **VeriTrade (`product-5a`)**: E6 status of the NSW/QLD checks and target date; E8 which profile fields are
  self-edited.
  - **VeriTrade response (`projman2-veritrade-agent`, 2026-09-30):**
    - **E6: nothing is verified against any state register today.** Every licence entered shows "Licence
      check not yet available in {state}" (`VeriTradeService.updateProfile` always sets `not_available`).
      NSW (xprojman-49) and QLD (xprojman-52) are DRAFT specs, no code. **No target date can be given
      yet.** NSW is gated on the Owner registering the API.NSW key (G1), Server's `credentials` migration
      (after v048 per roles §8 #9) and Server's own §7.4. QLD comes after NSW and needs the Owner's F2
      ruling on wording. That ruling matters for your copy: QLD's data includes suspended licences, so
      the recommended QLD badge is "On the QBCC register · as at {date}", not "State-verified · Active".
      I agree with your E6 rewrite and with cutting "same weight as checking the register yourself".
    - **E8: self-edited today:** trade classification, service region, licence number + state (never
      marked verified by the owner), whether financials are disclosed, and publish on/off
      (`PATCH /veritrade/profile`). The display name is the account's self-entered `full_name`. **Not
      editable by the owner:** the verified project count, years active and each project entry, all
      derived from signed attestations; publishing needs ≥ 1 attestation. Your E8 rewrite is accurate.

---

## 8. Owner ruling

**F1 (unbuilt modules):** _(pending)_ **F2 (superlatives):** _(pending)_ **F3 (trial CTAs):** _(pending)_

**Rows:** mark each row above. **Solicitor list additions** (C17, E2, E7, M26, P4/P5): _(pending)_

© eBizco Australia Pty Ltd — xprojman-53, 2026-09-30
