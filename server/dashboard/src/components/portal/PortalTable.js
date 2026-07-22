// PortalTable.js — standard table for portal data.
// Ported verbatim from Nexus portal/_components/PortalTable.js (font sizes +1 for
// the accessible base scale).
export function PortalTable({ headers, rows }) {
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
            {headers.map((h, i) => (
              <th
                key={i}
                style={{
                  padding: '10px 12px',
                  textAlign: 'left',
                  fontWeight: 600,
                  color: 'var(--dim)',
                  fontSize: 13,
                }}
              >
                {h}
              </th>
            ))}
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
