"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./transaction-list.module.css";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { DateValue } from "@/components/ui/date-value";
import { money } from "@/lib/money";
import { TransactionCategory } from "@/features/transactions/components/transaction-category";
import { resultMask } from "@/features/dashboard/components/result-mask";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "busy" | "results" | "perform" | "reportFeedback" | "state" | "visibleTransactions">;

export function TransactionList({
  busy,
  results,
  perform,
  reportFeedback,
  state,
  visibleTransactions
}: Props) {
  if (!state) {
    return null;
  }

  const skeleton = resultMask(results.transactions);

  return (
    <>
      <div className={clsx(styles["table-scroll"], styles["desktop-transactions"])}>
        <table>
          <thead>
            <tr>
              <th>Payee / description</th>
              <th>Category</th>
              <th>Account</th>
              <th>Date</th>
              <th className={styles["align-right"]}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {visibleTransactions?.map(transaction => (
              <tr key={transaction.id}>
                <td className={skeleton}>
                  <div className={styles["transaction-name"]}>
                    <span className={clsx(styles["transaction-icon"], transaction.amount_minor > 0 ? styles["incoming"] : "")}>{transaction.amount_minor > 0 ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span>
                    <div>
                      <strong>{transaction.counterparty || transaction.description || "Transaction"}</strong>
                      <span title={transaction.description}>{transaction.description || "No description"}</span>
                    </div>
                  </div>
                </td>
                <td className={skeleton}>
                  <TransactionCategory
                    busy={busy}
                    perform={perform}
                    reportFeedback={reportFeedback}
                    state={state}
                    transaction={transaction}
                  />
                  {transaction.category_source === "manual" && <span className={styles["manual-dot"]} title="Manually assigned; preserved when syncing and applying rules" />}
                </td>
                <td className={clsx(ui["muted"], skeleton)}>{transaction.account_name}</td>
                <td className={clsx(ui["muted"], styles["nowrap"], skeleton)}><DateValue value={transaction.booking_date} /></td>
                <td className={clsx(styles["amount"], styles["align-right"], transaction.amount_minor > 0 ? ui["positive"] : "", skeleton)}>
                  {transaction.amount_minor > 0 ? "+" : ""}
                  {money(transaction.amount_minor, transaction.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={styles["transaction-cards"]} aria-label="Transactions">
        {visibleTransactions?.map(transaction => (
          <li key={transaction.id}>
            <article className={clsx(styles["transaction-card"], skeleton)}>
              <div className={styles["transaction-card-meta"]}>
                <span>{transaction.account_name}</span>
                <DateValue value={transaction.booking_date} />
              </div>
              <div className={styles["transaction-card-heading"]}>
                <h3>{transaction.counterparty || transaction.description || "Transaction"}</h3>
                <strong className={clsx(styles["amount"], transaction.amount_minor > 0 ? ui["positive"] : "")}>
                  {transaction.amount_minor > 0 ? "+" : ""}
                  {money(transaction.amount_minor, transaction.currency)}
                </strong>
              </div>
              {transaction.description && (
                <details className={styles["transaction-details"]}>
                  <summary>Description</summary>
                  <p>{transaction.description}</p>
                </details>
              )}
              <div className={styles["transaction-card-category"]}>
                <span>Category{transaction.category_source === "manual" && <small>Manually assigned</small>}</span>
                <TransactionCategory
                  busy={busy}
                  perform={perform}
                  reportFeedback={reportFeedback}
                  state={state}
                  transaction={transaction}
                />
              </div>
            </article>
          </li>
        ))}
      </ul>
    </>
  );
}
