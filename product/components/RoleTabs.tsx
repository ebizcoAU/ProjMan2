"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { roles, type Role } from "@/lib/data";
import { Icon } from "@/components/Icon";

export function RoleTabs({ initial }: { initial?: Role }) {
  const [active, setActive] = useState<Role>(initial ?? roles[0].id);
  const role = roles.find((r) => r.id === active)!;

  return (
    <div>
      <div
        className="flex flex-wrap justify-center gap-2 rounded-full border border-navy-100 bg-navy-50 p-1.5 sm:inline-flex"
        role="tablist"
        aria-label="Select your role"
      >
        {roles.map((r) => (
          <button
            key={r.id}
            role="tab"
            aria-selected={active === r.id}
            onClick={() => setActive(r.id)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              active === r.id
                ? "bg-orange-500 text-white shadow-card"
                : "text-navy-600 hover:text-navy-900"
            }`}
          >
            {r.id}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={role.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25 }}
          className="mt-10 grid gap-10 rounded-2xl border border-navy-100 bg-white p-8 shadow-card lg:grid-cols-2 lg:p-12"
        >
          <div>
            <span className="eyebrow">For {role.id}</span>
            <h2 className="h2 mt-4">{role.headline}</h2>
            <p className="lede mt-4">{role.description}</p>
            <Link href={role.cta.href} className="btn-primary mt-6">
              {role.cta.label}
              <Icon name="arrow" className="h-4 w-4" />
            </Link>
          </div>
          <ul className="space-y-4">
            {role.bullets.map((b) => (
              <li key={b} className="flex items-start gap-3 rounded-xl bg-navy-50 p-4">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                  <Icon name="check" className="h-4 w-4" />
                </span>
                <span className="text-sm font-medium text-navy-700">{b}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
