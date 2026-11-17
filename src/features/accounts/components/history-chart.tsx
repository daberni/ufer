"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import styles from "./history-chart.module.css";
import { dateWithYear } from "@/lib/date-format";
import { money } from "@/lib/money";
import { plotSeries, type DatedAmount } from "@/features/accounts/balance-chart";

export type SeriesTone = "balance" | "net-worth" | "liquid" | "invested" | "property" | "debt";

export type ChartSeries = {
  label: string;
  tone: SeriesTone;
  /** Oldest first. */
  points: DatedAmount[];
};

/** How a point of the first series was observed; carried points reuse a balance recorded before their month. */
export type PointMarker = "observed" | "carried";

type Interpolation = "linear" | "step";

type Props = {
  /** The first series is the subject of the chart, drawn on top and with its area when it is alone; the others share its scale. */
  series: ChartSeries[];
  currency: string;
  /** What the chart shows, for screen readers; a table next to the chart carries the values. */
  summary: string;
  markers?: PointMarker[];
  interpolation: Interpolation;
  /** Keep a labelled zero baseline in the visible domain, including for one-sided wealth totals. */
  includeZero: boolean;
};

export function historyDateLabel(date: string) {
  return dateWithYear(Temporal.PlainDate.from(date));
}

function linePath(points: {
  x: number;
  y: number;
}[], interpolation: Interpolation) {
  return points.map((point, index) => {
    if (index === 0) {
      return `M${point.x} ${point.y}`;
    }

    return interpolation === "step" ? `H${point.x} V${point.y}` : `L${point.x} ${point.y}`;
  }).join(" ");
}

/** Amounts over time, spaced by date: daily balances step between bookings; monthly wealth can connect its period observations. */
export function HistoryChart({
  series,
  currency,
  summary,
  markers,
  interpolation,
  includeZero
}: Props) {
  const chart = plotSeries(series.map(entry => entry.points), includeZero);
  const [subject] = chart.series;
  const subjectPoints = series[0].points;
  const subjectLine = linePath(subject, interpolation);

  return (
    <figure className={styles["chart"]}>
      {series.length > 1 && (
        <ul className={styles["legend"]} aria-hidden="true">
          {series.map(entry => (
            <li key={entry.label} data-tone={entry.tone}>
              <i className={ui["legend-dot"]} />
              {entry.label}
            </li>
          ))}
        </ul>
      )}
      <div className={styles["plot"]} role="img" aria-label={summary}>
        {(chart.highest !== 0 || chart.zero === null) && <span className={styles["axis-label"]} data-edge="top" aria-hidden="true">{money(chart.highest, currency)}</span>}
        {(chart.lowest !== 0 || chart.zero === null) && <span className={styles["axis-label"]} data-edge="bottom" aria-hidden="true">{money(chart.lowest, currency)}</span>}
        {chart.zero !== null && (
          <span
            className={clsx(styles["axis-label"], styles["zero-label"])}
            style={{
              top: `${chart.zero}%`
            }}
            aria-hidden="true"
          >
            {money(0, currency)}
          </span>
        )}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {series.length === 1 && <path className={styles["area"]} data-tone={series[0].tone} d={`${subjectLine} L100 100 L0 100 Z`} />}
          {chart.zero !== null && (
            <line
              className={styles["zero"]}
              x1="0"
              x2="100"
              y1={chart.zero}
              y2={chart.zero}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {chart.series.slice(1).map((points, index) => (
            <path
              key={series[index + 1].label}
              className={styles["line"]}
              data-tone={series[index + 1].tone}
              d={linePath(points, interpolation)}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path
            className={clsx(styles["line"], styles["subject"])}
            data-tone={series[0].tone}
            d={subjectLine}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {markers && subject.map((point, index) => (
          <span
            key={subjectPoints[index].date}
            className={styles["marker"]}
            data-marker={markers[index]}
            data-tone={series[0].tone}
            aria-hidden="true"
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`
            }}
          />
        ))}
      </div>
      <figcaption className={styles["dates"]} aria-hidden="true">
        <span>{historyDateLabel(subjectPoints[0].date)}</span>
        <span>{historyDateLabel(subjectPoints[subjectPoints.length - 1].date)}</span>
      </figcaption>
    </figure>
  );
}

/** The chart's shape before its first results. */
export function HistoryChartSkeleton() {
  return (
    <div className={styles["chart"]}>
      <div className={clsx(styles["plot"], ui["skeleton"])} />
      <div className={styles["dates"]}>
        <span className={ui["skeleton"]}>12 Jan 2025</span>
        <span className={ui["skeleton"]}>12 Nov 2026</span>
      </div>
    </div>
  );
}
