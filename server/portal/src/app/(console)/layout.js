// (console)/layout.js — wraps all console pages with the PortalNav sidebar + topbar.
// Adapted from Nexus portal/layout.js: auth guard on the ProjMan2 JWT, breadcrumb
// topbar, date + clock. Dropped: the Observe/Audit mode pill and the mode-aware
// export CTA (no mode split in ProjMan2).
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { PortalNav, getNavLabel } from '@/components/portal/PortalNav';
import { PortalPeriodProvider } from '@/components/portal/PeriodContext';
import { parseJwt, useScreenTier, fs, useClockString, useTodayString, TopbarProvider, useTopbarState } from '@/components/portal/chrome';
import { getToken, getSavedUser, clearSession, authApi } from '@/lib/api';

// Page titles keyed by first path segment
const PAGE_TITLES = {
  devices:      'Devices',
  projects:     'Projects',
  organisation: 'Organisation',
  finance:      'Finance',
};

export default function ConsoleLayout({ children }) {
  return (
    <TopbarProvider>
      <ConsoleShell>{children}</ConsoleShell>
    </TopbarProvider>
  );
}

// Split from ConsoleLayout so this can consume useTopbarState() — a page (a
// descendant of the TopbarProvider above) sets the override via
// useTopbarOverride(); only a component BELOW the Provider in the tree can read
// it back out, which ConsoleLayout itself, as the Provider's own parent, cannot.
function ConsoleShell({ children }) {
  const router   = useRouter();
  const pathname = usePathname();
  const clock    = useClockString();
  const today    = useTodayString();
  const screenTier = useScreenTier();
  const [user, setUser] = useState(null);
  const topbarOverride = useTopbarState();

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
    const merged = { ...jwt, ...(getSavedUser() || {}) };

    // This console is the Project Manager's (portaldesignspec §2). A Builder
    // identity has its own route group with its own permission scope — bounce
    // them there rather than rendering PM-shaped pages (Cost Plan edit, Users,
    // Settings) against a role that was never granted those permissions.
    if (merged.role === 'builder') { router.replace('/builder/dashboard'); return; }

    setUser(merged);
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
          {/* Title + breadcrumb (Section › Page) — or a page's own identity override */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {topbarOverride ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {topbarOverride.backHref && (
                    <Link href={topbarOverride.backHref} aria-label="Back" style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                      color: 'var(--dim)', textDecoration: 'none', fontSize: 16,
                    }}>&larr;</Link>
                  )}
                  <span style={{
                    fontFamily: 'var(--fh)', fontSize: fs(20, screenTier), fontWeight: 700,
                    color: 'var(--text)', lineHeight: 1.1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {topbarOverride.title}
                  </span>
                </div>
                {topbarOverride.subtitle && (
                  <div style={{
                    fontSize: fs(13, screenTier), color: 'var(--dim)', marginTop: 3,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {topbarOverride.subtitle}
                  </div>
                )}
              </>
            ) : (
              <>
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
              </>
            )}
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
