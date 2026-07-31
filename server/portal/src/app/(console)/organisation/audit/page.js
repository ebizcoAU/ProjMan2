// /organisation/audit — Admin module: the org's audit trail (Portal build step 6).
// Read-only view of GET /organisation/audit (org.manage gated). Evidentiary from day
// one — "who did what, from which device" (the brief's insistence).
'use client';

import { useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalTable }   from '@/components/portal/PortalTable';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { organisationApi } from '@/lib/api';

const ACTION_COLOR = (a) =>
  a.startsWith('auth.') ? 'var(--blue)'
  : a.startsWith('device') || a.startsWith('pairing') ? 'var(--cyan)'
  : a.startsWith('stage') || a.startsWith('project') ? 'var(--brand)'
  : a.startsWith('recovery') ? 'var(--red)'
  : 'var(--dim)';

const fmtWhen = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v)
    : d.toLocaleString('en-AU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export default function AuditPage() {
  const [entity, setEntity] = useState('');
  const { data, loading, error } = usePortalData(
    () => organisationApi.audit(entity ? { entity, limit: 200 } : { limit: 200 }), [entity]);
  const entries = data?.data?.entries ?? [];

  const entities = ['', 'users', 'devices', 'projects', 'project_stages', 'organisations', 'pairing_tokens'];

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}

      <PortalCard title="Audit log">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>Entity</label>
          <select value={entity} onChange={e => setEntity(e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 6, fontSize: 14, border: '1px solid var(--b1)', background: 'var(--s1)', color: 'var(--text)' }}>
            {entities.map(en => <option key={en} value={en}>{en || 'All'}</option>)}
          </select>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{entries.length} recent entries</span>
        </div>

        {loading ? <PortalEmpty message="Loading…" />
          : entries.length === 0 ? <PortalEmpty message="No audit entries." />
          : (
          <PortalTable
            headers={['When', 'Action', 'User', 'Entity', 'Device', 'IP']}
            rows={entries.map(a => [
              <span key="w" style={{ fontFamily: 'var(--fm)', fontSize: 12, whiteSpace: 'nowrap' }}>{fmtWhen(a.created_at)}</span>,
              <span key="a" style={{ fontFamily: 'var(--fm)', fontSize: 12, fontWeight: 600, color: ACTION_COLOR(a.action) }}>{a.action}</span>,
              a.user_name || a.user_email || '—',
              a.entity ? <span key="e" style={{ fontFamily: 'var(--fm)', fontSize: 12 }}>{a.entity}{a.entity_id ? `#${String(a.entity_id).slice(0, 8)}` : ''}</span> : '—',
              a.device_id ? String(a.device_id).slice(0, 14) : '—',
              a.ip || '—',
            ])}
          />
        )}
      </PortalCard>
    </div>
  );
}
