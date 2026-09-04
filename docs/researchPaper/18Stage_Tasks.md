# ProjMan — 18-Stage Core Task Library (Australian Residential Construction)

**Status:** 🟢 Reviewed — PM's Reality Check + System Need pass incorporated.
**Author:** Portal Agent (`projman2-portal-agent`), initial draft, wearing the
"AI Project Manager, Australian residential building & construction" hat per
owner request · **Reviewed by:** PM (Building & Construction, Australia),
2026-09-03 — added the "PM's Reality Check" and "ProjMan2 System Need" columns
and the cross-stage risk summary, merged in here as the single canonical copy.
**Date:** 2026-09-03
**Purpose:** a **core task checklist per stage** — the practical, on-the-ground
work items a PM/Builder actually tracks, as distinct from
`ProjMan_18Stage_Specification_v3.4.pdf`'s Part 2, which decomposes the
**software's** sub-steps (who clicks what, S1.1–S18.16). This document is the
content that seeds `stage_template_items`/`tasks` rows for the Portal's Stage →
Task drill-down screen (`xprojman-28` module 19, `docs/mocked/portal/
project_list.html` Screen 4).

**Code format note:** the `S#.N` codes below are **this document's own**
task sequence per stage — they do not claim a 1:1 match to the software
Spec's Part 2 sub-step codes (some System-only sub-steps, e.g. tender
document packaging, have no PM-facing task here; some PM tasks here, e.g.
"set `builder_engagement_type`," aren't numbered as their own sub-step in
Part 2). Cross-check against the PDF directly rather than assuming code
parity where it matters.

## How this is meant to be used — core + extra, not a locked list

Every stage below ships a **core task list** — the tasks that apply to
essentially every job of that type, seeded as `stage_template_items`/default
`tasks` rows when a project reaches that stage. This is deliberately **not**
exhaustive or locked: a real job always has project-specific work (a
difficult easement, a heritage overlay condition, a client-requested extra).
The `tasks` table has no ceiling on this — `parent_id`/`predecessor_id` already
support arbitrary additional rows under a stage, so **PM (desk) and Builder
(Stages 9–18, his own schedule per §1.3 of the portal spec) can add extra
tasks to any stage** the same way they'd add any other task; nothing here
needs new schema to support that. Treat the tables below as the *default seed*
a new project starts with, not the full universe of tasks a job can ever have.

---

## Stage 1 — Project Creation & Land Ingestion

**PM's Reality Check:** This is the "don't build on a swamp" stage. Most of
these tasks aren't about what you want to build — they're about what the land
allows you to build. The PM's job here is to gather enough information to
make a go/no-go decision before spending serious money on design.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S1.1 | Initial client meeting / brief capture | PM | The client's budget is always aspirational. Capture "must haves" vs "nice to haves" — this becomes the filter for Stage 5 options. In WA, clients often don't know the difference between "I want" and "the land allows." | `project_briefs.requirements` with mandatory vs optional distinction. Meeting summary should be captured as a structured note. |
| S1.2 | Verify land title & ownership | PM | A surprising number of projects stall here. The person who wants to build isn't always the registered owner. In WA, title searches cost ~$30 and take 1-2 days, but a missed step here can be project-ending. | Document upload with OCR extraction of owner name from title certificate. System should flag if the client's name doesn't match the registered owner. |
| S1.3 | Order/obtain contour & feature survey | PM | External contractor (surveyor company). Contour surveys in WA can take 2-3 weeks and cost $1,500-$3,000 depending on site size and complexity. This is often the first real timeline gate. PM needs to track who was engaged and when. | Surveyor engagement should be tracked via the `consultants` table with `discipline='surveyor'`. Expected completion date, actual completion date, and document upload (survey plan) should all be tracked. The system should auto-set a follow-up reminder. |
| S1.4 | Confirm lot/plan number and zoning | PM | Fixed cost from City Council. Zoning certificates typically cost ~$50-150 and confirm what the land can be used for. PM needs to know if the client's dream house fits the zoning. R-codes (e.g., R20, R40) dictate density. | The system should store the zoning code and R-code. A validation check: does the proposed building footprint exceed the site coverage allowance? If yes, flag immediately. |
| S1.5 | Check easements, covenants, restrictive design guidelines | PM | Town Planner can provide preliminary advice, or can be sourced from council zoning/planning website. Estate covenants in WA greenfield subdivisions are the silent project killer. They often require brick veneer, specific roof pitches, or colour schemes that add cost. The PM needs to know these before Stage 3. | The system should flag "check covenants" as a hard gate. Link to the `compliance_register` with a checklist of covenant conditions. If any covenant condition is flagged, the PM must confirm it's addressed before Stage 3. |
| S1.6 | Confirm site access for delivery vehicles/crane | PM | Critical for traffic engineering, rubbish truck turns, and crane access. Tight-access sites in infill developments are common. If a 10-tonne truck can't turn around, the building method changes entirely. PM needs to know: what's the turning radius? Is there a weight limit on the road? | Site access should be a geo-tagged note with photos. The system should have a "site access assessment" field with: turning radius (m), road weight limit (tonnes), crane access notes, and a "verified" flag. |
| S1.7 | Collect customer emails / meeting summary | PM | This task collects all customer emails and meeting summaries to produce a project summary. Clients often get overwhelmed by jargon. The PM needs to synthesise everything into a plain-English summary. This is the document that says "here's what we're doing, here's what we need, here's the timeline." | The system should auto-generate a "Project Summary" document from the brief (S1.1), land info (S1.2-S1.6), and client communications. This becomes the client-facing document that sets expectations. The summary should be versioned and sent as a PDF. |

