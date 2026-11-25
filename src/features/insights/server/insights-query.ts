import { Temporal } from "temporal-polyfill";
import { database } from "@/server/database/connection";
import { today } from "@/lib/time";
import { comparisonSpans, precedingRanges, serializeRange, spanToJson, type PeriodRange } from "@/lib/period-range";
import { trendLength } from "@/lib/period";
import { readSpanBreakdowns, readSpanFlows, type DaySpan } from "@/features/reports/server/cash-flow-query";
import { readNetWorthOn } from "@/features/reports/server/net-worth-history-query";
import type { Insights, NetWorthChangeComparison, SpanFlows } from "@/features/insights/types";

/** Income, expenses and both by category and by account for each span, with the span's dates. */
async function readFlows(currency: string, spans: DaySpan[]): Promise<SpanFlows[]> {
  const db = await database();
  const [flows, byAccount] = await Promise.all([readSpanFlows(db, currency, spans), readSpanBreakdowns(db, currency, spans, "account")]);

  return flows.map((flow, index) => ({
    ...spanToJson(spans[index]),
    ...flow,
    incomeByAccount: byAccount[index].income,
    expensesByAccount: byAccount[index].expenses
  }));
}

/** The day before a span starts, whose closing net worth the span's change starts from. */
function dayBefore(span: DaySpan) {
  return span.start.subtract({
    days: 1
  }).toString();
}

/** Net-worth change over each span, or null for a span that has not started. */
async function readNetWorthChanges(currency: string, spans: DaySpan[], now: Temporal.Instant) {
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
    readFlows(currency, precedingRanges(range, trendLength)),
    readFlows(currency, [comparison.current]),
    readFlows(currency, [comparison.previous])
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
