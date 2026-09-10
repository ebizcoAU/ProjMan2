import Link from "next/link";
import type { Metadata } from "next";
import { Icon } from "@/components/Icon";
import { Reveal } from "@/components/Reveal";
import { StageExplorer } from "@/components/StageExplorer";
import { StatBadge } from "@/components/StatBadge";
import { FeatureCard } from "@/components/FeatureCard";
import { Testimonials } from "@/components/Testimonials";
import { features, stats, company, platformModules } from "@/lib/data";

export const metadata: Metadata = {
  title: "Project Management Software for Building & Construction",
  description:
    "ProjMan is the project management platform for building and construction — site diaries, scheduling, documents, drawings, defects, RFIs, permits, safety & OHS, and NCC compliance in one system, with the industry's only immutable, multi-party verified evidence trail.",
};

const partnerLogos = ["Tier-1 Builders", "RTOs", "State Government", "VeriTrade", "Industry Bodies"];

const homeFeatureSlugs = ["lifecycle", "analytics", "compliance", "verification"];
const homeFeatures = homeFeatureSlugs
  .map((slug) => features.find((f) => f.slug === slug))
  .filter((f): f is (typeof features)[number] => Boolean(f));

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "ProjMan",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web, iOS, Android",
  description:
    "ProjMan is a complete construction project management platform — site diaries, checklists, scheduling, documents, drawings, defects, RFIs, submittals, permits, safety & OHS, National Construction Code compliance, and an AI assistant — built on the 18-Stage Construction Lifecycle with multi-party verified, immutable on-site evidence.",
  publisher: {
    "@type": "Organization",
    name: company.legalName,
    email: company.companyEmail,
    address: company.address,
  },
  offers: {
    "@type": "AggregateOffer",
    priceCurrency: "AUD",
    lowPrice: "79",
    offerCount: "3",
  },
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Hero */}
      <section className="relative overflow-hidden bg-navy-800">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
          aria-hidden="true"
        />
        <div className="container-page relative py-24 sm:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <span className="eyebrow border-orange-400/40 bg-orange-500/10 text-orange-300">
              Construction project management, built for Australia
            </span>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
              {company.pmTagline}
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-navy-200 sm:text-xl">
              Site diaries, scheduling, documents, drawings, defects, RFIs, permits, safety
              &amp; OHS, and National Construction Code compliance — mapped to an 18-stage
              lifecycle, with an AI assistant and the industry&rsquo;s only immutable,
              multi-party verified evidence trail built in.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link href="/contact" className="btn-primary px-7 py-3.5 text-base">
                Start Your Free Trial
              </Link>
              <Link href="/how-it-works" className="btn px-7 py-3.5 text-base text-white ring-1 ring-inset ring-white/25 hover:bg-white/10">
                See How It Works
              </Link>
            </div>
            <p className="mt-6 text-sm text-navy-300">
              No credit card required · Set up your first project in minutes
            </p>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-b border-navy-100 bg-navy-50 py-8">
        <div className="container-page flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-sm font-semibold uppercase tracking-wide text-navy-400">
          {partnerLogos.map((p) => (
            <span key={p}>{p}</span>
          ))}
        </div>
      </section>

      {/* Everything under one roof */}
      <section className="section pb-16 pt-16">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">One platform, every register</span>
            <h2 className="h2 mt-4">Everything under one roof</h2>
            <p className="lede mt-4">
              Site diaries, checklists, scheduling, documents, drawings, defects, RFIs,
              submittals, permits, safety &amp; OHS, National Construction Code compliance, and
              an AI assistant — 21 modules, one project record.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="mx-auto mt-8 flex max-w-4xl flex-wrap justify-center gap-2">
            {platformModules.map((m) => (
              <span
                key={m.title}
                className="rounded-full border border-navy-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-navy-600 shadow-sm"
              >
                {m.title}
              </span>
            ))}
          </Reveal>
          <div className="mt-8 text-center">
            <Link href="/features" className="btn-outline">
              See every module
              <Icon name="arrow" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="section pt-0">
        <div className="container-page">
          <Reveal>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {stats.map((s) => (
                <StatBadge key={s.label} value={s.value} label={s.label} />
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Problem / Solution */}
      <section className="section bg-navy-50">
        <div className="container-page grid gap-12 lg:grid-cols-2 lg:items-center">
          <Reveal>
            <span className="eyebrow">The problem</span>
            <h2 className="h2 mt-4">Running a build shouldn&rsquo;t mean chasing paper.</h2>
            <p className="lede mt-4">
              Site diaries in one app, drawings in email, defects on a whiteboard, RFIs in a
              spreadsheet, permits in a filing cabinet. Progress claims and compliance sign-off
              end up resting on whoever remembers to chase them — and disputes come down to one
              person&rsquo;s word against another&rsquo;s.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="card">
              <span className="eyebrow">The solution</span>
              <h3 className="h3 mt-4">One project record, verified as it happens</h3>
              <p className="mt-3 text-navy-600">
                Every stage runs through ProjMan&rsquo;s registers — diaries, checklists,
                drawings, defects, RFIs, permits — and every completion is confirmed by a
                multi-party tick-verify chain: Tradie ticks it, Foreperson verifies it,
                Supervisor confirms it, Inspector attests it at hold points. That builds trust
                between the people on-site, and leaves a geolocated, timestamped, immutable
                record for compliance, claims, and disputes — with credentialing evidence for
                RPL as a bonus, not the point.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 18-stage explorer */}
      <section className="section">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">The Core Logic Driver</span>
            <h2 className="h2 mt-4">The 18-Stage Construction Lifecycle</h2>
            <p className="lede mt-4">
              Every ProjMan project runs on the same backbone — from Stage 1 Ingestion to Stage
              18 Practical Completion &amp; Handover. Click any stage to see what happens on-site
              and what evidence it produces.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="mt-12">
            <StageExplorer />
          </Reveal>
        </div>
      </section>

      {/* Features */}
      <section className="section bg-navy-50">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">Platform</span>
            <h2 className="h2 mt-4">Built to run the project, wired to prove it</h2>
          </Reveal>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {homeFeatures.map((f, i) => (
              <Reveal key={f.slug} delay={i * 0.05}>
                <FeatureCard feature={f} />
              </Reveal>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link href="/features" className="btn-outline">
              View all features
              <Icon name="arrow" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="section">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">Trusted across the industry</span>
            <h2 className="h2 mt-4">What project teams say once it&apos;s one system</h2>
          </Reveal>
          <div className="mt-12">
            <Testimonials />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section bg-navy-800">
        <div className="container-page text-center">
          <Reveal>
            <h2 className="h2 text-white">Run your next project in one system.</h2>
            <p className="lede mt-4 text-navy-200">
              See how ProjMan brings every register on-site together — and turns the work into a
              verified, defensible record along the way.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link href="/contact" className="btn-primary px-7 py-3.5 text-base">
                Book a Demo
              </Link>
              <Link href="/veritrade" className="btn px-7 py-3.5 text-base text-white ring-1 ring-inset ring-white/25 hover:bg-white/10">
                Explore VeriTrade
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
