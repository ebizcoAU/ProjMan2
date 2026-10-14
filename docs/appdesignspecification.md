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
