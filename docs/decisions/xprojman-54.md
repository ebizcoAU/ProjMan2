# xprojman-54 — OS push notifications (FCM + APNs) and the in-app MQTT fallback

**Status:** 🟡 DRAFT: spec only. There are **seven forks (§3), each with a recommendation**.
- Needs Server's response, then PM and SA sign-off.
- **§6 lists what the Owner has to supply.** Nothing can be built without it.
- Server owns the table shape and the migration number.

**Author:** App Dev (`projman2-app-agent`, session `projman2-81`).
**For:** Server (`projman2-a2`), PM (`projman2-82`), SA.
**Date:** 2026-09-30.
**Why:** SA-approved backlog item, routed by the PM on 2026-09-30. It comes from my xprojman-48 §8 finding that
the app **has no way to receive any alert**:
- `mqtt_client` is in `pubspec.yaml`, but nothing in `lib/` connects or subscribes.
- There is no FCM or APNs.

The v1 notifiable-incident alert became email because of this (xprojman-48 §8, Server).
**Credential order:** roles §8 #11 puts "Apple ID/Firebase (with the Safety build)" last.

**What exists today** (checked 2026-09-30):
- **Firebase project `projman-f4bca`** is already provisioned. The app uses it for Google Sign-In
  (`GoogleService-Info.plist`, `google-services.json`, bundle `au.com.ebizco.projman2`). Both files are
  untracked by design (commit 629291d).
- The iOS signing team in Xcode is `QWRPRU9SE5`.
- **Server MQTT** (`server/api/src/mqtt/client.js`) is **signalling only, by design**. Payloads are thin
  `{table, action, id}` nudges meaning "go pull now". The topic is **org-wide**:
  `projman2/{orgId}/sync/nudge`. The only caller is `SyncService.pushRecord`. The production broker is
  eBizco's *shared* broker (MQTTS). ProjMan2 is a client only and must never touch it.
- **`devices`** (v001) has `user_id NULL` for a *shared site tablet*, plus `platform` and `status`
  (`active`/`revoked`/`suspended`). Sessions (`auth.js`) are per device and can be revoked.

---

## 1. Principles (not forks)

1. **An inbox is the source of truth, and push is only a nudge.** This is the same posture as the
   existing MQTT design. Every notification is first a row the user can list with REST. Push and MQTT
   only say "there's something new". A push that doesn't arrive loses nothing. The app finds the item
   the next time it opens.
2. **No sensitive content on a lock screen or in a payload.** Push text is visible on a locked phone.
   MQTT payloads on a shared broker must be treated as readable by any connected client. So payloads
   carry **no** names, injury details or money: a notification id and a short generic title only. For
   a notifiable incident that is "Notifiable safety incident on {project name}", **never** anything
   from `incident_details` (xprojman-48 F2). The detail is fetched with the user's own session.
3. **Email stays for the legal-weight event.** The xprojman-48 F3 notifiable-incident email to the PM
   and Site Supervisor stays even once push exists. Push is on top of it, not instead of it.

## 2. Phases → Inputs → Outputs → Parameters

| # | Phase | Actor | Inputs | Outputs |
|---|---|---|---|---|
| 1 | **Ask permission** | App | a moment that makes sense (§3 F5) | OS permission granted or denied |
| 2 | **Register** | App → Server | the FCM token, platform, app version, with the current session | a `push_tokens` row bound to **the session's user + device** |
| 3 | **Refresh** | App | FCM `onTokenRefresh`, or the app starting with a changed token | the row updated. The old token is dropped. |
| 4 | **Event** | Server | a domain event (§4) | a `notifications` inbox row per recipient → an FCM send to each recipient's active tokens → an MQTT nudge on the recipient's topic |
| 5 | **Receive** | App | an OS push (app closed or in the background) or an MQTT nudge (app open) | an OS banner, or an in-app banner. A tap deep-links to the entity after `GET /notifications/:id`. |
| 6 | **Revoke** | App / Server | sign-out; session or device revoked; user deactivated; FCM says the token is invalid | the row removed. No further pushes to that token. |

