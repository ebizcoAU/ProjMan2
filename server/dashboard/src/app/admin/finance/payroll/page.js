// /admin/finance/payroll — eBizco's own staff payroll. A draft pay run computes
// gross pay from the staff member's rate × shift hours (or a flat salary); marking
// it paid posts to the Finance ledger (debit Wages Expense, credit Cash & Bank).
'use client';

import { useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalTable }   from '@/components/portal/PortalTable';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { adminApi }      from '@/lib/api';

const money = (v) => Number(v || 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-AU') : '—';
const today = () => new Date().toISOString().slice(0, 10);

function NewStaffForm({ onSaved }) {
  const [form, setForm] = useState({ full_name: '', role_title: '', pay_type: 'hourly', rate: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.full_name.trim() || !form.rate) { setErr('Name and rate are required'); return; }
    setBusy(true); setErr(null);
    try {
      await adminApi.finance.addStaff({ ...form, rate: Number(form.rate) });
      setForm({ full_name: '', role_title: '', pay_type: 'hourly', rate: '' });
      onSaved();
    } catch (e) { setErr(e?.response?.data?.message || e.message); }
    finally { setBusy(false); }
  };

  return (
    <PortalCard title="Add a staff member">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 12, color: 'var(--dim)' }}>Name<br />
          <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14, minWidth: 160 }} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--dim)' }}>Role<br />
          <input value={form.role_title} onChange={(e) => set('role_title', e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14, minWidth: 140 }} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--dim)' }}>Pay type<br />
          <select value={form.pay_type} onChange={(e) => set('pay_type', e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14 }}>
            <option value="hourly">Hourly</option>
            <option value="salary">Salary (per period)</option>
          </select>
        </label>
        <label style={{ fontSize: 12, color: 'var(--dim)' }}>{form.pay_type === 'salary' ? 'Amount per period' : 'Rate per hour'}<br />
          <input type="number" value={form.rate} onChange={(e) => set('rate', e.target.value)}
            style={{ width: 100, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14 }} />
        </label>
        <button className="btn btn-primary" disabled={busy} onClick={save}>Add</button>
      </div>
      {err && <div style={{ marginTop: 10 }}><PortalError message={err} /></div>}
    </PortalCard>
  );
}

function NewPayrollForm({ staff, onSaved }) {
  const [staffId, setStaffId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [shifts, setShifts] = useState([{ work_date: today(), hours: '' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const activeStaff = staff.filter((s) => s.status === 'active');
  const selected = activeStaff.find((s) => s.id === staffId);

  const addShift = () => setShifts((s) => [...s, { work_date: today(), hours: '' }]);
  const setShift = (i, k, v) => setShifts((s) => s.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));

  const save = async () => {
    if (!staffId || !periodStart || !periodEnd) { setErr('Staff, period start and period end are required'); return; }
    setBusy(true); setErr(null);
    try {
      await adminApi.finance.addPayrollRun({
        staff_id: staffId, period_start: periodStart, period_end: periodEnd,
        items: selected?.pay_type === 'hourly' ? shifts.filter((s) => s.hours).map((s) => ({ work_date: s.work_date, hours: Number(s.hours) })) : [],
      });
      setStaffId(''); setPeriodStart(''); setPeriodEnd(''); setShifts([{ work_date: today(), hours: '' }]);
      onSaved();
    } catch (e) { setErr(e?.response?.data?.message || e.message); }
    finally { setBusy(false); }
  };

  return (
    <PortalCard title="New pay run">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
        <label style={{ fontSize: 12, color: 'var(--dim)' }}>Staff<br />
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14, minWidth: 160 }}>
            <option value="">Select…</option>
            {activeStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: 'var(--dim)' }}>Period start<br />
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14 }} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--dim)' }}>Period end<br />
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14 }} />
        </label>
      </div>

      {selected?.pay_type === 'hourly' && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 6 }}>Shifts (@ {money(selected.rate)}/hr)</div>
          {shifts.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <input type="date" value={s.work_date} onChange={(e) => setShift(i, 'work_date', e.target.value)}
                style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 13 }} />
              <input type="number" placeholder="hours" value={s.hours} onChange={(e) => setShift(i, 'hours', e.target.value)}
                style={{ width: 80, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 13 }} />
            </div>
          ))}
          <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={addShift}>+ Add shift</button>
        </div>
      )}
      {selected?.pay_type === 'salary' && (
        <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 10 }}>Flat salary for the period: {money(selected.rate)}</div>
      )}

      <button className="btn btn-primary" disabled={busy || !staffId} onClick={save}>Create draft pay run</button>
      {err && <div style={{ marginTop: 10 }}><PortalError message={err} /></div>}
    </PortalCard>
  );
}

export default function AdminFinancePayroll() {
  const staff = usePortalData(() => adminApi.finance.staff());
  const runs = usePortalData(() => adminApi.finance.payroll());
  const [err, setErr] = useState(null);

  const pay = async (id) => {
    setErr(null);
    try { await adminApi.finance.payPayroll(id); runs.refetch(); }
    catch (e) { setErr(e?.response?.data?.message || e.message); }
  };

  const staffRows = staff.data?.data?.staff ?? [];
  const payrollRows = runs.data?.data?.payroll ?? [];

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <h1 style={{ fontFamily: 'var(--fh)', fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Payroll</h1>
      {err && <div style={{ marginBottom: 12 }}><PortalError message={err} /></div>}

      <NewStaffForm onSaved={staff.refetch} />
      <NewPayrollForm staff={staffRows} onSaved={runs.refetch} />

      <PortalCard title="Staff roster">
        {staff.loading ? <PortalEmpty message="Loading…" />
          : staffRows.length === 0 ? <PortalEmpty message="No staff added yet" />
          : (
          <PortalTable
            headers={['Name', 'Role', 'Pay type', 'Rate', 'Status']}
            rows={staffRows.map((s) => [
              <span key="n" style={{ color: 'var(--text)', fontWeight: 600 }}>{s.full_name}</span>,
              s.role_title || '—', s.pay_type, money(s.rate),
              <span key="s" className={`badge ${s.status === 'active' ? 'badge-active' : 'badge-muted'}`}>{s.status}</span>,
            ])}
          />
        )}
      </PortalCard>

      <PortalCard title="Pay runs">
        {runs.loading ? <PortalEmpty message="Loading…" />
          : payrollRows.length === 0 ? <PortalEmpty message="No pay runs yet" />
          : (
          <PortalTable
            headers={['Staff', 'Period', 'Gross', 'Tax', 'Super', 'Total paid', 'Status', 'Actions']}
            rows={payrollRows.map((p) => [
              p.staff_name,
              `${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}`,
              money(p.gross_amount), money(p.tax), money(p.super_amount), money(p.total_paid),
              <span key="s" className={`badge ${p.status === 'paid' ? 'badge-active' : 'badge-pending'}`}>{p.status}</span>,
              p.status === 'draft'
                ? <button key="a" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => pay(p.id)}>Mark paid</button>
                : fmtDate(p.paid_at),
            ])}
          />
        )}
      </PortalCard>
    </div>
  );
}
