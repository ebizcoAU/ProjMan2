// PortalNav.js — collapsible sidebar, expanded 252px / collapsed 64px.
// Adapted from Nexus portal/_components/PortalNav.js (N-DASH-004):
//   KEPT    the shell — collapse toggle, responsive font tiers with the
//           accessibility floors for 60+/low-vision users, mock:"soon" items,
//           the logout confirm modal.
//   DROPPED the Observe/Audit mode switcher (D-540) and the AI Assist slot —
//           ProjMan2 has one console, not an ops/audit split.
//   CHANGED nav items to the ProjMan2 surface; single brand accent; role badge
//           in the footer instead of the FTPOS subscription tier.
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';

// ── Responsive font scale ─────────────────────────────────────────────────────
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

// ACCESSIBILITY (60+ / low-vision): raised floors so navigation labels never
// render below a legible size. HD (≥1280): +1px floor 14; FHD (≥1920): +3px floor 15.
function fs(base, tier) {
  if (!tier) return Math.max(13, base);
  if (tier === 'fhd') {
    if (base === 22) return 28;
    return Math.max(15, base + 3);
  }
  if (base === 22) return 24;
  return Math.max(14, base + 1);
}

// ── Nav — ProjMan2 console ────────────────────────────────────────────────────
// mock:true = no backing page yet; points to the nearest real route so there are
// no dead 404s, renders at 55% opacity with a "soon" badge.
const NAV = [
  {
    group: null,
    items: [
      { k: 'dashboard', href: '/devices', label: 'Dashboard', mock: true,
        tooltip: 'Coming: portfolio KPIs — active projects, claims due, site headcount' },
    ],
  },
  {
    group: 'PROJECTS',
    items: [
      { k: 'projects',  href: '/projects', label: 'Projects' },
      { k: 'customers', href: '/projects', label: 'Customers', mock: true,
        tooltip: 'Coming: customer list and contacts (API is live at /customers)' },
      { k: 'programme', href: '/projects', label: 'Programme', mock: true,
        tooltip: 'Coming: Gantt view of stages and tasks' },
    ],
  },
  {
    group: 'SITE',
    items: [
      { k: 'site-diary', href: '/projects', label: 'Site Diary', mock: true,
        tooltip: 'Coming: daily diary entries captured by the field app' },
      { k: 'attendance', href: '/projects', label: 'Attendance', mock: true,
        tooltip: 'Coming: site attendance, inductions, trades on site' },
      { k: 'safety',     href: '/projects', label: 'Safety', mock: true,
        tooltip: 'Coming: hazards, incidents, toolbox talks' },
    ],
  },
  {
    group: 'COMMERCIAL',
    items: [
      { k: 'purchase-orders', href: '/projects', label: 'Purchase Orders', mock: true,
        tooltip: 'Coming: PO → supplier invoice → progress claim chain' },
      { k: 'claims',          href: '/projects', label: 'Progress Claims', mock: true,
        tooltip: 'Coming: claims against the contract value by stage' },
    ],
  },
  {
    group: 'ORGANISATION',
    items: [
      { k: 'users',    href: '/organisation/users',    label: 'Users' },
      { k: 'devices',  href: '/devices',               label: 'Devices' },
      { k: 'settings', href: '/organisation/settings', label: 'Settings' },
      { k: 'audit',    href: '/organisation/audit',    label: 'Audit' },
    ],
  },
];

