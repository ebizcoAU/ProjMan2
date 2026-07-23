// /admin/users — cross-tenant user ACCOUNTS + account actions (account layer only).
'use client';

import { useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalTable }   from '@/components/portal/PortalTable';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { PortalPagination } from '@/components/portal/PortalPagination';
import { usePortalData } from '@/components/portal/usePortalData';
import { adminApi }      from '@/lib/api';

const STATUS_BADGE = { active: 'badge-active', suspended: 'badge-pending', disabled: 'badge-revoked' };
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-AU') : '—';

export default function AdminUsers() {
  const [filters, setFilters] = useState({ status: '', role: '', page: 1 });
  const { data, loading, error, refetch } = usePortalData(
    () => adminApi.users({ ...filters }), [filters.status, filters.role, filters.page]);
  const [err, setErr] = useState(null);

  const users = data?.data?.users ?? [];
  const pg = data?.data?.pagination;

  const act = async (id, action) => {
    setErr(null);
    try { await adminApi.userAction(id, action); await refetch(); }
    catch (e) { setErr(e?.response?.data?.message || e.message); }
  };
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v, page: 1 }));

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 700, marginBottom: 20 }}>User Accounts</h1>
      {(error || err) && <div style={{ marginBottom: 12 }}><PortalError message={error || err} /></div>}

      <PortalCard title="Accounts (all organisations)">
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <select value={filters.status} onChange={e => set('status', e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14 }}>
            <option value="">All statuses</option>
            {['active', 'suspended', 'disabled'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {loading ? <PortalEmpty message="Loading…" />
          : users.length === 0 ? <PortalEmpty message="No accounts" />
          : (
          <>
            <PortalTable
              headers={['Name', 'Email', 'Organisation', 'Role', 'Status', 'Last login', 'Actions']}
              rows={users.map(u => [
                <span key="n" style={{ color: 'var(--text)', fontWeight: 600 }}>{u.full_name}</span>,
                u.email,
                u.org_name,
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
            {pg && <PortalPagination page={pg.page} pages={pg.pages} total={pg.total} unit="accounts" onPage={p => setFilters(f => ({ ...f, page: p }))} />}
          </>
        )}
      </PortalCard>
    </div>
  );
}
