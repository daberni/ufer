"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./transaction-list.module.css";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { DateValue } from "@/components/ui/date-value";
import { money } from "@/lib/money";
import { TransactionCategory, TransactionCategorySkeleton } from "@/features/transactions/components/transaction-category";
import type { Category } from "@/features/categorization/types";
import type { Transaction } from "@/features/transactions/types";

type Props = {
  categories: Category[];
  transactions: Transaction[];
};

// Phones show each table row as a card; the explicit roles keep the table semantics that WebKit drops from table elements whose display changes.
function TableHeader() {
  return (
    <thead role="rowgroup" className={styles["header"]}>
      <tr role="row">
        <th role="columnheader" scope="col">Payee / description</th>
        <th role="columnheader" scope="col">Category</th>
        <th role="columnheader" scope="col">Account</th>
        <th role="columnheader" scope="col">Date</th>
        <th role="columnheader" scope="col" className={styles["amount-heading"]}>Amount</th>
      </tr>
    </thead>
  );
}

/** The original amount of a foreign-currency booking; the direction is already shown by the booked amount. */
function originalAmount(transaction: Transaction) {
  const instructed = transaction.instructed_amount_minor;
  const currency = transaction.instructed_currency;

  if (instructed === null || !currency || currency === transaction.currency) {
    return null;
  }

  return `${money(Math.abs(instructed), currency)} original`;
}

function TransactionRow({
  categories,
  transaction
}: {
  categories: Category[];
  transaction: Transaction;
}) {
  const incoming = transaction.amount_minor > 0;
  const original = originalAmount(transaction);

  return (
    <tr role="row" className={styles["row"]}>
      <th role="rowheader" scope="row" className={styles["payee"]}>
        <div className={styles["transaction-name"]}>
          <span className={clsx(styles["transaction-icon"], incoming && styles["incoming"])}>{incoming ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span>
          <strong className={styles["name"]}>{transaction.counterparty || transaction.description || "Transaction"}</strong>
          <span className={styles["description"]} title={transaction.description}>{transaction.description || "No description"}</span>
          {transaction.description && (
            <details className={styles["transaction-details"]}>
              <summary>Description</summary>
              <p>{transaction.description}</p>
            </details>
          )}
        </div>
      </th>
      <td role="cell" className={styles["category"]}>
        <span className={styles["category-label"]} aria-hidden="true">Category</span>
        <TransactionCategory categories={categories} transaction={transaction} />
      </td>
      <td role="cell" className={styles["account"]}>{transaction.account_name}</td>
      <td role="cell" className={styles["date"]}>
        <DateValue value={transaction.booking_date} />
      </td>
      <td role="cell" className={clsx(styles["amount"], incoming && ui["positive"])}>
        {incoming ? "+" : ""}
        {money(transaction.amount_minor, transaction.currency)}
        {original && <span className={styles["original-amount"]}>{original}</span>}
      </td>
    </tr>
  );
}

export function TransactionList({
  categories,
  transactions
}: Props) {
  return (
    <div className={styles["table-scroll"]}>
      <table role="table" className={styles["table"]} aria-label="Transactions">
        <TableHeader />
        <tbody role="rowgroup">
          {transactions.map(transaction => <TransactionRow key={transaction.id} categories={categories} transaction={transaction} />)}
        </tbody>
      </table>
    </div>
  );
}

// Payees and descriptions of different lengths give the skeleton rows a natural outline; the long ones reach the column's maximum width, as typical descriptions do.
const skeletonPayees = ["Grocery market", "Monthly rent payment", "Coffee shop", "Salary", "Public transport pass"];
const skeletonDescriptions = ["Debit card purchase", "Standing order, reference 2025-01 rent", "Card payment", "Monthly salary payment from employer", "Direct debit"];

/** The list's rows with placeholder content, for a list whose first results are loading. */
export function TransactionListSkeleton({ rows }: {
  rows: number
}) {
  const placeholders = Array.from({
    length: rows
  }, (_, index) => ({
    payee: skeletonPayees[index % skeletonPayees.length],
    description: skeletonDescriptions[index % skeletonDescriptions.length]
  }));

  return (
    <div className={styles["table-scroll"]}>
      <table className={styles["table"]}>
        <TableHeader />
        <tbody>
          {placeholders.map((placeholder, index) => (
            <tr key={index} className={styles["row"]}>
              <th scope="row" className={styles["payee"]}>
                <div className={styles["transaction-name"]}>
                  <span className={clsx(styles["transaction-icon"], ui["skeleton"])} />
                  <strong className={styles["name"]}>
                    <span className={ui["skeleton"]}>{placeholder.payee}</span>
                  </strong>
                  <span className={styles["description"]}>
                    <span className={ui["skeleton"]}>{placeholder.description}</span>
                  </span>
                  <details className={styles["transaction-details"]}>
                    <summary>
                      <span className={ui["skeleton"]}>Description</span>
                    </summary>
                  </details>
                </div>
              </th>
              <td className={styles["category"]}>
                <span className={styles["category-label"]}>Category</span>
                <TransactionCategorySkeleton />
              </td>
              <td className={styles["account"]}>
                <span className={ui["skeleton"]}>Everyday account</span>
              </td>
              <td className={styles["date"]}>
                <span className={ui["skeleton"]}>16 Nov</span>
              </td>
              <td className={styles["amount"]}>
                <span className={ui["skeleton"]}>€000.00</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
