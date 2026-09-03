"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { stages, type Stage } from "@/lib/data";
import { Icon } from "@/components/Icon";

const phaseColors: Record<Stage["phase"], string> = {
  Origination: "bg-navy-400",
  "Design & Approvals": "bg-navy-600",
  Construction: "bg-orange-500",
  "Close-out": "bg-success",
};

export function StageExplorer({ compact = false }: { compact?: boolean }) {
  const [active, setActive] = useState<number>(1);
  const current = useMemo(() => stages.find((s) => s.number === active)!, [active]);

  return (
    <div className="rounded-2xl border border-navy-100 bg-white p-4 shadow-card sm:p-6">
      <div
        className="grid grid-cols-6 gap-2 sm:grid-cols-9 lg:grid-cols-[repeat(18,minmax(0,1fr))]"
        role="tablist"
        aria-label="18-Stage Construction Lifecycle"
      >
        {stages.map((stage) => (
          <button
            key={stage.number}
            role="tab"
            aria-selected={active === stage.number}
            onClick={() => setActive(stage.number)}
            className={`group relative flex aspect-square flex-col items-center justify-center rounded-lg text-xs font-bold text-white transition-all duration-200 ${
              phaseColors[stage.phase]
            } ${
              active === stage.number
                ? "ring-2 ring-orange-400 ring-offset-2 scale-105"
                : "opacity-70 hover:opacity-100"
            }`}
            title={`Stage ${stage.number}: ${stage.name}`}
          >
            {stage.number}
            {stage.holdPoint && (
              <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-warning">
                <span className="sr-only">Hold point</span>
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-navy-400">
        {(Object.keys(phaseColors) as Stage["phase"][]).map((phase) => (
          <span key={phase} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${phaseColors[phase]}`} />
            {phase}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-warning" />
          Hold point
        </span>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={current.number}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="mt-6 rounded-xl bg-navy-50 p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="eyebrow">Stage {current.number} · {current.phase}</span>
            {current.holdPoint && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-light px-3 py-1 text-xs font-semibold text-navy-700">
                <Icon name="lock" className="h-3.5 w-3.5" />
                {current.holdPoint}
              </span>
            )}
          </div>
          <h3 className="mt-3 text-2xl font-bold text-navy-800">{current.name}</h3>
          <p className="mt-2 max-w-2xl text-navy-600">{current.summary}</p>

          {!compact && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
                  On-site action
                </p>
                <p className="mt-1 text-sm text-navy-700">{current.tradieAction}</p>
              </div>
              <div className="rounded-lg bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
                  Evidence captured
                </p>
                <p className="mt-1 text-sm text-navy-700">{current.evidence}</p>
              </div>
            </div>
          )}

          <div className="mt-5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setActive((n) => Math.max(1, n - 1))}
              disabled={active === 1}
              className="inline-flex items-center gap-1 text-sm font-semibold text-navy-500 hover:text-orange-600 disabled:opacity-30"
            >
              <Icon name="arrow" className="h-4 w-4 rotate-180" />
              Previous
            </button>
            <button
              type="button"
              onClick={() => setActive((n) => Math.min(18, n + 1))}
              disabled={active === 18}
              className="inline-flex items-center gap-1 text-sm font-semibold text-navy-500 hover:text-orange-600 disabled:opacity-30"
            >
              Next
              <Icon name="arrow" className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
