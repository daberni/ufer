import { ValidationError } from "@/lib/errors";
import { positionOn, sentCost, type PositionSplit, type PositionTrade } from "./holdings";

/** A trade or transfer leg of one security on one brokerage account; both legs of a transfer share its id. */
export type SecurityLeg = PositionTrade & {
  account_id: string;
  transfer_id: string | null;
};

/**
 * Sets each transfer leg's `gross_minor` to the cost basis the transfer carries: the sending account's moving-average cost of the moved quantity just before it is sent.
 * The sending account may itself have received earlier transfers, so their costs resolve first. Legs of one security on every account are expected; nothing else changes.
 */
export function resolveTransferCosts<Leg extends SecurityLeg>(legs: Leg[], splits: PositionSplit[]): Leg[] {
  const byAccount = new Map<string, Leg[]>();
  const sentLegs = new Map<string, Leg>();
  const costs = new Map<string, number>();
  const resolving = new Set<string>();

  for (const leg of legs) {
    byAccount.set(leg.account_id, [...byAccount.get(leg.account_id) ?? [], leg]);

    if (leg.side === "transfer_out" && leg.transfer_id) {
      sentLegs.set(leg.transfer_id, leg);
    }
  }

  function costOf(transferId: string): number {
    const known = costs.get(transferId);

    if (known !== undefined) {
      return known;
    }

    const sent = sentLegs.get(transferId);

    if (!sent) {
      throw new Error(`Transfer ${transferId} has no sending leg.`);
    }

    // Same-day transfers back and forth can each precede the other's sending leg; no order resolves them.
    if (resolving.has(transferId)) {
      throw new ValidationError(`Transfers on ${sent.date} depend on each other. Record them on different days.`);
    }

    resolving.add(transferId);

    const accountLegs = byAccount.get(sent.account_id) ?? [];
    const withCosts = accountLegs.filter(leg => leg === sent || leg.date < sent.date || (leg.date === sent.date && leg.sequence < sent.sequence)).map(leg => leg.side === "transfer_in" && leg.transfer_id ? {
      ...leg,
      gross_minor: costOf(leg.transfer_id)
    } : leg);
    const cost = sentCost(withCosts, splits, withCosts.find(leg => leg.transfer_id === transferId && leg.side === "transfer_out")!);

    resolving.delete(transferId);
    costs.set(transferId, cost);

    return cost;
  }

  return legs.map(leg => leg.transfer_id ? {
    ...leg,
    gross_minor: costOf(leg.transfer_id)
  } : leg);
}

/** Resolves transfer costs and replays every account's legs to the end, so no sale or transfer exceeds what an account held at that point. */
export function checkSecurityHistory<Leg extends SecurityLeg>(legs: Leg[], splits: PositionSplit[]) {
  const resolved = resolveTransferCosts(legs, splits);

  for (const accountId of new Set(resolved.map(leg => leg.account_id))) {
    positionOn(resolved.filter(leg => leg.account_id === accountId), splits, "9999-12-31");
  }

  return resolved;
}
