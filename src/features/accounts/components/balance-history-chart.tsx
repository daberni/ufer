"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId, useMemo } from "react";
import { clsx } from "clsx";
import { SignedArea } from "@/components/ui/signed-area";
import { money } from "@/lib/money";
import { plotBalances } from "@/features/accounts/balance-chart";
import { describeBalanceSource, describeBalanceDate } from "@/features/accounts/balance-presentation";
import { useBalanceChart } from "@/features/accounts/use-balance-chart";
import type { BalancePoint } from "@/features/accounts/types";
import styles from "./balance-history-chart.module.css";
import { useLocale } from "@/client/locale-provider";

type Props = {
  balances: BalancePoint[];
  currency: string;
  interactive: boolean;
};

export function BalanceHistoryChart({
  balances,
  currency,
  interactive
}: Props) {
  const locale = useLocale();
  const descriptionId = useId();
  const chart = useMemo(() => plotBalances(balances), [balances]);
  const positions = useMemo(() => chart.points.map(point => point.x), [chart]);
  const {
    activeIndex,
    plotProps
  } = useBalanceChart(positions, interactive);
  const lastIndex = balances.length - 1;
  const firstDate = describeBalanceDate(balances[0].date, locale);
  const lastDate = describeBalanceDate(balances[lastIndex].date, locale);
  const balance = balances[activeIndex ?? lastIndex];
  const date = describeBalanceDate(balance.date, locale);
  const source = describeBalanceSource(balance);
  const amount = money(balance.amount_minor, currency, locale);
  const activePoint = activeIndex === null ? null : chart.points[activeIndex];
  const line = useMemo(() => chart.points.map((point, index) => index ? `H${point.x} V${point.y}` : `M${point.x} ${point.y}`).join(" "), [chart]);

  return (
    <figure className={styles["chart"]}>
      <figcaption className={styles["readout"]} aria-hidden="true">
        <span>
          <time dateTime={date.dateTime} title={date.title}>{date.label}</time>
          <small>{source}</small>
        </span>
        <strong>{amount}</strong>
      </figcaption>
      <div
        {...plotProps}
        className={styles["plot"]}
        role="slider"
        tabIndex={interactive ? 0 : -1}
        aria-label="Balance history"
        aria-describedby={descriptionId}
        aria-orientation="horizontal"
        aria-disabled={!interactive}
        aria-valuemin={0}
        aria-valuemax={lastIndex}
        aria-valuenow={activeIndex ?? lastIndex}
        aria-valuetext={`${date.label}: ${amount}, ${source}`}
        data-active={activePoint ? "" : undefined}
      >
        <span className={styles["axis-label"]} data-edge="top" aria-hidden="true">{money(chart.highest, currency, locale)}</span>
        <span className={styles["axis-label"]} data-edge="bottom" aria-hidden="true">{money(chart.lowest, currency, locale)}</span>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <SignedArea
            line={line}
            height={100}
            zero={chart.zero}
            areaClassName={styles["area"]}
            lineClassName={styles["line"]}
            positiveClassName={styles["positive"]}
            negativeClassName={styles["negative"]}
            zeroClassName={styles["zero"]}
          />
        </svg>
        {activePoint && (
          <span
            className={styles["cursor"]}
            style={{
              left: `${activePoint.x}%`
            }}
            aria-hidden="true"
          >
            <i
              className={styles["point"]}
              data-negative={balance.amount_minor < 0 && chart.zero !== null ? "" : undefined}
              style={{
                top: `${activePoint.y}%`
              }}
            />
          </span>
        )}
      </div>
      <p className={ui["visually-hidden"]} id={descriptionId}>Use the left and right arrow keys to explore balances, Home and End for the first and last date, and Escape to dismiss the selection.</p>
      <div className={styles["dates"]} aria-hidden="true">
        <span>{firstDate.label}</span>
        <span>{lastDate.label}</span>
      </div>
    </figure>
  );
}

export function BalanceHistoryChartSkeleton() {
  return (
    <figure className={styles["chart"]} aria-hidden="true">
      <figcaption className={styles["readout"]}>
        <span>
          <span className={ui["skeleton"]}>12 Nov 2026</span>
          <small className={ui["skeleton"]}>Estimated</small>
        </span>
        <strong className={ui["skeleton"]}>€0,000.00</strong>
      </figcaption>
      <div className={clsx(styles["plot"], ui["skeleton"])} />
      <div className={styles["dates"]}>
        <span className={ui["skeleton"]}>12 Jan 2025</span>
        <span className={ui["skeleton"]}>12 Nov 2026</span>
      </div>
    </figure>
  );
}
