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
  other: "Other",
  coffee: "Coffee & cafés",
  bar: "Bars & alcohol",
  fuel: "Fuel",
  transit: "Public transport",
  insurance: "Insurance",
  phone: "Phone & internet",
  subscriptions: "Subscriptions & streaming",
  furniture: "Furniture & home",
  clothing: "Clothing",
  pharmacy: "Pharmacy",
  fitness: "Sport & fitness",
  hobbies: "Hobbies",
  pets: "Pets",
  childcare: "Kids & childcare",
  charity: "Charity & donations",
  salary: "Salary & work",
  investments: "Investments",
  cash: "Cash",
  loan: "Loans & debt"
} as const;

export type CategoryIconKey = keyof typeof categoryIconLabels;

export const categoryIconKeys = Object.keys(categoryIconLabels) as CategoryIconKey[];

export function isCategoryIcon(value: unknown): value is CategoryIconKey {
  return typeof value === "string" && Object.hasOwn(categoryIconLabels, value);
}
