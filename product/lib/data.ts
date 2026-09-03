export const company = {
  product: "ProjMan",
  legalName: "eBizCo Australia Pty Ltd",
  tradingSince: 1998,
  pmTagline: "One Platform to Run Every Construction Project",
  tagline: "Build Tomorrow's Workforce. Today.",
  valueProposition:
    "ProjMan is the project management platform for building and construction — site diaries, scheduling, documents, drawings, defects, RFIs, submittals, permits, safety & OHS, and National Construction Code compliance, all in one system — backed by the only immutable, multi-party verified evidence trail in the industry.",
  differentiator:
    "ProjMan transforms the construction lifecycle into an immutable instrument of workforce integrity, replacing subjective employer testimony with multi-party verified on-site evidence.",
  email: "hello@projman.com.au",
  supportEmail: "support@projman.com.au",
  companyEmail: "ebizco.au@gmail.com",
  phone: "+61 4 1278 3132",
  address: "Unit 1/9 Boag Rd, Morley WA 6062, Australia",
};

export const navLinks = [
  { href: "/features", label: "Features" },
  { href: "/solutions", label: "Solutions" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/veritrade", label: "VeriTrade" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/resources", label: "Resources" },
];

export const footerLinks = {
  Product: [
    { href: "/features", label: "Features" },
    { href: "/solutions", label: "Solutions" },
    { href: "/how-it-works", label: "How It Works" },
    { href: "/pricing", label: "Pricing" },
  ],
  VeriTrade: [
    { href: "/veritrade", label: "Overview" },
    { href: "/veritrade#profiles", label: "Verified Profiles" },
    { href: "/veritrade#search", label: "B2B Talent Search" },
    { href: "/veritrade#pricing", label: "VeriTrade Pricing" },
  ],
  Company: [
    { href: "/about", label: "About" },
    { href: "/resources", label: "Resources" },
    { href: "/contact", label: "Contact" },
    { href: "/contact", label: "Book a Demo" },
  ],
  Legal: [
    { href: "/legal/privacy", label: "Privacy Policy" },
    { href: "/legal/terms", label: "Terms of Service" },
    { href: "/legal/security", label: "Security" },
  ],
};

export type Stage = {
  number: number;
  name: string;
  phase: "Origination" | "Design & Approvals" | "Construction" | "Close-out";
  summary: string;
  tradieAction: string;
  evidence: string;
  holdPoint?: string;
};

