// /admin/orgs — organisation directory (registration, plan, counts). A row click
// drills into /admin/orgs/[id] for that org's detail + billing/payment history.
'use client';

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
import { useState }      from 'react';
import { useRouter }     from 'next/navigation';

const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-AU') : '—';
const STATUS_BADGE = { active: 'badge-active', suspended: 'badge-pending', disabled: 'badge-revoked' };
const HEADERS = [
  { label: 'Organisation', key: 'name' }, { label: 'ABN', key: 'abn' },
  { label: 'State', key: 'state' }, { label: 'Plan', key: 'plan' },
  { label: 'Status', key: 'status' }, { label: 'Users', key: 'users' },
  { label: 'Devices', key: 'devices' }, { label: 'Registered', key: 'created' },
];

export default function AdminOrgs() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const { sortKey, sortDir, onSort } = useSort('created', 'desc');
  const { pageSize, containerRef } = useAutoPageSize({ fallback: 20 });
  const { data, loading, error } = usePortalData(
    () => adminApi.orgs({ page, search, sort_by: sortKey, sort_dir: sortDir, limit: pageSize }),
    [page, search, sortKey, sortDir, pageSize]
  );
  const orgs = data?.data?.organisations ?? [];
  const pg = data?.data?.pagination;
  const sort = (key) => { onSort(key); setPage(1); };
  const onSearch = (v) => { setSearchInput(v); setPage(1); };
  const openOrg = (id) => router.push(`/admin/orgs/${id}`);

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Organisations</h1>
      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}
      <PortalCard title="Registered organisations" subtitle="Click a row for that organisation's detail and billing history">
        <div style={{ marginBottom: 12 }}>
          <PortalSearchBox value={searchInput} onChange={onSearch} placeholder="Search name, ABN, state or plan…" />
        </div>
        {/* containerRef immediately above the table (not around the search box
            above) — see the matching note in admin/users/page.js. */}
        <div ref={containerRef}>
          {loading ? <PortalEmpty message="Loading…" />
            : orgs.length === 0 ? <PortalEmpty message={search ? `No organisations match “${search}”` : 'No organisations'} />
            : (
            <>
              <PortalTable
                headers={HEADERS}
                sortKey={sortKey} sortDir={sortDir} onSort={sort}
                rows={orgs.map(o => [
                  <button key="n" onClick={() => openOrg(o.id)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--brand)', fontWeight: 600, fontSize: 13, textAlign: 'left' }}>
                    {o.name}
                  </button>,
                  o.abn || '—', o.state || '—',
                  <span key="p" className="badge badge-muted">{o.plan}</span>,
                  <span key="s" className={`badge ${STATUS_BADGE[o.status] || 'badge-muted'}`}>{o.status}</span>,
                  o.users, o.devices, fmtDate(o.created_at),
                ])}
              />
              {pg && <PortalPagination page={pg.page} pages={pg.pages} total={pg.total} unit="orgs" onPage={setPage} />}
            </>
          )}
        </div>
      </PortalCard>
    </div>
  );
}
