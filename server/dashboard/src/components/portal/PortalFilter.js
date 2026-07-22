// PortalFilter.js — filters and date pickers.
// Ported from Nexus portal/_components/PortalFilter.js; en-AU strings.
export function PortalFilter({
  fromDate = '',
  toDate = '',
  onFromDateChange = () => {},
  onToDateChange = () => {},
  category = '',
  onCategoryChange = () => {},
  categories = [],
  children = null,
}) {
  const inputStyle = {
    marginTop: 4,
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid var(--b1)',
    background: 'var(--s1)',
    color: 'var(--text)',
    fontSize: 14,
    cursor: 'pointer',
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        marginBottom: 16,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      {/* From date */}
      <div>
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>
          From
        </label>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => onFromDateChange(e.target.value)}
          style={inputStyle}
        />
      </div>

      {/* To date */}
      <div>
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>
          To
        </label>
        <input
          type="date"
          value={toDate}
          onChange={(e) => onToDateChange(e.target.value)}
          style={inputStyle}
        />
      </div>

      {/* Category select */}
      {categories.length > 0 && (
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>
            Category
          </label>
          <select
            value={category}
            onChange={(e) => onCategoryChange(e.target.value)}
            style={inputStyle}
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Custom children filter controls */}
      {children}
    </div>
  );
}
