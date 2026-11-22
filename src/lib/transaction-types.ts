/** What a booking is, independent of its category. Only income and expenses count toward cash flow, spending and trends; buy and sell are the cash legs of security trades (ADR 012). */
export const transactionTypes = ["income", "expense", "transfer", "opening_balance", "adjustment", "buy", "sell"] as const;

export type TransactionType = typeof transactionTypes[number];

export const transactionTypeLabels: Record<TransactionType, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
  opening_balance: "Opening balance",
  adjustment: "Adjustment",
  buy: "Buy",
  sell: "Sell"
};

/** Types only a security trade sets on its cash leg; a person never chooses them for a booking. */
export const tradeTransactionTypes: readonly TransactionType[] = ["buy", "sell"];

/** Types a person can enter or correct a booking to. */
export const entryTransactionTypes = ["income", "expense", "transfer", "opening_balance", "adjustment"] as const satisfies readonly TransactionType[];

/** Types that only describe how a manual account's balance came about; bank-synced bookings never have them. */
export const manualAccountTypes: readonly TransactionType[] = ["opening_balance", "adjustment"];

/** Types a categorization rule can set; the others describe manual account balances. */
export const ruleTransactionTypes = ["income", "expense", "transfer"] as const;

export type RuleTransactionType = typeof ruleTransactionTypes[number];

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
