// /finance/client-invoices/:id — one client invoice (xprojman-43 §6): the tax-invoice
// facts, and issue / adjust (draft), record payment / void (issued) for money.write.
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { useTopbarOverride } from '@/components/portal/chrome';
import { projectsApi, authApi } from '@/lib/api';
import { seedMockProjects } from '@/lib/clientInvoices';
import { ClientInvoicesMockBanner, InvoiceDetail } from '@/components/portal/ClientInvoiceViews';

export default function ClientInvoicePage() {
  const { id } = useParams();
  useTopbarOverride({ title: 'Client Invoice', subtitle: 'Finance', backHref: '/finance/client-invoices' });
  const perms = usePortalData(() => authApi.permissions());
  const list = perms.data?.data?.permissions || [];
  const projects = usePortalData(() => projectsApi.list());
  const projectList = projects.data?.data?.projects;
  const [seeded, setSeeded] = useState(false);
  useEffect(() => { if (projectList) { seedMockProjects(projectList); setSeeded(true); } }, [projectList]);

  if ((perms.loading && !perms.data) || !seeded) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (!list.includes('money.read')) return <div style={{ padding: 20 }}><PortalError message="Client invoices need the money.read permission." /></div>;

  return (
    <div style={{ padding: 20, maxWidth: 900 }}>
      <ClientInvoicesMockBanner />
      <PortalCard title="Invoice">
        <InvoiceDetail invoiceId={id} canWrite={list.includes('money.write')} />
      </PortalCard>
    </div>
  );
}
