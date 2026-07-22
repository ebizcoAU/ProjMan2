# projman-03: CPC50220 Diploma Alignment — frozen unit list + gap closure

**Date:** 2026-07-22
**Status:** 🟢 REFERENCE FROZEN (unit list) · 🟡 gap features scheduled (see development.md §12)
**Source of record:** CPC50220 Diploma of Building and Construction (Building),
**Release 4**, training.gov.au — official PDF `CPC50220_R4.pdf`, document generated
24 December 2024, © Commonwealth of Australia / BuildSkills Australia.

## Why this record exists

The CPC50220 mapping is a product differentiator, so its unit list must be exact and
not drift. This file is the **single frozen source** the `cpc_units` seed and
development.md §12 both transcribe from.

⚠ **Verification warning.** An automated summary of the *same* official PDF returned
the **superseded CPC50210** units (codes with an `…A` suffix) and the wrong unit
count (24 total instead of 27). The list below was transcribed from the rendered PDF
pages directly, not from any summary. Treat CPC50210 codes as **not** equivalent.

## Packaging rule

**27 units of competency = 24 core + 3 elective.** A maximum of one elective may come
from any training package or accredited course. `*` marks a prerequisite dependency.

## Core units (24 — all required)

| Code | Title |
|---|---|
| BSBOPS504 | Manage business risk |
| BSBWHS513 | Lead WHS risk management |
| CPCCBC4001 | Apply building codes and standards to the construction process for Class 1 and 10 buildings |
| CPCCBC4003 | Select, prepare and administer a construction contract |
| CPCCBC4004 | Identify and produce estimated costs for building and construction projects |
| CPCCBC4005 | Produce labour and material schedules for ordering |
| CPCCBC4008 | Supervise site communication and administration processes for building and construction projects |
| CPCCBC4009 | Apply legal requirements to building and construction projects |
| CPCCBC4010* | Apply structural principles to residential and commercial constructions |
| CPCCBC4012 | Read and interpret plans and specifications |
| CPCCBC4013 | Prepare and evaluate tender documentation |
| CPCCBC4014 | Prepare simple building sketches and drawings |
| CPCCBC4018 | Apply site surveys and set-out procedures to building and construction projects |
| CPCCBC4053 | Apply building codes and standards to the construction process for Class 2 to 9, Type C buildings |
| CPCCBC5001 | Apply building codes and standards to the construction process for Type B construction |
| CPCCBC5002 | Monitor costing systems on complex building and construction projects |
| CPCCBC5003 | Supervise the planning of onsite building and construction work |
| CPCCBC5005 | Select and manage building and construction contractors |
| CPCCBC5007 | Administer the legal obligations of a building and construction contractor |
| CPCCBC5010 | Manage construction work |
| CPCCBC5011 | Manage environmental management practices and processes in building and construction |
| CPCCBC5013 | Manage professional technical and legal reports on building and construction projects |
| CPCCBC5018* | Apply structural principles to the construction of buildings up to 3 storeys |
| CPCCBC5019 | Manage building and construction business finances |

## Elective units (choose 3)

| Code | Title |
|---|---|
| BSBPMG532 | Manage project quality |
| BSBPMG538 | Manage project stakeholder engagement |
| CPCCBC4052 | Lead and manage teams in the building and construction industry |
| CPCCBC5004 | Supervise and apply quality standards to the selection of building and construction materials |
| CPCCBC5006 | Apply site surveys and set-out procedures to building projects up to three storeys |
| CPCCBC5009 | Identify services layout and connection methods for Type C and B construction |
| CPCCBC5012 | Manage the application and monitoring of energy conservation and management practices and processes |
| CPCCBC6001 | Apply building codes and standards to the construction process for large building projects |
| CPCCDE5001 | Conduct air monitoring and clearance inspections for asbestos removal work |
| CPCSUS5001 | Develop workplace policies and procedures for sustainability |
| CPCSUS5002 | Develop action plans to retrofit existing buildings for energy efficiency |
| CPCSUS5003 | Manage energy efficient building methods and strategies |
| CPPDSM5022 | Develop and implement asset management plans |

