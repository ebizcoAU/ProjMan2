// PeriodContext.js — shared period (month/year) state for the console.
// Ported from Nexus portal/_components/PeriodContext.js; en-AU label.
// Pages consume it via usePortalPeriod() so a global ‹ Month / Year › control can
// drive their queries (claims, attendance and cost reports are monthly animals).
'use client';

import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const PeriodContext = createContext(null);

const pad2 = n => String(n).padStart(2, '0');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function PortalPeriodProvider({ children }) {
  // Initialise to the current month. Month-level granularity makes any
  // server/client date mismatch effectively a non-issue (only at a month boundary).
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 }; // month 1–12
  });

  // Shift by whole months, crossing year boundaries naturally.
  const shiftMonth = useCallback((delta) => {
    setPeriod(p => {
      const d = new Date(p.year, p.month - 1 + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
  }, []);

  const shiftYear = useCallback((delta) => {
    setPeriod(p => ({ ...p, year: p.year + delta }));
  }, []);

  const value = useMemo(() => ({
    period,                                        // { year, month }
    ym:    `${period.year}-${pad2(period.month)}`, // 'YYYY-MM'
    label: `${MONTHS[period.month - 1]} ${period.year}`,
    setPeriod,
    shiftMonth,
    shiftYear,
  }), [period, shiftMonth, shiftYear]);

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePortalPeriod() {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error('usePortalPeriod must be used within PortalPeriodProvider');
  return ctx;
}
