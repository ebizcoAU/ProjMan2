import Link from "next/link";
import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { PricingCard } from "@/components/PricingCard";
import { RoiCalculator } from "@/components/RoiCalculator";
import { Faq } from "@/components/Faq";
import { pricingTiers } from "@/lib/data";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Transparent ProjMan pricing for Starter, Professional, and Enterprise builders — plus a free-forever VeriTrade profile for every tradesperson.",
};

const faqItems = [
  {
    q: "Is there a free trial?",
    a: "Yes. Starter and Professional plans come with a free trial — no credit card required to get your first project set up and start capturing evidence.",
  },
  {
    q: "How does VeriTrade pricing work?",
    a: "VeriTrade is free forever for tradespeople and workers on the supply side. Builders and recruiters on the demand side pay for search and direct engagement.",
  },
  {
    q: "Can I switch plans later?",
    a: "Absolutely — you can move between Starter and Professional at any time, and upgrades take effect immediately with prorated billing.",
  },
  {
    q: "What counts as an 'active project'?",
    a: "Any project currently in one of the 18 lifecycle stages, from Ingestion through to Handover. Completed and archived projects don't count against your limit.",
  },
  {
    q: "Do Enterprise plans include API access?",
    a: "Yes. Enterprise includes full API access, custom stage and role configuration, and a dedicated implementation team.",
  },
];

export default function PricingPage() {
  return (
    <>
      <section className="bg-navy-800 py-20 sm:py-24">
        <div className="container-page text-center">
          <span className="eyebrow border-orange-400/40 bg-orange-500/10 text-orange-300">
            Transparent pricing
          </span>
          <h1 className="mt-6 text-4xl font-extrabold text-white sm:text-5xl">
            Pricing that scales with your projects, not against you
          </h1>
          <p className="lede mx-auto mt-4 max-w-2xl text-navy-200">
            Every plan includes the full 18-stage lifecycle engine and multi-party verification —
            what changes is scale and support.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container-page grid gap-8 lg:grid-cols-3">
          {pricingTiers.map((tier) => (
            <Reveal key={tier.name}>
              <PricingCard tier={tier} />
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section bg-navy-50">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">ROI calculator</span>
            <h2 className="h2 mt-4">See what verified evidence is worth to you</h2>
            <p className="lede mt-4">
              A rough, directional estimate of what ProjMan could save your business each year.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="mx-auto mt-12 max-w-4xl">
            <RoiCalculator />
          </Reveal>
        </div>
      </section>

      <section className="section">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">Frequently asked</span>
            <h2 className="h2 mt-4">Pricing questions</h2>
          </Reveal>
          <Reveal delay={0.1} className="mx-auto mt-10 max-w-3xl">
            <Faq items={faqItems} />
          </Reveal>
        </div>
      </section>

      <section className="section bg-navy-800">
        <div className="container-page text-center">
          <h2 className="h2 text-white">Ready to get started?</h2>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/contact" className="btn-primary px-7 py-3.5 text-base">
              Start Your Free Trial
            </Link>
            <Link
              href="/contact"
              className="btn px-7 py-3.5 text-base text-white ring-1 ring-inset ring-white/25 hover:bg-white/10"
            >
              Talk to Sales
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