## 3. Forks

**F1: FCM for both platforms, or APNs directly for iOS?**
- (a) ★ **FCM for Android and iOS.** FCM relays to APNs using an APNs key uploaded to the Firebase
  project. That's one server integration (FCM HTTP v1) and one app plugin (`firebase_messaging`). The
  Firebase project already exists.
- (b) FCM for Android plus APNs directly for iOS. Two integrations and two failure modes, and no gain
  at our volume.
- **Recommend (a).**

**F2: what is the token bound to?**
- (a) ★ **The session: user + device.** A token row is `(user_id, device_id, token)` and is created
  under a live session. **Sign-out deletes it.** On a *shared site tablet* (`devices.user_id NULL`),
  whoever is signed in receives the pushes, and the next person to sign in doesn't get the previous
  person's notifications.
- (b) A column on `devices`. That's wrong for shared tablets, and it outlives sign-out.
- **Recommend (a).** Server: when a session is revoked, a device is revoked or suspended, or a user
  is deactivated, delete the matching token rows in the same transaction. Otherwise a revoked phone
  still gets lock-screen alerts.

**F3: the inbox table.**
- ★ **`notifications`** (Server owns the final shape): `id`, `org_id`, `user_id` (the recipient),
  `type` (enum, §4), `project_id` NULL, `entity_type` / `entity_id` (for the deep link), `title`
  (short and generic, lock-screen safe), `created_at`, `read_at` NULL.
- REST: `GET /notifications?unread=1`, `GET /notifications/:id`, `POST /notifications/:id/read`,
  `POST /notifications/read-all`.
- It is **not synced** over `/sync`. It's a per-user inbox with no offline write path, so REST is
  enough.
- The v1 retention is 90 days. The inbox is not evidence: the evidence is the domain row itself,
  such as the `safety_events` row.

**F4: the MQTT fallback while the app is open. Which topic?**
- Today's only topic is **org-wide**. Using it for per-user alerts would wake every device in the org,
  and it tells everyone that *someone* got an alert.
- (a) ★ **A per-user nudge topic:** `projman2/{orgId}/user/{userId}/notify`, with the payload
  `{notification_id, type, ts}` (no title, no content). The app subscribes to its own user topic and
  the existing `sync/nudge` while it's in the foreground, and fetches `GET /notifications/:id` on a
  nudge.
- (b) Reuse `sync/nudge` with a `notifications` table name. That wakes the whole org.
- **Recommend (a).** Broker ACLs on the shared broker aren't ours to change, which is why the payload
  carries nothing sensitive (§1.2). Server/Owner: confirm what credentials the app uses on the
  production broker (`build_config.dart` says "auth required") and whether per-client topic ACLs exist.
  If they don't, (a) is still safe **because of** §1.2.
- **Duplicates:** when the app is in the foreground, FCM also delivers the message to the app, not as
  a banner. The app de-duplicates on `notification_id` and shows one in-app banner.

**F5: when to ask for OS permission.**
- Recommend: **not on first launch.** Ask at the first moment it's obviously useful:
  - after the first successful sign-in for roles that receive time-critical events (PM, Site
    Supervisor, Inspector, Builder);
  - when a Tradie first sees the Job Award inbox.
- iOS gives one system prompt. If the user declines, the app shows a settings hint later but doesn't
  nag.
- Android 13+ needs the runtime `POST_NOTIFICATIONS` permission, requested at the same moments.
- **If permission is denied**, the inbox and the MQTT fallback still work, just not while the app is
  closed.

**F6: user preferences in v1?**
- Recommend: **no in-app preferences in v1.** The OS-level switch is the control.
- Exception: the **notifiable incident cannot be muted in-app**, and it stays on email regardless
  (§1.3).
- Per-type muting and quiet hours are v2.

**F7: failures, and what Server does with FCM's answers.**
- FCM `UNREGISTERED` / `INVALID_ARGUMENT` for a token: delete the row.
- Quota or a transient error: retry with backoff (1 min, 10 min), then give up. The inbox row
  already exists, so nothing is lost.
