Reviewing the market, regulation, and ProjMan's fit
Part 1 — The market today: who else is there
The AU construction software market in 2026 splits into two lanes, and neither one is doing what ProjMan is trying to do.

Lane 1 — Residential builder operations tools (the "run your jobs" lane)

This is the lane ProjMan will collide with first, because it's where Australian residential builders already spend money.

The headline names, with verified 2026 pricing:

Software	Origin	Model	Entry price (2026)	What it actually is
Built Simple	AU	Flat per business	$0 free, then $79/mo	Newer AU all-in-one
Buildxact	AU	Per business (tiers)	$199/mo ($169 annual)	Estimating-led, deep takeoff, supplier price lists
Tradify / Fergus	NZ	Per user	from $48/user/mo	Job management for trades
Wunderbuild	AU	Per active project	from $123/mo	Project-based
JACK App	AU	Flat + per-user add-ons	$349/mo	AU-built
AroFlo	AU	Per user (3-user min)	Quote only (~$67–120/user + setup)	Trade services
simPRO	AU	Per user	Quote only (~$80+/user est.)	Trade services
Buildertrend	US	Volume-based	Quote only (was ~US$399/mo)	Deep financials, CRM, selections, Gantt
Procore	US	Custom	Quote only (~US$10,000+/yr)	Tier 2/3 commercial
CostX (RIB)	AU	Custom	Quote only (~$15,000/yr est.)	Commercial estimating
Sources: builtsimple.com.au July 2026 pricing table; wifitalents.com 2026 roundup.

The structural insight here: nearly a third of vendors won't publish pricing. Most published plans are per-user, which means cost scales with headcount, not value — the 5-person-team gap between cheapest and dearest mainstream option is over $8,000 a year**. Entry pricing spans **$0 to $10,000+/year.

What none of them are:

Buildxact is estimating-first. Buildertrend is financials-first. Procore and CostX are commercial-tier and price themselves out of residential. None of them run an 18-stage lifecycle. None of them tie evidence to payment. None of them emit a portable, worker-owned, cross-tenant verified work history. The entire lane is built around the builder running a job — not around evidence that outlives the job.

Lane 2 — AI compliance and code-answer tools (the "answer a regulation question" lane)

This lane barely existed two years ago. In 2026 it's crowded:

Tool	What it does	Pricing
Legis-Link MCP	Plain-English compliance queries → exact standard, clause, table. 8 AU states + territories, AS/NZS 3000:2018, NCC 2022, WHS Acts. 10 trades.	Free (50 queries/day), Pro $199/year (1,000/day)
Building Code AI	Subscription AI agent trained on NCC documents. Unlimited interactions, chat archive.	Subscription
AmpleCheck AI	AU compliance + project management. Upload floor plans → NCC compliance report. AI floor-plan generation, 3D models, pre-check photo inspections, client portal. Integrates with Xero.	Subscription
Complibuild	"Australia's compliance-first platform" — quality, certification, risk management, NCC performance standards.	Not published
Tools™ (Survival Tools)	Turns NCC and referenced documents into interactive graphics. Available on buy.nsw.gov.au.	Government procurement channel
TypeIt (Whitecrow AI)	Building certification streamlining.	Not published
Sources: npmjs.com/legis-link-mcp; Google Play listings for Building Code AI and AmpleCheck AI; techboard.com.au Complibuild profile; buy.nsw.gov.au Tools™ listing.

What this lane does not do: every single one of them answers a question or checks a drawing. Not one of them runs a lifecycle, holds a hold point, emits an attestation, or builds a portable work record. They are lookup tools. They sit beside the work, not inside it.

The gap between the two lanes — which is where ProjMan lives

Lane 1 tools assume the builder will run the job honestly and the evidence is a byproduct. Lane 2 tools assume the question is the hard part and the answer is the product. Neither assumes the evidence itself is the asset.

