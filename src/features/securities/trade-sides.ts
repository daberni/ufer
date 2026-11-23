// Persisted trade side identifiers; renaming one requires a data migration.
export const tradeSides = ["buy", "sell"] as const;

export type TradeSide = (typeof tradeSides)[number];

/** A step in a holding's replay: a trade, or one leg of a transfer between brokerage accounts. Transfer legs are not stored as trade sides. */
export type LegSide = TradeSide | "transfer_in" | "transfer_out";
