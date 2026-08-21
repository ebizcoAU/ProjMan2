# xprojman-26 — Server → App: Forgot-password recovery screen + email/error-handling contract

**Status:** 🟢 Server backend + Portal web UI BUILT and live (dev API `:5100`/`c1projman2`, endpoints have existed since PM2-era `recovery.js`; what's new this pass is the branded HTML email and the Portal's screen). App-side screen not yet built — this is the reference.
**Author:** Server Agent · **For:** App dev (Flutter) · Owner
**Date:** 2026-08-20
**Related:** `docs/assets/RecoveryScreen.png` / `EmailScreen.png` (the visual reference the owner gave), `server/portal/src/components/portal/RecoveryModal.js` (working reference implementation), `server/api/src/routes/recovery.js`, `server/api/src/lib/email.js`.

---

## What changed this pass

1. **The recovery email is now a real branded HTML email**, not console-only dev
   text. `EMAIL_ENABLED=true` in the dev `.env` (Gmail SMTP, creds ported from
   `nexus/api/.env` — local/gitignored, not committed). Layout: dark `ProjMan.`
   header lockup with the real logo, a plain-language headline, the 6-digit code
   in its own bordered block, an expiry note, and a brand-orange footer band. Live-
   tested with a real send/receive round trip this session.
2. **The Portal now has a full forgot-password flow** (`/login` → "Forgot
   password?" → modal), 3 steps: email → 6-digit OTP (split boxes, resend timer)
   → new password. Built to match `docs/assets/RecoveryScreen.png`'s shape
   (heading + Close, divider, secondary heading, OTP boxes, "Code sent to your
   email.", "Resend in Ns" pill). No phone-number alt-channel — ProjMan is
   email-only recovery by design (no SMS-based account recovery exists).
3. **This doc is the same contract for the App's own screen**, plus explicit
   error-handling guidance the owner asked to be called out.

## The 3 endpoints (unchanged shape, already live)

```
POST /auth/recovery/request  { email, purpose? }        → always 200
POST /auth/recovery/verify   { email, code, purpose? }   → { recoveryToken, expiresIn, purpose }
POST /auth/recovery/reset    { recoveryToken, newPassword } → success message
```

`purpose` is `'password_reset'` (default) or `'device_loss'` — same 3 calls, just a
different headline in the email/UI copy. Reference `server/portal/src/lib/api.js`
`recoveryApi` for the exact request shape, and `RecoveryModal.js` for the full step
state machine (digit-box focus advance, paste-fill, resend cooldown) — the App
screen should feel the same, not necessarily look pixel-identical to the web modal.

## Error handling — the part to get right

**By design, `/auth/recovery/request` never reveals whether an email is
registered.** It always returns `200 { success: true, message: "If that address
is registered, a code is on its way." }`, whether or not the account exists —
this is deliberate anti-enumeration (see the comment at the top of that route in
`recovery.js`): a distinguishable "email not found" response would turn the
endpoint into an account-existence oracle. **Do not build a "that email isn't
registered" message anywhere in the app** — show the generic copy every time,
identically for a real and a fake address.

**There is also no "phone number not found" recovery path** — ProjMan has no
phone-based account lookup at all. The only phone/mobile-facing endpoints are
`POST /auth/sms/request` and `/auth/sms/verify` (`oauth.js`), and those are
**authenticated, ownership-verification calls for onboarding** ("prove this
mobile is yours"), not a lookup by phone number — there is no account to "not
find". If the app has a phone-entry step anywhere in onboarding, the only real
errors there are `INVALID_MOBILE` (bad AU format) and the OTP-mismatch codes
below — never an existence check.

**What you actually need to handle, all as `{ success:false, message, code }`:**

| Step | Status | `code` | When | Suggested copy |
|---|---|---|---|---|
| request | 200 always | — | n/a | "If that address is registered, a code is on its way." |
| request/verify/reset | 422 | `VALIDATION_ERROR` | malformed email / code not 6 digits / password < 10 chars | show `message` verbatim — server text is already user-facing |
| verify | 401 | `INVALID_CODE` | wrong code, or no live code for that email+purpose (expired/already used) | "That code is not valid or has expired." |
| verify | 429 | `TOO_MANY_ATTEMPTS` | 5 wrong tries burns the code | "Too many attempts. Request a new code." — surface the resend action |
| reset | 401 | `INVALID_RECOVERY_TOKEN` | the verify→reset token expired (10 min window) or was already spent | send the user back to the start of the flow |
| sms/request | 422 | `INVALID_MOBILE` | bad AU mobile format | "Enter a valid Australian mobile (04xx xxx xxx)." |
| sms/request | 502 | `SMS_SEND_FAILED` | provider send failure | generic retry |
| sms/verify | 401/429 | `INVALID_CODE` / `TOO_MANY_ATTEMPTS` | same shape as recovery | same copy pattern as above |

Every one of these `message` strings is already written to be shown directly to a
user — no need to re-map them client-side; just don't invent an extra state for
"account not found" that the server will never send.

## Not blocking anything else

Password-reset already works end-to-end via the Portal today. This is specifically
about giving the App its own equivalent screen + making sure its error states match
the server's actual (deliberately limited) error surface — nothing else is waiting
on it.
