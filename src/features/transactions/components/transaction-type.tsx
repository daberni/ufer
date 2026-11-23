import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, CircleEqual, Flag, TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import type { TransactionType } from "@/lib/transaction-types";
import type { Transaction } from "@/features/transactions/types";

/** Where a transfer goes to or comes from, including an account not tracked in Ufer. */
export function TransferDirection({ transaction }: {
  transaction: Transaction
}) {
  const t = useTranslations("transactions.transfer");
  const account = transaction.counterpart?.account_name;
  const outgoing = transaction.amount_minor < 0;

  if (!account) {
    return outgoing ? t("toUntracked") : t("fromUntracked");
  }

  return outgoing ? t("to", {
    account
  }) : t("from", {
    account
  });
}

const typeIcons: Record<TransactionType, typeof Flag> = {
  income: ArrowDownLeft,
  expense: ArrowUpRight,
  transfer: ArrowLeftRight,
  opening_balance: Flag,
  adjustment: CircleEqual,
  buy: TrendingUp,
  sell: TrendingDown
};

/** The transaction's type, independent of its category and the sign of a refund. */
export function TransactionTypeIcon({ type }: {
  type: TransactionType
}) {
  const t = useTranslations("transactions.types");
  const Icon = typeIcons[type];

  return <Icon size={17} role="img" aria-label={t(type)}><title>{t(type)}</title></Icon>;
}
