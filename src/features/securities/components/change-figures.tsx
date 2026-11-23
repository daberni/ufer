"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./change-figures.module.css";

import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { useLocale } from "@/client/locale-provider";
import { dateWithYear } from "@/lib/date-format";
import { formatCountLabel, formatSignedPercent } from "@/lib/locale";
import { signedMoney } from "@/lib/money";
import { useBrokeragePerformance, useBrokerageTrades } from "../queries";
import type { PerformancePoint } from "../performance";
import type { ChangeSummary } from "../types";

/** A brokerage account's change figures from its holdings query, for the account summary card. */
export function BrokerageChange({ accountId, currency }: {
  accountId: string;
  currency: string;
}) {
  const trades = useBrokerageTrades(accountId);
  const performance = useBrokeragePerformance(accountId);

  // The time-weighted percent sits beside the total, so the figures wait for the series instead of growing when it arrives.
  if (trades.isPending || performance.isPending) {
    return <ChangeFiguresSkeleton stacked />;
  }

  return trades.data ? (
    <ChangeFigures
      summary={trades.data.summary}
      points={performance.data?.points}
      currency={currency}
      stacked
    />
  ) : null;
}

/** Colors a figure by its own sign: the money and the time-weighted percentage can legitimately differ. */
function tone(value: number) {
  return clsx(value > 0 && ui["positive"], value < 0 && ui["negative"]);
}

/** Like `tone`, on the four-decimal ratio that `formatSignedPercent` shows, so a displayed 0.00% stays neutral. */
function ratioTone(ratio: number) {
  return tone(Math.round(ratio * 10_000));
}

/** The change figures' layout, held while the holdings load. */
export function ChangeFiguresSkeleton({
  stacked = false,
  showTotal = true
}: {
  stacked?: boolean;
  showTotal?: boolean;
}) {
  return (
    <dl className={clsx(styles["figures"], stacked && styles["stacked"])} aria-hidden="true">
      {showTotal && (
        <div className={styles["figure"]}>
          <dt><span className={ui["skeleton"]}>Total performance</span></dt>
          <dd className={styles["amount"]}>
            <span className={ui["skeleton"]}>+€0,000.00</span>
            <span className={clsx(styles["percent"], ui["skeleton"])}>+00.0% time-weighted</span>
          </dd>
        </div>
      )}
      <div className={styles["figure"]}>
        <dt><span className={ui["skeleton"]}>Since 23 Nov 2026</span></dt>
        <dd className={styles["amount"]}>
          <span className={ui["skeleton"]}>+€000.00</span>
          <span className={clsx(styles["percent"], ui["skeleton"])}>+0.00%</span>
        </dd>
      </div>
    </dl>
  );
}

/** The total performance (unrealized plus realized, with its time-weighted %) and the change since the previous prices; without an honest figure it shows a dash and says why. */
export function ChangeFigures({
  summary,
  points,
  currency,
  stacked = false,
  showTotal = true
}: {
  summary: ChangeSummary;
  /** The time-weighted performance series; its last point gives the performance since the first trade. */
  points?: PerformancePoint[];
  currency: string;
  /** One figure per line, for narrow cards beside a chart. */
  stacked?: boolean;
  /** False beside a performance chart, whose header already shows the total. */
  showTotal?: boolean;
}) {
  const locale = useLocale();
  const {
    total,
    day
  } = summary;
  const last = points?.at(-1);

  return (
    <dl className={clsx(styles["figures"], stacked && styles["stacked"])}>
      {showTotal && (
        <div className={styles["figure"]}>
          <dt>Total performance</dt>
          <dd className={styles["amount"]}>
            <span className={tone(total.gain_minor)}>{signedMoney(total.gain_minor, currency, locale)}</span>
            {last && <span className={clsx(styles["percent"], ratioTone(last.growth - 1))}>{formatSignedPercent(last.growth - 1, locale)} time-weighted</span>}
          </dd>
          {total.unpriced > 0 && <dd className={styles["hint"]}>{formatCountLabel(total.unpriced, "holding", "holdings", locale)} without a price at cost</dd>}
        </div>
      )}
      <div className={styles["figure"]}>
        {day ? (
          <>
            <dt>{day.mixed_dates ? "Since previous prices" : `Since ${dateWithYear(Temporal.PlainDate.from(day.previous_date), locale)}`}</dt>
            <dd className={styles["amount"]}>
              <span className={tone(day.change_minor)}>{signedMoney(day.change_minor, currency, locale)}</span>
              <span className={clsx(styles["percent"], ratioTone(day.ratio))}>{formatSignedPercent(day.ratio, locale)}</span>
            </dd>
            {day.excluded > 0 && <dd className={styles["hint"]}>{formatCountLabel(day.excluded, "holding", "holdings", locale)} without a current price left out</dd>}
          </>
        ) : (
          <>
            <dt>Since previous prices</dt>
            <dd className={styles["amount"]} aria-label="Not available">–</dd>
            <dd className={styles["hint"]}>No current prices from two trading days yet</dd>
          </>
        )}
      </div>
    </dl>
  );
}
