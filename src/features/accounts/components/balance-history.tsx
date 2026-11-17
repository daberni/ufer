"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useState } from "react";
import styles from "./balance-history.module.css";
import chartStyles from "./history-chart.module.css";
import { money } from "@/lib/money";
import { HistoryChart, HistoryChartSkeleton, historyDateLabel as dateLabel } from "@/features/accounts/components/history-chart";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { areaProps } from "@/components/ui/result-presentation";
import type { Area, AreaResult } from "@/components/ui/use-area-result";
import type { BalanceHistory, BalancePoint } from "@/features/accounts/types";

const sourceLabels: Record<BalancePoint["source"], string> = {
  sync: "Bank sync",
  manual: "Manual",
  csv: "CSV import"
};

// The table starts with the latest balances; the chart already shows the whole history.
const initialRows = 5;

const skeletonRows = 3;

export function BalanceHistoryPanel({ history }: {
  history: Area<BalanceHistory>
}) {
  return (
    <section className={clsx(ui["panel"], styles["history"])}>
      <div className={ui["card-heading"]}>
        <h2>Balance history</h2>
        {history.status !== "pending" && history.data.balances.length > 0 && <span className={ui["subtle"]}>Since {dateLabel(history.data.balances[0].date)}</span>}
      </div>
      {history.status === "pending" ? (
        <AreaPlaceholder area={history} subject="The balance history">
          <HistorySkeleton />
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
      {balances.length > 1 ? <BalanceChart balances={balances} currency={currency} /> : <p className={styles["note"]}>The chart appears once a second balance is recorded.</p>}
      <BalanceTable balances={balances} currency={currency} />
    </div>
  );
}

function BalanceChart({
  balances,
  currency
}: {
  balances: BalancePoint[];
  currency: string;
}) {
  const first = balances[0];
  const last = balances[balances.length - 1];
  const amounts = balances.map(balance => balance.amount_minor);
  const summary = `Balance from ${dateLabel(first.date)} to ${dateLabel(last.date)}: from ${money(first.amount_minor, currency)} to ${money(last.amount_minor, currency)}, lowest ${money(Math.min(...amounts), currency)}, highest ${money(Math.max(...amounts), currency)}.`;

  return (
    <HistoryChart
      currency={currency}
      series={[{
        label: "Balance",
        tone: "balance",
        points: balances
      }]}
      summary={summary}
    />
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

  return (
    <>
      <table className={chartStyles["table"]}>
        <caption className={ui["visually-hidden"]}>Recorded balances, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Source</th>
            <th scope="col" className={chartStyles["amount"]}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(balance => (
            <tr key={balance.date}>
              <th scope="row">
                <time dateTime={balance.date}>{dateLabel(balance.date)}</time>
              </th>
              <td className={styles["source"]}>{sourceLabels[balance.source]}</td>
              <td className={chartStyles["amount"]}>{money(balance.amount_minor, currency)}</td>
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

function HistorySkeleton() {
  return (
    <>
      <HistoryChartSkeleton />
      <div className={chartStyles["table"]}>
        {Array.from({
          length: skeletonRows
        }, (_, index) => (
          <p className={styles["skeleton-row"]} key={index}>
            <span className={ui["skeleton"]}>12 Nov 2026</span>
            <span className={ui["skeleton"]}>€0,000.00</span>
          </p>
        ))}
      </div>
    </>
  );
}
