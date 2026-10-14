ProjMan — App Functional Specification (Updated: Capture-First, 19 Modules)
Status: ✅ LOCKED & APPROVED — Official v2 Functional Specification (supersedes 27 July 2026 version)
Date: 2026-09-03 (updated 2026-09-03 with resolved design decisions)
Owner: eBizco Australia (Vince Phan)
Source of truth: ProjMan — The 18-Stage Construction Lifecycle, Fully Decomposed, v3.4 — cited as "the 18-Stage spec"; docs/decisions/xprojman-27.md (19 modules); docs/researchPaper/18Stage_Tasks.md (task library)
Companion docs: portaldesignspecification.md · devroadmap.md · serverdesignspecification.md · veritradedesignspecification.md

0. The App's True Purpose — Stated First
The app is the on-site verification and capture engine. It is the "shovel-ready" tool that feeds the Portal. Every feature exists to support one or more of these activities:

Activity	What It Means	Evidence Produced
Capture	Record a photo, video, voice note, text, location	Photo, video, audio, text, GPS coordinates
Verify	Confirm something is true (quality, delivery, attendance)	Digital signature, tick, timestamp, geofence result
Witness	Observe and record a process (inspection, work completion)	Photo, video, checklist result, sign-off
Monitor	Check status, identify problems, track progress	Defect log, RFI, action item, material check
Track	Follow movement of people, materials, goods	Attendance, deliveries, inventory movement
Design principle: Every capture is evidence. Attributable (who, device, when, where), offline-first, frozen/hashed for legal weight.

The Portal is the destination. App captures; Portal analyses, manages, and reports.

1. Design Principles (Expanded)
Capture in under 10 seconds. Photo, voice note, quick text — all must be fast.

Works with no signal. Every capture writes locally and queues; sync when connected.

Readable on a bright site, usable in gloves. ≥48dp targets, high contrast, big buttons.

Role-aware, not role-cluttered. Same shell for everyone; content thins per role.

Every capture is evidence. Attributable (who, device, when, where), frozen/hashed.

Unified capture. Photo, video, voice, text, signature, QR — one component, all surfaces.

Professional, calm, trustworthy. Not a consumer app.

The App is the identity root. It is the front door for ProjMan itself and the sole login mechanism for VeriTrade (§8).

2. The Unified Capture Component
One capture component, reused across every surface:

dart
class CaptureService {
  // Single method for all capture types
  Future<CaptureResult> capture({
    required CaptureType type,     // photo | video | voice | text | signature | qr
    required String entityType,    // defect | rfi | delivery | material | ...
    required String entityId,      // the owning row's id
    File? file,                    // photo/video file
    String? text,                  // description/note
    String? voiceText,             // STT-transcribed text
    double? lat, double? lng,      // GPS (always captured if permission granted)
    String? signature,             // digital signature
    String? scannedCode,           // barcode/QR
  });
}
Every capture produces:

Media (photo/video/audio) stored locally, queued for upload

Structured text (description, note, quantity, etc.)

Location (GPS + geofence result)

Attribution (user, device, timestamp)

Signature (where required)

**Resolved design rules for the capture component (locked 2026-09-03):**
- **Video:** Max 60 seconds per clip, manual stop, 1080p @ 8‑10 Mbps.
- **Signature:** Finger‑drawn canvas. Typed names are not accepted.
- **Voice:** Original audio file (MP3/AAC, ~64kbps) retained permanently. Transcription is assistive; the audio is the primary evidence.

