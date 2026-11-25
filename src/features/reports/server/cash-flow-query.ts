import { sql, type SQL } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { database, type Database } from "@/server/database/connection";
import { currentMonth, monthPeriod, periodToJson, trendMonths, type Period } from "@/lib/period";
import { HttpError } from "@/lib/errors";
import type { AccountCashFlow, CashFlowHistory, CategoryAmount } from "@/features/reports/types";
import { beforeMonthCondition, dateRangeCondition, periodCondition } from "@/features/transactions/server/period-condition";

type Row = Record<string, unknown>;

/**
 * The amounts reports count, one row per booking or part: an unsplit booking with its category, each part of a split booking with the part's category, and, when a split booking's amount changed after splitting, the difference as an uncategorized row. Every booking thus counts exactly once with its full amount, and balances keep reading the bookings themselves.
 */
const countedLines = sql.raw(`(
  SELECT t.account_id,t.currency,t.date,t.type,t.suppressed_at,t.category_id,t.amount_minor
  FROM transactions t
  WHERE NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id)
  UNION ALL
  SELECT t.account_id,t.currency,t.date,t.type,t.suppressed_at,s.category_id,s.amount_minor
  FROM transaction_splits s
  JOIN transactions t ON t.id=s.transaction_id
  UNION ALL
  SELECT t.account_id,t.currency,t.date,t.type,t.suppressed_at,NULL,t.amount_minor-SUM(s.amount_minor)
  FROM transaction_splits s
  JOIN transactions t ON t.id=s.transaction_id
  GROUP BY t.id
  HAVING SUM(s.amount_minor)<>t.amount_minor
)`);

/** Counted lines in a date range: hidden bookings never count. Flows then select the types they cover. */
function countedIn(range: SQL) {
  return sql`t.suppressed_at IS NULL AND ${range}`;
}

/**
 * Transactions that count toward cash flow and spending in a date range: visible income and expenses in one currency. Transfers, opening balances, adjustments and hidden bookings never count, whatever their category. A split booking counts as its parts. Every cash-flow figure reads through this one definition so totals, breakdowns and the trend agree.
 */
export function countedTransactions(currency: string, range: SQL) {
  return sql`
    FROM ${countedLines} t
    JOIN accounts a ON a.id=t.account_id
    LEFT JOIN categories c ON c.id=t.category_id
    WHERE t.currency=${currency}
    AND ${countedIn(range)}
    AND t.type IN ('income','expense')
  `;
}

export type Flow = "income" | "expenses";

/** Which transactions make up each flow and the amount each contributes. A refund is an expense with a positive amount, so it reduces spending. */
const flows: Record<Flow, {
  condition: SQL;
  amount: SQL;
}> = {
  income: {
    condition: sql.raw("t.type='income'"),
    amount: sql.raw("t.amount_minor")
  },
  expenses: {
    condition: sql.raw("t.type='expense'"),
    amount: sql.raw("-t.amount_minor")
  }
};

export function flowTotal(flow: Flow) {
  return sql`COALESCE(SUM(CASE WHEN ${flows[flow].condition} THEN ${flows[flow].amount} ELSE 0 END),0)`;
}

/**
 * Amounts per category of one flow among counted transactions, largest first, with uncategorized transactions as one row. With a bucket expression (such as the booking month), rows are also split by bucket, returned as `month`.
 * A category with a negative net amount, such as an income correction or refunds exceeding spending, keeps a signed row, so the rows always sum to the flow's total; only categories netting to zero are left out.
 */
export function flowByCategory(source: SQL, flow: Flow, bucket: SQL | null) {
  const month = bucket ?? sql.raw("NULL");
  const grouping = bucket ? sql`${bucket},t.category_id` : sql.raw("t.category_id");

  return sql`
    SELECT ${month} AS month,t.category_id AS category_id,COALESCE(c.name,'Uncategorized') AS name,COALESCE(c.color,'#a2aaa5') AS color,c.icon AS icon,SUM(${flows[flow].amount}) AS amount
    ${source}
    AND ${flows[flow].condition}
    GROUP BY ${grouping}
    HAVING amount<>0
    ORDER BY month,amount DESC,name
  `;
}

export function categoryAmount(row: Row): CategoryAmount {
  return {
    categoryId: row.category_id === null ? null : String(row.category_id),
    name: String(row.name),
    color: String(row.color),
    icon: row.icon === null ? null : String(row.icon),
    amount: Number(row.amount)
  };
}

/** Consecutive days from `start` to `end`, both included. */
export type DaySpan = {
  start: Temporal.PlainDate;
  end: Temporal.PlainDate;
};

/** The half-open date bounds of a span whose end day is included. */
function spanBounds(span: DaySpan) {
  return {
    from: span.start.toString(),
    until: span.end.add({
      days: 1
    }).toString()
  };
}

/** The index of the span a booking date falls in; spans are consecutive and never overlap. */
function spanIndex(spans: DaySpan[]) {
  const cases = spans.map((span, index) => {
    const {
      from,
      until
    } = spanBounds(span);

    return sql`WHEN t.date>=${from} AND t.date<${until} THEN ${index}`;
  });

  return sql`(CASE ${sql.join(cases, sql.raw(" "))} END)`;
}

