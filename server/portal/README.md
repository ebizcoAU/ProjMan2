# ProjMan2 Dashboard — Office Console

The builder's web console (Next.js 14 + Tailwind), scaffolded by porting the proven
Nexus portal UI kit per `docs/servdesignspecification.md` §5:

- **Ported near-verbatim:** `PortalTable`, `PortalKpi`, `PortalCard`, `PortalFilter`,
  `PortalPagination`, `PortalEmpty`, `PortalError`, `usePortalData`, `PeriodContext`
  (`src/components/portal/`).
- **Adapted:** `PortalNav` — the collapsible sidebar with the 60+/low-vision
  accessibility font floors is kept; the Observe/Audit switcher and AI slot are
  dropped; nav items are the ProjMan2 surface. The Nexus accessible **light theme**
  (previously opt-in via `.portal-root`) is the default theme here.
- **Adapted:** `src/lib/api.js` — the fetch wrapper with axios-shaped responses and
  session-expiry redirect; base URL `/api/v1` via Next rewrite to `:5100`.
- **Rewritten:** `/login` — email/password (Nexus used CCCD + PIN + QR).
- **Dropped:** MQTT (`MqttContext`, `useMqtt`) — ProjMan2 polls.

## Pages

| Route | Status |
|---|---|
| `/login` | ✅ email/password against `POST /auth/login` |
| `/devices` | ✅ the port's proof-of-concept — list, revoke, re-role, sync status |
| `/projects` | ✅ first domain page — list + create |
| everything else in the nav | `soon` placeholders pointing at real routes |

## Run it

```bash
cd server/dashboard
npm install
npm run dev            # http://localhost:5220 — API assumed at :5100 (API_URL to override)
```

Auth: tokens in `localStorage` (`pm2Token` / `pm2Refresh` / `pm2User`); the console
identifies itself with a stable `web-<uuid>` device id. Web console sessions are
**never authoritative** for sync (single-writer stays with the field app).
