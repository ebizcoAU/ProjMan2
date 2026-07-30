// /projects/:id/cost-plan — the money loop (Portal build step 5, wired to P7a + P7b).
//
// The four stage cost columns are DERIVED roll-ups, not editable fields (xprojman-10 §5 —
// they became the single read model once P7 owns them: estimated←estimate lines,
// committed←purchase orders, actual←supplier invoices, claimed←progress claims). So this
// page is READ-ONLY and drills down into the source document behind each column. Gated by
// money.read server-side (columns/rows are simply absent for a non-financial viewer, and
// under an independent_fixed engagement a Builder's PO/invoice rows never reach the PM).
'use client';

import { useParams } from 'next/navigation';
import { PortalCard }    from '@/components/portal/PortalCard';
import { PortalKpi }     from '@/components/portal/PortalKpi';
import { PortalEmpty }   from '@/components/portal/PortalEmpty';
import { PortalError }   from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, commercialApi } from '@/lib/api';
import { ProjectTabs }   from '../_ProjectTabs';

const COLS = [
  { key: 'estimated_amount', label: 'Estimated', src: 'estimate lines' },
  { key: 'committed_amount', label: 'Committed', src: 'purchase orders' },
  { key: 'actual_amount',    label: 'Actual',    src: 'supplier invoices' },
  { key: 'claimed_amount',   label: 'Claimed',   src: 'progress claims' },
];
const money = (v) => v == null || v === '' ? '—'
  : Number(v).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const num = (v) => Number(v) || 0;

const STATUS_COLOR = {
  issued: 'var(--brand)', received: 'var(--green)', cancelled: 'var(--dim)',
  matched: 'var(--brand)', approved: 'var(--green)', disputed: 'var(--red)',
  submitted: 'var(--amber)', paid: 'var(--green)', declined: 'var(--red)',
  draft: 'var(--dim)',
};
function Pill({ text }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11,
      fontWeight: 700, color: '#fff', background: STATUS_COLOR[text] || 'var(--muted)',
    }}>{text}</span>
  );
}
const th = { padding: '8px 12px', textAlign: 'left', color: 'var(--dim)', fontSize: 11, fontWeight: 700 };
const thR = { ...th, textAlign: 'right' };
const td = { padding: '7px 12px', color: 'var(--text)', fontSize: 13 };
const tdR = { ...td, textAlign: 'right', fontFamily: 'var(--fm)' };

