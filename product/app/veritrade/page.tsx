import Link from "next/link";
import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { Icon } from "@/components/Icon";
import { company } from "@/lib/data";

export const metadata: Metadata = {
  title: "VeriTrade",
  description:
    "VeriTrade is Australia's first B2B professional network for trades — evidence-based profiles built from verified work history, not reviews.",
};

const profileHighlights = [
  { label: "Licence status", value: "State-verified · Active", icon: "shield-check" as const },
  { label: "Verified projects", value: "42 completed", icon: "badge" as const },
  { label: "Stages worked", value: "12 of 18", icon: "layers" as const },
  { label: "Last verification", value: "3 days ago", icon: "clock" as const },
];

const searchFilters = ["Trade", "Licence class", "State", "Availability", "Verified project count"];

const tiers = [
  {
    name: "Supply side",
    who: "Tradespeople & workers",
    price: "Free forever",
    copy: "Your verified profile, career history, and RPL evidence portfolio cost nothing, for life.",
    highlighted: false,
  },
  {
    name: "Demand side",
    who: "Builders & recruiters",
    price: "Paid subscription",
    copy: "Search, filter, and directly engage verified trades with proof of skill on real projects.",
    highlighted: true,
  },
];

export default function VeriTradePage() {
  return (
    <>
      <section className="bg-navy-800 py-20 sm:py-24">
        <div className="container-page grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <span className="eyebrow border-orange-400/40 bg-orange-500/10 text-orange-300">
              VeriTrade · {company.tagline}
            </span>
            <h1 className="mt-6 text-4xl font-extrabold text-white sm:text-5xl">
              LinkedIn for tradies — built on proof, not testimony.
            </h1>
            <p className="lede mt-4 text-navy-200">
              Australia&rsquo;s first B2B professional network for trades. Every profile is built
              from verified, multi-party work history captured directly from real projects —
              not a star rating or a written review.
            </p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <Link href="/contact" className="btn-primary px-7 py-3.5 text-base">
                List Your Trade
              </Link>
              <Link
                href="#search"
                className="btn px-7 py-3.5 text-base text-white ring-1 ring-inset ring-white/25 hover:bg-white/10"
              >
                Search for Talent
              </Link>
            </div>
          </div>

          <div id="profiles" className="scroll-mt-24 rounded-2xl border border-navy-600 bg-navy-700 p-6 shadow-card-hover">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-500 text-lg font-bold text-white">
                JT
              </div>
              <div>
                <p className="font-bold text-white">J. Thompson</p>
                <p className="text-sm text-navy-300">Licensed Electrician · WA</p>
              </div>
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success">
                <Icon name="shield-check" className="h-3.5 w-3.5" />
                Verified
              </span>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {profileHighlights.map((h) => (
                <div key={h.label} className="rounded-lg bg-navy-800 p-3">
                  <div className="flex items-center gap-2 text-navy-300">
                    <Icon name={h.icon} className="h-4 w-4" />
                    <span className="text-xs">{h.label}</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-white">{h.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">Evidence, not endorsements</span>
            <h2 className="h2 mt-4">Reviews get replaced by verified work</h2>
            <p className="lede mt-4">
              Anyone can leave a five-star review. A VeriTrade profile is different — it&rsquo;s
              built entirely from stage-by-stage evidence generated on real ProjMan projects,
              confirmed by the people who were actually there.
            </p>
          </Reveal>
        </div>
      </section>

      <section id="search" className="section scroll-mt-16 bg-navy-50">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">B2B talent discovery</span>
            <h2 className="h2 mt-4">Search verified trades, project by project</h2>
          </Reveal>
          <Reveal delay={0.1} className="mx-auto mt-10 max-w-4xl rounded-2xl border border-navy-100 bg-white p-6 shadow-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-navy-100 pb-4">
              <Icon name="search" className="h-5 w-5 text-navy-400" />
              <input
                readOnly
                value="Licensed electrician, WA, available this month"
                className="min-w-[240px] flex-1 bg-transparent text-sm text-navy-600 outline-none"
              />
              <button type="button" className="btn-primary px-4 py-2 text-sm">
                Search
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {searchFilters.map((f) => (
                <span
                  key={f}
                  className="rounded-full border border-navy-200 px-3 py-1 text-xs font-medium text-navy-500"
                >
                  {f}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="section">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">State-verified badges</span>
            <h2 className="h2 mt-4">Trust signals that mean something</h2>
            <p className="lede mt-4">
              Licence badges are checked against state licensing data, not self-declared — so a
              badge on VeriTrade carries the same weight as checking the register yourself.
            </p>
          </Reveal>
        </div>
      </section>

      <section id="pricing" className="section scroll-mt-16 bg-navy-800">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow border-orange-400/40 bg-orange-500/10 text-orange-300">
              VeriTrade pricing
            </span>
            <h2 className="h2 mt-4 text-white">Free for the trades. Paid for the demand side.</h2>
          </Reveal>
          <div className="mx-auto mt-12 grid max-w-3xl gap-6 sm:grid-cols-2">
            {tiers.map((t) => (
              <div
                key={t.name}
                className={`rounded-2xl border p-8 ${
                  t.highlighted ? "border-orange-400 bg-navy-700" : "border-navy-600 bg-navy-800"
                }`}
              >
                <h3 className="text-lg font-bold text-white">{t.name}</h3>
                <p className="mt-1 text-sm text-navy-300">{t.who}</p>
                <p className="mt-4 text-2xl font-extrabold text-orange-400">{t.price}</p>
                <p className="mt-3 text-sm text-navy-200">{t.copy}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link href="/contact" className="btn-primary px-7 py-3.5 text-base">
              Join the Future of Construction
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
