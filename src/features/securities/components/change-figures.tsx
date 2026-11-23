"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./change-figures.module.css";

import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { useLocale } from "@/client/locale-provider";
import { dateWithYear } from "@/lib/date-format";
import { formatCountLabel, formatSignedPercent } from "@/lib/locale";
import { signedMoney } from "@/lib/money";
import { useBrokerageTrades } from "../queries";
import type { ChangeSummary } from "../types";

/** A brokerage account's change figures from its holdings query, for the account summary card. */
export function BrokerageChange({ accountId, currency }: {
  accountId: string;
  currency: string;
}) {
  const trades = useBrokerageTrades(accountId);

  return trades.data ? <ChangeFigures summary={trades.data.summary} currency={currency} stacked /> : null;
}

/** The total change (unrealized plus realized) and the change since the previous trading day; without an honest figure it shows a dash and says why. */
export function ChangeFigures({
  summary,
  currency,
  stacked = false
}: {
  summary: ChangeSummary;
  currency: string;
  /** One figure per line, for narrow cards beside a chart. */
  stacked?: boolean;
}) {
  const locale = useLocale();
  const {
    total,
    day
  } = summary;

  return (
    <dl className={clsx(styles["figures"], stacked && styles["stacked"])}>
      <div className={styles["figure"]}>
        <dt>Total change</dt>
        <dd className={clsx(styles["amount"], total.gain_minor > 0 && ui["positive"])}>
          {signedMoney(total.gain_minor, currency, locale)}
          {total.ratio !== null && <span className={styles["percent"]}>{formatSignedPercent(total.ratio, locale)}</span>}
        </dd>
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
              {dateWithYear(Temporal.PlainDate.from(day.date), locale)} against {dateWithYear(Temporal.PlainDate.from(day.previous_date), locale)}
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
