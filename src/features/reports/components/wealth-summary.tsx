"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./wealth-summary.module.css";
import { Wallet } from "lucide-react";
import { money } from "@/lib/money";
import { valueMask, withPlaceholder } from "@/components/ui/result-presentation";
import { FailureCover } from "@/components/ui/area-placeholder";
import { useCurrency } from "@/client/use-app-url";
import type { Area } from "@/components/ui/use-area-result";
import type { NetWorth } from "@/features/accounts/types";
import { Temporal } from "temporal-polyfill";
import { netWorthBars } from "@/features/reports/net-worth-bars";
import { describeMonth } from "@/lib/date-format";
import type { NetWorthHistory, NetWorthPoint } from "@/features/reports/net-worth-series";

type Props = {
  /** Whether any account uses the display currency; assumed while the accounts load, so the masked figure keeps its place. */
  hasAccounts: boolean;
  netWorthArea: Area<NetWorth>;
  historyArea: Area<NetWorthHistory>;
};

/** Net worth and its composition; the period's income, expenses, net and savings rate belong to the cash-flow panels below. */
export function WealthSummary({
  hasAccounts,
  netWorthArea,
  historyArea
}: Props) {
  const selectedCurrency = useCurrency();
  const netWorth = withPlaceholder(netWorthArea, () => ({
    currency: selectedCurrency,
    netWorth: 0,
    liquidity: 0,
    investments: 0,
    property: 0,
    liabilities: 0,
    unvalued: 0
  }));
  const summary = netWorth.data;
  const netWorthValue = valueMask(netWorth.status);
  const currency = summary.currency;
  const bars = netWorthBars(summary);
  const historyReady = historyArea.status === "ready" && historyArea.data.currency === currency;
  const points = historyReady ? historyArea.data.points : [];
  const historyPending = !historyReady || netWorth.status !== "ready";
  const change = netWorth.status === "ready" && hasAccounts ? historyChange(points) : null;

  return (
    <section className={styles["wealth-card"]} aria-busy={netWorth.status === "loading"}>
      <div className={styles["wealth-card-top"]}>
        <span>
          <span className={styles["wealth-mark"]}>
            <Wallet size={17} />
          </span>
          Net worth
        </span>
        <span className={clsx(styles["small-tag"], netWorthValue)}>{currency}</span>
      </div>
      <div className={styles["headline"]}>
        <div className={clsx(styles["wealth-number"], netWorthValue)}>{hasAccounts ? money(summary.netWorth, currency) : "—"}</div>
        {change && <span className={styles["change"]}>{change.amount > 0 ? "+" : ""}{money(change.amount, currency)} since {change.since}</span>}
        {/* Holds the change's place, which wraps below the figure on a phone, until the history arrives. */}
        {!change && hasAccounts && historyPending && <span className={clsx(styles["change"], ui["skeleton"])}>+€0,000.00 since Jan 2026</span>}
      </div>
      {summary.unvalued > 0 && <p>{summary.unvalued} without a balance</p>}
      {/* Assets and loans share one scale; the loan track is always laid out, so the card's height does not depend on having loans. */}
      <div className={clsx(styles["bars"], netWorthValue)} aria-hidden="true">
        <div className={styles["bar-track"]}>
          <span
            className={styles["bar-fill"]}
            style={{
              width: percent(bars.assets)
            }}
          >
            <span
              className={styles["cash-segment"]}
              style={{
                flex: bars.segments.cash
              }}
            />
            <span
              className={styles["investment-segment"]}
              style={{
                flex: bars.segments.investments
              }}
            />
            <span
              className={styles["property-segment"]}
              style={{
                flex: bars.segments.property
              }}
            />
          </span>
        </div>
        <div className={clsx(styles["bar-track"], styles["loan-track"])}>
          <span
            className={clsx(styles["bar-fill"], styles["loan-segment"])}
            style={{
              width: percent(bars.loans)
            }}
          />
        </div>
      </div>
      <div className={styles["wealth-allocation"]}>
        <span>
          <i className={clsx(styles["legend-dot"], ui["liquid"])} />
          Cash<strong className={netWorthValue}>{money(summary.liquidity, currency)}</strong>
        </span>
        <span>
          <i className={clsx(styles["legend-dot"], styles["invested"])} />
          Investments<strong className={netWorthValue}>{money(summary.investments, currency)}</strong>
        </span>
        <span>
          <i className={clsx(styles["legend-dot"], ui["property"])} />
          Property<strong className={netWorthValue}>{money(summary.property, currency)}</strong>
        </span>
        <span>
          <i className={clsx(styles["legend-dot"], styles["loans"])} />
          Loans<strong className={netWorthValue}>{summary.liabilities === 0 && netWorth.status === "ready" ? "—" : money(summary.liabilities, currency)}</strong>
        </span>
      </div>
      {/* The curve's place is held until the history for the shown currency arrives, so the card and the accounts panel beside it keep their height. */}
      {hasAccounts && (historyReady ? <HistoryCurve points={points} /> : <div className={styles["history-curve"]} aria-hidden="true" />)}
      {netWorthArea.status === "pending" && netWorthArea.failure && <FailureCover failure={netWorthArea.failure} subject="Your net worth" />}
    </section>
  );
}

function historyChange(points: NetWorthPoint[]) {
  const first = points[0];
  const last = points.at(-1);

  if (!first || !last || first === last || first.amount_minor === last.amount_minor) {
    return null;
  }

  const month = Temporal.PlainDate.from(first.date).toPlainYearMonth();

  return {
    amount: last.amount_minor - first.amount_minor,
    since: `${describeMonth(month).label} ${month.year}`
  };
}

/** A decorative area curve of the past year; the figure above stays the information. */
function HistoryCurve({ points }: {
  points: NetWorthPoint[]
}) {
  if (points.length < 2) {
    return null;
  }

  const amounts = points.map(point => point.amount_minor);
  const low = Math.min(...amounts);
  const range = Math.max(...amounts) - low;
  // A flat year sits low in the card instead of filling it.
  const y = (amount: number) => range ? 40 - (amount - low) / range * 34 : 34;
  const x = (index: number) => index / (points.length - 1) * 100;
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point.amount_minor)}`).join(" ");

  return (
    <svg
      className={styles["history-curve"]}
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path className={styles["history-area"]} d={`${line} L100,40 L0,40 Z`} />
      <path className={styles["history-line"]} d={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function percent(share: number) {
  return `${share * 100}%`;
}
