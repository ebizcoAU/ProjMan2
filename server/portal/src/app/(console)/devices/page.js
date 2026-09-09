// /devices — the port's proof-of-concept page (servdesignspecification §5.3:
// Nexus `thiet-bi` → Devices). Wires the ported kit to GET /devices, /sync/status,
// POST /devices/:id/revoke and /devices/:id/role.
'use client';

import { useState } from 'react';
import { PortalCard }       from '@/components/portal/PortalCard';
import { PortalKpi }        from '@/components/portal/PortalKpi';
import { PortalTable }      from '@/components/portal/PortalTable';
import { PortalEmpty }      from '@/components/portal/PortalEmpty';
import { PortalError }      from '@/components/portal/PortalError';
import { usePortalData }    from '@/components/portal/usePortalData';
import { devicesApi, syncApi } from '@/lib/api';
import { usePortalDialog } from '@/components/portal/PortalDialog';

const ROLES = ['org_admin', 'project_developer', 'project_manager', 'supervisor', 'tradie', 'customer'];

const fmtWhen = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-AU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

function StatusBadge({ status }) {
  const cls = status === 'active' ? 'badge-active'
    : status === 'revoked' ? 'badge-revoked' : 'badge-pending';
  return <span className={`badge ${cls}`}>{status}</span>;
}

export default function DevicesPage() {
  const { data, loading, error, refetch } = usePortalData(() => devicesApi.list());
  const sync = usePortalData(() => syncApi.status());
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const { confirm } = usePortalDialog();

  const devices = data?.data?.devices ?? [];
  const active  = devices.filter(d => d.status === 'active');
  const revoked = devices.filter(d => d.status === 'revoked');
  const syncData = sync.data?.data;

  const revoke = async (d) => {
    const ok = await confirm(`Revoke "${d.name || d.uid}"? Its next call to the server will fail.`,
      { title: 'Revoke device', confirmLabel: 'Revoke', danger: true });
    if (!ok) return;
    setBusyId(d.id); setActionError(null);
    try { await devicesApi.revoke(d.id); await refetch(); }
    catch (err) { setActionError(err?.response?.data?.message || err.message); }
    finally { setBusyId(null); }
  };

  const changeRole = async (d, role) => {
    if (!role || role === d.role) return;
    setBusyId(d.id); setActionError(null);
    try { await devicesApi.setRole(d.id, role); await refetch(); }
    catch (err) { setActionError(err?.response?.data?.message || err.message); }
    finally { setBusyId(null); }
  };

  return (
    <div style={{ padding: 20, maxWidth: 1200 }}>
      {/* ── KPIs ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 12, marginBottom: 16,
      }}>
        <PortalKpi label="Paired devices" value={devices.length} color="var(--text)" />
        <PortalKpi label="Active" value={active.length} color="var(--green)" />
        <PortalKpi label="Revoked" value={revoked.length} color="var(--red)" />
        <PortalKpi
          label="Sync tables"
          value={syncData?.tables?.length ?? '—'}
          color="var(--cyan)"
          sub={syncData ? `server time ${fmtWhen(syncData.serverTime)}` : ''}
        />
      </div>

      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}
      {actionError && <div style={{ marginBottom: 12 }}><PortalError message={actionError} /></div>}

      {/* ── Device list ── */}
      <PortalCard title="Devices — roles and last seen">
        {loading ? (
          <PortalEmpty message="Loading…" />
        ) : devices.length === 0 ? (
          <PortalEmpty message="No devices paired yet. The first field-app login registers one." />
        ) : (
          <PortalTable
            headers={['Device', 'User', 'Platform', 'Role', 'Status', 'Last seen', '']}
            rows={devices.map((d) => [
              <span key="n" style={{ color: 'var(--text)', fontWeight: 600 }}>
                {d.name || d.uid}
                {d.isPrimary && (
                  <span className="badge badge-pending" style={{ marginLeft: 6 }}>primary</span>
                )}
              </span>,
              d.user ? `${d.user.name}` : '—',
              [d.platform, d.model].filter(Boolean).join(' · ') || '—',
              <select
                key="r"
                value={d.role}
                disabled={busyId === d.id || d.status !== 'active'}
                onChange={(e) => changeRole(d, e.target.value)}
                style={{
                  padding: '4px 6px', borderRadius: 6, fontSize: 13,
                  border: '1px solid var(--b2)', background: 'var(--s1)', color: 'var(--text)',
                }}
              >
                {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
              </select>,
              <StatusBadge key="s" status={d.status} />,
              fmtWhen(d.lastSeenAt),
              d.status === 'active' ? (
                <button key="a" className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 13 }}
                  disabled={busyId === d.id} onClick={() => revoke(d)}>
                  Revoke
                </button>
              ) : <span key="a" />,
            ])}
          />
        )}
      </PortalCard>

      {/* ── Sync status ── */}
      <PortalCard title="Sync">
        {sync.error ? (
          <PortalError message={sync.error} />
        ) : !syncData ? (
          <PortalEmpty message="Loading…" />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12, fontSize: 14, color: 'var(--dim)' }}>
              <span>Last cycle: <strong style={{ color: 'var(--text)' }}>
                {syncData.lastCycle
                  ? `${syncData.lastCycle.sync_type} · ${syncData.lastCycle.records_synced} record(s) · ${syncData.lastCycle.status}`
                  : 'none yet'}
              </strong></span>
              {syncData.lastCycle?.started_at && <span>at {fmtWhen(syncData.lastCycle.started_at)}</span>}
            </div>
            <PortalTable
              headers={['Table', 'System of record', 'Pulled to devices']}
              rows={(syncData.tables || []).map(t => [
                <span key="t" style={{ fontFamily: 'var(--fm)', color: 'var(--text)' }}>{t.name}</span>,
                t.owner === 'app' ? 'Field app' : 'Web console',
                t.pull ? 'yes' : 'no',
              ])}
            />
          </>
        )}
      </PortalCard>
    </div>
  );
}
