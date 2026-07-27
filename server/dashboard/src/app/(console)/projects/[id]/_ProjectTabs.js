// Shared tab bar for a project's sub-views (Programme | Cost Plan | Quality).
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function ProjectTabs({ id, seesMoney }) {
  const path = usePathname();
  const tabs = [
    { href: `/projects/${id}`, label: 'Programme', exact: true },
    ...(seesMoney ? [{ href: `/projects/${id}/cost-plan`, label: 'Cost Plan' }] : []),
    { href: `/projects/${id}/quality`, label: 'Quality' },
    { href: `/projects/${id}/field`, label: 'Field' },
  ];
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--b1)', marginBottom: 16 }}>
      {tabs.map(t => {
        const active = t.exact ? path === t.href : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} style={{
            padding: '8px 16px', textDecoration: 'none', fontSize: 14, fontWeight: 600,
            color: active ? 'var(--brand)' : 'var(--dim)',
            borderBottom: `2px solid ${active ? 'var(--brand)' : 'transparent'}`,
            marginBottom: -1,
          }}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
