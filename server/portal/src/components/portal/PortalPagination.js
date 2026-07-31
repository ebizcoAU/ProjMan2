// PortalPagination.js — reusable server-side pagination bar.
// Ported from Nexus portal/_components/PortalPagination.js; en-AU strings.
'use client';

export function PortalPagination({ page = 1, pages = 1, total = 0, onPage, unit = 'items' }) {
  // Nothing to page through — show a count line if there's any data.
  if (!pages || pages <= 1) {
    return total ? (
      <div style={{ textAlign: 'center', marginTop: 16, fontSize: 14, color: 'var(--muted)' }}>
        {total.toLocaleString('en-AU')} {unit}
      </div>
    ) : null;
  }

  // Compact window: 1, 2 … current-1, current, current+1 … last-1, last
  const set = new Set([1, 2, pages - 1, pages, page - 1, page, page + 1]);
  const nums = [...set].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);

  const items = [];
  let prev = 0;
  for (const n of nums) {
    if (n - prev > 1) {
      items.push(<span key={`gap-${n}`} style={{ color: 'var(--muted)', padding: '0 2px' }}>…</span>);
    }
    items.push(
      <button key={n} className={'chip' + (n === page ? ' on' : '')}
        onClick={() => onPage(n)} style={{ minWidth: 38, textAlign: 'center' }}>
        {n}
      </button>
    );
    prev = n;
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, marginTop: 18, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 14, color: 'var(--muted)' }}>
        Page <strong style={{ color: 'var(--text)' }}>{page}</strong> / {pages}
        {' · '}{total.toLocaleString('en-AU')} {unit}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="chip" disabled={page <= 1} onClick={() => onPage(page - 1)}
          style={{ opacity: page <= 1 ? 0.45 : 1, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>
          ‹ Prev
        </button>
        {items}
        <button className="chip" disabled={page >= pages} onClick={() => onPage(page + 1)}
          style={{ opacity: page >= pages ? 0.45 : 1, cursor: page >= pages ? 'not-allowed' : 'pointer' }}>
          Next ›
        </button>
      </div>
    </div>
  );
}
