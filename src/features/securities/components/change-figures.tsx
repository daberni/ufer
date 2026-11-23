"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./change-figures.module.css";

import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { useTranslations } from "next-intl";
import { useLocale } from "@/client/locale-provider";
import { dateWithYear } from "@/lib/date-format";
import { formatSignedPercent } from "@/lib/locale";
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
  const t = useTranslations("securities.change");

  return (
    <dl className={clsx(styles["figures"], stacked && styles["stacked"])} aria-hidden="true">
      {showTotal && (
        <div className={styles["figure"]}>
          <dt><span className={ui["skeleton"]}>{t("totalPerformance")}</span></dt>
          <dd className={styles["amount"]}>
            <span className={ui["skeleton"]}>+€0,000.00</span>
            <span className={clsx(styles["percent"], ui["skeleton"])}>{t("timeWeighted", {
              percent: "+00.0%"
            })}</span>
          </dd>
        </div>
      )}
      <div className={styles["figure"]}>
        <dt><span className={ui["skeleton"]}>{t("sinceDate", {
          date: "00 Xxx 0000"
        })}</span></dt>
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
  const t = useTranslations("securities.change");
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
          <dt>{t("totalPerformance")}</dt>
          <dd className={styles["amount"]}>
            <span className={tone(total.gain_minor)}>{signedMoney(total.gain_minor, currency, locale)}</span>
            {last && (
              <span className={clsx(styles["percent"], ratioTone(last.growth - 1))}>{t("timeWeighted", {
                percent: formatSignedPercent(last.growth - 1, locale)
              })}</span>
            )}
          </dd>
          {total.unpriced > 0 && (
            <dd className={styles["hint"]}>{t("unpricedAtCost", {
              count: total.unpriced
            })}</dd>
          )}
        </div>
      )}
      <div className={styles["figure"]}>
        {day ? (
          <>
            <dt>{day.mixed_dates ? t("sincePreviousPrices") : t("sinceDate", {
              date: dateWithYear(Temporal.PlainDate.from(day.previous_date), locale)
            })}</dt>
            <dd className={styles["amount"]}>
              <span className={tone(day.change_minor)}>{signedMoney(day.change_minor, currency, locale)}</span>
              <span className={clsx(styles["percent"], ratioTone(day.ratio))}>{formatSignedPercent(day.ratio, locale)}</span>
            </dd>
            {day.excluded > 0 && (
              <dd className={styles["hint"]}>{t("excluded", {
                count: day.excluded
              })}</dd>
            )}
          </>
        ) : (
          <>
            <dt>{t("sincePreviousPrices")}</dt>
            <dd className={styles["amount"]} aria-label={t("notAvailable")}>–</dd>
            <dd className={styles["hint"]}>{t("noPrices")}</dd>
          </>
        )}
      </div>
    </dl>
  );
}
