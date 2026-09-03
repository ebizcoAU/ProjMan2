import Link from "next/link";
import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { RoleTabs } from "@/components/RoleTabs";
import { Icon } from "@/components/Icon";

export const metadata: Metadata = {
  title: "Solutions",
  description:
    "ProjMan solutions for Project Managers, Builders, Tradespeople, Government & Regulators, and Investors — one platform, tailored to every role in the lifecycle.",
};

const crossRoleBenefits = [
  {
    icon: "shield-check" as const,
    title: "One evidence chain, every role trusts it",
    copy: "Because verification is multi-party by design, no role has to take another's word for it — the record speaks for itself.",
  },
  {
    icon: "clock" as const,
    title: "Less admin, more delivery",
    copy: "Progress claims, compliance checks, and credentialing evidence assemble themselves as the work happens.",
  },
  {
    icon: "globe" as const,
    title: "Portable across projects and employers",
    copy: "A tradesperson's history, a builder's compliance trail, and a regulator's audit record all travel with the work, not the workplace.",
  },
];

export default function SolutionsPage() {
  return (
    <>
      <section className="bg-navy-800 py-20 sm:py-24">
        <div className="container-page text-center">
          <span className="eyebrow border-orange-400/40 bg-orange-500/10 text-orange-300">
            Solutions by role
          </span>
          <h1 className="mt-6 text-4xl font-extrabold text-white sm:text-5xl">
            One platform. Built for every seat at the table.
          </h1>
          <p className="lede mx-auto mt-4 max-w-2xl text-navy-200">
            Select your role to see how ProjMan changes your day-to-day.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container-page">
          <RoleTabs />
        </div>
      </section>

      <section className="section bg-navy-50">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">Why one system works for everyone</span>
            <h2 className="h2 mt-4">Cross-role benefits</h2>
          </Reveal>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {crossRoleBenefits.map((b) => (
              <div key={b.title} className="card">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                  <Icon name={b.icon} className="h-6 w-6" />
                </div>
                <h3 className="h3 mt-4">{b.title}</h3>
                <p className="mt-2 text-sm text-navy-500">{b.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section bg-navy-800">
        <div className="container-page text-center">
          <h2 className="h2 text-white">Not sure where you fit?</h2>
          <p className="lede mt-4 text-navy-200">
            Talk to us and we&rsquo;ll show you exactly how ProjMan applies to your role.
          </p>
          <div className="mt-8">
            <Link href="/contact" className="btn-primary px-7 py-3.5 text-base">
              Book a Demo
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