// ── SVG icons (15×15 viewBox, stroke currentColor) ────────────────────────────
const ICONS = {
  dashboard:  <path d="M1.5 8.5L7.5 2l6 6.5M3 7.5V13h3.5V9.5h2V13H12V7.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" fill="none"/>,
  projects:   <><path d="M1.5 13V6.5l6-4 6 4V13H1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none"/><path d="M5.5 13V9h4v4" stroke="currentColor" strokeWidth="1.2" fill="none"/></>,
  customers:  <><circle cx="7.5" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M2 13.5c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></>,
  programme:  <><rect x="1.5" y="2" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M3.5 5h5M5.5 7.5h6M3.5 10h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></>,
  'site-diary': <><rect x="2.5" y="1.5" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M5 4.5h5M5 7h5M5 9.5h3" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round"/></>,
  attendance: <><circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M7.5 4.5V8l2 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></>,
  safety:     <><path d="M7.5 1.5l5.5 2v4c0 3-2.2 5.3-5.5 6-3.3-.7-5.5-3-5.5-6v-4l5.5-2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none"/><path d="M5 7.5l1.8 1.8L10 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/></>,
  'purchase-orders': <><path d="M2 4.5h11M2 7.5h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M10 9.5l2.5 2-2.5 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></>,
  claims:     <><path d="M7.5 1v13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M4.5 4.5C4.5 3.4 5.4 2.5 6.5 2.5h2c1.1 0 2 .9 2 2s-.9 2-2 2h-2c-1.1 0-2 .9-2 2s.9 2 2 2h2c1.1 0 2-.9 2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></>,
  devices:    <><rect x="4" y="1.5" width="7" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M6.5 11.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></>,
  users:      <><circle cx="5" cy="5" r="2.2" stroke="currentColor" strokeWidth="1.2" fill="none"/><circle cx="10.5" cy="5.5" r="1.8" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M1.5 12.5c0-2.3 1.6-3.5 3.5-3.5s3.5 1.2 3.5 3.5M9.5 12.5c0-1.8 1-2.8 2.5-2.8s2 .9 2 2.8" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" fill="none"/></>,
  settings:   <><circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M7.5 1.5v2M7.5 11.5v2M1.5 7.5h2M11.5 7.5h2M3.3 3.3l1.4 1.4M10.3 10.3l1.4 1.4M11.7 3.3l-1.4 1.4M4.7 10.3l-1.4 1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></>,
  audit:      <><path d="M2 3.5h11M2 6.5h8M2 9.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><circle cx="11" cy="10.5" r="2.3" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M12.7 12.2l1.3 1.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></>,
};

function NavIcon({ k }) {
  return (
    <svg width="18" height="18" viewBox="0 0 15 15" style={{ display: 'block', flexShrink: 0 }}>
      {ICONS[k] || <circle cx="7.5" cy="7.5" r="4" stroke="currentColor" strokeWidth="1.3" fill="none"/>}
    </svg>
  );
}

function isMatch(href, exact, pathname) {
  if (exact) return pathname === href;
  return pathname.startsWith(href);
}

// Resolve a pathname to its nav label for the topbar breadcrumb. Real (non-mock)
// items only; longest href match wins so nested routes beat their parent.
export function getNavLabel(pathname) {
  if (!pathname) return null;
  let best = null;
  for (const section of NAV) {
    for (const item of section.items) {
      if (item.mock) continue;
      const hit = item.exact ? pathname === item.href : pathname.startsWith(item.href);
      if (hit && (!best || item.href.length > best.href.length)) best = item;
    }
  }
  return best ? best.label : null;
}

// Role badge colours — light-theme AA variants.
const ROLE_BADGE = {
  org_admin:         { bg: 'var(--bdim)',    color: 'var(--brand)',  border: 'rgba(194,65,12,.40)' },
  project_developer: { bg: 'var(--purpdim)', color: 'var(--purple)', border: 'rgba(109,40,217,.40)' },
  project_manager:   { bg: 'var(--bluedim)', color: 'var(--blue)',   border: 'rgba(29,78,216,.40)' },
  supervisor:        { bg: 'var(--gdim)',    color: 'var(--green)',  border: 'rgba(21,128,61,.40)' },
  tradie:            { bg: 'var(--s4)',      color: 'var(--dim)',    border: 'var(--b2)' },
  customer:          { bg: 'var(--s4)',      color: 'var(--dim)',    border: 'var(--b2)' },
};

const ACCENT = {
  color: 'var(--brand)',
  bg: 'var(--bdim)',
  border: 'rgba(194,65,12,.28)',
  avatarBg: 'var(--bdim)',
  avatarBorder: 'rgba(194,65,12,.28)',
};