export const stages: Stage[] = [
  {
    number: 1,
    name: "Ingestion",
    phase: "Origination",
    summary:
      "Project Manager creates the project — client details, site address, and scope are captured as the single source of truth.",
    tradieAction: "N/A — project owner action",
    evidence: "Signed engagement record, site geolocation anchor",
  },
  {
    number: 2,
    name: "Design Brief",
    phase: "Origination",
    summary:
      "Scope, budget envelope, and client requirements are locked into a structured brief that downstream stages inherit.",
    tradieAction: "N/A — project owner action",
    evidence: "Version-controlled brief document",
  },
  {
    number: 3,
    name: "Concept & Documentation",
    phase: "Design & Approvals",
    summary:
      "Drawings, engineering, and specifications are produced and attached to the project record.",
    tradieAction: "Designers upload drawing revisions",
    evidence: "Timestamped drawing set with revision history",
  },
  {
    number: 4,
    name: "Costing & Contract",
    phase: "Design & Approvals",
    summary:
      "Cost plan is built line-by-line and the head contract is executed between client and builder.",
    tradieAction: "N/A — commercial step",
    evidence: "Digitally signed contract, itemised cost plan",
  },
  {
    number: 5,
    name: "Statutory Approvals",
    phase: "Design & Approvals",
    summary:
      "Development and building approvals are lodged and tracked against jurisdiction requirements.",
    tradieAction: "N/A — compliance step",
    evidence: "Approval certificates linked to project record",
  },
  {
    number: 6,
    name: "Procurement",
    phase: "Design & Approvals",
    summary:
      "Subcontractors are engaged and materials scheduled against the program of works.",
    tradieAction: "Subcontractors accept job award invitations",
    evidence: "Signed sub-contract, QR-verified trade identity",
  },
  {
    number: 7,
    name: "Site Establishment",
    phase: "Construction",
    summary:
      "Site is fenced, serviced, and safety plans are activated before ground is broken.",
    tradieAction: "Crew tick site induction and WHS sign-on",
    evidence: "Geolocated induction record, safety plan acceptance",
  },
  {
    number: 8,
    name: "NCC Compliance Check",
    phase: "Construction",
    summary:
      "A hard hold point — the design is checked against the National Construction Code before excavation proceeds.",
    tradieAction: "N/A — compliance checkpoint",
    evidence: "Inspector-signed compliance checklist",
    holdPoint: "Hold point",
  },
  {
    number: 9,
    name: "Excavation & Earthworks",
    phase: "Construction",
    summary: "Site cut, fill, and drainage preparation are completed and evidenced.",
    tradieAction: "Tradie ticks task completion with geo-stamped photos",
    evidence: "Geolocated photo evidence, timestamp",
  },
  {
    number: 10,
    name: "Survey Set-out",
    phase: "Construction",
    summary:
      "Boundaries and levels are surveyed and verified — correcting an error here is far cheaper than after the slab is poured.",
    tradieAction: "Surveyor ticks set-out complete",
    evidence: "Survey certificate, elevated hold point escalation",
    holdPoint: "Elevated hold point",
  },
  {
    number: 11,
    name: "Footings & Sub-floor",
    phase: "Construction",
    summary: "Footings are formed, reinforced, and poured ahead of the slab.",
    tradieAction: "Tradie ticks task; Foreperson verifies",
    evidence: "Two-party tick-verify chain, photo evidence",
  },
  {
    number: 12,
    name: "Slab",
    phase: "Construction",
    summary:
      "Concrete slab is poured — a hold point checkpoint confirms reinforcement and services before pour sign-off.",
    tradieAction: "Tradie ticks; Supervisor verifies; Inspector attends",
    evidence: "Multi-party verification chain, inspection record",
    holdPoint: "Hold point",
  },
  {
    number: 13,
    name: "Frame",
    phase: "Construction",
    summary: "Structural frame is erected and inspected for compliance.",
    tradieAction: "Tradie ticks; Foreperson and Inspector verify",
    evidence: "Frame inspection certificate, tick-verify chain",
    holdPoint: "Hold point",
  },
  {
    number: 14,
    name: "Lock-up",
    phase: "Construction",
    summary: "External walls, roof, windows, and doors close the building envelope.",
    tradieAction: "Crew tick trade-by-trade completion",
    evidence: "Geolocated evidence per trade package",
  },
  {
    number: 15,
    name: "Rough-in",
    phase: "Construction",
    summary:
      "Electrical, plumbing, and HVAC services are roughed in before wall linings close them from view.",
    tradieAction: "Licensed tradie ticks; Supervisor verifies",
    evidence: "Licence-linked verification, photo evidence",
    holdPoint: "Hold point",
  },
  {
    number: 16,
    name: "Energisation Certificate",
    phase: "Construction",
    summary:
      "Services are certified and connected — the certificate name and checklist vary by state jurisdiction.",
    tradieAction: "Licensed electrician/plumber ticks certification",
    evidence: "State-issued energisation certificate (COES/CCEW/CoC/CES)",
    holdPoint: "Hold point",
  },
  {
    number: 17,
    name: "Fixing & Fit-out",
    phase: "Close-out",
    summary: "Internal linings, joinery, fixtures, and finishes are completed.",
    tradieAction: "Tradie ticks; Foreperson verifies quality",
    evidence: "Photo evidence, defect-free sign-off",
  },
  {
    number: 18,
    name: "Practical Completion & Handover",
    phase: "Close-out",
    summary:
      "Final inspection, occupancy certificate, defects register, and as-built vault are closed out and handed to the client.",
    tradieAction: "Inspector conducts final walkthrough",
    evidence: "Occupancy certificate, as-built vault, verified work history emitted to VeriTrade",
    holdPoint: "Final hold point",
  },
];

export type Role =
  | "Project Manager"
  | "Builder"
  | "Tradesperson"
  | "Government & Regulators"
  | "Investors";

