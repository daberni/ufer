"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId, useMemo } from "react";
import { clsx } from "clsx";
import { money } from "@/lib/money";
import { plotSeries } from "@/features/accounts/balance-chart";
import { balanceSourceLabels, describeBalanceDate } from "@/features/accounts/balance-presentation";
import { useBalanceChart } from "@/features/accounts/use-balance-chart";
import type { BalancePoint } from "@/features/accounts/types";
import styles from "./balance-history-chart.module.css";

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
  const descriptionId = useId();
  const chart = useMemo(() => plotSeries([balances]), [balances]);
  const points = chart.series[0];
  const positions = useMemo(() => points.map(point => point.x), [points]);
  const {
    activeIndex,
    plotProps
  } = useBalanceChart(positions, interactive);
  const lastIndex = balances.length - 1;
  const firstDate = describeBalanceDate(balances[0].date);
  const lastDate = describeBalanceDate(balances[lastIndex].date);
  const balance = balances[activeIndex ?? lastIndex];
  const date = describeBalanceDate(balance.date);
  const source = balanceSourceLabels[balance.source];
  const amount = money(balance.amount_minor, currency);
  const activePoint = activeIndex === null ? null : points[activeIndex];
  const line = useMemo(() => points.map((point, index) => index ? `H${point.x} V${point.y}` : `M${point.x} ${point.y}`).join(" "), [points]);
  const area = `${line} L100 100 L0 100 Z`;

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
          <small className={ui["skeleton"]}>Calculated</small>
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
