"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import styles from "./balance-history.module.css";
import { dateWithYear } from "@/lib/date-format";
import { money } from "@/lib/money";
import { plotBalances } from "@/features/accounts/balance-chart";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { areaProps } from "@/components/ui/result-presentation";
import type { Area, AreaResult } from "@/components/ui/use-area-result";
import type { BalanceHistory, BalancePoint } from "@/features/accounts/types";

const sourceLabels: Record<BalancePoint["source"], string> = {
  sync: "Bank sync",
  manual: "Manual",
  csv: "CSV import",
  transactions: "Calculated"
};

// The table starts with the latest balances; the chart already shows the whole history.
const initialRows = 5;

const skeletonRows = 3;

function dateLabel(date: string) {
  return dateWithYear(Temporal.PlainDate.from(date));
}

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
  const chart = plotBalances(balances);
  const first = balances[0];
  const last = balances[balances.length - 1];
  const line = chart.points.map((point, index) => index ? `H${point.x} V${point.y}` : `M${point.x} ${point.y}`).join(" ");
  const area = `${line} L100 100 L0 100 Z`;
  const summary = `Balance from ${dateLabel(first.date)} to ${dateLabel(last.date)}: from ${money(first.amount_minor, currency)} to ${money(last.amount_minor, currency)}, lowest ${money(chart.lowest, currency)}, highest ${money(chart.highest, currency)}.`;

  return (
    <figure className={styles["chart"]}>
      <div className={styles["plot"]} role="img" aria-label={summary}>
        <span className={styles["axis-label"]} data-edge="top" aria-hidden="true">{money(chart.highest, currency)}</span>
        <span className={styles["axis-label"]} data-edge="bottom" aria-hidden="true">{money(chart.lowest, currency)}</span>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <path className={styles["area"]} d={area} />
          <path className={styles["line"]} d={line} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <figcaption className={styles["dates"]} aria-hidden="true">
        <span>{dateLabel(first.date)}</span>
        <span>{dateLabel(last.date)}</span>
      </figcaption>
    </figure>
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
                <time dateTime={balance.date}>{dateLabel(balance.date)}</time>
              </th>
              <td>{sourceLabels[balance.source]}</td>
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

function HistorySkeleton() {
  return (
    <>
      <div className={styles["chart"]}>
        <div className={clsx(styles["plot"], ui["skeleton"])} />
        <div className={styles["dates"]}>
          <span className={ui["skeleton"]}>12 Jan 2025</span>
          <span className={ui["skeleton"]}>12 Nov 2026</span>
        </div>
      </div>
      <div className={styles["table"]}>
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
