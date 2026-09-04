// PortalCard.js — card wrapper. Ported from Nexus portal/_components/PortalCard.js.
export function PortalCard({ children, title, subtitle, className = '' }) {
  return (
    <div
      className={className}
      style={{
        background: 'var(--s1)',
        border: '2px solid var(--b1)',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
      }}
    >
      {(title || subtitle) && (
        <div
          style={{
            marginBottom: 12,
            borderBottom: '1px solid var(--b2)',
            paddingBottom: 8,
          }}
        >
          {title && <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{title}</div>}
          {subtitle && <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>{subtitle}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
