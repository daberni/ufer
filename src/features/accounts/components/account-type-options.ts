import type { StoredAccountKind } from "../account-kinds";

// Titles, descriptions, placeholders and hints are in the accounts catalog under typeGroups and types.
export type AccountTypeGroup = {
  id: "bankAccounts" | "investments" | "debts";
  kinds: StoredAccountKind[];
};

export const accountTypeGroups: AccountTypeGroup[] = [{
  id: "bankAccounts",
  kinds: ["checking", "savings"]
}, {
  id: "investments",
  kinds: ["investment", "brokerage", "property"]
}, {
  id: "debts",
  kinds: ["credit_card", "loan"]
}];

/** Debts are entered as negative balances, which the placeholder shows. */
export function balancePlaceholder(kind: StoredAccountKind) {
  return kind === "credit_card" || kind === "loan" ? "-0.00" : "0.00";
}
