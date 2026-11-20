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
  /** The payee and description the source delivered; they differ from `counterparty` and `description` while a person's override applies. */
  source_counterparty: string;
  source_description: string;
  /** Whether the imported booking is hidden: it stays listed but counts toward no balance or report, and later syncs and imports keep it hidden. */
  hidden: boolean;
  account_name: string;
  category_id: string | null;
  category_source: string;
  /** The rule that assigned a rule-sourced category; null when it is not recorded, for example for assignments made before Ufer recorded it or by a deleted rule. */
  category_rule_id: string | null;
  /** For a manual assignment, the category and deciding rule that returning it to automatic categorization would produce now; null for a rule-assigned category. */
  automatic_assignment: {
    category_id: string | null;
    rule_id: string | null;
  } | null;
  type: TransactionType;
  type_source: "auto" | "manual";
  account_id: string;
  /** Whether the booking belongs to a manual account, which also allows the opening balance and adjustment types. */
  manual_account: boolean;
  /** Whether the booking's account is archived, which keeps the booking read-only. */
  account_archived: boolean;
  /** Whether the linked counterpart's account is archived; changes to this booking would change that counterpart, so only its category stays editable. */
  counterpart_archived: boolean;
  /** Whether the booking was entered in Ufer on a manual account, so its date, amount, payee and description can be edited and the booking deleted. A counterpart created for an imported booking is not. */
  entered: boolean;
  /** Whether an entered booking is linked with an imported booking, whose date and amount it follows. */
  follows_import: boolean;
  /** Whether Ufer created this booking on a manual account as another booking's transfer counterpart; it can keep that link or be removed, not be retargeted. */
  created_counterpart: boolean;
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
  account_id: string;
  account_name: string;
  booking_date: string;
  amount_minor: number;
  currency: string;
  counterparty: string;
  description: string;
  /** Whether Ufer created this booking on a manual account as a transfer's counterpart. */
  created: boolean;
  /** Whether the booking was entered in Ufer on a manual account rather than imported. */
  entered: boolean;
};

/** A booking's transfer link and what it can be linked with instead. */
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

/** Existing payees suggested for a typed payee, best first. */
export type PayeeSuggestions = {
  payees: string[];
};

/** Whether the edit dialog is unavailable: every change of type, link, entry or deletion is refused while either side's account is archived. */
export function editLocked(transaction: Pick<Transaction, "account_archived" | "counterpart_archived">) {
  return transaction.account_archived || transaction.counterpart_archived;
}
