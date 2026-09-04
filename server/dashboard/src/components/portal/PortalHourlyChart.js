// PortalHourlyChart.js — a small inline-SVG bar chart for an hourly time series.
// No charting dependency — this stack has none (no recharts/chart.js anywhere in
// server/dashboard or server/portal), and one hourly bar chart doesn't warrant adding one.
export function PortalHourlyChart({ series, color = 'var(--blue)', height = 120 }) {
  if (!series?.length) return null;
  const max = Math.max(1, ...series.map((d) => d.count));
  const barW = 100 / series.length;
  const labelEvery = Math.max(1, Math.ceil(series.length / 12));
  const label = (iso) => `${String(new Date(iso).getHours()).padStart(2, '0')}:00`;

  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
        {series.map((d, i) => {
          const barH = (d.count / max) * (height - 4);
          return (
            <rect key={i} x={i * barW + barW * 0.15} y={height - 4 - barH} width={barW * 0.7} height={Math.max(barH, d.count ? 1 : 0)} fill={color}>
              <title>{label(d.hour)} — {d.count} session{d.count === 1 ? '' : 's'}</title>
            </rect>
          );
        })}
      </svg>
      <div style={{ display: 'flex', fontSize: 10, color: 'var(--dim)', marginTop: 4 }}>
        {series.map((d, i) => (
          <div key={i} style={{ width: `${barW}%`, textAlign: 'center', overflow: 'hidden' }}>
            {i % labelEvery === 0 ? label(d.hour) : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
