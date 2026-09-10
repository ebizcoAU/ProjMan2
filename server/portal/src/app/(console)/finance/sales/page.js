// /finance/sales — revenue transactions for a period (xprojman-42 §3,
// `GET /finance/reports/sales`). Expected empty today: no PM-bills-client
// write path is built yet, so nothing posts revenue (xprojman-42 §10's own
// flagged gap) — this is the report's honest state, not a bug.
'use client';

import { JournalEntriesReport } from '@/components/portal/JournalEntriesReport';
import { financeApi } from '@/lib/api';

export default function SalesPage() {
  return (
    <JournalEntriesReport
      title="Sales"
      description="Posted revenue transactions, by project."
      color="var(--green)"
      fetchFn={financeApi.sales}
      emptyMessage="No revenue posted yet — client billing isn't wired to the journal in this build."
    />
  );
}
