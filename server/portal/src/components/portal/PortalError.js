// PortalError.js — error display. Ported from Nexus portal/_components/PortalError.js,
// recoloured for the light theme (the Nexus dark-red block fails contrast on white).
export function PortalError({ message = 'Something went wrong loading this data' }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 8,
        background: 'var(--rdim)',
        border: '1px solid rgba(185,28,28,.45)',
        color: 'var(--red)',
        fontSize: 14,
      }}
    >
      ⚠️ {message}
    </div>
  );
}