export const roles: {
  id: Role;
  headline: string;
  description: string;
  bullets: string[];
  cta: { label: string; href: string };
}[] = [
  {
    id: "Project Manager",
    headline: "Run every stage from one source of truth",
    description:
      "Track all 18 stages across every project, catch compliance gaps before they cost you, and turn progress claims into a five-minute task instead of a five-day scramble.",
    bullets: [
      "18-stage project tracking with hold-point alerts",
      "AI assistant for NCC-aware compliance checks and document search",
      "RFIs, submittals, and permits tracked to close-out",
      "Real-time budget monitoring against the cost plan",
    ],
    cta: { label: "See PM features", href: "/features" },
  },
  {
    id: "Builder",
    headline: "Run the crew, the numbers, and the compliance trail together",
    description:
      "Assign trades, manage variations, and keep your subcontractor register audit-ready — without leaving the site.",
    bullets: [
      "Site diaries, checklists, and defect close-out",
      "Scheduling, documents, drawings, and actions in one register",
      "Subcontractor pre-qualification with licence verification",
      "Safety, OHS, SDS, and emergency evacuation management",
    ],
    cta: { label: "See Builder solutions", href: "/features" },
  },
  {
    id: "Tradesperson",
    headline: "A career history nobody can dispute",
    description:
      "Every tick you make is geolocated, timestamped, and verified by the people who watched you do the work. That record follows you, not your last employer.",
    bullets: [
      "Portable digital identity across every project",
      "Verified work history, not employer testimony",
      "RPL evidence portfolio ready in weeks, not 18 months",
      "Free VeriTrade profile for the life of your career",
    ],
    cta: { label: "Build your portfolio", href: "/veritrade" },
  },
  {
    id: "Government & Regulators",
    headline: "Workforce integrity you can actually audit",
    description:
      "Immutable, multi-party verified evidence gives regulators and program owners a defensible audit trail for public infrastructure and licensing integrity.",
    bullets: [
      "Audit-ready compliance trails, stage by stage",
      "Workforce and licence verification at scale",
      "Public infrastructure assurance reporting",
      "Program integrity for skilled migration and RPL pathways",
    ],
    cta: { label: "Talk to our policy team", href: "/contact" },
  },
  {
    id: "Investors",
    headline: "A B2B SaaS platform with structural network effects",
    description:
      "ProjMan monetises the demand side of a two-sided market while the supply side — the trades — builds the data asset for free.",
    bullets: [
      "Multi-tenant SaaS with land-and-expand economics",
      "VeriTrade B2B network effects compound with every project",
      "TAM anchored in a chronic, quantifiable industry problem",
      "Clear expansion path: state government, RTOs, tier-1 builders",
    ],
    cta: { label: "Request the investor deck", href: "/contact" },
  },
];

export type PlatformModule = {
  title: string;
  copy: string;
  icon: string;
};

export const platformModules: PlatformModule[] = [
  { title: "Site Diaries", copy: "Daily site diaries — hours, weather, visitors, and plant on hire.", icon: "document" },
  { title: "Checklists & ITPs", copy: "Structured checklists and inspection & test plans, stage by stage.", icon: "list-checks" },
  { title: "Insurances", copy: "Policy currency tracked with expiry alerts before cover lapses.", icon: "umbrella" },
  { title: "Tickets", copy: "Licence and competency tickets verified per worker, per trade.", icon: "ticket" },
  { title: "Scheduling", copy: "Gantt and line-of-balance program scheduling, kept in sync with site.", icon: "calendar" },
  { title: "Documents", copy: "A single, version-controlled document register for the whole project.", icon: "document" },
  { title: "Actions", copy: "Assign, track, and close out action items with an audit trail.", icon: "list-checks" },
  { title: "Locations", copy: "A location register mapped to site zones, lots, and levels.", icon: "map-pin" },
  { title: "SDS", copy: "Safety Data Sheet register for every chemical and material on site.", icon: "alert-triangle" },
  { title: "Drawings", copy: "Drawing register with revision control, markups, and superseded tracking.", icon: "image" },
  { title: "Defects", copy: "Defect register with photo evidence and multi-party close-out sign-off.", icon: "bug" },
  { title: "RFI", copy: "Request for Information workflow with tracked, timestamped responses.", icon: "help-circle" },
  { title: "Submittals", copy: "Submittal register for materials and shop drawing approvals.", icon: "upload" },
  { title: "Permits", copy: "Permit-to-work register and issuance workflow, hold-point aware.", icon: "stamp" },
  { title: "Workflow", copy: "Configurable approval workflows across every register on the platform.", icon: "workflow" },
  { title: "Messages", copy: "In-context project messaging, tied directly to tasks and stages.", icon: "message" },
  { title: "Pre-qualification", copy: "Subcontractor and supplier pre-qualification, kept current automatically.", icon: "user-check" },
  { title: "Emergency Evacuation", copy: "Evacuation plans, drills, and emergency contacts, always up to date.", icon: "siren" },
  { title: "Safety & OHS", copy: "WHS management, incident reporting, and hazard register in one place.", icon: "shield-check" },
  { title: "National Construction Code", copy: "NCC-aware compliance checks built into hold points, per jurisdiction.", icon: "gate" },
  { title: "AI Assistant", copy: "An AI assistant across the platform for compliance, scheduling, and document search.", icon: "bot" },
];

