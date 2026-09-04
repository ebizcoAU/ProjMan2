// /admin/devices — cross-tenant device/pairing status (read-only monitoring).
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

const STATUS_BADGE = { active: 'badge-active', revoked: 'badge-revoked', suspended: 'badge-pending' };
const fmtWhen = (v) => v ? new Date(v).toLocaleString('en-AU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const HEADERS = [
  { label: 'Device', key: 'name' }, { label: 'Organisation', key: 'org' },
  { label: 'User', key: 'user' }, { label: 'Platform', key: 'platform' },
  { label: 'Role', key: 'role' }, { label: 'Status', key: 'status' },
  { label: 'Last seen', key: 'last_seen' },
];

export default function AdminDevices() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const { sortKey, sortDir, onSort } = useSort('last_seen', 'desc');
  const { pageSize, containerRef } = useAutoPageSize({ fallback: 20 });
  const { data, loading, error } = usePortalData(
    () => adminApi.devices({ page, search, sort_by: sortKey, sort_dir: sortDir, limit: pageSize }),
    [page, search, sortKey, sortDir, pageSize]
  );
  const devices = data?.data?.devices ?? [];
  const pg = data?.data?.pagination;
  const sort = (key) => { onSort(key); setPage(1); };
  const onSearch = (v) => { setSearchInput(v); setPage(1); };

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Devices</h1>
      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}
      <PortalCard title="Paired devices (all organisations)">
        <div style={{ marginBottom: 12 }}>
          <PortalSearchBox value={searchInput} onChange={onSearch} placeholder="Search device, user, organisation, role or platform…" />
        </div>
        {/* containerRef immediately above the table (not around the search box
            above) — see the matching note in admin/users/page.js. */}
        <div ref={containerRef}>
          {loading ? <PortalEmpty message="Loading…" />
            : devices.length === 0 ? <PortalEmpty message={search ? `No devices match “${search}”` : 'No devices'} />
            : (
            <>
              <PortalTable
                headers={HEADERS}
                sortKey={sortKey} sortDir={sortDir} onSort={sort}
                rows={devices.map(d => [
                  <span key="n" style={{ color: 'var(--text)', fontWeight: 600 }}>{d.device_name || '—'}</span>,
                  d.org_name,
                  d.user_name || '—',
                  [d.platform, d.model].filter(Boolean).join(' · ') || '—',
                  <span key="r" style={{ fontFamily: 'var(--fm)', fontSize: 12 }}>{d.role}</span>,
                  <span key="s" className={`badge ${STATUS_BADGE[d.status] || 'badge-muted'}`}>{d.status}</span>,
                  fmtWhen(d.last_seen_at),
                ])}
              />
              {pg && <PortalPagination page={pg.page} pages={pg.pages} total={pg.total} unit="devices" onPage={setPage} />}
            </>
          )}
        </div>
      </PortalCard>
    </div>
  );
}