/** Income, expenses and both by category for each of the given consecutive spans, such as months, quarters or custom ranges, read through the counted lines in one pass per figure. */
export async function readSpanFlows(db: Database, currency: string, spans: DaySpan[]) {
  const outer = spanBounds({
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

  return spans.map((_, index) => {
    const ofSpan = (row: Row) => Number(row.month) === index;
    const total = totals.find(ofSpan);

    return {
      income: Number(total?.income ?? 0),
      expenses: Number(total?.expenses ?? 0),
      incomeBreakdown: income.filter(ofSpan).map(categoryAmount),
      expenseBreakdown: expenses.filter(ofSpan).map(categoryAmount)
    };
  });
}

function monthSpan(month: Temporal.PlainYearMonth): DaySpan {
  return {
    start: month.toPlainDate({
      day: 1
    }),
    end: month.toPlainDate({
      day: month.daysInMonth
    })
  };
}

/** Each of the given consecutive months' totals and category breakdowns, with the totals of the month before them, which only continue the chart's net area to its left edge. */
async function readMonthFlows(db: Database, currency: string, months: Temporal.PlainYearMonth[]) {
  const leadMonth = months[0].subtract({
    months: 1
  });
  const [lead, ...flows] = await readSpanFlows(db, currency, [leadMonth, ...months].map(monthSpan));

  return {
    leadIn: {
      month: leadMonth.toString(),
      income: lead.income,
      expenses: lead.expenses
    },
    months: months.map((month, index) => ({
      month: month.toString(),
      ...flows[index]
    }))
  };
}

/** Income, expenses, both by category, and the twelve-month trend with the totals of the month before it, including each month's income and spending by category, for one period and currency. */
export async function readCashFlow(period: Period, currency: string) {
  const db = await database();
  const inPeriod = countedTransactions(currency, periodCondition(period));
  const totalsQuery = db.all<Row>(sql`SELECT ${flowTotal("income")} AS income,${flowTotal("expenses")} AS expenses ${inPeriod}`);
  const incomeBreakdownQuery = db.all<Row>(flowByCategory(inPeriod, "income", null));
  const expenseBreakdownQuery = db.all<Row>(flowByCategory(inPeriod, "expenses", null));
  const trendQuery = readMonthFlows(db, currency, trendMonths(period, currentMonth()));
  const [totals, incomeBreakdown, expenseBreakdown, trend] = await Promise.all([totalsQuery, incomeBreakdownQuery, expenseBreakdownQuery, trendQuery]);

  return {
    period: periodToJson(period),
    currency,
    income: Number(totals[0].income),
    expenses: Number(totals[0].expenses),
    incomeBreakdown: incomeBreakdown.map(categoryAmount),
    expenseBreakdown: expenseBreakdown.map(categoryAmount),
    leadIn: trend.leadIn,
    trend: trend.months
  };
}

/** Whether any counted transaction in the currency lies before the given month. */
async function hasCountedBefore(db: Database, currency: string, month: Temporal.PlainYearMonth) {
  const rows = await db.all<Row>(sql`SELECT 1 AS found ${countedTransactions(currency, beforeMonthCondition(month))} LIMIT 1`);

  return rows.length > 0;
}

/**
 * A batch of trend months before the given month, oldest first, and whether counted transactions lie before the batch, so the chart keeps loading earlier months until there are none. Without any counted transaction before the given month the batch is empty.
 */
export async function readCashFlowHistory(currency: string, before: Temporal.PlainYearMonth): Promise<CashFlowHistory> {
  const db = await database();
  const lastMonth = before.subtract({
    months: 1
  });

  if (!await hasCountedBefore(db, currency, before)) {
    return {
      currency,
      leadIn: {
        month: lastMonth.toString(),
        income: 0,
        expenses: 0
      },
      trend: [],
      hasEarlier: false
    };
  }

  const months = trendMonths(monthPeriod(lastMonth), currentMonth());
  const [flows, hasEarlier] = await Promise.all([readMonthFlows(db, currency, months), hasCountedBefore(db, currency, months[0])]);

  return {
    currency,
    leadIn: flows.leadIn,
    trend: flows.months,
    hasEarlier
  };
}

function accountTransferTotal(direction: "incoming" | "outgoing") {
  const condition = direction === "incoming" ? sql.raw("t.amount_minor>0") : sql.raw("t.amount_minor<0");
  const amount = direction === "incoming" ? sql.raw("t.amount_minor") : sql.raw("-t.amount_minor");

  return sql`COALESCE(SUM(CASE WHEN t.type='transfer' AND ${condition} THEN ${amount} ELSE 0 END),0)`;
}

/** One account's income, expenses and transfers in a period, from its counted lines in the account's own currency, so its income and expenses agree with the overview's. */
export async function readAccountCashFlow(accountId: string, period: Period): Promise<AccountCashFlow> {
  const db = await database();
  const [row] = await db.all<Row>(sql`
    SELECT a.currency AS currency,${flowTotal("income")} AS income,${flowTotal("expenses")} AS expenses,${accountTransferTotal("incoming")} AS transfers_in,${accountTransferTotal("outgoing")} AS transfers_out
    FROM accounts a
    LEFT JOIN ${countedLines} t ON t.account_id=a.id AND t.currency=a.currency AND ${countedIn(periodCondition(period))}
    WHERE a.id=${accountId}
    GROUP BY a.id
  `);

  if (!row) {
    throw new HttpError(404, "Account not found.");
  }

  return {
    period: periodToJson(period),
    currency: String(row.currency),
    income: Number(row.income),
    expenses: Number(row.expenses),
    transfersIn: Number(row.transfers_in),
    transfersOut: Number(row.transfers_out)
  };
}
