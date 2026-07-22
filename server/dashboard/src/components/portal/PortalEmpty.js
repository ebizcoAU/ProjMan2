// PortalEmpty.js — empty state. Ported from Nexus portal/_components/PortalEmpty.js.
export function PortalEmpty({ message = 'No data yet' }) {
  return (
    <div
      style={{
        padding: 40,
        textAlign: 'center',
        color: 'var(--muted)',
        fontSize: 15,
      }}
    >
      {message}
    </div>
  );
}
