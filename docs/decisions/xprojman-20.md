# xprojman-20 — App → Server: Google OAuth client IDs for the Portal env

**Status:** 🟢 App handoff — config values the Portal env needs. No decision required.
**Author:** App dev (Flutter) · **For:** Server Agent (Nexus) · Owner
**Date:** 2026-07-31
**Context:** Manager 2026-07-31 directive item 2 — provide the Google **web** client ID for the
Portal env. Firebase project **`projman-f4bca`** (project number `336317627750`), created for the
real Google Sign-In work (see `xprojman`/auth notes, `google-services.json` + `GoogleService-Info.plist`).

---

## 1. The value the Portal needs

**Web client ID** (OAuth `client_type 3`) — for the Portal / web-console Google sign-in and for
verifying ID tokens minted by a web sign-in:

```
336317627750-9ggol8vtikqitilsdmkp2n04qk55hivm.apps.googleusercontent.com
```

## 2. Full set (for reference / token-audience allow-list)

The server verifies a Google ID token against the client ID that minted it, so the API's
`GOOGLE_CLIENT_IDS` allow-list (already set in `server/api/.env`) should include all three; the
Portal env specifically uses the **web** one above.

| Platform | OAuth `client_type` | Client ID |
|---|---|---|
| **Web** (Portal) | 3 | `336317627750-9ggol8vtikqitilsdmkp2n04qk55hivm.apps.googleusercontent.com` |
| **iOS** | 2 | `336317627750-un77simkn5gtkuag2pq136olts8pku7r.apps.googleusercontent.com` |
| **Android** | 1 | `336317627750-c21tgvlrdrj5t8u46hqj8km4jun8nmoj.apps.googleusercontent.com` |

Source of truth in the repo: `app/android/app/google-services.json` (`oauth_client`) and
`app/ios/Runner/GoogleService-Info.plist` (`CLIENT_ID` = the iOS one).

## 3. Notes

- **These are public identifiers, not secrets** — OAuth client *IDs* ship inside the app binary
  and the checked-in config files. The client *secret* (web) is not needed for ID-token
  verification and is not included here; if the Portal ever does a server-side auth-code exchange
  it needs its own web client secret from the Google Cloud console (owner-held), not from the app.
- The **app** signs in with the native iOS/Android clients; the **Portal** uses the web client.
  Same Firebase project, same Google identity, three platform clients — one `GOOGLE_CLIENT_IDS`
  allow-list covers all audiences server-side.

© eBizco Australia Pty Ltd
