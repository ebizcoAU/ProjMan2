export function StatBadge({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-navy-100 bg-white px-5 py-4 text-center shadow-card">
      <div className="stat-number">{value}</div>
      <div className="mt-1 text-sm text-navy-500">{label}</div>
    </div>
  );
}
