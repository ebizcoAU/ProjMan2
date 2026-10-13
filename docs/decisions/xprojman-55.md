# xprojman-55 — ProjMan ↔ MAVEN/AURA: separate systems, API exchange

**Status:** 🟢 DIRECTION RULED by the Owner (2026-10-14): "separate, with an API exchange". The contract detail below is a DRAFT, to be agreed with the Nexus PM (`nexus-86`).
**Author:** PM (`projman2-pm`, session projman2-a1) · **For:** Nexus PM, Server, Portal, App, Owner.
**Date:** 2026-10-14
**Related:** devroadmap §0 (scope ruling), §15 (ecosystem); xprojman-43 (re-scoped: construction claims); xprojman-08 (one person, one identity).

## 1. Ruling

1. **ProjMan stays project management.** It does not absorb MAVEN's accounting or tax engine (no fork of the tax code).
2. **MAVEN (+AURA, AI IVR)** serves small businesses, including **Services (tradies)**: POS, quotes, invoices, roster, attendance and BAS for the tradie's own business. MAVEN has its own portal.
3. **Builders' books** live in their own **Xero / MYOB / QuickBooks**. ProjMan hands off by CSV in v1 and a unified accounting API (Codat/Apideck/Merge) in v2.
4. The two systems **exchange data over an API with per-user consent**. Identities are **linked, never merged**, and each system is master of its own records.

## 2. The split

```
Builder / PM ──── ProjMan ──── project, stages, claims, variations, retention
      │                  ▲  │
      │ CSV / API        │  │ job award, work order, PO, badge
      ▼                  │  ▼
Xero / MYOB / QBO     MAVEN (+AURA, AI IVR) ── tradie's own POS, quotes,
(builder's books)        │                     invoices, roster, BAS
                         └── tradie invoice / claim → ProjMan supplier bill
```

## 3. Exchange flows (DRAFT, to be agreed with the Nexus PM)

| # | Direction | Event | Payload (indicative) | Consent |
|---|---|---|---|---|
| F1 | ProjMan → MAVEN | Job Award / PO to a tradie | job ref, project site (suburb only), scope, PO amount ex/incl GST, dates, builder ABN | the tradie links their MAVEN account |
| F2 | MAVEN → ProjMan | Tradie invoice / progress claim | invoice no., ABN, GST, amount, PO/job ref, SOP claim flag | the builder accepts the link per supplier |
| F3 | ProjMan → MAVEN | Verified Work History / licence badge | badge status "as at {date}" (xprojman-52 F2), never the underlying data | the tradie opts in |
| F4 | ProjMan → MAVEN | Payment status of the tradie's claim | paid / scheduled / disputed, with dates | same as F2 |

**Not exchanged:** client personal details, other trades' pricing, payroll, AURA chat/calls.

## 4. Open points for the Nexus PM

1. MAVEN's inbound and outbound API: what exists, auth (OAuth2 client credentials vs user-delegated), webhooks.
2. The account-link mechanism (OAuth consent screen in MAVEN? QR via AURA?).
3. Is the MAVEN 'services' tradie flow on the timeline (post-Nov 2026)? This contract's build waits on it.
4. Nexus Finance's view on SOP Act claim fields in F2.

## 5. Sequencing

The ProjMan build of F1–F4 waits until (a) MAVEN's tradie flow ships (post-Nov 2026) and (b) this contract is agreed. Until then ProjMan builds only the Xero/MYOB/QuickBooks CSV export (xprojman-43, re-scoped).

© eBizco Australia Pty Ltd — xprojman-55.md, 2026-10-14
