import { Icon } from "@/components/Icon";
import { platformModules } from "@/lib/data";

export function ModuleGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {platformModules.map((m) => (
        <div
          key={m.title}
          className="flex items-start gap-3 rounded-xl border border-navy-100 bg-white p-4 shadow-card transition-shadow hover:shadow-card-hover"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
            <Icon name={m.icon as any} className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-navy-800">{m.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-navy-500">{m.copy}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
