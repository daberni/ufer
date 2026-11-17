/** What a booking is, independent of its category. Only income and expenses count toward cash flow, spending and trends. */
export const transactionTypes = ["income", "expense", "transfer", "opening_balance", "adjustment"] as const;

export type TransactionType = typeof transactionTypes[number];

export const transactionTypeLabels: Record<TransactionType, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
  opening_balance: "Opening balance",
  adjustment: "Adjustment"
};

/** Types that only describe how a manual account's balance came about; bank-synced bookings never have them. */
export const manualAccountTypes: readonly TransactionType[] = ["opening_balance", "adjustment"];

export function isTransactionType(value: string): value is TransactionType {
  return (transactionTypes as readonly string[]).includes(value);
}

/** The type a booking gets until someone corrects it: a detected transfer between own accounts, otherwise income or expense by direction. A refund therefore starts as income and can be corrected to an expense. */
export function derivedTransactionType(amount: number, transfer = false): TransactionType {
  if (transfer) {
    return "transfer";
  }

  return amount > 0 ? "income" : "expense";
}