## Stage 2 — Environment, Utility & Hazard Audit

**PM's Reality Check:** This stage is about "what's hiding underground and in
the council files." The DBYD (Dial Before You Dig) is the most important
single document here. In WA, a DBYD response takes 2-10 days. If services
aren't marked, the PM needs to chase.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S2.1 | Lodge Dial-Before-You-Dig (DBYD) referral | PM | DBYD responses show where services should be, not where they are. A DBYD mismatch is a common source of variation claims. In WA, DBYD is mandatory before any excavation. | DBYD referral number and lodged date should be stored. The system should auto-set a follow-up reminder (5 days). The DBYD response should be uploaded as a document. |
| S2.2 | Record sewer/stormwater connection depth and point of connection | PM | If the council's sewer point is 1.5m deep vs 2.5m, it changes the Stage 11 excavation cost significantly. In WA, sewer depths often vary by suburb. | This field should be linked to `project_stages.budget_amount` for Stage 11. A deeper sewer = higher cost. The system should pre-populate typical depths for the suburb (if available). |
| S2.3 | Check overhead power clearance | PM | In WA, live HV lines are often on the boundary of suburban sites. Clearance is a hard WHS rule, not a suggestion. The crane or scaffold can't go within 6.4m of HV lines. | A visual indicator ("⚠️ HV lines within 5m") should be displayed on every subsequent site diary entry. The system should auto-flag if the site is near HV lines based on address. |
| S2.4 | Confirm council zoning code and density/site-coverage allowance | PM | R-codes in WA are the foundation of what's possible. R20 = ~500m² per dwelling, R40 = ~350m², R60 = ~220m². If the client wants a 400m² house on an R20 block, the PM has a problem. | The system should have a look-up table of WA R-codes and their minimum lot sizes. Auto-calculate if the proposed footprint exceeds the site coverage allowance (typically 50-60% of the lot). |
| S2.5 | Check bushfire-prone area (BAL) status | PM | In WA, bushfire-prone areas are common in the hills and outer suburbs. BAL (Bushfire Attack Level) can add $50k-$100k to a build. If the PM misses this, the project is in trouble. | The system should auto-flag if the site address is in a BAL zone (via address lookup) and pre-populate the Stage 13 "timber grade certification" requirement. BAL rating should be stored and visible on every subsequent stage. |
| S2.6 | Check flood/acid-sulfate-soil overlay | PM | In WA, acid sulfate soils are common in coastal areas and river valleys. If the soil is acidic, it requires special footing treatment. Can trigger a geotechnical report. | The system should auto-flag if the site is in an acid-sulfate-soil zone (via address lookup). If flagged, auto-add S12.8 (core compression test) as a requirement. |
| S2.7 | Check heritage overlay / tree-protection order | PM | In WA, heritage overlays are common in older suburbs (e.g., Fremantle, Guildford). Tree protection orders are common in the hills. Both add a council referral to the DA pathway. | The system should auto-flag if the site has heritage or tree protection overlays. PM must confirm the conditions are addressed before Stage 7. |
| S2.8 | PM reviews and confirms the compiled hazard audit | PM | This is the standing AI-confirm-gate rule. The AI/NLP audit is a starting point, but the PM must sanity-check every finding. The PM is legally responsible for the project, not the AI. | The system should require a PM sign-off before the audit results are sent to the client. The PM can override an AI finding with a reason. |

## Stage 3 — Concept Design Generation

**PM's Reality Check:** This is where the client's dream meets the site's
reality. The AI concept is a starting point — the PM's job is to manage
expectations. The client's dream house must fit the land, the budget, and the
R-code.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S3.1 | Confirm client's preferred footprint/orientation | PM | Solar orientation is a hidden cost driver. A south-facing living area means higher cooling costs, which impacts NatHERS rating and ultimately the building cost. In WA, north-facing living areas are preferred. | The system should show the solar orientation (north arrow) on the concept footprint and let the PM note "client approved orientation" or "client requested override." |
| S3.2 | Generate/review footprint within setback envelope | PM/System | In WA, setbacks are often 1.5-3m from boundaries. The AI generates the footprint. The PM's job is to ensure it's not too close to the boundary, easements, or sewer manholes. | The system should auto-check setbacks against the council's requirements (R-code) and flag if the footprint encroaches on any setback. |
| S3.3 | Review floor area summary against budget | PM | The biggest source of budget blowouts is "just a little bigger" — 10m² extra at Stage 3 becomes $50k extra at Stage 12. The PM needs to catch this early. | The system should show the budget per m² and highlight if the concept exceeds the Stage 1 budget range. This is the PM's early warning system. |
| S3.4 | PM confirms concept before client sees it | PM | The concept isn't a contract document yet, but it sets expectations. A mistake here is expensive to fix later. If the PM sends a concept that doesn't fit the site, the client gets excited about something that's impossible. | `concept_designs` table should have a `pm_confirmed_at` timestamp. Nothing goes to the client without this. |
| S3.5 | Log client-requested revisions | PM | Revisions are where time disappears. The client wants "a bit more space here, a bit less there." Each revision takes time and money. | The system should track the number of revisions and flag if the client is changing scope significantly. Revisions should be versioned via `supersedes_id`. |

