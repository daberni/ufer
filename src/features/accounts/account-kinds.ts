// Persisted account type identifiers; renaming one requires a data migration.
export const accountKinds = ["checking", "savings", "investment", "loan", "property", "credit_card"] as const;

export type AccountKind = (typeof accountKinds)[number];

/** The part of net worth an account kind counts toward; credit cards reduce cash. */
export type WealthGroup = "liquidity" | "investments" | "property" | "liabilities";

export const wealthGroups: Record<AccountKind, WealthGroup> = {
  checking: "liquidity",
  savings: "liquidity",
  credit_card: "liquidity",
  investment: "investments",
  property: "property",
  loan: "liabilities"
};
