"use client";

import { useState } from "react";
import { ArrowLeftRight, Pencil } from "lucide-react";
import styles from "./transaction-type.module.css";
import { transactionTypeLabels } from "@/features/transactions/transaction-types";
import { TransactionTypeDialog } from "@/features/transactions/components/transaction-type-dialog";
import type { Transaction } from "@/features/transactions/types";

/** Where a transfer goes to or comes from: the linked booking's account, or an account not tracked in Ufer. */
export function transferDirection(transaction: Transaction) {
  const towards = transaction.amount_minor < 0 ? "to" : "from";

  if (!transaction.counterpart) {
    return `${towards} an untracked account`;
  }

  return `${towards} ${transaction.counterpart.account_name}`;
}

/** A transaction row's type, which opens the dialog that changes the type and the transfer link. */
export function TransactionType({ transaction }: {
  transaction: Transaction
}) {
  const [open, setOpen] = useState(false);
  const label = transactionTypeLabels[transaction.type];
  const transfer = transaction.type === "transfer";
  const detail = transfer ? transferDirection(transaction) : null;
  const subject = transaction.counterparty || transaction.description || "transaction";

  return (
    <>
      <button
        type="button"
        className={styles["type-button"]}
        aria-label={`Type of ${subject}: ${label}${detail ? ` ${detail}` : ""}. Change type`}
        onClick={() => setOpen(true)}
      >
        {transfer && <ArrowLeftRight size={14} aria-hidden="true" />}
        <span className={styles["label"]}>
          {label}
          {detail && <span className={styles["detail"]}>{detail}</span>}
        </span>
        <Pencil className={styles["edit-hint"]} size={13} aria-hidden="true" />
      </button>
      {open && <TransactionTypeDialog transaction={transaction} close={() => setOpen(false)} />}
    </>
  );
}
