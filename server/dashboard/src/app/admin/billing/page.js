// /admin/billing — SaaS billing: subscriptions, revenue, record payment, change plan.
'use client';

import { useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalTable }   from '@/components/portal/PortalTable';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { adminApi }      from '@/lib/api';

const money = (v) => v == null ? '—' : Number(v).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const STATUS_BADGE = { active: 'badge-active', trial: 'badge-pending', past_due: 'badge-revoked', cancelled: 'badge-muted' };
const PLANS = ['trial', 'starter', 'builder', 'enterprise'];

export default function AdminBilling() {
  const subs = usePortalData(() => adminApi.billing.subscriptions({ limit: 100 }));
  const rev = usePortalData(() => adminApi.billing.revenue());
  const [pay, setPay] = useState(null);   // org being paid
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const rows = subs.data?.data?.subscriptions ?? [];
  const r = rev.data?.data;

  const refresh = () => { subs.refetch(); rev.refetch(); };
  const record = async (orgId) => {
    setBusy(true); setErr(null);
    try { await adminApi.billing.recordPayment({ org_id: orgId, amount: Number(amount), method: 'manual', status: 'paid' }); setPay(null); setAmount(''); refresh(); }
    catch (e) { setErr(e?.response?.data?.message || e.message); }
    finally { setBusy(false); }
  };
  const changePlan = async (orgId, plan) => {
    setErr(null);
    try { await adminApi.billing.changePlan(orgId, { plan, status: plan === 'trial' ? 'trial' : 'active' }); refresh(); }
    catch (e) { setErr(e?.response?.data?.message || e.message); }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <h1 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Billing</h1>

      {(subs.error || err) && <div style={{ marginBottom: 12 }}><PortalError message={subs.error || err} /></div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 16 }}>
        <PortalKpi label="MRR" value={money(r?.mrr)} color="var(--brand)" />
        <PortalKpi label="Revenue (30d)" value={money(r?.revenue?.last30)} color="var(--green)" />
        <PortalKpi label="Revenue (12m)" value={money(r?.revenue?.last365)} color="var(--text)" />
        <PortalKpi label="Overdue" value={r?.overdue?.length ?? 0} color="var(--red)" />
      </div>

      <PortalCard title="Subscriptions">
        {subs.loading ? <PortalEmpty message="Loading…" />
          : rows.length === 0 ? <PortalEmpty message="No organisations" />
          : (
          <PortalTable
            headers={['Organisation', 'Plan', 'Status', 'Paid to date', 'Overdue', 'Actions']}
            rows={rows.map(sb => [
              <span key="o" style={{ color: 'var(--text)', fontWeight: 600 }}>{sb.orgName}</span>,
              <select key="p" value={sb.plan} onChange={e => changePlan(sb.orgId, e.target.value)}
                style={{ padding: '4px 6px', borderRadius: 6, fontSize: 13, border: '1px solid var(--b2)', background: 'var(--s1)', color: 'var(--text)' }}>
                {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>,
              <span key="s" className={`badge ${STATUS_BADGE[sb.status] || 'badge-muted'}`}>{sb.status}</span>,
              money(sb.paidTotal),
              sb.overdueCount > 0 ? <span key="od" style={{ color: 'var(--red)' }}>{sb.overdueCount}</span> : '—',
              pay === sb.orgId ? (
                <span key="a" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount"
                    style={{ width: 90, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--b2)', fontSize: 13 }} />
                  <button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 13 }} disabled={busy || !amount}
                    onClick={() => record(sb.orgId)}>Save</button>
                  <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 13 }} onClick={() => setPay(null)}>×</button>
                </span>
              ) : (
                <button key="a" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 13 }}
                  onClick={() => { setPay(sb.orgId); setAmount(sb.amount || ''); }}>Record payment</button>
              ),
            ])}
          />
        )}
      </PortalCard>

      {r?.overdue?.length > 0 && (
        <PortalCard title="Overdue — chase list">
          <PortalTable headers={['Organisation', 'Amount', 'Period', 'Since']}
            rows={r.overdue.map(o => [o.org_name, money(o.amount), o.period || '—', new Date(o.created_at).toLocaleDateString('en-AU')])} />
        </PortalCard>
      )}
    </div>
  );
}
