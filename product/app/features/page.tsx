import Link from "next/link";
import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { FeatureCard } from "@/components/FeatureCard";
import { ModuleGrid } from "@/components/ModuleGrid";
import { StageExplorer } from "@/components/StageExplorer";
import { Icon } from "@/components/Icon";
import { features } from "@/lib/data";

export const metadata: Metadata = {
  title: "Features",
  description:
    "ProjMan is a complete construction project management platform — site diaries, checklists, scheduling, documents, drawings, defects, RFIs, submittals, permits, safety & OHS, National Construction Code compliance, and an AI assistant — plus an immutable, multi-party verified evidence layer no other platform has.",
};

export default function FeaturesPage() {
  return (
    <>
      <section className="bg-navy-800 py-20 sm:py-24">
        <div className="container-page text-center">
          <span className="eyebrow border-orange-400/40 bg-orange-500/10 text-orange-300">
            Platform capabilities
          </span>
          <h1 className="mt-6 text-4xl font-extrabold text-white sm:text-5xl">
            Every register a construction project needs, in one platform
          </h1>
          <p className="lede mx-auto mt-4 max-w-2xl text-navy-200">
            Site diaries, checklists, scheduling, documents, drawings, defects, RFIs, submittals,
            permits, safety and OHS, National Construction Code compliance, and an AI assistant —
            run day to day, on top of the industry&rsquo;s only immutable, multi-party verified
            evidence layer.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">The complete platform</span>
            <h2 className="h2 mt-4">21 modules, one project record</h2>
            <p className="lede mt-4">
              No separate tools for diaries, drawings, and defects. Every register talks to the
              same project, the same stage, and the same evidence trail.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="mt-12">
            <ModuleGrid />
          </Reveal>
        </div>
      </section>

      <section className="section bg-navy-50">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">What makes ProjMan different</span>
            <h2 className="h2 mt-4">The verification layer nobody else has</h2>
            <p className="lede mt-4">
              These are the capabilities that turn day-to-day project management into a
              defensible, portable record of workforce integrity.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <Reveal key={f.slug} delay={(i % 3) * 0.05}>
                <FeatureCard feature={f} showLink={false} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section bg-navy-50">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">See it in context</span>
            <h2 className="h2 mt-4">Features, mapped to the lifecycle</h2>
            <p className="lede mt-4">
              Hold points, verification chains, and evidence capture aren&rsquo;t separate
              add-ons — they&rsquo;re built into every one of the 18 stages.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="mt-12">
            <StageExplorer compact />
          </Reveal>
        </div>
      </section>

      <section className="section">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">Integration ecosystem</span>
            <h2 className="h2 mt-4">Built to connect, not to trap your data</h2>
          </Reveal>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {[
              {
                title: "VeriTrade",
                copy: "Every completed stage can emit a portable, verified credential straight to a worker's VeriTrade profile.",
              },
              {
                title: "Accounting & payroll",
                copy: "Progress claims and variations sync with your finance stack, so approvals don't mean double entry.",
              },
              {
                title: "Open API",
                copy: "Enterprise customers get full API access to integrate ProjMan into their own reporting and BI tools.",
              },
            ].map((c) => (
              <div key={c.title} className="card">
                <h3 className="h3">{c.title}</h3>
                <p className="mt-2 text-sm text-navy-500">{c.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section bg-navy-800">
        <div className="container-page text-center">
          <h2 className="h2 text-white">Ready to see it on a real project?</h2>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/contact" className="btn-primary px-7 py-3.5 text-base">
              Book a Demo
            </Link>
            <Link href="/solutions" className="btn px-7 py-3.5 text-base text-white ring-1 ring-inset ring-white/25 hover:bg-white/10">
              Explore solutions by role
              <Icon name="arrow" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
