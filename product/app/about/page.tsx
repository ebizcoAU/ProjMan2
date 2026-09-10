import Link from "next/link";
import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { Icon } from "@/components/Icon";
import { company } from "@/lib/data";

export const metadata: Metadata = {
  title: "About",
  description:
    "ProjMan is built by eBizCo Australia Pty Ltd, an Australian software development company operating since 1998, to solve construction workforce integrity at its root.",
};

const timeline = [
  {
    year: "35 years",
    title: "On the tools and on-site",
    copy: "ProjMan's framework was shaped by decades spent watching good tradespeople get held back by paperwork they never had, not skill they lacked.",
  },
  {
    year: "1998",
    title: "eBizCo founded",
    copy: "eBizCo Australia Pty Ltd began building custom software, automation, and embedded systems for industry — the engineering discipline behind ProjMan's platform.",
  },
  {
    year: "Today",
    title: "ProjMan, built on that foundation",
    copy: "The 18-Stage Construction Lifecycle and VeriTrade network apply that engineering discipline to the hardest problem in the industry: proving the work actually happened.",
  },
];

const problems = [
  {
    stat: "35%",
    copy: "of Australian tradespeople work without a formal qualification that matches their actual skill level.",
  },
  {
    stat: "18 months",
    copy: "is a typical timeline for an RPL application — reconstructed from memory and old employer references.",
  },
  {
    stat: "$10,000+",
    copy: "is what that credentialing process can cost a worker who's already proven themselves on-site.",
  },
];

const research = [
  {
    title: "Cognitive Load Theory",
    copy: "Evidence capture is designed to minimise the mental overhead of proving your work, so it doesn't compete with doing the work.",
  },
  {
    title: "Digital Inequality",
    copy: "Voice input, QR exchange, and minimal-typing flows exist because digital literacy shouldn't gate who gets a verifiable career.",
  },
  {
    title: "Socio-Technical Systems",
    copy: "ProjMan treats workforce integrity as a system of people and process, not just a database — the tick-verify chain mirrors how trust already works on-site.",
  },
];

export default function AboutPage() {
  return (
    <>
      <section className="bg-navy-800 py-20 sm:py-24">
        <div className="container-page text-center">
          <span className="eyebrow border-orange-400/40 bg-orange-500/10 text-orange-300">
            Our story
          </span>
          <h1 className="mt-6 text-4xl font-extrabold text-white sm:text-5xl">
            We built ProjMan because proof shouldn&rsquo;t be this hard
          </h1>
          <p className="lede mx-auto mt-4 max-w-2xl text-navy-200">
            {company.valueProposition}
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">The problem</span>
            <h2 className="h2 mt-4">A credentialing system built on memory, not evidence</h2>
          </Reveal>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {problems.map((p) => (
              <Reveal key={p.stat}>
                <div className="card text-center">
                  <p className="stat-number text-orange-500">{p.stat}</p>
                  <p className="mt-2 text-sm text-navy-500">{p.copy}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section bg-navy-50">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">Our journey</span>
            <h2 className="h2 mt-4">From the tools to the platform</h2>
          </Reveal>
          <div className="mx-auto mt-12 max-w-3xl space-y-8">
            {timeline.map((t, i) => (
              <Reveal key={t.year} delay={i * 0.08}>
                <div className="flex gap-6">
                  <div className="flex w-28 shrink-0 flex-col items-end text-right">
                    <span className="text-sm font-bold text-orange-600">{t.year}</span>
                  </div>
                  <div className="relative flex-1 border-l border-navy-200 pb-8 pl-6 last:border-transparent last:pb-0">
                    <span className="absolute -left-[7px] top-1 h-3 w-3 rounded-full bg-orange-500" />
                    <h3 className="h3">{t.title}</h3>
                    <p className="mt-2 text-sm text-navy-500">{t.copy}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">Research foundation</span>
            <h2 className="h2 mt-4">A socio-technical framework, not just an app</h2>
            <p className="lede mt-4">
              ProjMan&apos;s design draws on established research into how people and systems build
              trust together.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {research.map((r) => (
              <div key={r.title} className="card">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                  <Icon name="badge" className="h-6 w-6" />
                </div>
                <h3 className="h3 mt-4">{r.title}</h3>
                <p className="mt-2 text-sm text-navy-500">{r.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section bg-navy-50">
        <div className="container-page">
          <Reveal className="mx-auto max-w-3xl rounded-2xl border border-navy-100 bg-white p-8 text-center shadow-card sm:p-10">
            <span className="eyebrow">The company behind ProjMan</span>
            <h2 className="h3 mt-4 text-2xl">{company.legalName}</h2>
            <p className="mt-3 text-navy-600">
              ProjMan is developed and operated by {company.legalName}, an Australian software
              development company delivering web, mobile, automation, and embedded systems since{" "}
              {company.tradingSince}. That engineering track record underpins ProjMan&apos;s approach
              to immutable evidence and verified identity.
            </p>
            <p className="mt-4 text-sm text-navy-400">
              {company.address} · {company.phone}
            </p>
          </Reveal>
        </div>
      </section>

      <section className="section bg-navy-800">
        <div className="container-page text-center">
          <h2 className="h2 text-white">Want to talk to the team?</h2>
          <div className="mt-8">
            <Link href="/contact" className="btn-primary px-7 py-3.5 text-base">
              Get in touch
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
