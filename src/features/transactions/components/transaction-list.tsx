"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./transaction-list.module.css";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { DateValue } from "@/components/ui/date-value";
import { money } from "@/lib/money";
import { TransactionCategory } from "@/features/transactions/components/transaction-category";
import type { Category, Transaction } from "@/features/dashboard/types";

type Props = {
  categories: Category[];
  transactions: Transaction[];
};

function TableHeader() {
  return (
    <thead>
      <tr>
        <th>Payee / description</th>
        <th>Category</th>
        <th>Account</th>
        <th>Date</th>
        <th className={styles["align-right"]}>Amount</th>
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

function OriginalAmount({ transaction }: {
  transaction: Transaction
}) {
  const original = originalAmount(transaction);

  if (!original) {
    return null;
  }

  return <span className={styles["original-amount"]}>{original}</span>;
}

export function TransactionList({
  categories,
  transactions
}: Props) {
  return (
    <>
      <div className={clsx(styles["table-scroll"], styles["desktop-transactions"])}>
        <table>
          <TableHeader />
          <tbody>
            {transactions.map(transaction => (
              <tr key={transaction.id}>
                <td>
                  <div className={styles["transaction-name"]}>
                    <span className={clsx(styles["transaction-icon"], transaction.amount_minor > 0 ? styles["incoming"] : "")}>{transaction.amount_minor > 0 ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span>
                    <div>
                      <strong>{transaction.counterparty || transaction.description || "Transaction"}</strong>
                      <span title={transaction.description}>{transaction.description || "No description"}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <TransactionCategory categories={categories} transaction={transaction} />
                </td>
                <td className={ui["muted"]}>{transaction.account_name}</td>
                <td className={clsx(ui["muted"], styles["nowrap"])}><DateValue value={transaction.booking_date} /></td>
                <td className={clsx(styles["amount"], styles["align-right"], transaction.amount_minor > 0 ? ui["positive"] : "")}>
                  {transaction.amount_minor > 0 ? "+" : ""}
                  {money(transaction.amount_minor, transaction.currency)}
                  <OriginalAmount transaction={transaction} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={styles["transaction-cards"]} aria-label="Transactions">
        {transactions.map(transaction => (
          <li key={transaction.id}>
            <article className={styles["transaction-card"]}>
              <div className={styles["transaction-card-meta"]}>
                <span>{transaction.account_name}</span>
                <DateValue value={transaction.booking_date} />
              </div>
              <div className={styles["transaction-card-heading"]}>
                <h3>{transaction.counterparty || transaction.description || "Transaction"}</h3>
                <strong className={clsx(styles["amount"], transaction.amount_minor > 0 ? ui["positive"] : "")}>
                  {transaction.amount_minor > 0 ? "+" : ""}
                  {money(transaction.amount_minor, transaction.currency)}
                  <OriginalAmount transaction={transaction} />
                </strong>
              </div>
              {transaction.description && (
                <details className={styles["transaction-details"]}>
                  <summary>Description</summary>
                  <p>{transaction.description}</p>
                </details>
              )}
              <div className={styles["transaction-card-category"]}>
                <span>Category</span>
                <TransactionCategory categories={categories} transaction={transaction} />
              </div>
            </article>
          </li>
        ))}
      </ul>
    </>
  );
}

// Payees and descriptions of different lengths give the skeleton rows a natural outline; the long ones reach the column's maximum width, as typical descriptions do.
const skeletonPayees = ["Grocery market", "Monthly rent payment", "Coffee shop", "Salary", "Public transport pass"];
const skeletonDescriptions = ["Debit card purchase", "Standing order, reference 2025-01 rent", "Card payment", "Monthly salary payment from employer", "Direct debit"];

/** The list's table and cards with placeholder rows, for a list whose first results are loading. */
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
    <>
      <div className={clsx(styles["table-scroll"], styles["desktop-transactions"])}>
        <table>
          <TableHeader />
          <tbody>
            {placeholders.map((placeholder, index) => (
              <tr key={index}>
                <td>
                  <div className={styles["transaction-name"]}>
                    <span className={clsx(styles["transaction-icon"], ui["skeleton"])} />
                    <div>
                      <strong>
                        <span className={ui["skeleton"]}>{placeholder.payee}</span>
                      </strong>
                      <span>
                        <span className={ui["skeleton"]}>{placeholder.description}</span>
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={ui["skeleton"]}>Category name with menu</span>
                </td>
                <td>
                  <span className={ui["skeleton"]}>Everyday account</span>
                </td>
                <td>
                  <span className={ui["skeleton"]}>16 Nov</span>
                </td>
                <td className={clsx(styles["amount"], styles["align-right"])}>
                  <span className={ui["skeleton"]}>€000.00</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={styles["transaction-cards"]}>
        {placeholders.map((placeholder, index) => (
          <li key={index}>
            <div className={styles["transaction-card"]}>
              <div className={styles["transaction-card-meta"]}>
                <span className={ui["skeleton"]}>Everyday account</span>
                <span className={ui["skeleton"]}>16 Nov</span>
              </div>
              <div className={styles["transaction-card-heading"]}>
                <h3>
                  <span className={ui["skeleton"]}>{placeholder.payee}</span>
                </h3>
                <strong className={styles["amount"]}>
                  <span className={ui["skeleton"]}>€000.00</span>
                </strong>
              </div>
              <details className={styles["transaction-details"]}>
                <summary>
                  <span className={ui["skeleton"]}>Description</span>
                </summary>
              </details>
              <div className={styles["transaction-card-category"]}>
                <span>Category</span>
                <span className={ui["skeleton"]}>Category name</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
