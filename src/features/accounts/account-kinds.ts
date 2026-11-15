// Persisted account type identifiers; renaming one requires a data migration.
export const accountKinds = ["checking", "savings", "investment", "loan", "property", "credit_card"] as const;

export type AccountKind = (typeof accountKinds)[number];
