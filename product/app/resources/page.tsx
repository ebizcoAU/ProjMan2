import Link from "next/link";
import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { Faq } from "@/components/Faq";
import { Icon } from "@/components/Icon";
import { blogPosts, caseStudy, leadMagnets } from "@/lib/data";

export const metadata: Metadata = {
  title: "Resources",
  description:
    "Case studies, whitepapers, guides, and industry insights on construction workforce integrity, RPL transformation, and verifiable credentials.",
};

const faqItems = [
  {
    q: "What is the 18-Stage Construction Lifecycle?",
    a: "It's ProjMan's Core Logic Driver — every project runs through the same 18 defined stages, from Stage 1 Ingestion through to Stage 18 Practical Completion & Handover, with hold points enforced at key compliance checkpoints.",
  },
  {
    q: "What does 'multi-party verification' actually mean?",
    a: "Instead of one person's word being the record, work is confirmed by a hierarchy: the tradie ticks it, a Foreperson or Supervisor verifies it, and an Inspector attests it at hold points — so no single party can fabricate a record alone.",
  },
  {
    q: "How is evidence made immutable?",
    a: "Every tick is captured with a GPS location, a server-side timestamp, and a cryptographic hash. Once written, the record can't be silently edited — any change is itself evidenced.",
  },
  {
    q: "Is VeriTrade a separate product?",
    a: "VeriTrade is ProjMan's B2B professional network for trades. It's fed directly by verified evidence captured on ProjMan projects, so profiles are never self-reported.",
  },
];

export default function ResourcesPage() {
  return (
    <>
      <section className="bg-navy-800 py-20 sm:py-24">
        <div className="container-page text-center">
          <span className="eyebrow border-orange-400/40 bg-orange-500/10 text-orange-300">
            Resources
          </span>
          <h1 className="mt-6 text-4xl font-extrabold text-white sm:text-5xl">
            Thinking behind the platform
          </h1>
          <p className="lede mx-auto mt-4 max-w-2xl text-navy-200">
            Case studies, research, and practical guides on workforce integrity, RPL
            transformation, and verifiable credentials.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container-page">
          <Reveal className="rounded-2xl border border-navy-100 bg-navy-50 p-8 sm:p-10">
            <span className="eyebrow">Featured case study</span>
            <h2 className="h3 mt-4 text-2xl">{caseStudy.title}</h2>
            <p className="mt-3 max-w-3xl text-navy-600">{caseStudy.summary}</p>
          </Reveal>
        </div>
      </section>

      <section className="section bg-navy-50">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">Blog & insights</span>
            <h2 className="h2 mt-4">Latest thinking</h2>
          </Reveal>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {blogPosts.map((post, i) => (
              <Reveal key={post.slug} delay={(i % 3) * 0.05}>
                <article className="card flex h-full flex-col">
                  <span className="eyebrow w-fit">{post.category}</span>
                  <h3 className="h3 mt-4">{post.title}</h3>
                  <p className="mt-2 flex-1 text-sm text-navy-500">{post.excerpt}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-orange-600">
                    Read more
                    <Icon name="arrow" className="h-4 w-4" />
                  </span>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">Free resources</span>
            <h2 className="h2 mt-4">Guides & whitepapers</h2>
          </Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {leadMagnets.map((lm) => (
              <div
                key={lm.title}
                className="flex items-center justify-between gap-4 rounded-xl border border-navy-100 bg-white p-5 shadow-card"
              >
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">
                    {lm.format}
                  </p>
                  <p className="mt-1 font-semibold text-navy-800">{lm.title}</p>
                </div>
                <Link href="/contact" className="btn-outline shrink-0 px-4 py-2 text-sm">
                  Get it
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section bg-navy-50">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">FAQ</span>
            <h2 className="h2 mt-4">Common questions</h2>
          </Reveal>
          <Reveal delay={0.1} className="mx-auto mt-10 max-w-3xl">
            <Faq items={faqItems} />
          </Reveal>
        </div>
      </section>
    </>
  );
}