// ── PortalNav component ───────────────────────────────────────────────────────
export function PortalNav({ userName, role, onLogout }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed]         = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const screenTier = useScreenTier();

  const roleKey   = role || 'org_admin';
  const roleStyle = ROLE_BADGE[roleKey] || ROLE_BADGE.supervisor;
  const initials  = (userName || 'U').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const W         = collapsed ? 64 : 252;

  return (
    <>
      <aside style={{
        width: W, minWidth: W, flexShrink: 0,
        background: 'var(--s1)',
        borderRight: '1px solid var(--b1)',
        display: 'flex', flexDirection: 'column',
        height: '100vh', overflow: 'hidden',
        position: 'relative',
        transition: 'width .22s cubic-bezier(.4,0,.2,1), min-width .22s cubic-bezier(.4,0,.2,1)',
        zIndex: 40,
      }}>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{
            position: 'absolute', right: -10, top: 17,
            width: 20, height: 20, borderRadius: '50%',
            background: 'var(--s3)', border: '1px solid var(--b2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--dim)', zIndex: 50, padding: 0,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
            style={{ transform: collapsed ? 'scaleX(-1)' : 'none', transition: 'transform .22s' }}>
            <path d="M7 1L3 5l4 4" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* ── Logo row ────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '13px 12px 12px',
          borderBottom: '1px solid var(--b1)',
          flexShrink: 0, overflow: 'hidden', whiteSpace: 'nowrap',
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            border: `1px solid ${ACCENT.border}`,
            background: ACCENT.bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 13, color: ACCENT.color,
          }}>
            P2
          </div>
          {!collapsed && (
            <div>
              <div style={{
                fontFamily: 'var(--fh)', fontWeight: 800, fontSize: fs(15, screenTier),
                color: 'var(--text)', letterSpacing: '-.01em', lineHeight: 1,
              }}>
                ProjMan2
              </div>
              <span style={{
                fontSize: fs(9, screenTier), fontWeight: 600, letterSpacing: '.09em',
                textTransform: 'uppercase',
                background: ACCENT.bg, color: ACCENT.color,
                border: `1px solid ${ACCENT.border}`,
                borderRadius: 3, padding: '1px 5px',
                marginTop: 3, display: 'inline-block',
              }}>
                Office Console
              </span>
            </div>
          )}
        </div>

        {/* ── Nav scroll ──────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 0' }}>
          {NAV.map(section => (
            <div key={section.group || 'root'} style={{ marginBottom: 2 }}>
              {section.group && (
                <div style={{
                  fontSize: fs(9, screenTier), fontWeight: 600, letterSpacing: '1.05px',
                  textTransform: 'uppercase', color: 'var(--muted)',
                  padding: collapsed ? '8px 0 2px' : '7px 12px 2px',
                  whiteSpace: 'nowrap', overflow: 'hidden',
                  opacity: collapsed ? 0 : 1,
                  height: collapsed ? 0 : 'auto',
                  transition: 'opacity .15s',
                  pointerEvents: 'none',
                }}>
                  {section.group}
                </div>
              )}
              {section.items.map(item => {
                // mock items never show as active (they point to real pages as proxy)
                const active = !item.mock && isMatch(item.href, item.exact, pathname);
                return (
                  <NavItem
                    key={item.k}
                    href={item.href}
                    label={item.label}
                    navKey={item.k}
                    badge={item.badge}
                    mock={item.mock}
                    tooltip={item.tooltip}
                    active={active}
                    collapsed={collapsed}
                    screenTier={screenTier}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* ── User footer ─────────────────────────────────────────────── */}
        <div style={{
          borderTop: '1px solid var(--b1)',
          padding: collapsed ? '10px 0' : '10px 12px',
          flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 8,
          justifyContent: collapsed ? 'center' : 'flex-start',
          overflow: 'hidden', whiteSpace: 'nowrap',
        }}>
          <div title={collapsed ? (userName || 'User') : undefined} style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: ACCENT.avatarBg,
            border: `1px solid ${ACCENT.avatarBorder}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--fh)', fontWeight: 700, fontSize: fs(11, screenTier),
            color: ACCENT.color,
          }}>
            {initials}
          </div>
          {!collapsed && (
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{
                fontSize: fs(12, screenTier), fontWeight: 500, color: 'var(--text)',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {userName || 'User'}
              </div>
              <span style={{
                fontSize: fs(9, screenTier), fontWeight: 600, letterSpacing: '.06em',
                textTransform: 'uppercase',
                padding: '1px 5px', borderRadius: 3,
                background: roleStyle.bg, color: roleStyle.color,
                border: `1px solid ${roleStyle.border}`,
                display: 'inline-block', marginTop: 2,
              }}>
                {roleKey.replace(/_/g, ' ')}
              </span>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={() => setConfirmLogout(true)}
              title="Log out"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--muted)', fontSize: fs(13, screenTier), padding: '2px 4px',
                lineHeight: 1, flexShrink: 0, transition: 'color .12s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--muted)'}
            >
              ⏻
            </button>
          )}
        </div>
      </aside>

      {/* Logout confirm modal */}
      {confirmLogout && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          }}
          onClick={() => setConfirmLogout(false)}
        >
          <div
            style={{
              background: 'var(--s1)', border: '2px solid var(--b2)',
              borderRadius: 12, padding: '22px 20px', width: 280,
              boxShadow: '0 20px 60px rgba(0,0,0,.25)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: fs(15, screenTier), fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
              Log out?
            </div>
            <div style={{ fontSize: fs(12, screenTier), color: 'var(--dim)', marginBottom: 18 }}>
              You will need to sign in again to continue.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setConfirmLogout(false)}
                style={{
                  flex: 1, padding: '7px', borderRadius: 7,
                  border: '1px solid var(--b2)', background: 'transparent',
                  color: 'var(--dim)', fontSize: fs(12, screenTier), cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => { if (onLogout) onLogout(); }}
                style={{
                  flex: 1, padding: '7px', borderRadius: 7,
                  border: 'none', background: 'var(--red)',
                  color: '#fff', fontSize: fs(12, screenTier), fontWeight: 600, cursor: 'pointer',
                }}
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── NavItem ───────────────────────────────────────────────────────────────────
// mock:true → 55% opacity, "soon" badge, still navigates (proxy href)
function NavItem({ href, label, navKey, badge, mock, tooltip, active, collapsed, screenTier }) {
  const [hovered, setHovered] = useState(false);
  const iconColor = active
    ? ACCENT.color
    : mock ? 'var(--muted)'
    : hovered ? 'var(--text)' : 'var(--dim)';

  // collapsed: always show label as title; expanded mock: show tooltip if defined
  const titleAttr = collapsed ? label : (mock && tooltip ? tooltip : undefined);

  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }}
      title={titleAttr}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 11,
          padding: collapsed ? '11px 0' : '10px 14px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          borderRight: '3px solid ' + (active ? ACCENT.color : 'transparent'),
          background: active ? ACCENT.bg : hovered ? 'var(--s3)' : 'transparent',
          cursor: 'pointer', transition: 'background .12s',
          overflow: 'hidden', whiteSpace: 'nowrap',
          opacity: mock ? 0.55 : 1,
        }}
      >
        <span style={{
          color: iconColor, display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0, transition: 'color .12s',
        }}>
          <NavIcon k={navKey} />
        </span>

        {!collapsed && (
          <span style={{
            fontSize: fs(14, screenTier), flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis',
            color: active ? ACCENT.color
              : mock ? 'var(--muted)'
              : hovered ? 'var(--text)' : 'var(--dim)',
            fontWeight: active ? 700 : 500, transition: 'color .12s',
          }}>
            {label}
          </span>
        )}

        {/* Real numeric badge */}
        {!collapsed && !mock && badge > 0 && (
          <span style={{
            fontSize: fs(9, screenTier), fontWeight: 700,
            background: 'var(--rdim)', color: 'var(--red)',
            borderRadius: 8, padding: '1px 5px', flexShrink: 0,
          }}>
            {badge}
          </span>
        )}

        {/* Mock "soon" badge */}
        {!collapsed && mock && (
          <span style={{
            fontSize: fs(9, screenTier), fontWeight: 600,
            background: 'var(--s4)', color: 'var(--muted)',
            borderRadius: 8, padding: '1px 5px', flexShrink: 0, letterSpacing: '.02em',
          }}>
            soon
          </span>
        )}

        {!collapsed && active && (
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: ACCENT.color, flexShrink: 0 }} />
        )}
      </div>
    </Link>
  );
}
