import Link from "next/link";
import { Icon } from "@/components/Icon";
import type { Feature } from "@/lib/data";

export function FeatureCard({ feature, showLink = true }: { feature: Feature; showLink?: boolean }) {
  return (
    <div id={feature.slug} className="card flex h-full scroll-mt-24 flex-col">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
        <Icon name={feature.icon as any} className="h-6 w-6" />
      </div>
      <h3 className="h3 mt-4">{feature.title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-navy-500">{feature.short}</p>
      {showLink && (
        <Link
          href={`/features#${feature.slug}`}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-orange-600 hover:text-orange-700"
        >
          Learn more
          <Icon name="arrow" className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
