=======================================================================================
               PROJMAN2 — BUILDING & CONSTRUCTION LIFECYCLE
                         Standard Australian Workflow
=======================================================================================
[TARGET SYSTEM CONFIGURATION]
- Frontend Client: Flutter (Mobile App - SQLite Edge Cache Integration)
- Administration Control: ReactJS (Office Web Portal & Principal Dashboard)
- Central Data Engine: Node.js + Express + MySQL Database Pool
- Artificial Intelligence: Python Inference Engine (REST API Microservice / OCR / NLP)
- Core Logic Driver: 18-Stage Structural & Financial Lifecycle Matrix (AU Standard)
=======================================================================================

ROLE ACTOR PAIRING REGISTRY
---------------------------------------------------------------------------------------
1. 'projectManager'  --> Office Portal + Mobile App. Creates projects, maps land data,
                        triggers AI audits, and authorizes contract variations.
2. 'siteSupervisor'  --> Mobile App. Runs the construction site daily, tracks staging,
                        and enforces WorkSafe WA safety protocols.
3. 'foreperson'      --> Mobile App. Leads trade crews, updates Work Breakdown Structures,
                        and coordinates job-chaining tasks.
4. 'tradie'          --> Mobile App. Accesses live schematics, conduit pathways,
                        and service run details.
5. 'inspector'       --> Portal + Mobile App. Verifies structural compliance,
                        signs certifications, and issues compliance clearances.
6. 'client'          --> Public Portal. Reviews progress, approves variations,
                        signs off on milestones.
=======================================================================================


PART A: DESIGN & APPROVALS LIFECYCLE (Stages 1–7)
=======================================================================================

STAGE 1: PROJECT_CREATION_LAND_INGESTION
- Actor Allocation: projectManager

- System Action (App & Portal):
  Provide a dedicated form interface for inputting customer profiles, contact credentials,
  and physical site vectors.
  The Flutter app must allow direct camera uploads of land titles, contour files,
  and land survey reports, caching them inside the local SQLite database.

- Python AI Integration:
  Pass the uploaded image/document blob to the Python OCR engine.
  The AI must parse the document, extract land owner names, lot boundaries (m²),
  and property perimeter lengths.

- System Output:
  Trigger a Python-composed automated email to the client confirming document reception.
  The email must display an itemized list of all ingested files, a timestamped
  digital receipt, and a unique ProjMan2 tracking ID.


STAGE 2: ENVIRONMENT_UTILITY_HAZARD_AUDIT
- Actor Allocation: projectManager

- System Action (Portal & App):
  The system must present input fields to evaluate four clear spatial boundaries:
  1. Underground/Overhead Utilities: Ingest Dial-Before-You-Dig GIS coordinates,
     sewer junction depths, and overhead power clearances.
  2. Zoning Info: Input the local council zoning code (e.g., R150) and cross-check
     if the planned building scope matches local density allowances.
  3. Legal Complications: Input clear boundaries for property easements, restrictive
     covenants, or specific council design guidelines.
  4. Environmental Hazards: Map physical distance buffers to nearby flood zones,
     heritage areas, or bushfire prone areas.

- Python AI Integration:
  The NLP model must evaluate these data fields against a compliance matrix of local
  planning laws and building codes.

- System Output:
  Automatically generate and transmit an AI-composed summary email to the client.
  The text must clearly define the initial audit results, potential development outcomes,
  and any critical risks or complications affecting the target building envelope.


STAGE 3: CONCEPT_DESIGN_GENERATION
- Actor Allocation: projectManager

- System Action (App & Portal):
  Provide a one-click trigger button to initialize automated geometric block modeling.

- Python AI Integration:
  The AI module must extract the zoning variables, land boundary titles, and lot dimensions
  to compute a structural conceptual drawing layout.
  The generated block diagram must display:
  1. The legal land boundary plot lines.
  2. The optimized structural building footprint.
  3. The mandatory green open-space zones.
  4. A clear elevation profile view showing maximum building heights.
  5. A text summary sheet calculating internal floor areas (m²).

