// /admin/users — cross-tenant user ACCOUNTS + account actions (account layer only).
//
// Browsing the full account directory (names, emails, orgs) is `admin`-only on the
// server now (routes/admin.js). `account`/`staff` still hold the ACTION
// (suspend/reactivate/force-logout) — they just don't get a list/search UI for it;
// they act on a user id they already have (e.g. from a support ticket), same as the
// server-side split.
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
const ACTIONS = [
  { k: 'suspend',       label: 'Suspend',      cls: 'btn-danger' },
  { k: 'reactivate',    label: 'Reactivate',   cls: 'btn-ghost' },
  { k: 'force-logout',  label: 'Force logout', cls: 'btn-ghost' },
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

function FullDirectory() {
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
    <>
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
    </>
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