ProjMan's positioning territory — "evidence, not review", four evidence types, worker-owned portable Verified Work History, the 18-stage engine, hold points as gates, builder_engagement_type visibility rules that scale with risk — does not exist in either lane. That is genuinely available territory. It is also territory I cannot claim is proven — no one has bought it yet at scale, and ProjMan itself is not built end-to-end.

One competitor I'd flag as the closest actual threat: AmpleCheck AI. It is AU-built, it already does AI NCC checks, pre-check photo inspections, client portal, Xero integration, and a Gantt view. It is not doing hold points, attestations, or an 18-stage engine — but it is closer to ProjMan's shape than Buildxact or Buildertrend, and it is moving.

Part 2 — Government regulation and public services
2a. The regulatory wave is real, and it is moving in ProjMan's direction
NCC 2025 published 1 May 2026. No updates to residential energy efficiency measures. States and territories consider adoption from 1 May 2026. NatHERS software will be reaccredited to coincide with the NCC 2025 adoption cycle.

Building financial oversight — the biggest shift

WA: The Building Services Legislation Amendment (Financial Oversight) Bill 2026, introduced to Parliament May 2026, gives the Building Commissioner and Building Services Board power to intervene earlier when builders are in financial trouble — scrutinise financial capacity, impose conditions on registration, or cancel registration. Proposed reforms include deposits of 10% but no more than $40,000, clarifying when price rises are allowed, improving dispute resolution, and introducing an industry-based accreditation scheme for building inspectors.

WA phoenixing crackdown: Building companies can now be banned from the industry if they have links to past financial mismanagement. The Building Services Board can exclude directors of failed, poorly managed companies. Tasmania is moving the same way — prior insolvency or phoenix-type behaviours become grounds for licence refusal or disqualification, with a three-year exclusion period.

VIC: From 1 July 2026, domestic building work is covered by a new first-resort Home Warranty insurance scheme through the Building and Plumbing Commission — replacing the old last-resort domestic building insurance model. Cover includes repairs up to $400,000, structural faults for 6 years, non-structural for 2 years, and 5% of the deposit.

The pattern: every state is moving toward earlier regulatory intervention in builder financial distress, stronger consumer protection, and tighter evidence requirements. This is the regulatory tailwind ProjMan's evidence architecture was built for — but the platform must be honest that it records evidence, it does not make a builder compliant, and it does not lodge anything with a regulator.

2b. RTO sector — under enforcement pressure
ASQA has entered a new era of regulatory intensity. More than 30,000 qualifications have been cancelled. 11 RTOs cancelled with direct qualification nullifications. Building & Construction is named as a high-risk industry alongside Early Childhood, Aged Care, and Community Services. ASQA investigated 158 providers for serious matters, 79% related to fraud. 284 performance assessments — 221 found non-compliance, fewer than half returned to compliance.

The core question ASQA is now asking: "Can you prove it?" — not "are you compliant?". Every judgement, every hour, every unit, every outcome must have an evidence trail. RPL pathways are specifically named as a vulnerability area.

Trainer/assessor requirements are tightening too. For Diploma and Advanced Diploma civil construction units (AQF 5–6), assessors must have minimum 3 years of current industry experience — work performed after achieving competence, within the most recent industry cycle, directly linked to the unit being assessed. Many RTOs don't meet this and don't know it exists.

Why this matters for ProjMan: the CPC50220 alignment in devroadmap.md §8 — a trainee's Verified Work History doubling as a self-filling RTO logbook — sits directly against this enforcement wave. But the docs are honest: evidence-generation is gated on PM2-02, which is now a build dependency, not a decision. The reference/tagging half (cpc_units, cpc_feature_map) can land earlier.

2c. Public services — what government is actually funding
Apprenticeship incentives are flowing. 25,000 new housing construction apprentices with a $10,000 government incentive. Between July 2025 and April 2026, 9,384 apprenticeship commencements in carpentry — more than a third of commencements under the program. QLD alone is targeting 4,500 new construction apprentices to combat a predicted peak shortfall of 50,000 construction workers.