export type Feature = {
  slug: string;
  title: string;
  short: string;
  detail: string;
  icon: string;
};

export const features: Feature[] = [
  {
    slug: "lifecycle",
    title: "18-Stage Lifecycle Management",
    short: "Every project mapped from Ingestion to Handover, with nothing skipped.",
    detail:
      "ProjMan's Core Logic Driver walks every project through all 18 stages, from Stage 1 Ingestion to Stage 18 Practical Completion & Handover. Hold points are enforced automatically, so a slab can't be poured until its checkpoint is signed off.",
    icon: "layers",
  },
  {
    slug: "verification",
    title: "Multi-Party Verification",
    short: "A hierarchical tick-verify chain replaces one person's word.",
    detail:
      "Tradie ticks the work. Foreperson verifies it. Supervisor confirms it. Inspector attests it at hold points. Each layer adds independent, zero-trust confirmation — no single party can fabricate a record alone.",
    icon: "shield-check",
  },
  {
    slug: "evidence",
    title: "Immutable Evidence Capture",
    short: "Geolocated, timestamped, hashed — evidence that can't be edited after the fact.",
    detail:
      "Every tick is captured with GPS location, a server timestamp, and a cryptographic hash. Once recorded, it's permanent. That's what makes the evidence usable for RPL, disputes, and regulatory audits.",
    icon: "fingerprint",
  },
  {
    slug: "veritrade",
    title: "VeriTrade Integration",
    short: "Australia's first B2B professional network built entirely on verified work.",
    detail:
      "Every completed project automatically emits a portable, verified credential to the tradesperson's VeriTrade profile — a searchable, evidence-backed professional network for the whole industry.",
    icon: "network",
  },
  {
    slug: "analytics",
    title: "Real-Time Analytics",
    short: "Gantt and line-of-balance views that update as the evidence comes in.",
    detail:
      "Project dashboards give PMs and builders a live view of program, budget, and compliance status — no more waiting for a Friday afternoon status update to find out you're behind.",
    icon: "chart",
  },
  {
    slug: "rpl",
    title: "RPL Automation",
    short: "Credentialing evidence packaged automatically as work is completed.",
    detail:
      "Recognition of Prior Learning evidence is assembled continuously, not reconstructed from memory at assessment time. That's the difference between an 18-month RPL application and one that takes weeks.",
    icon: "badge",
  },
  {
    slug: "geolocation",
    title: "Geolocated Task Evidence",
    short: "Proof of presence, not just proof of a claim.",
    detail:
      "Every evidence capture is anchored to the site's geolocation, so a tick can't be made from off-site. It's a structural guardrail against fabricated records, not a policy that relies on trust.",
    icon: "map-pin",
  },
  {
    slug: "compliance",
    title: "Hold Points & Compliance Gates",
    short: "Jurisdiction-aware checkpoints that block progress until they're cleared.",
    detail:
      "NCC checks, survey set-out, slab, frame, rough-in, and energisation certificates are all modelled as hold points, with the right checklist and certificate name rendered per state.",
    icon: "gate",
  },
  {
    slug: "inclusion",
    title: "Digital Inclusion by Design",
    short: "Built for every worker, regardless of digital literacy.",
    detail:
      "Voice input, minimal-typing task flows, and QR-based identity exchange mean a 30-year veteran tradie with no interest in apps can use ProjMan as easily as a digital-native apprentice.",
    icon: "accessibility",
  },
];

export type PricingTier = {
  name: string;
  audience: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  cta: { label: string; href: string };
  highlighted?: boolean;
};

