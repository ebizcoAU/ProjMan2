// features.js — Portal feature flags.
//
// Accounting screens: the tenant-ledger screens (chart of accounts, P&L, Balance Sheet,
// Expenses, Sales), matching Server's FEATURE_TENANT_LEDGER (x43 §13.5). Client progress
// claims (Finance → Progress claims) are NOT behind it: they stay as the construction record
// and are exported to the accounting system (x43 §13.2). Owner ruling 2026-10-14: ProjMan is project
// management, and builders' books live in Xero/MYOB/QuickBooks, so these get hidden,
// not deleted. Cost Plan, Claims, cost rates/centres, POs and the payment schedule are
// project management and stay regardless.
//
// The server is the authority: GET /organisation returns `features` (Server R1), and
// useAccountingScreens() follows features.tenantLedger. NEXT_PUBLIC_ACCOUNTING_SCREENS
// (false/off/0/no; build-time, restart :5102) is only the fallback for when the server
// can't be asked or sends no flag. While the answer is loading the screens stay hidden,
// so the Portal never flashes a screen the server has turned off.
'use client';

import { useEffect, useState } from 'react';
import { organisationApi } from '@/lib/api';

export const ACCOUNTING_SCREENS_ENV = !['off', 'false', '0', 'no']
  .includes(String(process.env.NEXT_PUBLIC_ACCOUNTING_SCREENS ?? '').trim().toLowerCase());

// One request per page load, shared by the nav and every gated screen.
let featuresPromise = null;
function loadFeatures() {
  if (!featuresPromise) {
    featuresPromise = organisationApi.get()
      .then((res) => res?.data?.data?.features || null)
      .catch(() => { featuresPromise = null; return null; }); // retry next mount (e.g. after login)
  }
  return featuresPromise;
}

export function accountingScreensFrom(features) {
  return typeof features?.tenantLedger === 'boolean' ? features.tenantLedger : ACCOUNTING_SCREENS_ENV;
}

/** true / false once known; null while loading (treat as hidden). */
export function useAccountingScreens() {
  const [on, setOn] = useState(null);
  useEffect(() => {
    let live = true;
    loadFeatures().then((f) => { if (live) setOn(accountingScreensFrom(f)); });
    return () => { live = false; };
  }, []);
  return on;
}
