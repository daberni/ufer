import type { NetWorth } from "@/features/accounts/types";

/** The asset and loan bars' lengths as shares of the longer one, so both use one scale, and the asset bar's segments. */
export function netWorthBars(summary: Pick<NetWorth, "liquidity" | "investments" | "property" | "liabilities">) {
  const segments = {
    cash: Math.max(0, summary.liquidity),
    investments: Math.max(0, summary.investments),
    property: Math.max(0, summary.property)
  };
  const assets = segments.cash + segments.investments + segments.property;
  // Loan balances are negative; a loan account with a credit balance is no debt.
  const loans = Math.max(0, -summary.liabilities);
  const scale = Math.max(assets, loans);

  return {
    segments,
    assets: scale ? assets / scale : 0,
    loans: scale ? loans / scale : 0
  };
}
