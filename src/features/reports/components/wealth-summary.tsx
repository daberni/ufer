"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./wealth-summary.module.css";
import { Wallet } from "lucide-react";
import { money, signedMoney } from "@/lib/money";
import { valueMask, withPlaceholder } from "@/components/ui/result-presentation";
import { FailureCover } from "@/components/ui/area-placeholder";
import { useCurrency } from "@/client/use-app-url";
import type { Area } from "@/components/ui/use-area-result";
import type { NetWorth } from "@/features/accounts/types";
import { Temporal } from "temporal-polyfill";
import { shortMonthWithYear } from "@/lib/date-format";
import type { NetWorthHistory, NetWorthPoint } from "@/features/reports/net-worth-series";
import { useLocale } from "@/client/locale-provider";

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
  const locale = useLocale();
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
  const points = historyArea.status === "ready" && historyArea.data.currency === currency ? historyArea.data.points : [];
  const change = netWorth.status === "ready" && hasAccounts ? historyChange(points, locale) : null;

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
        <div className={clsx(styles["wealth-number"], netWorthValue)}>{hasAccounts ? money(summary.netWorth, currency, locale) : "—"}</div>
        {change && <span className={styles["change"]}>{signedMoney(change.amount, currency, locale)} since {change.since}</span>}
      </div>
      {summary.unvalued > 0 && <p>{summary.unvalued} without a balance</p>}
      <div className={clsx(styles["allocation-bar"], netWorthValue)} aria-hidden="true">
        <span
          style={{
            flex: Math.max(0, summary.liquidity)
          }}
        />
        <span
          style={{
            flex: Math.max(0, summary.investments)
          }}
        />
        <span
          style={{
            flex: Math.max(0, summary.property)
          }}
        />
      </div>
      <div className={styles["wealth-allocation"]}>
        <span>
          <i className={clsx(styles["legend-dot"], ui["liquid"])} />
          Cash<strong className={netWorthValue}>{money(summary.liquidity, currency, locale)}</strong>
        </span>
        <span>
          <i className={clsx(styles["legend-dot"], styles["invested"])} />
          Investments<strong className={netWorthValue}>{money(summary.investments, currency, locale)}</strong>
        </span>
        <span>
          <i className={clsx(styles["legend-dot"], ui["property"])} />
          Property<strong className={netWorthValue}>{money(summary.property, currency, locale)}</strong>
        </span>
      </div>
      {/* Before the first results the loans line is laid out too, so a card with loans keeps its height when they arrive. */}
      {(summary.liabilities !== 0 || netWorthArea.status === "pending") && (
        <div className={styles["liabilities"]}>
          Loans <span className={netWorthValue}>{money(summary.liabilities, currency, locale)}</span>
        </div>
      )}
      {hasAccounts && <HistoryCurve points={points} />}
      {netWorthArea.status === "pending" && netWorthArea.failure && <FailureCover failure={netWorthArea.failure} subject="Your net worth" />}
    </section>
  );
}

function historyChange(points: NetWorthPoint[], locale: string) {
  const first = points[0];
  const last = points.at(-1);

  if (!first || !last || first === last || first.amount_minor === last.amount_minor) {
    return null;
  }

  const month = Temporal.PlainDate.from(first.date).toPlainYearMonth();

  return {
    amount: last.amount_minor - first.amount_minor,
    since: shortMonthWithYear(month, locale)
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