// A compact source-document table with an empty state.
function DocTable({ title, count, columns, rows, renderRow }) {
  return (
    <PortalCard title={`${title}${count ? ` · ${count}` : ''}`}>
      {rows.length === 0 ? (
        <PortalEmpty message={`No ${title.toLowerCase()} yet.`} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--s2)', borderBottom: '1px solid var(--b1)' }}>
                {columns.map((c, i) => <th key={i} style={c.right ? thR : th}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id || i} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--b2)' : 'none' }}>
                  {renderRow(r)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalCard>
  );
}

export default function CostPlanPage() {
  const { id } = useParams();
  const { data, loading, error } = usePortalData(async () => {
    const [d, cp, po, inv, cl] = await Promise.all([
      projectsApi.detail(id),
      commercialApi.costPlan(id).catch(() => null),
      commercialApi.purchaseOrders(id).catch(() => null),
      commercialApi.supplierInvoices(id).catch(() => null),
      commercialApi.progressClaims(id).catch(() => null),
    ]);
    return { data: {
      project:  d?.data?.data?.project,
      stages:   d?.data?.data?.stages || [],
      lines:    cp?.data?.data?.lines || [],
      pos:      po?.data?.data?.purchase_orders || [],
      invoices: inv?.data?.data?.supplier_invoices || [],
      claims:   cl?.data?.data?.claims || [],
    } };
  }, [id]);

  if (loading) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (error)   return <div style={{ padding: 20 }}><PortalError message={error} /></div>;

  const project = data?.data?.project;
  if (!project) return <div style={{ padding: 20 }}><PortalError message="Project not found" /></div>;

  const stages   = data.data.stages;
  const lines    = data.data.lines;
  const pos      = data.data.pos;
  const invoices = data.data.invoices;
  const claims   = data.data.claims;
  const seesMoney = stages.some(s => 'estimated_amount' in s) || ('contract_value' in project);
  const stageName = (sid) => { const st = stages.find(s => s.id === sid); return st ? `${st.seq}. ${st.name}` : '—'; };

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

          <PortalCard title="Cost plan by stage — derived from source documents">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--s2)', borderBottom: '1px solid var(--b1)' }}>
                    <th style={th}>#</th>
                    <th style={th}>Stage</th>
                    {COLS.map(c => <th key={c.key} style={thR}>{c.label}</th>)}
                    <th style={thR}>Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map((st, i) => {
                    const vr = variance(st);
                    return (
                      <tr key={st.id} style={{ borderBottom: i < stages.length - 1 ? '1px solid var(--b2)' : 'none' }}>
                        <td style={{ ...td, fontFamily: 'var(--fm)', color: 'var(--muted)' }}>{st.seq}</td>
                        <td style={td}>{st.name}</td>
                        {COLS.map(c => <td key={c.key} style={tdR}>{money(st[c.key])}</td>)}
                        <td style={{ ...tdR, color: vr > 0 ? 'var(--red)' : vr < 0 ? 'var(--green)' : 'var(--dim)' }}>
                          {vr === 0 ? '—' : money(vr)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--b1)', fontWeight: 700 }}>
                    <td colSpan={2} style={{ ...td, fontWeight: 700 }}>Total</td>
                    {COLS.map(c => <td key={c.key} style={{ ...tdR, fontWeight: 700 }}>{money(total(c.key))}</td>)}
                    <td style={{ ...tdR, fontWeight: 700, color: totalVariance > 0 ? 'var(--red)' : 'var(--green)' }}>{money(totalVariance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
              These columns are read-only roll-ups of the documents below (estimate → committed → actual → claimed).
              Contract value: <strong style={{ color: 'var(--text)' }}>{money(project.contract_value)}</strong>.
            </div>
          </PortalCard>

          <div style={{ height: 16 }} />

          <DocTable
            title="Estimate lines" count={lines.length}
            columns={[{ label: 'Description' }, { label: 'Stage' }, { label: 'Qty', right: true },
              { label: 'Rate', right: true }, { label: 'Amount', right: true }]}
            rows={lines}
            renderRow={(l) => (<>
              <td style={td}>{l.description}</td>
              <td style={{ ...td, color: 'var(--muted)' }}>{l.stage_id ? stageName(l.stage_id) : '—'}</td>
              <td style={tdR}>{num(l.quantity)}{l.unit ? ` ${l.unit}` : ''}</td>
              <td style={tdR}>{money(l.rate)}</td>
              <td style={tdR}>{money(l.amount)}</td>
            </>)}
          />
          <div style={{ height: 12 }} />

          <DocTable
            title="Purchase orders" count={pos.length}
            columns={[{ label: 'PO#' }, { label: 'Supplier' }, { label: 'Stage' }, { label: 'Owner' },
              { label: 'Status' }, { label: 'Amount', right: true }]}
            rows={pos}
            renderRow={(p) => (<>
              <td style={{ ...td, fontFamily: 'var(--fm)' }}>#{p.po_number}</td>
              <td style={td}>{p.supplier_name || (p.counterparty_redacted ? <em style={{ color: 'var(--muted)' }}>[redacted]</em> : '—')}</td>
              <td style={{ ...td, color: 'var(--muted)' }}>{p.stage_id ? stageName(p.stage_id) : '—'}</td>
              <td style={td}><Pill text={p.owner_party} /></td>
              <td style={td}><Pill text={p.status} /></td>
              <td style={tdR}>{money(p.amount)}</td>
            </>)}
          />
          <div style={{ height: 12 }} />

          <DocTable
            title="Supplier invoices" count={invoices.length}
            columns={[{ label: 'Invoice' }, { label: 'Supplier' }, { label: 'Matched PO' }, { label: 'Owner' },
              { label: 'Status' }, { label: 'Amount', right: true }]}
            rows={invoices}
            renderRow={(v) => (<>
              <td style={{ ...td, fontFamily: 'var(--fm)' }}>{v.invoice_number}</td>
              <td style={td}>{v.supplier_name || (v.counterparty_redacted ? <em style={{ color: 'var(--muted)' }}>[redacted]</em> : '—')}</td>
              <td style={{ ...td, color: 'var(--muted)' }}>{v.po_id ? '2-way ✓' : 'direct'}</td>
              <td style={td}><Pill text={v.owner_party} /></td>
              <td style={td}><Pill text={v.status} /></td>
              <td style={tdR}>{money(v.amount)}</td>
            </>)}
          />
          <div style={{ height: 12 }} />

          <DocTable
            title="Progress claims" count={claims.length}
            columns={[{ label: 'Claim#' }, { label: 'Stage' }, { label: 'Status' }, { label: 'Amount', right: true }]}
            rows={claims}
            renderRow={(c) => (<>
              <td style={{ ...td, fontFamily: 'var(--fm)' }}>#{c.claim_number}</td>
              <td style={{ ...td, color: 'var(--muted)' }}>{c.stage_id ? stageName(c.stage_id) : '—'}</td>
              <td style={td}><Pill text={c.status} /></td>
              <td style={tdR}>{money(c.amount)}</td>
            </>)}
          />
        </>
      )}
    </div>
  );
}
