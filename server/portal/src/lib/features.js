// features.js — Portal feature flags.
//
// ACCOUNTING_SCREENS: the user-accounting screens (chart of accounts, P&L, Balance Sheet,
// Expenses, Sales, Client Invoices). Owner ruling 2026-10-14: ProjMan is project
// management, and builders' books live in Xero/MYOB/QuickBooks, so these get hidden,
// not deleted. Default ON (nothing changes) until Server's matching /finance route flags
// land, so nav and API change together; then set NEXT_PUBLIC_ACCOUNTING_SCREENS=off
// (a build-time value, so restart :5102). Cost Plan, Claims, cost rates/centres, POs and
// the payment schedule are project management and stay regardless.
export const ACCOUNTING_SCREENS = process.env.NEXT_PUBLIC_ACCOUNTING_SCREENS !== 'off';
