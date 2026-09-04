// /admin/users — cross-tenant user ACCOUNTS + account actions (account layer only).
//
// Browsing the full account directory (names, emails, orgs) is `admin`-only on the
// server now (routes/admin.js). `account`/`staff` still hold the ACTION
// (suspend/reactivate/force-logout) — they just don't get a list/search UI for it;
// they act on a user id they already have (e.g. from a support ticket), same as the
// server-side split.
//
// Grouped into two independently paginated/sortable tables — internal (platform-ops,
// @projman.internal) accounts vs tenant accounts — rather than one directory with the
// four platform-ops rows lost inside hundreds of tenant ones with no way to tell them
// apart (`scope=internal|tenant`, routes/admin.js).
'use client';

import { useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalTable }   from '@/components/portal/PortalTable';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { PortalPagination } from '@/components/portal/PortalPagination';
import { PortalSearchBox } from '@/components/portal/PortalSearchBox';
import { usePortalData } from '@/components/portal/usePortalData';
import { useSort }       from '@/components/portal/useSort';
import { useAutoPageSize } from '@/components/portal/useAutoPageSize';
import { useDebouncedValue } from '@/components/portal/useDebouncedValue';
import { adminApi }      from '@/lib/api';

const STATUS_BADGE = { active: 'badge-active', suspended: 'badge-pending', disabled: 'badge-revoked' };
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-AU') : '—';
const ACTIONS = [
  { k: 'suspend',       label: 'Suspend',      cls: 'btn-danger' },
  { k: 'reactivate',    label: 'Reactivate',   cls: 'btn-ghost' },
  { k: 'force-logout',  label: 'Force logout', cls: 'btn-ghost' },
];
const HEADERS = [
  { label: 'Name', key: 'name' }, { label: 'Email', key: 'email' },
  { label: 'Organisation', key: 'org' }, { label: 'Role', key: 'role' },
  { label: 'Status', key: 'status' }, { label: 'Last login', key: 'last_login' },
  'Actions',
];

// account/staff: no directory — a single-id action form, so acting on an account
// never requires (or grants) browsing the cross-tenant user list.
function ActByIdForm() {
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const act = async (action) => {
    if (!id.trim()) { setErr('Enter a user id first'); return; }
    setBusy(true); setErr(null); setResult(null);
    try {
      await adminApi.userAction(id.trim(), action);
      setResult(`${action.replace('-', ' ')} applied to ${id.trim()}`);
    } catch (e) { setErr(e?.response?.data?.message || e.message); }
    finally { setBusy(false); }
  };

  return (
    <PortalCard title="Act on a user account">
      <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 14 }}>
        This role doesn&rsquo;t browse the account directory — enter the user id
        (from a support ticket or the requester) and choose an action.
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          value={id} onChange={(e) => setId(e.target.value)} placeholder="User id"
          style={{ flex: 1, minWidth: 240, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14, fontFamily: 'var(--fm)' }}
        />
        {ACTIONS.map((a) => (
          <button key={a.k} className={`btn ${a.cls}`} disabled={busy} onClick={() => act(a.k)}>
            {a.label}
          </button>
        ))}
      </div>
      {err && <PortalError message={err} />}
      {result && !err && (
        <div style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--gdim)', color: 'var(--green)', fontSize: 13 }}>
          {result}
        </div>
      )}
    </PortalCard>
  );
}

