// /admin/devices — cross-tenant device/pairing status (read-only monitoring).
'use client';

import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalTable }   from '@/components/portal/PortalTable';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { PortalPagination } from '@/components/portal/PortalPagination';
import { usePortalData } from '@/components/portal/usePortalData';
import { adminApi }      from '@/lib/api';
import { useState }      from 'react';

const STATUS_BADGE = { active: 'badge-active', revoked: 'badge-revoked', suspended: 'badge-pending' };
const fmtWhen = (v) => v ? new Date(v).toLocaleString('en-AU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export default function AdminDevices() {
  const [page, setPage] = useState(1);
  const { data, loading, error } = usePortalData(() => adminApi.devices({ page }), [page]);
  const devices = data?.data?.devices ?? [];
  const pg = data?.data?.pagination;

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Devices</h1>
      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}
      <PortalCard title="Paired devices (all organisations)">
        {loading ? <PortalEmpty message="Loading…" />
          : devices.length === 0 ? <PortalEmpty message="No devices" />
          : (
          <>
            <PortalTable
              headers={['Device', 'Organisation', 'User', 'Platform', 'Role', 'Status', 'Last seen']}
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
      </PortalCard>
    </div>
  );
}
