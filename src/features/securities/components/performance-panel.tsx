"use client";

import ui from "../../../components/ui/primitives.module.css";
import chartStyles from "../../accounts/components/balance-history-chart.module.css";

import { clsx } from "clsx";
import { useId, useMemo, useState } from "react";
import styles from "./performance-panel.module.css";
import { SignedArea } from "@/components/ui/signed-area";
import { useLocale } from "@/client/locale-provider";
import { formatCountLabel, formatSignedPercent } from "@/lib/locale";
import { signedMoney } from "@/lib/money";
import { plotBalances } from "@/features/accounts/balance-chart";
import { describeBalanceDate } from "@/features/accounts/balance-presentation";
import { useBalanceChart } from "@/features/accounts/use-balance-chart";
import { useBrokeragePerformance } from "../queries";
import type { BrokeragePerformance } from "../types";
import { changeFromPrevious, performanceInRange, performanceRanges, type PerformanceRange, type RangePoint } from "../performance-range";

// Returns are plotted in millionths so the shared integer value scale keeps enough resolution.
const plotScale = 1_000_000;

/** A brokerage account's time-weighted return over a chosen range, with the gain in money beside it. */
export function PerformancePanel({ accountId }: {
  accountId: string
}) {
  const query = useBrokeragePerformance(accountId);

  return (
    <PerformanceView
      title="Performance"
      isPending={query.isPending}
      isError={query.isError}
      performance={query.data}
    />
  );
}

/** A time-weighted return series over a chosen range; the Brokerage overview shows one per currency across all accounts. */
export function PerformanceView({
  title,
  isPending,
  isError,
  performance
}: {
  title: string;
  isPending: boolean;
  isError: boolean;
  performance: Pick<BrokeragePerformance, "currency" | "missing" | "points"> | undefined;
}) {
  const query = {
    isPending,
    isError,
    data: performance
  };
  const [range, setRange] = useState<PerformanceRange>("All");
  const locale = useLocale();
  const points = useMemo(() => performanceInRange(query.data?.points ?? [], range), [query.data, range]);

  return (
    <section className={clsx(ui["panel"], styles["performance"])} aria-busy={query.isPending}>
      <div className={ui["card-heading"]}>
        <h2>{title}</h2>
        <div className={styles["ranges"]} role="group" aria-label="Range">
          {performanceRanges.map(option => (
            <button
              key={option}
              type="button"
              className={styles["range"]}
              aria-pressed={option === range}
              onClick={() => setRange(option)}
            >{option}</button>
          ))}
        </div>
      </div>
      {query.isPending && <PerformanceChartSkeleton />}
      {query.isError && <p className={styles["note"]}>The performance could not be loaded.</p>}
      {query.data && (points.length > 1 ? <PerformanceChart points={points} currency={query.data.currency} /> : <p className={styles["note"]}>The chart appears once a trade is recorded.</p>)}
      {query.data && query.data.missing > 0 && <p className={styles["note"]}>{formatCountLabel(query.data.missing, "holding has", "holdings have", locale)} no price yet and count at cost, without performance.</p>}
    </section>
  );
}

/** The performance chart's layout with its readout of return and gain, held until the series arrives. */
function PerformanceChartSkeleton() {
  return (
    <figure className={chartStyles["chart"]} aria-hidden="true">
      <figcaption className={chartStyles["readout"]}>
        <span>
          <span className={ui["skeleton"]}>23 Nov 2026</span>
          <small className={ui["skeleton"]}>Since 12 Jan 2025</small>
        </span>
        <span className={styles["totals"]}>
          <strong className={ui["skeleton"]}>+00.00%</strong>
          <small className={ui["skeleton"]}>+€0,000.00</small>
        </span>
      </figcaption>
      <div className={clsx(chartStyles["plot"], ui["skeleton"])} />
      <div className={chartStyles["dates"]}>
        <span className={ui["skeleton"]}>12 Jan 2025</span>
        <span className={ui["skeleton"]}>23 Nov 2026</span>
      </div>
    </figure>
  );
}

