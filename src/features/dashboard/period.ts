import { Temporal } from "temporal-polyfill";

/**
 * The reporting period shared by every period-aware view. A month is a calendar month in Europe/Vienna.
 */
export type Period = {
  kind: "month";
  month: Temporal.PlainYearMonth;
} | {
  kind: "all";
};

/** The period as it appears in API responses, with the month as `YYYY-MM`. */
export type PeriodJson = {
  kind: "month";
  month: string;
} | {
  kind: "all";
};

const trendLength = 6;

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export function monthPeriod(month: Temporal.PlainYearMonth): Period {
  return {
    kind: "month",
    month
  };
}

export const allMonthsPeriod: Period = {
  kind: "all"
};

export function currentMonth(now = Temporal.Now.instant()) {
  return now.toZonedDateTimeISO("Europe/Vienna").toPlainDate().toPlainYearMonth();
}

export function currentMonthPeriod(): Period {
  return monthPeriod(currentMonth());
}

/** Single query/URL representation: `YYYY-MM` for a month, `all` for all months. */
export function serializePeriod(period: Period) {
  return period.kind === "all" ? "all" : period.month.toString();
}

export function parsePeriod(value: string): Period | null {
  if (value === "all") {
    return allMonthsPeriod;
  }

  // PlainYearMonth.from also accepts full dates and other ISO forms; the query contract is exactly YYYY-MM.
  if (!monthPattern.test(value)) {
    return null;
  }

  return monthPeriod(Temporal.PlainYearMonth.from(value));
}

export function periodToJson(period: Period): PeriodJson {
  if (period.kind === "all") {
    return {
      kind: "all"
    };
  }

  return {
    kind: "month",
    month: period.month.toString()
  };
}

export function periodFromJson(period: PeriodJson): Period {
  return period.kind === "all" ? allMonthsPeriod : monthPeriod(Temporal.PlainYearMonth.from(period.month));
}

/**
 * Months covered by the cash-flow trend, oldest first. A month period ends at the selected month; all months end at the current month.
 */
export function trendMonths(period: Period, current: Temporal.PlainYearMonth) {
  const end = period.kind === "month" ? period.month : current;

  return Array.from({
    length: trendLength
  }, (_, index) => end.subtract({
    months: trendLength - 1 - index
  }));
}
