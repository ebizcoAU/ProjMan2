// builder/layout.js — the Builder console shell (portaldesignspec §2: `(builder)/*`
// = Builder, scope `assigned` on his own engagement). A real `builder/` path
// segment rather than a Next.js parenthesised route group — group syntax hides
// the segment from the URL, which would collide with the PM console's own
// `/dashboard` route; this way the two shells live at genuinely different URLs.
//
// Same shell pattern as `(console)/layout.js` (auth guard, topbar, sidebar) but
// with the Builder nav and a role gate the other direction: a non-Builder
// landing here is bounced to the PM console instead of rendering pages built
// against Builder's own, narrower permission set (§4.3).
'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { PortalNav, BUILDER_NAV, getNavLabel } from '@/components/portal/PortalNav';
import { PortalPeriodProvider } from '@/components/portal/PeriodContext';
import { parseJwt, useScreenTier, fs, useClockString, useTodayString } from '@/components/portal/chrome';
import { getToken, getSavedUser, clearSession, authApi } from '@/lib/api';

const PAGE_TITLES = {
  dashboard:   'Dashboard',
  'job-awards': 'Job Invitations',
};

export default function BuilderLayout({ children }) {
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

    if (jwt.exp && jwt.exp < Math.floor(Date.now() / 1000)) {
      clearSession();
      router.replace('/login');
      return;
    }

    const merged = { ...jwt, ...(getSavedUser() || {}) };

    // Single-fixed-role identity model (xprojman-08/09) — only a `builder` may
    // be in this route group. Anyone else (PM, developer, site supervisor…)
    // belongs in the PM console.
    if (merged.role !== 'builder') { router.replace('/dashboard'); return; }

    setUser(merged);
  }, [router]);

  const name = user?.fullName ?? user?.full_name ?? '—';

  const seg       = pathname.split('/').filter(Boolean)[1]; // ['builder', 'dashboard', ...]
  const pageTitle = PAGE_TITLES[seg] ?? 'Builder Console';
  const navLabel  = getNavLabel(pathname, BUILDER_NAV);
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

      <PortalNav userName={name} role="builder" onLogout={handleLogout} sections={BUILDER_NAV} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

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
              ProjMan · Builder Console
            </div>
          </div>

          <span style={{
            fontFamily: 'var(--fm)', fontSize: fs(13, screenTier), fontWeight: 600,
            color: 'var(--dim)', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {today}
          </span>

          <span style={{
            fontFamily: 'var(--fm)', fontSize: fs(14, screenTier), fontWeight: 600,
            color: 'var(--dim)', flexShrink: 0,
          }}>
            {clock}
          </span>
        </header>

        <main style={{ flex: 1, overflowX: 'hidden', overflowY: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
    </PortalPeriodProvider>
  );
}
