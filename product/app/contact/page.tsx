import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { ContactForm } from "@/components/ContactForm";
import { Icon } from "@/components/Icon";
import { company } from "@/lib/data";

export const metadata: Metadata = {
  title: "Contact & Book a Demo",
  description:
    "Book a ProjMan demo or get in touch — talk to the team about the 18-Stage Construction Lifecycle platform and VeriTrade.",
};

const contactMethods = [
  { icon: "clock" as const, label: "Response time", value: "Within 1 business day" },
  { icon: "map-pin" as const, label: "Office", value: company.address },
  { icon: "network" as const, label: "Email", value: company.email },
  { icon: "shield-check" as const, label: "Phone", value: company.phone },
];

export default function ContactPage() {
  return (
    <>
      <section className="bg-navy-800 py-20 sm:py-24">
        <div className="container-page text-center">
          <span className="eyebrow border-orange-400/40 bg-orange-500/10 text-orange-300">
            Get in touch
          </span>
          <h1 className="mt-6 text-4xl font-extrabold text-white sm:text-5xl">
            Book a demo, or just say hello
          </h1>
          <p className="lede mx-auto mt-4 max-w-2xl text-navy-200">
            Tell us about your projects and we&rsquo;ll show you exactly where ProjMan fits.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container-page grid gap-12 lg:grid-cols-[1.3fr_1fr]">
          <Reveal>
            <div className="card">
              <h2 className="h3">Send us a message</h2>
              <p className="mt-1 mb-6 text-sm text-navy-500">
                We&rsquo;ll respond within one business day.
              </p>
              <ContactForm />
            </div>
          </Reveal>

          <Reveal delay={0.1} className="space-y-6">
            <div className="card">
              <h3 className="h3">Contact details</h3>
              <ul className="mt-4 space-y-4">
                {contactMethods.map((c) => (
                  <li key={c.label} className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                      <Icon name={c.icon} className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
                        {c.label}
                      </p>
                      <p className="text-sm font-medium text-navy-700">{c.value}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card bg-navy-800 text-white">
              <h3 className="text-lg font-bold">Prefer a live conversation?</h3>
              <p className="mt-2 text-sm text-navy-200">
                Book a 30-minute demo and we&rsquo;ll walk your team through the 18-stage
                lifecycle on a sample project.
              </p>
              <a href={`mailto:${company.email}?subject=Book%20a%20ProjMan%20demo`} className="btn-primary mt-5 w-full">
                Email to schedule
              </a>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
