import Link from "next/link";
import { Icon } from "@/components/Icon";
import type { PricingTier } from "@/lib/data";

export function PricingCard({ tier }: { tier: PricingTier }) {
  return (
    <div
      className={`flex h-full flex-col rounded-2xl border p-8 ${
        tier.highlighted
          ? "border-orange-300 bg-navy-800 text-white shadow-card-hover"
          : "border-navy-100 bg-white shadow-card"
      }`}
    >
      {tier.highlighted && (
        <span className="eyebrow mb-4 w-fit border-orange-400 bg-orange-500/10 text-orange-300">
          Most popular
        </span>
      )}
      <h3 className={`text-xl font-bold ${tier.highlighted ? "text-white" : "text-navy-800"}`}>
        {tier.name}
      </h3>
      <p className={`mt-1 text-sm ${tier.highlighted ? "text-navy-200" : "text-navy-500"}`}>
        {tier.audience}
      </p>

      <div className="mt-6 flex items-end gap-2">
        <span className={`text-4xl font-extrabold ${tier.highlighted ? "text-white" : "text-navy-800"}`}>
          {tier.price}
        </span>
        <span className={`pb-1 text-sm ${tier.highlighted ? "text-navy-300" : "text-navy-400"}`}>
          {tier.cadence}
        </span>
      </div>

      <p className={`mt-4 text-sm leading-relaxed ${tier.highlighted ? "text-navy-200" : "text-navy-500"}`}>
        {tier.description}
      </p>

      <ul className="mt-6 flex-1 space-y-3">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <Icon
              name="check"
              className={`mt-0.5 h-4 w-4 shrink-0 ${tier.highlighted ? "text-success" : "text-success"}`}
            />
            <span className={tier.highlighted ? "text-navy-100" : "text-navy-600"}>{f}</span>
          </li>
        ))}
      </ul>

      <Link
        href={tier.cta.href}
        className={`mt-8 w-full text-center ${tier.highlighted ? "btn-primary" : "btn-outline"}`}
      >
        {tier.cta.label}
      </Link>
    </div>
  );
}
