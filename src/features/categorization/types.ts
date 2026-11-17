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
  category_name: string;
  priority: number;
  enabled: number;
  category_color: string;
  category_icon: string | null;
};

/** The transactions a rule would categorize, counted without storing it; manual assignments are never included. */
export type RulePreview = {
  matched: number;
  uncategorized: number;
};

export type RulePreviewDraft = {
  pattern: string;
  priority: number;
};
