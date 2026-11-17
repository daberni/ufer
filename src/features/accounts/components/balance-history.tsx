"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useState } from "react";
import styles from "./balance-history.module.css";
import { money } from "@/lib/money";
import { balanceSourceLabels, describeBalanceDate } from "@/features/accounts/balance-presentation";
import { BalanceHistoryChart, BalanceHistoryChartSkeleton } from "./balance-history-chart";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { areaProps } from "@/components/ui/result-presentation";
import type { Area, AreaResult } from "@/components/ui/use-area-result";
import type { BalanceHistory, BalancePoint } from "@/features/accounts/types";

// The table starts with the latest balances; the chart already shows the whole history.
const initialRows = 5;

export function BalanceHistoryPanel({ history }: {
  history: Area<BalanceHistory>
}) {
  return (
    <section className={clsx(ui["panel"], styles["history"])}>
      <div className={ui["card-heading"]}>
        <h2>Balance history</h2>
        {history.status === "pending" && <span className={clsx(ui["subtle"], styles["range"], ui["skeleton"])} aria-hidden="true">Since 12 Jan 2025</span>}
        {history.status !== "pending" && history.data.balances.length > 0 && <span className={clsx(ui["subtle"], styles["range"])} title={describeBalanceDate(history.data.balances[0].date).title}>Since {describeBalanceDate(history.data.balances[0].date).label}</span>}
      </div>
      {history.status === "pending" ? (
        <AreaPlaceholder area={history} subject="The balance history">
          <BalanceHistoryChartSkeleton />
        </AreaPlaceholder>
      ) : <HistoryContent history={history} />}
    </section>
  );
}

function HistoryContent({ history }: {
  history: AreaResult<BalanceHistory>
}) {
  const {
    balances,
    currency
  } = history.data;

  if (!balances.length) {
    return <p className={styles["note"]}>No balance has been recorded for this account yet.</p>;
  }

  return (
    <div {...areaProps(history.status)}>
      {balances.length > 1 ? <BalanceHistoryChart balances={balances} currency={currency} interactive={history.status === "ready"} /> : <p className={styles["note"]}>The chart appears once a second balance is recorded.</p>}
      <BalanceTable balances={balances.filter(balance => balance.source !== "transactions")} currency={currency} />
    </div>
  );
}

function BalanceTable({
  balances,
  currency
}: {
  balances: BalancePoint[];
  currency: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const newestFirst = balances.toReversed();
  const shown = expanded ? newestFirst : newestFirst.slice(0, initialRows);

  if (!balances.length) {
    return null;
  }

  return (
    <>
      <table className={styles["table"]}>
        <caption className={ui["visually-hidden"]}>Balances, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Source</th>
            <th scope="col" className={styles["amount"]}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(balance => (
            <tr key={balance.date}>
              <th scope="row">
                <time dateTime={balance.date} title={describeBalanceDate(balance.date).title}>{describeBalanceDate(balance.date).label}</time>
              </th>
              <td>{balanceSourceLabels[balance.source]}</td>
              <td className={styles["amount"]}>{money(balance.amount_minor, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {balances.length > initialRows && (
        <button className={ui["text-button"]} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show latest balances only" : `Show all ${balances.length} balances`}
        </button>
      )}
    </>
  );
}
