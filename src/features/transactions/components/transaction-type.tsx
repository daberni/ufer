import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, CircleEqual, Flag } from "lucide-react";
import { transactionTypeLabels, type TransactionType } from "@/lib/transaction-types";
import type { Transaction } from "@/features/transactions/types";

/** Where a transfer goes to or comes from, including an account not tracked in Ufer. */
export function transferDirection(transaction: Transaction) {
  const towards = transaction.amount_minor < 0 ? "to" : "from";

  return `${towards} ${transaction.counterpart?.account_name ?? "an untracked account"}`;
}

const typeIcons = {
  income: ArrowDownLeft,
  expense: ArrowUpRight,
  transfer: ArrowLeftRight,
  opening_balance: Flag,
  adjustment: CircleEqual
};

/** The transaction's type, independent of its category and the sign of a refund. */
export function TransactionTypeIcon({ type }: {
  type: TransactionType
}) {
  const Icon = typeIcons[type];

  return <Icon size={17} role="img" aria-label={transactionTypeLabels[type]}><title>{transactionTypeLabels[type]}</title></Icon>;
}
