// /admin/orgs/[id] — one organisation's detail + its payment transaction history
// (the Organisations page's row-click drill-down). Billing/payments layer only —
// same account-layer-only boundary as the rest of /admin, no construction content.
'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalTable }   from '@/components/portal/PortalTable';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { PortalPagination } from '@/components/portal/PortalPagination';
import { usePortalData } from '@/components/portal/usePortalData';
import { adminApi }      from '@/lib/api';

const STATUS_BADGE = { active: 'badge-active', suspended: 'badge-pending', disabled: 'badge-revoked' };
const PAYMENT_BADGE = { paid: 'badge-active', overdue: 'badge-pending', failed: 'badge-revoked', refunded: 'badge-muted' };
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-AU') : '—';
const money = (v, ccy = 'AUD') => Number(v || 0).toLocaleString('en-AU', { style: 'currency', currency: ccy });

export default function AdminOrgDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [page, setPage] = useState(1);

  const org = usePortalData(() => adminApi.org(id), [id]);
  const pay = usePortalData(() => adminApi.orgPayments(id, { page }), [id, page]);

  const o = org.data?.data;
  const payments = pay.data?.data?.payments ?? [];
  const pg = pay.data?.data?.pagination;
  const paidTotal = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <button className="btn btn-ghost" style={{ marginBottom: 12 }} onClick={() => router.push('/admin/orgs')}>
        ‹ Back to Organisations
      </button>

      {org.error && <PortalError message={org.error} />}
      {org.loading ? <PortalEmpty message="Loading…" /> : o && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
            <h1 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 700 }}>{o.name}</h1>
            <span className={`badge ${STATUS_BADGE[o.status] || 'badge-muted'}`}>{o.status}</span>
            <span className="badge badge-muted">{o.plan}</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 20 }}>
            {[o.abn && `ABN ${o.abn}`, o.state, `registered ${fmtDate(o.created_at)}`].filter(Boolean).join(' · ')}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 20 }}>
            <PortalKpi label="Users" value={o.users} color="var(--text)" />
            <PortalKpi label="Active devices" value={o.devices} color="var(--cyan)" />
            <PortalKpi label="Paid (this page)" value={money(paidTotal)} color="var(--green)" />
            {o.trial_ends_at && <PortalKpi label="Trial ends" value={fmtDate(o.trial_ends_at)} color="var(--yellow)" />}
          </div>

          <PortalCard title="Payment transactions">
            {pay.error ? <PortalError message={pay.error} />
              : pay.loading ? <PortalEmpty message="Loading…" />
              : payments.length === 0 ? <PortalEmpty message="No payment transactions for this organisation" />
              : (
              <>
                <PortalTable
                  headers={['Date', 'Amount', 'Status', 'Method', 'Period', 'Recorded by', 'Note']}
                  rows={payments.map((p) => [
                    <span key="d" style={{ fontFamily: 'var(--fm)', fontSize: 12 }}>{fmtDate(p.paid_at || p.created_at)}</span>,
                    <span key="a" style={{ fontFamily: 'var(--fm)' }}>{money(p.amount, p.currency)}</span>,
                    <span key="s" className={`badge ${PAYMENT_BADGE[p.status] || 'badge-muted'}`}>{p.status}</span>,
                    p.method || '—',
                    p.period || '—',
                    p.recorded_by_name || '—',
                    p.note || '—',
                  ])}
                />
                {pg && <PortalPagination page={pg.page} pages={pg.pages} total={pg.total} unit="payments" onPage={setPage} />}
              </>
            )}
          </PortalCard>
        </>
      )}
    </div>
  );
}
