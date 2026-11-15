import { viennaMonth } from "@/lib/money";

/**
 * The reporting period shared by every period-aware view. A month is a Vienna calendar month in `YYYY-MM` form.
 */
export type Period = {
  kind: "month";
  month: string;
} | {
  kind: "all";
};

const trendLength = 6;

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export function monthPeriod(month: string): Period {
  return {
    kind: "month",
    month
  };
}

export const allMonthsPeriod: Period = {
  kind: "all"
};

export function currentMonthPeriod(now = new Date()): Period {
  return monthPeriod(viennaMonth(now));
}

/** Single query/URL representation: `YYYY-MM` for a month, `all` for all months. */
export function serializePeriod(period: Period) {
  return period.kind === "all" ? "all" : period.month;
}

export function parsePeriod(value: string): Period | null {
  if (value === "all") {
    return allMonthsPeriod;
  }

  if (!monthPattern.test(value)) {
    return null;
  }

  return monthPeriod(value);
}

export function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + monthNumber - 1 + delta;
  const shiftedYear = Math.floor(index / 12);
  const shiftedMonth = index - shiftedYear * 12 + 1;

  return `${String(shiftedYear).padStart(4, "0")}-${String(shiftedMonth).padStart(2, "0")}`;
}

/**
 * Months covered by the cash-flow trend, oldest first. A month period ends at the selected month; all months end at the current month.
 */
export function trendMonths(period: Period, currentMonth: string) {
  const end = period.kind === "month" ? period.month : currentMonth;

  return Array.from({
    length: trendLength
  }, (_, index) => shiftMonth(end, index - trendLength + 1));
}