- System Logic:
  The Python engine must output a step-by-step text rationale explaining how the
  architectural envelope was generated based on boundary setback formulas.

- System Output:
  Automatically email the customer, attaching the generated logical text rationale
  and the three conceptual PDF documents (Footprint Plan, Elevation Profile, Area Summary).


STAGE 4: TOWN_PLANNER_COUNCIL_SCREENING
- Actor Allocation: projectManager

- System Action (Portal):
  Capture a formal client acceptance click inside the Flutter app.
  Once validated, the Node.js backend must package the complete Stage 3 data assets.

- System Output:
  Automatically draft and transmit a detailed email payload to the appointed Town Planner.
  Alternatively, route a Preliminary Construction Intent email directly to the local
  municipal council planning department to verify the building envelope boundaries.


STAGE 5: BUDGET_BASED_STYLE_GENERATION
- Actor Allocation: projectManager

- System Action (Portal):
  Once the council or town planner confirms the building envelope lines, unlock the
  style options selector matrix.

- Python AI Integration:
  The AI engine must evaluate the site's dimensions and generate three distinct,
  cost-calibrated architectural options:
  1. Budget Option: Maximizes standard framing and material efficiencies.
  2. Deluxe Option: Balances premium finishes with optimized spatial layouts.
  3. Premium Option: Integrates luxury features and high-end materials.

- System Output:
  Transmit an AI-composed email to the client itemizing the specifications and
  projected financial cost models for all three options.


STAGE 6: ARCHITECTURAL_DRAWING_DEVELOPMENT
- Actor Allocation: projectManager

- System Action (App & Portal):
  Upon the client selecting their preferred budget tier, route the data files to the
  appointed draftsman or architect.
  While the professional completes the DA drawing set, the Flutter app must present the
  client with an interactive material selection portal.

- Python AI Integration:
  The moment the draftsman uploads the finalized structural floor plans and elevation views,
  the Python 3D rendering engine must automatically map the customer's selected materials
  onto the drawing files, outputting 3D interior design previews.


STAGE 7: DA_SUBMISSION_APPROVAL
- Actor Allocation: projectManager

- System Action (App & Portal):
  1. Transmit the complete DA (Development Application) drawing set to the client
     for final review and digital sign-off.
  2. Upon client approval, compile the final certified drawing package.
  3. Submit to the local council or certifying authority.

- Status Transitions:
  - Client review: WAITING_FOR_CUSTOMER_FEEDBACK
  - Client approved: DA_READY_FOR_SUBMISSION
  - Council received: DA_PENDING_COUNCIL_REVIEW

- System Output:
  - Digital signature capture (Flutter UI)
  - Auto-email with DA submission confirmation
  - Calendar countdown tracking council's statutory response clock


=======================================================================================
PART B: APPROVALS & PERMITS LIFECYCLE (Stages 8–9)
=======================================================================================

STAGE 8: DA_APPROVAL_CONSTRUCTION_CERTIFICATE
- Actor Allocation: projectManager & inspector

- System Action (Dashboard):
  Upon receiving DA approval from council:
  1. Update project status: DA_APPROVED
  2. Engage Principal Certifier (independent building surveyor)
  3. Prepare and lodge Construction Certificate (CC) application
  4. Ensure all conditions of DA are addressed

- Critical Path:
  - Principal Certifier must verify compliance with NCC (National Construction Code)
  - Structural engineer must certify plans under AS3600/AS3850

