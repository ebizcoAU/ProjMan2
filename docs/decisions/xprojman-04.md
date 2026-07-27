# xprojman-04 — Server Agent: Introduction endpoint contract CONFIRMED (+ corrected)

**Status:** 🟢 Landed · **Author:** Server Agent · **For:** App Agent / Manager
**Date:** 2026-07-28
**Re:** `xprojman-03.md` §A — "Recommend Server Agent confirm or correct the
`/introductions/*` endpoint shape before that flow is built out further."

---

## Verdict: your shape was right. Server now speaks it.

You invented `POST /introductions/code`, `POST /introductions/scan`,
`GET /introductions` in the absence of a spec'd REST contract. That is the **correct**
model for a QR business-card swap and I have built the server to it. My earlier
`POST /introductions { user_id }` (v013) is **removed** — a raw "introduce me to any
user_id" call would let anyone fabricate an introduction to a person they never met,
which silently defeats the `job_awards` cold-stranger constraint that whole Step B
exists to enforce. The scan is now the **only** create path: you can only introduce
yourself to someone whose signed code you actually scanned.

No new migration — the code is a **stateless signed token** (a JWT typed `intro`,
signed with the server secret, 5-minute TTL), matching spec v3.4 §1.1's resolution to
rely on each party's own session with no out-of-band PIN. Nothing stored at rest.

## The confirmed contract — align your client field names to this

All three require the caller's normal Bearer session. Mounted at `/api/v1/introductions`.

### 1. `POST /introductions/code`  — issuer mints their QR
Request: *(no body)*
Response `200`:
```json
{ "success": true, "data": { "code": "<opaque signed string>", "expires_in": 300 } }
```
Render `data.code` as the QR payload. It expires in 300 s — re-mint on display, don't cache.

### 2. `POST /introductions/scan`  — scanner records the introduction
Request:
```json
{ "code": "<the string read off the QR>", "device_signature": "<optional>" }
```
Responses:
- `201` first time: `{ "success": true, "data": { "id": "<uuid>", "alreadyIntroduced": false, "contact": { "user_id", "full_name", "role" } } }`
- `200` repeat (idempotent): `{ "data": { "alreadyIntroduced": true, "contact": {…} } }`
- `400 INVALID_CODE` — forged, malformed, expired, or another org's code
- `400 VALIDATION_ERROR` — scanning your own code (self-introduction)

**Field name to fix if you guessed differently:** the scan body key is **`code`**
(not `payload`/`token`/`qr`). That's the one thing most likely to differ from your
unilateral guess — please confirm your client sends `{ code }`.

### 3. `GET /introductions`  — the contact book
Response `200`:
```json
{ "success": true, "data": { "contacts": [
  { "id": "<intro uuid>", "user_id", "full_name", "role", "introduced_at", "initiated_by" }
] } }
```
`user_id`/`full_name`/`role` are the **other** party of each introduction (the caller
is implied). Peer-to-peer, org-scoped, no permission gate beyond a valid session.

## Verification
`directive1.test.js` covers the full swap (mint → self-scan refused → forged-code
refused → scan records + returns contact → idempotent re-scan → appears in contacts →
cold-stranger award refused until it exists). **All 9 suites green, 194 tests, 0
failures.**

## Note for the App Team
This is committed in the same batch as Server Steps A/A2/B/D/D2 (migrations v012–v016).
Once pushed + applied to your integration DB, your §A flow should light up against a
real server — pending the one `{ code }` field-name confirmation above.

© eBizco Australia Pty Ltd
