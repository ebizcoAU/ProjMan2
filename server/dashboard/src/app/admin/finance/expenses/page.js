// /admin/finance/expenses — eBizco's own office/operating expenses. Recording one
// posts a two-sided entry to the Finance ledger (debit the category, credit Cash &
// Bank) — this is what Profit & Loss's expense side reads.
'use client';

import { useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalTable }   from '@/components/portal/PortalTable';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { PortalPagination } from '@/components/portal/PortalPagination';
import { usePortalData } from '@/components/portal/usePortalData';
import { adminApi }      from '@/lib/api';

const money = (v) => Number(v || 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-AU') : '—';
const STATUS_BADGE = { recorded: 'badge-pending', paid: 'badge-active' };
const today = () => new Date().toISOString().slice(0, 10);

function NewExpenseForm({ accounts, onSaved }) {
  const [form, setForm] = useState({ account_id: '', description: '', amount: '', tax: '', incurred_at: today() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const expenseAccounts = accounts.filter((a) => a.acc_type === 'expense');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.account_id || !form.description.trim() || !form.amount) { setErr('Category, description and amount are required'); return; }
    setBusy(true); setErr(null);
    try {
      await adminApi.finance.addExpense({ ...form, amount: Number(form.amount), tax: Number(form.tax || 0) });
      setForm({ account_id: '', description: '', amount: '', tax: '', incurred_at: today() });
      onSaved();
    } catch (e) { setErr(e?.response?.data?.message || e.message); }
    finally { setBusy(false); }
  };

  return (
    <PortalCard title="Record an expense">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 12, color: 'var(--dim)' }}>
          Category<br />
          <select value={form.account_id} onChange={(e) => set('account_id', e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14, minWidth: 180 }}>
            <option value="">Select…</option>
            {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: 'var(--dim)' }}>
          Description<br />
          <input value={form.description} onChange={(e) => set('description', e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14, minWidth: 220 }} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--dim)' }}>
          Amount (excl. tax)<br />
          <input type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)}
            style={{ width: 100, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14 }} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--dim)' }}>
          Tax (GST)<br />
          <input type="number" value={form.tax} onChange={(e) => set('tax', e.target.value)}
            style={{ width: 80, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14 }} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--dim)' }}>
          Date<br />
          <input type="date" value={form.incurred_at} onChange={(e) => set('incurred_at', e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14 }} />
        </label>
        <button className="btn btn-primary" disabled={busy} onClick={save}>Save</button>
      </div>
      {err && <div style={{ marginTop: 10 }}><PortalError message={err} /></div>}
    </PortalCard>
  );
}

export default function AdminFinanceExpenses() {
  const [page, setPage] = useState(1);
  const accounts = usePortalData(() => adminApi.finance.accounts());
  const { data, loading, error, refetch } = usePortalData(() => adminApi.finance.expenses({ page }), [page]);

  const rows = data?.data?.expenses ?? [];
  const pg = data?.data?.pagination;
  const total = rows.reduce((s, r) => s + Number(r.amount) + Number(r.tax), 0);

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <h1 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Expenses</h1>
      {error && <div style={{ marginBottom: 12 }}><PortalError message={error} /></div>}
      {accounts.data?.data?.accounts && <NewExpenseForm accounts={accounts.data.data.accounts} onSaved={refetch} />}

      <PortalCard title="Expense history" subtitle={`This page's total: ${money(total)}`}>
        {loading ? <PortalEmpty message="Loading…" />
          : rows.length === 0 ? <PortalEmpty message="No expenses recorded yet" />
          : (
          <>
            <PortalTable
              headers={['Date', 'Category', 'Description', 'Amount', 'Tax', 'Status', 'Recorded by']}
              rows={rows.map((e) => [
                fmtDate(e.incurred_at),
                <span key="c" className="badge badge-muted">{e.account_name}</span>,
                e.description,
                money(e.amount),
                money(e.tax),
                <span key="s" className={`badge ${STATUS_BADGE[e.status] || 'badge-muted'}`}>{e.status}</span>,
                e.created_by_name || '—',
              ])}
            />
            {pg && <PortalPagination page={pg.page} pages={pg.pages} total={pg.total} unit="expenses" onPage={setPage} />}
          </>
        )}
      </PortalCard>
    </div>
  );
}
