/** Optional data a bank provider delivered with a transaction; each field is absent when the bank did not send it or sent it malformed. */
import type { EntryRuleAssignment } from "@/features/categorization/server/rule-assignment";

export type ProviderDetails = {
  /** Signed like the entry amount, in minor units of instructedCurrency. */
  instructedAmount?: number;
  instructedCurrency?: string;
  /** The provider transaction as JSON text. */
  payload?: string;
};

export type Entry = {
  reference: string;
  /** The date the booking counts on; for a bank booking its value date. */
  date: string;
  /** The bank's own booking date, kept for reconciliation with reported balances and duplicate matching; absent for other sources. */
  bookingDate?: string | null;
  amount: number;
  currency: string;
  counterparty: string;
  description: string;
  transfer?: boolean;
  provider?: ProviderDetails;
};

export type CategorizedEntry = Entry & EntryRuleAssignment;
