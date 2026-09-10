// AccountTreeTable.js — renders an OrgFinanceService account tree (xprojman-42
// §3): nodes shaped `{ id, name, accType, children, total }`, `total` already
// rolled up through children (OrgFinanceService.buildOrgAccountTree). Shared by
// the P&L and Balance Sheet pages — same tree shape, only the root filter and
// KPI row above it differ per page.
const money = (v) => (v == null ? '—'
  : Number(v).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }));

function Row({ node, depth }) {
  const isRoot = depth === 0;
  return (
    <>
      <tr style={{ borderBottom: '1px solid var(--b2)' }}>
        <td style={{
          padding: '6px 12px', paddingLeft: 12 + depth * 20,
          fontSize: 13.5, color: 'var(--text)', fontWeight: isRoot ? 700 : 400,
        }}>
          {node.name}
        </td>
        <td style={{
          padding: '6px 12px', textAlign: 'right', fontFamily: 'var(--fm)', fontSize: 13.5,
          color: node.total < 0 ? 'var(--red)' : 'var(--text)', fontWeight: isRoot ? 700 : 400,
        }}>
          {money(node.total)}
        </td>
      </tr>
      {node.children?.map((c) => <Row key={c.id} node={c} depth={depth + 1} />)}
    </>
  );
}

export function AccountTreeTable({ roots, emptyMessage }) {
  if (!roots || roots.length === 0) {
    return <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13.5 }}>{emptyMessage || 'No accounts yet.'}</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--s2)', borderBottom: '1px solid var(--b1)' }}>
            <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--dim)', fontSize: 11, fontWeight: 700 }}>Account</th>
            <th style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--dim)', fontSize: 11, fontWeight: 700 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {roots.map((r) => <Row key={r.id} node={r} depth={0} />)}
        </tbody>
      </table>
    </div>
  );
}
