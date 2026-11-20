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
