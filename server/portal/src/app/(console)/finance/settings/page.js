// /finance/settings — Finance module settings (owner ask 2026-09-08). Cost
// Rates and Cost Centres moved here FROM /organisation/settings — both exist
// to link a cost to an account, which belongs under Finance now that this nav
// group exists, not under general org administration.
//
// This is NOT the same thing as FinanceService.js/fin_accounts (checked
// before building anything here): that's eBizco's own internal SaaS
// bookkeeping, mounted under the Dashboard's /admin/* routes, with deliberately
// NO org_id (migration_v031's own comment) — a single set of books for
// running ProjMan2 as a business, not a per-tenant feature.
//
// Chart of accounts (xprojman-42 §2, migration v042) landed 2026-09-11 —
// OrgFinanceService/`/finance/accounts`, seeded lazily with a standard-AU
// template on first read. This card is that §2 UI. The other FINANCE nav
// items (P&L, Balance Sheet, Expenses, Sales) stay `mock: true` in
// PortalNav.js — those are §3 (org_journal + an automatic-posting-trigger
// decision, per routes/finance.js's own header), still not built; §2 landing
// is the foundation §3 needs, not §3 itself.
'use client';

import { useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { organisationApi, costCentresApi, financeApi } from '@/lib/api';

const ACC_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];
const ACC_TYPE_COLOR = {
  asset: 'var(--brand)', liability: 'var(--amber)', equity: 'var(--dim)',
  revenue: 'var(--green)', expense: 'var(--red)',
};

// Flattens the tree into `{ id, code, name, accType, depth }` rows, parent
// before children, for both the display list and the "parent account" select.
function flatten(nodes, depth = 0, out = []) {
  for (const n of nodes) {
    out.push({ ...n, depth });
    if (n.children?.length) flatten(n.children, depth + 1, out);
  }
  return out;
}

// Chart of accounts (xprojman-42 §2) — a parent/child tree, seeded from a
// standard-AU template on first read (OrgFinanceService.ensureSeeded), then
// editable. Structural edits (add/rename/activate/re-parent) are
// `finance.manage` server-side — this card renders regardless of role and
// surfaces a 403 via PortalError if the signed-in user lacks it, same
// convention as RateCardCard/CostCentresCard below.
function ChartOfAccountsCard() {
  const { data, loading, error, refetch } = usePortalData(() => financeApi.accounts());
  const [form, setForm] = useState({ code: '', name: '', parentId: '', accType: 'expense' });
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState(null);
  const [rowBusy, setRowBusy] = useState(null);
  const [rowErr, setRowErr] = useState(null);

  const roots = data?.data?.accounts || [];
  const rows = flatten(roots);

  const add = async (e) => {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) return;
    setBusy(true); setFormErr(null);
    try {
      await financeApi.createAccount({
        code: form.code.trim(), name: form.name.trim(),
        parent_id: form.parentId || null,
        acc_type: form.parentId ? undefined : form.accType,
      });
      setForm({ code: '', name: '', parentId: '', accType: 'expense' });
      await refetch();
    } catch (err) {
      setFormErr(err?.response?.data?.message || err.message || 'Could not add account');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (row) => {
    setRowBusy(row.id); setRowErr(null);
    try {
      await financeApi.patchAccount(row.id, { is_active: !row.isActive });
      await refetch();
    } catch (err) {
      setRowErr(err?.response?.data?.message || err.message || 'Could not update account');
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <PortalCard title="Chart of accounts">
      {loading ? <PortalEmpty message="Loading…" /> : error ? <PortalError message={error} /> : (
        <>
          {rows.length === 0 ? <PortalEmpty message="No accounts yet." /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 14 }}>
              {rows.map((r) => (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5,
                  padding: '5px 0', paddingLeft: r.depth * 22,
                  borderBottom: '1px solid var(--s4)', opacity: r.isActive ? 1 : 0.5,
                }}>
                  <span style={{ fontFamily: 'var(--fm)', color: 'var(--brand)', fontWeight: 700, width: 60 }}>{r.code}</span>
                  <span style={{ flex: 1 }}>{r.name}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em',
                    color: ACC_TYPE_COLOR[r.accType] || 'var(--muted)',
                  }}>{r.accType}</span>
                  <button type="button" className="btn" style={{ padding: '3px 8px', fontSize: 11.5 }}
                    disabled={rowBusy === r.id} onClick={() => toggleActive(r)}>
                    {rowBusy === r.id ? '…' : r.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {rowErr && <div style={{ marginBottom: 10 }}><PortalError message={rowErr} /></div>}

          <form onSubmit={add} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 }}>Code</label>
              <input className="input" placeholder="e.g. 5350" style={{ width: 100 }}
                value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 }}>Name</label>
              <input className="input" placeholder="Account name" style={{ width: '100%' }}
                value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 }}>Parent</label>
              <select className="input" style={{ width: 180 }}
                value={form.parentId} onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}>
                <option value="">— None (root) —</option>
                {rows.map((r) => <option key={r.id} value={r.id}>{'—'.repeat(r.depth)} {r.code} {r.name}</option>)}
              </select>
            </div>
            {!form.parentId && (
              <div>
                <label style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 }}>Type</label>
                <select className="input" style={{ width: 120 }}
                  value={form.accType} onChange={(e) => setForm((f) => ({ ...f, accType: e.target.value }))}>
                  {ACC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : '+ Add account'}</button>
          </form>
          {formErr && <div style={{ marginTop: 10 }}><PortalError message={formErr} /></div>}
        </>
      )}
    </PortalCard>
  );
}

