import { testimonials } from "@/lib/data";

export function Testimonials() {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {testimonials.map((t) => (
        <figure key={t.name} className="card flex flex-col justify-between">
          <blockquote className="text-navy-700">
            <p className="text-[15px] leading-relaxed">&ldquo;{t.quote}&rdquo;</p>
          </blockquote>
          <figcaption className="mt-6 border-t border-navy-100 pt-4">
            <p className="text-sm font-semibold text-navy-800">{t.name}</p>
            <p className="text-xs text-navy-400">{t.role}</p>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
