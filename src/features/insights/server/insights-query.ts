import { sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { database } from "@/server/database/connection";
import { today } from "@/lib/time";
import { comparisonSpans, precedingRanges, serializeRange, spanToJson, type PeriodRange } from "@/lib/period-range";
import { trendLength } from "@/lib/period";
import { dateRangeCondition } from "@/features/transactions/server/period-condition";
import { categoryAmount, countedTransactions, flowByCategory, flowTotal } from "@/features/reports/server/cash-flow-query";
import { readNetWorthOn } from "@/features/reports/server/net-worth-history-query";
import type { Insights, NetWorthChangeComparison, SpanFlows } from "@/features/insights/types";

type Row = Record<string, unknown>;

type Span = Pick<PeriodRange, "start" | "end">;

/** The half-open date bounds of a span whose end day is included. */
function bounds(span: Span) {
  return {
    from: span.start.toString(),
    until: span.end.add({
      days: 1
    }).toString()
  };
}

/** The index of the span a booking date falls in; spans are consecutive and never overlap. */
function spanIndex(spans: Span[]) {
  const cases = spans.map((span, index) => {
    const {
      from,
      until
    } = bounds(span);

    return sql`WHEN t.date>=${from} AND t.date<${until} THEN ${index}`;
  });

  return sql`(CASE ${sql.join(cases, sql.raw(" "))} END)`;
}

/** Income, expenses and both by category for each span, read through the counted lines in one pass per figure. */
async function readSpanFlows(currency: string, spans: Span[]): Promise<SpanFlows[]> {
  const db = await database();
  const outer = bounds({
    start: spans[0].start,
    end: spans[spans.length - 1].end
  });
  const source = countedTransactions(currency, dateRangeCondition(outer.from, outer.until));
  const bucket = spanIndex(spans);
  const [totals, income, expenses] = await Promise.all([
    db.all<Row>(sql`SELECT ${bucket} AS month,${flowTotal("income")} AS income,${flowTotal("expenses")} AS expenses ${source} GROUP BY ${bucket}`),
    db.all<Row>(flowByCategory(source, "income", bucket)),
    db.all<Row>(flowByCategory(source, "expenses", bucket))
  ]);

  return spans.map((span, index) => {
    const ofSpan = (row: Row) => Number(row.month) === index;
    const total = totals.find(ofSpan);

    return {
      ...spanToJson(span),
      income: Number(total?.income ?? 0),
      expenses: Number(total?.expenses ?? 0),
      incomeBreakdown: income.filter(ofSpan).map(categoryAmount),
      expenseBreakdown: expenses.filter(ofSpan).map(categoryAmount)
    };
  });
}

/** The day before a span starts, whose closing net worth the span's change starts from. */
function dayBefore(span: Span) {
  return span.start.subtract({
    days: 1
  }).toString();
}

/** Net-worth change over each span, or null for a span that has not started. */
async function readNetWorthChanges(currency: string, spans: Span[], now: Temporal.Instant) {
  const current = today(now);
  const started = spans.filter(span => Temporal.PlainDate.compare(span.start, current) <= 0);
  const dates = started.flatMap(span => [dayBefore(span), span.end.toString()]);
  const values = dates.length ? await readNetWorthOn(currency, dates, now) : [];

  return spans.map(span => {
    const index = started.indexOf(span);

    return index === -1 ? null : values[index * 2 + 1] - values[index * 2];
  });
}

/**
 * Income and expenses for the selected range and the intervals before it, with the comparison against the previous interval; while the range still runs, both compared spans cover the same number of days.
 */
export async function readInsights(range: PeriodRange, currency: string, now = Temporal.Now.instant()): Promise<Insights> {
  const comparison = comparisonSpans(range, today(now));
  // The compared spans are read on their own: the running range's days and the previous interval's first days need not be adjacent.
  const [columns, [current], [previous]] = await Promise.all([
    readSpanFlows(currency, precedingRanges(range, trendLength)),
    readSpanFlows(currency, [comparison.current]),
    readSpanFlows(currency, [comparison.previous])
  ]);

  return {
    range: serializeRange(range),
    currency,
    columns,
    comparison: {
      partial: comparison.partial,
      current,
      previous
    }
  };
}

/** Net-worth change over the same compared spans as the insights' income and expenses. */
export async function readNetWorthChange(range: PeriodRange, currency: string, now = Temporal.Now.instant()): Promise<NetWorthChangeComparison> {
  const comparison = comparisonSpans(range, today(now));
  const [current, previous] = await readNetWorthChanges(currency, [comparison.current, comparison.previous], now);

  return {
    range: serializeRange(range),
    currency,
    current,
    previous
  };
}