const SKILL_LABEL = { expert: 'Expert', professional: 'Professional', std: 'Std', free: 'Free' };

// Cost Rates (xprojman-39 §1) — 4 fixed tiers, each row saves independently
// (PUT /organisation/rate-card is per-tier, not a bulk replace). Still the
// same /organisation/rate-card endpoint — moving this card doesn't imply a
// route rename, org-level settings just render from a different nav location.
function RateCardCard() {
  const { data, loading, error, refetch } = usePortalData(() => organisationApi.getRateCard());
  const [drafts, setDrafts] = useState({});
  const [busyTier, setBusyTier] = useState(null);
  const [saveErr, setSaveErr] = useState(null);

  const rates = data?.data?.rates || [];
  const configured = data?.data?.configured;

  const save = async (skillLevel) => {
    const raw = drafts[skillLevel];
    if (raw === undefined || raw === '') return;
    setBusyTier(skillLevel); setSaveErr(null);
    try {
      await organisationApi.setRate(skillLevel, parseFloat(raw));
      await refetch();
    } catch (err) {
      setSaveErr(err?.response?.data?.message || err.message || 'Could not save');
    } finally {
      setBusyTier(null);
    }
  };

  return (
    <PortalCard title="Cost rates">
      {loading ? <PortalEmpty message="Loading…" /> : error ? <PortalError message={error} /> : (
        <>
          {configured === false && (
            <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--yellow)' }}>
              Not all 4 tiers have a rate set yet — task costing on the Cost Plan stays blank until they do.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
            {rates.map((r) => (
              <div key={r.skill_level}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
                  {SKILL_LABEL[r.skill_level] || r.skill_level} ($/hr)
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="input" type="number" step="0.01" min="0"
                    defaultValue={r.hourly_rate ?? ''}
                    placeholder={r.hourly_rate == null ? 'Not set' : undefined}
                    onChange={(e) => setDrafts((d) => ({ ...d, [r.skill_level]: e.target.value }))} />
                  <button className="btn btn-primary" style={{ padding: '8px 12px' }}
                    disabled={busyTier === r.skill_level} onClick={() => save(r.skill_level)}>
                    {busyTier === r.skill_level ? '…' : 'Save'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {saveErr && <div style={{ marginTop: 10 }}><PortalError message={saveErr} /></div>}
        </>
      )}
    </PortalCard>
  );
}

// Cost Centres (xprojman-39 §2) — fixed, admin-managed list, same shape as suppliers.
function CostCentresCard() {
  const { data, loading, error, refetch } = usePortalData(() => costCentresApi.list());
  const [form, setForm] = useState({ code: '', name: '' });
  const [busy, setBusy] = useState(false);
  const [addErr, setAddErr] = useState(null);

  const centres = data?.data?.cost_centres || [];

  const add = async (e) => {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) return;
    setBusy(true); setAddErr(null);
    try {
      await costCentresApi.create(form);
      setForm({ code: '', name: '' });
      await refetch();
    } catch (err) {
      setAddErr(err?.response?.data?.message || err.message || 'Could not add');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PortalCard title="Cost centres">
      {loading ? <PortalEmpty message="Loading…" /> : error ? <PortalError message={error} /> : (
        <>
          {centres.length === 0 ? <PortalEmpty message="No cost centres yet." /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
              {centres.map((c) => (
                <div key={c.id} style={{ display: 'flex', gap: 10, fontSize: 13.5, padding: '5px 0', borderBottom: '1px solid var(--s4)' }}>
                  <span style={{ fontFamily: 'var(--fm)', color: 'var(--brand)', fontWeight: 700, width: 90 }}>{c.code}</span>
                  <span>{c.name}</span>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={add} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="input" placeholder="Code" style={{ maxWidth: 140 }}
              value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            <input className="input" placeholder="Name" style={{ flex: 1, minWidth: 180 }}
              value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : '+ Add'}</button>
          </form>
          {addErr && <div style={{ marginTop: 10 }}><PortalError message={addErr} /></div>}
        </>
      )}
    </PortalCard>
  );
}

export default function FinanceSettingsPage() {
  return (
    <div style={{ padding: 20, maxWidth: 720 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 22, color: 'var(--text)', margin: 0 }}>Finance settings</h1>
        <div style={{ fontSize: 13.5, color: 'var(--dim)', marginTop: 4, maxWidth: '62ch' }}>
          Chart of accounts, cost rates, and cost centres. See the P&amp;L/
          Balance Sheet/Expenses/Sales items in the sidebar for the journal
          reports. Year-end rollover (closing a financial year) isn&rsquo;t
          built yet.
        </div>
      </div>

      <ChartOfAccountsCard />
      <div style={{ height: 16 }} />
      <RateCardCard />
      <div style={{ height: 16 }} />
      <CostCentresCard />
    </div>
  );
}
