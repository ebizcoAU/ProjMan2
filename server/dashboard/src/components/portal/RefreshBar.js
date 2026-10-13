// RefreshBar — "Updated 10:42 · auto-refreshes every 60s · Refresh" (dashboard spec §9 / §11 #4).
'use client';

export function RefreshBar({ updatedAt, onRefresh, everySec = 60 }) {
  const t = updatedAt ? updatedAt.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--dim)' }}>
      <span>Updated {t} · auto-refreshes every {everySec}s</span>
      <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => onRefresh()}>Refresh</button>
    </div>
  );
}