## Stage 4 — Town Planner / Council Screening

**PM's Reality Check:** This is the "council roulette" stage. The PM's job is
to either pay a Town Planner to manage it or submit directly. Either way, the
clock is ticking. In WA, council response times are statutory but vary
wildly — from 60 days to 120 days.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S4.1 | Decide screening pathway (Planner vs direct) | PM | A Town Planner costs money but saves time. The PM needs to know if the site is contentious (heritage overlay, BAL zone, flood zone, etc.) before deciding. | The system should show a "site risk profile" based on Stage 2 findings, helping the PM decide whether to engage a Town Planner. |
| S4.2 | Brief the Town Planner (if engaged) | PM | Town Planners need a clean data package. If the PM sends incomplete data, they get a bill for "additional work" and the project is delayed. | The system should generate a "Town Planner package" (PDF of Stage 1-3 data) with a "package complete" checkbox before the PM can send it. |
| S4.3 | Track council/planner response clock | PM | In WA, council response times are statutory but vary. The PM needs to know when to chase and when to escalate. | The system should have a council response clock, with warnings at 60 days, 75 days, and 90 days. The PM can log a follow-up date. |
| S4.4 | Record outcome and conditions raised | PM | Conditions raised at this stage feed into Stage 6 (architectural drawings) and Stage 8 (CC). If the PM doesn't note a condition, they'll miss it later. | The system should have a "conditions register" with each condition linked to a task in Stage 6 or 8. The PM must confirm each condition is addressed. |

## Stage 5 — Budget-Based Style Generation

**PM's Reality Check:** This is the "what can you afford?" conversation.
Three options: Budget, Deluxe, Premium. The PM's job is to make sure the
client's selection is realistic. In WA, the construction cost per m² varies
significantly between suburbs.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S5.1 | Review 3 cost-calibrated style options | PM | The options are AI-generated, but the PM needs to sanity-check them against the local market. A "Budget" option in a high-end suburb might still be expensive. | The system should show the local area average cost per m² (if available) next to the three options. |
| S5.2 | Present options to client; record their selection | PM | The client's selection is binding for the estimate. The PM needs a signed confirmation. | The system should capture the client's selection with a digital signature or email confirmation, per the frozen/hashed pattern. |
| S5.3 | Reconcile selected tier against the indicative budget | PM | If the client picks "Deluxe" but their budget is "Budget," the PM has an immediate problem to address. | The system should highlight the gap between the selected tier and the Stage 1 budget in red. This is the PM's "conversation starter." |

## Stage 6 — Architectural Drawing Development

**PM's Reality Check:** This is the "real work" stage — where things become
actual drawings. The PM is the coordinator between the client, the
draftsman/architect, and the council's conditions. In WA, architects charge
$5k-$20k+ for a full set of drawings.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S6.1 | Route selected tier's brief to the draftsman/architect | PM | The PM needs to give the architect the right brief. If the brief is wrong, the drawings are wrong. | The system should package the selected tier + site constraints + client selections into an "Architect Brief" document that the PM can download or email. |
| S6.2 | Client completes material selections | Client | Material selection is where projects often stall. Clients get overwhelmed. In WA, material selection can take 2-4 weeks. | The system should have a visual gallery of materials (tapware, tiles, paint, fixtures) with pricing marked "allowance" vs "actual" per line. |
| S6.3 | Track draftsman/architect turnaround | PM | External parties don't have system logins. The PM needs to track this manually. | The system should allow the PM to set an expected date for each external deliverable and send reminders. |
| S6.4 | Upload finalised structural floor plans + elevations | PM | The PM needs to ensure the drawings are complete. A missing drawing at this stage delays Stage 7. | The system should have a checklist of required drawings (floor plan, elevations, sections, etc.) and flag if any are missing. |
| S6.5 | PM reviews 3D material preview before client sees it | PM | The standing AI-confirm-gate rule. The PM must ensure the materials match the client's selections. | The system should require a PM sign-off before the preview is sent to the client. |
| S6.6 | Resolve out-of-variance material selections | PM | If a material is out of stock or the price has changed, it's routed through the Variation mechanism. | The system should auto-create a Variation record when a material is out of variance, with the new price as a Variation line. |

## Stage 7 — DA Submission & Approval

**PM's Reality Check:** This is the "big one." The DA package is the first
legally binding document the client signs. The PM's job is to make sure it's
complete and correct. In WA, a DA can take 60-120 days to be assessed.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S7.1 | Final release check on the DA package | PM | The PM is the last line of defence. If a mistake goes to council, the clock resets. | The system should have a "pre-submission checklist" with every required document, checked off by the PM before the "Release to Client" button is enabled. |
| S7.2 | Client reviews and signs off DA package | Client | Clients often don't read the fine print. The PM needs to explain what they're signing. | The system should show the client a simple summary of what they're approving (what's included, what's excluded) before they sign. |
| S7.3 | Lodge DA with council / certifier | PM/System | Lodgement is the point of no return. After this, changes cost time and money. | The system should record the lodgement date, tracking ID, and expected response date. |
| S7.4 | Track council's statutory response clock | PM | In WA, council response times are statutory but vary. The PM needs to know when to chase and when to escalate. | The system should have a council response clock, with warnings at 60 days, 75 days, and 90 days. |
| S7.5 | If declined: redraft via Variation | PM | A client declining at sign-off is painful but not uncommon. The architect's redraft time is billable. | The system should auto-create a Variation record when the client declines, with the architect's redraft cost as a Variation line. |

