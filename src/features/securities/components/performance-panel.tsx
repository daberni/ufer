"use client";

import ui from "../../../components/ui/primitives.module.css";
import chartStyles from "../../accounts/components/balance-history-chart.module.css";

import { clsx } from "clsx";
import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import styles from "./performance-panel.module.css";
import { SignedArea } from "@/components/ui/signed-area";
import { useLocale } from "@/client/locale-provider";
import { formatSignedPercent } from "@/lib/locale";
import { signedMoney } from "@/lib/money";
import { plotBalances } from "@/features/accounts/balance-chart";
import { describeBalanceDate } from "@/features/accounts/balance-presentation";
import { useBalanceChart } from "@/features/accounts/use-balance-chart";
import { useBrokeragePerformance } from "../queries";
import type { BrokeragePerformance } from "../types";
import { performanceInRange, performanceRanges, type PerformanceRange, type RangePoint } from "../performance-range";

// Returns are plotted in millionths so the shared integer value scale keeps enough resolution.
const plotScale = 1_000_000;

/** A brokerage account's time-weighted return over a chosen range, with the gain in money beside it; the account's value and totals live in its value card. */
export function PerformancePanel({ accountId }: {
  accountId: string
}) {
  const query = useBrokeragePerformance(accountId);
  const t = useTranslations("securities.performance");

  return (
    <PerformanceView
      title={t("title")}
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
  performance: Pick<BrokeragePerformance, "currency" | "missing" | "points" | "as_of"> | undefined;
}) {
  const query = {
    isPending,
    isError,
    data: performance
  };
  const t = useTranslations("securities.performance");
  const [range, setRange] = useState<PerformanceRange>("All");
  const points = useMemo(() => performanceInRange(query.data?.points ?? [], range, query.data?.as_of), [query.data, range]);

  return (
    <section className={clsx(ui["panel"], styles["performance"])} aria-busy={query.isPending}>
      <div className={ui["card-heading"]}>
        <h2>{title}</h2>
        <div className={styles["ranges"]} role="group" aria-label={t("range")}>
          {performanceRanges.map(option => (
            <button
              key={option}
              type="button"
              className={styles["range"]}
              aria-pressed={option === range}
              onClick={() => setRange(option)}
            >{t(`ranges.${option}`)}</button>
          ))}
        </div>
      </div>
      {query.isPending && <PerformanceChartSkeleton />}
      {query.isError && <p className={styles["note"]}>{t("loadError")}</p>}
      {query.data && (points.length > 1 ? <PerformanceChart points={points} range={range} currency={query.data.currency} /> : <p className={styles["note"]}>{query.data.points.length ? t("nothingHeld") : t("noChart")}</p>)}
      {query.data && query.data.missing > 0 && (
        <p className={styles["note"]}>{t("missing", {
          count: query.data.missing
        })}</p>
      )}
    </section>
  );
}

/** The performance chart's layout with its readout of return and gain, held until the series arrives. */
function PerformanceChartSkeleton() {
  const t = useTranslations("securities.performance");

  return (
    <figure className={chartStyles["chart"]} aria-hidden="true">
      <figcaption className={styles["readout"]}>
        <strong className={ui["skeleton"]}>+00.00%</strong>
        <span className={ui["skeleton"]}>+€0,000.00</span>
        <small className={ui["skeleton"]}>{t("rangeContext.All")}</small>
      </figcaption>
      <div className={styles["frame"]}>
        <div className={clsx(chartStyles["plot"], ui["skeleton"])} />
        <div className={styles["axis"]} />
        <div className={chartStyles["dates"]}>
          <span className={ui["skeleton"]}>12 Jan 2025</span>
          <span className={ui["skeleton"]}>23 Nov 2026</span>
        </div>
      </div>
    </figure>
  );
}

/** A figure's color by its sign; zero stays neutral. */
function tone(value: number) {
  if (value > 0) {
    return "positive";
  }

  return value < 0 ? "negative" : undefined;
}

// The zero label is left out when it would sit within this share of the plot's height of the top or bottom label.
const labelClearance = 18;

/**
 * The time-weighted return since the range's start, with the gain in money beside it. Selecting a point shows both from the range's start to that point, so the readout always means the same as the line.
 * The return axis has its own column beside the plot and the dates their own row below it, so their labels never overlap.
 */
function PerformanceChart({
  points,
  range,
  currency
}: {
  points: RangePoint[];
  range: PerformanceRange;
  currency: string;
}) {
  const t = useTranslations("securities.performance");
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
  const end = describeBalanceDate(points[lastIndex].date, locale).label;
  const percent = formatSignedPercent(point.return_ratio, locale);
  const gain = signedMoney(point.gain_minor, currency, locale);
  const context = activeIndex === null ? t(`rangeContext.${range}`) : t("between", {
    start,
    end: date.label
  });
  const activePoint = activeIndex === null ? null : chart.points[activeIndex];
  const top = chart.points.length ? Math.min(...chart.points.map(plotted => plotted.y)) : 0;
  const bottom = chart.points.length ? Math.max(...chart.points.map(plotted => plotted.y)) : 100;
  const zero = chart.zero;
  const showZero = zero !== null && zero - top > labelClearance && bottom - zero > labelClearance;
  const line = useMemo(() => chart.points.map((plotted, index) => index ? `H${plotted.x} V${plotted.y}` : `M${plotted.x} ${plotted.y}`).join(" "), [chart]);

  return (
    <figure className={chartStyles["chart"]}>
      <figcaption className={styles["readout"]} aria-hidden="true">
        <strong data-tone={tone(Math.round(point.return_ratio * 10_000))}>{percent}</strong>
        <span data-tone={tone(point.gain_minor)}>{gain}</span>
        <small>{context}</small>
      </figcaption>
      <div className={styles["frame"]}>
        <div
          {...plotProps}
          className={chartStyles["plot"]}
          role="slider"
          tabIndex={0}
          aria-label={t("title")}
          aria-describedby={descriptionId}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={lastIndex}
          aria-valuenow={activeIndex ?? lastIndex}
          aria-valuetext={t("valueText", {
            date: date.label,
            percent,
            gain,
            start
          })}
          data-active={activePoint ? "" : undefined}
        >
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
        <div className={styles["axis"]} aria-hidden="true">
          <span
            style={{
              top: `${top}%`
            }}
          >{formatSignedPercent(chart.highest / plotScale, locale)}</span>
          {showZero && (
            <span
              style={{
                top: `${zero}%`
              }}
            >{formatSignedPercent(0, locale)}</span>
          )}
          <span
            style={{
              top: `${bottom}%`
            }}
          >{formatSignedPercent(chart.lowest / plotScale, locale)}</span>
        </div>
        <div className={chartStyles["dates"]} aria-hidden="true">
          <span>{start}</span>
          <span>{end}</span>
        </div>
      </div>
      <p className={ui["visually-hidden"]} id={descriptionId}>{t("description")}</p>
    </figure>
  );
}
