// /projects/:id/cost-plan — per-stage cost plan (Portal build step 5).
// Read + edit the four cost columns (estimated/committed/actual/claimed) per stage,
// with variance. Gated by money.read on the server (columns are simply absent for a
// non-financial viewer — this page then shows the no-access state). Edits go through
// PATCH /projects/:id/stages/:stageId (programme.write).
'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi }   from '@/lib/api';
import { ProjectTabs }   from '../_ProjectTabs';

const COLS = [
  { key: 'estimated_amount', label: 'Estimated' },
  { key: 'committed_amount', label: 'Committed' },
  { key: 'actual_amount',    label: 'Actual' },
  { key: 'claimed_amount',   label: 'Claimed' },
];
const money = (v) => v == null || v === '' ? '—'
  : Number(v).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const num = (v) => Number(v) || 0;

// One editable cost cell — saves on blur if changed.
function CostCell({ stageId, col, value, onSave, disabled }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  const commit = () => {
    const norm = v === '' ? null : Number(v);
    const was = value == null ? null : Number(value);
    if (norm !== was) onSave(stageId, col, norm);
  };
  return (
    <input
      type="number" value={v} disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      style={{
        width: 110, padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--fm)',
        fontSize: 13, borderRadius: 6, border: '1px solid var(--b1)',
        background: disabled ? 'var(--s2)' : 'var(--s1)', color: 'var(--text)',
      }}
    />
  );
}

export default function CostPlanPage() {
  const { id } = useParams();
  const { data, loading, error, refetch } = usePortalData(() => projectsApi.detail(id), [id]);
  const [saving, setSaving] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const project = data?.data?.project;
  const stages = data?.data?.stages || [];
  const seesMoney = stages.some(s => 'estimated_amount' in s) || (project && 'contract_value' in project);

  const save = async (stageId, col, val) => {
    setSaving(`${stageId}:${col}`); setSaveError(null);
    try { await projectsApi.patchStage(id, stageId, { [col]: val }); await refetch(); }
    catch (err) { setSaveError(err?.response?.data?.message || err.message); }
    finally { setSaving(null); }
  };

  if (loading) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (error)   return <div style={{ padding: 20 }}><PortalError message={error} /></div>;
  if (!project) return <div style={{ padding: 20 }}><PortalError message="Project not found" /></div>;

  const total = (col) => stages.reduce((s, st) => s + num(st[col]), 0);
  const variance = (st) => num(st.actual_amount) - num(st.estimated_amount);
  const totalVariance = total('actual_amount') - total('estimated_amount');

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--fm)', color: 'var(--brand)' }}>{project.code}</span>{'  '}{project.name}
      </div>
      <ProjectTabs id={id} seesMoney={seesMoney} />

      {!seesMoney ? (
        <PortalError message="You do not have financial access to this project's cost plan." />
      ) : stages.length === 0 ? (
        <PortalCard title="Cost Plan"><PortalEmpty message="No programme yet — instantiate stages first (Programme tab)." /></PortalCard>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 16 }}>
            {COLS.map(c => <PortalKpi key={c.key} label={c.label} value={money(total(c.key))} color="var(--text)" />)}
            <PortalKpi label="Variance (actual−est)" value={money(totalVariance)}
              color={totalVariance > 0 ? 'var(--red)' : 'var(--green)'} />
          </div>

          {saveError && <div style={{ marginBottom: 12 }}><PortalError message={saveError} /></div>}

          <PortalCard title="Cost plan by stage">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--s2)', borderBottom: '1px solid var(--b1)' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--dim)', fontSize: 12 }}>#</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--dim)', fontSize: 12 }}>Stage</th>
                    {COLS.map(c => (
                      <th key={c.key} style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--dim)', fontSize: 12 }}>{c.label}</th>
                    ))}
                    <th style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--dim)', fontSize: 12 }}>Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map((st, i) => {
                    const vr = variance(st);
                    return (
                      <tr key={st.id} style={{ borderBottom: i < stages.length - 1 ? '1px solid var(--b2)' : 'none' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'var(--fm)', color: 'var(--muted)' }}>{st.seq}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--text)' }}>{st.name}</td>
                        {COLS.map(c => (
                          <td key={c.key} style={{ padding: '6px 12px', textAlign: 'right' }}>
                            <CostCell stageId={st.id} col={c.key} value={st[c.key]}
                              disabled={saving === `${st.id}:${c.key}`} onSave={save} />
                          </td>
                        ))}
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--fm)',
                          color: vr > 0 ? 'var(--red)' : vr < 0 ? 'var(--green)' : 'var(--dim)' }}>
                          {vr === 0 ? '—' : money(vr)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--b1)', fontWeight: 700 }}>
                    <td colSpan={2} style={{ padding: '10px 12px', color: 'var(--text)' }}>Total</td>
                    {COLS.map(c => (
                      <td key={c.key} style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--fm)', color: 'var(--text)' }}>
                        {money(total(c.key))}
                      </td>
                    ))}
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--fm)',
                      color: totalVariance > 0 ? 'var(--red)' : 'var(--green)' }}>{money(totalVariance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
              Edit a cell and click away (or press Enter) to save. Contract value:{' '}
              <strong style={{ color: 'var(--text)' }}>{money(project.contract_value)}</strong>.
            </div>
          </PortalCard>
        </>
      )}
    </div>
  );
}
