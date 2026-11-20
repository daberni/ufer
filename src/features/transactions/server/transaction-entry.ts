/** Optional data a bank provider delivered with a transaction; each field is absent when the bank did not send it or sent it malformed. */
import type { RuleTransactionType } from "@/features/transactions/transaction-types";

export type ProviderDetails = {
  /** Signed like the entry amount, in minor units of instructedCurrency. */
  instructedAmount?: number;
  instructedCurrency?: string;
  /** The provider transaction as JSON text. */
  payload?: string;
};

export type Entry = {
  reference: string;
  date: string;
  amount: number;
  currency: string;
  counterparty: string;
  description: string;
  transfer?: boolean;
  provider?: ProviderDetails;
};

export type CategorizedEntry = Entry & {
  categoryId: string | null;
  /** The rule that decided `categoryId`; null when no rule matched or the category was not assigned by a rule. */
  categoryRuleId: string | null;
  /** The type the deciding rule sets; null leaves the automatic type. */
  ruleType: RuleTransactionType | null;
  /** The rule that sets `ruleType`; null when it is null. */
  typeRuleId: string | null;
};
