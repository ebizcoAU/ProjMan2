// /admin — the System Admin dashboard shell (dashboardspec §9). A SEPARATE surface
// from the tenant Portal — its own sidebar, its own entry point (`/admin/login`, not
// the tenant `/login`). Same underlying auth/identity as the app and the Portal (one
// JWT, one `/auth/login`) — this is a different front door onto it, not a second
// auth system. Access is enforced server-side (`platform_admins` allowlist +
// `admin_role` → 403 per route); the nav below mirrors those `requireAdminRole(...)`
// lists so a role never sees a link it'd just get a 403 from.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { getToken, clearSession, authApi, adminApi } from '@/lib/api';

const NAV = [
  { href: '/admin',          label: 'Overview',       exact: true, roles: ['admin', 'account', 'staff'] },
  { href: '/admin/users',    label: 'Accounts',        roles: ['admin', 'account', 'staff'] },
  { href: '/admin/devices',  label: 'Devices',         roles: ['admin'] },
  { href: '/admin/orgs',     label: 'Organisations',   roles: ['admin', 'account'] },
  { href: '/admin/billing',  label: 'Billing',         roles: ['admin', 'account'] },
  { href: '/admin/logs',     label: 'Login Log',       roles: ['admin', 'staff'] },
];

export default function AdminLayout({ children }) {
  const router = useRouter();
  const path = usePathname();
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState(null);

  // The login page renders its own bare layout — skip the guard/shell entirely so
  // there's no redirect loop for a signed-out visitor landing there.
  const isLoginPage = path === '/admin/login';

  useEffect(() => {
    if (isLoginPage) return;
    if (!getToken()) { router.replace('/admin/login'); return; }
    adminApi.me()
      .then(({ data }) => { setRole(data.data.role); setReady(true); })
      .catch(() => router.replace('/admin/login'));
  }, [router, isLoginPage]);

  if (isLoginPage) return children;

  const logout = async () => { try { await authApi.logout(); } catch {} clearSession(); router.replace('/admin/login'); };

  if (!ready) return null;

  const nav = NAV.filter((n) => n.roles.includes(role));

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--fb)' }}>
      {/* Sidebar */}
      <aside style={{ width: 210, flexShrink: 0, background: 'var(--s1)', borderRight: '1px solid var(--b1)',
        display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0 }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--b1)' }}>
          <div style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>ProjMan</div>
          <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--blue)', fontWeight: 700, marginTop: 2 }}>
            System Admin
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, textTransform: 'capitalize' }}>
            {role} role
          </div>
        </div>
        <nav style={{ flex: 1, padding: '8px 0' }}>
          {nav.map(n => {
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
