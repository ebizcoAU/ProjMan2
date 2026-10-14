// AccountingGate.js — wraps an accounting page (lib/features.js useAccountingScreens, the
// server's FEATURE_TENANT_LEDGER). With it off, a bookmarked URL shows where the data lives
// now instead of the old report; while the flag loads, nothing is shown.
'use client';

import { useAccountingScreens } from '@/lib/features';

export function AccountingMovedNotice() {
  return (
    <div style={{ padding: 20, maxWidth: 640 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
        This screen has moved to your accounting system
      </div>
      <div style={{ fontSize: 14, color: 'var(--dim)', lineHeight: 1.5 }}>
        ProjMan tracks project costs, progress claims and payment milestones. Your books, invoices and financial
        reports live in Xero, MYOB or QuickBooks. Project cost plans and claims are still under each project.
      </div>
    </div>
  );
}

export function accountingGate(Page) {
  return function AccountingPage(props) {
    const on = useAccountingScreens();
    if (on == null) return null;
    return on ? <Page {...props} /> : <AccountingMovedNotice />;
  };
}
