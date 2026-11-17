"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import styles from "./net-worth-history.module.css";
import chartStyles from "./history-chart.module.css";
import { describeMonth, monthRangeLabel, periodLabel } from "@/lib/date-format";
import { periodFromJson } from "@/lib/period";
import { money } from "@/lib/money";
import { today } from "@/lib/time";
import { HistoryChart, HistoryChartSkeleton, type ChartSeries, type SeriesTone } from "@/features/accounts/components/history-chart";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { areaProps } from "@/components/ui/result-presentation";
import type { WealthGroup } from "@/features/accounts/account-kinds";
import type { Area, AreaResult } from "@/components/ui/use-area-result";
import type { NetWorthHistory, NetWorthPoint } from "@/features/accounts/types";

const groups: {
  key: WealthGroup;
  label: string;
  tone: SeriesTone;
}[] = [{
  key: "liquidity",
  label: "Cash",
  tone: "liquid"
}, {
  key: "investments",
  label: "Investments",
  tone: "invested"
}, {
  key: "property",
  label: "Property",
  tone: "property"
}, {
  key: "liabilities",
  label: "Loans",
  tone: "debt"
}];

// The overview starts with the latest months; the chart already shows the whole range.
const initialRows = 3;

function monthTitle(point: NetWorthPoint) {
  return describeMonth(Temporal.PlainYearMonth.from(point.month)).title;
}

/** Where a month's figure comes from, such as "2 synced, 1 manual · 1 carried forward". */
function describeBasis(point: NetWorthPoint) {
  const sources = [
    [point.synced, "synced"],
    [point.manual, "manual"],
    [point.imported, "imported"]
  ] as const;
  const counted = sources.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`).join(", ");
  const gaps = [
    point.carried > 0 ? `${point.carried} carried forward` : "",
    point.unvalued > 0 ? `${point.unvalued} without a balance` : ""
  ].filter(Boolean);

  return [counted, ...gaps].join(" · ");
}

function rangeLabel(history: NetWorthHistory) {
  const period = periodFromJson(history.period);

  if (period.kind === "all" || !history.points.length) {
    return periodLabel(period);
  }

  return monthRangeLabel(history.points.map(point => Temporal.PlainYearMonth.from(point.month)));
}

export function NetWorthHistoryPanel({ history }: {
  history: Area<NetWorthHistory>
}) {
  return (
    <section className={clsx(ui["panel"], styles["history"])}>
      <div className={ui["card-heading"]}>
        <h2>Net worth over time</h2>
        {history.status !== "pending" && <span className={ui["subtle"]}>{rangeLabel(history.data)}</span>}
      </div>
      {history.status === "pending" ? (
        <AreaPlaceholder area={history} subject="The net worth history">
          <HistoryChartSkeleton />
        </AreaPlaceholder>
      ) : <HistoryContent history={history} />}
    </section>
  );
}

function HistoryContent({ history }: {
  history: AreaResult<NetWorthHistory>
}) {
  const {
    points,
    currency
  } = history.data;

  if (!points.length) {
    return <p className={styles["note"]}>No balance in {currency} has been recorded for this period yet.</p>;
  }

  const shownGroups = groups.filter(group => points.some(point => point[group.key] !== 0));
  const carried = points.filter(point => point.carried > 0).length;

  return (
    <div {...areaProps(history.status, styles["content"])}>
      {points.length > 1 ? (
        <>
          <NetWorthChart
            points={points}
            currency={currency}
            shownGroups={shownGroups}
            carried={carried}
          />
          {carried > 0 && <p className={styles["note"]}>A hollow point includes balances carried forward from an earlier month.</p>}
        </>
      ) : <p className={styles["note"]}>The chart appears once a second month has a balance.</p>}
      <NetWorthTable points={points} currency={currency} shownGroups={shownGroups} />
    </div>
  );
}

type ChartProps = {
  points: NetWorthPoint[];
  currency: string;
  shownGroups: typeof groups;
};

function NetWorthChart({
  points,
  currency,
  shownGroups,
  carried
}: ChartProps & {
  carried: number;
}) {
  const first = points[0];
  const last = points[points.length - 1];
  const values = points.map(point => point.netWorth);
  const carriedSentence = carried > 0 ? ` ${carried} of ${points.length} months include balances carried forward from an earlier month.` : "";
  const summary = `Net worth from ${monthTitle(first)} to ${monthTitle(last)}: from ${money(first.netWorth, currency)} to ${money(last.netWorth, currency)}, lowest ${money(Math.min(...values), currency)}, highest ${money(Math.max(...values), currency)}.${carriedSentence}`;
  const netWorth: ChartSeries = {
    label: "Net worth",
    tone: "net-worth",
    points: points.map(point => ({
      date: point.date,
      amount_minor: point.netWorth
    }))
  };
  // A single group would repeat the net worth line.
  const parts: ChartSeries[] = shownGroups.length > 1 ? shownGroups.map(group => ({
    label: group.label,
    tone: group.tone,
    points: points.map(point => ({
      date: point.date,
      amount_minor: point[group.key]
    }))
  })) : [];

  return (
    <HistoryChart
      currency={currency}
      interpolation="linear"
      markers={points.map(point => point.carried > 0 ? "carried" : "observed")}
      series={[netWorth, ...parts]}
      summary={summary}
    />
  );
}

function NetWorthTable({
  points,
  currency,
  shownGroups
}: ChartProps) {
  const [expanded, setExpanded] = useState(false);
  const newestFirst = points.toReversed();
  const shown = expanded ? newestFirst : newestFirst.slice(0, initialRows);
  const caption = newestFirst[0].date === today().toString() ? "Net worth at the end of each month, newest first; the current month shows today's balances" : "Net worth at the end of each month, newest first";

  return (
    <>
      <div
        className={styles["table-scroll"]}
        role="region"
        aria-label="Net worth by month"
        tabIndex={0}
      >
        <table className={clsx(chartStyles["table"], styles["table"])}>
          <caption className={ui["visually-hidden"]}>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col" className={chartStyles["amount"]}>Net worth</th>
              {shownGroups.map(group => <th scope="col" className={chartStyles["amount"]} key={group.key}>{group.label}</th>)}
              <th scope="col">Balances</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(point => (
              <tr key={point.month}>
                <th scope="row" className={styles["month"]}>
                  <time dateTime={point.date}>{monthTitle(point)}</time>
                </th>
                <td className={clsx(chartStyles["amount"], styles["total"])}>{money(point.netWorth, currency)}</td>
                {shownGroups.map(group => <td className={chartStyles["amount"]} key={group.key}>{money(point[group.key], currency)}</td>)}
                <td className={styles["basis"]}>{describeBasis(point)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {points.length > initialRows && (
        <button className={ui["text-button"]} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show latest months only" : `Show all ${points.length} months`}
        </button>
      )}
    </>
  );
}
