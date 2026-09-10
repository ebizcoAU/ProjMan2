// /finance/expenses — expense transactions for a period (xprojman-42 §3,
// `GET /finance/reports/expenses`). Posted automatically off two write
// paths only (ClaimService.pay, a supplier invoice reaching matched/
// approved) — a purchase order alone never posts (it's a commitment, not
// yet a real cost) — see xprojman-42 §10 for the full posting-trigger list.
'use client';

import { JournalEntriesReport } from '@/components/portal/JournalEntriesReport';
import { financeApi } from '@/lib/api';

export default function ExpensesPage() {
  return (
    <JournalEntriesReport
      title="Expenses"
      description="Posted expense transactions — subcontractor payments and matched/approved supplier invoices."
      color="var(--red)"
      fetchFn={financeApi.expenses}
      emptyMessage="No expenses posted in this period."
    />
  );
}