export const pricingTiers: PricingTier[] = [
  {
    name: "Starter",
    audience: "Small builders & individuals",
    price: "$79",
    cadence: "per user / month",
    description: "Core project management for builders running a handful of jobs at a time.",
    features: [
      "Core 18-stage project management",
      "Up to 10 active projects",
      "Basic evidence capture (photo + timestamp)",
      "Subcontractor register",
      "Email support",
    ],
    cta: { label: "Start Free Trial", href: "/contact" },
  },
  {
    name: "Professional",
    audience: "Medium builders & commercial crews",
    price: "$189",
    cadence: "per user / month",
    description: "The full lifecycle, unlimited projects, and a public VeriTrade presence.",
    features: [
      "Full 18-stage lifecycle with hold-point enforcement",
      "Unlimited active projects",
      "Multi-party tick-verify chain",
      "VeriTrade publishing for your crew",
      "Multi-user access with role-based permissions",
      "Priority support",
    ],
    cta: { label: "Start Free Trial", href: "/contact" },
    highlighted: true,
  },
  {
    name: "Enterprise",
    audience: "Tier-1 contractors & large builders",
    price: "Custom",
    cadence: "annual agreement",
    description: "Custom configuration, API access, and dedicated support for large-scale delivery.",
    features: [
      "Custom stage and role configuration",
      "Full API access",
      "Multi-tenant, multi-entity controls",
      "Dedicated implementation & support team",
      "Advanced compliance & audit reporting",
      "SLA-backed uptime commitments",
    ],
    cta: { label: "Book a Demo", href: "/contact" },
  },
];

export const stats = [
  { value: "21", label: "Integrated project modules, one system" },
  { value: "18", label: "Lifecycle stages, fully mapped" },
  { value: "100%", label: "Multi-party verified evidence" },
  { value: "18mo → weeks", label: "RPL credentialing time, as a result" },
];

export const testimonials = [
  {
    quote:
      "Site diaries, drawings, defects, and RFIs used to live in four different tools. Now it's one project record, and my Friday afternoon status update is mine again.",
    name: "Project Manager",
    role: "Residential builder, VIC",
  },
  {
    quote:
      "The tick-verify chain isn't extra admin — it's just how trust already worked on-site, made visible. My crew and I aren't chasing each other for sign-off anymore.",
    name: "Site Supervisor",
    role: "Commercial builder, WA",
  },
  {
    quote:
      "We stopped arguing about whether a job was done and started looking at the evidence. That single change reshaped how our site meetings run.",
    name: "Site Operations Lead",
    role: "Commercial builder, WA",
  },
];

export const caseStudy = {
  title: "Rivervale: pivoting from high-rise to townhouse mid-program",
  summary:
    "When a Perth infill project pivoted from a high-rise concept to a townhouse subdivision mid-planning, the delivery team needed to re-sequence stages without losing the compliance trail already captured. ProjMan's stage-based model let them re-map the program in days, keeping every piece of already-captured evidence intact and audit-ready.",
  href: "/resources",
};

export const blogPosts = [
  {
    slug: "35-percent-unqualified",
    title: "Why 35% of Australian Tradespeople Lack Formal Qualifications",
    excerpt:
      "The gap between practical skill and paper credential is costing the industry billions — and it's not the workers' fault.",
    category: "Industry Insight",
  },
  {
    slug: "10000-dollar-rpl-barrier",
    title: "The $10,000 RPL Barrier: What's Broken and How to Fix It",
    excerpt:
      "Recognition of Prior Learning should reward experience. Instead, it often prices experienced workers out entirely.",
    category: "Whitepaper",
  },
  {
    slug: "verifiable-credentials-future",
    title: "Verifiable Credentials: The Future of Construction Workforce",
    excerpt: "What the shift from employer testimony to multi-party verified evidence actually means on-site.",
    category: "Product",
  },
  {
    slug: "skilled-migrant-underemployment",
    title: "How ProjMan Solves the Skilled Migrant Underemployment Crisis",
    excerpt:
      "Overseas trade qualifications don't disappear at the border. The evidence to prove them often does — until now.",
    category: "Industry Insight",
  },
  {
    slug: "digital-inclusion-construction",
    title: "Digital Inclusion in Construction: Designing for Every Worker",
    excerpt: "Why voice input and QR exchange matter more than another dashboard.",
    category: "Product",
  },
  {
    slug: "economic-case-verifiable-pathways",
    title: "The Economic Case for Verifiable Career Pathways",
    excerpt: "Modelling the cost of credentialing friction across a national trades workforce.",
    category: "Whitepaper",
  },
];

export const leadMagnets = [
  {
    title: "The 18-Stage Construction Lifecycle Framework",
    format: "PDF Guide",
  },
  {
    title: "How to Slash RPL Costs by 90%",
    format: "Whitepaper",
  },
  {
    title: "Construction Workforce Integrity Checklist",
    format: "Checklist",
  },
  {
    title: "The Ultimate Guide to Verifiable Credentials",
    format: "Guide",
  },
];
