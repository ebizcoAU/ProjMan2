import Link from "next/link";
import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { StageExplorer } from "@/components/StageExplorer";
import { Icon } from "@/components/Icon";
import { caseStudy } from "@/lib/data";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "From self-registration to a portable, verified credential: see the six-step ProjMan flow — Register, Introduction, Job Award, Work, Verify, Credential.",
};

const flow = [
  {
    step: "01",
    title: "Register",
    icon: "users" as const,
    copy: "Self-registration with government-backed credentials — driver's licence or equivalent ID verification gets you a trusted digital identity in minutes.",
  },
  {
    step: "02",
    title: "Introduction",
    icon: "qr-code" as const,
    copy: "Meet on-site, scan a QR code business card, and exchange verified professional details instantly — no paper, no typos.",
  },
  {
    step: "03",
    title: "Job Award",
    icon: "badge" as const,
    copy: "A project-specific invitation formally engages you to the job, linking your identity to that project's evidence chain.",
  },
  {
    step: "04",
    title: "Work",
    icon: "map-pin" as const,
    copy: "Daily on-site evidence capture — tick the task, and the app geolocates, timestamps, and hashes the record automatically.",
  },
  {
    step: "05",
    title: "Verify",
    icon: "shield-check" as const,
    copy: "The multi-party chain confirms the work: Foreperson, Supervisor, and Inspector each add independent verification where required.",
  },
  {
    step: "06",
    title: "Credential",
    icon: "network" as const,
    copy: "A portable attestation is emitted to VeriTrade — a verified line in a career history that follows you, not your last employer.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <section className="bg-navy-800 py-20 sm:py-24">
        <div className="container-page text-center">
          <span className="eyebrow border-orange-400/40 bg-orange-500/10 text-orange-300">
            How it works
          </span>
          <h1 className="mt-6 text-4xl font-extrabold text-white sm:text-5xl">
            From first handshake to verified credential
          </h1>
          <p className="lede mx-auto mt-4 max-w-2xl text-navy-200">
            Six steps take a worker from a QR code exchange on-site to a portable, evidence-backed
            professional record.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container-page">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {flow.map((f, i) => (
              <Reveal key={f.step} delay={(i % 3) * 0.06}>
                <div className="card relative overflow-hidden">
                  <span className="absolute -right-2 -top-4 text-7xl font-extrabold text-navy-50">
                    {f.step}
                  </span>
                  <div className="relative flex h-11 w-11 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                    <Icon name={f.icon} className="h-6 w-6" />
                  </div>
                  <h3 className="h3 relative mt-4">{f.title}</h3>
                  <p className="relative mt-2 text-sm text-navy-500">{f.copy}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section bg-navy-50">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">The 18-Stage Lifecycle Explorer</span>
            <h2 className="h2 mt-4">Walk through a project stage by stage</h2>
            <p className="lede mt-4">
              Click any stage to see what happens on-site, who&rsquo;s involved, and what
              evidence it produces.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="mt-12">
            <StageExplorer />
          </Reveal>
        </div>
      </section>

      <section className="section">
        <div className="container-page">
          <Reveal className="mx-auto grid max-w-5xl gap-8 rounded-2xl border border-navy-100 bg-white p-8 shadow-card lg:grid-cols-[1fr_1.3fr] lg:p-12">
            <div>
              <span className="eyebrow">Case study</span>
              <h2 className="h3 mt-4 text-2xl">{caseStudy.title}</h2>
            </div>
            <div>
              <p className="text-navy-600">{caseStudy.summary}</p>
              <Link
                href={caseStudy.href}
                className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-orange-600 hover:text-orange-700"
              >
                Read the full case study
                <Icon name="arrow" className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="section bg-navy-800">
        <div className="container-page text-center">
          <h2 className="h2 text-white">See it work on your next project</h2>
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
