// /admin/orgs — organisation directory (registration, plan, counts).
'use client';

import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalTable }   from '@/components/portal/PortalTable';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { PortalPagination } from '@/components/portal/PortalPagination';
import { usePortalData } from '@/components/portal/usePortalData';
import { adminApi }      from '@/lib/api';
import { useState }      from 'react';

const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-AU') : '—';
const STATUS_BADGE = { active: 'badge-active', suspended: 'badge-pending', disabled: 'badge-revoked' };

export default function AdminOrgs() {
  const [page, setPage] = useState(1);
  const { data, loading, error } = usePortalData(() => adminApi.orgs({ page }), [page]);
  const orgs = data?.data?.organisations ?? [];
  const pg = data?.data?.pagination;

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Organisations</h1>
      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}
      <PortalCard title="Registered organisations">
        {loading ? <PortalEmpty message="Loading…" />
          : orgs.length === 0 ? <PortalEmpty message="No organisations" />
          : (
          <>
            <PortalTable
              headers={['Organisation', 'ABN', 'State', 'Plan', 'Status', 'Users', 'Devices', 'Registered']}
              rows={orgs.map(o => [
                <span key="n" style={{ color: 'var(--text)', fontWeight: 600 }}>{o.name}</span>,
                o.abn || '—', o.state || '—',
                <span key="p" className="badge badge-muted">{o.plan}</span>,
                <span key="s" className={`badge ${STATUS_BADGE[o.status] || 'badge-muted'}`}>{o.status}</span>,
                o.users, o.devices, fmtDate(o.created_at),
              ])}
            />
            {pg && <PortalPagination page={pg.page} pages={pg.pages} total={pg.total} unit="orgs" onPage={setPage} />}
          </>
        )}
      </PortalCard>
    </div>
  );
}
