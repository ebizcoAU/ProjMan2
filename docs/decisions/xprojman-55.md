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

## 4.1 Nexus PM response (`nexus-86`, 2026-10-14; Nexus pointer XF-381), recorded by the ProjMan PM

**§3 flows: agreed in principle**, with these notes:
- **F1/F4: add an "RCTI issued" variant.** A builder that issues recipient-created tax invoices to subcontractors makes the tax document come *from* ProjMan. Nexus Finance: an RCTI needs a written agreement under the ATO RCTI determination.
- **F2:** the SOP claim flag must carry the **state** (NSW/QLD/ACT), and the claim must carry the statutory wording. MAVEN generates it; the tradie still serves it.
- **F3:** the badge wording must be factual: "licence verified with <register> as at <date>". Never "trusted" or "best" (ACL s18).

**§4 open points:**
1. **API/auth:** Nexus has no partner API today (backend confirming). Proposed: **user-delegated consent** (OAuth2-style; the tradie authorises inside MAVEN), not blanket client-credentials; webhooks for F2/F4. **Hard Nexus rule:** MAVEN's data is app-owned (the phone is the system of record), so inbound F1 jobs land in a server **inbox** that the tradie's app applies. Never a direct write into their books.
2. **Account link:** the tradie starts it in MAVEN ("Link ProjMan") and consents per scope (F1–F4). Each side stores only an **opaque pairwise link id**; either side can unlink. Link, never merge.
3. **Timeline:** post-Nov 2026 trial, not scheduled. Nexus Product's view: **early–mid 2027** for a solo-tradie voice spine (enquiry → quote → job → materials/time → invoice → paid) with a Xero/MYOB export. Then, in order: F3 badge → F1 job award → F2 invoice→bill. The schedule is the Owner's call.
4. **SOP fields** (Nexus Finance, MEDIUM, from law-firm commentary; solicitor to confirm):
   - **NSW** (1999 Act s13(2)): identify the work, the amount, and the "made under the Act" statement (contracts from 21/10/2019); monthly; s13(7) supporting statement for head contractors.
   - **QLD** (BIF Act s68): work, amount, and a request for payment (an "invoice" heading counts; *MWB Everton Park v Devcon* [2024] QCA 94, strict).
   - **ACT** (2009 Act s15): work, amount, and the Act statement (MEDIUM-LOW).
   - **Owner-occupier / resident-owner contracts are excluded in all three.** SOP claims are sub → builder and builder → developer, never tradie/builder → homeowner. Build this as an **optional per-state claim template**, not the default invoice.

**§4.1 item 1 confirmed in code** (Nexus backend via `nexus-86`, 2026-10-14): **no general partner API exists.** No API keys and no OAuth/OIDC let a third party read or write a MAVEN business or link accounts. The nearby surfaces don't fit ProjMan:
- (a) Inbound food-delivery order webhooks for a fixed provider list (per-provider shared secret). ProjMan can't use these without new code.
- (b) An owner-driven bank-statement CSV upload, which is not system-to-system.
- (c) An outbound Xero/QuickBooks CSV export from MAVEN accounting, with AU overlays. A Xero OAuth module exists but is dormant (Nexus Owner ruling "xero b", 2026-10-02). There is no MYOB support.
- (d) The developer/external/internal routes are tooling, not partner surfaces.

So F1–F4 need a **new, consented API on the Nexus side** when the tradie flow is scheduled. ProjMan builds nothing against MAVEN until then.

**MAVEN built vs not built** (Nexus PM `nexus-86`, 2026-10-14, checked in code):
- **Tax invoices:** BUILT on the device for a venue's own customers (ABN check, GST, buyer details from A$1,000). There are no adjustment or credit notes and no buyer ABN or address fields.
- **"Service" business type:** a code only. No appointments, jobs, quotes or work orders.
- **Identity:** UUID users, OTP + PIN + device keyring. MAVEN is not an OAuth/OIDC provider. It is only a client of Xero and SePay.
- **Accounting core:** NOT built. No chart of accounts, journal or GL, and no BAS, STP or TPAR. There is only an app P&L.
- **Third-party inbound API:** none, and CSV import is retired.
- **File exports:** BUILT for Xero CSV, QBO CSV, generic CSV and MISA XML. Xero OAuth is dormant. No MYOB or Intuit API.

This confirms the Owner's ruling of separate systems with exports to Xero/MYOB/QuickBooks.

**Connector ownership: RULED by the Owner 2026-10-14.** ProjMan builds its own Xero/MYOB/QuickBooks connectors for **builders first** (the CSV in the x43 re-scope). **MAVEN owns the connectors for tradies.** This matches Nexus's lean.

## 5. Sequencing

The ProjMan build of F1–F4 waits until (a) MAVEN's tradie flow ships (post-Nov 2026) and (b) this contract is agreed. Until then ProjMan builds only the Xero/MYOB/QuickBooks CSV export (xprojman-43, re-scoped).

© eBizco Australia Pty Ltd — xprojman-55.md, 2026-10-14