- Sends are **asynchronous** and never block or fail the domain write that triggered them. That's the
  same fire-and-forget posture as `mqtt/client.js`.
- `push_send_log` (optional): `notification_id`, `token_id`, outcome, `at`. No payload.

## 4. Events in v1 (starting set)

| `type` | Trigger (server-side) | Recipients | Lock-screen title (generic) |
|---|---|---|---|
| `safety_notifiable` | `safety_events.is_notifiable` set (xprojman-48 F3), from the report or a confirm | the project's PM and Site Supervisor (the same people as the F3 email) | "Notifiable safety incident on {project}" |
| `job_award_invite` | `JobAwardService.create` | `to_user_id` | "New job invitation from {org}" |
| `job_award_response` | `JobAwardService.respond` (accepted or declined) | `from_user_id` | "Job invitation {accepted/declined}" |
| `hold_point_result` | `InspectionService.complete` on a hold-point inspection (pass or fail) | the project's PM, Site Supervisor and Builder | "Hold point {passed/failed} on {project}" |

- **Recipients are resolved at send time** from project membership and roles. They're never taken
  from the client.
- **Candidates for later** (not v1): checklist failed (xprojman-46), a defect assigned to me, a
  hazard rated high, client sign-off received (xprojman-51), and the licence result (xprojman-49).

## 5. Who builds what (after sign-off and §6)

- **Server:**
  - The `push_tokens` and `notifications` tables.
  - Register, refresh and delete routes: `PUT /push-tokens` (upsert for the session's user and
    device) and `DELETE /push-tokens/current`.
  - The inbox REST routes (F3).
  - `NotificationService.notify(type, recipients, entity)`: insert the inbox rows, send FCM
    (HTTP v1, a service account), publish the MQTT nudge.
  - The four §4 hooks.
  - Token clean-up on session, device or user revocation (F2).
  - The FCM failure handling (F7).
- **App:**
  - `firebase_messaging` (plus `flutter_local_notifications` for foreground banners).
  - The permission moments (F5).
  - Token register, refresh and delete, including on sign-out.
  - An MQTT client (`mqtt_client`, already a dependency) that subscribes while the app is in the
    foreground, with the de-dup.
  - An inbox screen (a bell on the home header) and deep-link routing per `entity_type`.
  - The iOS setup: the Push Notifications capability, Background Modes → remote notifications.
- **Portal:** nothing in v1. Web push is out of scope.

## 6. What the Owner must supply (credentials; roles §4, Owner-only)

1. **A paid Apple Developer Program membership** for team `QWRPRU9SE5`, or the org's team if
   different. **Push doesn't work with a free personal team.** Please confirm which one the current
   signing team is.
2. **An APNs Auth Key** (`.p8`) created in the Apple Developer portal, with its **Key ID** and the
   **Team ID**, **uploaded to Firebase project `projman-f4bca`** (Project settings → Cloud Messaging
   → Apple app configuration).
3. **Enable Push Notifications** on the App ID `au.com.ebizco.projman2` in the Apple portal.
4. **A Firebase service-account key** (JSON) with permission to send FCM, delivered to the server
   environment only. It is never committed and never in any frontend (the same rule as xprojman-49 R6).
5. **Confirm the production MQTT credentials** the app should use on eBizco's shared broker, and
   whether per-topic ACLs exist (F4).
6. **Android:** nothing beyond the existing `google-services.json`, assuming it belongs to the same
   Firebase project.

## 7. Out of scope
- Web push for Portal and VeriTrade.
- SMS alerts.
- Marketing notifications.
- Per-type preferences and quiet hours (F6, v2).
- Notification digests.

## 8. Responses
_(dated, initialled; don't overwrite. Server: F2, F3, F4, F7, §4 hooks, §5 routes. PM: routing §6 to the Owner.)_

© eBizco Australia Pty Ltd — xprojman-54.md, 2026-09-30
