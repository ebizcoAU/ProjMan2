// /admin — the System Admin dashboard shell (dashboardspec §9).
// A SEPARATE surface from the tenant console: platform-admin only, account & billing.
// Deliberately plainer than the construction console — this is ops, not site work.
// Access is enforced server-side (platform_admins allowlist → 403); the UI surfaces
// that as an access-denied state rather than gating client-side.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { getToken, clearSession, authApi } from '@/lib/api';

const NAV = [
  { href: '/admin',          label: 'Overview',  exact: true },
  { href: '/admin/users',    label: 'Accounts' },
  { href: '/admin/devices',  label: 'Devices' },
  { href: '/admin/orgs',     label: 'Organisations' },
  { href: '/admin/billing',  label: 'Billing' },
  { href: '/admin/logs',     label: 'Login Log' },
];

export default function AdminLayout({ children }) {
  const router = useRouter();
  const path = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    setReady(true);
  }, [router]);

  const logout = async () => { try { await authApi.logout(); } catch {} clearSession(); router.replace('/login'); };

  if (!ready) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--fb)' }}>
      {/* Sidebar */}
      <aside style={{ width: 210, flexShrink: 0, background: 'var(--s1)', borderRight: '1px solid var(--b1)',
        display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0 }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--b1)' }}>
          <div style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>ProjMan2</div>
          <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--blue)', fontWeight: 700, marginTop: 2 }}>
            System Admin
          </div>
        </div>
        <nav style={{ flex: 1, padding: '8px 0' }}>
          {NAV.map(n => {
            const active = n.exact ? path === n.href : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} style={{
                display: 'block', padding: '9px 16px', textDecoration: 'none', fontSize: 14,
                fontWeight: active ? 700 : 500,
                color: active ? 'var(--blue)' : 'var(--dim)',
                background: active ? 'var(--bluedim)' : 'transparent',
                borderRight: `3px solid ${active ? 'var(--blue)' : 'transparent'}`,
              }}>{n.label}</Link>
            );
          })}
        </nav>
        <div style={{ padding: 12, borderTop: '1px solid var(--b1)' }}>
          <button onClick={logout} className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>Log out</button>
        </div>
      </aside>
      <main style={{ flex: 1, overflowX: 'hidden' }}>{children}</main>
    </div>
  );
}