## Stage 8 — DA Approval → Construction Certificate (CC)

**PM's Reality Check:** This is the "paperwork marathon." The DA is
approved — now the real compliance work begins. In WA, the CC is issued by
the Principal Certifier and typically costs $2k-$5k.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S8.1 | Record DA approval from council | PM | The PM must record the approval immediately. The clock starts ticking for the CC. | The system should record the approval date and auto-start the CC timeline. |
| S8.2 | Engage Principal Certifier | PM | The Principal Certifier is the PM's independent check. They are not the Builder's friend. | The system should have a `consultants` table with `discipline='principal_certifier'`. The PM should record who they are and when they were engaged. |
| S8.3 | Obtain structural engineer certification | Structural Engineer | The structural engineer certifies the design under AS3600/AS3850. This is mandatory, not optional. | The PM uploads the certificate; the system records the date and engineer's details. |
| S8.4 | Lodge Construction Certificate application | PM | The CC application includes the engineering certificate, NCC compliance, and DA conditions. | The system should have a CC checklist with all required documents. |
| S8.5 | HOLD POINT — NCC compliance | Inspector | This is the first statutory hold point in the project. The Inspector must pass it before CC is issued. | The hold point should be visible on `hold_point_requirements` with `blocks_progress=1`. The Inspector completes it via the App. |
| S8.6 | Confirm DA conditions addressed | PM | The PM must confirm all DA conditions are addressed. | The system should have a checklist of DA conditions, each marked "addressed" by the PM. |
| S8.7 | Confirm Home Warranty Insurance | PM | In WA, Home Warranty Insurance is mandatory for residential work over $20,000 (effective 2026). | The system should flag if the project requires HW insurance and show a warning if it's not uploaded. |
| S8.8 | Receive CC — construction can commence | System | This is the PM's signal to activate Stage 10. The real work is about to start. | The system should auto-advance the project status to "Construction Ready" when the CC is issued. |

## Stage 9 — Construction Tender Preparation (Deposit Milestone)

**PM's Reality Check:** This is where the PM finally engages a Builder. The
PM's job is to select the right Builder, not just the cheapest Builder. In
WA, the average Builder margin is 15-25% on a residential project.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S9.1 | Prepare Bill of Quantities from drawings | PM/Estimator | The BOQ is the document that ties the drawings to the budget. A bad BOQ leads to a bad build. | The system should auto-generate a BOQ from the estimate lines (`estimate_lines` table). The PM should review and sign off. |
| S9.2 | Issue tender to shortlist of Builders | PM | The tender should go to Builders who are in the PM's contact book (Introduction already completed). | The system should allow the PM to select Builders from the introductions list (same-org v1). The tender package should be a single downloadable PDF. |
| S9.3 | Compare Builder tenders | PM | Price is not the only factor. Program, inclusions, and Builder's reputation all matter. | The system should allow the PM to compare tenders side-by-side, with columns for price, program, inclusions, and exclusions. |
| S9.4 | Select winning Builder | PM | Commercial decision, value locked. The PM's reputation is on the line. | The system should record the selection and the reason (price/program/inclusions). This is an auditable decision. |
| S9.5 | Send formal Job Award invitation | PM | The Job Award is sent from the PM's contact book. No cold strangers. | The system should enforce the "cold stranger" constraint (already implemented — `job_awards` requires a prior `introductions` row). |
| S9.6 | Builder accepts/declines | Builder | The Builder's acceptance is a lightweight in-app tap. The deposit (S9.8) is the binding event. | The system should record the Builder's acceptance and link it to the deposit payment. |
| S9.7 | Set `builder_engagement_type` | PM | This decision is the single most important commercial decision the PM makes. It drives Cost Plan visibility for the entire project. | The system should require the PM to select the engagement type before the Job Award is finalised. This should be a clear, explained decision. |
| S9.8 | Finalise and lock construction Cost Plan | PM | The Cost Plan is the project's financial backbone. Once locked, it's the reference for all actuals. | The system should freeze the Cost Plan (`cost_plans` table) and flag it as "locked." Changes should create a new version (Variation). **BILLING MILESTONE: Deposit.** |
| S9.9 | Builder confirms/overrides job breakdown | Builder | The Builder sets task-level scope (project vs unit) once assigned. | The system proposes defaults; the Builder confirms/overrides each one. |
| S9.10 | Builder engages own subcontractor panel | Builder | The Builder engages trade subcontractors. The PM sees the register (who/committed/owed) but never the rates. | The system should record the Builder's subcontractor engagements and show the PM a read-only register. |

## Stage 10 — Site Works & Earthworks

