// /projects — first domain page: list + create against the new /projects API.
// Uses the same ported kit as /devices; grows into the full project workspace
// (stages, tasks, Gantt) in later steps.
'use client';

import { useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalTable }   from '@/components/portal/PortalTable';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi }   from '@/lib/api';

const STATUS_BADGE = {
  draft:     'badge-muted',
  active:    'badge-active',
  on_hold:   'badge-pending',
  completed: 'badge-muted',
  archived:  'badge-muted',
};

const fmtMoney = (v) =>
  v == null ? '—' : Number(v).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-AU');
};

export default function ProjectsPage() {
  const { data, loading, error, refetch } = usePortalData(() => projectsApi.list());
  const [showNew, setShowNew] = useState(false);
  const [form, setForm]       = useState({ code: '', name: '', site_address: '' });
  const [saveError, setSaveError] = useState(null);
  const [busy, setBusy]       = useState(false);

  const projects = data?.data?.projects ?? [];
  const active   = projects.filter(p => p.status === 'active');

  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setSaveError(null);
    try {
      await projectsApi.create(form);
      setForm({ code: '', name: '', site_address: '' });
      setShowNew(false);
      await refetch();
    } catch (err) {
      setSaveError(err?.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 1200 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 12, marginBottom: 16,
      }}>
        <PortalKpi label="Projects" value={projects.length} color="var(--text)" />
        <PortalKpi label="Active" value={active.length} color="var(--green)" />
        <PortalKpi
          label="Contract value (active)"
          value={fmtMoney(active.reduce((s, p) => s + (Number(p.contract_value) || 0), 0))}
          color="var(--brand)"
        />
      </div>

      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}

      <PortalCard title="Projects">
        <div style={{ marginBottom: 12 }}>
          <button className="btn btn-primary" onClick={() => setShowNew(s => !s)}>
            {showNew ? 'Cancel' : '+ New Project'}
          </button>
        </div>

        {showNew && (
          <form onSubmit={create} style={{
            display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end',
            padding: 12, borderRadius: 8, background: 'var(--s2)',
            border: '1px solid var(--b1)', marginBottom: 14,
          }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>Code</label>
              <input className="input" style={{ width: 120 }} value={form.code} required
                onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="P-001" />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>Name</label>
              <input className="input" value={form.name} required
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Lot 42 — new dwelling" />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>Site address</label>
              <input className="input" value={form.site_address}
                onChange={e => setForm(f => ({ ...f, site_address: e.target.value }))} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Create'}
            </button>
            {saveError && <div style={{ width: '100%' }}><PortalError message={saveError} /></div>}
          </form>
        )}

        {loading ? (
          <PortalEmpty message="Loading…" />
        ) : projects.length === 0 ? (
          <PortalEmpty message="No projects yet. Create the first one above." />
        ) : (
          <PortalTable
            headers={['Code', 'Name', 'Customer', 'Site', 'Contract', 'Start', 'Due', 'Status']}
            rows={projects.map((p) => [
              <span key="c" style={{ fontFamily: 'var(--fm)', color: 'var(--text)', fontWeight: 600 }}>{p.code}</span>,
              <span key="n" style={{ color: 'var(--text)' }}>{p.name}</span>,
              p.customer_name || '—',
              p.site_address || '—',
              fmtMoney(p.contract_value),
              fmtDate(p.start_date),
              fmtDate(p.due_date),
              <span key="s" className={`badge ${STATUS_BADGE[p.status] || 'badge-muted'}`}>{p.status}</span>,
            ])}
          />
        )}
      </PortalCard>
    </div>
  );
}
