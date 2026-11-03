import { Icon } from "@/components/Icon";
import { Reveal } from "@/components/Reveal";

// xprojman-57 product boundary (Owner, 2026-11-01): the App is for on site,
// the web portal is for the office. Copy from xprojman-53 §9 row X1 (Owner-accepted
// 2026-11-01). Only built items are listed. The accounting export stays
// "coming soon" until a demo-company CSV import passes (row X2).

const columns = [
  {
    eyebrow: "On site",
    title: "The ProjMan app",
    lede: "On your phone or tablet, where the work happens.",
    icon: "qr-code" as const,
    items: [
      "Pair a device and introduce trade contacts by QR code",
      "Run inspection checklists and hold points",
      "Capture photos, signatures and diary entries",
      "Keep working offline; records sync when you're back in coverage",
    ],
  },
  {
    eyebrow: "In the office",
    title: "The ProjMan web portal",
    lede: "At your desk, where the project is run.",
    icon: "chart" as const,
    items: [
      "Review site evidence and quality records",
      "Manage progress claims and the programme",
      "See every project on one dashboard",
      "Accounting runs through TalkPOS, with import/export to Xero, MYOB and QuickBooks. Coming soon.",
    ],
  },
];

export function SiteOfficeSplit({ className = "section" }: { className?: string }) {
  return (
    <section className={className}>
      <div className="container-page">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">Two tools, one project record</span>
          <h2 className="h2 mt-4">On site and in the office</h2>
        </Reveal>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {columns.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.1}>
              <div className="card h-full">
                <div className="flex items-center gap-3">
                  <Icon name={c.icon} className="h-6 w-6 text-navy-700" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-navy-500">
                    {c.eyebrow}
                  </span>
                </div>
                <h3 className="h3 mt-4">{c.title}</h3>
                <p className="mt-2 text-sm text-navy-500">{c.lede}</p>
                <ul className="mt-5 space-y-2">
                  {c.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-navy-600">
                      <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-navy-700" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