**PM's Reality Check:** This is the first stage where the PM is no longer the
sole actor. The Site Supervisor and Foreperson take over day-to-day
operations. The PM's role shifts to monitoring and verifying.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S10.1 | Site induction / toolbox talk | Site Supervisor | Every worker must be inducted. No exceptions. The PM is responsible if someone isn't. | The system should track who has been inducted (via the `inductions` table) and flag if someone turns up without an induction. |
| S10.2 | Site clearing and demolition | Foreperson | Demolition can uncover unexpected issues (asbestos, contaminated soil). | The system should allow the Site Supervisor to log photos and notes of unexpected discoveries. |
| S10.3 | Cut and fill earthworks to design levels | Foreperson | In WA, limestone is common. Earthworks often hit rock. This is a variation waiting to happen. | The system should allow the Foreperson to log "rock encountered" and trigger a Variation. |
| S10.4 | Install temporary site amenities | Foreperson | Toilet, power, water are required before work starts. | The system should have a checklist for site amenities, marked complete by the Site Supervisor. |
| S10.5 | Install temporary fencing and signage | Foreperson | In WA, site fencing is a WHS and council requirement. | The system should have a checklist for temporary fencing and signage, marked complete by the Site Supervisor. |
| S10.6 | HOLD POINT — Surveyor sets out building position | Surveyor + Foreperson | This is the first real hold point in the construction phase. Wrong setout = project disaster. | The hold point should be visible on `hold_point_requirements` with `blocks_progress=1`. The surveyor's report should be uploaded. |
| S10.7 | Site Supervisor confirms setout | Site Supervisor | The Site Supervisor is the PM's independent check. They don't report to Builder. | The `site_diary` should have a "setout verified" entry, signed by the Site Supervisor. |

## Stage 11 — Foundation, Slab & In-Ground Services

**PM's Reality Check:** This is the "get it right before the concrete goes
in" stage. Once the slab is poured, fixing mistakes is expensive and
time-consuming. In WA, concrete footings must be inspected before the pour.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S11.1 | Excavate footings and trenches | Tradie | In WA, limestone is common. Excavation often hits rock. This is a variation waiting to happen. | The system should allow the Foreperson to log "rock encountered" and trigger a Variation. |
| S11.2 | Underground drainage — sewer, stormwater | Tradie | Services are buried. Once the slab is poured, you can't move them. | The inspection hold points (S11.9-S11.11) are critical. The system should not allow the slab pour (S11.12) until all three are cleared. |
| S11.3 | Water supply rough-in | Tradie | Same as S11.2. | Same as S11.2. |
| S11.4 | Gas line rough-in (if required) | Tradie | Gas lines are common in WA for heating and cooking. | The system should track if gas is required and flag the relevant inspection. |
| S11.5 | Electrical conduit rough-in | Tradie | Electrical conduits are buried. They must be inspected before the pour. | The inspection hold point (S11.9) is critical. The system should not allow the pour until it's cleared. |
| S11.6 | Reinforcement steel (rebar) placement | Tradie | Rebar spacing and cover are structural. The engineer checks this. | The system should record the rebar inspection result and link it to the engineer's certificate. |
| S11.7 | Formwork for slab | Tradie | Formwork must be to the design levels. A mistake here leads to a crooked slab. | The system should record the formwork inspection result. |
| S11.8 | Site Supervisor checks service location/depth | Site Supervisor | The Site Supervisor is the PM's independent check. They verify the services are in the correct location and depth. | The `site_diary` should have a "services verified" entry, signed by the Site Supervisor. |
| S11.9 | HOLD POINT — electrician's rough-in certificate | Inspector (Electrical) | In WA, electrical rough-in must be certified by a licensed electrician before the pour. | The `hold_point_requirements` table should have a row for electrician's certificate. The Inspector completes it via the App. |
| S11.10 | HOLD POINT — plumber's rough-in certificate | Inspector (Plumbing) | Plumbing rough-in must be certified before the pour. | The `hold_point_requirements` table should have a row for plumber's certificate. The Inspector completes it via the App. |
| S11.11 | HOLD POINT — Principal Certifier overall verification | Inspector | The Principal Certifier verifies everything before the pour. | The `hold_point_requirements` table should have a row for Principal Certifier verification. The Inspector completes it via the App. |

## Stage 12 — Concrete Slab Pour & Foundation (Base Milestone)

**PM's Reality Check:** This is the first real billing milestone. The client
pays the "Base" milestone after this stage is complete. In WA, the slab must
cure for 7-14 days before any further work.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S12.1 | Pour ground floor slab and footings | Foreperson | Concrete pours in WA weather can be affected by heat. Summer pours need early mornings. | The system should allow the Site Supervisor to log the weather conditions (temperature, humidity) at pour time. |
| S12.2 | Finish concrete to design levels | Foreperson | The surface must be to the design levels. A high spot is a problem for the next stage. | The system should record the pour completion date and link it to the slab inspection. |
| S12.3 | Install anchor bolts and connection plates | Foreperson | Anchor bolts hold the frame to the slab. They must be placed correctly. | The system should record the anchor bolt placement and link it to the frame inspection. |
| S12.4 | Cure concrete (time-gated) | System | Concrete takes time to cure. The PM can't rush this. | The system should auto-set a 7-day cure timer and not allow Stage 13 to start until it's complete. |
| S12.5 | Waterproofing (if required) | Foreperson | In WA, waterproofing is required for wet areas (bathrooms, balconies). | The system should auto-flag if waterproofing is required and track its completion. |
| S12.6 | Record concrete delivery dockets | Site Supervisor | Dockets are proof of the concrete grade and quantity. The PM needs these for compliance. | The system should allow the Site Supervisor to upload photos of delivery dockets. |
| S12.7 | HOLD POINT — Form BA2 slab inspection | Inspector | This is a statutory hold point. The Inspector must pass it. | The hold point should be visible on `hold_point_requirements` with `blocks_progress=1`. The Inspector completes it via the App. |
| S12.8 | HOLD POINT — core compression test (if flagged) | Inspector | If Stage 2 flagged a soil hazard, the core tests are mandatory. If not, they're optional. | The system should auto-flag if core compression tests are required based on the Stage 2 hazard audit. |
| S12.9 | HOLD POINT — compaction test log (if flagged) | Inspector | Same as S12.8. | Same as S12.8. |

