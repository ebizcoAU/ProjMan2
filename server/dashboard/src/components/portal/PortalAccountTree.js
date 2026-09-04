// PortalAccountTree.js — a recursive tree table for a chart-of-accounts report
// (Profit & Loss, Balance Sheet). Modelled on ../ihms's own P&L layout (account.js
// `/getAcc`, a jstree grid): root categories bold, sub-categories indented and
// italic, leaf accounts plain, every level shows its own rolled-up total in the
// same row (not as a separate trailing "Total X" sibling row like ihms's jstree
// workaround needed — a real tree table can just put the subtotal on the parent
// row directly).
const money = (v) => Number(v || 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

// depth 0 = root (Revenue/Expenses/Assets/…, bold), 1 = category (semi-bold), 2+ = leaf (plain).
function levelStyle(depth) {
  if (depth === 0) return { fontWeight: 700, color: 'var(--text)' };
  if (depth === 1) return { fontWeight: 600, color: 'var(--text)', fontStyle: 'italic' };
  return { fontWeight: 400, color: 'var(--dim)' };
}

function TreeRow({ node, depth }) {
  const hasChildren = node.children?.length > 0;
  return (
    <>
      <tr style={{ borderBottom: '1px solid var(--b2)' }}>
        <td style={{ padding: '6px 12px', paddingLeft: 12 + depth * 20, fontSize: depth === 0 ? 14 : 13, ...levelStyle(depth) }}>
          {node.name}
        </td>
        <td style={{ padding: '6px 12px', textAlign: 'right', fontFamily: 'var(--fm)', fontSize: 13,
          color: node.total < 0 ? 'var(--red)' : levelStyle(depth).color, fontWeight: levelStyle(depth).fontWeight }}>
          {money(node.total)}
        </td>
      </tr>
      {hasChildren && node.children.map((c) => <TreeRow key={c.id} node={c} depth={depth + 1} />)}
    </>
  );
}

// `roots` — an array of top-level nodes, each `{ id, name, total, ownBalance, children[] }`
// (FinanceService.buildAccountTree's shape). `summaryLabel`/`summaryValue` renders a final
// blue bold row (ihms's `type:"summary"` — Net Profit After Tax) when given.
export function PortalAccountTree({ roots, summaryLabel, summaryValue }) {
  if (!roots?.length) return null;
  return (
    <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--b1)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <tbody>
          {roots.map((r) => <TreeRow key={r.id} node={r} depth={0} />)}
          {summaryLabel && (
            <tr style={{ borderTop: '2px solid var(--b1)' }}>
              <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--brand)', fontSize: 14 }}>{summaryLabel}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--fm)', fontWeight: 700,
                color: summaryValue < 0 ? 'var(--red)' : 'var(--brand)', fontSize: 14 }}>
                {money(summaryValue)}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
