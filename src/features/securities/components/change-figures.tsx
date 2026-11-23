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

  return trades.data ? (
    <ChangeFigures
      summary={trades.data.summary}
      points={performance.data?.points}
      currency={currency}
      stacked
    />
  ) : null;
}

/** The total performance (unrealized plus realized, with its time-weighted % and gain on cost) and the change since the previous trading day; without an honest figure it shows a dash and says why. */
export function ChangeFigures({
  summary,
  points,
  currency,
  stacked = false
}: {
  summary: ChangeSummary;
  /** The time-weighted performance series; its last point gives the performance since the first trade. */
  points?: PerformancePoint[];
  currency: string;
  /** One figure per line, for narrow cards beside a chart. */
  stacked?: boolean;
}) {
  const locale = useLocale();
  const {
    total,
    day
  } = summary;
  const last = points?.at(-1);

  return (
    <dl className={clsx(styles["figures"], stacked && styles["stacked"])}>
      <div className={styles["figure"]}>
        <dt>Total performance</dt>
        <dd className={clsx(styles["amount"], total.gain_minor > 0 && ui["positive"])}>
          {signedMoney(total.gain_minor, currency, locale)}
          {last && <span className={styles["percent"]}>{formatSignedPercent(last.growth - 1, locale)} time-weighted</span>}
        </dd>
        {/* The time-weighted % ignores when and how much was invested; the gain on cost is the simple ratio of the amount to all buy costs. */}
        {total.ratio !== null && <dd className={styles["secondary"]}>{formatSignedPercent(total.ratio, locale)} gain on cost</dd>}
        <dd className={styles["hint"]}>
          {total.unpriced > 0 ? `Unrealized and realized; ${formatCountLabel(total.unpriced, "holding", "holdings", locale)} without a price count at cost` : "Unrealized and realized"}
        </dd>
      </div>
      <div className={styles["figure"]}>
        <dt>Since previous trading day</dt>
        {day ? (
          <>
            <dd className={clsx(styles["amount"], day.change_minor > 0 && ui["positive"])}>
              {signedMoney(day.change_minor, currency, locale)}
              <span className={styles["percent"]}>{formatSignedPercent(day.ratio, locale)}</span>
            </dd>
            <dd className={styles["hint"]}>
              {day.mixed_dates ? `Each holding's latest two prices, up to ${dateWithYear(Temporal.PlainDate.from(day.date), locale)}` : `${dateWithYear(Temporal.PlainDate.from(day.date), locale)} against ${dateWithYear(Temporal.PlainDate.from(day.previous_date), locale)}`}
              {day.excluded > 0 && `; ${formatCountLabel(day.excluded, "holding", "holdings", locale)} without a current price left out`}
            </dd>
          </>
        ) : (
          <>
            <dd className={styles["amount"]} aria-label="Not available">–</dd>
            <dd className={styles["hint"]}>No current prices from two trading days yet</dd>
          </>
        )}
      </div>
    </dl>
  );
}
