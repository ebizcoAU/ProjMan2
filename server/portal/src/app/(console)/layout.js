// (console)/layout.js — wraps all console pages with the PortalNav sidebar + topbar.
// Adapted from Nexus portal/layout.js: auth guard on the ProjMan2 JWT, breadcrumb
// topbar, date + clock. Dropped: the Observe/Audit mode pill and the mode-aware
// export CTA (no mode split in ProjMan2).
'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { PortalNav, getNavLabel } from '@/components/portal/PortalNav';
import { PortalPeriodProvider } from '@/components/portal/PeriodContext';
import { getToken, getSavedUser, clearSession, authApi } from '@/lib/api';

function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return null; }
}

// Page titles keyed by first path segment
const PAGE_TITLES = {
  devices:      'Devices',
  projects:     'Projects',
  organisation: 'Organisation',
};

// ── Responsive font scale (same floors as PortalNav) ─────────────────────────
function useScreenTier() {
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

function fs(base, tier) {
  if (!tier) return Math.max(13, base);
  if (tier === 'fhd') {
    if (base === 22) return 28;
    return Math.max(15, base + 3);
  }
  if (base === 22) return 24;
  return Math.max(14, base + 1);
}

function useClockString() {
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

// Today's full date for the topbar (info only): "Tuesday · 22/07/2026".
// Set after mount (like the clock) so server/client render the same initial HTML.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function useTodayString() {
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

export default function ConsoleLayout({ children }) {
  const router   = useRouter();
  const pathname = usePathname();
  const clock    = useClockString();
  const today    = useTodayString();
  const screenTier = useScreenTier();
  const [user, setUser] = useState(null);

  // ── Auth guard ───────────────────────────────────────────────────────────
  useEffect(() => {
    const token = getToken();
    if (!token) { router.replace('/login'); return; }

    const jwt = parseJwt(token);
    if (!jwt) { router.replace('/login'); return; }

    // Pre-flight expiry check — JWT exp is Unix seconds
    if (jwt.exp && jwt.exp < Math.floor(Date.now() / 1000)) {
      clearSession();
      router.replace('/login');
      return;
    }

    // API fields win for display
    setUser({ ...jwt, ...(getSavedUser() || {}) });
  }, [router]);

  const name = user?.fullName ?? user?.full_name ?? '—';
  const role = user?.role ?? 'org_admin';

  // Derive topbar title from pathname
  const seg       = pathname.split('/').filter(Boolean)[0];
  const pageTitle = PAGE_TITLES[seg] ?? 'Console';
  // Sub-menu (breadcrumb) label from the nav; hidden when it would repeat the title.
  const navLabel  = getNavLabel(pathname);
  const subTitle  = navLabel && navLabel !== pageTitle ? navLabel : null;

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { /* session may already be dead */ }
    clearSession();
    router.replace('/login');
  };

  return (
    <PortalPeriodProvider>
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      background: 'var(--bg)',
      color: 'var(--text)',
      fontFamily: 'var(--fb)',
    }}>

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <PortalNav userName={name} role={role} onLogout={handleLogout} />

      {/* ── Main column ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── Topbar ─────────────────────────────────────────────────────── */}
        <header style={{
          height: 60, minHeight: 60,
          background: 'var(--s1)',
          borderBottom: '1px solid var(--b1)',
          boxShadow: '0 1px 3px rgba(16,24,40,.06)',
          display: 'flex', alignItems: 'center',
          padding: '0 22px', gap: 12,
          flexShrink: 0,
          position: 'relative', zIndex: 30,
        }}>
          {/* Title + breadcrumb (Section › Page) */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
              <span style={{
                fontFamily: 'var(--fh)', fontSize: fs(20, screenTier), fontWeight: 700,
                color: subTitle ? 'var(--dim)' : 'var(--text)', lineHeight: 1.1,
                whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                {pageTitle}
              </span>
              {subTitle && (
                <>
                  <span style={{ color: 'var(--muted)', fontSize: fs(16, screenTier), flexShrink: 0 }}>›</span>
                  <span style={{
                    fontFamily: 'var(--fh)', fontSize: fs(20, screenTier), fontWeight: 700,
                    color: 'var(--text)', lineHeight: 1.1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {subTitle}
                  </span>
                </>
              )}
            </div>
            <div style={{ fontSize: fs(13, screenTier), color: 'var(--dim)', marginTop: 3 }}>
              ProjMan · Office Console
            </div>
          </div>

          {/* Today's date (info only) */}
          <span style={{
            fontFamily: 'var(--fm)', fontSize: fs(13, screenTier), fontWeight: 600,
            color: 'var(--dim)', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {today}
          </span>

          {/* Clock */}
          <span style={{
            fontFamily: 'var(--fm)', fontSize: fs(14, screenTier), fontWeight: 600,
            color: 'var(--dim)', flexShrink: 0,
          }}>
            {clock}
          </span>
        </header>

        {/* ── Page content ───────────────────────────────────────────────── */}
        <main style={{ flex: 1, overflowX: 'hidden', overflowY: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
    </PortalPeriodProvider>
  );
}