## Stage 13 — Frame & Roof Construction (Frame Milestone)

**PM's Reality Check:** This is where the building becomes real. The frame
goes up quickly, and the PM can see the shape of the house. In WA, the frame
is typically timber (AS 1684) or steel.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S13.1 | Erect structural frame (timber/steel) | Tradie | In WA, timber frame is common. It must meet AS 1684. The F5 timber grade certification is mandatory. | The system should record the F5 certificate on file. |
| S13.2 | Install structural bracing | Tradie | Bracing is critical for structural integrity. It must be installed per the engineer's design. | The system should record the bracing installation and link it to the engineer's inspection. |
| S13.3 | Install roof trusses and sheathing | Tradie | Roof trusses are the skeleton of the roof. They must be installed correctly. | The system should record the truss installation and link it to the building surveyor's inspection. |
| S13.4 | Install roof cladding | Tradie | Roof cladding (tiles or metal) protects the house from weather. | The system should record the roof cladding type and link it to the delivery dockets. |
| S13.5 | Install gutters and downpipes | Tradie | Gutters and downpipes must be to the approved plan. | The system should record the gutter installation and link it to the building surveyor's inspection. |
| S13.6 | Install ceiling insulation | Tradie | Ceiling insulation is required for NatHERS rating. | The system should record the insulation type and link it to the energy rating certificate. |
| S13.7 | Record timber/steel + roof material dockets | Site Supervisor | Dockets are proof of material grade and quantity. The PM needs these for compliance. | The system should allow the Site Supervisor to upload photos of delivery dockets. |
| S13.8 | HOLD POINT — structural engineer inspects frame | Inspector (Engineer) | The engineer checks the structural integrity. Different from the building surveyor's check. | The `hold_point_requirements` table should have a row for structural engineer. The Inspector completes it via the App. |
| S13.9 | HOLD POINT — building surveyor inspects frame | Inspector (Surveyor) | The surveyor checks compliance with the approved plans. | The `hold_point_requirements` table should have a row for building surveyor. The Inspector completes it via the App. |
| S13.10 | HOLD POINT — F5 timber grade certification | System | The F5 certificate is mandatory for timber frames. | The system should check for the F5 certificate on file before allowing the stage to complete. **BILLING MILESTONE: Frame.** |

## Stage 14 — Lock-Up & External Envelope (Lock-Up Milestone)

**PM's Reality Check:** This is the "building secured from weather" stage.
The client pays the "Lock-Up" milestone here. In WA, lock-up is complete when
the roof, walls, windows, and doors are installed.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S14.1 | Install external wall cladding | Tradie | Cladding in WA can be brick, weatherboard, or fibre cement. The choice affects the look and cost. | The system should record the cladding type and link it to the material selection. |
| S14.2 | Install windows and glazing | Tradie | Window energy rating certificates are required in many WA councils. | The system should record the window energy rating certificate on file. |
| S14.3 | Install external doors | Tradie | External doors must be installed and secure. | The system should record the door installation. |
| S14.4 | Install wall insulation | Tradie | Wall insulation is required for NatHERS rating. | The system should record the insulation type and link it to the energy rating certificate. |
| S14.5 | Window/cladding QA check (internal) | Site Supervisor | This is an internal QA check, not a statutory hold point. | The Site Supervisor logs this via the App's Quality tab. |
| S14.6 | Window energy rating certificate | System | The certificate must be on file. | The system should check for the certificate on file. |
| S14.7 | Confirm building secured from weather | Site Supervisor | The Site Supervisor confirms the building is weather-secure. | The Site Supervisor confirms via the App's Site Diary. **BILLING MILESTONE: Lock-up.** No statutory hold point at this stage — internal QA only. |

## Stage 15 — Internal Services Rough-In