3. Navigation — 5 Tabs, Capture-First
text
0 Projects  → Projects · Programme · Drawings · Documents · RFI · Actions · Team
1 Site      → Today · Site Diary · Attendance · Deliveries · Materials · Permits
2 Safety    → Safety · Hazards · Incidents · Inductions · SDS · Emergency Evacuation
3 Quality   → Inspections · Checklists · Defects · Certificates · Submittals
4 Profile   → Profile · My Tickets · VWH · Introduction · VeriTrade Login · Device & Sync
4. The 19 Modules — App Surfaces Defined
4.1 Site Diaries (Module #1)
Current: ✅ Built
Surface: Site → Site Diary

What it captures:

Work done (text + voice + photos)

Delays and disruptions (text + voice)

Photos (unified capture)

Weather (auto, cached)

Headcount (from attendance)

Evidence: Legal record; append-only, versioned.

4.2 Checklists & ITPs (Module #2)
Current: ⚠️ Partial (hold points exist; no generic checklist execution)
Surface: Quality → Checklists

What it captures:

Checklist item pass/fail/NA (tap)

Photo per item (unified capture)

Signature (unified capture)

Location (GPS)

Overall result (pass/fail)

Evidence: Pass/fail result, photo evidence, inspector sign-off. Blocks progress if fail.

**Resolved 2026-09-03:** Checklist items use **explicit Pass / Fail / N/A buttons** – not tap‑to‑cycle. One tap, one decision. Colour‑coded (green/amber/grey), ≥48dp targets.

Sub-types:

Hold point checklists (statutory — blocks progress)

Internal QA checklists (recorded, doesn't block)

Toolbox talks (attendee sign-off)

Plant pre-start checks (operator sign-off)

4.3 Insurances (Module #3)
Current: ❌ Not built
Surface: Profile → My Tickets (read-only)

What it captures:

Insurance certificate upload (photo/PDF)

Expiry date

Issuing authority

Evidence: Proof of insurance; expiry alerts.

4.4 Tickets (Module #4)
Current: ❌ Not built (overlaps VWH)
Surface: Profile → My Tickets

What it captures:

Trade licence/certificate upload (photo/PDF)

White card, forklift ticket, working at heights, etc.

Expiry date

Issuing authority (state-specific)

Selfie (optional, for verification)

Evidence: Credential proof; expiry alerts; portable across Builders.

4.5 Scheduling / My Tasks (Module #5)
Current: ⚠️ Partial (read-only programme)
Surface: Projects → My Tasks

What it captures:

Task complete (tick)

Task progress (%)

Photo attachment (unified capture)

Actual hours logged

Evidence: Task completion, on-time signal.

View: "Today's tasks" — what I need to do right now.

4.6 Documents (Module #6)
Current: ⚠️ Partial (upload exists)
Surface: Projects → Documents

What it captures:

Document upload (photo/PDF/file)

Document view/download (offline-cached)

Document expiry tracking

Evidence: Document itself; version history.

4.7 Actions (Module #7)
Current: ❌ Not built
Surface: Projects → Actions

What it captures:

Action item (text + voice + photo)

Assignee

Due date

Status (open/in_progress/closed)

Resolution notes (text + voice + photo)

Evidence: Follow-up item, assignment, closure.

4.8 Locations (Module #8)
Current: ❌ Not built
Surface: Projects → Locations

What it captures:

Site plan (uploaded from Portal)

GPS pin at point of work

Zone/location selection

Photo attachment (unified capture)

Evidence: Where the work happened. Links defects, hazards, RFIs to specific locations.

4.9 SDS (Safety Data Sheets) (Module #9)
Current: ❌ Not built
Surface: Safety → SDS

What it captures:

SDS lookup (search by product name or code)

SDS download/view (offline-cached)

Scan QR/barcode to lookup SDS

Evidence: Safety-critical; must work offline.

4.10 Drawings (Module #10)
Current: ❌ Not built
Surface: Projects → Drawings

What it captures:

Drawing view (offline-cached)

Drawing markup/annotation

Photo overlay on drawing (unified capture)

Version tracking

Evidence: Drawing version; annotations; marked-up changes.

4.11 Defects (Module #11)
Current: ✅ Built
Surface: Quality → Defects

What it captures:

Defect description (text + voice)

Photo(s) (unified capture)

Location (GPS + location selector)

Trade assignment

Severity (low/medium/high)

Due date

Closure photo (unified capture)

Evidence: Defect record, closure proof.

4.12 RFI (Request for Information) (Module #12)
Current: ❌ Not built
Surface: Projects → RFI

What it captures:

RFI question (text + voice + photo)

Drawing reference (link to drawing)

Consultant/architect assignment

Urgency

Response view (read-only)

Closure

Evidence: Question, response, decision record.

4.13 Submittals (Module #13)
Current: ❌ Not built
Surface: Quality → Submittals (read-only)

What it captures:

Submittal document upload

Status check (sent/in_review/approved/rejected)

Shop drawing/sample approval

Evidence: Approval status; document trail.

4.14 Permits (Module #14)
Current: ❌ Not built
Surface: Site → Permits

What it captures:

Permit upload (photo/PDF)

Permit type (DA, CC, CDC, occupancy, etc.)

Expiry date

Issuing authority

Photo of permit on site

Evidence: Proof of active permit; expiry alerts.

4.15 Workflow (Module #15)
Current: Infrastructure (not a screen)
Surface: None — approval chain infrastructure used by Variations/Billing

4.16 Messages (Module #16)
Current: ❌ Not built
Surface: Projects → Messages

What it captures:

Message (text + photo + voice)

Thread

Recipient

Read receipt

Evidence: Communication record.

4.17 Pre-qualification (Module #17)
Current: ❌ Not built (overlaps Tickets)
Surface: Profile → My Tickets (folded into Tickets)

4.18 Emergency Evacuation (Module #18)
Current: ❌ Not built
Surface: Safety → Emergency Evacuation

What it captures:

Evacuation plan display (offline-cached)

Muster point location

Roll-call (attendee sign-off)

Photo of evacuation drill

Evidence: Safety-critical; must work offline.

4.19 Safety & OHS (General) (Module #19)
Current: ❌ Not built (corrected 2026-09-03, Server Agent — see Team Contributions: no
hazards/incidents table anywhere in the schema, and app/lib/screens/tabs/safety_tab.dart
is still stub-backed; "capture exists" does not hold on either side of the stack)
Surface: Safety → Safety (combined view)

What it captures:

Hazard report (text + voice + photo + location)

Incident report (type, description, photos, notifiable flag)

Toolbox talk (attendee sign-off, topic)

Induction (QR scan, signature, photo, expiry)

Evidence: Safety record, incident report, induction proof.

4.20 NCC AI Assistant (Module #20)
Current: ❌ Not built
Surface: Projects → NCC AI

What it captures:

Quick NCC query (text or voice)

Query result (read-only, offline-cached)

Clause/drawing reference

Evidence: Compliance reference; helpful, not legal advice.

5. Unified Capture Implementation
5.1 The Capture Component
One screen, all capture types:

text
┌─────────────────────────────────────────────┐
│  📷 Capture — [Entity Type]                │
│                                              │
│  [Camera] [Video] [Voice] [Text] [QR]      │
│                                              │
│  ┌─────────────────────────────────────┐   │
│  │  Preview / Transcription             │   │
│  └─────────────────────────────────────┘   │
│                                              │
│  📝 Note:                                   │
│  ┌─────────────────────────────────────┐   │
│  │  [Text input / STT transcribed]     │   │
│  └─────────────────────────────────────┘   │
│                                              │
│  📍 Location: 🟢 On-site (verified)        │
│                                              │
│  👤 Captured by: Dave Smith                 │
│                                              │
│  ┌──────────┐  ┌──────────┐                │
│  │ SAVE     │  │ SUBMIT   │                │
│  │ DRAFT    │  │          │                │
│  └──────────┘  └──────────┘                │
└─────────────────────────────────────────────┘
5.2 Voice-to-Text (STT)
On-device: Vosk (offline) for basic commands and short dictation

Cloud: Google Speech-to-Text (when signal) for complex dictation

Offline-first: Transcribe locally; queue for cloud refinement

**Storage (resolved 2026-09-03):** The original audio file (MP3/AAC, ~64kbps) is retained permanently as the primary evidence. The transcription is displayed in the UI with a playback button for the original audio.

5.3 Photo/Video Capture
Unified picker: Camera or gallery

Compression: Images down-scaled (quality 85, max 2560px) — stays under 25MB

**Video (resolved 2026-09-03):** Max 60 seconds per clip, manual stop, 1080p @ 8‑10 Mbps.

Queue: File on filesystem, metadata in SQLite (upload_queue)

Upload: Background, idempotent on client_ref

5.4 Signature Capture
**Digital signature (resolved 2026-09-03):** Touch-based canvas signature capture (finger-drawn). Typed names are not accepted as signatures.

Timestamp: Server-stamped on upload

Linked to: The entity being signed (defect closure, delivery receipt, inspection)

5.5 QR/Barcode Scanning
Use cases: Induction sign-off, material scanning, equipment check-out

Offline: Scanned code stored locally; resolved on sync

6. The Sync Contract (App Writes, Server Owns)
Table	Owner	App Writes	Server Stamps
site_diary	APP	draft status, work done, delays, photos	author_id, finalised_at, is_current
site_attendance	APP	check-in/out, person, trade, method	geo_verified
deliveries	APP	docket photo, quantity, supplier	received_by
defects	APP	description, photo, location, trade, severity, status	raised_by, closed_at, closed_by
hazards	APP	description, photo, location, severity	raised_by, closed_at
incidents	APP	type, description, photos, notifiable flag	raised_by, reported_at
inspections	APP	checklist items, pass/fail	inspector_id, completed_at, is_validated
rfi	APP	question, photo, drawing ref	raised_by, response
actions	APP	description, assignee, due date	raised_by, closed_at
permits	APP	upload, type, expiry	uploaded_by
messages	APP	text, photo, recipient	sent_at, sender
7. Open Decisions — ALL RESOLVED
#	Decision	Resolution	Date
1	~~Introduction PIN/QR mechanic~~	Resolved: ordinary account login already established at Self-Registration, not a separate out-of-band PIN — lower friction, consistent with how a "connect" action works elsewhere. Revisit only if proximity fraud at this specific step turns out to be a real, observed problem, not a theoretical one.	2026-07-22
2	~~Job Award's exact signature mechanic~~	Resolved: a lightweight in-app tap (§2.3), explicitly paired with S9.9's deposit transaction as what actually makes acceptance binding. New, genuine open item: whether an in-app tap satisfies what some states' home building contract legislation requires for a validly executed contract — this is a legal question for a solicitor, not a design choice, and must be confirmed before this ships.	2026-07-31
3	Full-screen photo viewer	✅ Resolved: Build it. Tap thumbnail → full-screen, pinch-to-zoom, swipe left/right. **Non-negotiable rule:** Metadata overlay (captured by, timestamp, project, sync status) displayed as a thin semi-transparent bar at the bottom. Tap anywhere on the image to hide/show.	2026-09-03
4	4-state checklist cycle redesign	✅ Resolved: Use **explicit Pass / Fail / N/A buttons**. No tap-to-cycle. Colour-coded (green/amber/grey), ≥48dp targets, one tap = one decision.	2026-09-03
5	Video capture max duration	✅ Resolved: **60 seconds** per clip, with a manual stop. 1080p @ 8‑10 Mbps. Sweet spot between evidence quality and sync manageability.	2026-09-03
6	Voice-to-Text provider	✅ Resolved: Vosk (offline) + Google STT (cloud) — confirmed.	2026-07-22
7	Signature as canvas or typed name?	✅ Resolved: **Canvas signature (finger-drawn).** Typed names are not accepted. Court‑accepted, offline‑capable, takes 2 seconds.	2026-09-03
8	STT voice note storage	✅ Resolved: **Keep the original audio (MP3/AAC, ~64kbps).** The audio is the primary evidence; transcription is assistive. UI shows transcription with a playback button for the original audio.	2026-09-03

**All design decisions in this spec are now locked.** The v2 framework is stable. The remaining blocker to implementation is the missing server schemas (see Section 9, Team Contributions) and final owner sign‑off on the overall v2 rollout.

8. (Reserved for future use)

9. Team Contributions

(Dated, initialled entry per contribution, same convention as xprojman-27–33 —
don't silently overwrite, add below. Re-added 2026-09-03 after a concurrent edit
clobbered the first attempt at this section — same insertion point as another
team's edit, last write won. If you're about to append here, check the file's
current content immediately before saving, not just before you started editing.)

- 2026-09-03, Server Agent (projman2-server-agent): two corrections, checked
  against the actual schema/codebase, not this doc's own claims.

  1. Module #19 (Safety & OHS) "Current" status corrected from "Partial (hazard/
     incident capture exists)" to "Not built" (see §4.19) — grepped fresh: no
     hazards or incidents table exists anywhere in the schema (only prose
     mentions in seed data/comments, same finding xprojman-27 §4 and
     schema-relationship-map.md Appendix A already made on 2026-09-03), and
     app/lib/screens/tabs/safety_tab.dart is still `_stub_tab.dart`-backed per
     App Agent's own xprojman-28 contribution — zero implementation on either
     side of the stack.

  2. Section 6's "Sync Contract" table lists hazards/incidents/rfi/actions/
     permits/messages as if the App↔server sync registry already carries them,
     with defined server-stamped columns — none of these tables exist today.
     `site_diary`/`site_attendance`/`deliveries`/`defects`/`inspections` are real,
     built, sync-registry tables; the other six are this doc's proposed shape for
     tables that don't exist yet. Not asking for the section to be rewritten (the
     column shapes proposed look reasonable as a starting point) — flagging so
     nobody reads this table as "already wired" and starts building an App screen
     against a sync path that would 404. Recommend a footnote distinguishing
     built-and-synced from proposed-not-yet-built, or splitting the table in two.

  No schema built or proposed from this note — same specify-then-build gate as
  everything else in this project; flagging accuracy only, since this doc is
  still 🔴 DRAFT and these six modules would need their own xprojman contract
  (schema + server + App, three-team pass) before any of them are buildable,
  same conclusion xprojman-27/28 already reached for hazards/incidents and
  messages specifically.

  ## 10. Owner Sign-Off

**I approve this document as the functional specification of record for the ProjMan App v2.**

All design decisions in Section 7 are accepted and locked. The App team is cleared to build against this spec once the required Server schemas (identified in Section 9) are in place.

---

## 11. Build status & amendments (2026-10-14)

App Dev (`projman2-app-agent`, session `projman2-ef`), at the Owner's request (routed by the PM, 2026-10-14).
**Sections 0–10 above are LOCKED and have not been edited.** This section does three things:
- §11.1–11.2 record what is actually built, as of commit `78f2f36`. These are facts read from `app/lib`, and
  they supersede the "Current:" lines in §4, which are frozen at 2026-09-03.
- §11.3 lists where this spec and the build differ from the Core Logic Driver
  (`docs/researchPaper/ProjMan_18Stage_Specification_v3.4.pdf`, "v3.4").
- §11.4 sets out the **proposed amendments**. **None of them takes effect until the Owner signs it off in §11.7.**

Key: ✅ wired = real server calls (REST, `/sync/push`+`/sync/pull`, or the `/documents` upload queue) ·
🧪 mockup = in-memory or local-only UI, no server path · ❌ = absent.

### 11.1 Per module / screen

| §4 module | Surface | Spec said (09-03) | Actual (10-14) | Notes |
|---|---|---|---|---|
| 4.1 Site Diary | Site → Site Diary | ✅ | ✅ wired | Text + photos. Voice isn't built (§11.2). |
| — Attendance | Site → Attendance | — | ✅ wired | `check_in_lat/lng` are always null because there's no location package (§11.4 A4). |
| — Deliveries | Site → Deliveries | — | ✅ wired | Docket photos go through the upload queue. Supplier and PO are free text. |
| 4.2 Checklists & ITPs | Quality → Checklists | ⚠️ | ✅ wired, **not yet verified end-to-end** | Server v047 (xprojman-46), commit `adf7a2c`. Explicit Pass/Fail/N/A buttons (§7 #4), photo per item, canvas sign-off. Completion is pushed last. Toolbox talks run as a checklist category. The E2E with Portal is waiting on Owner test accounts. |
| 4.2 Hold points / Inspections | Quality → Inspections | ⚠️ | ✅ wired | Sync, plus `POST …/inspections/:iid/complete`. |
| 4.3 Insurances, 4.4 Tickets, 4.17 Pre-qual | Profile → My Tickets | ❌ | ❌ | Waits on Server's xprojman-49 §7.4 and API.NSW (xprojman-49/52 rulings). |
| 4.5 My Tasks | Projects → My Tasks | ⚠️ | ❌ | The Programme screen is read-only. No task tick. |
| — Programme / Gantt | Projects → Programme | — | ✅ read-only | Bar Gantt. Line-of-Balance is a stub: `_isMultiUnit` is always false, against v3.4 §1.8. The "Programme"/"Costs" header sub-pages exist, but they show the same project list. |
| — Project create (Stage 1), 18-stage tracker | Projects | — | ✅ wired | `POST /customers`, `POST /projects`, stage advance. |
| 4.6 Documents, 4.7 Actions, 4.8 Locations, 4.10 Drawings, 4.12 RFI, 4.16 Messages, 4.20 NCC AI | Projects | ❌/⚠️ | ❌ | No App code and no xprojman contract (the Server note in §9 still applies). |
| 4.9 SDS, 4.18 Emergency Evacuation | Safety | ❌ | ❌ | |
| 4.11 Defects, — Certificates | Quality | ✅ | ✅ wired | |
| — Disputes (v3.4 Part 4 §4.1) | Quality → Disputes | — | 🧪 local-only | It's a SQLite record with no server endpoint. Counter-evidence photos do upload. |
| 4.13 Submittals | Quality | ❌ | ❌ | |
| 4.14 Permits, — Materials | Site | ❌ | ❌ | |
| 4.19 Safety & OHS (hazards, near misses, incidents) | Safety → Safety / Incidents | ❌ | ✅ wired, **not yet verified end-to-end** (`c221878`, `16a6647`) | Server v048 (xprojman-48). Injury details go to a private outbox that's deleted after push (F2). Edits, actions and closing are manager-only. A notifiable incident is read-only on the device. Real photos. |
| 4.19 Inductions + SWMS sign-on | Safety → Inductions | ❌ | ✅ wired, **not yet verified end-to-end** (`43d0b73`, `9912dc7`) | Server v048 (F5/F6). A manager inducts a member or visitor and the inductee signs. Workers see their own status (warn only, never block). SWMS register cached for offline sign-on. Running an induction as a checklist (`checklist_instance_id`) isn't used yet. |
| — Job Invitations (S9.7) | Projects | — | ✅ wired | `trade_offered` shown for subcontractor awards (`5634003`). |
| — Introduction QR, VeriTrade login (§8) | Profile | — | ✅ wired | |
| — Device pairing + QR `typ` dispatch | Welcome → Join with a QR code | — | ✅ (`4d67cec`) | xprojman-50 F4. A `client_invite` QR shows a holding notice until Server's preview/redeem endpoints exist. |
| — Client home + role routing | `/client-home` | — | ✅ minimal (`4ee4d49`) | xprojman-50 F7. Welcome, the builder's name and sign-out only. See §11.3 D1. |
| — S18.11 depreciation draft | — | — | ❌ in App | System/Portal step (v3.4). No App surface needed. |
| — S18.14 client final sign-off | Projects → Stage 18 → Client sign-off | — | ✅ wired, **not yet verified end-to-end** (`e994514`, `78f2f36`) | Server v050. Signature uploads first, then the row is pushed create-only. PACK_CHANGED asks for a new signature (supersedes). All three methods shown with none preselected; **F1 is with the solicitor** (§11.3 D2). Signing is gated on S18.3 being validated. |
| — S18.6 Practical Completion walkthrough, S18.7 defect loop | App (PM) | — | ⚠️ partial | Defects exist. There's no walkthrough flow that generates a defect list. |
| — OS push notifications | — | — | ❌ | Contract is xprojman-54. Needs Firebase/APNs credentials (§11.6). |

### 11.2 Cross-cutting capabilities (§2, §5)

| Capability | Spec | Actual |
|---|---|---|
| Unified `CaptureService` (§2) | One component | ❌ There's no single class. `captureAndEnqueue()` + `DocumentQueueService` cover photos only. |
| Photo (§5.3) | quality 85, max 2560px, <25MB | ✅ As specified. **Offers camera AND gallery** (see A1). |
| Video 60s (§5.3, §7 #5) | Locked | ❌ No video package. |
| Voice + STT, keep audio (§5.2, §7 #6/#8) | Locked | ❌ No audio or speech package (deliberately left out of pubspec for now). |
| Signature canvas (§5.4, §7 #7) | Locked | ✅ Custom finger-drawn pad, uploaded as a `signoff` document. |
| QR scan (§5.5) | | ✅ `mobile_scanner` (pairing, introductions, VeriTrade). Material and induction scanning aren't built. |
| Full-screen viewer with metadata bar (§7 #3) | Locked | ❌ Thumbnails only. |
| GPS / geofence (§2, §0) | "always captured if permission granted" | ❌ No location package. The UI geofence chip is illustrative only (see A4). |
| Offline queue (§1) | | ✅ Per-row `is_dirty` sync + `upload_queue` (idempotent `client_ref`). The generic `sync_queue` table is never written, so the always-visible sync badge only counts uploads. That's a known gap, to be fixed in the App. |
| Hash at capture (§0, v3.4 §1.4) | "frozen/hashed" | ⚠️ The server stamps and freezes. The App doesn't hash at the moment of capture. |
| MQTT realtime | | ❌ Config exists, but no client is wired. |
| Local DB | | v6 |

### 11.3 Divergences from the Core Logic Driver (v3.4)

- **D1. Client in the App.** v3.4 §1.1 says the Client is "portal-only… never paired to the App, never a sync
  writer". The Owner reversed this in xprojman-41 §0.1 (direction signed off on 2026-09-07). xprojman-50 is the
  pairing contract. The App now routes `client` users to a minimal home screen, and the client is still never a
  sync writer. **Ask:** annotate v3.4 §1.1 (or record the reversal next to it) so the Core Logic Driver doesn't
  contradict a signed-off ruling.
- **D2. S18.14 surface.** v3.4 has the Client sign on the **Portal**. xprojman-51 F1(a) proposes, for v1,
  **assisted signing on the PM's tablet in the App**, with the PM as witness, because customers can't log in
  yet. It's still pending with the Owner and is on the solicitor list (§11.5 L5).
- **D3. Gallery uploads.** v3.4 §1.4 says evidence is "captured inside the app only (never a gallery
  upload…)". The App's photo picker offers the gallery on every evidence surface. Proposed fix: A1.
- **D4. Geofencing.** v3.4 §1.4 and §1.7 assume geofenced evidence. The App captures no location at all
  (A4). v3.4 §1.7 also says a geofence is never sufficient on its own, and the tick-then-verify chain is
  the real control. That chain is built for checklists and inspections.
- **D5. Line-of-Balance.** v3.4 §1.8 makes LOB mandatory the first time a project has more than one unit.
  The App only renders the bar Gantt. That's acceptable while every project has one unit, but it becomes a
  blocker as soon as a multi-unit project is created.
- **D6. Part 4 safeguards.**
  - §4.1 disputes: local-only today (no server endpoint).
  - §4.3 "no hidden dossier": the worker can't yet see what Foreperson or Builder see about them.
  - §4.4 deactivation-not-erasure disclosure: there's no delete-account flow in the App.

  v3.4 calls all of these "necessary, not optional, before this ships."

### 11.4 Proposed amendments to locked behaviour (need Owner sign-off)

- **A1. Evidence photos are camera-only.** On evidence surfaces (defects, checklist items, inspections,
  diary, hazards/incidents, attendance), remove the "Choose from gallery" option. Keep gallery or file upload
  only for *documents* (certificates, delivery dockets, permits, insurance), and mark those records
  `source=upload` so the Portal labels them "uploaded, not captured". This aligns §5.3 with v3.4 §1.4.
  *Recommend: approve.*
- **A2. Client role is in scope for the App.** Amend §0/§1 to record D1: the App serves the `client` role
  with a minimal, read-only home screen, never the staff shell and never a sync writer. Its scope grows
  only through xprojman-41/50 follow-ups. *Recommend: approve (it records an existing ruling).*
- **A3. Single capture component is a target, not a gate.** §2 is built incrementally: photo and signature
  now, then video and voice. *Recommend: approve as wording only.*
- **A4. Location: point-of-capture only, never continuous.** Amend §2's "GPS always captured if permission
  granted" to: one fix taken at the moment of an explicit capture, with foreground permission only, never
  background or continuous tracking (v3.4 §4.3 calls this "a hard technical limit"). Until location ships,
  the UI must not show a geofence result. The illustrative chip is removed or reads "Location not
  recorded". *Recommend: approve. Also see L3.*
- **A5. §6 Sync contract split.**
  - Built and synced: `site_diary`, `site_attendance`, `deliveries`, `defects`, `inspections`,
    `checklist_instances`/items/`signoffs` (v047).
  - Proposed, not built: `hazards`, `incidents`, `rfi`, `actions`, `permits`, `messages`.

  This is what Server asked for in §9. *Recommend: approve as wording only.*
- **A6. §3 navigation reflects the build.**
  - Quality gains **Disputes** (v3.4 §4.1).
  - Projects shows Programme as a read-only Gantt.
  - Any tab not yet built stays off the header, rather than showing placeholder pages. (Projects'
    "Costs" today shows the project list.)

  *Recommend: approve.*

### 11.5 Legal risks (for the PM, then the Owner and solicitor)

- **L1. In-app tap as contract acceptance (S9.7 Job Award).** §7 #2 and v3.4 Part 3 #10 already flag this:
  whether a tap satisfies state home-building-contract execution rules. It's built and wired. **It should be
  confirmed before real use.**
- **L2. Audio/video recording of people.** Voice and video (§5.2/5.3) are locked but not built. The state
  surveillance/listening-devices acts need confirmation (v3.4 Part 3) **before** they're built. Note too that
  iOS has no microphone usage string today.
- **L3. Location.** No location is collected today. If A4 ships, it needs a privacy notice and APP 5
  collection notice, and the copy must not claim geofencing before it exists. Product's xprojman-53 audit
  already corrected the site copy.
- **L4. Privacy Act / APPs.**
  - The App has **no privacy policy link, no terms acceptance and no collection notice** at register or
    onboarding.
  - Photos of people on site, worker attendance and the dispute and verification records are personal
    information.
  - Retention: the indefinite as-built class (v3.4 §1.11) versus pruning of granular capture (v3.4 §4.3).
  - Account deletion is deactivation, not erasure (v3.4 §4.4), so it must be disclosed at the point of
    deletion.
- **L5. Client sign-off on the PM's tablet (xprojman-51 F1(a)).** The PM witnesses and hands over the
  device. Questions: is it valid execution, could it be seen as undue influence or a non-independent
  signature, and is the evidence strong enough compared with Portal self-sign? It's on the solicitor list.
- **L6. Minors.** TAFE/school apprentices (v3.4 §1.7, Part 3) can be aged 15–16. The adult registration flow
  has no age gate or parental consent. **Don't onboard minors until there's a dedicated design.**
- **L7. Evidence weight.** Gallery uploads (D3/A1) and the lack of a capture-time hash (§11.2) weaken the
  "evidence, not claim" position v3.4 §1.4 relies on in disputes.

### 11.6 Blocking items

| Blocker | Blocks | Owner of the fix |
|---|---|---|
| Test accounts (Portal PM, App field user, org/project) | Checklist E2E (xprojman-46) | Owner |
| Ruling on xprojman-51 F1 + Server's response to F2–F4 | S18.14 build | Owner, Server |
| Server `/client-invites/preview`, `/redeem`, `/email-code`; `typ:"device_pair"` on new staff QRs | Customer invite flow (xprojman-50) | Server |
| ~~Server v048 (Safety) + TZ fix~~ | ✅ Landed 2026-10-14; the App's swap is done | — |
| Server xprojman-49 §7.4 + API.NSW | My Tickets | Server, Owner (API.NSW access) |
| Server re-seed of the v047 system templates with Product's copy (7fe2c69) | Real checklist wording | Server |
| Firebase `projman-f4bca` FCM + APNs key; Apple Developer / Google Play accounts (the App is on neither store) | Push (xprojman-54), any external install | Owner |
| Microsoft / Facebook OAuth app registrations | Those sign-in buttons in production (only Google is real) | Owner |
| Support contact for `ACCOUNT_EXISTS` | Customer invite errors | Product / Owner |
| **Android release manifest has no INTERNET permission** (only debug/profile do) | Any Android release build reaching the API | ✅ Fixed in `21748a7` (2026-10-14) |
| Solicitor items L1, L2, L5 | Shipping Job Award tap, voice/video, assisted sign-off | Owner |

### 11.7 Owner sign-off on amendments

_(A1–A6 above. Mark each approved or declined, with a date. Until then the locked §0–§10 text governs.)_

**Scope ruling (Owner, 2026-10-14, relayed by the PM):** ProjMan is project management.
- Accounting and invoicing go through QuickBooks, Xero, MYOB or MAVEN.
- Staff rosters and job attendance for pay belong to MAVEN + AURA.
- **The App adds no invoicing or pay-related features.**
- Site sign-on attendance (§11.1) stays a WHS/project record, not a pay record. The PM is confirming the exact
  boundary with the Owner.

No integration with AURA (personal app) or MAVEN (business app) from the Nexus project is built. The PM is
talking to the Nexus PM first.

— App Dev (`projman2-app-agent`), 2026-10-14
