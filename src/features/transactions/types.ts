import type { PeriodJson } from "@/lib/period";
import type { SyncRun } from "@/features/banking/types";
import type { TransactionType } from "@/lib/transaction-types";

/** One part of a split booking, signed like the booking's amount and in its currency. */
export type SplitPart = {
  id: string;
  amount_minor: number;
  category_id: string | null;
  note: string;
};

/** How a booking is divided into category parts; reports count the parts instead of the booking. */
export type TransactionSplit = {
  parts: SplitPart[];
  /** False once the booking's amount changed after splitting, for example through a sync; reports count the difference as uncategorized until the split is corrected. */
  balanced: boolean;
};

export type Transaction = {
  id: string;
  /** The date the booking counts on; for a bank booking its value date. */
  date: string;
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
  /** The parts of a split booking; null for a booking that is not split. */
  split: TransactionSplit | null;
  type: TransactionType;
  type_source: "auto" | "manual";
  /** The rule that set an automatic type; null for a derived or manual type. */
  type_rule_id: string | null;
  account_id: string;
  /** Whether the booking belongs to a manual account, which also allows the opening balance and adjustment types. */
  manual_account: boolean;
  /** Whether the booking's account is archived, which freezes its type, link and entry but not its categories, payee, description or, on a bank account, its visibility. */
  account_archived: boolean;
  /** Whether the linked counterpart's account is archived; changes to this booking's type or link would change that counterpart, so they stay frozen. */
  counterpart_archived: boolean;
  /** Whether the booking was entered in Ufer, so its date, amount, payee and description can be edited and the booking deleted: on a manual account, or a bank-linked account's opening balance or adjustment. A counterpart created for an imported booking is not. */
  entered: boolean;
  /** Whether an entered booking is linked with an imported booking, whose date and amount it follows. */
  follows_import: boolean;
  /** Whether Ufer created this booking on a manual account as another booking's transfer counterpart; it can keep that link or be removed, not be retargeted. */
  created_counterpart: boolean;
  /** The other booking of a linked transfer; null for a transfer to an account not tracked in Ufer and for every other type. */
  counterpart: {
    id: string;
    account_name: string;
    date: string;
    /** Whether the counterpart was entered in Ufer or created by it on a manual account. */
    entered: boolean;
  } | null;
  /** The security trade whose cash side this booking is; the trade is edited or removed from here (ADR 012). */
  trade: BookingTrade | null;
};

export type BookingTrade = {
  id: string;
  side: "buy" | "sell";
  date: string;
  quantity_micros: number;
  price_micros: number;
  gross_minor: number;
  fee_minor: number;
  tax_minor: number;
  security_name: string;
  security_isin: string | null;
  /** The brokerage account holding the trade. */
  account_id: string;
  account_name: string;
  /** Whether the brokerage account is archived, which freezes its trades. */
  account_archived: boolean;
};

/** A booking as shown when linking the two sides of a transfer. */
export type TransferBooking = {
  id: string;
  account_id: string;
  account_name: string;
  date: string;
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

/** Whether the booking's bookkeeping is frozen: every change of type, link, entry or deletion is refused while either side's account is archived; categories and texts stay editable. */
export function bookkeepingFrozen(transaction: Pick<Transaction, "account_archived" | "counterpart_archived">) {
  return transaction.account_archived || transaction.counterpart_archived;
}
