'use client';

// A single free-text search input — the caller decides what it searches
// (email/phone/role/org for Accounts, device/user/org/role/platform for Devices,
// name/ABN/state/plan for Organisations); this component is just the box.
export function PortalSearchBox({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200, maxWidth: 360 }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '6px 30px 6px 10px', borderRadius: 6,
          border: '1px solid var(--b1)', background: 'var(--s1)', fontSize: 14, color: 'var(--text)',
        }}
      />
      {value ? (
        <button
          onClick={() => onChange('')}
          aria-label="Clear search"
          style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: 14, padding: 2,
          }}
        >×</button>
      ) : null}
    </div>
  );
}
