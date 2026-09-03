export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <section className="section">
      <div className="container-page mx-auto max-w-3xl">
        <h1 className="h1 text-3xl sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-navy-400">Last updated: {updated}</p>
        <div className="prose-legal mt-8 space-y-5 text-sm leading-relaxed text-navy-600">
          {children}
        </div>
      </div>
    </section>
  );
}
