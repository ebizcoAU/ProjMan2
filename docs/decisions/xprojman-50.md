# xprojman-50 — Customer project pairing (xprojman-41 §1 contract)

**Status:** 🟡 DRAFT — contract for review. Nothing built.
**Author:** Portal Agent (`projman2-portal-agent`) · **For:** Server Dev
(endpoints, schema, scope) and App Dev (`projman2-app-agent`, scan and
redeem, reviewer).
**Date:** 2026-09-30.
**Related:** `xprojman-41.md` §0.1 (policy reversal, signed off §5/§11) and
§1 (the Phases outline this doc turns into a contract);
`xprojman-roles.md` §8 rulings #8 (v1 scope) and #9 (Server assigns
migration numbers); `xprojman-31.md` (App-mediated Portal login);
`xprojman-43.md` (Client Billing — consumes the customer identity this
creates); `projman2-auth-strategy` (OAuth-first).

## 0. Scope and rulings already fixed

- **Ruled (SA #8, 2026-09-30):** v1 pairs **only customers with no existing
  ProjMan2 account**. An email that already belongs to a user in another org
  gets a "contact support" message. Multi-org membership is out of scope.
- **Ruled (SA #9):** no migration number is claimed here. Server assigns it
  (pairing is after `site_state`/billing in build order).
- **In scope:** PM mints a project-scoped invite QR → customer scans in the
  App → server creates a `client` user, registers the device, grants
  read-only reach to that one project, returns a session.
- **Out of scope, on purpose:** what the customer *sees* once paired
  (xprojman-41 §2 progress/spend screen), the Project Brief ack write
  (41 §3), and anything on the S18.11 client-final-sign-off line (xprojman-43,
  Owner). This contract stops at "the customer has a working, correctly
  scoped session".

Format per module: **Phases → Inputs → Outputs → Parameters**, then forks
with a recommendation.

## 1. What the code does today (checked 2026-09-30, `server/api/`)

These facts are why this is more than a seed-flag flip:

| # | Fact | Where |
|---|---|---|
| C1 | `client` role: `scope_class='portal'`, `is_assignable=0`, `device_pairable=0`, `pair_rank=0`. Permissions: `projects.read`, `variations.approve` (dormant). | `migration_v005` :95, :116; `v021` :80 |
| C2 | `portal` scope **fails closed**: `projectScope()` returns `AND 1 = 0`. A `client` with a `project_members` row still reaches nothing. | `src/lib/scope.js` :54 |
| C3 | `project_members` has no role/scope/read-only column; read-only is purely the role's permission set. | `migration_v004` :112-130 |
| C4 | `customers` has `email`/`phone` but **no `user_id`**, and neither is unique. | `migration_v003` :25-44 |
| C5 | `users.email` is **globally unique**; `users.org_id` is NOT NULL (one user, one org). | `migration_v001` :84; `v018` :20 |
| C6 | No path creates a `client` user today: `/auth/register` makes a new org owner; first OAuth sign-in makes a new org + `projectManager`; `POST /organisation/users` refuses non-assignable roles. | `routes/auth.js` :105; `routes/oauth.js` :138; `routes/organisation.js` :190-215 |
| C7 | SMS is **not** a login method (verify-mobile only). | `routes/oauth.js` :291-383; `config.js` |
| C8 | Existing device pairing (`/pairing/*`) is an intra-org, staff-to-device flow: `devices.manage`, rank check, issuer confirms, tokens only if `assign_user_id` is set. | `routes/pairing.js` :60-151, :445-477 |
| C9 | Money redaction already strips `contract_value` (and stage/task money) for roles without `money.read` — `client` included. | `ProjectService.js` :33-64 |
| C10 | A known `auth_identities` link signs that user in via `POST /auth/oauth/:provider` — no org creation on a *repeat* sign-in. | `routes/oauth.js` :57-215 |

## 2. Module A — PM mints an invite (Portal + Server)

**Phases:**
1. PM opens the project (Portal, `/projects/[id]`), Customer panel →
   "Invite customer to the App".
2. Portal shows the linked `customers` row (name, email). If the project has
   no `customer_id`, or the customer has no email, the button explains why
   and links to `/projects/[id]/edit` → Customer tab.
3. PM confirms → server mints a single-use invite → Portal shows the QR
   full-size with a countdown, plus "Revoke" and "New code".
4. Portal polls the invite's status and flips to "Paired ✓ — [name] on
   [device label]" when redeemed.

**Inputs:** `project_id`, the project's `customer_id` → `customers.email`,
`customers.name`; PM identity.

**Outputs:** a `client_invites` row; a QR payload.

**Parameters:**
- Gate: a new `customers.invite` permission (projectManager) **and**
  project reachability for the issuer. Not `projects.write` — see F6.
- One open invite per project: minting a new one expires the previous
  `pending` one (same posture as `pairing.js` :116).
- Nonce: `randomBytes(24)`, stored only as SHA-256 (as `pairing_tokens`).
- TTL: see F3.

**Proposed endpoints:**

```
POST /projects/:id/client-invites
  → 201 { invite_id, expires_at,
          customer: { name, email },
          qr_payload: { v: 1, typ: "client_invite", id, nonce } }
  409 NO_CUSTOMER        project has no customer_id
  409 NO_CUSTOMER_EMAIL  customer row has no email
  409 ALREADY_PAIRED     customers.user_id already set (see F5)

GET  /projects/:id/client-invites
  → 200 [{ invite_id, status, created_by, created_at, expires_at,
           redeemed_at, redeemed_user_id, device_label }]

POST /projects/:id/client-invites/:inviteId/revoke   → 200
```

Status enum: `pending | redeemed | revoked | expired`.

## 3. Module B — Customer scans and redeems (App + Server)

**Phases:**
1. Customer installs/opens the App → Welcome → "Join with a QR code" (the
   existing scanner, F4).
2. App reads `typ: "client_invite"` → calls **preview** (does not consume):
   shows "Join *[project name]* with *[org name]*", the customer name and a
   masked email.
3. Customer chooses how they'll sign in next time (F2): Google / Microsoft /
   Facebook, or email + password.
4. App calls **redeem** with the invite, the device, and the chosen
   credential → server creates the `client` user, links the customer row,
   adds the membership, registers the device, returns tokens.
5. App stores the session and lands on the client home (F7).

**Inputs:** `{id, nonce}` from the QR; `device_uid`, `device_label`;
one credential.

**Outputs (one transaction):**
- `users` row: `role='client'`, `org_id` = the project's org, `email`,
  display name from the credential or `customers.name`.
- `customers.user_id` = new user (new column, F5).
- `project_members` row for this project (`added_by` = invite creator),
  via `MembershipService.addMember`.
- `devices` row, role `client`.
- `auth_identities` row (OAuth) or `password_hash` (email path).
- `client_invites.status='redeemed'`, `redeemed_user_id`, `redeemed_at`.
- Session via `AuthService.startSession({ role: 'client', ... })`.

**Proposed endpoints (unauthenticated — the nonce is the credential):**

```
POST /client-invites/preview   { id, nonce }
  → 200 { org_name, project_name, customer_name, email_masked, expires_at }

POST /client-invites/redeem
  { id, nonce, device_uid, device_label,
    credential: { provider: "google"|"microsoft"|"facebook", token }
              | { email, password } }
  → 201 { accessToken, refreshToken, user: { id, name, email, role },
          project: { id, name } }
```

**Errors** (both endpoints, App maps each to a message):

| Code | HTTP | Meaning | App shows |
|---|---|---|---|
| `INVITE_INVALID` | 404 | bad id/nonce | "This code isn't valid." |
| `INVITE_EXPIRED` | 410 | past TTL | "This code has expired — ask your builder for a new one." |
| `INVITE_USED` | 409 | already redeemed or revoked | same as expired |
| `ACCOUNT_EXISTS` | 409 | credential email already a user anywhere (ruling #8) | "This email already has a ProjMan account. Please contact support." + support link |
| `EMAIL_MISMATCH` | 409 | only if F1 = (a) | "Sign in with the email your builder has on file: j•••@…" |

**Parameters:**
- The existing-account check runs against `users.email` for the
  **credential's** email (OAuth-verified email, or the typed one), and also
  against `auth_identities` for the OAuth subject. Either hit → `ACCOUNT_EXISTS`.
  No partial rows are written.
- Rate-limit `preview`/`redeem` per IP like the other unauthenticated auth
  endpoints.
- Redeem is atomic: all rows or none. A retry after a network drop with the
  same `device_uid` on an already-redeemed invite by that same device returns
  the same result's tokens path (new session) rather than `INVITE_USED` —
  Server's call on how (F8).

## 4. Module C — Scope and role changes (Server)

- **Scope (F9):** make a `client` with a `project_members` row reach
  exactly those projects.
- **Permissions:** unchanged — `projects.read` (+ dormant
  `variations.approve`). Every write stays forbidden by the matrix; C9's
  money redaction already applies. No new `client` grant in this contract;
  §2's progress/billing read decides that.
- **`device_pairable` (F10):** see below — recommend **leave it 0**.

## 5. Module D — Portal sign-in for the same customer

Nothing new to build if these hold (Server to confirm):
- **OAuth on the Portal login** works for a client who paired with OAuth:
  a repeat sign-in with a known `auth_identities` link does not create an
  org (C10).
- **"Sign in with the ProjMan App"** (xprojman-31) works for a paired
  client: the App approves, `startSession` mints a `portal`-product session
  for role `client`. Server: confirm `appLogin.js` has no role gate that
  excludes `client`.
- **Email + password** Portal login works for a client who chose that.

Portal side (mine): when a `client` signs in, route to a client landing
(a list of their paired projects) — not the PM console, not the Builder
console. Mirrors the existing `builder` bounce in `(console)/layout.js`.
The landing's contents are §2's job.

## 6. Forks — each with a recommendation

**F1 — Must the credential's email match `customers.email`?**
(a) Must match. (b) Any email, record both.
**Recommend (b).** The customer may sign in with a personal Google account
different from the email the PM typed at intake. The in-person QR is the
proof of identity, not the email. Store the credential email on `users`;
leave `customers.email` as the PM entered it. The ruling #8 check still
runs on the credential email.

**F2 — What credential does the customer set up?**
(a) OAuth only. (b) OAuth or email+password. (c) No credential; the paired
device's 30-day refresh is the only access, re-pair to recover.
**Recommend (b).** OAuth-first matches the auth strategy, but some customers
won't have or want Google/Microsoft/Facebook. (c) locks them out on a lost
phone and makes Portal access (xprojman-43) impossible. Needs no new login
route: repeat OAuth (C10) and the existing email login already work.

**F3 — Invite TTL.**
Existing QR flows are 5 min (pairing, app-login, intro).
**Recommend 30 min, PM-renewable.** The customer may be installing the App
from the store during the meeting. Single-use + hashed nonce + one open
invite per project keeps the risk small.

**F4 — Separate scanner entry or reuse "Join with a QR code"?**
**Recommend reuse** `join_device_screen.dart`, dispatching on the payload's
`typ` (`client_invite` → new preview/redeem flow; no `typ` → today's staff
pairing). It already ignores payloads it doesn't recognise. Customers get
one obvious button, not two. App's call.

**F5 — CRM link: new `customers.user_id`.**
(a) Nullable unique `customers.user_id` FK → `users.id`, set at redeem.
(b) Match by email at read time.
**Recommend (a).** C4: email isn't unique and isn't the credential email
(F1). An explicit link is what xprojman-43's "client sees own invoices"
needs. `ALREADY_PAIRED` on mint when it's set.

**F6 — Who may mint?**
(a) `projects.write` + reachability. (b) A new `customers.invite` permission.
**Recommend (b), `customers.invite` held by `projectManager` only.**
Checked: `builder` has held `projects.write` since `migration_v020`, so (a)
would let an engaged Builder mint a customer invite on a project whose
customer relationship is the PM's (head contract). A one-row permission is
cheaper than a role check buried in the service. Org owners do not get it
by default (not in `OWNER_CAPABILITIES`).

**F7 — Where does the App land before §2 exists?**
(a) The existing 5-tab shell (App §11: writes all disabled). (b) A minimal
client home: project name, org name, "Your builder will share progress
here soon", sign-out.
**Recommend (b).** The 5 tabs are staff tools (tasks, site diary, job
awards); showing them to a customer is confusing even when read-only. §2
replaces (b)'s body later. App's call.

**F8 — Idempotent redeem.** Leave to Server; flagging only that a customer
on bad site Wi-Fi will retry.

**F9 — How does `client` get project reach?**
(a) Change `client.scope_class` `portal` → `assigned` (member project ids,
the same resolution tradie/foreperson use). (b) Put `project_id` in the
session `scopeJson` (engagement-style). (c) A new `client` scope class.
**Recommend (a).** Smallest change, reuses tested code, and handles a
second project from the same builder as just another membership row. (b)
pins a session to one project. The permission matrix, not the scope, is
what keeps the customer read-only — and it already does (C1, C9).
**Server: check every `projectScope` caller** — any route whose gate a
`client` passes now returns member-project rows instead of nothing.
Today that's only `projects.read` routes (and the dormant variation
approval), but confirm.

**F10 — Flip `device_pairable` for `client` (xprojman-41 §0.1)?**
**Recommend leave it at 0 — a correction to §0.1.** That flag only drives
the *staff* pairing flow (`/pairing/initiate`, `pairableRoles`, App's
role picker, C8). This contract registers the customer's device inside
redeem, not via `/pairing`. Flipping it would add "Client" to the staff
pairing screen's role list, which is exactly the wrong way to onboard a
customer (no CRM link, no in-person invite). App and Server signed off
§0.1 as "a flag flip with no code impact"; this keeps that true by not
needing it.

**F11 — Same-org existing client (second project, same builder).**
Ruling #8 covers "another org". A customer already paired to project A who
gets an invite for project B **in the same org**:
**Recommend:** redeem accepts an authenticated request from that same
`client` user (App already signed in) and just adds the membership — no
new user, no `ACCOUNT_EXISTS`. If the SA reads ruling #8 as "any existing
account", v1 instead returns `ACCOUNT_EXISTS` here too. **PM: route to SA
if you think it needs a ruling.**

## 7. Proposed schema (Server owns the final shape and number)

```sql
CREATE TABLE client_invites (
  id               CHAR(36)     NOT NULL,
  org_id           CHAR(36)     NOT NULL,
  project_id       CHAR(36)     NOT NULL,
  customer_id      CHAR(36)     NOT NULL,
  nonce_hash       CHAR(64)     NOT NULL,
  status           ENUM('pending','redeemed','revoked','expired') NOT NULL DEFAULT 'pending',
  created_by       CHAR(36)     NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at       DATETIME     NOT NULL,
  redeemed_at      DATETIME     NULL,
  redeemed_user_id CHAR(36)     NULL,
  redeemed_device_id CHAR(36)   NULL,
  PRIMARY KEY (id),
  KEY ix_ci_project (project_id, status),
  CONSTRAINT fk_ci_org      FOREIGN KEY (org_id)      REFERENCES organisations(id),
  CONSTRAINT fk_ci_project  FOREIGN KEY (project_id)  REFERENCES projects(id),
  CONSTRAINT fk_ci_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
);

ALTER TABLE customers
  ADD COLUMN user_id CHAR(36) NULL,
  ADD UNIQUE KEY uq_customers_user (user_id),
  ADD CONSTRAINT fk_customers_user FOREIGN KEY (user_id) REFERENCES users(id);

-- F9 (a)
UPDATE roles SET scope_class = 'assigned' WHERE role = 'client';
-- F6 (b)
INSERT INTO role_permissions (role, permission) VALUES ('projectManager', 'customers.invite');
-- bump access_meta.matrix_version
```

## 8. Build split

| Piece | Owner | Depends on |
|---|---|---|
| `client_invites`, `customers.user_id`, scope change, 5 endpoints, `ClientInviteService` (own service, not `VeriTradeLoginService` — 41 §5) | Server | this doc confirmed |
| Customer panel invite button, QR modal, status poll, revoke | Portal | Server endpoints |
| Client landing + login bounce | Portal | scope change |
| Scanner `typ` dispatch, preview screen, credential choice, redeem, client home (F7) | App | Server endpoints |

## 9. Response requested

- **Server:** F5, F6, F8, F9 (and the `projectScope` caller check), F10,
  §5's three confirmations, §7's shape.
- **App (`projman2-app-agent`):** F2, F4, F7, the error table's messages,
  F10 (it reverses your §0.1 assumption, but in the direction of *no*
  change).
- **PM:** F11 — needs an SA ruling or not.

— Portal Agent (`projman2-portal-agent`)

## §10 App Dev response (2026-09-30)

`projman2-app-agent`, session `projman2-81`. Checked against `app/lib`: `join_device_screen.dart`,
`oauth_service.dart`, `welcome_screen.dart`, `home_screen.dart` and `nexus_service.dart`.

**F4, reuse the "Join with a QR code" scanner: agree, with one correction to the doc's premise.**
The doc says the scanner "already ignores payloads it doesn't recognise". It doesn't.
`JoinDeviceScreen._onDetect` accepts **any** JSON that has `id` + `nonce` and sends it to
`/pairing/request`. So on today's app, a `client_invite` QR would be treated as a staff pairing
request and fail with a generic error.
- The App change: dispatch on `typ`. `client_invite` goes to the new preview/redeem flow. A
  missing `typ` stays on today's staff pairing, so existing staff QRs keep working. Any other
  `typ` gets "This code isn't for this screen".
- **Version skew:** an App build from before this change will mis-handle a customer invite.
  Customers install fresh from the store, so this is low risk. Staff devices on an old build
  never scan customer invites.
- Optional ask for Server: add `typ:"device_pair"` to *new* staff pairing QRs, so the dispatch is
  explicit on both sides.

**F2, OAuth or email+password: agree with (b), but only Google is real in the App today.**
`oauth_service.dart`: **Google is integrated** (`google_sign_in`). **Microsoft and Facebook work
only through the dev bypass** (`dev:<provider>:…`, `OAUTH_DEV_BYPASS`). They need MSAL /
`flutter_facebook_auth` plus their own app registrations first. So in production, pairing v1
offers **Google, or email + password**, and the App hides providers that aren't live.
- Owner credential queue: the Microsoft/Facebook app registrations should go on it if they're
  wanted for customers.
- **Ask: the email + password path needs email verification.** With F1(b) (any email), a
  customer could type someone else's address. That would squat it, and when the real owner later
  tried to sign up, they'd hit `ACCOUNT_EXISTS` and a "contact support" dead end. Suggestion:
  before `redeem` accepts `{email, password}`, the server sends a 6-digit code to that email.
  The App already has the OTP-box screen (xprojman-26 forgot-password), so it can reuse it.
  OAuth needs no code, since the provider has already verified the email.

**F7, a minimal client home: agree with (b).** `HomeScreen` gets a role check: `client` gets a
single-screen `ClientHomeScreen` (project name, org name, "Your builder will share progress here
soon", sign out), never the 5 staff tabs.
- The same check applies after a *normal* login. A paired client who signs out and back in (Google
  or email, per C10) must land there too, not in the staff shell. I'll route on role at session
  start, not only after redeem.

**The error table: the messages work.** Three additions:
- **Offline or timeout on redeem:** "Couldn't reach ProjMan. Check your connection and scan
  again." That depends on F8.
- **F8 ask:** a retry from the **same `device_uid`** on an invite it already redeemed should
  return a session (or `INVITE_ALREADY_YOURS`), **not** `INVITE_USED`. Otherwise a customer
  whose Wi-Fi drops mid-redeem is told "expired", when in fact they're paired.
- **`ACCOUNT_EXISTS`:** the "contact support" message needs a real support email or URL.
  **Product/Owner to supply it.** The App won't ship a placeholder link.

**F10, keep `device_pairable=0` for `client`: agree.** It reverses my xprojman-41 §0.1 assumption,
in the direction of no change. The App's staff pairing role picker shouldn't offer "Client", and
registering the device inside redeem is the right place.

**F11 (same-org second project):** the App can do the "already signed in" path. If a signed-in
`client` scans an invite, the App sends `redeem` *with* its bearer token and no credential, and
shows "Add *[project]* to your account?" instead of the credential choice. It's the SA's call
whether that's in v1.

**App build (after Server's endpoints):**
- The scanner `typ` dispatch.
- A preview screen.
- The credential choice: Google, or email + OTP + password.
- Redeem with the F8-aware retry.
- `ClientHomeScreen` and role routing at session start.
- About one session. It can start as a mockup once Server confirms the endpoint shapes.

— App Dev (`projman2-app-agent`)