## Prerequisites (from the qualification)

- **CPCCBC5018** requires CPCCBC5001 **and** CPCCBC4053.
- **CPCCBC4010** requires CPCCBC4053 **and** CPCCBC4001.

## Qualification scope (limits worth encoding)

- Residential: **NCC Class 1 and 10**, max **3 storeys**.
- Commercial: **NCC Class 2 to 9**, **Type C and B** construction.

These bound the `ncc_register.ncc_class` / `building_type` value sets (§12.3) and are
the correct default scope for a builder on this qualification.

## Decisions

1. This unit list is **frozen reference**; the `cpc_units` table is seeded from it.
2. The **seven gaps** are mapped and scheduled in development.md §12.1 / §12.5 — no
   core unit is left unsupported; one gap (Service Coordination) satisfies an
   elective only.
3. **Competency-evidence generation** (`cpc_evidence`) is deferred behind
   `projman-02` (identity-scoped evidence domain) because it is inherently
   cross-tenant; the reference/tagging tables (`cpc_units`, `cpc_feature_map`) are
   not, and land with P3.
4. **Plan Viewer**: PDF render + markup offline; DWG stored/versioned only.

## Server realization (NexusPM, 2026-07-22)

How the frozen mapping is enforced server-side. This complements the list above; it
does not alter unit codes or titles.

### R1 — Reference tables (system scope, NOT tenant-scoped)
- **`cpc_units`** — the frozen list above, seeded by a migration; columns
  `release` (e.g. `CPC50220_R4`), `code`, `title`, `type` (core|elective),
  `prereq_codes`. It is **system reference**: no `org_id`, and it is **not synced
  per-device** (same treatment as Nexus's shared `companies` — excluded from the pull
  loop). The dashboard reads it via a reference endpoint; every org sees the same
  list.
- **`cpc_feature_map`** — `unit_code → feature/module` tags. Reference, non-tenant.
- Both are org-agnostic and land with the **P3 domain tables**, independent of
  projman-02.

### R2 — Compliance-blocking gates (`ComplianceService`, server-enforced, never client)
The blocking pattern is development.md §5.6 (an open hold point blocks its stage) /
§5.8 (invoice gate). Two CPC areas add completion gates, enforced in a
`ComplianceService` (per servdesignspecification §3) called from **both** the
sync-push path and dashboard writes, so the rule holds on every surface:
- **NCC** (units **CPCCBC4001 / CPCCBC4053 / CPCCBC5001 / CPCCBC6001**, and
  **CPCCBC5003** planning): an open `ncc_register` item on a stage **blocks that
  stage's completion**.
- **Structural** (units **CPCCBC4010\*** / **CPCCBC5018\***): an incomplete
  structural inspection / open structural hold point **blocks completion**.

The remaining gaps (environmental, site services, service coordination, consultant
management, plan viewer) are **feature-mapped and checklist-driven**, not completion
gates — they inform, they do not block.

### R3 — Qualification-scope validation (server-side)
The scope limits under *Qualification scope* become server-side enum/CHECK
constraints on `ncc_register`: residential `ncc_class ∈ {1, 10}` (max 3 storeys),
commercial `ncc_class ∈ {2…9}` with `building_type ∈ {C, B}` (large via the
CPCCBC6001 elective). A client must not be able to record an out-of-scope NCC class —
validated server-side, matching the §77–83 note.

### R4 — Scoping domains (ties to projman-02)
- `cpc_units` / `cpc_feature_map` / `ncc_register` are **system- or org-scoped** →
  land with the P3 domain tables (a future projman record + `sync/registry.js`
  entries).
- **`cpc_evidence`** (competency evidence) is **identity-scoped and cross-tenant** →
  built on the projman-02 attestation store (its §10 decisions apply: signed at
  emission, signature verified at trust-score + profile-share). Deferred behind
  projman-02, exactly as *Decisions §3* states — this section just names where the
  server enforcement lives.

## Maintenance

CPC50220 is a live training-package qualification. On any new release, re-fetch the
official PDF, re-transcribe this list, and bump the `cpc_units.release` seed. Do not
edit unit codes or titles from memory or secondary summaries.