// One scoped, paginated + sortable + searchable table — rendered for whichever tab
// (internal/tenant) is currently active. Each tab keeps its own filters/sort/page/
// search state even after switching away and back (mounted once per tab, not
// unmounted — see the `display: none` toggle in AdminUsers below).
function ScopedDirectory({ scope, subtitle, showOrgColumn = true }) {
  const [filters, setFilters] = useState({ status: '', role: '' });
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [page, setPage] = useState(1);
  const { sortKey, sortDir, onSort } = useSort('created', 'desc');
  const { pageSize, containerRef } = useAutoPageSize({ fallback: 20 });

  const { data, loading, error, refetch } = usePortalData(
    () => adminApi.users({ ...filters, scope, search, sort_by: sortKey, sort_dir: sortDir, page, limit: pageSize }),
    [filters.status, filters.role, scope, search, sortKey, sortDir, page, pageSize]
  );
  const [err, setErr] = useState(null);

  const users = data?.data?.users ?? [];
  const pg = data?.data?.pagination;

  const act = async (id, action) => {
    setErr(null);
    try { await adminApi.userAction(id, action); await refetch(); }
    catch (e) { setErr(e?.response?.data?.message || e.message); }
  };
  const set = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const sort = (key) => { onSort(key); setPage(1); };
  const onSearch = (v) => { setSearchInput(v); setPage(1); };

  const headers = showOrgColumn ? HEADERS : HEADERS.filter((h) => h.key !== 'org');

  return (
    <div>
      {(error || err) && <div style={{ marginBottom: 12 }}><PortalError message={error || err} /></div>}
      <PortalCard subtitle={subtitle}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <PortalSearchBox value={searchInput} onChange={onSearch} placeholder="Search email, phone, role or organisation…" />
          <select value={filters.status} onChange={(e) => set('status', e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14 }}>
            <option value="">All statuses</option>
            {['active', 'suspended', 'disabled'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* containerRef starts HERE, immediately above the table — not around the
            search/filter row above — so useAutoPageSize's fixed chrome estimate
            (table header + pagination + padding) isn't also eaten by this toolbar's
            own height, which used to make it under-count how much room the toolbar
            was taking and round up to the next page-size bucket (20 instead of the
            correct ~17). */}
        <div ref={containerRef}>
          {loading ? <PortalEmpty message="Loading…" />
            : users.length === 0 ? <PortalEmpty message={search ? `No accounts match “${search}”` : 'No accounts'} />
            : (
            <>
              <PortalTable
                headers={headers}
                sortKey={sortKey} sortDir={sortDir} onSort={sort}
                rows={users.map((u) => [
                  <span key="n" style={{ color: 'var(--text)', fontWeight: 600 }}>{u.full_name}</span>,
                  u.email,
                  ...(showOrgColumn ? [u.org_name] : []),
                  <span key="r" style={{ fontFamily: 'var(--fm)', fontSize: 12 }}>{u.role}</span>,
                  <span key="s" className={`badge ${STATUS_BADGE[u.status]}`}>{u.status}</span>,
                  fmtDate(u.last_login_at),
                  <span key="a" style={{ display: 'inline-flex', gap: 6 }}>
                    {u.status === 'active'
                      ? <button className="btn btn-danger" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => act(u.id, 'suspend')}>Suspend</button>
                      : <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => act(u.id, 'reactivate')}>Reactivate</button>}
                    <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => act(u.id, 'force-logout')}>Force logout</button>
                  </span>,
                ])}
              />
              {pg && <PortalPagination page={pg.page} pages={pg.pages} total={pg.total} unit="accounts" onPage={setPage} />}
            </>
          )}
        </div>
      </PortalCard>
    </div>
  );
}

const TABS = [
  { key: 'internal', label: 'Internal Accounts' },
  { key: 'tenant',   label: 'Tenant Accounts' },
];

function FullDirectory() {
  const [tab, setTab] = useState('internal');
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--b1)' }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '9px 16px', fontSize: 14, fontWeight: tab === t.key ? 700 : 500,
              color: tab === t.key ? 'var(--blue)' : 'var(--dim)',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: `2px solid ${tab === t.key ? 'var(--blue)' : 'transparent'}`,
              marginBottom: -1,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Only the active tab mounts — display:none would break useAutoPageSize's
          height measurement (a hidden element's getBoundingClientRect is zeroed),
          and re-fetching on tab switch is cheap enough not to bother preserving
          the inactive tab's state. */}
      {tab === 'internal'
        ? <ScopedDirectory scope="internal" subtitle="Platform-ops accounts — @projman.internal — not tenant users" showOrgColumn={false} />
        : <ScopedDirectory scope="tenant" subtitle="Portal and App users across every organisation" />}
    </div>
  );
}

export default function AdminUsers() {
  const me = usePortalData(() => adminApi.me());
  const role = me.data?.data?.role;

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 700, marginBottom: 20 }}>User Accounts</h1>
      {!role ? <PortalEmpty message="Loading…" /> : role === 'admin' ? <FullDirectory /> : <ActByIdForm />}
    </div>
  );
}
