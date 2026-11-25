import { Temporal } from "temporal-polyfill";
import { validDate } from "@/lib/time";

/** How the insights divide time: calendar months, quarters and years, or a custom range of whole days. */
export type Interval = "month" | "quarter" | "year" | "custom";

export const intervals: Interval[] = ["month", "quarter", "year", "custom"];

/** A reporting range of whole days, both ends included, and the interval it was chosen in. */
export type PeriodRange = {
  interval: Interval;
  start: Temporal.PlainDate;
  end: Temporal.PlainDate;
};

/** A range as dates in API responses, both ends included. */
export type DateSpan = {
  start: string;
  end: string;
};

/** The longest custom range, so a column series of them stays within a sensible query window. */
export const maximumCustomDays = 3660;

const monthPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;
const quarterPattern = /^(\d{4})-Q([1-4])$/;
const yearPattern = /^(\d{4})$/;
const customPattern = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

function monthRange(month: Temporal.PlainYearMonth): PeriodRange {
  return {
    interval: "month",
    start: month.toPlainDate({
      day: 1
    }),
    end: month.toPlainDate({
      day: month.daysInMonth
    })
  };
}

function quarterRange(year: number, quarter: number): PeriodRange {
  const first = Temporal.PlainYearMonth.from({
    year,
    month: (quarter - 1) * 3 + 1
  });
  const last = first.add({
    months: 2
  });

  return {
    interval: "quarter",
    start: first.toPlainDate({
      day: 1
    }),
    end: last.toPlainDate({
      day: last.daysInMonth
    })
  };
}

function yearRange(year: number): PeriodRange {
  return {
    interval: "year",
    start: Temporal.PlainDate.from({
      year,
      month: 1,
      day: 1
    }),
    end: Temporal.PlainDate.from({
      year,
      month: 12,
      day: 31
    })
  };
}

function quarterOf(date: Temporal.PlainDate) {
  return Math.ceil(date.month / 3);
}

/** The calendar range of an interval that contains a date; a custom range keeps its own ends. */
export function rangeContaining(interval: Exclude<Interval, "custom">, date: Temporal.PlainDate): PeriodRange {
  if (interval === "month") {
    return monthRange(date.toPlainYearMonth());
  }

  if (interval === "quarter") {
    return quarterRange(date.year, quarterOf(date));
  }

  return yearRange(date.year);
}

/** A custom range from its ends in either order. */
export function customRange(first: Temporal.PlainDate, second: Temporal.PlainDate): PeriodRange {
  const ordered = Temporal.PlainDate.compare(first, second) <= 0;

  return {
    interval: "custom",
    start: ordered ? first : second,
    end: ordered ? second : first
  };
}

/** Days in a range, both ends included. */
export function rangeDays(range: Pick<PeriodRange, "start" | "end">) {
  return range.start.until(range.end).days + 1;
}

/**
 * The URL form of a range: `2026-11` for a month, `2026-Q4` for a quarter, `2026` for a year and `2026-01-05..2026-03-04` for a custom range.
 */
export function serializeRange(range: PeriodRange) {
  if (range.interval === "month") {
    return range.start.toPlainYearMonth().toString();
  }

  if (range.interval === "quarter") {
    return `${String(range.start.year).padStart(4, "0")}-Q${quarterOf(range.start)}`;
  }

  if (range.interval === "year") {
    return String(range.start.year).padStart(4, "0");
  }

  return `${range.start.toString()}..${range.end.toString()}`;
}

export function parseRange(value: string): PeriodRange | null {
  const month = monthPattern.exec(value);

  if (month) {
    return monthRange(Temporal.PlainYearMonth.from(value));
  }

  const quarter = quarterPattern.exec(value);

  if (quarter) {
    return quarterRange(Number(quarter[1]), Number(quarter[2]));
  }

  if (yearPattern.test(value)) {
    return yearRange(Number(value));
  }

  const custom = customPattern.exec(value);

  if (!custom || !validDate(custom[1]) || !validDate(custom[2])) {
    return null;
  }

  const range = customRange(Temporal.PlainDate.from(custom[1]), Temporal.PlainDate.from(custom[2]));

  return rangeDays(range) <= maximumCustomDays ? range : null;
}

/** The range `steps` intervals later (or earlier for a negative count): the neighbouring calendar unit, or a custom range moved by its own length. */
export function shiftRange(range: PeriodRange, steps: number): PeriodRange {
  if (range.interval === "custom") {
    const days = rangeDays(range) * steps;

    return {
      interval: "custom",
      start: range.start.add({
        days
      }),
      end: range.end.add({
        days
      })
    };
  }

  const months = {
    month: 1,
    quarter: 3,
    year: 12
  }[range.interval] * steps;

  return rangeContaining(range.interval, range.start.add({
    months
  }));
}

/** The range and the `count - 1` equal intervals before it, oldest first, so the range is the last. */
export function precedingRanges(range: PeriodRange, count: number) {
  return Array.from({
    length: count
  }, (_, index) => shiftRange(range, index - count + 1));
}

/** Whether today lies inside the range, so its later days have not happened yet. */
export function isRunning(range: Pick<PeriodRange, "start" | "end">, today: Temporal.PlainDate) {
  return Temporal.PlainDate.compare(range.start, today) <= 0 && Temporal.PlainDate.compare(today, range.end) <= 0;
}

/**
 * The spans a range is compared over: the whole range against the whole previous interval, or, while the range is still running, its days up to today against the same number of days at the start of the previous interval (never beyond that interval's end).
 */
export function comparisonSpans(range: PeriodRange, today: Temporal.PlainDate) {
  const previous = shiftRange(range, -1);

  if (!isRunning(range, today)) {
    return {
      partial: false,
      current: range,
      previous
    };
  }

  const elapsed = range.start.until(today).days;
  const previousEnd = previous.start.add({
    days: elapsed
  });

  return {
    partial: true,
    current: {
      ...range,
      end: today
    },
    previous: {
      ...previous,
      end: Temporal.PlainDate.compare(previousEnd, previous.end) <= 0 ? previousEnd : previous.end
    }
  };
}

export function spanToJson(range: Pick<PeriodRange, "start" | "end">): DateSpan {
  return {
    start: range.start.toString(),
    end: range.end.toString()
  };
}

/** Switching the interval keeps the same point in time: the calendar unit containing the range's last day up to today, or the current range's days as a custom range. */
export function changeInterval(range: PeriodRange, interval: Interval, today: Temporal.PlainDate): PeriodRange {
  if (interval === "custom") {
    return {
      ...range,
      interval: "custom"
    };
  }

  if (Temporal.PlainDate.compare(range.end, today) <= 0) {
    return rangeContaining(interval, range.end);
  }

  return rangeContaining(interval, isRunning(range, today) ? today : range.start);
}
