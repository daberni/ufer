"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId } from "react";
import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import styles from "./period-bar.module.css";
import { selectRange } from "@/features/insights/insights-location";
import { daySpanLabel, rangeTitle } from "@/features/insights/range-format";
import { CurrencyChoice } from "@/features/accounts/components/currency-choice";
import { changeInterval, comparisonSpans, customRange, intervals, maximumCustomDays, rangeDays, shiftRange, spanToJson, type PeriodRange } from "@/lib/period-range";
import { today, validDate } from "@/lib/time";
import { Temporal } from "temporal-polyfill";
import { useLocale } from "@/client/locale-provider";
import type { Area } from "@/components/ui/use-area-result";

type Props = {
  range: PeriodRange;
  /** The currencies in use and the selected one; until they load, no currency choice is offered. */
  currencies: Area<string[]>;
};

/** The label of the span the selected range is compared with: the previous interval, or its first days while the range runs. */
export function comparisonLabel(range: PeriodRange, locale: string) {
  const spans = comparisonSpans(range, today());

  return spans.partial ? daySpanLabel(spanToJson(spans.previous), locale) : rangeTitle(spans.previous, locale);
}

export function PeriodBar({
  range,
  currencies
}: Props) {
  const t = useTranslations("insights.period");
  const locale = useLocale();
  const name = useId();

  return (
    <div className={styles["period-bar"]} role="group" aria-label={t("label")}>
      <fieldset className={styles["intervals"]}>
        <legend className={ui["visually-hidden"]}>{t("label")}</legend>
        {intervals.map(interval => (
          <label className={styles["interval"]} key={interval}>
            <input
              className={styles["interval-input"]}
              type="radio"
              name={name}
              value={interval}
              checked={range.interval === interval}
              onChange={() => selectRange(changeInterval(range, interval, today()))}
            />
            {t(interval)}
          </label>
        ))}
      </fieldset>
      <div className={styles["stepper"]}>
        <button
          type="button"
          className={ui["icon-button"]}
          aria-label={t("previous")}
          onClick={() => selectRange(shiftRange(range, -1))}
        >
          <ChevronLeft size={17} />
        </button>
        <strong className={styles["range"]} aria-live="polite">{rangeTitle(range, locale)}</strong>
        <button
          type="button"
          className={ui["icon-button"]}
          aria-label={t("next")}
          onClick={() => selectRange(shiftRange(range, 1))}
        >
          <ChevronRight size={17} />
        </button>
      </div>
      {range.interval === "custom" && <CustomRange key={`${range.start}:${range.end}`} range={range} />}
      <span className={clsx(ui["subtle"], styles["comparison"])}>{t("versus", {
        period: comparisonLabel(range, locale)
      })}</span>
      <CurrencyChoice className={styles["currency"]} currencies={currencies.data ?? []} />
    </div>
  );
}

/** A custom range's first and last day; each completed date selects the range at once, swapping the ends when they are reversed. */
function CustomRange({ range }: {
  range: PeriodRange;
}) {
  const t = useTranslations("insights.period");

  function change(end: "start" | "end", value: string) {
    if (!validDate(value)) {
      return;
    }

    const date = Temporal.PlainDate.from(value);
    const next = end === "start" ? customRange(date, range.end) : customRange(range.start, date);

    if (rangeDays(next) <= maximumCustomDays) {
      selectRange(next);
    }
  }

  return (
    <div className={styles["custom"]}>
      <label>
        <span>{t("from")}</span>
        <input type="date" defaultValue={range.start.toString()} onChange={event => change("start", event.target.value)} />
      </label>
      <label>
        <span>{t("to")}</span>
        <input type="date" defaultValue={range.end.toString()} onChange={event => change("end", event.target.value)} />
      </label>
    </div>
  );
}
