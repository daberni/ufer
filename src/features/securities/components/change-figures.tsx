"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./change-figures.module.css";

import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { useTranslations } from "next-intl";
import { useLocale } from "@/client/locale-provider";
import { dateWithYear } from "@/lib/date-format";
import { formatSignedPercent } from "@/lib/locale";
import { money, signedMoney } from "@/lib/money";
import { useBrokeragePerformance, useBrokerageTrades } from "../queries";
import { totalReturn } from "../performance";
import type { ChangeSummary, TotalReturn } from "../types";

/** A brokerage account's figures from its holdings and performance queries, for the account's value card. */
export function BrokerageChange({ accountId, currency }: {
  accountId: string;
  currency: string;
}) {
  const trades = useBrokerageTrades(accountId);
  const performance = useBrokeragePerformance(accountId);

  // The time-weighted percent sits beside the total, so the figures wait for the series instead of growing when it arrives.
  if (trades.isPending || performance.isPending) {
    return <ChangeFiguresSkeleton />;
  }

  return trades.data ? (
    <ChangeFigures
      summary={trades.data.summary}
      totalReturn={totalReturn(performance.data?.points ?? [])}
      currency={currency}
    />
  ) : null;
}

/** Colors a figure by its own sign: the money and the time-weighted percentage can legitimately differ. */
function tone(value: number) {
  // An unsigned figure keeps no class, so its secondary line stays muted.
  return clsx(value > 0 && ui["positive"], value < 0 && ui["negative"]) || undefined;
}

/** Like `tone`, on the four-decimal ratio that `formatSignedPercent` shows, so a displayed 0.00% stays neutral. */
function ratioTone(ratio: number) {
  return tone(Math.round(ratio * 10_000));
}

/** The figure rows' layout, held while the holdings load; it reserves every row, so only a row that does not apply can leave. */
export function ChangeFiguresSkeleton() {
  const t = useTranslations("securities.change");
  const rows = [t("today"), t("totalGain"), t("invested"), t("unrealized"), t("realized")];

  return (
    <dl className={styles["figures"]} aria-hidden="true">
      {rows.map(label => (
        <div key={label} className={styles["figure"]}>
          <dt><span className={ui["skeleton"]}>{label}</span></dt>
          <dd><span className={ui["skeleton"]}>+€0,000.00</span></dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A brokerage value card's figure rows, in one fixed order on the account page and the Brokerage overview: the change since the previous prices, the total gain since the first purchase with its time-weighted return, then what is invested and how the gain splits into unrealized and realized.
 * A row that does not apply, such as the day's change without prices from two trading days or the realized gain before any sale, is left out.
 */
export function ChangeFigures({
  summary,
  totalReturn,
  currency
}: {
  summary: ChangeSummary;
  /** The time-weighted return since the first trade, over the same accounts as `summary`. */
  totalReturn: TotalReturn | null;
  currency: string;
}) {
  const t = useTranslations("securities.change");
  const locale = useLocale();
  const {
    total,
    day
  } = summary;
  const unrealized = total.gain_minor - total.realized_minor;

  return (
    <dl className={styles["figures"]}>
      {day && (
        <div className={styles["figure"]}>
          <dt>{t("today")}</dt>
          <dd>
            <span className={tone(day.change_minor)}>{signedMoney(day.change_minor, currency, locale)}</span>
            <small className={ratioTone(day.ratio)}>{day.mixed_dates ? formatSignedPercent(day.ratio, locale) : t("versus", {
              percent: formatSignedPercent(day.ratio, locale),
              date: dateWithYear(Temporal.PlainDate.from(day.previous_date), locale)
            })}</small>
            {day.excluded > 0 && (
              <small>{t("excluded", {
                count: day.excluded
              })}</small>
            )}
          </dd>
        </div>
      )}
      <div className={styles["figure"]}>
        <dt>{t("totalGain")}</dt>
        <dd>
          <span className={tone(total.gain_minor)}>{signedMoney(total.gain_minor, currency, locale)}</span>
          {totalReturn && (
            <small className={ratioTone(totalReturn.ratio)}>{t("returnSince", {
              percent: formatSignedPercent(totalReturn.ratio, locale),
              date: dateWithYear(Temporal.PlainDate.from(totalReturn.since), locale)
            })}</small>
          )}
        </dd>
      </div>
      <div className={styles["figure"]}>
        <dt>{t("invested")}</dt>
        <dd><span>{money(total.invested_minor, currency, locale)}</span></dd>
      </div>
      <div className={styles["figure"]}>
        <dt>{t("unrealized")}</dt>
        <dd>
          <span className={tone(unrealized)}>{signedMoney(unrealized, currency, locale)}</span>
          {total.unpriced > 0 && (
            <small>{t("unpricedAtCost", {
              count: total.unpriced
            })}</small>
          )}
        </dd>
      </div>
      {total.realized_minor !== 0 && (
        <div className={styles["figure"]}>
          <dt>{t("realized")}</dt>
          <dd><span className={tone(total.realized_minor)}>{signedMoney(total.realized_minor, currency, locale)}</span></dd>
        </div>
      )}
    </dl>
  );
}
