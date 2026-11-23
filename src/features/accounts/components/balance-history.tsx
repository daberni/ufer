"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useState } from "react";
import styles from "./balance-history.module.css";
import { money } from "@/lib/money";
import { describeBankBalanceType, describeBalanceDate } from "@/features/accounts/balance-presentation";
import { BalanceHistoryChart, BalanceHistoryChartSkeleton } from "./balance-history-chart";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { areaProps } from "@/components/ui/result-presentation";
import type { Area, AreaResult } from "@/components/ui/use-area-result";
import type { BalanceHistory, ReportedBalance } from "@/features/accounts/types";
import { useLocale } from "@/client/locale-provider";
import { formatCount } from "@/lib/locale";

// The table starts with the latest balances; the chart already shows the whole history.
const initialRows = 5;

export function BalanceHistoryPanel({ history }: {
  history: Area<BalanceHistory>
}) {
  const locale = useLocale();

  return (
    <section className={clsx(ui["panel"], styles["history"])}>
      <div className={ui["card-heading"]}>
        <h2>Balance history</h2>
        {history.status === "pending" && <span className={clsx(ui["subtle"], styles["range"], ui["skeleton"])} aria-hidden="true">Since 12 Jan 2025</span>}
        {history.status !== "pending" && history.data.balances.length > 0 && <span className={clsx(ui["subtle"], styles["range"])} title={describeBalanceDate(history.data.balances[0].date, locale).title}>Since {describeBalanceDate(history.data.balances[0].date, locale).label}</span>}
      </div>
      {history.status === "pending" ? (
        <AreaPlaceholder area={history} failureTitle="The balance history could not be loaded">
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
    currency,
    reported
  } = history.data;

  if (!balances.length && !reported.length) {
    return <p className={styles["note"]}>No balance has been recorded for this account yet.</p>;
  }

  return (
    <div {...areaProps(history.status)}>
      {balances.length > 1 ? <BalanceHistoryChart balances={balances} currency={currency} interactive={history.status === "ready"} /> : <p className={styles["note"]}>The chart appears once a second balance is recorded.</p>}
      <ReportedBalanceTable reported={reported} currency={currency} />
    </div>
  );
}

function ReportedBalanceTable({
  reported,
  currency
}: {
  reported: ReportedBalance[];
  currency: string;
}) {
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const newestFirst = reported.toReversed();
  const shown = expanded ? newestFirst : newestFirst.slice(0, initialRows);
  const latest = newestFirst[0];
  const currentStart = latest && latest.difference_minor !== 0 ? newestFirst.find(report => report.difference_started) : undefined;

  if (!latest) {
    return null;
  }

  return (
    <>
      {currentStart && (
        <p className={styles["note"]}>
          The current difference first appeared on <time dateTime={currentStart.date}>{describeBalanceDate(currentStart.date, locale).label}</time>.
        </p>
      )}
      <table className={styles["table"]}>
        <caption className={ui["visually-hidden"]}>Reported bank balances and their difference to the calculated balance, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col" className={styles["amount"]}>Reported</th>
            <th scope="col" className={clsx(styles["amount"], styles["calculated"])}>Calculated</th>
            <th scope="col" className={styles["amount"]}>Difference</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(report => (
            <tr key={report.date} className={clsx(report.difference_started && styles["started"])}>
              <th scope="row">
                <time dateTime={report.date} title={describeBalanceDate(report.date, locale).title}>{describeBalanceDate(report.date, locale).label}</time>
                <span className={styles["detail"]}>{report.difference_started ? "Difference starts" : describeBankBalanceType(report.bank_balance_type)}</span>
              </th>
              <td className={styles["amount"]}>{money(report.amount_minor, currency, locale)}</td>
              <td className={clsx(styles["amount"], styles["calculated"])}>{money(report.calculated_minor, currency, locale)}</td>
              <td className={clsx(styles["amount"], report.difference_minor !== 0 && styles["mismatch"])}>{report.difference_minor === 0 ? "None" : money(report.difference_minor, currency, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {reported.length > initialRows && (
        <button className={ui["text-button"]} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show latest balances only" : `Show all ${formatCount(reported.length, locale)} reported balances`}
        </button>
      )}
    </>
  );
}