**PM's Reality Check:** This is the "services before the walls close up"
stage. Plasterboard hides everything, so everything must be inspected before
it's covered.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S15.1 | Electrical rough-in (cabling, switchboard, alarms) | Tradie | All services must be in place and inspected before wall lining. | The inspection hold points (S15.5 and S15.6) must be cleared before plasterboard can be installed. |
| S15.2 | Plumbing rough-in (drainage, water supply) | Tradie | Same as S15.1. | Same as S15.1. |
| S15.3 | HVAC rough-in (ducting, refrigerant) | Tradie | HVAC rough-in must be inspected before wall lining. | The system should have a checklist for HVAC rough-in. |
| S15.4 | Data/comms cabling (if required) | Tradie | Data and comms cabling must be inspected before wall lining. | The system should have a checklist for data/comms rough-in. |
| S15.5 | HOLD POINT — electrical inspection | Inspector (Electrical) | The electrician's rough-in must be inspected and signed off. | The `hold_point_requirements` table should have a row for electrical inspection. The Inspector completes it via the App. |
| S15.6 | HOLD POINT — plumbing inspection | Inspector (Plumbing) | The plumber's rough-in must be inspected and signed off. | The `hold_point_requirements` table should have a row for plumbing inspection. The Inspector completes it via the App. |
| S15.7 | Electrical safety compliance certificate | System | The certificate must be on file. | The system should check for the certificate on file. |
| S15.8 | Install plasterboard/wall lining | Tradie | Gated on both hold points. Must happen while the wall cavity is still open. | The system should not allow this task to be marked complete until both hold points are cleared. |

## Stage 16 — Fit-Out & Finishes (Fixing Milestone)

**PM's Reality Check:** This is where the house becomes a home. The client's
material selections come to life. In WA, the fixing stage can take 4-8 weeks.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S16.1 | Plastering and setting | Tradie | Plastering is a skilled trade. The finish quality matters for the paint. | The system should record the plastering completion date. |
| S16.2 | Painting | Tradie | Painting in WA can be affected by weather. High humidity affects drying time. | The system should record the painting completion date. |
| S16.3 | Cabinetry installation | Tradie | Cabinetry is custom. Lead times are often 4-8 weeks. | The system should track cabinetry lead time and delivery date. |
| S16.4 | Tiling (per room/wet area) | Tradie | Tiling is room-level, not a flat per-unit task. Bathroom 1, Bathroom 2, Kitchen splashback are separate tasks. | The system should support room-level task nesting (via `tasks.parent_id`). |
| S16.5 | Flooring | Tradie | Flooring (timber, carpet, vinyl) must be installed after painting. | The system should record the flooring type and installation date. |
| S16.6 | Fixtures and fittings | Tradie | Fixtures and fittings include bathroom fixtures, kitchen sink, light fittings, power points. | The system should have a checklist for fixtures and fittings. |
| S16.7 | HOLD POINT — energisation certificate | Electrician + Inspector | This is the critical statutory hold point. The certificate name varies by state (COES/CCEW/CoT&C/CoC/CES). | The `hold_point_requirements` table must have a `jurisdiction` field so the correct certificate name is injected automatically. |
| S16.8 | Appliance installation | Tradie | Appliances (oven, cooktop, dishwasher) must be installed and tested. | The system should record the appliance installation date. |
| S16.9 | Record cabinetry/tiles/fixtures deliveries | Foreperson | Delivery dockets are proof of material receipt. | The system should allow the Foreperson to upload photos of delivery dockets. |
| S16.10 | Final trade sign-off, per room | Foreperson/Site Supervisor | The tick-then-verify chain applies here: Foreperson ticks, Site Supervisor verifies. | The system should support tick-then-verify for each room. **BILLING MILESTONE: Fixing.** |

## Stage 17 — External Works & Landscaping

