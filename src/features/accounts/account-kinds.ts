// Persisted account type identifiers; renaming one requires a data migration.
/** Kinds whose balance is the sum of their transactions; these can be created, imported into and changed into each other. */
export const accountKinds = ["checking", "savings", "investment", "loan", "property", "credit_card"] as const;

export type AccountKind = (typeof accountKinds)[number];

/** Every stored kind: a brokerage account has no transactions and is valued from its security trades and prices (ADR 012). */
export const storedAccountKinds = [...accountKinds, "brokerage"] as const;

export type StoredAccountKind = (typeof storedAccountKinds)[number];
