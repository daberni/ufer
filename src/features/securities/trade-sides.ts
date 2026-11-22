// Persisted trade side identifiers; renaming one requires a data migration.
export const tradeSides = ["buy", "sell"] as const;

export type TradeSide = (typeof tradeSides)[number];
