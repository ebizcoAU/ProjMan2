// PortalTable.js — standard table for portal data.
// Ported verbatim from Nexus portal/_components/PortalTable.js (font sizes +1 for
// the accessible base scale). Sortable headers added on top, backward-compatible: a
// header is still just a string for a non-sortable column, or `{ label, key }` when
// `onSort` is passed and this column should be clickable. Sorting itself always runs
// server-side (the `sortKey`/`onSort(key)` pair only reports the click — callers page
// through a REST list, so a client-side Array.sort would only ever be correct for the
// current page, not the full result).
export function PortalTable({ headers, rows, sortKey, sortDir, onSort }) {
  return (
    <div
      style={{
        overflowX: 'auto',
        borderRadius: 8,
        border: '1px solid var(--b1)',
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 14,
        }}
      >
        <thead>
          <tr style={{ background: 'var(--s2)', borderBottom: '1px solid var(--b1)' }}>
            {headers.map((h, i) => {
              const isObj = h && typeof h === 'object';
              const label = isObj ? h.label : h;
              const key = isObj ? h.key : null;
              const sortable = !!(onSort && key);
              const active = sortable && sortKey === key;
              return (
                <th
                  key={i}
                  onClick={sortable ? () => onSort(key) : undefined}
                  style={{
                    padding: '10px 12px',
                    textAlign: 'left',
                    fontWeight: 600,
                    color: active ? 'var(--text)' : 'var(--dim)',
                    fontSize: 13,
                    cursor: sortable ? 'pointer' : 'default',
                    userSelect: sortable ? 'none' : 'auto',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                  {sortable && (
                    <span style={{ marginLeft: 4, opacity: active ? 1 : 0.35, fontSize: 11 }}>
                      {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows?.map((row, i) => (
            <tr
              key={i}
              style={{
                borderBottom: i < rows.length - 1 ? '1px solid var(--b2)' : 'none',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--s3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {row.map((cell, j) => (
                <td
                  key={j}
                  style={{
                    padding: '10px 12px',
                    color: 'var(--dim)',
                    fontSize: 13,
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
