import type { PeriodJson } from "@/lib/period";
import type { SyncRun } from "@/features/banking/types";
import type { TransactionType } from "./transaction-types";

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
  type: TransactionType;
  type_source: "auto" | "manual";
  /** Whether the booking belongs to a manual account, which also allows the opening balance and adjustment types. */
  manual_account: boolean;
  /** The other booking of a linked transfer; null for a transfer to an account not tracked in Ufer and for every other type. */
  counterpart: {
    id: string;
    account_name: string;
    booking_date: string;
  } | null;
};

/** A booking as shown when linking the two sides of a transfer. */
export type TransferBooking = {
  id: string;
  account_name: string;
  booking_date: string;
  amount_minor: number;
  currency: string;
  counterparty: string;
  description: string;
};

/** A booking's transfer link, or, while it has none, what it can be linked with. */
export type TransferOptions = {
  counterpart: TransferBooking | null;
  /** Unlinked bookings with the opposite amount on other accounts, closest booking date first. */
  candidates: TransferBooking[];
  /** Manual accounts in the booking's currency on which a counterpart can be created. */
  accounts: {
    id: string;
    name: string;
  }[];
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
