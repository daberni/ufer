/** The net-worth composition the overview shows; every net-worth account kind belongs to exactly one. */
export type NetWorthCategory = "liquidity" | "investments" | "property" | "liabilities";

export const netWorthCategories: NetWorthCategory[] = ["liquidity", "investments", "property", "liabilities"];

const categoryKinds: Record<NetWorthCategory, string[]> = {
  liquidity: ["checking", "savings", "credit_card"],
  investments: ["investment"],
  property: ["property"],
  liabilities: ["loan"]
};

/** The category an account kind counts toward, or null for kinds outside net worth. */
export function netWorthCategory(kind: string) {
  return netWorthCategories.find(category => categoryKinds[category].includes(kind)) ?? null;
}