- System Restriction:
  No construction work can commence until:
  - Construction Certificate issued
  - Principal Certifier appointed
  - Home Warranty Insurance in place (WA: https://www.building.wa.gov.au/)


STAGE 9: CONSTRUCTION_TENDER_PREPARATION
- Actor Allocation: projectManager & estimator

- System Action (Dashboard):
  While approvals are being processed:
  1. Prepare detailed Bill of Quantities (BOQ)
  2. Issue tender documents to selected subcontractors (electrical, plumbing, etc.)
  3. Collect and compare subcontractor quotes
  4. Finalize construction budget
  5. Prepare construction program (Gantt)

- Data Created:
  - tender_documents
  - subcontractor_quotes
  - estimates
  - project_stages (from WA_RESIDENTIAL_18 template)
  - tasks

- Financial Note:
  Each stage gets its estimated/committed/actual/claimed columns


=======================================================================================
PART C: CONSTRUCTION EXECUTION LIFECYCLE (Stages 10–15)
=======================================================================================

STAGE 10: SITE_WORKS_EARTHWORKS
- Actor Allocation: siteSupervisor & foreperson

- System Action (App):
  Upon receiving Construction Certificate, activate site tracking module:
  1. Site clearing and demolition (if applicable)
  2. Cut and fill earthworks to design levels
  3. Install temporary site amenities (toilet, power, water)
  4. Set out building position (surveyor pegs)
  5. Erect temporary fencing

- Data Created:
  - site_establishment
  - setout_records
  - site_diary entries (daily)

- Evidence:
  - Photos of cleared site
  - Survey set-out records
  - Inspection by surveyor


STAGE 11: FOUNDATION_SLAB_IN_GROUND_SERVICES
- Actor Allocation: siteSupervisor, foreperson & tradie

- System Action (App):
  1. Excavation for footings and underground services
  2. Install underground drainage (sewer, stormwater)
  3. Install water supply rough-in
  4. Install gas lines (if required)
  5. Install electrical conduit and services
  6. Place reinforcement steel (rebar)
  7. Install formwork for concrete slab

- Hold Point - CRITICAL INTERLOCK:
  - Plumbing rough-in MUST be inspected before concrete pour
  - Electrical conduit MUST be inspected before concrete pour
  - No concrete pour until Principal Certifier verifies
  - Site Supervisor must check: all services in correct location
    and to correct depth

- Data Created:
  - inspections (plumbing, electrical)
  - service_registers (hydraulic, electrical)
  - site_diary entries

- Evidence:
  - Photos of rebar, services
  - Inspection sign-off


STAGE 12: CONCRETE_SLAB_POUR_FOUNDATION
- Actor Allocation: siteSupervisor & inspector

- System Action (App & Dashboard):
  1. Pour ground floor slab and footings
  2. Finish concrete to design levels
  3. Install anchor bolts and connection plates
  4. Cure concrete
  5. Waterproofing (if required)

- System Restriction:
  The milestone cannot advance until the independent Inspector uploads:
  - Form BA2 (Inspection of concrete slab)
  - Concrete core compression test results (if required)
  - Compaction test log (if required)

- Data Created:
  - inspections (slab inspection)
  - certificates (Form BA2)
  - deliveries (concrete dockets)

- Evidence:
  - Photos of slab
  - Concrete delivery dockets
  - Inspection sign-off


STAGE 13: FRAME_ROOF_CONSTRUCTION
- Actor Allocation: siteSupervisor, foreperson & tradie

- System Action (App):
  1. Erect structural frame (timber or steel)
  2. Install structural bracing
  3. Install roof trusses and sheathing
  4. Install roof cladding (tiles or metal)
  5. Install gutters and downpipes
  6. Install ceiling insulation

- Hold Point - CRITICAL INTERLOCK:
  - Frame MUST be inspected by engineer AND building surveyor
  - Stage CANNOT proceed to lock-up until frame inspection passed
  - Timber frame must meet F5 (Australia) standards
  - Roof tie-downs must be verified (wind rating)

- Data Created:
  - inspections (frame inspection, roof inspection)
  - certificates
  - deliveries (timber/steel, roof materials)

- Evidence:
  - Photos of frame, roof
  - Engineer inspection sign-off
  - Building surveyor inspection sign-off

- The Algorithmic Event-Chaining Rule:
  The instant Stage 13 is toggled to is_validated = true:
  - Python engine automatically schedules Stage 14 (Lock-up)
  - Auto-notify electrical and plumbing trades that rough-in is due


STAGE 14: LOCK_UP_EXTERNAL_WORKS
- Actor Allocation: siteSupervisor, foreperson & tradie

- System Action (App):
  1. Install external wall cladding (brick, weatherboard, fiber cement, etc.)
  2. Install windows and glazing
  3. Install external doors
  4. Install insulation (walls)
  5. Install plasterboard lining
  6. Building now secured from weather

- Data Created:
  - inspections (window inspection, cladding inspection)
  - certificates (window energy rating)
  - deliveries

- Evidence:
  - Photos of installed windows/doors
  - Building sealed from weather


STAGE 15: INTERNAL_SERVICES_ROUGH_IN
- Actor Allocation: foreperson & tradie

- System Action (App):
  1. Electrical rough-in (cabling, switchboard, smoke alarms)
  2. Plumbing rough-in (internal drainage, water supply)
  3. HVAC rough-in (ducting, refrigerant pipes)
  4. Data/comms cabling (if required)

- Hold Point:
  - Electrical inspection BEFORE wall lining
  - Plumbing inspection BEFORE wall lining

- Data Created:
  - inspections (electrical, plumbing, HVAC)
  - service_registers
  - certificates (electrical safety compliance)

- Evidence:
  - Photos of rough-in services
  - Inspection sign-off


=======================================================================================
PART D: FIT-OUT & FINISHES LIFECYCLE (Stages 16–17)
=======================================================================================

STAGE 16: FIT_OUT_FINISHES
- Actor Allocation: foreperson & tradie

- System Action (App):
  1. Plastering and setting (cornices, smooth walls)
  2. Painting (walls, ceilings, trim)
  3. Cabinetry installation (kitchen, bathroom, wardrobes)
  4. Tiling (floor, walls, splashbacks)
  5. Flooring (timber, carpet, vinyl)
  6. Fixtures and fittings (bathroom fixtures, kitchen sink)
  7. Light fittings, switches, power points
  8. Appliance installation (oven, cooktop, dishwasher)

- Data Created:
  - inspections
  - deliveries
  - certificates (if applicable)

- Evidence:
  - Photos of completed rooms
  - Trade sign-off


STAGE 17: EXTERNAL_WORKS_LANDSCAPING
- Actor Allocation: siteSupervisor & foreperson

- System Action (App):
  1. External cladding final finishes and painting
  2. Driveway and paths
  3. Retaining walls
  4. Boundary fencing
  5. Hard landscaping (paving, garden beds)
  6. Soft landscaping (turf, plants, trees)
  7. Final clean (builders clean)

- Data Created:
  - inspections
  - deliveries
  - site_diary entries

- Evidence:
  - Photos of completed site
  - Final site photos


=======================================================================================
PART E: COMPLETION & HANDOVER LIFECYCLE (Stage 18)
=======================================================================================

STAGE 18: COMPLIANCE_HANDOVER_ASSET_DEPRECIATION
- Actor Allocation: projectManager & inspector

- System Action (App & Dashboard):
  1. Final building inspection by Principal Certifier
  2. Issue Certificate of Compliance (Form BA3)
  3. Issue Occupation Certificate (OC)
  4. Electrical safety certificate (ESC)
  5. Plumbing compliance certificate
  6. Practical Completion inspection (PM + Client)
  7. Defect rectification (if any)
  8. Client handover (keys, manuals, warranties)
  9. Client satisfaction survey

- The Invoicing & Accounting Interlock:
  - If an invoice is submitted to Stage 18 but Stage 12 (Slab) or Stage 15 (Rough-in)
    is NOT is_validated = true → system flags as compliance risk
  - Progress payment pipeline FROZEN until compliance verified

- The Accounting Automation:
  The moment the Occupation Certificate is marked as validated:
  - Node.js backend pulls all accumulated capital costs from project ledger
  - Generates new fixed asset entry
  - Automatically initiates daily diminishing-value tax depreciation calculations
  - Sends to Australian Tax Office (ATO) lodgement

- System Output:
  - Auto-email with handover documents (Form BA3, OC, manuals)
  - Digital signature capture (Client sign-off)
  - Project status: COMPLETED
  - Attestation emitted to Verified Work History

- Data Created:
  - projects.status = 'completed'
  - certificates (Form BA3, OC, ESC)
  - client_feedback
  - fixed_assets
  - depreciation_schedule

=======================================================================================
                    SUMMARY — STAGE FLOW WITH APPROVALS
=======================================================================================

Part  | Stage | Name                         | Primary Owner
------+-------+------------------------------+---------------------
A     | 1     | Project Creation             | projectManager
A     | 2     | Utility & Hazard Audit       | projectManager
A     | 3     | Concept Design Generation    | projectManager
A     | 4     | Town Planner Screening       | projectManager
A     | 5     | Budget Style Generation      | projectManager
A     | 6     | Architectural Drawings       | projectManager
A     | 7     | DA Submission & Approval     | projectManager
------+-------+------------------------------+---------------------
B     | 8     | DA Approval & CC             | projectManager + inspector
B     | 9     | Construction Tender Prep     | projectManager + estimator
------+-------+------------------------------+---------------------
C     | 10    | Site Works & Earthworks      | siteSupervisor + foreperson
C     | 11    | Foundation & Services Rough  | siteSupervisor + foreperson
C     | 12    | Slab Pour Foundation         | siteSupervisor + inspector
C     | 13    | Frame & Roof Construction    | siteSupervisor + foreperson
C     | 14    | Lock-up & External Works     | siteSupervisor + foreperson
C     | 15    | Internal Services Rough-in   | foreperson + tradie
------+-------+------------------------------+---------------------
D     | 16    | Fit-out & Finishes           | foreperson + tradie
D     | 17    | External Works & Landscaping | siteSupervisor + foreperson
------+-------+------------------------------+---------------------
E     | 18    | Compliance & Handover        | projectManager + inspector

=======================================================================================
                            CRITICAL HOLD POINTS
=======================================================================================

| Stage | Hold Point                    | Who Verifies                | Blocks |
|-------+-------------------------------+----------------------------+--------|
| 11    | Plumbing/electrical rough-in  | Principal Certifier        | Stage 12 (slab pour) |
| 12    | Slab inspection               | Principal Certifier        | Stage 13 (frame) |
| 13    | Frame inspection              | Engineer + Building Surveyor | Stage 14 (lock-up) |
| 15    | Internal services rough-in    | Principal Certifier        | Stage 16 (fit-out) |
| 18    | Final all certificates        | Principal Certifier        | Handover |

=======================================================================================
                         AUSTRALIAN REFERENCES
=======================================================================================

| Document/Certificate | Source                          | Stage |
|----------------------+---------------------------------+-------|
| DA (Development App) | Local Council                  | 7, 8  |
| CC (Construction Cert) | Principal Certifier           | 8     |
| CDC (Complying Dev Cert) | Principal Certifier          | 8     |
| Form BA2             | Building Surveyor (slab)       | 12    |
| Form BA3             | Building Surveyor (compliance) | 18    |
| Occupation Cert      | Principal Certifier            | 18    |
| ESC                  | Electrician                    | 18    |
| Plumbing Compliance  | Plumber                        | 18    |
| AS3600/AS3850        | Structural Engineer           | 8     |
| NCC (National Const Code) | All                          | 8-18  |
| WorkSafe WA          | Site Supervisor                | 10-18 |

=======================================================================================
                         OPTIONAL MODULES
=======================================================================================

The following modules are optional and available for specific workflows:

| Module Name              | Trigger                        | Stages Affected |
|--------------------------+--------------------------------+-----------------|
| Cross-Border Manufacturing | Client selects offsite/precast | 12, 13, 15, 18  |
| TT Payment Milestones    | Stage 13 validated             | Finance module  |
| BIM (Building Info Model) | Project size > $5M            | All stages      |
| Sustainability           | BASIX/Green Star required      | 2, 3, 8, 18     |

=======================================================================================