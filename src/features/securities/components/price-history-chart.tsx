"use client";

import ui from "../../../components/ui/primitives.module.css";
import chartStyles from "../../accounts/components/balance-history-chart.module.css";
import styles from "./performance-panel.module.css";

import { clsx } from "clsx";
import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { SignedArea } from "@/components/ui/signed-area";
import { useLocale } from "@/client/locale-provider";
import { formatSignedPercent } from "@/lib/locale";
import { today } from "@/lib/time";
import { plotBalances } from "@/features/accounts/balance-chart";
import { describeBalanceDate } from "@/features/accounts/balance-presentation";
import { useBalanceChart } from "@/features/accounts/use-balance-chart";
import { performanceRanges, pricesInRange, type PerformanceRange } from "../performance-range";
import type { PricePoint } from "../types";
import { formatPrice } from "./holding-format";

/** A security's stored closes over a chosen range, in the performance chart's layout: the close and its change since the range's start, with the price axis beside the plot. */
export function PriceHistoryPanel({
  title,
  prices,
  currency,
  digits
}: {
  title: string;
  /** Newest first, as the holding endpoint returns them. */
  prices: PricePoint[];
  currency: string;
  digits: number;
}) {
  const t = useTranslations("securities.priceHistory");
  const performance = useTranslations("securities.performance");
  const [range, setRange] = useState<PerformanceRange>("All");
  const oldestFirst = useMemo(() => prices.toReversed(), [prices]);
  const points = useMemo(() => pricesInRange(oldestFirst, range, today().toString()), [oldestFirst, range]);

  return (
    <section className={clsx(ui["panel"], styles["performance"])}>
      <div className={ui["card-heading"]}>
        <h2>{title}</h2>
        <div className={styles["ranges"]} role="group" aria-label={performance("range")}>
          {performanceRanges.map(option => (
            <button
              key={option}
              type="button"
              className={styles["range"]}
              aria-pressed={option === range}
              onClick={() => setRange(option)}
            >{performance(`ranges.${option}`)}</button>
          ))}
        </div>
      </div>
      {points.length > 1 ? (
        <PriceChart
          title={title}
          points={points}
          range={range}
          currency={currency}
          digits={digits}
        />
      ) : <p className={styles["note"]}>{prices.length ? t("tooFew") : t("none")}</p>}
    </section>
  );
}

/** A figure's color by its sign; zero stays neutral. */
function tone(value: number) {
  if (value > 0) {
    return "positive";
  }

  return value < 0 ? "negative" : undefined;
}

function PriceChart({
  title,
  points,
  range,
  currency,
  digits
}: {
  title: string;
  points: PricePoint[];
  range: PerformanceRange;
  currency: string;
  digits: number;
}) {
  const t = useTranslations("securities.priceHistory");
  const locale = useLocale();
  const descriptionId = useId();
  const chart = useMemo(() => plotBalances(points.map(point => ({
    date: point.date,
    amount_minor: point.close_micros
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
  const ratio = point.close_micros / points[0].close_micros - 1;
  const price = formatPrice(point.close_micros, currency, locale, digits);
  const change = formatSignedPercent(ratio, locale);
  const context = activeIndex === null ? t("closeOn", {
    date: date.label,
    range: t(`rangeContext.${range}`)
  }) : t("closeOn", {
    date: date.label,
    range: t("since", {
      start
    })
  });
  const activePoint = activeIndex === null ? null : chart.points[activeIndex];
  const top = Math.min(...chart.points.map(plotted => plotted.y));
  const bottom = Math.max(...chart.points.map(plotted => plotted.y));
  const line = useMemo(() => chart.points.map((plotted, index) => index ? `L${plotted.x} ${plotted.y}` : `M${plotted.x} ${plotted.y}`).join(" "), [chart]);

  return (
    <figure className={chartStyles["chart"]}>
      <figcaption className={styles["readout"]} aria-hidden="true">
        <strong>{price}</strong>
        <span data-tone={tone(Math.round(ratio * 10_000))}>{change}</span>
        <small>{context}</small>
      </figcaption>
      <div className={styles["frame"]}>
        <div
          {...plotProps}
          className={chartStyles["plot"]}
          role="slider"
          tabIndex={0}
          aria-label={title}
          aria-describedby={descriptionId}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={lastIndex}
          aria-valuenow={activeIndex ?? lastIndex}
          aria-valuetext={t("valueText", {
            date: date.label,
            price,
            change,
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
          >{formatPrice(chart.highest, currency, locale, digits)}</span>
          <span
            style={{
              top: `${bottom}%`
            }}
          >{formatPrice(chart.lowest, currency, locale, digits)}</span>
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
