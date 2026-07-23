// /organisation/settings — Admin module: org profile (Portal build step 6).
// View + edit the organisation (name, ABN, address, contact). PATCH /organisation
// re-validates a changed ABN server-side. org.manage gated (projectManager).
'use client';

import { useState, useEffect } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { organisationApi } from '@/lib/api';

const STATES = ['WA', 'SA', 'NT', 'QLD', 'NSW', 'VIC', 'TAS', 'ACT'];
const ABN_BADGE = { abr: 'badge-active', checksum: 'badge-pending', no: 'badge-revoked' };

export default function SettingsPage() {
  const { data, loading, error, refetch } = usePortalData(() => organisationApi.get());
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const org = data?.data?.organisation;
  const counts = data?.data?.counts;

  useEffect(() => {
    if (org && !form) setForm({
      name: org.name || '', abn: org.abn || '', address: org.address || '', suburb: org.suburb || '',
      state: org.state || '', postcode: org.postcode || '', phone: org.phone || '', email: org.email || '',
    });
  }, [org, form]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setSaveError(null); setMsg(null);
    try {
      // Only send changed fields; ABN only if it changed (triggers re-validation).
      const body = {};
      for (const k of Object.keys(form)) if ((org[k] || '') !== form[k]) body[k] = form[k];
      if (Object.keys(body).length === 0) { setMsg('No changes.'); setBusy(false); return; }
      await organisationApi.patch(body);
      setMsg('Saved.');
      await refetch();
    } catch (err) { setSaveError(err?.response?.data?.message || err.message); }
    finally { setBusy(false); }
  };

  if (loading || !form) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (error) return <div style={{ padding: 20 }}><PortalError message={error} /></div>;

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div style={{ padding: 20, maxWidth: 720 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 16 }}>
        <PortalKpi label="Plan" value={org.plan} color="var(--brand)" />
        <PortalKpi label="Users" value={counts?.users ?? '—'} color="var(--text)" />
        <PortalKpi label="Active devices" value={counts?.devices ?? '—'} color="var(--cyan)" />
        <PortalKpi label="Status" value={org.status} color={org.status === 'active' ? 'var(--green)' : 'var(--red)'} />
      </div>

      <PortalCard title="Organisation profile">
        <form onSubmit={save} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Organisation name" wide><input className="input" value={form.name} onChange={set('name')} required /></Field>
          <Field label={<>ABN {org.abn_validated && <span className={`badge ${ABN_BADGE[org.abn_validated]}`} style={{ marginLeft: 6 }}>{org.abn_validated}</span>}</>}>
            <input className="input" value={form.abn} onChange={set('abn')} placeholder="11 digits" />
          </Field>
          <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="Address" wide><input className="input" value={form.address} onChange={set('address')} /></Field>
          <Field label="Suburb"><input className="input" value={form.suburb} onChange={set('suburb')} /></Field>
          <Field label="State">
            <select className="input" value={form.state} onChange={set('state')}>
              <option value="">—</option>
              {STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Postcode"><input className="input" value={form.postcode} onChange={set('postcode')} /></Field>
          <Field label="Email" wide><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>

          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
            {msg && <span style={{ color: 'var(--green)', fontSize: 14 }}>{msg}</span>}
          </div>
          {saveError && <div style={{ gridColumn: '1 / -1' }}><PortalError message={saveError} /></div>}
        </form>
      </PortalCard>
    </div>
  );
}

function Field({ label, children, wide }) {
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}