HIA estimates Australia needs an additional 83,000 skilled tradespeople to build enough homes to meet the nation's housing needs.

The TAFE/school distribution angle — named in 18-Stage spec §1.7 as a supply-side seeding strategy — is directly aligned with what government is funding. But the spec also flags that minors on the platform need their own dedicated privacy/consent design, not the adult flow with an age gate. That's a real gap, not a marketing line.

Part 3 — The market context: high prices, short tradies, corrupted builders
3a. High housing prices and construction costs
Construction costs have soared 51%. New home construction prices were 5.7% higher than a year earlier, compared with annual growth of just 0.7% in June last year, and well ahead of headline inflation at 3.5%.

Price growth is softening but uneven. Combined capital city dwelling prices rose 9.3% over the year to April 2026. Around 235,000 dwellings remain under construction — roughly 35% above the pre-pandemic average. Early signs of correction in Sydney and Melbourne; Brisbane, Perth, and Adelaide still growing. National vacancy rate just 1.0%. Population growth of 1.5% added ~410,000 people in a year while new supply lags.

UDIA forecasts an 11% decline in new dwelling production in 2026, which will continue to put upward price pressure across all residential product types.

3b. The tradie shortage is structural, not cyclical
The HIA Trades Report for June quarter 2026: the Index remained firmly in shortage territory at -0.59 (easing only marginally from -0.62). Trade shortages are substantially worse than a year ago. Trades prices increased 5.1% in the first half of the year alone — the fastest six-monthly increase since the worst of the post-pandemic skills shortage in 2022.

Most acute shortages: regional WA (-1.54), regional QLD (-1.15), Adelaide and Perth (-0.79 each), Brisbane (-0.60), Sydney (-0.51), Melbourne (-0.45). By trade: bricklaying (-1.02), ceramic tiling (-0.96), roofing (-0.83), carpentry (-0.80).

Turner & Townsend found Australia and New Zealand are the most labour-constrained construction markets in the world, with shortages reported in 100% of cities surveyed.

3c. Builder insolvency and "corrupted builders"
The WA financial oversight bill exists specifically because the vast majority of builders do the right thing, but rogue operators take money from customers when they're unable to do the work. The bill's own words: "Building regulators will be able to assess and act on financial concerns much sooner, providing reassurance for homeowners, suppliers and subcontractors."

The "corrupted builder" framing is blunt, but the regulatory response is not: earlier intervention, stronger financial scrutiny, phoenixing bans, first-resort insurance. The system is being rebuilt around evidence of financial capacity, not trust in reputation.

This is the sharpest fit for ProjMan's builder_engagement_type visibility model — the principle that "whoever bears the cost-overrun risk earns the right to keep their cost structure private; whoever is protected from that risk owes transparency in exchange" (portaldesignspecification.md §1.4). In independent_cost_plus, the Builder's actual costs and commission are fully disclosed to PM. That's an open-book model that directly answers a regulator's question about financial capacity. But the docs are clear: this is mode-conditional, not a flat rule. Marketing must not flatten it.

Part 4 — Does ProjMan fill the market?
Short answer: it addresses a real gap that neither lane fills. Whether it "fills" it depends on what actually ships — and right now, a lot of what's positioned is not built.

