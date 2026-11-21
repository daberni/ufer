import type { RuleTransactionType } from "@/lib/transaction-types";

export type Category = {
  id: string;
  name: string;
  color: string;
  icon: string | null;
};

export type Rule = {
  id: string;
  name: string;
  pattern: string;
  mode: string;
  category_id: string;
  category_name: string;
  priority: number;
  enabled: number;
  category_color: string;
  category_icon: string | null;
  /** The type the rule sets; null leaves the automatic type. */
  transaction_type: RuleTransactionType | null;
  /** For a transfer, the own account on the other side. */
  transfer_account_id: string | null;
  transfer_account_name: string | null;
};

/** The transactions a rule would categorize, counted without storing it; manual assignments are counted separately, since they only follow a rule when chosen. */
export type RulePreview = {
  /** The exact rule ID used to count ties in the matching order; submit it when creating this previewed rule. */
  id: string;
  /** False for an edit of a disabled rule, which decides nothing until it is enabled. */
  enabled: boolean;
  matched: number;
  uncategorized: number;
  /** Manually categorized transactions the rule decides, other than the one a rule is created from. */
  manual: number;
  /** Those of them that already have the previewed category. */
  manual_same_category: number;
  /** The newest of the matched and manual transactions, at most 50; the counts cover all of them. */
  transactions: RulePreviewTransaction[];
};

export type RulePreviewTransaction = {
  id: string;
  booking_date: string;
  amount_minor: number;
  currency: string;
  payee: string;
  description: string;
  category_id: string | null;
  /** A manual assignment, which only follows the rule when a person chooses to adopt it. */
  manual: boolean;
};

export type RulePreviewDraft = {
  pattern: string;
  mode: "keyword" | "regex";
  /** The stored rule an edit replaces; null previews a new rule. */
  ruleId: string | null;
  /** The chosen category, compared with the categories of matching manual assignments; null while none is chosen. */
  categoryId: string | null;
  /** The manual assignment a rule is created from, which is not counted among the other manual assignments. */
  sourceTransactionId?: string;
};

/** What references a category, counted before it is deleted. */
export type CategoryUsage = {
  transactions: number;
  manual_transactions: number;
  rules: number;
};
