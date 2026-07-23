// /organisation/users — Admin module: the org's people (Portal build step 6).
// List, create (assignable roles from /auth/permissions), change role + status.
// All against live endpoints: GET/POST/PATCH /organisation/users. org.manage gated
// server-side (projectManager); a non-admin viewer gets 403 → shown as an error.
'use client';

import { useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalTable }   from '@/components/portal/PortalTable';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { organisationApi, authApi } from '@/lib/api';

const STATUS = ['active', 'suspended', 'disabled'];
const STATUS_BADGE = { active: 'badge-active', suspended: 'badge-pending', disabled: 'badge-revoked' };
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-AU') : '—';
const label = (r) => r.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());

export default function UsersPage() {
  const { data, loading, error, refetch } = usePortalData(() => organisationApi.users());
  const perms = usePortalData(() => authApi.permissions());
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', role: 'siteSupervisor', password: '', mobile: '' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const users = data?.data?.users ?? [];
  const assignable = perms.data?.data?.assignableRoles ?? [];

  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setActionError(null);
    try {
      await organisationApi.createUser(form);
      setForm({ full_name: '', email: '', role: 'siteSupervisor', password: '', mobile: '' });
      setShowNew(false);
      await refetch();
    } catch (err) { setActionError(err?.response?.data?.message || err.message); }
    finally { setBusy(false); }
  };

  const patch = async (id, body) => {
    setActionError(null);
    try { await organisationApi.patchUser(id, body); await refetch(); }
    catch (err) { setActionError(err?.response?.data?.message || err.message); }
  };

  const roleOptions = assignable.length ? assignable : [{ role: form.role, label: label(form.role) }];

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 16 }}>
        <PortalKpi label="Users" value={users.length} color="var(--text)" />
        <PortalKpi label="Active" value={users.filter(u => u.status === 'active').length} color="var(--green)" />
        <PortalKpi label="Suspended / disabled" value={users.filter(u => u.status !== 'active').length} color="var(--red)" />
      </div>

      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}
      {actionError && <div style={{ marginBottom: 12 }}><PortalError message={actionError} /></div>}

      <PortalCard title="Users">
        <div style={{ marginBottom: 12 }}>
          <button className="btn btn-primary" onClick={() => setShowNew(s => !s)}>
            {showNew ? 'Cancel' : '+ New User'}
          </button>
        </div>

        {showNew && (
          <form onSubmit={create} style={{
            display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end',
            padding: 12, borderRadius: 8, background: 'var(--s2)', border: '1px solid var(--b1)', marginBottom: 14,
          }}>
            <Field label="Full name"><input className="input" style={{ width: 180 }} required
              value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} /></Field>
            <Field label="Email"><input className="input" type="email" style={{ width: 200 }} required
              value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></Field>
            <Field label="Role">
              <select className="input" style={{ width: 160 }} value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {roleOptions.map(r => <option key={r.role} value={r.role}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="Mobile"><input className="input" style={{ width: 130 }}
              value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} /></Field>
            <Field label="Temp password"><input className="input" type="text" style={{ width: 150 }} required
              value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} /></Field>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create'}</button>
          </form>
        )}

        {loading ? <PortalEmpty message="Loading…" />
          : users.length === 0 ? <PortalEmpty message="No users yet." />
          : (
          <PortalTable
            headers={['Name', 'Email', 'Role', 'Status', 'Devices', 'Last login', '']}
            rows={users.map(u => [
              <span key="n" style={{ color: 'var(--text)', fontWeight: 600 }}>{u.full_name}</span>,
              u.email,
              <select key="r" value={u.role} onChange={e => patch(u.id, { role: e.target.value })}
                style={{ padding: '4px 6px', borderRadius: 6, fontSize: 13, border: '1px solid var(--b2)', background: 'var(--s1)', color: 'var(--text)' }}>
                {(assignable.length ? assignable : [{ role: u.role, label: label(u.role) }]).map(r =>
                  <option key={r.role} value={r.role}>{r.label}</option>)}
                {!assignable.some(r => r.role === u.role) && <option value={u.role}>{label(u.role)}</option>}
              </select>,
              <span key="s" className={`badge ${STATUS_BADGE[u.status]}`}>{u.status}</span>,
              u.device_count ?? 0,
              fmtDate(u.last_login_at),
              <select key="a" value={u.status} onChange={e => patch(u.id, { status: e.target.value })}
                style={{ padding: '4px 6px', borderRadius: 6, fontSize: 13, border: '1px solid var(--b2)', background: 'var(--s1)', color: 'var(--dim)' }}>
                {STATUS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>,
            ])}
          />
        )}
      </PortalCard>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}
