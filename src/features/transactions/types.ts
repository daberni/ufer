import type { PeriodJson } from "@/lib/period";
import type { SyncRun } from "@/features/banking/types";

export type Transaction = {
  id: string;
  booking_date: string;
  amount_minor: number;
  currency: string;
  /** The original amount of a foreign-currency booking, when the bank provides it. */
  instructed_amount_minor: number | null;
  instructed_currency: string | null;
  counterparty: string;
  description: string;
  account_name: string;
  category_id: string | null;
  category_source: string;
};

export type TransactionPage = {
  period: PeriodJson;
  page: number;
  /** The run selected by the sync run filter; null without that filter and for unknown runs. */
  syncRun: Pick<SyncRun, "id" | "started_at" | "status" | "inserted_count"> | null;
  /** Matches across all pages. */
  transactionCount: number;
  transactions: Transaction[];
};