**PM's Reality Check:** This is the "finish the outside" stage. The lightest
stage — no hold point, internal QA only. In WA, landscaping is often the last
thing completed.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S17.1 | External cladding final finishes and painting | Tradie | The external finish must match the approved plan. | The system should record the external finish type. |
| S17.2 | Driveway and paths (council permit may apply) | Tradie | In many WA councils, a crossover permit is required. This varies by local council, not just state. | The system should have a `jurisdiction` field for S17.2 but treat it as a PM-checked manual flag. |
| S17.3 | Retaining walls | Tradie | Retaining walls over 1m require engineering certification. | The system should record the retaining wall type and engineering certification. |
| S17.4 | Boundary fencing | Tradie | Boundary fencing must comply with council requirements. | The system should record the fencing type and compliance. |
| S17.5 | Hard landscaping | Tradie | Paving, garden beds, etc. | The system should allow the Foreperson to log landscaping completion. |
| S17.6 | Soft landscaping | Tradie | Turf, plants, trees, etc. | The system should allow the Foreperson to log soft landscaping completion. |
| S17.7 | Final clean (builder's clean) | Tradie | The builder's clean is the final task. After this, the site is handed over. | The Site Supervisor logs this in the Site Diary. |
| S17.8 | Record fencing/retaining-wall/landscaping deliveries | Foreperson | Delivery dockets are proof of material receipt. | The system should allow the Foreperson to upload photos of delivery dockets. |
| S17.9 | Site Supervisor final external walk-through | Site Supervisor | This is an internal QA check, not a statutory hold point. | The Site Supervisor logs this via the App's Site Diary. |

## Stage 18 — Compliance, Handover & Asset Depreciation (Completion Milestone)

**PM's Reality Check:** This is the final stage. The PM's job is to hand over
a compliant building and close out the project. In WA, the Occupation
Certificate is the final statutory document.

| Code | Task | Typical Actor | PM's Reality Check | ProjMan2 System Need |
|---|---|---|---|---|
| S18.1 | Final building inspection | Inspector | The Inspector signs off. If they fail, defects must be rectified. | The `hold_point_requirements` table must have a row for Occupation Certificate (S18.3). |
| S18.2 | Issue Form BA3 (Certificate of Compliance) | Inspector | Form BA3 is issued after final inspection. | The system should record Form BA3 on file. |
| S18.3 | HOLD POINT — Occupation Certificate | Inspector | This is the final statutory hold point. The building cannot be occupied without it. | The hold point must block Stage 18 completion until the OC is issued. |
| S18.4 | Practical Completion walkthrough — generate defect list | PM & Client | The PM and Client walk through together. Defects are logged. | The system should generate a defect list from the walkthrough and track rectification. |
| S18.5 | Defect rectification (loops until clear) | Tradie | This can take weeks. The PM must track each defect to closure. | The system should have a defect list (already exists via `defects` table) with status tracking. |
| S18.6 | Client handover — keys, manuals, warranties | PM | The final delivery. The PM hands over the keys and the handover pack. | The system should auto-generate the handover pack (a query over evidence since Stage 10). |
| S18.7 | Client satisfaction survey | Client | The survey is the final client interaction. | The system should auto-send the survey and record the response. |
| S18.8 | Prepare fixed-asset + depreciation draft | System | This is a draft only, not lodged. | The system should prepare the draft and flag it as "draft." |
| S18.9 | APPROVAL GATE — Accountant/BAS Agent approves | Accountant/BAS Agent | The Accountant must approve the depreciation schedule before ATO lodgement. | The system must have a mandatory approval gate before ATO lodgement fires. |
| S18.10 | Auto-email handover pack | System | The handover pack is auto-emailed to the client. | The system should auto-email the handover pack. |
| S18.11 | Client final digital sign-off | Client | The client signs off on the completed project. | The system should capture the client's sign-off (frozen/hashed). |
| S18.12 | Project status set to completed | System | The project is complete. | The system should set the project status to "completed." **BILLING MILESTONE: Completion.** |

---

## Summary — PM's Key Realities Across All Stages

| Stage | PM's Biggest Risk | The System's Job |
|---|---|---|
| 1 | Land constraints hidden until it's too late | Auto-flag easements, covenants, BAL, and R-code conflicts |
| 2 | Services unmarked; variations start here | DBYD tracking; auto-flag conditional tests from hazards |
| 3 | Client expectations misaligned with budget | Show cost per m²; flag scope-creep revisions |
| 4 | Council delays and missed conditions | Clock tracking; conditions register linked to future stages |
| 5 | Client picks wrong tier, blows budget | Highlight the gap between tier and budget in red |
| 6 | Material selection stalls the project | Visual gallery; pricing per line; track external turnaround |
| 7 | DA package incomplete | Pre-submission checklist; client summary before sign-off |
| 8 | CC delayed by missed NCC compliance | Hold point blocks progress; Inspector-only validation |
| 9 | Wrong Builder selection; wrong engagement type | Side-by-side tender comparison; clear engagement-type explanation |
| 10 | Surveyor setout wrong → project disaster | Hold point blocks progress; Site Supervisor independent check |
| 11 | Services buried incorrectly → variation cascade | Three hold points; no pour until all cleared |
| 12 | Slab fails inspection → rework and delay | Form BA2 and conditional tests; billing milestone tied to validation |
| 13 | Frame fails engineer or surveyor inspection | Two separate hold points; neither substitutes for the other |
| 14 | Lock-up incomplete → weather damage | Internal QA check; Site Supervisor judgement |
| 15 | Services not inspected before wall lining | Two hold points; plasterboard gated on both |
| 16 | Energisation certificate name wrong for jurisdiction | Jurisdiction field; automatic correct certificate name |
| 17 | Driveway permit missed | PM-checked manual flag; no hold point |
| 18 | ATO lodgement fired without approval | Mandatory Accountant approval gate; no auto-lodgement |

---

## Notes for whoever wires this into schema

- **This list is the *default seed*, not a ceiling.** Every task above becomes
  a `stage_template_items` row (system template) and, per-project, a `tasks`
  row once that stage is instantiated. Nothing stops a PM or Builder adding a
  project-specific extra task under the same stage — same `tasks.stage_id`,
  next available `seq`/position, no schema change needed.
- **Hold-point tasks aren't duplicated mechanics** — they reference the
  `hold_point_requirements` rows the 18-Stage Specification (Part 1 §1.5)
  already defines; this list places them in the practical task sequence a PM
  reads top-to-bottom, it doesn't re-specify how they gate.
- **Actor column is "typical," not enforced** — enforcement is by permission
  (per the Spec's own convention, Part 2 preamble), the same as
  `stage_template_items.actor_role` being informational only.
- **"ProjMan2 System Need" is a wishlist surfaced by the PM review, not a
  committed build item.** Several entries (site-access geo-tagged field, R-code
  lookup table, council-response clock with staged warnings, conditions
  register, auto-generated Project Summary/Town Planner package documents)
  imply new columns or tables not yet in the schema — flag these individually
  against `schema-relationship-map.md` before assuming any one of them is
  already buildable.
- Australian standards/compliance references (AS 1684, AS 3600, NatHERS, BAL/
  AS 3959, Home Warranty Insurance, jurisdiction-specific energisation
  certificates, WA R-codes) are flagged where they materially shape the task,
  not exhaustively cited — confirm current requirements per state before this
  becomes client-facing copy, same caveat the underlying Spec carries in
  Part 3.

© eBizco Australia Pty Ltd