function PerformanceChart({
  points,
  currency
}: {
  points: RangePoint[];
  currency: string;
}) {
  const locale = useLocale();
  const descriptionId = useId();
  const chart = useMemo(() => plotBalances(points.map(point => ({
    date: point.date,
    amount_minor: Math.round(point.return_ratio * plotScale)
  }))), [points]);
  const positions = useMemo(() => chart.points.map(point => point.x), [chart]);
  const {
    activeIndex,
    plotProps
  } = useBalanceChart(positions, true, "nearest");
  const lastIndex = points.length - 1;
  const point = points[activeIndex ?? lastIndex];
  const date = describeBalanceDate(point.date, locale);
  const start = describeBalanceDate(points[0].date, locale).label;
  const percent = formatSignedPercent(point.return_ratio, locale);
  const gain = signedMoney(point.gain_minor, currency, locale);
  const readout = activeIndex === null ? rangeReadout() : pointReadout(activeIndex);
  const activePoint = activeIndex === null ? null : chart.points[activeIndex];

  // Without a selection the header shows the whole range; a selected point shows its change against the previous point, which may lie several days back.
  function rangeReadout() {
    return {
      context: `Since ${start}`,
      negative: point.return_ratio < 0,
      percent,
      detail: gain,
      valueText: `${date.label}: ${percent}, ${gain} since ${start}`
    };
  }

  function pointReadout(index: number) {
    const change = changeFromPrevious(points, index);
    const context = `${percent} since ${start}`;

    if (!change) {
      return {
        context,
        negative: false,
        percent: "–",
        detail: "Start of range",
        valueText: `${date.label}: start of range`
      };
    }

    const previous = describeBalanceDate(change.previousDate, locale).label;
    const changePercent = formatSignedPercent(change.ratio, locale);
    const changeGain = signedMoney(change.gain_minor, currency, locale);

    return {
      context,
      negative: change.ratio < 0,
      percent: changePercent,
      detail: `${changeGain} vs ${previous}`,
      valueText: `${date.label}: ${changePercent}, ${changeGain} since ${previous}; ${context}`
    };
  }

  const line = useMemo(() => chart.points.map((plotted, index) => index ? `H${plotted.x} V${plotted.y}` : `M${plotted.x} ${plotted.y}`).join(" "), [chart]);

  return (
    <figure className={chartStyles["chart"]}>
      <figcaption className={chartStyles["readout"]} aria-hidden="true">
        <span>
          <time dateTime={date.dateTime} title={date.title}>{date.label}</time>
          <small>{readout.context}</small>
        </span>
        <span className={styles["totals"]}>
          <strong data-negative={readout.negative ? "" : undefined}>{readout.percent}</strong>
          <small>{readout.detail}</small>
        </span>
      </figcaption>
      <div
        {...plotProps}
        className={chartStyles["plot"]}
        role="slider"
        tabIndex={0}
        aria-label="Performance"
        aria-describedby={descriptionId}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={lastIndex}
        aria-valuenow={activeIndex ?? lastIndex}
        aria-valuetext={readout.valueText}
        data-active={activePoint ? "" : undefined}
      >
        <span className={chartStyles["axis-label"]} data-edge="top" aria-hidden="true">{formatSignedPercent(chart.highest / plotScale, locale)}</span>
        <span className={chartStyles["axis-label"]} data-edge="bottom" aria-hidden="true">{formatSignedPercent(chart.lowest / plotScale, locale)}</span>
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
            areaClassName={chartStyles["area"]}
            lineClassName={chartStyles["line"]}
            positiveClassName={chartStyles["positive"]}
            negativeClassName={chartStyles["negative"]}
            zeroClassName={chartStyles["zero"]}
          />
        </svg>
        {activePoint && (
          <span
            className={chartStyles["cursor"]}
            style={{
              left: `${activePoint.x}%`
            }}
            aria-hidden="true"
          >
            <i
              className={chartStyles["point"]}
              data-negative={point.return_ratio < 0 && chart.zero !== null ? "" : undefined}
              style={{
                top: `${activePoint.y}%`
              }}
            />
          </span>
        )}
      </div>
      <p className={ui["visually-hidden"]} id={descriptionId}>Time-weighted return, which leaves out the effect of buys and sales. Use the left and right arrow keys to explore dates, Home and End for the first and last date, and Escape to dismiss the selection.</p>
      <div className={chartStyles["dates"]} aria-hidden="true">
        <span>{describeBalanceDate(points[0].date, locale).label}</span>
        <span>{describeBalanceDate(points[lastIndex].date, locale).label}</span>
      </div>
    </figure>
  );
}
