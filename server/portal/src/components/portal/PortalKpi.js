// PortalKpi.js — KPI card display. Ported from Nexus portal/_components/PortalKpi.js.
export function PortalKpi({ label, value, unit = '', color = 'var(--cyan)', sub = '' }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 8,
        background: 'var(--s2)',
        border: '1px solid var(--b1)',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: color,
          marginBottom: sub ? 4 : 0,
        }}
      >
        {value}
        <span style={{ fontSize: 13, marginLeft: 4 }}>{unit}</span>
      </div>
      {sub && (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{sub}</div>
      )}
    </div>
  );
}
