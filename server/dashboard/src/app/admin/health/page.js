// /admin/health — system health (dashboard spec §5.6, G1). admin only, like the API route.
// MySQL reachability, local geolocation, and sync activity/failures in the last 24h. Platform
// data only: the recent-error rows name an org id and a table, never a record's content.
'use client';

import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalTable }   from '@/components/portal/PortalTable';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { RefreshBar }    from '@/components/portal/RefreshBar';
import { usePortalData } from '@/components/portal/usePortalData';
import { adminApi }      from '@/lib/api';

const fmtWhen = (v) => v ? new Date(v).toLocaleString('en-AU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export default function AdminHealth() {
  const { data, loading, error, refetch, updatedAt } = usePortalData(() => adminApi.health(), [], { refreshMs: 60000 });
  const h = data?.data;
  const mysqlOk = h?.mysql === 'ok';
  const failRate = h?.sync?.cycles24h ? Math.round((h.sync.failed24h / h.sync.cycles24h) * 1000) / 10 : 0;

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 700 }}>System Health</h1>
        <RefreshBar updatedAt={updatedAt} onRefresh={refetch} />
      </div>
      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}
      {loading ? <PortalEmpty message="Loading…" /> : h && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            <PortalKpi label="Database" value={mysqlOk ? 'Reachable' : 'ERROR'} />
            <PortalKpi label="Geolocation" value={h.geo === 'local' ? 'Local (GeoLite2)' : 'Off'} />
            <PortalKpi label="Sync cycles (24h)" value={String(h.sync.cycles24h)} />
            <PortalKpi label="Sync failures (24h)" value={`${h.sync.failed24h} (${failRate}%)`} />
          </div>
          <PortalCard title="Recent sync failures">
            {h.sync.recentErrors.length === 0
              ? <PortalEmpty message="No sync failures recorded" />
              : <PortalTable
                  headers={['When', 'Org', 'Type', 'Table', 'Error']}
                  rows={h.sync.recentErrors.map((e) => [
                    fmtWhen(e.started_at),
                    <span key="o" style={{ fontFamily: 'var(--fm)', fontSize: 12 }}>{e.org_id}</span>,
                    e.sync_type, e.table_name || '—', e.error_message || '—',
                  ])}
                />}
          </PortalCard>
        </>
      )}
    </div>
  );
}
