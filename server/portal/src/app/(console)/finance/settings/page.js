// /finance/settings — Finance module settings (owner ask 2026-09-08). Cost
// Rates and Cost Centres moved here FROM /organisation/settings — both exist
// to link a cost to an account, which belongs under Finance now that this nav
// group exists, not under general org administration.
//
// This is NOT the same thing as FinanceService.js/fin_accounts (checked
// before building anything here): that's eBizco's own internal SaaS
// bookkeeping, mounted under the Dashboard's /admin/* routes, with deliberately
// NO org_id (migration_v031's own comment) — a single set of books for
// running ProjMan2 as a business, not a per-tenant feature. A real chart-of-
// accounts / P&L / Balance Sheet / rollover (year-end account initialization)
// for each construction-company tenant is a separate, NOT YET BUILT subsystem
// — this page is only the two pieces that already exist (xprojman-39 §1/§2),
// relocated to their correct home. The other FINANCE nav items (P&L, Balance
// Sheet, Expenses, Sales) are `mock: true` in PortalNav.js until that's spec'd
// and built — see docs/decisions for the write-up requesting it.
'use client';

import { useState } from 'react';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { organisationApi, costCentresApi } from '@/lib/api';

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
          Cost rates and cost centres, used for task costing on the Cost Plan.
          Chart-of-accounts setup and year-end rollover aren&rsquo;t built yet —
          see the P&amp;L/Balance Sheet/Expenses/Sales items in the sidebar.
        </div>
      </div>

      <RateCardCard />
      <div style={{ height: 16 }} />
      <CostCentresCard />
    </div>
  );
}
