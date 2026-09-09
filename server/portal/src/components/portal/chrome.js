// chrome.js — shared console-shell chrome, factored out once a second route group
// ((console) for PM, builder/ for Builder) needed the identical topbar/sidebar
// scaffolding: JWT decode, the responsive font-size floors, and the clock/date
// ticks. Keep this generic — it must not assume which route group is rendering it.
'use client';

import { useState, useEffect, useContext, createContext } from 'react';

// ── Topbar override ─────────────────────────────────────────────────────────
// Owner ask 2026-09-07: the generic topbar ("Projects" / "ProjMan · Office
// Console") is dead space on a project/task detail page that already has real
// identity to show (project code+name+address, or task code+name+breadcrumb) —
// and "ProjMan · Office Console" is redundant with the sidebar's own branding
// anyway. Rather than have every leaf page duplicate topbar-shaped markup, a
// page calls useTopbarOverride({title, subtitle, backHref}) to replace the
// layout's default chrome while it's mounted; unmounting restores the default
// automatically. Lives here (not the layout file) so both (console)/ and
// builder/ route groups could use it without either importing the other.
const TopbarContext = createContext(null);

export function TopbarProvider({ children }) {
  const [override, setOverride] = useState(null);
  return (
    <TopbarContext.Provider value={{ override, setOverride }}>
      {children}
    </TopbarContext.Provider>
  );
}

/** Layout side: read whatever the current page has set, or null for the default chrome. */
export function useTopbarState() {
  return useContext(TopbarContext)?.override ?? null;
}

/** Page side: replace the topbar's title/subtitle (and optional back-arrow href) while mounted. */
export function useTopbarOverride({ title, subtitle, backHref } = {}) {
  const ctx = useContext(TopbarContext);
  const setOverride = ctx?.setOverride;
  useEffect(() => {
    if (!setOverride) return;
    setOverride(title == null && subtitle == null ? null : { title, subtitle, backHref });
    return () => setOverride(null);
  }, [title, subtitle, backHref, setOverride]);
}

export function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return null; }
}

// ── Responsive font scale (accessibility floors for 60+/low-vision users) ──────
export function useScreenTier() {
  const [tier, setTier] = useState(false);
  useEffect(() => {
    const derive = () => {
      const w = window.innerWidth;
      if (w >= 1920) return 'fhd';
      if (w >= 1280) return 'hd';
      return false;
    };
    setTier(derive());
    const handler = () => setTier(derive());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return tier;
}

export function fs(base, tier) {
  if (!tier) return Math.max(13, base);
  if (tier === 'fhd') {
    if (base === 22) return 28;
    return Math.max(15, base + 3);
  }
  if (base === 22) return 24;
  return Math.max(14, base + 1);
}

export function useClockString() {
  const [t, setT] = useState('');
  useEffect(() => {
    const fmt = () => {
      const n = new Date();
      const h = String(n.getHours()).padStart(2, '0');
      const m = String(n.getMinutes()).padStart(2, '0');
      setT(`${h}:${m}`);
    };
    fmt();
    const id = setInterval(fmt, 30_000);
    return () => clearInterval(id);
  }, []);
  return t;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Today's full date for the topbar (info only): "Tuesday · 22/07/2026".
// Set after mount (like the clock) so server/client render the same initial HTML.
export function useTodayString() {
  const [s, setS] = useState('');
  useEffect(() => {
    const fmt = () => {
      const n  = new Date();
      const dd = String(n.getDate()).padStart(2, '0');
      const mm = String(n.getMonth() + 1).padStart(2, '0');
      setS(`${WEEKDAYS[n.getDay()]} · ${dd}/${mm}/${n.getFullYear()}`);
    };
    fmt();
    const id = setInterval(fmt, 60_000); // roll over at midnight
    return () => clearInterval(id);
  }, []);
  return s;
}
