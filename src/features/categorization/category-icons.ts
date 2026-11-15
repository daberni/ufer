// Persisted keys are a stable contract: rename or remove a key only through a data migration.
export const categoryIconLabels = {
  groceries: "Groceries",
  dining: "Dining",
  transport: "Transport",
  housing: "Housing",
  utilities: "Utilities",
  health: "Health",
  shopping: "Shopping",
  entertainment: "Entertainment",
  travel: "Travel",
  education: "Education",
  gifts: "Gifts",
  fees: "Fees & taxes",
  income: "Income",
  savings: "Savings",
  transfer: "Transfer",
  other: "Other"
} as const;

export type CategoryIconKey = keyof typeof categoryIconLabels;

export const categoryIconKeys = Object.keys(categoryIconLabels) as CategoryIconKey[];

export function isCategoryIcon(value: unknown): value is CategoryIconKey {
  return typeof value === "string" && Object.hasOwn(categoryIconLabels, value);
}
