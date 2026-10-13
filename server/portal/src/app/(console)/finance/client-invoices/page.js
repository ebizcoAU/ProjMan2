// /finance/client-invoices — every client invoice across the org's projects (xprojman-43 §6):
// drafts waiting to be issued, what's outstanding, what's overdue (14-day terms, §2.3).
// money.read; the per-project view of the same rows is the project's Invoices tab.
'use client';

import { accountingGate } from '@/components/portal/AccountingGate';
import { useEffect, useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, authApi } from '@/lib/api';
import { clientInvoicesApi, seedMockProjects } from '@/lib/clientInvoices';
import { ClientInvoicesMockBanner, InvoiceTotals, InvoiceTable } from '@/components/portal/ClientInvoiceViews';

const FILTERS = [
  { k: '', label: 'All' }, { k: 'draft', label: 'Drafts' }, { k: 'issued', label: 'Outstanding' },
  { k: 'overdue', label: 'Overdue' }, { k: 'paid', label: 'Paid' }, { k: 'void', label: 'Void' },
];

function ClientInvoicesPage() {
  const perms = usePortalData(() => authApi.permissions());
  const canRead = (perms.data?.data?.permissions || []).includes('money.read');
  const projects = usePortalData(() => projectsApi.list());
  const projectList = projects.data?.data?.projects;

  const [filter, setFilter] = useState({ status: '', project_id: '' });
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!canRead || !projectList) return;
    seedMockProjects(projectList);
    let live = true;
    setErr(null);
    const params = Object.fromEntries(Object.entries(filter).filter(([, v]) => v));
    clientInvoicesApi.list(params)
      .then((res) => { if (live) setData(res?.data?.data || null); })
      .catch((e) => { if (live) setErr(e?.response?.data?.message || e.message); });
    return () => { live = false; };
  }, [canRead, projectList, filter]);

  if (perms.loading && !perms.data) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (!canRead) return <div style={{ padding: 20 }}><PortalError message="Client invoices need the money.read permission." /></div>;

  return (
    <div style={{ padding: 20, maxWidth: 1200 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Client Invoices</div>
      <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 14 }}>
        One tax invoice per billing milestone. A draft is created when the milestone is reached; you review and issue it.
      </div>
      <ClientInvoicesMockBanner />
      <InvoiceTotals totals={data?.totals} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button key={f.k} className={`btn ${filter.status === f.k ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilter((x) => ({ ...x, status: f.k }))}>{f.label}</button>
        ))}
        <select className="input" style={{ marginLeft: 'auto', maxWidth: 280 }} value={filter.project_id}
          onChange={(e) => setFilter((x) => ({ ...x, project_id: e.target.value }))}>
          <option value="">All projects</option>
          {(projectList || []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
        </select>
      </div>

      <PortalCard title="Invoices">
        {err ? <PortalError message={err} />
          : !data ? <PortalEmpty message="Loading…" />
          : <InvoiceTable rows={data.client_invoices || []} showProject />}
      </PortalCard>
    </div>
  );
}

export default accountingGate(ClientInvoicesPage);
