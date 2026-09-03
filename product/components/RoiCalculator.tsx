"use client";

import { useMemo, useState } from "react";

const AVG_RPL_COST = 10000;
const RPL_SAVINGS_RATE = 0.9;
const ADMIN_HOURS_SAVED_PER_PROJECT = 6;
const HOURLY_ADMIN_COST = 65;

export function RoiCalculator() {
  const [projects, setProjects] = useState(12);
  const [employees, setEmployees] = useState(25);
  const [rplCandidates, setRplCandidates] = useState(5);

  const results = useMemo(() => {
    const rplSavings = rplCandidates * AVG_RPL_COST * RPL_SAVINGS_RATE;
    const adminSavings = projects * ADMIN_HOURS_SAVED_PER_PROJECT * HOURLY_ADMIN_COST;
    const totalAnnualSavings = rplSavings + adminSavings;
    const perEmployee = employees > 0 ? totalAnnualSavings / employees : 0;
    return { rplSavings, adminSavings, totalAnnualSavings, perEmployee };
  }, [projects, employees, rplCandidates]);

  const currency = (n: number) =>
    n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

  return (
    <div className="grid gap-8 rounded-2xl border border-navy-100 bg-white p-6 shadow-card sm:p-8 lg:grid-cols-2">
      <div className="space-y-6">
        <Field
          label="Active projects per year"
          value={projects}
          min={1}
          max={100}
          onChange={setProjects}
        />
        <Field
          label="Employees & subcontractors"
          value={employees}
          min={1}
          max={500}
          onChange={setEmployees}
        />
        <Field
          label="Workers pursuing RPL credentialing"
          value={rplCandidates}
          min={0}
          max={100}
          onChange={setRplCandidates}
        />
        <p className="text-xs text-navy-400">
          Estimates use an average RPL cost of {currency(AVG_RPL_COST)} per worker and{" "}
          {ADMIN_HOURS_SAVED_PER_PROJECT} hours of admin time saved per project at{" "}
          {currency(HOURLY_ADMIN_COST)}/hour — illustrative figures, not a guarantee.
        </p>
      </div>

      <div className="flex flex-col justify-center rounded-xl bg-navy-800 p-6 text-white sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-orange-300">
          Estimated annual savings
        </p>
        <p className="mt-2 text-4xl font-extrabold sm:text-5xl">
          {currency(results.totalAnnualSavings)}
        </p>
        <dl className="mt-6 space-y-3 text-sm">
          <div className="flex justify-between border-b border-navy-600 pb-2">
            <dt className="text-navy-200">RPL credentialing savings</dt>
            <dd className="font-semibold">{currency(results.rplSavings)}</dd>
          </div>
          <div className="flex justify-between border-b border-navy-600 pb-2">
            <dt className="text-navy-200">Admin & compliance time saved</dt>
            <dd className="font-semibold">{currency(results.adminSavings)}</dd>
          </div>
          <div className="flex justify-between pt-1">
            <dt className="text-navy-200">Value per employee</dt>
            <dd className="font-semibold">{currency(results.perEmployee)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-sm font-semibold text-navy-700">
        {label}
        <span className="rounded-md bg-orange-50 px-2 py-0.5 text-orange-600">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-navy-100 accent-orange-500"
      />
    </label>
  );
}