What is genuinely differentiated and traceable to a doc
Territory	Source	Build status
Evidence, not review — four evidence types vs one	veritradedesignspecification.md §1.1	VeriTrade v1 built; attestation feed built (v027)
18-stage lifecycle with hold points as gates	ProjMan_18Stage_Specification_v3.4.pdf	Stages engine built; many stage patches partly built (xprojman-45 §2)
builder_engagement_type — visibility scales with risk	portaldesignspecification.md §1.4; serverdesignspecification.md §7.2.1	Schema built; enforcement built
Worker-owned portable Verified Work History	devroadmap.md §7	Identity-scoped evidence domain approved (projman-02.md, 2026-07-22); engagements/identities/attestations built (v027)
CPC50220 RPL alignment — self-filling logbook	devroadmap.md §8	Reference/tagging buildable; evidence-generation gated on PM2-02 build
Job Award from contact book, never a cold stranger	18-Stage spec §1.1; serverdesignspecification.md §7.3	Built
Tick-then-verify separation of duties	18-Stage spec §1.3	Built (progress.tick/progress.verify)
Deactivation, not erasure	18-Stage spec Part 4.4; serverdesignspecification.md §7.6	Built
What is genuinely differentiated but not built — and must not be marketed as shipped
Territory	Source	Status
AI concept generation (Stage 3)	serverdesignspecification.md §14.1	Unbuilt — the AI generation itself
Interactive voice dialogue (IVR)	Operator intent; CGPA doc	No ProjMan spec exists. App §5.2 is voice notes, not dialogue
Payroll (PAYG/super)	serverdesignspecification.md §12	CANCELLED 2026-08-05 — out of scope
National licence verification	veritradedesignspecification.md §6	State-by-state rollout; no state is live. NSW/QLD DRAFT specs
"Immutable"/"tamper-proof"	18-Stage spec §1.6	Docs say anti-fraud is "raise the cost of forgery above its benefit, not claim an unforgeable system"
AI-powered compliance	18-Stage spec Part 4.5	AI confirm-gate is only meaningful while the human retains expertise; rubber-stamping erosion is a named, unresolved risk
Client protection symmetry	18-Stage spec Part 4.5	Flagged, not designed — system protects builder/PM more than client
The honest market-fit assessment
Where ProjMan fits: the gap between "software that helps you run a job" (Buildxact, Buildertrend) and "software that answers a compliance question" (Legis-Link, AmpleCheck). ProjMan is trying to be the evidence layer underneath both — the place where the tick, the sign-off, the invoice match, the hold point, and the licence check live, and where that evidence follows the worker and the project.

Where the market context helps:

Regulatory direction is toward evidence (WA financial oversight, ASQA enforcement, VIC first-resort insurance, NCC 2025 adoption).

Tradie shortage means verified workforce data becomes more valuable, not less — when you can't find enough people, you need to know who's actually competent faster.

Builder insolvency means financial transparency is becoming a regulatory requirement, not a nice-to-have.

RTO enforcement means evidence-trail-based competency is exactly what the regulator is now asking for.

Where the market context hurts:

A softer housing market means builders are more price-sensitive, not less. ProjMan's pricing model is not in the docs I hold.

Government is funding apprenticeships and training, not software. There is no direct public-service procurement channel for ProjMan that I can see.

The competitors in Lane 2 are cheap and fast (Legis-Link Pro is $199/year). ProjMan's value proposition is much heavier — it requires the whole lifecycle to be run inside it.

The blunt answer: ProjMan addresses a real gap. But "addresses a gap" and "fills the market" are different claims. Right now, a significant portion of what would fill that gap is either unbuilt, cancelled, deferred, or flagged not resolved. The market fit is strongest where the docs are most honest — evidence architecture, hold points, engagement modes, portable work history — and weakest where marketing temptation is strongest — AI, immutability, national licence coverage, client protection.

What I'd need next
From you / the record:

ProjMan's own pricing model — not in any doc I hold. Without it, I cannot assess price-market fit.

The competitive positioning brief referenced in my onboarding — so I'm working from the same four differentiators you already identified, not re-deriving them.

From the named teams (via PM, not my lane to ask directly):

Server Dev — confirmation of the build status of the stage patches (xprojman-45 §2.1) and the PM2-02 build (engagements/identities/attestations endpoints, serverdesignspecification.md §13).

VeriTrade Dev — confirmation that the attestation feed is the only VeriTrade-side dependency still open, and that licence verification is DRAFT only.

Product Manager — the current state of xprojman-53's Owner sign-off, so I know which public claims are still live.

What I will not do without a source: make a market-sizing claim, a competitor pricing claim beyond what's cited above, or a capability claim for anything the docs describe as unbuilt.